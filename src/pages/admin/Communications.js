// Communications.js — admin view of every conversation the India 101 AI concierge
// handled (phone / web chat / email), with one-line AI summaries, needs-attention
// flags, and expandable transcripts. Reads the portal's /api/communications
// endpoint with the admin's Cognito ID token (same pool, so it validates).
import React, { useCallback, useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { ENDPOINTS } from '../../config/endpoints';

const PORTAL_API = ENDPOINTS.portalApi;
const TZ = 'America/Chicago';

async function authHeaders() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const CHANNEL = {
  phone: { label: '📞 Phone', cls: 'bg-sky-500/15 text-sky-300' },
  chat: { label: '💬 Chat', cls: 'bg-violet-500/15 text-violet-300' },
  email: { label: '✉️ Email', cls: 'bg-emerald-500/15 text-emerald-300' },
};

function actLabel(a) {
  switch (a.type) {
    case 'reservation': return `Booked ${a.name || ''} · party ${a.partySize ?? '?'} · ${a.date || ''} ${a.time || ''} (${a.status || ''})`;
    case 'waitlist': return `Waitlisted ${a.name || ''} · party ${a.partySize ?? '?'}`;
    case 'email': return `Emailed banquet info → ${a.to || ''}`;
    case 'flag': return `Flagged for staff: ${a.reason || ''}`;
    default: return String(a.type || 'action');
  }
}

function fmt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export default function Communications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${PORTAL_API}/api/communications`, { headers: await authHeaders() }).then((r) => r.json());
      if (res.ok) { setItems(res.communications || []); setError(''); }
      else setError(res.error || 'Could not load communications.');
    } catch {
      setError('Could not load communications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // refresh while the tab is open
    return () => clearInterval(id);
  }, [load]);

  const toggle = (id) => setExpanded((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const attentionCount = items.filter((c) => c.needsAttention).length;
  const shown = onlyAttention ? items.filter((c) => c.needsAttention) : items;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Communications <span className="text-neutral-500">({items.length})</span>
          </h2>
          <p className="text-sm text-neutral-400">Phone, chat &amp; email handled by the AI concierge.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyAttention((v) => !v)}
            className={`ui-btn-sm rounded-lg ${onlyAttention ? 'ui-btn-danger' : 'ui-btn-ghost'}`}
          >
            Needs attention{attentionCount ? ` (${attentionCount})` : ''}
          </button>
          <button onClick={load} className="ui-btn-outline ui-btn-sm">Refresh</button>
        </div>
      </div>

      {loading && <div className="ui-card text-sm text-neutral-400">Loading…</div>}
      {error && !loading && <div className="ui-card text-sm text-red-300">{error}</div>}
      {!loading && !error && shown.length === 0 && (
        <div className="ui-card text-center text-sm text-neutral-400">
          No conversations{onlyAttention ? ' need attention' : ' yet'}.
        </div>
      )}

      <div className="space-y-2">
        {shown.map((c) => {
          const meta = CHANNEL[c.channel] || CHANNEL.chat;
          const open = expanded.has(c.id);
          return (
            <div key={c.id} className={`rounded-xl border bg-[#2a2727] ${c.needsAttention ? 'border-red-500/40' : 'border-[#3a3636]'}`}>
              <button onClick={() => toggle(c.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                <span className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{c.contact}</span>
                    {c.status === 'draft' && <span className="ui-badge-amber">draft</span>}
                    {c.needsAttention && <span className="text-xs font-semibold text-red-400">● needs attention</span>}
                  </span>
                  {c.subject && <span className="block truncate text-xs text-neutral-500">{c.subject}</span>}
                  <span className="mt-1 block text-sm text-neutral-200">{c.summary || '—'}</span>
                  {c.acts && c.acts.length > 0 && (
                    <span className="mt-1 block text-xs text-brand">{c.acts.map(actLabel).join(' · ')}</span>
                  )}
                </span>
                <span className="shrink-0 text-right text-xs text-neutral-500">
                  {fmt(c.when)}<span className="mt-1 block">{open ? '▲' : '▼'}</span>
                </span>
              </button>
              {open && (
                <div className="border-t border-[#3a3636] px-4 py-3">
                  {(!c.transcript || c.transcript.length === 0) && <p className="text-xs text-neutral-500">No transcript captured.</p>}
                  <div className="space-y-2">
                    {(c.transcript || []).map((m, i) => (
                      <div key={i} className="text-sm">
                        <span className={`mr-2 text-xs font-semibold uppercase ${m.role === 'user' ? 'text-neutral-500' : 'text-brand'}`}>
                          {m.role === 'user' ? 'Guest' : 'Agent'}
                        </span>
                        <span className="whitespace-pre-wrap text-neutral-200">{m.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

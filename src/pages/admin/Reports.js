// Reports.js — admin-only analytics (reservations, rescue-box sales, catering,
// revenue roll-up). Admin panel is admin-gated, so operators never see this.
import React, { useCallback, useEffect, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { ENDPOINTS } from '../../config/endpoints';

const PORTAL_API = ENDPOINTS.portalApi;

async function authHeaders() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const fmtDate = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function addDays(date, n) {
  const [y, m, dd] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const usd = (cents) => `$${((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-[color:var(--line)] p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function Reports() {
  const TODAY = fmtDate(new Date());
  const [from, setFrom] = useState(addDays(TODAY, -29));
  const [to, setTo] = useState(TODAY);
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`${PORTAL_API}/api/reports?from=${from}&to=${to}`, { headers: await authHeaders() }).then((r) => r.json());
      if (res.ok) setRep(res.report);
      else setErr(res.error || 'Failed to load.');
    } catch {
      setErr('Failed to load.');
    }
    setBusy(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const preset = (days) => { setFrom(addDays(TODAY, -(days - 1))); setTo(TODAY); };
  const maxDay = rep ? Math.max(1, ...rep.revenue.byDay.map((d) => d.cents)) : 1;
  const sellThrough = rep && rep.boxes.made ? Math.round((rep.boxes.sold / rep.boxes.made) * 100) : null;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Controls */}
      <div className="ui-card">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-brand">Reports</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
            <button onClick={() => preset(7)} className="ui-tab">7d</button>
            <button onClick={() => preset(30)} className="ui-tab">30d</button>
            <button onClick={() => preset(90)} className="ui-tab">90d</button>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="ui-input" style={{ width: 'auto' }} />
            <span className="text-neutral-500">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="ui-input" style={{ width: 'auto' }} />
            <button onClick={load} disabled={busy} className="ui-btn-primary">{busy ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </div>

      {rep && (
        <>
          {/* Revenue roll-up */}
          <div className="ui-card">
            <h3 className="font-semibold text-white mb-3">Revenue roll-up <span className="text-neutral-500 font-normal">(boxes + catering)</span></h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Total revenue" value={usd(rep.revenue.totalCents)} />
              <Stat label="Rescue boxes" value={usd(rep.boxes.revenueCents)} />
              <Stat label="Catering" value={usd(rep.catering.revenueCents)} />
            </div>
            {rep.revenue.byDay.length > 0 && (
              <div className="mt-4 space-y-1">
                {rep.revenue.byDay.map((d) => (
                  <div key={d.date} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-neutral-400">{d.date.slice(5)}</span>
                    <div className="h-3 rounded bg-brand/70" style={{ width: `${Math.max(2, (d.cents / maxDay) * 100)}%` }} />
                    <span className="text-neutral-300">{usd(d.cents)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reservations */}
          <div className="ui-card">
            <h3 className="font-semibold text-white mb-3">Reservations</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Total" value={rep.reservations.total} />
              <Stat label="Avg party" value={rep.reservations.avgPartySize.toFixed(1)} />
              <Stat label="Seated" value={rep.reservations.byStatus.seated || 0} />
              <Stat label="Cancelled / declined" value={(rep.reservations.byStatus.cancelled || 0) + (rep.reservations.byStatus.declined || 0)} />
            </div>
            {Object.keys(rep.reservations.byWeekday).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-400">
                {Object.entries(rep.reservations.byWeekday).map(([wd, n]) => (
                  <span key={wd} className="rounded bg-[color:var(--surface-2)] px-2 py-1">{wd}: <span className="text-neutral-200">{n}</span></span>
                ))}
              </div>
            )}
          </div>

          {/* Rescue boxes */}
          <div className="ui-card">
            <h3 className="font-semibold text-white mb-3">Rescue Box sales</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Boxes sold" value={rep.boxes.sold} sub={sellThrough !== null ? `${sellThrough}% of ${rep.boxes.made} made` : undefined} />
              <Stat label="Revenue" value={usd(rep.boxes.revenueCents)} />
              <Stat label="Veg / Non-Veg" value={`${rep.boxes.vegQty} / ${rep.boxes.nonvegQty}`} />
              <Stat label="Refunds" value={rep.boxes.refunds} />
            </div>
          </div>

          {/* Catering */}
          <div className="ui-card">
            <h3 className="font-semibold text-white mb-3">Catering orders</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Orders" value={rep.catering.count} />
              <Stat label="Revenue" value={usd(rep.catering.revenueCents)} />
              <Stat label="By method" value={Object.entries(rep.catering.byMethod).map(([m, n]) => `${m}: ${n}`).join('  ·  ') || '—'} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

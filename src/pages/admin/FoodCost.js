// FoodCost.js — admin-only buffet food-cost + break-even, from refill counts.
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
const usd = (c) => `$${((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x) => `${((x || 0) * 100).toFixed(1)}%`;

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-[color:var(--line)] p-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function FoodCost() {
  const TODAY = fmtDate(new Date());
  const [from, setFrom] = useState(addDays(TODAY, -29));
  const [to, setTo] = useState(TODAY);
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`${PORTAL_API}/api/foodcost?from=${from}&to=${to}`, { headers: await authHeaders() }).then((r) => r.json());
      if (res.ok) setRep(res.report);
      else setErr(res.error || 'Failed to load.');
    } catch {
      setErr('Failed to load.');
    }
    setBusy(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const preset = (days) => { setFrom(addDays(TODAY, -(days - 1))); setTo(TODAY); };

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="ui-card">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-brand">Food Cost & Break-even</h2>
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
        <p className="mt-2 text-sm text-neutral-400">From refill counts on the Buffet → Service screen × each dish&rsquo;s pan cost. Set pan costs in the Dish Catalog.</p>
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </div>

      {rep && (
        <>
          <div className="ui-card">
            <h3 className="font-semibold text-white mb-3">Totals for this range</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat label="Food cost" value={usd(rep.totals.foodCostCents)} />
              <Stat label="Buffet revenue" value={usd(rep.totals.revenueCents)} />
              <Stat label="Food cost %" value={pct(rep.totals.foodCostPct)} sub="target ~30-35%" />
            </div>
          </div>

          <div className="ui-card">
            <h3 className="font-semibold text-white mb-3">By session ({rep.rows.length})</h3>
            {rep.rows.length === 0 && <p className="text-sm text-neutral-500 py-4">No tracked sessions in this range. Log refills on the Buffet → Service screen.</p>}
            <div className="space-y-2">
              {rep.rows.map((r) => {
                const key = `${r.date}-${r.session}`;
                const met = r.covers >= r.breakEvenCovers && r.covers > 0;
                return (
                  <div key={key} className="rounded-lg border border-[color:var(--line)]">
                    <button onClick={() => setOpen(open === key ? null : key)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-sm">
                      <span className="font-medium text-white w-40">{r.date} · {r.session === 'dinner' ? 'Dinner' : 'Lunch'}</span>
                      <span className="text-neutral-400">Cost <span className="text-neutral-200">{usd(r.foodCostCents)}</span></span>
                      <span className="text-neutral-400">FC% <span className="text-neutral-200">{r.revenueCents ? pct(r.foodCostPct) : '—'}</span></span>
                      <span className="text-neutral-400">Break-even <span className="text-neutral-200">{r.breakEvenCovers}</span> covers</span>
                      <span className={met ? 'text-emerald-300' : 'text-amber-300'}>{r.covers || 0} served</span>
                      {r.missingCost && <span className="rounded bg-amber-600/20 px-1.5 py-0.5 text-[10px] text-amber-300">missing pan costs</span>}
                      <span className="ml-auto text-neutral-500">{open === key ? '▾' : '▸'}</span>
                    </button>
                    {open === key && (
                      <div className="border-t border-[color:var(--line)] px-3 py-2 text-sm">
                        <div className="mb-2 text-xs text-neutral-500">Pans put out × pan cost · buffet price {usd(r.priceCents)}/cover</div>
                        {r.items.length === 0 ? (
                          <p className="text-neutral-500">No refills logged.</p>
                        ) : (
                          <ul className="space-y-1">
                            {r.items.map((it, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <span>{it.pans}× {it.name}{it.panCostCents === 0 && <span className="ml-2 text-amber-400 text-xs">no cost set</span>}</span>
                                <span className="text-neutral-400">{usd(it.costCents)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

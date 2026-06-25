// BuffetMenu.js — admin page to manage the India 101 daily buffet menu.
// Calls the portal's staff-gated /api/menu (same Cognito pool, so the admin's
// ID token validates). Powers the public /todays-buffet page + takeout ordering.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { ENDPOINTS } from '../../config/endpoints';

const PORTAL_API = ENDPOINTS.portalApi;

const CATEGORIES = [
  'Live Station', 'Appetizers', 'Soups & Salads', 'Curries',
  'Rice & Biryani', 'Breads', 'Sides & Chaat', 'Desserts', 'Beverages',
];

async function authHeaders() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const fmtDate = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const TODAY = fmtDate(new Date());

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function weekdayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

function DishNameInput({ value, onName, onPick }) {
  const [sugg, setSugg] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  function onChange(v) {
    onName(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) { setSugg([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${PORTAL_API}/api/dishes?q=${encodeURIComponent(v)}`, { headers: await authHeaders() }).then((r) => r.json());
        setSugg(res.dishes || []);
        setOpen(true);
      } catch { /* ignore */ }
    }, 200);
  }

  return (
    <div className="relative flex-1 min-w-[180px]">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => sugg.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Dish name"
        className="ui-input w-full"
      />
      {open && sugg.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] shadow-xl">
          {sugg.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onPick(d); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
              >
                <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${d.veg ? 'bg-green-600' : 'bg-red-700'}`} />
                <span className="truncate text-white">{d.name}</span>
                {d.category && <span className="ml-auto shrink-0 text-xs text-neutral-500">{d.category}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BuffetMenu() {
  const [date, setDate] = useState(TODAY);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (d) => {
    setStatus('Loading…');
    try {
      const res = await fetch(`${PORTAL_API}/api/menu?date=${d}`, { headers: await authHeaders() }).then((r) => r.json());
      setItems(res.day?.items || []);
      setStatus('');
    } catch {
      setStatus('Could not load menu.');
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const update = (i, fields) => setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...fields } : it)));
  const remove = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i));
  const addItem = () => setItems((arr) => [...arr, { name: '', category: 'Curries', veg: true, dinnerOnly: false, available: true }]);

  async function save() {
    setBusy(true);
    setStatus('Saving…');
    const clean = items.filter((it) => (it.name || '').trim());
    try {
      const res = await fetch(`${PORTAL_API}/api/menu`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify({ date, items: clean }),
      }).then((r) => r.json());
      if (res.ok) { setItems(res.day.items); setStatus('Saved ✓'); }
      else setStatus(res.error || 'Save failed.');
    } catch {
      setStatus('Save failed.');
    }
    setBusy(false);
  }

  async function copyWeek() {
    if (!window.confirm("Copy this week's menus onto NEXT week? Existing next-week menus will be overwritten.")) return;
    setBusy(true);
    setStatus('Copying week…');
    try {
      const res = await fetch(`${PORTAL_API}/api/menu/copy`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ sourceStart: date }),
      }).then((r) => r.json());
      setStatus(res.ok ? `Copied ${res.copied} day(s) → week of ${res.dest}` : (res.error || 'Copy failed.'));
    } catch {
      setStatus('Copy failed.');
    }
    setBusy(false);
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Date + actions */}
      <div className="ui-card">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-brand">Buffet Menu</h2>
          <span className="text-sm text-neutral-400">{weekdayLabel(date)}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button onClick={() => setDate(TODAY)} className={`ui-tab ${date === TODAY ? 'ui-tab-active' : ''}`}>Today</button>
            <button onClick={() => setDate(addDays(TODAY, 1))} className={`ui-tab ${date === addDays(TODAY, 1) ? 'ui-tab-active' : ''}`}>Tomorrow</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ui-input" style={{ width: 'auto' }} />
          </div>
        </div>
        <p className="mt-2 text-sm text-neutral-400">
          Enter the day&rsquo;s buffet items. Tag <span className="text-neutral-200">Dinner</span> for dinner-only dishes, and mark
          <span className="text-neutral-200"> Sold out</span> to pull an item live during service. Changes publish to the website instantly.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={busy} className="ui-btn-primary">Save menu</button>
          <button onClick={addItem} disabled={busy} className="ui-btn-outline">+ Add item</button>
          <button onClick={copyWeek} disabled={busy} className="ui-btn-ghost">Copy this week → next week</button>
          {status && <span className="text-sm text-neutral-400">{status}</span>}
        </div>
      </div>

      {/* Items */}
      <div className="ui-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">Items ({items.length})</h3>
        </div>
        {items.length === 0 && <p className="text-sm text-neutral-500 py-4">No items yet — click &ldquo;+ Add item&rdquo;.</p>}
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--line)] p-2">
              <DishNameInput
                value={it.name}
                onName={(v) => update(i, { name: v })}
                onPick={(d) => update(i, { name: d.name, category: d.category, veg: d.veg })}
              />
              <select value={it.category} onChange={(e) => update(i, { category: e.target.value })} className="ui-input" style={{ width: 'auto' }}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={() => update(i, { veg: !it.veg })}
                className={`px-2.5 py-1.5 rounded text-xs font-medium ${it.veg ? 'bg-green-600/20 text-green-300' : 'bg-red-600/20 text-red-300'}`}
              >
                {it.veg ? 'Veg' : 'Non-Veg'}
              </button>
              <label className="flex items-center gap-1 text-xs text-neutral-400">
                <input type="checkbox" checked={it.dinnerOnly} onChange={(e) => update(i, { dinnerOnly: e.target.checked })} /> Dinner
              </label>
              <button
                onClick={() => update(i, { available: !it.available })}
                className={`px-2.5 py-1.5 rounded text-xs ${it.available ? 'bg-[color:var(--surface-2)] text-neutral-300' : 'bg-amber-600/30 text-amber-200'}`}
              >
                {it.available ? 'Available' : 'Sold out'}
              </button>
              <button onClick={() => remove(i)} className="px-2 py-1.5 rounded text-xs text-neutral-500 hover:text-red-300">✕</button>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="mt-3 flex gap-2">
            <button onClick={addItem} disabled={busy} className="ui-btn-outline">+ Add item</button>
            <button onClick={save} disabled={busy} className="ui-btn-primary">Save menu</button>
          </div>
        )}
      </div>
    </div>
  );
}

// src/pages/payments.js
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentUser, signOut } from 'aws-amplify/auth';

const CREATE_ORDER_API = 'https://1rfhn6cj58.execute-api.us-east-2.amazonaws.com/default/create-order-dev';
const CREATE_CHECKOUT_SESSION_API = 'https://53edtj8x78.execute-api.us-east-2.amazonaws.com/payments/create-checkout-session';
const SALES_TAX_RATE = 0.0825;

const readStoredCart = () => { try { const d = JSON.parse(localStorage.getItem('i101_cart')); return Array.isArray(d) ? d : []; } catch { return []; } };
const readCheckout   = () => { try { const d = JSON.parse(sessionStorage.getItem('i101_checkout')); return d || null; } catch { return null; } };
const readOrderMeta  = () => { try { const d = JSON.parse(localStorage.getItem('i101_order_meta')); return d || {}; } catch { return {}; } };

const getItemName = (item) => item.title ?? item.ItemName ?? item.itemName ?? item.name ?? item.label ?? item.productName ?? 'Item';
const getItemSize = (item) => item.size ?? item.tray ?? item.Tray ?? item.TrayName ?? item.variant ?? item.option ?? item.sizeName ?? null;
const getUnitPrice = (item) => Number(item.unit ?? item.price ?? item.UnitPrice ?? 0);
const getQty       = (item) => Number(item.qty ?? item.quantity ?? 1);
const round2       = (n)   => Math.round((Number(n) || 0) * 100) / 100;

function computeTotals({ cartTotal, deliveryFee, addOnFee, discount }) {
  const ct = Number(cartTotal) || 0;
  const df = Number(deliveryFee) || 0;
  const ao = Number(addOnFee) || 0;
  const ds = Number(discount) || 0;
  const subtotal = round2(ct + df + ao - ds);
  const tax = round2(subtotal * SALES_TAX_RATE);
  const grandTotal = round2(subtotal + tax);
  return { cartTotal: ct, deliveryFee: df, addOnFee: ao, discount: ds, tax, grandTotal, subtotal };
}

// ---- When helpers ----
function parseTimeLabelToHM(label) {
  const m = String(label || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { h, min };
}
function buildWhenISO(dateISO, timeLabel) {
  if (!dateISO || !timeLabel) return null;
  const hm = parseTimeLabelToHM(timeLabel);
  if (!hm) return null;
  const dt = new Date(`${dateISO}T00:00:00`);
  dt.setHours(hm.h, hm.min, 0, 0);
  return dt.toISOString();
}

// ---- Spice helpers ----
const normalizeSpice = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return undefined;
  if (s.startsWith('mild')) return 'Mild';
  if (s.startsWith('spic')) return 'Spicy';
  return 'Medium'; // default/fallback
};

export default function Payment() {
  const nav = useNavigate();
  const { state } = useLocation();

  const [currentUser, setCurrentUser] = useState(null);
  useEffect(() => { getCurrentUser().then(setCurrentUser).catch(() => {}); }, []);
  const handleSignOut = async () => {
    try { await signOut({ global: true }); } catch {}
    localStorage.removeItem('i101_cart');
    localStorage.removeItem('i101_customer');
    sessionStorage.removeItem('i101_checkout');
    nav('/', { replace: true });
  };

  // ------- inputs from Checkout (or storage fallbacks) -------
  const cart     = state?.cart ?? readStoredCart();
  const fallback = readCheckout();
  const customer = state?.customer ?? fallback?.customer ?? {};
  const payment  = (state?.payment ?? fallback?.payment ?? 'card').toLowerCase(); // 'card' | 'cash'
  const returnTo = state?.returnTo || '/order/package';

  // ------- orderMeta + lines -------
  const orderMetaRaw = state?.orderMeta ?? fallback?.orderMeta ?? readOrderMeta();
  const rawLines = Array.isArray(orderMetaRaw?.lines) ? orderMetaRaw.lines : [];

  // ---- spiceSelections (prefer what Checkout passed; otherwise derive) ----
  const spiceSelections = useMemo(() => {
    const passed = state?.spiceSelections ?? fallback?.spiceSelections;
    if (Array.isArray(passed) && passed.length) return passed;

    const derived = [];
    // from package lines
    (rawLines || []).forEach((ln) => {
      const sl = ln?.SpiceLevel ?? ln?.spiceLevel ?? ln?.spice;
      if (sl) derived.push({ name: ln.name, size: ln.size, qty: ln.qty, spiceLevel: normalizeSpice(sl), source: 'package' });
    });
    // from cart extras
    (cart || []).forEach((c) => {
      const sl = c?.extras?.spiceLevel;
      if (sl) derived.push({ name: getItemName(c), size: getItemSize(c) || '', qty: getQty(c), spiceLevel: normalizeSpice(sl), source: 'trays' });
    });
    return derived;
  }, [state?.spiceSelections, fallback?.spiceSelections, rawLines, cart]);

  // --- sanitize lines (keep spiceLevel if present) ---
  const safeLines = rawLines
    .map(l => ({
      name: String(l?.name ?? '').trim(),
      size: String(l?.size ?? '').trim(),
      qty:  Number(l?.qty ?? l?.quantity ?? 0) || 0,
      ...(l?.SpiceLevel || l?.spiceLevel ? { spiceLevel: normalizeSpice(l.SpiceLevel ?? l.spiceLevel) } : {}),
    }))
    .filter(l => l.name && l.size && l.qty > 0);

  // --- human friendly summary strings
  const lineSummary = safeLines.map(l =>
    `${l.name} — ${l.size} × ${l.qty}${l.spiceLevel ? ` (Spice: ${l.spiceLevel})` : ''}`
  );

  // --- concise tray summary grouped by (name,size)
  const packageTraySummary = (() => {
    if (!safeLines.length) return '';
    const map = new Map();
    for (const l of safeLines) {
      const key = `${l.name}||${l.size}`;
      map.set(key, (map.get(key) || 0) + Number(l.qty || 0));
    }
    return Array.from(map.entries())
      .map(([key, qty]) => {
        const [nm, sz] = key.split('||');
        return `${nm} — ${sz} × ${qty}`;
      })
      .join(', ');
  })();

  // --- persistable orderMeta
  const orderMeta = { ...orderMetaRaw, lines: safeLines, lineSummary, packageTraySummary };

  // ------- Totals: trust Checkout's numbers (fallbacks only if missing) -------
  const incomingTotals = state?.totals || fallback?.totals || {};
  const derivedCartTotal = cart.reduce((s, c) => s + (Number(c.qty ?? 1) * Number(c.unit ?? 0)), 0);

  // delivery fee fallback (rare) based on distance rule
  const method = customer?.method === 'delivery' ? 'delivery' : 'pickup';
  const dist = Number(customer?.distance ?? 0);
  const deliveryFallback = method === 'delivery' ? (dist <= 20 ? 50 : (dist <= 100 ? 175 : 0)) : 0;

  // discount fallback from code (if not provided)
  const dc = String(customer?.discCode || '').trim().toLowerCase();
  const discountFallback = dc === 'online10' ? round2(derivedCartTotal * 0.10) : 0;

  // IMPORTANT: addOnFee comes from Checkout (dynamic option pricing) — do NOT recompute here.
  const baseTotals = {
    cartTotal:  Number(incomingTotals.cartTotal  ?? derivedCartTotal),
    deliveryFee:Number(incomingTotals.deliveryFee?? deliveryFallback),
    addOnFee:   Number(incomingTotals.addOnFee   ?? 0),
    discount:   Number(incomingTotals.discount   ?? discountFallback),
  };

  const totals = computeTotals(baseTotals);

  useEffect(() => { if (!cart || cart.length === 0) nav('/', { replace: true }); }, [cart, nav]);

  const currency = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const summaryRows = useMemo(() => ([
    ['Items',      currency(totals.cartTotal)],
    ...(totals.deliveryFee ? [['Delivery',   currency(totals.deliveryFee)]] : []),
    ['Add-ons',    currency(totals.addOnFee)],
    ...(totals.discount ? [['Discount', `-${currency(totals.discount).slice(1)}`]] : []),
    [`Sales Tax (${(SALES_TAX_RATE*100).toFixed(2)}%)`, currency(totals.tax)],
  ]), [totals]);

  const groupedByName = useMemo(() => {
    const sizeMap = new Map();
    cart.forEach((it) => {
      const name = getItemName(it);
      const size = getItemSize(it) || 'Tray';
      const key  = `${name}||${size}`;
      const qty  = Number(it.qty ?? 1);
      const unit = Number(it.unit ?? 0);
      if (sizeMap.has(key)) sizeMap.get(key).qty += qty;
      else sizeMap.set(key, { name, size, unit, qty, spiceLevel: it?.extras?.spiceLevel ? normalizeSpice(it.extras.spiceLevel) : undefined });
    });
    const byName = new Map();
    for (const rec of sizeMap.values()) {
      const existing = byName.get(rec.name) ?? { name: rec.name, lines: [], subtotal: 0 };
      existing.lines.push({ size: rec.size, unit: rec.unit, qty: rec.qty, spiceLevel: rec.spiceLevel });
      existing.subtotal += rec.unit * rec.qty;
      byName.set(rec.name, existing);
    }
    const sizeRank = (s) => {
      const t = s.toLowerCase();
      if (t.includes('small')) return 1;
      if (t.includes('medium')) return 2;
      if (t.includes('large') && !t.includes('extra')) return 3;
      if (t.includes('extra') || t.includes('xl')) return 4;
      return 99;
    };
    const result = Array.from(byName.values()).map(g => ({ ...g, lines: g.lines.sort((a,b)=>sizeRank(a.size)-sizeRank(b.size)) }));
    result.sort((a,b)=>a.name.localeCompare(b.name));
    return result;
  }, [cart]);

  // ---- when ----
  const whenISO =
    state?.when ||
    customer?.when ||
    buildWhenISO(customer?.pickupDate, customer?.pickupTime);

  const whenEpoch = whenISO ? new Date(whenISO).getTime() : undefined;

  const whenDisplay = useMemo(() => {
    try {
      if (whenISO) {
        // human 12-hour format, local timezone
        return new Date(whenISO).toLocaleString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true
        });
      }
    } catch {}
    const d = [customer?.pickupDate, customer?.pickupTime].filter(Boolean).join(' ');
    return d || '—';
  }, [whenISO, customer?.pickupDate, customer?.pickupTime]);

  // merge customer + computed when fields, keep new option flags
 const payloadCustomer = useMemo(() => {
  // Respect Checkout’s behavior:
  //   - Checkout ONLY includes `customer.condiments` when checked.
  //   - If it’s missing/false here, we must NOT show it.
  const includeCondiments =
    !!(customer?.condiments ?? customer?.raitaPapadPickle ?? false);

  return {
    ...customer,
    when: whenISO || null,
    whenEpoch: Number.isFinite(whenEpoch) ? whenEpoch : null,
    // keep explicit boolean for clarity
    raitaPapadPickle: includeCondiments,
    warmers: !!customer?.warmers,
    utensils: !!customer?.utensils,
  };
}, [customer, whenISO, whenEpoch]);


  // ---- Build cartForApi with tray summary and spice per item (if any) ----
  const cartForApi = useMemo(() => {
    const isPackageItem = (it) => {
      const sz = (getItemSize(it) || '').toLowerCase();
      return sz === 'package' || sz === 'packages' || sz === 'party package';
    };

    return cart.map((it) => {
      const base = {
        name: getItemName(it),
        size: getItemSize(it) || 'Tray',
        qty:  Number(it.qty ?? 1),
        unit: Number(it.unit ?? 0),
        ...(it?.extras?.spiceLevel ? { spiceLevel: normalizeSpice(it.extras.spiceLevel) } : {}),
      };

      if (isPackageItem(it) && packageTraySummary) {
        return {
          ...base,
          name: `${base.name} — [${packageTraySummary}]`,
          originalName: base.name,
          traySummary: packageTraySummary,
        };
      }
      return base;
    });
  }, [cart, packageTraySummary]);

  // loading states
  const [submittingCard, setSubmittingCard] = useState(false);
  const [submittingCash, setSubmittingCash] = useState(false);

  // ---- helper: sanitize totals to numbers ----
  const sanitizeTotals = (t) => ({
    cartTotal:  Number(t.cartTotal)  || 0,
    deliveryFee:Number(t.deliveryFee)|| 0,
    addOnFee:   Number(t.addOnFee)   || 0,
    discount:   Number(t.discount)   || 0,
    tax:        Number(t.tax)        || 0,
    subtotal:   Number(t.subtotal)   || 0,
    grandTotal: Number(t.grandTotal) || 0,
  });
  // ---- CARD: create Stripe session ----
  const onConfirmPay = async () => {
    if (submittingCard) return;
    setSubmittingCard(true);
    try {
      const safeTotals = sanitizeTotals(totals);

      const draft = {
        cart: cartForApi,
        totals: safeTotals,
        customer: payloadCustomer,
        payment: 'card',
        when: whenISO || null,
        whenEpoch: Number.isFinite(whenEpoch) ? whenEpoch : null,
        lines: safeLines,
        lineSummary,
        orderMeta,
        packageTraySummary,
        spiceSelections, // NEW
      };

      const payload = {
        totals: safeTotals,
        currency: 'usd',
        customerEmail: payloadCustomer?.email || undefined,
        draft,
      };

      const resp = await fetch(CREATE_CHECKOUT_SESSION_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Failed to create checkout session: ${await resp.text()}`);
      const data = await resp.json();
      if (data.url) {
        window.location.assign(data.url);
      } else if (data.id) {
        window.location.assign(`https://checkout.stripe.com/c/pay/${data.id}`);
      } else {
        throw new Error('Invalid session response');
      }
    } catch (e) {
      console.error(e);
      alert(e.message || 'Could not start payment. Please try again.');
      setSubmittingCard(false);
    }
  };

  // ---- CASH: create the real order immediately ----
  const onConfirmCash = async () => {
    if (submittingCash) return;
    setSubmittingCash(true);
    try {
      const body = {
        cart: cartForApi,
        totals: {
          cartTotal:  Number(totals.cartTotal)||0,
          deliveryFee:Number(totals.deliveryFee)||0,
          addOnFee:   Number(totals.addOnFee)||0,
          discount:   Number(totals.discount)||0,
          tax:        Number(totals.tax)||0,
          subtotal:   Number(totals.subtotal)||0,
          grandTotal: Number(totals.grandTotal)||0,
        },
        customer: payloadCustomer,            // includes raitaPapadPickle / warmers / utensils / specialRequest
        payment: 'cash',
        when: whenISO || null,
        whenEpoch: Number.isFinite(whenEpoch) ? whenEpoch : null,
        lines: safeLines,
        lineSummary,
        orderMeta,
        packageTraySummary,
        spiceSelections,                      // NEW: top-level for easy ingestion
      };

      const res = await fetch(CREATE_ORDER_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Order API failed: ${await res.text()}`);
      const { orderId, placedAt } = await res.json();

      nav('/thank-you', {
        replace: true,
        state: {
          orderId,
          placedAt,
          customer: payloadCustomer,
          totals: body.totals,
          method: payloadCustomer?.method || 'pickup',
          when: whenISO || null,
          whenLabel: whenDisplay,
        }
      });
    } catch (e) {
      console.error(e);
      alert(e.message || 'Order creation failed. Please try again.');
      setSubmittingCash(false);
    }
  };

  // --- UI helpers (matching Checkout) ---
  const DetailRow = ({ label, children }) => (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-gray-400">{label}</div>
      <div className="col-span-2">{children}</div>
    </div>
  );

  const Spinner = () => (
    <svg className="animate-spin h-4 w-4 inline-block mr-2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" fill="currentColor" />
    </svg>
  );

  /* -------- Mobile summary drawer state -------- */
  const [showSummaryMobile, setShowSummaryMobile] = useState(false);

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-4 md:p-6 md:pr-[24rem] relative">
      {/* Header (desktop fixed, mobile inline) */}
      <div className="hidden md:flex absolute top-4 right-[24rem] items-center gap-6 text-sm">
        {currentUser ? (
          <>
            <span>Welcome,&nbsp;{currentUser.signInDetails?.loginId ?? currentUser.username}</span>
            <button onClick={handleSignOut} className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded">
              Sign Out
            </button>
          </>
        ) : null}
      </div>

      {/* Mobile topbar sign-out */}
      <div className="md:hidden flex justify-end mb-2">
        {currentUser ? (
          <button onClick={handleSignOut} className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm">
            Sign Out
          </button>
        ) : null}
      </div>

      {/* title + back */}
      <div className="text-center md:text-left">
        <h1 className="text-2xl md:3xl font-bold text-orange-400">
          Review Your Order
        </h1>
      </div>

      <div className="text-center md:text-left mt-3 md:mt-4">
        <button
          onClick={() =>
            nav('/checkout', {
              state: { cart, cartTotal: totals.cartTotal, orderMeta, returnTo, spiceSelections },
              replace: true,
            })
          }
          className="mb-6 md:mb-8 text-sm bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#F58735]/60 rounded px-3 py-1"
        >
          ‹ Back to Checkout
        </button>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:block fixed top-0 right-4 w-80 h-full bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto">
        <h2 className="text-xl font-semibold text-[#F58735] mb-3">Summary</h2>
        <ul className="space-y-1 text-sm mb-3">
          {summaryRows.map(([k, v]) => (
            <li key={k} className="flex justify-between">
              <span>{k}</span><span>{v}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between font-semibold py-2 border-t border-[#3a3939]">
          <span>Grand&nbsp;Total</span><span>{currency(totals.grandTotal)}</span>
        </div>

        {payment === 'card' ? (
          <button
            onClick={onConfirmPay}
            disabled={submittingCard}
            aria-busy={submittingCard}
            aria-disabled={submittingCard}
            className={`mt-2 w-full px-6 py-2 rounded transition-colors ${
              submittingCard ? 'bg-gray-600 cursor-not-allowed pointer-events-none' : 'bg-[#F58735] hover:bg-orange-600'
            }`}
          >
            {submittingCard ? (<><Spinner />Connecting to Stripe…</>) : 'Continue to Pay'}
          </button>
        ) : (
          <button
            onClick={onConfirmCash}
            disabled={submittingCash}
            aria-busy={submittingCash}
            aria-disabled={submittingCash}
            className={`mt-2 w-full px-6 py-2 rounded transition-colors ${
              submittingCash ? 'bg-gray-600 cursor-not-allowed pointer-events-none' : 'bg-[#F58735] hover:bg-orange-600'
            }`}
          >
            {submittingCash ? (<><Spinner />Placing order…</>) : 'Confirm Order'}
          </button>
        )}
      </aside>

      {/* main grid (Tray Summary + Items + Details) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10 max-w-5xl">
        {/* LEFT: Tray Summary + Items + Spice */}
        <div className="space-y-6">
          {/* Tray Summary */}
          {safeLines.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Tray Summary</h2>
              <div className="bg-[#232222] border border-[#3a3939] rounded p-4">
                <ul className="text-sm space-y-1">
                  {safeLines.map((ln, idx) => (
                    <li key={`ln-${idx}`} className="flex justify-between">
                      <span className="text-gray-200">
                        {ln.name}{ln.spiceLevel ? <span className="text-gray-400"> (Spice: {ln.spiceLevel})</span> : null}
                      </span>
                      <span className="text-gray-300">
                        {ln.size} × {ln.qty}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Items */}
          <section>
            <h2 className="text-xl font-semibold mb-3">Items</h2>
            <div className="bg-[#232222] border border-[#3a3939] rounded divide-y divide-[#3a3939]">
              {groupedByName.map((group, gi) => (
                <div key={gi} className="px-4 py-3">
                  <div className="font-medium">{group.name}</div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {group.lines.map((ln, li) => (
                      <li key={li} className="flex justify-between">
                        <span className="text-gray-200">
                          {ln.size} <span className="text-gray-400">× {ln.qty}</span>
                          {ln.spiceLevel ? <span className="text-gray-400"> • Spice: {ln.spiceLevel}</span> : null}
                        </span>
                        <span>${ln.unit.toFixed(2)} <span className="text-gray-400">each</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Spice Preferences (explicit list) */}
          {spiceSelections.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Spice Preferences</h2>
              <div className="bg-[#232222] border border-[#3a3939] rounded p-4">
                <ul className="text-sm space-y-1">
                  {spiceSelections.map((s, i) => (
                    <li key={`sp-${i}`} className="flex justify-between">
                      <span className="text-gray-200">{s.name}</span>
                      <span className="text-gray-300">{s.spiceLevel || 'Medium'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </div>

        {/* RIGHT: Order details */}
        <div>
          <section>
            <h2 className="text-xl font-semibold mb-3">Order details</h2>
            <div className="bg-[#232222] border border-[#3a3939] rounded p-4 text-sm space-y-3">
              {payloadCustomer?.name && <DetailRow label="Name">{payloadCustomer.name}</DetailRow>}
              {payloadCustomer?.email && <DetailRow label="Email">{payloadCustomer.email}</DetailRow>}
              <DetailRow label="Phone">{payloadCustomer?.phone || '—'}</DetailRow>
              <DetailRow label="Method">{payloadCustomer?.method === 'delivery' ? 'Delivery' : 'Pickup'}</DetailRow>
              <DetailRow label="When">{whenDisplay}</DetailRow>

              {payloadCustomer?.method === 'delivery' && payloadCustomer?.address ? (
                <>
                  <div className="border-top border-[#3a3939] pt-3" />
                  <DetailRow label="Deliver to">
                    <div className="space-y-0.5">
                      <div>{payloadCustomer.address.addr1}</div>
                      {payloadCustomer.address.addr2 ? <div>{payloadCustomer.address.addr2}</div> : null}
                      <div>{payloadCustomer.address.city}, {payloadCustomer.address.state} {payloadCustomer.address.zip}</div>
                    </div>
                  </DetailRow>
                </>
              ) : null}

              {(payloadCustomer?.raitaPapadPickle || payloadCustomer?.warmers || payloadCustomer?.utensils) && (
                <DetailRow label="Add-ons">
                  {[
                    payloadCustomer?.raitaPapadPickle ? 'Raita, Papad & Pickle' : null,
                    payloadCustomer?.warmers ? 'Warmer Setup & Serving Spoons' : null,
                    payloadCustomer?.utensils ? 'Disposable Plates, Utensils & Napkins' : null,
                  ].filter(Boolean).join(', ')}
                </DetailRow>
              )}

              {(customer?.refCode || customer?.discCode) && (
                <DetailRow label="Codes">
                  {[
                    customer?.refCode ? `Ref: ${customer.refCode}` : null,
                    customer?.discCode ? `Discount: ${customer.discCode}` : null
                  ].filter(Boolean).join(' | ')}
                </DetailRow>
              )}

              {payloadCustomer?.specialRequest && (
                <DetailRow label="Special request">
                  {payloadCustomer.specialRequest}
                </DetailRow>
              )}

              <div className="border-t border-[#3a3939] pt-3" />
              <DetailRow label="Payment">
                {payment === 'card' ? 'Credit/Debit Card (Stripe)' : 'Cash at pickup'}
              </DetailRow>
            </div>
          </section>
        </div>
      </div>

      {/* Mobile floating summary button */}
      <button
        onClick={() => setShowSummaryMobile(true)}
        className="md:hidden fixed bottom-4 right-4 z-40 bg-[#F58735] hover:bg-orange-600 text-black rounded-full shadow-lg px-4 py-3 text-sm"
      >
        Summary • {currency(totals.grandTotal)}
      </button>

      {/* Mobile Summary Drawer */}
      {showSummaryMobile && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowSummaryMobile(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[92%] max-w-sm bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto translate-x-0 transition-transform">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-[#F58735]">Summary</h2>
              <button
                onClick={() => setShowSummaryMobile(false)}
                className="text-gray-300 hover:text-white text-xl leading-none"
                aria-label="Close summary"
              >
                ×
              </button>
            </div>

            <ul className="space-y-1 text-sm mb-3">
              {summaryRows.map(([k, v]) => (
                <li key={`m-${k}`} className="flex justify-between">
                  <span>{k}</span><span>{v}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between font-semibold py-2 border-t border-[#3a3939]">
              <span>Grand&nbsp;Total</span><span>{currency(totals.grandTotal)}</span>
            </div>

            {payment === 'card' ? (
              <button
                onClick={() => { setShowSummaryMobile(false); onConfirmPay(); }}
                disabled={submittingCard}
                aria-busy={submittingCard}
                aria-disabled={submittingCard}
                className={`mt-2 w-full px-6 py-2 rounded transition-colors ${
                  submittingCard ? 'bg-gray-600 cursor-not-allowed pointer-events-none' : 'bg-[#F58735] hover:bg-orange-600'
                }`}
              >
                {submittingCard ? (<><Spinner />Connecting to Stripe…</>) : 'Continue to Pay'}
              </button>
            ) : (
              <button
                onClick={() => { setShowSummaryMobile(false); onConfirmCash(); }}
                disabled={submittingCash}
                aria-busy={submittingCash}
                aria-disabled={submittingCash}
                className={`mt-2 w-full px-6 py-2 rounded transition-colors ${
                  submittingCash ? 'bg-gray-600 cursor-not-allowed pointer-events-none' : 'bg-[#F58735] hover:bg-orange-600'
                }`}
              >
                {submittingCash ? (<><Spinner />Placing order…</>) : 'Confirm Order'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// OrdersUI.js — presentational pieces for the admin Orders page (table cells,
// the expandable detail row, and the per-card renderers). Extracted from
// Orders.js verbatim; behavior unchanged.
import React, { useEffect, useRef, useState } from 'react';
import {
  capitalizeFirst,
  parsePayment,
  getCanonicalStatus,
  formatAddress,
  currency,
  normalizeLineItem,
  parseAddOns,
  parseAgentReferenceCode,
  parseDiscountCode,
} from './ordersHelpers';

/* ===== Animated container for the expand row ===== */
export function AnimatedExpand({ open, colSpan, children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const measure = () => {
      const child = el.firstElementChild;
      setHeight(open ? (child?.scrollHeight || 0) : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, children]);

  return (
    <tr className="bg-[#1d1c1c]">
      <td colSpan={colSpan} className="px-4 py-0">
        <div
          ref={ref}
          style={{ maxHeight: height, opacity: open ? 1 : 0, transition: 'max-height 260ms ease, opacity 200ms ease' }}
          className="overflow-hidden"
        >
          <div className="py-4">{children}</div>
        </div>
      </td>
    </tr>
  );
}

/* ===== UI helpers ===== */
export function Th({ children, className = '' }) {
  return <th className={`px-3 py-2.5 border-b border-[#3a3636] text-left text-xs font-semibold uppercase tracking-wide ${className}`}>{children}</th>;
}
export function Td({ children, className = '' }) {
  return <td className={`px-3 align-middle ${className}`}>{children ?? ''}</td>;
}
export function DetailCard({ title, children }) {
  return (
    <div className="rounded-xl border border-[#3a3636] bg-[#2a2727] p-4">
      <div className="text-[#F58735] text-xs font-semibold uppercase tracking-wide mb-2">{title}</div>
      <div className="text-neutral-100 text-sm">{children}</div>
    </div>
  );
}

export function renderPaymentTail(p) {
  const obj = parsePayment(p);
  if (!obj || typeof obj !== 'object') return null;
  const parts = [];
  if (obj.brand) parts.push(capitalizeFirst(obj.brand));
  if (obj.last4) parts.push(`•••• ${obj.last4}`);
  if (obj.status) parts.push(capitalizeFirst(obj.status));
  return parts.length ? <span className="text-neutral-300 ml-1 text-xs">({parts.join(' ')})</span> : null;
}

export function renderPaymentCard(o, paid, onMarkPaid, doUpdateStatus) {
  const pm = capitalizeFirst(o.paymentMethod || parsePayment(o.payment)?.method || '');
  const status = getCanonicalStatus(o, paid);

  return (
    <div className="space-y-3">
      {/* Payment method */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-neutral-300">Method:</span>
        <span className="font-medium">{pm || '-'}</span>
        {renderPaymentTail(o.payment)}
      </div>

      {/* Current status badge */}
      <div className="flex flex-wrap gap-2">
        {renderStatusBadge(status)}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {!paid && (pm.toLowerCase() === 'cash') && (
          <button
            onClick={(e) => { e.stopPropagation(); onMarkPaid(); }}
            className="px-3 py-1.5 rounded-lg font-medium transition-colors bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
          >
            Mark Paid
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); doUpdateStatus(o, 'pending'); }}
          className="px-3 py-1.5 rounded-lg font-medium transition-colors bg-amber-600 hover:bg-amber-500 text-white text-sm"
        >
          Pending
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); doUpdateStatus(o, 'refunded'); }}
          className="px-3 py-1.5 rounded-lg font-medium transition-colors bg-blue-600 hover:bg-blue-500 text-white text-sm"
        >
          Refunded
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); doUpdateStatus(o, 'cancelled'); }}
          className="px-3 py-1.5 rounded-lg font-medium transition-colors bg-red-600 hover:bg-red-500 text-white text-sm"
        >
          Cancelled
        </button>
      </div>
    </div>
  );
}

/* ===== Contact / Accounting renderers ===== */
export function renderContact(o) {
  return (
    <div className="space-y-1">
      <div>Name: <span className="font-medium">{o.customerName || '-'}</span></div>
      <div>Email: <span className="font-medium break-all">{o.customerEmail || '-'}</span></div>
      <div>Phone: <span className="font-medium">{o.phone || '-'}</span></div>
      <div>Address: <span className="font-medium">{formatAddress(o.address) || '-'}</span></div>
      {o.specialRequest ? (
        <div className="mt-2">
          Special Request: <span className="font-medium">{o.specialRequest}</span>
        </div>
      ) : null}
      {Array.isArray(o.spiceSelections) && o.spiceSelections.length ? (
        <div className="mt-2">
          <div className="text-neutral-300">Spice Preferences:</div>
          <ul className="list-disc ml-5">
            {o.spiceSelections.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.name}</span>
                {s.size ? <span className="text-neutral-300"> ({s.size})</span> : null}
                <span className="text-neutral-300"> — {s.spiceLevel || 'Medium'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
export function renderAccounting(o) {
  const salesTaxPct = Number.isFinite(o.salesTaxRate) && o.salesTaxRate > 0 ? ` (${(o.salesTaxRate * 100).toFixed(2)}%)` : '';
  const method = capitalizeFirst(o.method || o.type || '');
  return (
    <div className="space-y-2">
      <Row label="Method" value={method} />
      <Row label="Cart Total" value={currency(o.cartTotal)} />
      <Row label="Add-on Fee" value={currency(o.addOnFee)} />
      <Row label="Delivery Fee" value={currency(o.deliveryFee)} />
      <Row label="Discount" value={currency(o.discount)} />
      <Row label="Subtotal" value={currency(o.subtotal)} />
      <Row label={`Tax${salesTaxPct}`} value={currency(o.tax)} />
      <div className="border-t border-[#3a3636] pt-2 flex items-center justify-between">
        <div className="text-sm">Grand Total</div>
        <div className="text-base font-semibold">{currency(o.grandTotal)}</div>
      </div>
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="text-neutral-300">{label}</div>
      <div className="text-neutral-100">{value ?? '-'}</div>
    </div>
  );
}

/* ===== Lines / addOns / codes renderers ===== */
export function renderLines(lines) {
  if (!lines) return <div>-</div>;
  let arr = lines;
  if (!Array.isArray(arr)) {
    try {
      const parsed = JSON.parse(lines);
      if (Array.isArray(parsed)) arr = parsed;
      else return <div>{String(lines).replace(/"/g, '')}</div>;
    } catch {
      return <div>{String(lines).replace(/"/g, '')}</div>;
    }
  }
  if (!arr.length) return <div>-</div>;
  const norm = arr.map(normalizeLineItem);
  return (
    <div className="space-y-3">
      {norm.map((ln, idx) => (
        <div key={idx} className="border border-[#3a3636] rounded-md p-2">
          <div className="text-base font-semibold">
            {ln.itemName || 'Item'}
            {ln.spiceLevel ? (
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full border border-[#F58735]/60 text-[#F58735] align-middle">
                Spice: {ln.spiceLevel}
              </span>
            ) : null}
          </div>
          {(ln.size || ln.qty || ln.qty === 0) && (
            <div className="text-xs text-neutral-300 mt-1">
              {!/^\s*package\s*$/i.test(ln.size) && ln.size ? <span>Tray Size: {ln.size}</span> : null}
              {!/^\s*package\s*$/i.test(ln.size) && (ln.qty || ln.qty === 0) ? <span> • </span> : null}
              {!/package/i.test(ln.size) && (ln.qty || ln.qty === 0) ? <span>Qty: {ln.qty}</span> : null}
            </div>
          )}

          {!!ln.children?.length && (
            <div className="mt-2 pl-3 border-l border-[#3a3636] space-y-1">
              {ln.children.map((c, ci) => (
                <div key={ci} className="text-sm">
                  • <span className="font-medium">{c.itemName}</span>
                  {c.size ? <span className="text-neutral-300"> — {c.size}</span> : null}
                  {c.qty || c.qty === 0 ? <span className="text-neutral-300"> × {c.qty}</span> : null}
                  {c.spiceLevel ? <span className="text-neutral-300"> • Spice: {c.spiceLevel}</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function renderAddOns(addOns) {
  const { raitaLabel, warmersLabel, utensilsLabel } = parseAddOns(addOns);
  return (
    <div className="space-y-1">
      <div>Raita, Papad & Pickle: <span className="font-medium">{raitaLabel}</span></div>
      <div>Warmers & Serving Spoons: <span className="font-medium">{warmersLabel}</span></div>
      <div>Plates, Utensils & Napkins: <span className="font-medium">{utensilsLabel}</span></div>
    </div>
  );
}

export function renderCodes(codes) {
  const agent = parseAgentReferenceCode(codes);
  const discount = parseDiscountCode(codes);
  return (
    <div className="space-y-1">
      <div>Agent Reference Code: <span className="font-medium">{agent || '-'}</span></div>
      <div>Discount Code: <span className="font-medium">{discount || '-'}</span></div>
    </div>
  );
}

export function renderStatusBadge(status) {
  const s = String(status || '').toLowerCase();
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-xs border';
  if (s === 'paid') {
    return <span className={`${base} bg-emerald-700/30 text-emerald-300 border-emerald-700/60`}>Paid</span>;
  }
  if (s === 'pending') {
    return <span className={`${base} bg-amber-700/30 text-amber-300 border-amber-700/60`}>Pending</span>;
  }
  if (s === 'refunded') {
    return <span className={`${base} bg-blue-700/30 text-blue-300 border-blue-700/60`}>Refunded</span>;
  }
  if (s === 'cancelled') {
    return <span className={`${base} bg-red-700/30 text-red-300 border-red-700/60`}>Cancelled</span>;
  }
  // default
  return <span className={`${base} bg-neutral-700/30 text-neutral-300 border-neutral-700/60`}>{s || '-'}</span>;
}

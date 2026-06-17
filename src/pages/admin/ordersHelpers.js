// ordersHelpers.js — pure formatting, parsing, and order-shaping helpers for the
// admin Orders page. No React/JSX here (UI render helpers live in OrdersUI.js).
// Extracted from Orders.js verbatim; behavior unchanged.

/* ===== Date / number / string formatting ===== */
export function parseMaybeDate(v) {
  if (!v) return null;
  if (typeof v === 'number') return v; // epoch ms
  const d = new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}
export function formatDateTime(v) {
  const t = parseMaybeDate(v);
  if (!t) return '';
  return new Date(t).toLocaleString();
}
// Like formatDateTime, but leads with the DAY OF WEEK for kitchen tickets (e.g. "FRIDAY — Jun 20, 2026, 1:00 PM").
export function formatDateTimeWithDay(v) {
  const t = parseMaybeDate(v);
  if (!t) return '';
  const d = new Date(t);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase();
  const rest = d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `${weekday} — ${rest}`;
}
// Splits the kitchen day label into { day, rest } so the PDF can render the
// weekday large on its own line (day="FRIDAY", rest="Jun 20, 2026, 1:00 PM").
export function splitDayLabel(v) {
  const label = formatDateTimeWithDay(v);
  if (!label) return { day: '', rest: '' };
  const idx = label.indexOf(' — ');
  if (idx === -1) return { day: label, rest: '' };
  return { day: label.slice(0, idx), rest: label.slice(idx + 3) };
}
export function currency(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}
export function stringifyPaymentForCell(p) {
  const obj = parsePayment(p);
  if (!obj) return '';

  const method = obj.method ? capitalizeFirst(obj.method) : '';
  const brand  = obj.brand ? capitalizeFirst(obj.brand) : '';
  const last4  = obj.last4 ? `•••• ${obj.last4}` : '';
  const status = obj.status ? capitalizeFirst(obj.status) : '';

  const left = [method, brand, last4].filter(Boolean).join(' ').trim();
  return status ? `${left || method || ''} (${status})` : (left || method || '');
}

export function formatAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'object') {
    const { line1, addr1, street, line2, addr2, city, state, zip, postalCode } = addr;
    const parts = [
      line1 || addr1 || street,
      line2 || addr2,
      city,
      [state, zip || postalCode].filter(Boolean).join(' ')
    ].filter(Boolean);
    return parts.join(', ');
  }
  try {
    const asObj = JSON.parse(addr);
    if (asObj && typeof asObj === 'object') return formatAddress(asObj);
  } catch {}
  return String(addr).replace(/"/g, '').replace(/\s+/g, ' ').trim();
}
export function toExportAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'object') return formatAddress(addr);
  try {
    const asObj = JSON.parse(addr);
    if (asObj && typeof asObj === 'object') return formatAddress(asObj);
  } catch {}
  return String(addr).replace(/"/g,'').replace(/\s+/g,' ').trim();
}
export function toExportJSON(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}
export function toFixedNumber(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num : '';
}
export function capitalizeFirst(s) {
  const str = (s || '').toString();
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/* ===== Case-insensitive key access ===== */
export function getAny(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (k in obj) return obj[k];
  }
  const lower = Object.fromEntries(Object.keys(obj).map(k => [k.toLowerCase(), obj[k]]));
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v !== undefined) return v;
  }
  return undefined;
}
export function toLowerSafely(v) {
  return (v == null) ? '' : String(v).trim().toLowerCase();
}

/* ===== Payment parsing ===== */
export function parsePayment(p) {
  if (!p) return null;
  if (typeof p === 'object') return p;

  if (typeof p === 'string') {
    const s = p.trim();
    // Try JSON first
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === 'object') return obj;
    } catch {}

    // Parse plain string like "cash" or "card visa ••••1234 paid"
    const lower = s.toLowerCase();

    const out = { raw: s };

    // method
    if (/\bcash\b/.test(lower)) out.method = 'cash';
    else if (/\bcard\b/.test(lower)) out.method = 'card';

    // status
    if (/\b(paid|succeed(?:ed)?|captured|approved)\b/.test(lower)) out.status = 'succeeded';
    else if (/\b(pending|unpaid)\b/.test(lower)) out.status = 'pending';

    // brand
    const brandMatch = lower.match(/\b(visa|mastercard|amex|american express|discover|diners|jcb)\b/);
    if (brandMatch) {
      out.brand = brandMatch[1] === 'american express' ? 'amex' : brandMatch[1];
    }

    // last4 (•••• 1234 / **** 1234 / XX 1234)
    const last4Match = s.match(/(?:•|•|\*|X){2,}\s?(\d{4})\b/i);
    if (last4Match) out.last4 = last4Match[1];

    // If it's exactly "cash" or "card", set method explicitly even if above missed
    if (!out.method && (lower === 'cash' || lower === 'card')) out.method = lower;

    return out;
  }

  return { raw: String(p) };
}

/* ===== Lines / addOns / codes parsing ===== */
export function normalizeLineItem(raw) {
  const PACKAGE_RE = /^(.*?)\s*(?:—|–|-)\s*\[(.*)\]\s*$/; // robust: em/en/hyphen dashes

  // A) If the raw line is a plain string
  if (typeof raw === 'string') {
    const m = raw.match(PACKAGE_RE);
    if (m) {
      const parent = safe(m[1]);
      const itemsStr = m[2] || '';
      const children = itemsStr
        .split(/\s*,\s*/)
        .filter(Boolean)
        .map(parseChildDetailFromString);
      return { itemName: parent, size: '', qty: '', children };
    }
    return { itemName: safe(raw), size: '', qty: '' };
  }

  // B) Non-object fallback
  if (!raw || typeof raw !== 'object') {
    return { itemName: safe(raw), size: '', qty: '' };
  }

  // C) Object line
  const itemNameRaw = safe(raw.name || raw.item || raw.title || raw.packageName || '');
  const size = safe(raw.size || raw.tray || raw.traySize || raw.option || '');
  const qty  = raw.qty ?? raw.quantity ?? raw.count ?? '';
  const spiceLevel = normalizeSpice(raw.SpiceLevel || raw.spiceLevel || raw.spice);

  let children = [];

  // C1) If the object's name contains the "Package — [ ... ]" pattern, parse it
  const m = itemNameRaw.match(PACKAGE_RE);
  let itemName = itemNameRaw;
  if (m) {
    itemName = safe(m[1]);
    const itemsStr = m[2] || '';
    children = children.concat(
      itemsStr
        .split(/\s*,\s*/)
        .filter(Boolean)
        .map(parseChildDetailFromString)
    );
  }

  // C2) Also support structured child arrays on the object
  const mapChild = (t) => {
    if (typeof t === 'string') return parseChildDetailFromString(t);
    return {
      itemName: safe(t.name || t.item || t.title || ''),
      size:     safe(t.size || t.tray || t.traySize || t.option || ''),
      qty:      t.qty ?? t.quantity ?? t.count ?? '',
      spiceLevel: normalizeSpice(t.SpiceLevel || t.spiceLevel || t.spice),
    };
  };

  if (Array.isArray(raw.trays))      children = children.concat(raw.trays.map(mapChild));
  if (Array.isArray(raw.items))      children = children.concat(raw.items.map(mapChild));
  if (Array.isArray(raw.components)) children = children.concat(raw.components.map(mapChild));

  return { itemName, size, qty, spiceLevel, children };
}

// Parse strings like "Mix Pakora — SmallTray × 1" or "Puri — per-piece × 15"
export function parseChildDetailFromString(s) {
  const str = safe(s);
  const m = str.match(/^(.*?)\s*(?:—|–|-)\s*(.*)$/);
  const itemName = safe(m ? m[1] : str);
  const right    = m ? m[2] : '';
  if (!right) return { itemName, size: '', qty: '' };

  const qtyMatch = right.match(/(?:×|x)\s*(\d+)\s*$/i);
  const qty = qtyMatch ? Number(qtyMatch[1]) : '';
  const size = safe(right.replace(/\s*(?:×|x)\s*\d+\s*$/i, ''));
  return { itemName, size, qty };
}

/* Build rows for Items table in PDF */
export function buildLinesRows(lines) {
  if (!lines) return [];
  let arr = lines;
  if (!Array.isArray(arr)) {
    try {
      const parsed = JSON.parse(lines);
      if (Array.isArray(parsed)) arr = parsed;
      else return [[String(lines).replace(/"/g, ''), '', '']];
    } catch {
      return [[String(lines).replace(/"/g, ''), '', '']];
    }
  }
  const rows = [];
  const pushRow = (name, size, qty) => rows.push([safe(name || 'Item'), safe(size || ''), String(qty ?? '')]);
  arr.forEach((ln) => {
    const n = normalizeLineItem(ln);
    pushRow(n.itemName, n.size, n.qty);
    if (Array.isArray(n.children) && n.children.length) {
      n.children.forEach((c) => pushRow(`— ${c.itemName}`, c.size, c.qty));
    }
  });
  return rows;
}

export function parseAddOns(addOns) {
  let warmers = null;
  let utensils = null;
  let raita = null;

  const coerceBool = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return /^(true|yes|y|1)$/i.test(v.trim());
    return null;
  };

  if (addOns == null) {
    return {
      raitaLabel: '-',
      warmersLabel: '-',
      utensilsLabel: '-',
    };
  }

  try {
    if (typeof addOns === 'string') {
      const parsed = JSON.parse(addOns);
      if (parsed && typeof parsed === 'object') addOns = parsed;
    }
  } catch {}

  if (typeof addOns === 'object' && addOns) {
    raita   = coerceBool(addOns.raitaPapadPickle ?? addOns.raita ?? addOns.raitaPapad ?? addOns.condiments);
    warmers = coerceBool(addOns.warmers ?? addOns.Warmers);
    utensils= coerceBool(addOns.utensils ?? addOns.Utensils ?? addOns.cutlery);
  }

  return {
    raitaLabel:   raita   == null ? '-' : (raita   ? 'Yes' : 'No'),
    warmersLabel: warmers == null ? '-' : (warmers ? 'Yes' : 'No'),
    utensilsLabel:utensils== null ? '-' : (utensils? 'Yes' : 'No'),
  };
}

export function parseAgentReferenceCode(codes) {
  const clean = (v) => (v == null ? '' : String(v).replace(/"/g, '').trim());
  const extract = (obj) =>
    clean(
      obj.agentRef ??
      obj.agentReferenceCode ??
      obj.reference ??
      obj.code ??
      obj.refCode ??
      ''
    );
  if (!codes) return '';
  if (typeof codes === 'string') {
    try {
      const obj = JSON.parse(codes);
      if (obj && typeof obj === 'object') return extract(obj);
      return clean(codes);
    } catch { return clean(codes); }
  }
  if (Array.isArray(codes)) {
    for (const c of codes) {
      if (!c) continue;
      if (typeof c === 'string') {
        try {
          const obj = JSON.parse(c);
          if (obj && typeof obj === 'object') {
            const v = extract(obj);
            if (v) return v;
          } else if (c.trim()) {
            return clean(c);
          }
        } catch { if (c.trim()) return clean(c); }
      } else if (typeof c === 'object') {
        const v = extract(c);
        if (v) return v;
      }
    }
    return '';
  }
  if (typeof codes === 'object') return extract(codes);
  return clean(codes);
}
export function parseDiscountCode(codes) {
  const clean = (v) => (v == null ? '' : String(v).replace(/"/g, '').trim());
  const extract = (obj) =>
    clean(
      obj.discountCode ??
      obj.discount ??
      obj.coupon ??
      obj.promo ??
      obj.promoCode ??
      obj.discCode ??
      ''
    );
  if (!codes) return '';
  if (typeof codes === 'string') {
    try {
      const obj = JSON.parse(codes);
      if (obj && typeof obj === 'object') return extract(obj);
      const m = codes.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
      return m ? clean(m[3]) : '';
    } catch {
      const m = codes.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
      return m ? clean(m[3]) : '';
    }
  }
  if (Array.isArray(codes)) {
    for (const c of codes) {
      if (!c) continue;
      if (typeof c === 'string') {
        try {
          const obj = JSON.parse(c);
          if (obj && typeof obj === 'object') {
            const v = extract(obj);
            if (v) return v;
          } else {
            const m = c.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
            if (m) return clean(m[3]);
          }
        } catch {
          const m = c.match(/(discount|coupon|promo( ?code)?)\W*([\w-]+)/i);
          if (m) return clean(m[3]);
        }
      } else if (typeof c === 'object') {
        const v = extract(c);
        if (v) return v;
      }
    }
    return '';
  }
  if (typeof codes === 'object') return extract(codes);
  return '';
}

/* ===== Misc helpers ===== */
export function safe(s) { return (s == null) ? '' : String(s).replace(/"/g, '').trim(); }
export function mergePayment(oldP, patch) {
  const base = parsePayment(oldP) || {};
  return { ...base, ...patch };
}

/* ===== Spice & Notes helpers ===== */
export function normalizeSpice(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return undefined;
  if (s.startsWith('mild')) return 'Mild';
  if (s.startsWith('spic')) return 'Spicy';
  return 'Medium';
}
export function parseJSONMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v !== 'string') return null;
  try { return JSON.parse(v); } catch { return null; }
}
export function coerceSpiceSelections(any) {
  const raw = parseJSONMaybe(any) ?? any;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((s) => ({
        name: safe(s?.name ?? s?.item ?? s?.title ?? ''),
        size: safe(s?.size ?? s?.tray ?? s?.traySize ?? ''),
        qty:  Number(s?.qty ?? s?.quantity ?? s?.count ?? 0) || undefined,
        spiceLevel: normalizeSpice(s?.spiceLevel ?? s?.SpiceLevel ?? s?.spice),
      }))
      .filter((s) => s.name && s.spiceLevel);
  }
  return [];
}

/* ===== Paid inference ===== */
export function inferPaidFromStatus(o, optimistic) {
  if (optimistic === true) return true;
  const ps = toLowerSafely(o.paymentStatus);
  if (ps === 'paid') return true;
  if (ps === 'pending') return false;
  return inferPaid(o, optimistic);
}
export function inferPaid(o, optimistic) {
  if (optimistic === true) return true;
  const p = parsePayment(o.payment);
  if (!p) return false;
  if (typeof p === 'object') {
    if (p.markedPaid) return true;
    if (/^(succeeded|paid|captured)$/i.test(String(p.status || ''))) return true;
    if (String(p.method || '').toLowerCase() === 'cash') return false;
  } else if (typeof p === 'string') {
    return /paid|succeed|success|approved/i.test(p);
  }
  return false;
}

/* ===== Canonical payment status ===== */
export function getCanonicalStatus(o, optimistic) {
  // If we just optimistically marked as paid
  if (optimistic === true) return 'paid';

  const raw = toLowerSafely(o.paymentStatus);
  if (raw === 'paid' || raw === 'pending' || raw === 'refunded' || raw === 'cancelled') {
    return raw;
  }
  // Fallback to inference for legacy rows
  return inferPaid(o, optimistic) ? 'paid' : 'pending';
}

/* ===== Normalizer (add specialRequest + spiceSelections) ===== */
export function normalizeOrder(it = {}) {
  const cartTotal = asNum(it.cartTotal);
  const deliveryFee = asNum(it.deliveryFee);
  const addOnFee = asNum(it.addOnFee);
  const discount = asNum(it.discount);
  const subtotal = Number.isFinite(it.subtotal) ? asNum(it.subtotal) : (cartTotal + deliveryFee + addOnFee - discount);
  const tax = asNum(it.tax);
  const salesTaxRate = asNum(it.salesTaxRate);

  const phone = getAny(it, ['phone', 'Phone', 'customerPhone', 'contactPhone']) || '';

  // Payment parsing first
  const paymentParsed = parsePayment(it.payment);

  // paymentStatus (many styles); if missing, infer from parsed payment
  const rawPaymentStatus = getAny(it, ['paymentStatus','payment_status','PaymentStatus']) || '';
  let paymentStatus = toLowerSafely(rawPaymentStatus);
  if (!paymentStatus) {
    const inferred = toLowerSafely(paymentParsed?.status);
    if (inferred) paymentStatus = (inferred === 'succeeded') ? 'paid' : inferred;
  }

  // paymentMethod; if missing, fall back to parsed payment or raw string
  const rawPaymentMethod = getAny(it, ['paymentMethod','payment_method','PaymentMethod']) || '';
  let paymentMethod = toLowerSafely(rawPaymentMethod);
  if (!paymentMethod) {
    paymentMethod = toLowerSafely(paymentParsed?.method || (typeof it.payment === 'string' ? it.payment : ''));
  }

  // Prefer top-level special request if present; otherwise from nested customer object
  const topLevelSpecial = safe(
    getAny(it, [
      'specialRequest','special_request','special','notes','note','comment','comments','specialInstructions','specialInstruction'
    ]) || ''
  );

  let customerObj = getAny(it, ['customer','Customer']) ?? null;
  customerObj = parseJSONMaybe(customerObj) ?? customerObj ?? {};
  const nestedSpecial =
    safe(
      getAny(customerObj, [
        'specialRequest','special_request','special','notes','note','comment','comments','specialInstructions','specialInstruction'
      ]) || ''
    );

      // Allow a top-level fallback too (some legacy payloads store it flat)
  const specialRequest =
    nestedSpecial ||
    safe(
      getAny(it, [
        'specialRequest','special_request','special',
        'notes','note','comment','comments',
        'specialInstructions','specialInstruction'
      ]) || ''
    );

  // ---- Spice selections: prefer explicit field; else derive from lines ----
  let spiceSelections = coerceSpiceSelections(getAny(it, ['spiceSelections','SpiceSelections']));
  if (!spiceSelections.length) {
    const rawLines = parseJSONMaybe(it.lines) ?? it.lines;
    if (Array.isArray(rawLines)) {
      const derived = rawLines
        .map((l) => ({
          name: safe(l?.name || l?.item || l?.title || ''),
          size: safe(l?.size || l?.tray || l?.traySize || ''),
          spiceLevel: normalizeSpice(l?.spiceLevel || l?.SpiceLevel || l?.spice),
          qty: Number(l?.qty ?? l?.quantity ?? l?.count ?? 0) || undefined,
        }))
        .filter((x) => x.name && x.spiceLevel);
      if (derived.length) spiceSelections = derived;
    }
  }

  return {
    orderId: String(it.orderId ?? ''),
    addOnFee,
    addOns: it.addOns ?? null,
    address: it.address ?? '',
    cartTotal,
    codes: it.codes ?? null,
    customerEmail: it.customerEmail ?? '',
    customerName: it.customerName ?? '',
    phone,
    deliveryFee,
    discount,
    subtotal,
    tax,
    salesTaxRate,
    grandTotal: asNum(it.grandTotal),
    lines: it.lines ?? null,
    method: it.method ?? '',
    type: it.type ?? '',
    when: it.when ?? '',
    placedAt: it.placedAt ?? '',

    paymentStatus,
    paymentMethod,
    payment: paymentParsed ?? it.payment ?? null,
    paidAt: it.paidAt ?? null,
    amountCents: asNum(it.amountCents),
    currency: it.currency ?? 'usd',
    stripeSessionId: it.stripeSessionId ?? '',
    stripePaymentIntentId: it.stripePaymentIntentId ?? '',
    stripeChargeId: it.stripeChargeId ?? '',

    // NEW: ensure these are always present on the normalized shape
    specialRequest,
    spiceSelections,
  };
}

export function asNum(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- PDF helper for "Spice & Notes" ---------- */
export function buildSpiceAndNotesRows(o) {
  const rows = [];
  if (o.specialRequest) rows.push(['Special Request', o.specialRequest]);

  if (Array.isArray(o.spiceSelections) && o.spiceSelections.length) {
    o.spiceSelections.forEach((s) => {
      const left = `Spice — ${safe(s.name)}${s.size ? ` (${safe(s.size)})` : ''}`;
      rows.push([left, s.spiceLevel || 'Medium']);
    });
  }
  return rows;
}

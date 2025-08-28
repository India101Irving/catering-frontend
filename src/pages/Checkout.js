// Checkout.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getCurrentUser,
  fetchUserAttributes,
  updateUserAttributes,
  sendUserAttributeVerificationCode,
  confirmUserAttribute,
  signOut,
  fetchAuthSession,
} from 'aws-amplify/auth';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

/* =================== Config =================== */
const REQUIRE_PHONE_VERIFICATION = false; // turn on later if needed
const ORIGIN_ADDR = '3311 Regent Blvd, Irving TX 75063';

/** 🔧 Feature flag: toggle Cash payments on/off */
const ALLOW_CASH = false;

const REGION = 'us-east-2';
const HOURS_TABLE = 'catering-hours-dev';
const HOURS_PK = 'HOURS';

const GOOGLE_MAPS_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_MAPS_API_KEY) ||
  process.env.REACT_APP_GOOGLE_MAPS_API_KEY ||
  '';

/* lead time & window */
const LEAD_TIME_MIN = 18 * 60;     // 18 hours
const MAX_DAYS_AHEAD = 90;

/* =================== Utilities =================== */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toE164US = (raw) => {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.startsWith('+')) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return s;
};
const pad2 = (n) => String(n).padStart(2, '0');
const toDateISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

/* Helpers to inspect cart items */
const getItemSize = (it) => String(it?.size ?? it?.tray ?? it?.Tray ?? it?.variant ?? '').toLowerCase();
const isPackageSize = (sz) => {
  const s = String(sz || '').toLowerCase();
  return s === 'package' || s === 'packages' || s === 'party package';
};

/* =================== Hours helpers =================== */
async function getDocClient() {
  const { credentials } = await fetchAuthSession();
  const base = new DynamoDBClient({ region: REGION, credentials });
  return DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
}
async function loadHours() {
  try {
    const doc = await getDocClient();
    const res = await doc.send(new GetCommand({ TableName: HOURS_TABLE, Key: { PK: HOURS_PK } }));
    return {
      pickupHours: res?.Item?.pickupHours || {},
      deliveryHours: res?.Item?.deliveryHours || {},
    };
  } catch {
    return { pickupHours: {}, deliveryHours: {} };
  }
}
function buildSlotsForDate(hoursMap, dateISO, intervalMin = 30) {
  if (!dateISO) return [];
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const d = new Date(`${dateISO}T00:00:00`);
  const dow = DAYS[d.getDay()];
  const cfg = hoursMap?.[dow];
  if (!cfg || cfg.closed) return [];

  const windows = [
    [cfg.open1, cfg.close1],
    [cfg.open2, cfg.close2],
  ].filter(([o,c]) => o && c);

  const out = [];
  for (const [o,c] of windows) {
    const start = toMins(o), end = toMins(c);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    let t = start;
    t = ceilToInterval(t, intervalMin);
    while (t < end) {
      out.push({ mins: t, label: minToLabel(t) });
      t += intervalMin;
    }
  }
  return out;
}
function toMins(hhmm) { const [h,m] = String(hhmm).split(':').map(Number); return h*60+m; }
function ceilToInterval(mins, step) { return Math.ceil(mins/step)*step; }
function minToLabel(mins) {
  let h = Math.floor(mins/60), m = mins % 60, am = h < 12;
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2,'0')} ${am ? 'AM' : 'PM'}`;
}

/* ====== Filter slots by the global earliest allowed time (now + 18h) ====== */
function filterSlotsByEarliest(dateISO, slots, earliestMs) {
  const base = new Date(`${dateISO}T00:00:00`);
  const out = [];
  for (const s of slots) {
    const slotDt = new Date(base);
    slotDt.setMinutes(s.mins || 0, 0, 0);
    if (slotDt.getTime() >= earliestMs) out.push(s);
  }
  return out;
}

// read a draft from sessionStorage (first) or a prior full checkout (second)
const readCheckoutDraft = () => {
  try {
    return (
      JSON.parse(sessionStorage.getItem('i101_checkout_draft')) ||
      JSON.parse(sessionStorage.getItem('i101_checkout')) ||
      null
    );
  } catch {
    return null;
  }
};

function parseTimeLabelToHM(label) {
  // "h:mm AM/PM" -> { h:0-23, m:0-59 }
  const m = String(label).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
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

/* =================== Google Maps JS SDK =================== */
function loadGoogleMaps(key) {
  return new Promise((resolve, reject) => {
    if (!key) return reject(new Error('No Google Maps key'));
    if (window.google?.maps) return resolve(window.google);

    // Remove any prior script to avoid caching a bad weekly build
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) existing.remove();

    // Pin to stable channel to avoid p.zI regression
    const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=quarterly`;
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('Failed to load Google Maps JS SDK'));
    s.onload = () => resolve(window.google);
    document.head.appendChild(s);
  });
}
function distMatrixMiles(google, origin, destination) {
  return new Promise((resolve) => {
    try {
      const svc = new google.maps.DistanceMatrixService();
      svc.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: google.maps.TravelMode.DRIVING,
          unitSystem: google.maps.UnitSystem.IMPERIAL,
        },
        (resp, status) => {
          if (status !== 'OK') return resolve(null);
          const valMeters = resp?.rows?.[0]?.elements?.[0]?.distance?.value;
          if (!valMeters) return resolve(null);
          const miles = valMeters / 1609.344;
          resolve(round2(miles));
        }
      );
    } catch {
      resolve(null);
    }
  });
}

/* =================== Component =================== */
export default function Checkout() {
  const nav       = useNavigate();
  const { state } = useLocation();

  /* user for header + prefill */
  const [currentUser, setCurrentUser] = useState(null);
  useEffect(() => { getCurrentUser().then(setCurrentUser).catch(() => {}); }, []);

  // Prefill from Cognito attributes
  const [custName,  setCustName]  = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [phone,     setPhone]     = useState('');
  const [phoneVerified, setPhoneVerified] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        const attrs = await fetchUserAttributes();
        const email = attrs?.email || '';
        const gn = attrs?.given_name || '';
        const fn = attrs?.family_name || '';
        const fullFromAttrs = (attrs?.name || `${gn} ${fn}`.trim()).trim();
        const username = currentUser?.username || currentUser?.signInDetails?.loginId || '';
        setCustEmail(prev => prev || email);
        setCustName(prev => prev || (fullFromAttrs || username));
        if (attrs?.phone_number) setPhone(attrs.phone_number);
        const verified = (attrs?.phone_number_verified === true) || (String(attrs?.phone_number_verified).toLowerCase() === 'true');
        setPhoneVerified(verified);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.username]);

  /* cart */
  const readStoredCart = () => {
    try { const data = JSON.parse(localStorage.getItem('i101_cart')); return Array.isArray(data) ? data : []; }
    catch { return []; }
  };
  const cart = state?.cart ?? readStoredCart();
  const cartTotal = useMemo(
    () => state?.cartTotal ?? cart.reduce((s, c) => s + (Number(c.qty ?? c.quantity ?? 1) * Number(c.unit ?? c.price ?? c.UnitPrice ?? 0)), 0),
    [state, cart]
  );

  /* no cart -> home */
  useEffect(() => { if (cart.length === 0) nav('/', { replace: true }); }, [cart.length, nav]);

  /* ---- DRAFT RESTORE ---- */
  const draft = readCheckoutDraft();

  /* form state */
  const saved = (() => { try { return JSON.parse(localStorage.getItem('i101_customer')) || null; } catch { return null; }})();
  // ✅ Payment uses feature-flag. If cash was in draft but disabled now, force to 'card'.
  const [payment,  setPayment]  = useState(() => {
    const p = draft?.payment ?? 'card';
    return ALLOW_CASH ? p : 'card';
  });
  // If flag flips at runtime or old draft tries to set cash when disabled
  useEffect(() => {
    if (!ALLOW_CASH && payment === 'cash') setPayment('card');
  }, [payment]);

  const [method,   setMethod]   = useState(draft?.customer?.method ?? 'pickup');

  // address (for delivery)
  const [addr1, setAddr1] = useState(draft?.customer?.address?.addr1 ?? saved?.address?.addr1 ?? '');
  const [addr2, setAddr2] = useState(draft?.customer?.address?.addr2 ?? saved?.address?.addr2 ?? '');
  const [city,  setCity]  = useState(draft?.customer?.address?.city  ?? saved?.address?.city  ?? '');
  const [st,    setSt]    = useState(draft?.customer?.address?.state ?? saved?.address?.state ?? '');
  const [zip,   setZip]   = useState(draft?.customer?.address?.zip   ?? saved?.address?.zip   ?? '');

  // scheduling
  const [pickupDate, setPickupDate] = useState(draft?.customer?.pickupDate ?? '');
  const [pickupTime, setPickupTime] = useState(draft?.customer?.pickupTime ?? '');
  const [slots, setSlots] = useState([]);
  const [hours, setHours] = useState({ pickupHours: {}, deliveryHours: {} });

  // add-ons & codes (sidebar)
  const [warmers,  setWarmers]  = useState(!!draft?.customer?.warmers);
  const [utensils, setUtensils] = useState(!!draft?.customer?.utensils);
  const [refCode,  setRefCode]  = useState(draft?.customer?.refCode ?? '');
  const [discCode, setDiscCode] = useState(draft?.customer?.discCode ?? ''); // default

  // NEW: special request comment (sidebar + mobile summary)
  const [specialRequest, setSpecialRequest] = useState(draft?.customer?.specialRequest ?? '');

  const [saveDetails, setSaveDetails] = useState(!!saved);

  /* --- lead time & date window --- */
  const earliestAllowed = useMemo(() => new Date(Date.now() + LEAD_TIME_MIN * 60 * 1000), []);
  const minDateISO = useMemo(() => toDateISO(earliestAllowed), [earliestAllowed]);
  const maxDateISO = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + MAX_DAYS_AHEAD);
    return toDateISO(d);
  }, []);

  // keep selected date within min/max if user had something outside
  useEffect(() => {
    if (!pickupDate) return;
    if (pickupDate < minDateISO) setPickupDate(minDateISO);
    if (pickupDate > maxDateISO) setPickupDate(maxDateISO);
  }, [pickupDate, minDateISO, maxDateISO]);

  /* cash ⇒ force pickup (only when cash is allowed) */
  useEffect(() => {
    if (ALLOW_CASH && payment === 'cash') setMethod('pickup');
  }, [payment]);

  /* ----- Google SDK load ----- */
  const addr1Ref = useRef(null);
  const acRef = useRef(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [addressVerified, setAddressVerified] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!GOOGLE_MAPS_KEY) return; // fallback to manual
    loadGoogleMaps(GOOGLE_MAPS_KEY)
      .then(() => { if (mounted) setSdkReady(true); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  /* Attach Places Autocomplete only when input is mounted and SDK is ready */
  useEffect(() => {
    if (!sdkReady) return;
    if (method !== 'delivery') return;
    if (!addr1Ref.current) return;
    if (!window.google?.maps?.places) return; // guard

    const google = window.google;
    const ac = new google.maps.places.Autocomplete(addr1Ref.current, {
      componentRestrictions: { country: 'US' }, // string, not array
      types: ['address'],
      fields: ['address_components', 'formatted_address', 'place_id'],
    });
    acRef.current = ac;

    const onPlace = () => {
      try {
        const place = ac.getPlace();
        const comps = place?.address_components || [];
        const get = (type) => comps.find((c) => c.types.includes(type))?.long_name || '';
        const streetNumber = get('street_number');
        const route = get('route');
        const locality = get('locality') || get('sublocality') || get('postal_town') || '';
        const admin1 = get('administrative_area_level_1');
        const postal = get('postal_code');

        const line1 = [streetNumber, route].filter(Boolean).join(' ');
        if (line1) setAddr1(line1);
        if (locality) setCity(locality);
        if (admin1) setSt(admin1);
        if (postal) setZip(postal);
        setAddressVerified(Boolean(line1 && postal));
      } catch (e) {
        // Defensive: don't allow a weird payload to break UI
        // eslint-disable-next-line no-console
        console.error('[Autocomplete place_changed]', e);
        setAddressVerified(false);
      }
    };

    ac.addListener('place_changed', onPlace);

    return () => {
      try { google.maps.event.clearInstanceListeners(ac); } catch {}
      acRef.current = null;
    };
  }, [sdkReady, method]);

  // typing resets verification
  useEffect(() => { setAddressVerified(false); }, [addr1, addr2, city, st, zip]);

  /* ----- Distance (SDK) with fallback ----- */
  const [distance, setDistance] = useState(draft?.customer?.distance ?? 0);
  const [distStatus, setDistStatus] = useState('idle'); // idle | calc | ok | fail | out_of_range
  const [allowManualDistance, setAllowManualDistance] = useState(false);
  const distTimer = useRef(null);

  useEffect(() => {
    if (method !== 'delivery') return;
    const hasAddr = addr1 && city && st && zip;
    if (!hasAddr) { setDistStatus('idle'); setAllowManualDistance(false); return; }

    setDistStatus('calc');
    if (distTimer.current) clearTimeout(distTimer.current);
    distTimer.current = setTimeout(async () => {
      const dest = `${addr1} ${addr2 || ''}, ${city}, ${st} ${zip}`;
      if (sdkReady && window.google?.maps) {
        const miles = await distMatrixMiles(window.google, ORIGIN_ADDR, dest);
        if (miles == null) {
          setDistStatus('fail');
          setAllowManualDistance(true);
        } else {
          setDistance(miles);
          setDistStatus(miles > 100 ? 'out_of_range' : 'ok');
          setAllowManualDistance(false);
        }
      } else {
        setDistStatus('fail');
        setAllowManualDistance(true);
      }
    }, 500);
    return () => { if (distTimer.current) clearTimeout(distTimer.current); };
  }, [method, addr1, addr2, city, st, zip, sdkReady]);

  /* ----- Delivery fee rules ----- */
  const deliveryFee = method === 'pickup' ? 0 :
    (distance <= 20 ? 50 : (distance <= 100 ? 175 : 0));

  /* ----- Discount: online10 = 10% off items subtotal ----- */
  const discount = (discCode || '').trim().toLowerCase() === 'online10' ? round2(cartTotal * 0.10) : 0;

  const addOnFee = (warmers ? 10 : 0) + (utensils ? 10 : 0);
  const grandTotal = Number((cartTotal + deliveryFee + addOnFee - discount).toFixed(2));

  const summaryRows = useMemo(() => ([
    ['Items',    `$${cartTotal.toFixed(2)}`],
    ...(method === 'delivery' ? [['Delivery', `$${deliveryFee.toFixed(2)}`]] : []),
    ['Add-ons',  `$${addOnFee.toFixed(2)}`],
    ...(discount ? [['Discount (online10)', `- $${discount.toFixed(2)}`]] : []),
  ]), [cartTotal, method, deliveryFee, addOnFee, discount]);

  /* ----- Hours: load + $500 rule + build slots + 18h filter ----- */
  useEffect(() => { (async () => { const h = await loadHours(); setHours(h); })(); }, []);

  // choose which map to use by $500 rule
  const effectiveHoursMap = useMemo(() => {
    if (method === 'pickup') return hours.pickupHours || {};
    return grandTotal < 500 ? (hours.pickupHours || {}) : (hours.deliveryHours || {});
  }, [method, grandTotal, hours]);

  useEffect(() => {
    if (!pickupDate) { setSlots([]); return; }
    const raw = buildSlotsForDate(effectiveHoursMap, pickupDate, 30);
    const filtered = filterSlotsByEarliest(pickupDate, raw, earliestAllowed.getTime());
    setSlots(filtered);
    setPickupTime((prev) => (prev && filtered.some(x => x.label === prev)) ? prev : '');
  }, [effectiveHoursMap, pickupDate, earliestAllowed]);

  /* ---------- Phone verification ---------- */
  const [verifying, setVerifying] = useState(false);
  const [codeModal, setCodeModal] = useState(false);
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const startVerifyPhone = async () => {
    setVerifyError('');
    try {
      setVerifying(true);
      const e164 = toE164US(phone);
      if (!e164) throw new Error('Enter the phone number (e.g., +12145550123)');
      await updateUserAttributes({ userAttributes: { phone_number: e164 }});
      await sendUserAttributeVerificationCode({ userAttributeKey: 'phone_number' });
      setPhone(e164);
      setCode('');
      setCodeModal(true);
    } catch (err) {
      setVerifyError(err?.message || 'Could not send SMS.');
    } finally { setVerifying(false); }
  };
  const confirmVerifyPhone = async () => {
    setVerifyError('');
    try {
      if (!code.trim()) throw new Error('Enter the code');
      await confirmUserAttribute({ userAttributeKey: 'phone_number', confirmationCode: code.trim() });
      setPhoneVerified(true);
      setCodeModal(false);
    } catch (err) { setVerifyError(err?.message || 'Verification failed'); }
  };
  const resendCode = async () => {
    setVerifyError('');
    try { await sendUserAttributeVerificationCode({ userAttributeKey: 'phone_number' }); } catch (err) { setVerifyError(err?.message || 'Could not resend code'); }
  };

  /* ===== orderMeta ===== */
  const isPackageFlow = useMemo(
    () => cart.some((it) => isPackageSize(getItemSize(it))),
    [cart]
  );

  const orderMeta = useMemo(() => {
    if (state?.orderMeta) return state.orderMeta;
    if (isPackageFlow) {
      try { return JSON.parse(localStorage.getItem('i101_order_meta') || '{}'); } catch { return {}; }
    }
    return {};
  }, [state?.orderMeta, isPackageFlow]);

  const showTraySummary =
    isPackageFlow &&
    Array.isArray(orderMeta?.lines) &&
    orderMeta.lines.length > 0;

  /* ---- collect spice selections from cart + package meta ---- */
  const spiceSelections = useMemo(() => {
    const out = [];
    // From Package recommendation (lines)
    (orderMeta?.lines || []).forEach((ln) => {
      if (ln?.SpiceLevel) {
        out.push({
          name: ln.name,
          size: ln.size,
          qty: ln.qty,
          spiceLevel: ln.SpiceLevel,
          source: 'package',
        });
      }
    });
    // From Trays cart items (extras.spiceLevel)
    cart.forEach((c) => {
      const sl = c?.extras?.spiceLevel;
      if (sl) {
        out.push({
          name: c.name,
          size: c.size,
          qty: c.qty,
          spiceLevel: sl,
          source: 'trays',
        });
      }
    });
    return out;
  }, [orderMeta, cart]);

  /* Back destination */
  const derivedReturnTo = state?.returnTo || (isPackageFlow ? '/OrderPackage' : '/OrderTrays');
  const handleBack = () => { nav(derivedReturnTo, { replace: true }); };

  // keep a lightweight draft
  useEffect(() => {
    const draftCustomer = {
      method,
      pickupDate,
      pickupTime,
      distance,
      address: { addr1, addr2, city, state: st, zip },
      warmers,
      utensils,
      refCode,
      discCode,
      specialRequest, // NEW
    };
    sessionStorage.setItem(
      'i101_checkout_draft',
      JSON.stringify({ customer: draftCustomer, payment })
    );
  }, [method, pickupDate, pickupTime, distance, addr1, addr2, city, st, zip, warmers, utensils, refCode, discCode, payment, specialRequest]);

  /* ----- Ready / continue ----- */
  const phoneOk = REQUIRE_PHONE_VERIFICATION ? (!!phone && phoneVerified) : true;
  const canDeliverDistance = method !== 'delivery' || (distStatus !== 'out_of_range');
  const hasAddress = method === 'pickup' || (!!addr1 && !!city && !!st && !!zip);
  const hasSlot = !!pickupDate && !!pickupTime;
  const ready = phoneOk && hasSlot && hasAddress && canDeliverDistance;

  const handleContinue = () => {
    const whenISO = buildWhenISO(pickupDate, pickupTime);

    const customer = {
      name:  (custName || '').trim(),
      email: (custEmail || '').trim(),
      phone: toE164US(phone),
      method,
      pickupDate,
      pickupTime,
      when: whenISO,
      distance,
      address: { addr1: addr1.trim(), addr2: addr2.trim(), city: city.trim(), state: st.trim(), zip: zip.trim() },
      warmers, utensils,
      refCode: refCode.trim(), discCode: discCode.trim(),
      addressVerified,
      specialRequest: specialRequest.trim(), // NEW
    };

    const totals = { cartTotal, deliveryFee, addOnFee, discount, grandTotal };

    if (saveDetails) {
      localStorage.setItem('i101_customer', JSON.stringify({
        name: customer.name, email: customer.email, phone: customer.phone, address: customer.address
      }));
    } else {
      localStorage.removeItem('i101_customer');
    }

    // Include spice selections explicitly, in addition to cart/orderMeta
    const checkoutPayload = {
      cart,
      customer,
      payment,
      totals,
      when: whenISO,
      orderMeta,
      returnTo: derivedReturnTo,
      spiceSelections, // NEW
    };
    sessionStorage.setItem('i101_checkout', JSON.stringify(checkoutPayload));
    sessionStorage.removeItem('i101_checkout_draft');
    nav('/payment', { state: checkoutPayload });
  };

  /* ---------- Mobile summary drawer state ---------- */
  const [showSummaryMobile, setShowSummaryMobile] = useState(false);

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-4 md:p-6 md:pr-[24rem] relative">
      {/* Header (desktop fixed, mobile inline) */}
      <div className="hidden md:flex absolute top-4 right-[24rem] items-center gap-6 text-sm">
        {currentUser ? (
          <>
            <span>Welcome,&nbsp;{currentUser.signInDetails?.loginId ?? currentUser.username}</span>
            <button
              onClick={async () => {
                try { await signOut({ global: true }); } catch {}
                localStorage.removeItem('i101_cart');
                localStorage.removeItem('i101_customer');
                sessionStorage.removeItem('i101_checkout');
                sessionStorage.removeItem('i101_checkout_draft');
                nav('/', { replace: true });
              }}
              className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded"
            >
              Sign Out
            </button>
          </>
        ) : null}
      </div>

      {/* Mobile topbar sign-out (to match other pages) */}
      <div className="md:hidden flex justify-end mb-2">
        {currentUser ? (
          <button
            onClick={async () => {
              try { await signOut({ global: true }); } catch {}
              localStorage.removeItem('i101_cart');
              localStorage.removeItem('i101_customer');
              sessionStorage.removeItem('i101_checkout');
              sessionStorage.removeItem('i101_checkout_draft');
              nav('/', { replace: true });
            }}
            className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm"
          >
            Sign Out
          </button>
        ) : null}
      </div>

      {/* title */}
      <div className="text-center md:text-left">
        <h1 className="text-2xl md:text-3xl font-bold text-orange-400">Checkout</h1>
      </div>
      <div className="text-center md:text-left">
        <button
          onClick={derivedReturnTo ? () => nav(derivedReturnTo) : handleBack}
          className="mt-3 md:mt-4 mb-4 md:mb-6 text-sm bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#F58735]/60 rounded px-3 py-1"
        >
          ‹ Back to Order
        </button>
      </div>

      {/* Desktop Summary Sidebar */}
      <aside className="hidden md:block fixed top-0 right-4 w-80 h-full bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto">
        <h2 className="text-xl font-semibold text-[#F58735] mb-3">Summary</h2>
        <ul className="space-y-1 text-sm mb-3">
          {summaryRows.map(([k, v]) => (
            <li key={k} className="flex justify-between">
              <span>{k}</span><span>{v}</span>
            </li>
          ))}
        </ul>

        {/* Special request (NEW) */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Special request</div>
          <textarea
            rows={3}
            value={specialRequest}
            onChange={(e) => setSpecialRequest(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded text-black"
            placeholder="Allergies, delivery notes, gate codes, spice notes, etc."
          />
        </div>

        {/* Codes */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Codes</div>
          <label className="block mb-3 text-sm">
            Agent Reference Code
            <input value={refCode} onChange={e => setRefCode(e.target.value)} className="w-full mt-1 px-3 py-1 rounded text-black" />
          </label>
          <label className="block text-sm">
            Discount Code
            <input value={discCode} onChange={e => setDiscCode(e.target.value)} className="w-full mt-1 px-3 py-1 rounded text-black" />
          </label>
        </div>

        {/* Options */}
        <div className="mb-4">
          <div className="text-sm font-semibold mb-2">Options</div>
          <label className="block text-sm">
            <input type="checkbox" checked={warmers} onChange={() => setWarmers(!warmers)} /> Sterno warmers (+$10)
          </label>
          <label className="block text-sm">
            <input type="checkbox" checked={utensils} onChange={() => setUtensils(!utensils)} /> Serving utensils (+$10)
          </label>
        </div>

        {/* Grand total + Continue */}
        <div className="flex justify-between font-semibold py-2 border-t border-[#3a3939]">
          <span>Grand&nbsp;Total</span><span>${grandTotal.toFixed(2)}</span>
        </div>
        <button
          onClick={handleContinue}
          disabled={!ready}
          className={`mt-2 w-full px-6 py-2 rounded transition-colors ${
            ready ? 'bg-[#F58735] hover:bg-orange-600' : 'bg-gray-600 cursor-not-allowed'
          }`}
        >
          Continue to Payment
        </button>

        {REQUIRE_PHONE_VERIFICATION && !phoneVerified && (
          <p className="text-xs text-yellow-300 mt-2">Verify your phone number to continue.</p>
        )}
      </aside>

      {/* ---- MAIN CONTENT ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-10 max-w-5xl">
        {/* LEFT COLUMN */}
        <div className="space-y-8">
          {/* Tray Summary — only for valid package flows */}
          {showTraySummary && (
            <section className="rounded-xl border border-[#3a3939] bg-[#232222] p-4">
              <h2 className="text-xl font-semibold text-[#F58735] mb-2">Tray Summary</h2>
              <ul className="text-sm space-y-1">
                {orderMeta.lines.map((ln, idx) => (
                  <li key={`ln-${idx}`} className="flex justify-between">
                    <span className="text-gray-200">
                      {ln.name}
                      {ln.SpiceLevel ? <span className="text-gray-400"> (Spice: {ln.SpiceLevel})</span> : null}
                    </span>
                    <span className="text-gray-300">
                      {ln.size === 'per-piece'
                        ? 'Per Piece'
                        : String(ln.size).replace(/([A-Z])/g, ' $1').trim()
                      } × {ln.qty}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Customer Info */}
          <section>
            <h2 className="text-xl font-semibold mb-3">Customer Info</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                Full Name
                <input value={custName} onChange={e => setCustName(e.target.value)} className="w-full mt-1 px-3 py-1 rounded text-black" placeholder="First & Last name" />
              </label>
              <label className="block">
                Email
                <input type="email" value={custEmail} onChange={e => setCustEmail(e.target.value)} className="w-full mt-1 px-3 py-1 rounded text-black" placeholder="name@example.com" />
              </label>
              <div className="block md:col-span-2">
                <label className="block">Phone Number</label>
                <div className="mt-1 flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    onBlur={() => setPhone(toE164US(phone))}
                    className="flex-1 px-3 py-1 rounded text-black"
                    placeholder="+12145550123"
                    inputMode="tel"
                  />
                  {REQUIRE_PHONE_VERIFICATION && !phoneVerified && (
                    <button
                      onClick={startVerifyPhone}
                      disabled={!phone || phoneVerified || verifying}
                      className={`text-xs px-3 py-1 rounded border self-start sm:self-auto ${
                        phoneVerified ? 'opacity-40 cursor-not-allowed border-transparent' :
                        verifying ? 'opacity-60 cursor-wait border-[#F58735]' :
                        'border-[#F58735] hover:bg-[#3a3939]'
                      }`}
                    >
                      {phoneVerified ? 'Verified ✓' : verifying ? 'Sending…' : 'Verify using One-Time Passcode'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">Format: +1XXXXXXXXXX (or your country code).</p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 mt-3 text-sm">
              <input type="checkbox" checked={saveDetails} onChange={() => setSaveDetails(!saveDetails)} />
              Save my details for next time
            </label>
          </section>

          {/* Payment */}
          <section>
            <h2 className="text-xl font-semibold mb-3">Payment</h2>
            <div className="flex flex-wrap gap-4">
              {ALLOW_CASH && (
                <label className="mr-6">
                  <input type="radio" value="cash" checked={payment==='cash'} onChange={() => setPayment('cash')} /> Cash
                </label>
              )}
              <label>
                <input type="radio" value="card" checked={payment==='card'} onChange={() => setPayment('card')} /> Credit Card
              </label>
            </div>
          </section>

          {/* Pickup / Delivery + Address + Distance */}
          <section>
            <h2 className="text-xl font-semibold mb-3">Pickup / Delivery</h2>
            <div className="flex flex-wrap gap-4">
              <label>
                <input
                  type="radio"
                  value="pickup"
                  checked={method==='pickup'}
                  onChange={() => setMethod('pickup')}
                />{' '}
                Pickup
              </label>
              <label className={`${(ALLOW_CASH && payment==='cash') ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <input
                  type="radio"
                  value="delivery"
                  checked={method==='delivery'}
                  onChange={() => setMethod('delivery')}
                  disabled={ALLOW_CASH ? (payment==='cash') : false}
                />{' '}
                Delivery
              </label>
            </div>

            {method==='delivery' && (
              <div className="mt-4 space-y-3">
                <input
                  ref={addr1Ref}
                  type="text"
                  placeholder="Street address line 1"
                  value={addr1}
                  onChange={e => setAddr1(e.target.value)}
                  className="w-full px-3 py-1 rounded text-black"
                />
                <input type="text" placeholder="Street address line 2"
                  value={addr2} onChange={e => setAddr2(e.target.value)}
                  className="w-full px-3 py-1 rounded text-black" />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input type="text" placeholder="City"
                    value={city} onChange={e => setCity(e.target.value)}
                    className="w-full px-3 py-1 rounded text-black" />
                  <input type="text" placeholder="State"
                    value={st} onChange={e => setSt(e.target.value)}
                    className="w-full px-3 py-1 rounded text-black" />
                  <input type="text" placeholder="ZIP"
                    value={zip} onChange={e => setZip(e.target.value)}
                    className="w-full px-3 py-1 rounded text-black" />
                </div>

                {/* Auto distance + manual fallback */}
                <div className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-neutral-300">Distance:</span>
                    <span className="font-semibold">
                      {distStatus === 'calc' ? 'Calculating…' :
                       distStatus === 'ok'   ? `${distance} mi` :
                       distStatus === 'out_of_range' ? `${distance} mi (out of range)` :
                       distStatus === 'fail' ? 'Unavailable (enter manually below)' :
                       distance ? `${distance} mi` : '-'}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400">0–20 mi = $50, 20–100 mi = $175. From {ORIGIN_ADDR}.</div>
                </div>

                {allowManualDistance && (
                  <div className="flex items-center gap-3">
                    <label className="text-sm">Distance (mi):</label>
                    <input
                      type="number" min="1" max="200" value={distance || ''}
                      onChange={e => setDistance(Number(e.target.value) || 0)}
                      className="w-24 px-2 py-1 rounded text-black"
                    />
                  </div>
                )}

                {distStatus === 'out_of_range' && (
                  <div className="text-red-300 text-sm">We currently deliver up to 100 miles.</div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN — Date & Time */}
        <div>
          <section>
            <h2 className="text-xl font-semibold mb-2">Date & Time</h2>
            <div className="text-xs text-neutral-300 mb-2">
              Using {method === 'pickup' ? 'Pickup' : (grandTotal < 500 ? 'Pickup (order < $500)' : 'Delivery (order ≥ $500)')} hours.
            </div>

            <div className="grid grid-cols-1 gap-3">
              <label className="block">
                Date
                <input
                  type="date"
                  value={pickupDate}
                  min={minDateISO}
                  max={maxDateISO}
                  onChange={e => setPickupDate(e.target.value)}
                  className="w-full mt-1 px-3 py-1 rounded text-black"
                />
                <div className="text-[11px] text-neutral-400 mt-1">
                  Must be at least 18 hours from now and within 90 days.
                </div>
              </label>

              <div className="block">
                <div>Time</div>
                {!pickupDate ? (
                  <div className="mt-1 text-sm text-neutral-400">Pick a date to see available times.</div>
                ) : slots.length === 0 ? (
                  <div className="mt-1 text-sm text-red-300">No available times for that date.</div>
                ) : (
                  <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
                    {slots.map(s => (
                      <button
                        key={s.mins}
                        type="button"
                        onClick={() => setPickupTime(s.label)}
                        className={`min-w-[110px] px-3 py-2 rounded border text-sm ${
                          pickupTime === s.label
                            ? 'border-[#F58735] bg-[#3a2a2a]'
                            : 'border-[#3A2D2D] bg-[#2E2424] hover:bg-[#352A2A]'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
                {pickupTime && <div className="text-xs text-neutral-300 mt-1">Selected: {pickupTime}</div>}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Mobile floating summary button */}
      <button
        onClick={() => setShowSummaryMobile(true)}
        className="md:hidden fixed bottom-4 right-4 z-40 bg-[#F58735] hover:bg-orange-600 text-black rounded-full shadow-lg px-4 py-3 text-sm"
      >
        Summary • ${grandTotal.toFixed(2)}
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

            {/* Special request (NEW) */}
            <div className="mb-4">
              <div className="text-sm font-semibold mb-2">Special request</div>
              <textarea
                rows={3}
                value={specialRequest}
                onChange={(e) => setSpecialRequest(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded text-black"
                placeholder="Allergies, delivery notes, gate codes, spice notes, etc."
              />
            </div>

            {/* Codes */}
            <div className="mb-4">
              <div className="text-sm font-semibold mb-2">Codes</div>
              <label className="block mb-3 text-sm">
                Agent Reference Code
                <input value={refCode} onChange={e => setRefCode(e.target.value)} className="w-full mt-1 px-3 py-1 rounded text-black" />
              </label>
              <label className="block text-sm">
                Discount Code
                <input value={discCode} onChange={e => setDiscCode(e.target.value)} className="w-full mt-1 px-3 py-1 rounded text-black" />
              </label>
            </div>

            {/* Options */}
            <div className="mb-4">
              <div className="text-sm font-semibold mb-2">Options</div>
              <label className="block text-sm">
                <input type="checkbox" checked={warmers} onChange={() => setWarmers(!warmers)} /> Sterno warmers (+$10)
              </label>
              <label className="block text-sm">
                <input type="checkbox" checked={utensils} onChange={() => setUtensils(!utensils)} /> Serving utensils (+$10)
              </label>
            </div>

            {/* Grand total + Continue */}
            <div className="flex justify-between font-semibold py-2 border-t border-[#3a3939]">
              <span>Grand&nbsp;Total</span><span>${grandTotal.toFixed(2)}</span>
            </div>
            <button
              onClick={() => { setShowSummaryMobile(false); handleContinue(); }}
              disabled={!ready}
              className={`mt-2 w-full px-6 py-2 rounded transition-colors ${
                ready ? 'bg-[#F58735] hover:bg-orange-600' : 'bg-gray-600 cursor-not-allowed'
              }`}
            >
              Continue to Payment
            </button>

            {REQUIRE_PHONE_VERIFICATION && !phoneVerified && (
              <p className="text-xs text-yellow-300 mt-2">Verify your phone number to continue.</p>
            )}
          </div>
        </div>
      )}

      {/* Phone verify modal */}
      {codeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#2c2a2a] border border-[#3a3939] rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-2">Verify phone number</h3>
            <p className="text-sm text-gray-300 mb-3">
              We sent a 6-digit code to <span className="font-mono">{phone}</span>.
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-3 py-2 rounded text-black"
              placeholder="Enter code"
              inputMode="numeric"
            />
            {verifyError && <p className="text-xs text-red-300 mt-2">{verifyError}</p>}
            <div className="mt-4 flex justify-between items-center">
              <button onClick={resendCode} className="text-xs underline underline-offset-2">Resend code</button>
              <div className="flex gap-2">
                <button onClick={() => setCodeModal(false)} className="px-3 py-1 rounded bg-[#3a3939] hover:bg-[#4a4949]">Cancel</button>
                <button onClick={confirmVerifyPhone} className="px-3 py-1 rounded bg-[#F58735] hover:bg-orange-600">Verify</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

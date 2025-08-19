// src/pages/OrderPackage.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchAuthSession,
  getCurrentUser,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { decodeJwt } from 'jose';

// ----------------- DDB config table -----------------
const TABLE_NAME   = 'catering-package-dev';
const PK_NAME      = 'ConfigId';
const PK_VALUE     = 'packages';
const PAYLOAD_ATTR = 'Payload';

// ----------------- Defaults (fallback) -----------------
const DEFAULT_PACKAGES = [
  { id:'pkg-basic', name:'Basic Package', nameShort:'Basic',
    priceLine:'Starting $8/person',
    slots: { appetizer:['A'], main:['A','A'], rice:['A'], bread:['A'], dessert:['A'] }, perPerson:8
  },
  { id:'pkg-classic', name:'Classic Package', nameShort:'Classic',
    priceLine:'Starting $12/person',
    slots: { appetizer:['A'], main:['A','A','B'], rice:['B'], bread:['A'], dessert:['A'] }, perPerson:12
  },
  { id:'pkg-premium', name:'Premium Package', nameShort:'Premium',
    priceLine:'Starting $15/person',
    slots: { appetizer:['A','B'], main:['A','B','C'], rice:['A','B'], bread:['A','B'], dessert:['A','B'] }, perPerson:15
  },
];
const DEFAULT_THRESHOLDS = { small: 15, medium: 25, large: 35, xl: 50 };
const DEFAULT_HEAVY_BUMP = 5;

const GROUP_RANK = { A:1, B:2, C:3, D:4 };
const APPETITES  = ['regular','heavy'];

// ----------------- Utils -----------------
const numToWord = (n) => {
  const m = {0:'Zero',1:'One',2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',10:'Ten',11:'Eleven',12:'Twelve'};
  return m[n] || String(n);
};
const plural = (w, n) => (n === 1 ? w : `${w}s`);
const packageLineFromSlots = (slots) => {
  const order = ['appetizer','main','rice','bread','dessert'];
  const parts = [];
  for (const c of order) {
    const count = (slots[c] || []).length;
    if (!count) continue;
    const label = c === 'main' ? 'Main' : c === 'dessert' ? 'Dessert' : c.charAt(0).toUpperCase()+c.slice(1);
    parts.push(`${numToWord(count)} ${plural(label, count)}`);
  }
  return parts.join(' · ');
};
const courseFromCategory = (cat = '') => {
  const c = String(cat).toLowerCase();
  if (c.includes('appetizer') || c.includes('chaat') || c.includes('starter')) return 'appetizer';
  if (c.includes('rice') || c.includes('biryani') || c.includes('pulao')) return 'rice';
  if (c.includes('bread') || c.includes('naan') || c.includes('roti') || c.includes('paratha')) return 'bread';
  if (c.includes('dessert') || c.includes('sweet')) return 'dessert';
  return 'main';
};
const isNonVegByName = (name = '') =>
  ['chicken','goat','lamb','fish','shrimp'].some(w => String(name).toLowerCase().includes(w));

const getFirstNumeric = (obj, keys) => {
  for (const k of keys) {
    const key = Object.keys(obj || {}).find(x => x.toLowerCase() === k.toLowerCase());
    if (key && obj[key] != null) {
      const v = typeof obj[key] === 'string' ? parseFloat(obj[key]) : obj[key];
      if (!isNaN(v)) return Number(v);
    }
  }
  return 0;
};
const getTrayPrice = (item, sizeKey) => {
  switch (sizeKey) {
    case 'ExtraLargeTray': return getFirstNumeric(item, ['ExtraLargeTray','ExtraLarge','X-Large','XL','Price_ExtraLarge','ExtraLargePrice']);
    case 'LargeTray':      return getFirstNumeric(item, ['LargeTray','Large','L','Price_Large','LargePrice']);
    case 'MediumTray':     return getFirstNumeric(item, ['MediumTray','Medium','M','Price_Medium','MediumPrice']);
    case 'SmallTray':      return getFirstNumeric(item, ['SmallTray','Small','S','Price_Small','SmallPrice']);
    default: return 0;
  }
};
const getPerPiecePrice = (item) =>
  getFirstNumeric(item, ['PerPiece','Per_Piece','perPiece','Piece','Unit','PerUnit','PiecePrice','per-piece','Price_per_piece']);
const getTypeLower = (item) => (item?.Type || item?.type || item?.UnitType || '').toString().toLowerCase();
const isPerPieceItem = (item) => getTypeLower(item).includes('pc') || !!getPerPiecePrice(item);
const sizeLabel = (sizeKey) => sizeKey === 'per-piece' ? 'Per Piece' : sizeKey.replace(/([A-Z])/g, ' $1').trim();

export default function OrderPackage() {
  const nav  = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);

  // Admin-controlled config (from DynamoDB)
  const [pkgConfig, setPkgConfig] = useState({
    packages: DEFAULT_PACKAGES,
    thresholds: DEFAULT_THRESHOLDS,
    heavyBump: DEFAULT_HEAVY_BUMP,
  });

  // selection & inputs
  const [selection, setSelection] = useState(DEFAULT_PACKAGES[0]);
  const [guests, setGuests]       = useState(15);
  const [appetite, setAppetite]   = useState('regular'); // 'regular' | 'heavy'
  const [showGuestLimit, setShowGuestLimit] = useState(false);

  // menu data
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);

  // cart
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('i101_cart')) || []; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem('i101_cart', JSON.stringify(cart)); }, [cart]);

  // picks per course
  const [picks, setPicks] = useState({ appetizer: [], main: [], rice: [], bread: [], dessert: [] });
  const [open, setOpen]   = useState({ appetizer: true, main: false, rice: false, bread: false, dessert: false });

  // NEW: mobile cart drawer toggle
  const [showCartMobile, setShowCartMobile] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const session = await fetchAuthSession();
        const rawId   = session.tokens?.idToken?.toString();
        const payload = rawId ? decodeJwt(rawId) : {};
        const groups  = payload['cognito:groups'] || [];
        if (groups.includes('admin')) { nav('/admin', { replace: true }); return; }

        const me = await getCurrentUser().catch(() => null);
        if (me) setCurrentUser(me);

        await Promise.all([loadMenu(session), loadPackageConfig(session)]);
      } catch (err) {
        console.error('Package init error:', err);
      } finally { setLoading(false); }
    };
    init();
  }, [nav]);

  // set first open section & clamp guests on package change
  useEffect(() => {
    setPicks({ appetizer: [], main: [], rice: [], bread: [], dessert: [] });
    const first = ['appetizer','main','rice','bread','dessert'].find(c => (selection.slots?.[c] || []).length > 0);
    setOpen({ appetizer:false, main:false, rice:false, bread:false, dessert:false, [first || 'appetizer']: true });
    setGuests(g => Math.round(Math.max(15, Math.min(g, 100)) / 5) * 5);
  }, [selection]);

  // align selection to config packages once loaded
  useEffect(() => {
    setSelection(prev => {
      const match = (pkgConfig.packages || []).find(p => p.id === prev.id) || (pkgConfig.packages || [])[0] || DEFAULT_PACKAGES[0];
      return match;
    });
  }, [pkgConfig]);

  const loadMenu = async (session) => {
    const creds = session?.credentials;
    if (!creds?.accessKeyId) return;
    const db = new DynamoDBClient({
      region: 'us-east-2',
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken },
    });
    const { Items } = await db.send(new QueryCommand({
      TableName: 'catering-customer-pricing',
      KeyConditionExpression: '#u = :u',
      ExpressionAttributeNames: { '#u': 'USER' },
      ExpressionAttributeValues: { ':u': { S: 'USER' } },
    }));
    setItems(Items.map(unmarshall));
  };

  const loadPackageConfig = async (session) => {
    try {
      const creds = session?.credentials;
      if (!creds?.accessKeyId) throw new Error('Missing AWS credentials');
      const db = new DynamoDBClient({
        region: 'us-east-2',
        credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, sessionToken: creds.sessionToken },
      });
      const { Item } = await db.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: { [PK_NAME]: { S: PK_VALUE } },
      }));
      const payloadStr = Item?.[PAYLOAD_ATTR]?.S;
      if (payloadStr) {
        const json = JSON.parse(payloadStr);
        const thresholds = json?.trays?.thresholds || DEFAULT_THRESHOLDS;
        const heavyBump  = json?.trays?.heavyBump ?? DEFAULT_HEAVY_BUMP;
        const packages   = Array.isArray(json?.packages) && json.packages.length ? json.packages : DEFAULT_PACKAGES;
        setPkgConfig({ packages, thresholds, heavyBump });
      }
    } catch (e) {
      console.error('Config load failed, using defaults:', e);
      setPkgConfig({ packages: DEFAULT_PACKAGES, thresholds: DEFAULT_THRESHOLDS, heavyBump: DEFAULT_HEAVY_BUMP });
    }
  };

  const handleSignOut = async () => {
    await amplifySignOut({ global:true });
    setCurrentUser(null);
    setCart([]);
    localStorage.removeItem('i101_cart');
  };

  // build menus per course
  const { courseMenus } = useMemo(() => {
    const menus = { appetizer: [], main: [], rice: [], bread: [], dessert: [] };
    items.forEach(it => {
      const name = it.Item || it.name || '';
      const category = it.Category || it.category || '';
      const course = courseFromCategory(category);
      if (!menus[course]) return;
      const group = (it.Group || it.group || 'A').toUpperCase();
      menus[course].push({
        key: it.Item || it.SKU || name,
        name, category, group,
        nonVeg: isNonVegByName(name),
        raw: it,
      });
    });
    Object.keys(menus).forEach(k => {
      menus[k].sort((a, b) =>
        (GROUP_RANK[a.group] - GROUP_RANK[b.group]) || a.name.localeCompare(b.name)
      );
    });
    return { courseMenus: menus };
  }, [items]);

  // slot feasibility (hidden)
  const canAddPick = (course, item) => {
    const slots = selection.slots?.[course] || [];
    const desiredGroup = (item.group || 'A').toUpperCase();
    const current = picks[course] || [];
    if (current.find(p => p.key === item.key)) return true;
    if (current.length >= slots.length) return false;

    const counts = { A:0, B:0, C:0, D:0 };
    [...current.map(p => (p.group || 'A').toUpperCase()), desiredGroup]
      .forEach(g => { counts[g] = (counts[g]||0) + 1; });

    const slotRanks = slots.map(g => GROUP_RANK[g] || 1).sort((a,b)=>a-b);
    const capacityAtLeast = {
      A: slots.length,
      B: slotRanks.filter(r => r >= GROUP_RANK.B).length,
      C: slotRanks.filter(r => r >= GROUP_RANK.C).length,
      D: slotRanks.filter(r => r >= GROUP_RANK.D).length,
    };
    if (counts.B > capacityAtLeast.B) return false;
    if (counts.C > capacityAtLeast.C) return false;
    if (counts.D > capacityAtLeast.D) return false;
    return true;
  };

  const COURSE_ORDER = ['appetizer','main','rice','bread','dessert'];
  const nextIncompleteCourse = (statePicks) => {
    for (const c of COURSE_ORDER) {
      const need = (selection.slots?.[c] || []).length;
      if (need > 0 && (statePicks[c]?.length || 0) < need) return c;
    }
    return null;
  };

  const togglePick = (course, item) => {
    setPicks(prev => {
      const selected = prev[course] || [];
      const exists = selected.find(p => p.key === item.key);
      if (exists) {
        return { ...prev, [course]: selected.filter(p => p.key !== item.key) };
      } else {
        if (!canAddPick(course, item)) return prev;
        const updated = { ...prev, [course]: [...selected, item] };
        const need = (selection.slots?.[course] || []).length;
        if (updated[course].length === need) {
          const next = nextIncompleteCourse(updated);
          setOpen(o => ({ ...o, [course]: false, ...(next ? { [next]: true } : {}) }));
        }
        return updated;
      }
    });
  };

  // guests
  const handleGuestChange = (rawVal) => {
    const raw = Number(rawVal || 0);
    const clamped = Math.max(15, Math.min(raw, 100));
    const rounded = Math.round(clamped / 5) * 5;
    if (raw > 100 || rounded > 100) setShowGuestLimit(true);
    setGuests(Math.min(rounded, 100));
  };

  // tray allocation
  const sizeForGuests = (g) => {
    const t = pkgConfig.thresholds || DEFAULT_THRESHOLDS;
    if (g <= t.small) return 'SmallTray';
    if (g <= t.medium) return 'MediumTray';
    if (g <= t.large) return 'LargeTray';
    return 'ExtraLargeTray';
  };
  const allocateTraysByGuests = (guestCount) => {
    let remaining = guestCount;
    const list = [];
    const xlMax = (pkgConfig.thresholds?.xl ?? DEFAULT_THRESHOLDS.xl);
    while (remaining > 0) {
      if (remaining > xlMax) {
        list.push({ sizeKey: 'ExtraLargeTray', count: 1 });
        remaining -= xlMax;
      } else {
        list.push({ sizeKey: sizeForGuests(remaining), count: 1 });
        remaining = 0;
      }
    }
    const merged = {};
    list.forEach(({ sizeKey, count }) => { merged[sizeKey] = (merged[sizeKey] || 0) + count; });
    return Object.entries(merged).map(([sizeKey, count]) => ({ sizeKey, count }));
  };

  // recommendation
  const buildRecommendation = () => {
    const bump = appetite === 'heavy' ? (pkgConfig.heavyBump ?? DEFAULT_HEAVY_BUMP) : 0;
    const trayGuests = guests + bump;
    const pcCount    = guests + bump;

    const allPicks = [
      ...(picks.appetizer||[]), ...(picks.main||[]),
      ...(picks.rice||[]), ...(picks.bread||[]), ...(picks.dessert||[])
    ];

    const trays = [];
    const perPieceItems = [];

    allPicks.forEach(p => {
      const course = courseFromCategory(p.category || '');
      if (isPerPieceItem(p.raw)) {
        perPieceItems.push({ itemName: p.name, course, pieces: pcCount, raw: p.raw });
      } else {
        trays.push({
          itemName: p.name,
          course,
          allocation: allocateTraysByGuests(trayGuests),
          raw: p.raw,
        });
      }
    });

    return { trays, perPieceItems };
  };

  const selectionsComplete = useMemo(() => {
    for (const c of COURSE_ORDER) {
      const need = (selection.slots?.[c] || []).length;
      if (need > 0 && (picks[c]?.length || 0) !== need) return false;
    }
    return true;
  }, [selection, picks]);

  const recommendation = useMemo(
    () => (selectionsComplete ? buildRecommendation() : null),
    [selectionsComplete, picks, guests, appetite, selection, pkgConfig]
  );

  // hidden price calc → rounded to $20 → per-person whole dollars
  const perPersonDynamic = useMemo(() => {
    if (!recommendation || guests <= 0) return null;
    let total = 0;
    recommendation.trays.forEach(t => {
      t.allocation.forEach(({ sizeKey, count }) => {
        total += (getTrayPrice(t.raw || {}, sizeKey) || 0) * count;
      });
    });
    recommendation.perPieceItems.forEach(pp => {
      total += (getPerPiecePrice(pp.raw || {}) || 0) * pp.pieces;
    });
    const roundedTo20 = Math.ceil(total / 20) * 20;
    const perPersonWhole = Math.ceil(roundedTo20 / guests);
    return { totalRaw: total, roundedTotal: roundedTo20, perPersonWhole };
  }, [recommendation, guests]);

  // add package to cart + persist meta.lines
  const addPerPersonPackageToCart = () => {
    if (!recommendation || !perPersonDynamic) return;

    const trayParts = [
      ...recommendation.trays.map(t =>
        `${t.itemName} — ${t.allocation.map(a => `${sizeLabel(a.sizeKey)} × ${a.count}`).join(', ')}`
      ),
      ...recommendation.perPieceItems.map(pp => `${pp.itemName} — Per Piece × ${pp.pieces}`),
    ];
    const details = `Trays • ${trayParts.join(' | ')}`;

    setCart(prev => {
      const filtered = prev.filter(c => !(c.id === selection.id && c.size === 'package'));
      return [
        ...filtered,
        {
          id: selection.id,
          name: `${selection.name} (${guests} guests)`,
          size: 'package',
          sizeLabel: 'Per Person Package',
          qty: guests,
          unit: Number(perPersonDynamic.perPersonWhole),
          details,
        },
      ];
    });

    const lines = [
      ...recommendation.trays.flatMap(t => t.allocation.map(a => ({
        id: (t.raw?.Item || t.raw?.SKU || t.itemName),
        name: t.itemName,
        size: a.sizeKey,
        qty: a.count,
        unit: getTrayPrice(t.raw || {}, a.sizeKey) || 0,
        kind: 'tray',
      }))),
      ...recommendation.perPieceItems.map(pp => ({
        id: (pp.raw?.Item || pp.raw?.SKU || pp.itemName),
        name: pp.itemName,
        size: 'per-piece',
        qty: pp.pieces,
        unit: getPerPiecePrice(pp.raw || {}) || 0,
        kind: 'per-piece',
      })),
    ];

    const meta = {
      packageId: selection.id,
      packageName: selection.name,
      guests,
      appetite,
      pricing: {
        totalRaw: perPersonDynamic.totalRaw,
        roundedTotal: perPersonDynamic.roundedTotal,
        perPerson: perPersonDynamic.perPersonWhole,
      },
      lines,
      config: {
        thresholds: pkgConfig.thresholds,
        heavyBump: pkgConfig.heavyBump,
      },
    };
    localStorage.setItem('i101_order_meta', JSON.stringify(meta));
  };

  const removeItem = (id, size) =>
    setCart(p => p.filter(c => !(c.id === id && c.size === size)));

  const canContinue = cart.length > 0;
  const cartTotal = cart.reduce((s,c)=>s + c.qty*Number(c.unit),0);

  // ------------- UI helpers -------------
  function Collapse({ open, children }) {
    const innerRef = useRef(null);
    const [height, setHeight] = useState(0);
    useEffect(() => {
      const h = innerRef.current ? innerRef.current.scrollHeight : 0;
      setHeight(open ? h : 0);
    }, [open, children]);
    return (
      <div style={{ maxHeight: height }} className="transition-[max-height] duration-300 ease-in-out overflow-hidden">
        <div ref={innerRef} className={`transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}>
          {children}
        </div>
      </div>
    );
  }

  const AppetiteTabs = () => (
    <div className="inline-flex rounded-xl overflow-hidden border border-[#3a3939] bg-[#232222]">
      {APPETITES.map(key => (
        <button
          key={key}
          onClick={() => setAppetite(key)}
          className={`px-3 py-1.5 text-sm transition ${
            appetite === key ? 'bg-[#F58735] text-black' : 'hover:bg-[#2d2b2b] text-gray-200'
          }`}
        >
          {key === 'regular' ? 'Regular' : 'Heavy'}
        </button>
      ))}
    </div>
  );

  // ------------- RENDER -------------
  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-4 md:p-6 md:pr-[24rem] relative">

      {/* Header (desktop fixed, mobile inline) */}
      <div className="hidden md:flex absolute top-4 right-[24rem] items-center gap-4 text-sm">
        {currentUser ? (
          <>
            <span>Welcome,&nbsp;{currentUser.signInDetails?.loginId ?? currentUser.username}</span>
            <button onClick={handleSignOut} className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded">Sign Out</button>
          </>
        ) : (
          <button
            onClick={() => nav('/signin', { state: { returnTo: '/OrderPackage' } })}
            className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded"
          >
            Sign In / Create Account
          </button>
        )}
      </div>

      {/* Mobile topbar auth */}
      <div className="md:hidden flex justify-end mb-2">
        {currentUser ? (
          <button onClick={handleSignOut} className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm">
            Sign Out
          </button>
        ) : (
          <button
            onClick={() => nav('/signin', { state: { returnTo: '/OrderPackage' } })}
            className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded text-sm"
          >
            Sign In / Create Account
          </button>
        )}
      </div>

      {/* Cart Pane — desktop */}
      <aside className="hidden md:block fixed top-0 right-4 w-80 h-full bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto">
        <h2 className="text-xl font-semibold text-[#F58735] mb-4">Your Cart</h2>
        {cart.length === 0 ? (
          <p className="text-gray-400 mb-6">No items yet.</p>
        ) : (
          <>
            <ul className="space-y-4">
              {cart.map(c => (
                <li key={`${c.id}-${c.size}`} className="text-sm">
                  <div className="flex justify-between">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-gray-400">
                        {c.sizeLabel} — {c.qty} × ${Number(c.unit).toFixed(2)}
                      </div>
                      {c.details && (
                        <div className="text-xs text-gray-300 whitespace-pre-wrap mt-1">
                          {c.details}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div>${(c.qty * Number(c.unit)).toFixed(2)}</div>
                      <button onClick={() => removeItem(c.id, c.size)} className="text-xs text-red-400 hover:text-red-200">remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <hr className="my-4 border-[#3a3939]" />
            <div className="text-right font-semibold mb-6">Total: ${cartTotal.toFixed(2)}</div>
            <button
              disabled={!canContinue}
              onClick={() => {
                if (!currentUser) {
                  nav('/signin', { state: { returnTo: '/checkout' } });
                  return;
                }
                const meta = (() => {
                  try { return JSON.parse(localStorage.getItem('i101_order_meta') || '{}'); }
                  catch { return null; }
                })();
                nav('/checkout', { state: { cart, cartTotal, orderMeta: meta || null, returnTo: '/OrderPackage' } });
              }}
              className="w-full bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          </>
        )}
      </aside>

      {/* Title & Back (centered on mobile) */}
      <div className="text-center md:text-left">
        <h1 className="text-2xl md:text-3xl font-bold text-orange-400">India 101 Package Order</h1>
      </div>
      <div className="text-center md:text-left">
        <button
          onClick={() => nav('/')}
          className="mt-3 md:mt-4 mb-4 md:mb-6 text-sm bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#F58735]/60 rounded px-3 py-1"
        >
          ‹ Start Over
        </button>
      </div>

      {/* Appetite & Guests (centered on mobile) */}
      <div className="mt-1 md:mt-2 mb-4 md:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-center gap-4">
        <div className="flex items-center gap-3 flex-1 justify-center sm:justify-end">
          <span className="text-sm text-gray-300">Appetite</span>
          <AppetiteTabs />
        </div>
        <div className="flex items-center gap-3 flex-1 justify-center sm:justify-start">
          <label className="text-sm text-gray-300">Guests</label>
          <input
            type="number"
            step={5}
            min={15}
            value={guests}
            onChange={e => handleGuestChange(e.target.value)}
            className="bg-[#2c2a2a] border border-[#3a3939] rounded px-3 py-2 w-24 md:w-28 text-right"
          />
        </div>
      </div>

      {/* Packages */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-3">
        {(pkgConfig.packages?.length ? pkgConfig.packages : DEFAULT_PACKAGES).map(p => (
          <button
            key={p.id}
            onClick={() => setSelection(p)}
            className={`text-left rounded-xl border p-4 transition ${
              selection?.id === p.id
                ? 'bg-[#F58735]/10 border-[#F58735]'
                : 'bg-[#272525] hover:bg-[#353232] border-[#F58735]/40'
            }`}
          >
            <div className="text-lg font-semibold text-[#F58735]">{p.name || p.nameShort}</div>
            <div className="text-sm text-gray-300 mt-1">{p.priceLine}</div>
            <div className="text-xs text-gray-400 mt-2 leading-relaxed">
              {packageLineFromSlots(p.slots)}
            </div>
          </button>
        ))}
      </div>

      {/* Recommendation & live per-person price */}
      <div className="mb-6 md:mb-8 rounded-xl border border-[#3a3939] bg-[#232222] p-4">
        <div className="font-medium mb-2">
          Based on your appetite and selection, we recommend ordering the trays below:
        </div>
        {!selectionsComplete ? (
          <div className="text-sm text-gray-400">
            Complete your menu selections to see a tray recommendation.
          </div>
        ) : (
          <>
            <ul className="space-y-2 text-sm">
              {recommendation?.trays.map(t => (
                <li key={`rec-${t.course}-${t.itemName}`} className="flex justify-between gap-2">
                  <span className="text-gray-200">
                    {t.itemName} <span className="text-gray-400">({t.course})</span>
                  </span>
                  <span className="text-gray-300 whitespace-nowrap">
                    {t.allocation.map(a => `${sizeLabel(a.sizeKey)} × ${a.count}`).join(', ')}
                  </span>
                </li>
              ))}
              {recommendation?.perPieceItems.map(pp => (
                <li key={`rec-pp-${pp.course}-${pp.itemName}`} className="flex justify-between gap-2">
                  <span className="text-gray-200">
                    {pp.itemName} <span className="text-gray-400">({pp.course})</span>
                  </span>
                  <span className="text-gray-300 whitespace-nowrap">Per Piece × {pp.pieces}</span>
                </li>
              ))}
            </ul>

            {perPersonDynamic && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-sm text-gray-300">
                  Package Price <span className="text-white font-semibold">
                    ${perPersonDynamic.perPersonWhole}
                  </span> / per person
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={addPerPersonPackageToCart}
                    className="bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded"
                  >
                    Add Package
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Customize sections */}
      <div className="max-w-5xl">
        <h2 className="text-xl md:text-2xl font-semibold text-[#F58735] mb-3">Customize your menu</h2>
        {loading ? (
          <p>Loading menu…</p>
        ) : (
          <>
            {['appetizer','main','rice','bread','dessert'].map(course => {
              const need = (selection.slots?.[course] || []).length;
              if (!need) return null;
              const picked = picks[course] || [];
              const list = courseMenus[course] || [];

              return (
                <section key={course} className="mb-4 rounded-xl border border-[#3a3939] bg-[#222222]">
                  <button
                    onClick={() => setOpen(o => ({ ...o, [course]: !o[course] }))}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg md:text-xl font-semibold capitalize">{course}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        (picked.length === need)
                          ? 'border-green-500/60 text-green-300'
                          : 'border-orange-400/60 text-orange-300'
                      }`}>
                        {(picked.length === need) ? '✓ Completed' : `Select ${numToWord(need)}`}
                      </span>
                    </div>
                    <span className={`transition-transform ${open[course] ? 'rotate-180' : ''}`}>▾</span>
                  </button>

                  <Collapse open={open[course]}>
                    {list.length === 0 ? (
                      <div className="px-4 pb-4 text-gray-400 text-sm">No items available for this course yet.</div>
                    ) : (
                      <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {list.map(it => {
                          const active = !!picked.find(p => p.key === it.key);
                          const wouldViolate = !active && !canAddPick(course, it);
                          const disabled = wouldViolate || (!active && picked.length >= need);
                          return (
                            <div
                              key={`${course}-${it.key}`}
                              onClick={() => { if (!disabled || active) togglePick(course, it); }}
                              className={`rounded-lg border p-3 cursor-pointer transition ${
                                active
                                  ? 'bg-[#F58735]/15 border-[#F58735]'
                                  : disabled
                                  ? 'bg-[#201f1f] border-[#3a3939] opacity-60'
                                  : 'bg-[#272525] hover:bg-[#353232] border-[#3a3939]'
                              }`}
                            >
                              <div className="font-medium flex items-center gap-2">
                                <span>{it.name}</span>
                                {it.nonVeg && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-500/60 text-red-300">
                                    Non-Veg
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400">{it.category}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Collapse>
                </section>
              );
            })}
          </>
        )}
      </div>

      {/* Mobile floating cart button (now opens drawer, doesn't navigate) */}
      <button
        onClick={() => setShowCartMobile(true)}
        className="md:hidden fixed bottom-4 right-4 z-40 bg-[#F58735] hover:bg-orange-600 text-black rounded-full shadow-lg px-4 py-3 text-sm flex items-center gap-2"
        disabled={!canContinue}
      >
        <span className="inline-block rounded-full bg-black/20 text-black px-2 py-0.5">
          {cart.length}
        </span>
        Cart • ${cartTotal.toFixed(2)}
      </button>

      {/* Mobile Cart Drawer */}
      {showCartMobile && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowCartMobile(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[92%] max-w-sm bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto translate-x-0 transition-transform">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-[#F58735]">Your Cart</h2>
              <button
                onClick={() => setShowCartMobile(false)}
                className="text-gray-300 hover:text-white text-xl leading-none"
                aria-label="Close cart"
              >
                ×
              </button>
            </div>

            {cart.length === 0 ? (
              <p className="text-gray-400 mb-6">No items yet.</p>
            ) : (
              <>
                <ul className="space-y-4">
                  {cart.map(c => (
                    <li key={`${c.id}-${c.size}`} className="text-sm">
                      <div className="flex justify-between">
                        <div>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-gray-400">
                            {c.sizeLabel} — {c.qty} × ${Number(c.unit).toFixed(2)}
                          </div>
                          {c.details && (
                            <div className="text-xs text-gray-300 whitespace-pre-wrap mt-1">
                              {c.details}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div>${(c.qty * Number(c.unit)).toFixed(2)}</div>
                          <button
                            onClick={() => removeItem(c.id, c.size)}
                            className="text-xs text-red-400 hover:text-red-200"
                          >
                            remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <hr className="my-4 border-[#3a3939]" />
                <div className="text-right font-semibold mb-6">
                  Total: ${cartTotal.toFixed(2)}
                </div>
                <button
                  disabled={!canContinue}
                  onClick={() => {
                    if (!currentUser) {
                      setShowCartMobile(false);
                      nav('/signin', { state: { returnTo: '/checkout' } });
                      return;
                    }
                    const meta = (() => {
                      try { return JSON.parse(localStorage.getItem('i101_order_meta') || '{}'); }
                      catch { return null; }
                    })();
                    setShowCartMobile(false);
                    nav('/checkout', {
                      state: { cart, cartTotal, orderMeta: meta || null, returnTo: '/OrderPackage' },
                    });
                  }}
                  className="w-full bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue →
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Guest limit modal */}
      {showGuestLimit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#262525] border border-[#3a3939] rounded-xl p-5 max-w-md w-full mx-4">
            <h4 className="text-lg font-semibold text-[#F58735] mb-2">Heads up</h4>
            <p className="text-sm text-gray-200 mb-4">
              Online catering order limit is set to <b>100 guests</b>. For larger orders,
              please contact <a href="tel:14696233060" className="text-[#F58735] underline">(469) 623 3060</a>
              {' '}or email <a href="mailto:events@India101.com" className="text-[#F58735] underline">events@India101.com</a>.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowGuestLimit(false)} className="bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// OrderTrays.js — trays flow (with per-category Veg/Non-Veg filter + mobile layout tweaks)
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  fetchAuthSession,
  getCurrentUser,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { decodeJwt } from 'jose';

import useAuth   from '../hooks/useAuth';
import AuthModal from '../components/AuthModal';
import TrayCard  from '../components/TrayCard';
import TraySizesModal from '../components/TraySizesModal';
import India101Logo from '../assets/India101_logo_HighRes.jpg';
import CateringImg from '../assets/India101food.png';

// helper: detect non-veg by name
const isNonVeg = (name = '') => {
  const n = String(name).toLowerCase();
  const tokens = ['chicken','goat','lamb','fish','prawn','murg','mutton','murgh','ghost','maans','macchi','sea food','shrimp'];
  return tokens.some(t => n.includes(t));
};

export default function OrderTrays() {
  const nav      = useNavigate();
  const location = useLocation();
  const auth     = useAuth(() => {});
  const [currentUser, setCurrentUser] = useState(null);
  const [showAuth,   setShowAuth]     = useState(Boolean(location.state?.showAuth));

  // menu
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);

  // Group + sort (Veg A→Z first, Non-Veg A→Z)
  const grouped = useMemo(() => {
    const out = items.reduce((acc, it) => {
      (acc[it.Category] = acc[it.Category] || []).push(it);
      return acc;
    }, {});
    Object.keys(out).forEach(cat => {
      out[cat].sort((a, b) => {
        const aNon = isNonVeg(a.Item);
        const bNon = isNonVeg(b.Item);
        if (aNon !== bNon) return aNon ? 1 : -1;
        return String(a.Item).localeCompare(String(b.Item));
      });
    });
    return out;
  }, [items]);

  // Desired category order
  const desiredOrder = ['Appetizer', 'Main Course', 'Rice', 'Bread', 'Dessert'];
  const categories = Object.keys(grouped).sort((a, b) => {
    const ia = desiredOrder.indexOf(a);
    const ib = desiredOrder.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const [cat, setCat] = useState('');

  // simple per-category filter (resets on category change)
  const [catFilter, setCatFilter] = useState('All'); // 'All' | 'Veg' | 'Non-Veg'
  const isDessert = (c) => String(c || '').toLowerCase() === 'dessert';

  // cart
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('i101_cart')) || []; }
    catch { return []; }
  });
  const cartCount = cart.reduce((n, c) => n + c.qty, 0);
  const cartTotal = cart.reduce((s, c) => s + c.qty * c.unit, 0);

  useEffect(() => {
    localStorage.setItem('i101_cart', JSON.stringify(cart));
  }, [cart]);

  // mobile cart drawer
  const [showCartMobile, setShowCartMobile] = useState(false);

  // tray sizes modal
  const [showTrayInfo, setShowTrayInfo] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const session = await fetchAuthSession();
        const rawId = session.tokens?.idToken?.toString();
        const idPayload = rawId ? decodeJwt(rawId) : {};
        const groups = idPayload['cognito:groups'] || [];
        if (groups.includes('admin')) {
          nav('/admin', { replace: true });
          return;
        }

        const me = await getCurrentUser().catch(() => null);
        if (me) setCurrentUser(me);

        await loadPricing(session);
      } catch (err) {
        console.error('Menu load error:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [nav]);

  // pick initial category (prefer Appetizer when available)
  useEffect(() => {
    if (!categories.length) return;
    if (!cat) {
      if (categories.includes('Appetizer')) setCat('Appetizer');
      else setCat(categories[0]);
    }
  }, [categories, cat]);

  // reset filter when category changes
  useEffect(() => {
    if (!cat) return;
    setCatFilter('All');
  }, [cat]);

  const loadPricing = async (session) => {
    const creds = session?.credentials;
    if (!creds?.accessKeyId) return;

    const db = new DynamoDBClient({
      region: 'us-east-2',
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    });

    const { Items } = await db.send(
      new QueryCommand({
        TableName: 'catering-customer-pricing',
        KeyConditionExpression: '#u = :u',
        ExpressionAttributeNames: { '#u': 'USER' },
        ExpressionAttributeValues: { ':u': { S: 'USER' } },
      })
    );
    setItems(Items.map(unmarshall));
  };

  // capture extras (incl. spiceLevel) and keep distinct IDs per spice
  const addToCart = (sizeKey, qty, unit, item, extras = {}) =>
    setCart(prev => {
      const spice = extras?.spiceLevel || 'NA';
      const lineId = `${item.Item}::${sizeKey}::${spice}`;
      const i = prev.findIndex(c => c.lineId === lineId);
      if (i !== -1) {
        const n = [...prev]; n[i].qty += qty; return n;
      }
      return [...prev, {
        lineId,
        id: item.Item,           // for remove filter
        name: item.Item,
        category: item.Category,
        type: item.Type,         // 'pc' or tray
        size: sizeKey,
        sizeLabel: sizeKey === 'per-piece'
          ? 'Per Piece'
          : sizeKey.replace(/([A-Z])/g, ' $1').trim(),
        qty,
        unit,
        extras,                  // includes spiceLevel
      }];
    });

  const removeLine = (lineId) =>
    setCart(p => p.filter(c => c.lineId !== lineId));

  const handleSignOut = async () => {
    await amplifySignOut({ global:true });
    setCurrentUser(null);
    setCart([]);
    localStorage.removeItem('i101_cart');
  };

  // items after applying Veg/Non-Veg filter (no filter for Dessert)
  const visibleItems = useMemo(() => {
    const list = grouped[cat] || [];
    if (!list.length) return [];
    if (isDessert(cat) || catFilter === 'All') return list;
    if (catFilter === 'Veg') return list.filter(it => !isNonVeg(it.Item));
    if (catFilter === 'Non-Veg') return list.filter(it => isNonVeg(it.Item));
    return list;
  }, [grouped, cat, catFilter]);

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-4 md:p-6 md:pr-[24rem] relative">
      {/* 🔶 Softer faded background (very subtle, proportional) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none select-none"
        style={{
          backgroundImage: `url(${CateringImg})`,
          backgroundSize: 'contain',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed',
        }}
      />

      {/* Wrap content above background */}
      <div className="relative z-10">
        {/* ===== Desktop header (unchanged) ===== */}
        <div className="hidden md:flex items-center justify-between mb-4 md:mb-6 mt-3 md:mt-4">
          <div className="flex items-center">
            <img
              src={India101Logo}
              alt="India 101 Logo"
              className="h-12 md:h-16 object-contain"
            />
            <span className="ml-3 text-xl md:text-2xl font-bold text-orange-400">
              Order Trays
            </span>
          </div>

          {/* Desktop auth controls */}
          <div className="items-center gap-4 text-sm hidden md:flex">
            {currentUser ? (
              <>
                <span>
                  Welcome,&nbsp;{currentUser.signInDetails?.loginId ?? currentUser.username}
                </span>
                <button
                  onClick={handleSignOut}
                  className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <button
                onClick={() => nav('/signin', { state: { returnTo: '/OrderTrays' } })}
                className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded"
              >
                Sign In / Create Account
              </button>
            )}
          </div>
        </div>

        {/* ===== Mobile header (centered logo, then title/auth row) ===== */}
        <div className="md:hidden mt-4 mb-3">
          {/* Centered logo */}
          <div className="flex justify-center mb-3">
            <img
              src={India101Logo}
              alt="India 101 Logo"
              className="h-12 object-contain"
            />
          </div>

          {/* Row: title left, auth right */}
          <div className="flex items-center justify-between">
            <span className="text-xl font-bold text-orange-400">Order Trays</span>
            {currentUser ? (
              <button
                onClick={handleSignOut}
                className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm"
              >
                Sign Out
              </button>
            ) : (
              <button
                onClick={() => nav('/signin', { state: { returnTo: '/OrderTrays' } })}
                className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded text-sm"
              >
                Sign In / Create Account
              </button>
            )}
          </div>
        </div>

        {/* Back button (centered on mobile, left on desktop) */}
        <div className="text-center md:text-left">
          <button
            onClick={() => nav('/')}
            className="mt-3 md:mt-4 mb-2 md:mb-4 text-sm bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#F58735]/60 rounded px-3 py-1"
          >
            ‹ Start Over
          </button>
        </div>

        {/* TOP Category selector (centered on mobile) */}
        {categories.length > 1 && (
          <div className="mb-2 md:mb-3">
            <div className="flex justify-center md:justify-start">
              <div className="flex md:flex-wrap gap-2 md:gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
                {categories.map((cName) => (
                  <button
                    key={cName}
                    onClick={() => setCat(cName)}
                    className={`px-4 py-1 rounded-full text-sm border whitespace-nowrap transition ${
                      cName === cat
                        ? 'bg-[#F58735] border-[#F58735] text-black'
                        : 'bg-[#2c2a2a] hover:bg-[#3a3939] border-[#3a3939] text-white'
                    }`}
                  >
                    {cName}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Minimal Veg / Non-Veg filter (hidden for Dessert) — centered on mobile */}
        {!isDessert(cat) && (grouped[cat]?.length > 0) && (
          <div className="mb-3 md:mb-4">
            <div className="flex justify-center md:justify-start">
              <div className="inline-flex items-center gap-1 bg-[#2c2a2a] border border-[#3a3939] rounded-full p-1">
                {['All','Veg','Non-Veg'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => setCatFilter(opt)}
                    className={`px-3 py-1 rounded-full text-xs md:text-sm transition ${
                      catFilter === opt
                        ? 'bg-[#F58735] text-black'
                        : 'hover:bg-[#3a3939] text-white'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Trays UI header with learn button */}
        <div className="mb-4 md:mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <p className="text-base md:text-lg text-center md:text-left m-0">
            Select tray size and quantity for each item:
          </p>
          <button
            type="button"
            onClick={() => setShowTrayInfo(true)}
            className="self-center md:self-auto border border-[#F58735] text-[#F58735] hover:bg-[#F58735]/10 px-4 py-2 rounded text-sm"
          >
            Learn about tray sizes
          </button>
        </div>

        {loading ? (
          <p>Loading menu…</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {visibleItems.map(it => (
              <TrayCard
                key={it.Item}
                item={{ ...it, isNonVeg: isNonVeg(it.Item) }}  // pass flag for badge
                onAdd={(size, qty, unit, extras) => addToCart(size, qty, unit, it, extras)}
              />
            ))}
          </div>
        )}

        {/* Bottom category selector (unchanged; left on desktop, centered on mobile via container) */}
        {categories.length > 1 && (
          <div className="mt-4 md:mt-6">
            <div className="flex justify-center md:justify-start">
              <div className="flex md:flex-wrap gap-2 md:gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
                {categories.map(cName => (
                  <button
                    key={cName}
                    onClick={() => setCat(cName)}
                    className={`px-4 py-1 rounded-full text-sm border whitespace-nowrap ${
                      cName === cat
                        ? 'bg-[#F58735] border-[#F58735]'
                        : 'bg-[#2c2a2a] hover:bg-[#3a3939] border-[#3a3939]'
                    }`}
                  >
                    {cName}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Cart Pane — desktop */}
        <aside className="hidden md:block fixed top-0 right-4 w-80 h-full bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto">
          <h2 className="text-xl font-semibold text-[#F58735] mb-4">Your Cart</h2>
          {cart.length === 0 ? (
            <p className="text-gray-400 mb-6">Cart is empty.</p>
          ) : (
            <>
              <ul className="space-y-4">
                {cart.map(c => (
                  <li key={`${c.lineId}`} className="text-sm flex justify-between">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-gray-400">
                        {c.qty} × {c.sizeLabel} @ ${Number(c.unit).toFixed(2)}
                        {c.extras?.spiceLevel ? (
                          <span className="ml-1">• Spice: {c.extras.spiceLevel}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <div>${(c.qty * Number(c.unit)).toFixed(2)}</div>
                      <button
                        onClick={() => removeLine(c.lineId)}
                        className="text-xs text-red-400 hover:text-red-200"
                      >
                        remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <hr className="my-4 border-[#3a3939]" />
              <div className="text-right font-semibold mb-3">
                Total: ${cartTotal.toFixed(2)}
              </div>
              <button
                type="button"
                onClick={() => setShowTrayInfo(true)}
                className="w-full mb-3 border border-[#F58735] text-[#F58735] hover:bg-[#F58735]/10 px-4 py-2 rounded text-sm"
              >
                Learn about tray sizes
              </button>
              <button
                disabled={cart.length === 0}
                onClick={() => {
                  if (cart.length === 0) return;
                  if (!currentUser) {
                    nav('/signin', { state: { returnTo: '/checkout' } });
                    return;
                  }
                  nav('/checkout', { state: { cart, cartTotal } });
                }}
                className="w-full bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue &rarr;
              </button>
            </>
          )}
        </aside>

        {/* Mobile floating cart button */}
        <button
          onClick={() => setShowCartMobile(true)}
          className="md:hidden fixed bottom-4 right-4 z-40 bg-[#F58735] hover:bg-orange-600 text-black rounded-full shadow-lg px-4 py-3 text-sm flex items-center gap-2"
        >
          <span className="inline-block rounded-full bg-black/20 text-black px-2 py-0.5">
            {cartCount}
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
                <p className="text-gray-400 mb-6">Cart is empty.</p>
              ) : (
                <>
                  <ul className="space-y-4">
                    {cart.map(c => (
                      <li key={`${c.lineId}`} className="text-sm">
                        <div className="flex justify-between">
                          <div>
                            <div className="font-medium">{c.name}</div>
                            <div className="text-gray-400">
                              {c.qty} × {c.sizeLabel} @ ${Number(c.unit).toFixed(2)}
                              {c.extras?.spiceLevel ? (
                                <span className="ml-1">• Spice: {c.extras.spiceLevel}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-right">
                            <div>${(c.qty * Number(c.unit)).toFixed(2)}</div>
                            <button
                              onClick={() => removeLine(c.lineId)}
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
                  <div className="text-right font-semibold mb-3">
                    Total: ${cartTotal.toFixed(2)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTrayInfo(true)}
                    className="w-full mb-3 border border-[#F58735] text-[#F58735] hover:bg-[#F58735]/10 px-4 py-2 rounded text-sm"
                  >
                    Learn about tray sizes
                  </button>
                  <button
                    disabled={cart.length === 0}
                    onClick={() => {
                      if (cart.length === 0) return;
                      if (!currentUser) {
                        setShowCartMobile(false);
                        nav('/signin', { state: { returnTo: '/checkout' } });
                        return;
                      }
                      setShowCartMobile(false);
                      nav('/checkout', { state: { cart, cartTotal } });
                    }}
                    className="w-full bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Continue &rarr;
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Auth Modal */}
        <AuthModal
          isOpen={showAuth && !currentUser}
          onClose={() => setShowAuth(false)}
          onSuccess={async () => {
            const me   = await getCurrentUser().catch(() => null);
            const sess = await fetchAuthSession();
            const rawLogin = sess.tokens?.idToken?.toString();
            const idPayload = rawLogin ? decodeJwt(rawLogin) : {};
            const groups = idPayload['cognito:groups'] || [];
            if (groups.includes('admin')) {
              nav('/admin', { replace:true });
              return;
            }
            if (me) setCurrentUser(me);
            setShowAuth(false);
          }}
          {...auth}
        />

        {/* Tray sizes modal */}
        <TraySizesModal open={showTrayInfo} onClose={() => setShowTrayInfo(false)} />
      </div>
    </div>
  );
}

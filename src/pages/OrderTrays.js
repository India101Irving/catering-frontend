// OrderTrays.js — refactor of your trays flow (from CustomerWizard)
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

export default function OrderTrays() {
  const nav      = useNavigate();
  const location = useLocation();
  const auth     = useAuth(() => {});
  const [currentUser, setCurrentUser] = useState(null);
  const [showAuth,   setShowAuth]     = useState(Boolean(location.state?.showAuth));

  // menu
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);

  const grouped = useMemo(
    () => items.reduce((acc, it) => {
      (acc[it.Category] = acc[it.Category] || []).push(it);
      return acc;
    }, {}),
    [items]
  );
  const categories = Object.keys(grouped);
  const [cat, setCat] = useState('');

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

  // pick initial category
  useEffect(() => {
    if (!cat && categories.length) setCat(categories[0]);
  }, [categories, cat]);

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

  const addToCart = (sizeKey, qty, unit, item) =>
    setCart(prev => {
      const i = prev.findIndex(c => c.id === item.Item && c.size === sizeKey);
      if (i !== -1) {
        const n = [...prev]; n[i].qty += qty; return n;
      }
      return [...prev, {
        id: item.Item,
        name: item.Item,
        size: sizeKey,
        sizeLabel: sizeKey === 'per-piece'
          ? 'Per Piece'
          : sizeKey.replace(/([A-Z])/g, ' $1'),
        qty,
        unit,
      }];
    });

  const removeItem = (id, size) =>
    setCart(p => p.filter(c => !(c.id === id && c.size === size)));

  const handleSignOut = async () => {
    await amplifySignOut({ global:true });
    setCurrentUser(null);
    setCart([]);
    localStorage.removeItem('i101_cart');
  };

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-4 md:p-6 md:pr-[24rem] relative">
      {/* Header (desktop fixed, mobile inline) */}
      <div className="hidden md:flex absolute top-4 right-[24rem] items-center gap-4 text-sm">
        {currentUser ? (
          <>
            <span>
              Welcome,&nbsp;
              {currentUser.signInDetails?.loginId ?? currentUser.username}
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

      {/* Mobile topbar auth */}
      <div className="md:hidden flex justify-end mb-2">
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

      {/* Cart Pane — desktop */}
      <aside className="hidden md:block fixed top-0 right-4 w-80 h-full bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto">
        <h2 className="text-xl font-semibold text-[#F58735] mb-4">Your Cart</h2>
        {cart.length === 0 ? (
          <p className="text-gray-400 mb-6">Cart is empty.</p>
        ) : (
          <>
            <ul className="space-y-4">
              {cart.map(c => (
                <li key={`${c.id}-${c.size}`} className="text-sm flex justify-between">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-gray-400">
                      {c.qty} × {c.sizeLabel} @ ${c.unit}
                    </div>
                  </div>
                  <div className="text-right">
                    <div>${(c.qty * c.unit).toFixed(2)}</div>
                    <button
                      onClick={() => removeItem(c.id, c.size)}
                      className="text-xs text-red-400 hover:text-red-200"
                    >
                      remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <hr className="my-4 border-[#3a3939]" />
            <div className="text-right font-semibold mb-6">
              Total: ${cartTotal.toFixed(2)}
            </div>
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

      {/* Title & Back */}
   
    <div className="text-center md:text-left">
        <h1 className="text-2xl md:text-3xl font-bold text-orange-400">India 101 Tray Order</h1>
      </div>
      <div className="text-center md:text-left">
        <button
          onClick={() => nav('/')}
          className="mt-3 md:mt-4 mb-4 md:mb-6 text-sm bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#F58735]/60 rounded px-3 py-1"
        >
          ‹ Start Over
        </button>
      </div>

      {/* Trays UI */}
      <p className="mb-4 md:mb-6 text-base md:text-lg text-center md:text-left">
        Select tray size and quantity for each item:
      </p>

      {categories.length > 1 && (
        <div className="mb-4 md:mb-6">
          <div className="flex md:flex-wrap gap-2 md:gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`px-4 py-1 rounded-full text-sm border whitespace-nowrap ${
                  c === cat
                    ? 'bg-[#F58735] border-[#F58735]'
                    : 'bg-[#2c2a2a] hover:bg-[#3a3939] border-[#3a3939]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p>Loading menu…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {(grouped[cat] || []).map(it => (
            <TrayCard
              key={it.Item}
              item={it}
              onAdd={(size, qty, unit) => addToCart(size, qty, unit, it)}
            />
          ))}
        </div>
      )}

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
                    <li key={`${c.id}-${c.size}`} className="text-sm">
                      <div className="flex justify-between">
                        <div>
                          <div className="font-medium">{c.name}</div>
                          <div className="text-gray-400">
                            {c.qty} × {c.sizeLabel} @ ${Number(c.unit).toFixed(2)}
                          </div>
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
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  fetchAuthSession,
  getCurrentUser,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { decodeJwt } from 'jose';   // ⬅️ add once at the top of the file


import useAuth   from '../hooks/useAuth';
import AuthModal from '../components/AuthModal';
import TrayCard  from '../components/TrayCard';

export default function CustomerWizard() {
  /* ───────── navigation & auth ───────── */
  const nav      = useNavigate();
  const location = useLocation();
  const auth     = useAuth(() => {});
  const [currentUser, setCurrentUser] = useState(null);
  const [showAuth,   setShowAuth]     = useState(false);

  /* ───────── page flow ───────── */
  const [step, setStep] = useState(
    location.state?.step === 'trays' ? 'trays' : 'welcome'
  ); // welcome | trays | packages

  /* ───────── menu data ───────── */
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

  /* ───────── cart (persisted) ───────── */
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('i101_cart')) || []; }
    catch { return []; }
  });
  const cartCount = cart.reduce((n, c) => n + c.qty, 0);
  const cartTotal = cart.reduce((s, c) => s + c.qty * c.unit, 0);

  useEffect(() => {
    localStorage.setItem('i101_cart', JSON.stringify(cart));
  }, [cart]);

  /* ───────── initial load + admin redirect ───────── */
  useEffect(() => {
    const init = async () => {
      try {
        const session = await fetchAuthSession();
 const idRaw = session.tokens?.idToken?.toString();
 console.log('🪪 initial ID-token payload →',
   idRaw ? decodeJwt(idRaw) : '(no token)');



 const rawId = session.tokens?.idToken?.toString();
 const idPayload = rawId ? decodeJwt(rawId) : {};   // 🛡 safe decode

const groups = idPayload['cognito:groups'] || [];
        if (groups.includes('admin')) {
          nav('/admin', { replace: true });
          return;
        }

        const me = await getCurrentUser().catch(() => null);
        if (me) setCurrentUser(me);

        await loadPricing(session);
      } catch (err) {
        console.error('Menu load error:', err);         // keep UI usable
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [nav]);

  /* pick first tab after menu arrives */
  useEffect(() => {
    if (!cat && categories.length) setCat(categories[0]);
  }, [categories, cat]);

  /* ───────── helpers ───────── */
  const loadPricing = async (session) => {
    const creds = session?.credentials;
    if (!creds?.accessKeyId) return;   // fallback: guests w/o ID pool creds

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

  /* ───────── UI ───────── */
  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-6 pr-[24rem] relative">
      {/* ===== Header ===== */}
      <div className="absolute top-4 right-[24rem] flex items-center gap-4 text-sm">
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
            onClick={() => setShowAuth(true)}
            className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded"
          >
            Sign In / Create Account
          </button>
        )}
        <span className="bg-[#2c2a2a] px-3 py-1 rounded">
          🛒 {cartCount} | ${cartTotal.toFixed(2)}
        </span>
      </div>

      {/* ===== Cart Pane ===== */}
      <aside className="fixed top-0 right-4 w-80 h-full bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto">
        {step !== 'packages' && (
          <>
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
                    if (!currentUser) { setShowAuth(true); return; }
                    nav('/checkout', { state: { cart, cartTotal } });
                  }}
                  className="w-full bg-[#F58735] hover:bg-orange-600 px-4 py-2 rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue →
                </button>
              </>
            )}
          </>
        )}
      </aside>

      {/* ===== Title & Back Button ===== */}
      <h1 className="text-3xl font-bold text-orange-400">India 101 Catering Wizard</h1>
      {step !== 'welcome' && (
        <button
          onClick={() => setStep('welcome')}
          className="mt-4 mb-6 text-sm bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#F58735]/60 rounded px-3 py-1"
        >
          ‹ Back to menu
        </button>
      )}

      {/* ===== Welcome Step ===== */}
      {step === 'welcome' && (
        <>
          <p className="mb-10 text-lg max-w-3xl">
            Welcome! 👋 Would you like to order trays for your event or create a per-person package?
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl">
            <button
              onClick={() => setStep('trays')}
              className="flex flex-col justify-between bg-[#272525] hover:bg-[#353232] border border-[#F58735]/60 rounded-xl p-6 text-left transition"
            >
              <div>
                <h2 className="text-2xl font-semibold text-[#F58735] mb-2">Order Catering Trays</h2>
                <p className="text-sm text-gray-300">
                  Recommended for smaller or highly customised orders.
                </p>
              </div>
              <span className="mt-6 self-end text-[#F58735] font-medium">Start →</span>
            </button>

            <button
              onClick={() => setStep('packages')}
              className="flex flex-col justify-between bg-[#272525] hover:bg-[#353232] border border-[#F58735]/60 rounded-xl p-6 text-left transition"
            >
              <div>
                <h2 className="text-2xl font-semibold text-[#F58735] mb-2">Order Per-Person Packages</h2>
                <p className="text-sm text-gray-300">Best pricing & quick ordering for up to 100 guests.</p>
              </div>
              <span className="mt-6 self-end text-[#F58735] font-medium">Coming Soon →</span>
            </button>
          </div>
        </>
      )}

      {/* ===== Trays Step ===== */}
      {step === 'trays' && (
        <>
          <p className="mb-6 text-lg">Select tray size and quantity for each item:</p>

          {categories.length > 1 && (
            <div className="flex flex-wrap gap-3 mb-6">
              {categories.map(c => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={`px-4 py-1 rounded-full text-sm border ${
                    c === cat
                      ? 'bg-[#F58735] border-[#F58735]'
                      : 'bg-[#2c2a2a] hover:bg-[#3a3939] border-[#3a3939]'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p>Loading menu…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(grouped[cat] || []).map(it => (
                <TrayCard
                  key={it.Item}
                  item={it}
                  onAdd={(size, qty, unit) => addToCart(size, qty, unit, it)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ===== Packages Placeholder ===== */}
      {step === 'packages' && (
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold text-[#F58735] mb-4">Per-Person Packages</h2>
          <p className="text-gray-300 mb-6">
            We’re putting the finishing touches on this feature. Check back soon—or choose “Order Catering Trays” to build a custom menu right now!
          </p>
          <button
            onClick={() => setStep('welcome')}
            className="bg-[#F58735] hover:bg-orange-600 px-6 py-2 rounded"
          >
            ‹ Back
          </button>
        </div>
      )}

      {/* ===== Auth Modal ===== */}
      <AuthModal
        isOpen={showAuth && !currentUser}
        onClose={() => setShowAuth(false)}
        onSuccess={async () => {
          const me   = await getCurrentUser().catch(() => null);
          const sess = await fetchAuthSession();
 const loginRaw = sess.tokens?.idToken?.toString();
 console.log('🪪 post-login ID-token payload →',
   loginRaw ? decodeJwt(loginRaw) : '(no token)');



 const rawLogin = sess.tokens?.idToken?.toString();
 const idPayload = rawLogin ? decodeJwt(rawLogin) : {}; // 🛡 safe decode
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

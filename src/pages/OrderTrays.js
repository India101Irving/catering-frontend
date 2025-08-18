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
    <div className="min-h-screen bg-[#1c1b1b] text-white p-6 pr-[24rem] relative">
      {/* Header */}
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
      </div>

      {/* Cart Pane */}
      <aside className="fixed top-0 right-4 w-80 h-full bg-[#2c2a2a] border-l border-[#3a3939] p-4 overflow-y-auto">
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
      </aside>

      {/* Title & Back */}
      <h1 className="text-3xl font-bold text-orange-400">India 101 Catering Wizard</h1>
      <button
        onClick={() => nav('/')}
        className="mt-4 mb-6 text-sm bg-[#2c2a2a] hover:bg-[#3a3939] border border-[#F58735]/60 rounded px-3 py-1"
      >
        ‹ Back to menu
      </button>

      {/* Trays UI */}
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

// index.js — chooser (trays vs packages)
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchAuthSession,
  getCurrentUser,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { decodeJwt } from 'jose';

export default function IndexChooser() {
  const nav = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [cartCount, setCartCount] = useState(0);
  const [cartTotal, setCartTotal] = useState(0);

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
      } catch {}
      // cart snapshot
      try {
        const cart = JSON.parse(localStorage.getItem('i101_cart')) || [];
        setCartCount(cart.reduce((n, c) => n + c.qty, 0));
        setCartTotal(cart.reduce((s, c) => s + c.qty * c.unit, 0));
      } catch {}
    };
    init();
  }, [nav]);

  const handleSignOut = async () => {
    await amplifySignOut({ global: true });
    setCurrentUser(null);
    localStorage.removeItem('i101_cart');
    setCartCount(0);
    setCartTotal(0);
  };

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-6 relative">
      {/* Header */}
      <div className="absolute top-4 right-4 flex items-center gap-4 text-sm">
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
            onClick={() => nav('/OrderTrays', { state: { showAuth: true } })}
            className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded"
          >
            Sign In / Create Account
          </button>
        )}
        <span className="bg-[#2c2a2a] px-3 py-1 rounded">
          🛒 {cartCount} | ${cartTotal.toFixed(2)}
        </span>
      </div>

      <h1 className="text-3xl font-bold text-orange-400">India 101 Catering Wizard</h1>
      <p className="mb-10 mt-4 text-lg max-w-3xl">
        Welcome! 👋 Would you like to order trays for your event or create a per-person package?
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl">
        <button
          onClick={() => nav('/OrderPackage')}
          className="flex flex-col justify-between bg-[#272525] hover:bg-[#353232] border border-[#F58735]/60 rounded-xl p-6 text-left transition"
        >
          <div>
            <h2 className="text-2xl font-semibold text-[#F58735] mb-2">
              Order Per-Person Packages
            </h2>
            <p className="text-sm text-gray-300">
              Best pricing & quick ordering for up to 100 guests.
            </p>
          </div>
          <span className="mt-6 self-end text-[#F58735] font-medium">Start →</span>
        </button>
           <button
          onClick={() => nav('/OrderTrays')}
          className="flex flex-col justify-between bg-[#272525] hover:bg-[#353232] border border-[#F58735]/60 rounded-xl p-6 text-left transition"
        >
          <div>
            <h2 className="text-2xl font-semibold text-[#F58735] mb-2">
              Order Catering Trays
            </h2>
            <p className="text-sm text-gray-300">
              Recommended for smaller or highly customised orders.
            </p>
          </div>
          <span className="mt-6 self-end text-[#F58735] font-medium">Start →</span>
        </button>
      </div>
    </div>
  );
}

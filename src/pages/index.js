// src/pages/index.js — chooser (trays vs packages) with mobile-friendly promos & notices
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
        setCartCount(cart.reduce((n, c) => n + (Number(c.qty) || 0), 0));
        setCartTotal(cart.reduce((s, c) => s + (Number(c.qty) || 0) * Number(c.unit || 0), 0));
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
    <div className="min-h-screen bg-[#1c1b1b] text-white p-4 md:p-6 relative">
      {/* Header — desktop absolute, mobile inline */}
      <div className="hidden md:flex absolute top-4 right-4 items-center gap-4 text-sm">
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

      {/* Mobile topbar */}
      <div className="md:hidden mb-3 flex items-center justify-between">
        <span className="bg-[#2c2a2a] px-3 py-1 rounded text-sm">
          🛒 {cartCount} | ${cartTotal.toFixed(2)}
        </span>
        {currentUser ? (
          <button
            onClick={handleSignOut}
            className="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-sm"
          >
            Sign Out
          </button>
        ) : (
          <button
            onClick={() => nav('/OrderTrays', { state: { showAuth: true } })}
            className="bg-[#F58735] hover:bg-orange-600 px-3 py-1 rounded text-sm"
          >
            Sign In / Create Account
          </button>
        )}
      </div>

      {/* Title */}
      <h1 className="text-2xl md:text-3xl font-bold text-orange-400">India 101 Catering Wizard</h1>
      <p className="mb-4 md:mb-6 mt-3 md:mt-4 text-base md:text-lg max-w-3xl">
        Welcome! 👋 Would you like to order trays for your event or create a per-person package?
      </p>

      {/* Promo Banner */}
      <div className="mb-4 md:mb-6 rounded-xl border border-[#3a3939] bg-gradient-to-br from-[#2a2626] to-[#1f1d1d] p-4 md:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-lg md:text-xl font-semibold text-[#F58735]">
              Online Ordering Special — 10% Off
            </div>
            <div className="text-sm text-neutral-300">
              Use code <span className="font-mono bg-black/30 px-2 py-0.5 rounded">online10</span> at checkout.
            </div>
          </div>
          <button
            onClick={() => nav('/OrderPackage')}
            className="w-full sm:w-auto bg-[#F58735] hover:bg-orange-600 text-black font-medium px-4 py-2 rounded"
          >
            Start an Order →
          </button>
        </div>
      </div>

      {/* Notices */}
      <div className="mb-4 md:mb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-[#3a3939] bg-[#232222] p-4">
          <div className="text-sm text-neutral-200">
            <span className="font-semibold text-[#F58735]">Heads up:</span>{' '}
            Online **per-person packages** are limited to <b>100 guests</b>. For larger events or special requests, please contact us.
          </div>
        </div>
        <div className="rounded-xl border border-[#3a3939] bg-[#232222] p-4">
          <div className="text-sm">
            <div className="text-neutral-300">Questions or issues?</div>
            <div className="mt-1">
              Call <a href="tel:14696233060" className="text-[#F58735] underline">(469) 623-3060</a>{' '}
              or email <a href="mailto:events@India101.com" className="text-[#F58735] underline">events@India101.com</a>.
            </div>
          </div>
        </div>
      </div>

      {/* Chooser Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 max-w-4xl">
        <button
          onClick={() => nav('/OrderPackage')}
          className="flex flex-col justify-between bg-[#272525] hover:bg-[#353232] border border-[#F58735]/60 rounded-xl p-5 md:p-6 text-left transition"
        >
          <div>
            <h2 className="text-xl md:text-2xl font-semibold text-[#F58735] mb-2">
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
          className="flex flex-col justify-between bg-[#272525] hover:bg-[#353232] border border-[#F58735]/60 rounded-xl p-5 md:p-6 text-left transition"
        >
          <div>
            <h2 className="text-xl md:text-2xl font-semibold text-[#F58735] mb-2">
              Order Catering Trays
            </h2>
            <p className="text-sm text-gray-300">
              Recommended for smaller or highly customized orders.
            </p>
          </div>
          <span className="mt-6 self-end text-[#F58735] font-medium">Start →</span>
        </button>
      </div>

      {/* Disclaimer / Terms box */}
      <div className="max-w-4xl mt-6">
        <div className="rounded-xl border border-[#3a3939] bg-[#232222] p-4">
          <div className="text-sm text-neutral-300">
            <span className="font-semibold text-[#F58735]">Terms of Use:</span>{' '}
            By proceeding with the online ordering system, you acknowledge and agree to our
            ordering policies, pricing, and availability, and consent to be contacted regarding
            your order as needed. Submitting an order implies your acceptance of these terms.
          </div>
        </div>
      </div>
    </div>
  );
}

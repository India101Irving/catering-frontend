// src/pages/ThankYou.js
import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const readCheckout = () => {
  try { return JSON.parse(sessionStorage.getItem('i101_checkout')) || null; }
  catch { return null; }
};

export default function ThankYou() {
  const nav = useNavigate();
  const { state, search } = useLocation();

  // Prefer router state (cash flow sends placedAt); else fall back to the last checkout snapshot
  const draft = useMemo(() => state || readCheckout() || {}, [state]);
  const customerName = draft?.customer?.name || '';

  // We want the time the order was placed, NOT the scheduled pickup/delivery time.
  // Priority: state.placedAt -> (fallback) now.
  const placedAtLabel = useMemo(() => {
    const iso = draft?.placedAt || draft?.placed_at || null;
    try { return iso ? new Date(iso).toLocaleString() : new Date().toLocaleString(); }
    catch { return new Date().toLocaleString(); }
  }, [draft]);

  // If arriving from Stripe success URL, we'll have session_id (not used here, but harmless)
  const params = new URLSearchParams(search);
  const hasStripeSession = !!params.get('session_id');

  useEffect(() => {
    // Clear cart/checkout after rendering
    const t = setTimeout(() => {
      localStorage.removeItem('i101_cart');
      sessionStorage.removeItem('i101_checkout');
      sessionStorage.removeItem('i101_checkout_draft');
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white flex items-center justify-center p-6">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg bg-[#2c2a2a] border border-[#3a3939] rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-[#F58735] flex items-center justify-center font-bold text-black">✓</div>
          <h1 className="text-2xl font-bold text-orange-400">Thank you!</h1>
        </div>

        <p className="text-sm text-neutral-200">
          {customerName ? <>Thank you, <span className="font-medium">{customerName}</span>. </> : null}
          Your order has been placed.
        </p>
        <p className="text-sm text-neutral-300 mt-1">
          <span className="text-neutral-400">Order placed:</span> {placedAtLabel}
        </p>

        <div className="mt-6 flex justify-end">
          <button
            onClick={() => nav('/', { replace: true })}
            className="px-5 py-2 rounded bg-[#F58735] hover:bg-orange-600 text-black font-medium"
          >
            Back to Home
          </button>
        </div>

        {hasStripeSession ? (
          <div className="mt-3 text-[11px] text-neutral-500">Payment confirmed via Stripe Checkout.</div>
        ) : null}
      </div>
    </div>
  );
}

// src/pages/SignIn.js
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import useAuth from '../hooks/useAuth';
import AuthModal from '../components/AuthModal';

export default function SignIn() {
  const nav = useNavigate();
  const location = useLocation();
  const auth = useAuth(() => {});
  const [open, setOpen] = useState(true); // open modal immediately
  const next =
    location.state?.returnTo ||
    new URLSearchParams(location.search).get('next') ||
    '/';

  useEffect(() => {
    // If already signed in, bounce to next
    getCurrentUser().then(() => nav(next, { replace: true })).catch(() => {});
  }, [nav, next]);

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-6 flex items-center justify-center relative">
      {/* Subtle backdrop like your ThankYou page */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg">
        {/* Title (kept simple; the modal itself matches your existing look) */}
        <h1 className="text-2xl font-bold text-orange-400 mb-4 text-center">
          Sign In to Continue
        </h1>

        {/* The exact same AuthModal component you already use */}
        <AuthModal
          isOpen={open}
          onClose={() => {
            setOpen(false);
            nav('/', { replace: true });
          }}
          onSuccess={async () => {
            try { await getCurrentUser(); } catch {}
            nav(next, { replace: true });
          }}
          {...auth}
        />

        {/* Fallback button if someone closes the modal or JS delays */}
        {!open && (
          <div className="bg-[#2c2a2a] border border-[#3a3939] rounded-2xl p-4 text-center">
            <p className="text-sm text-neutral-300 mb-3">
              You closed the sign-in window. Would you like to open it again?
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setOpen(true)}
                className="px-4 py-2 rounded bg-[#F58735] hover:bg-orange-600 text-black"
              >
                Open Sign-In
              </button>
              <button
                onClick={() => nav('/', { replace: true })}
                className="px-4 py-2 rounded bg-[#3a3939] hover:bg-[#4a4949]"
              >
                Back Home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

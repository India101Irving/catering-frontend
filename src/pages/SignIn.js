import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentUser } from 'aws-amplify/auth';
import useAuth from '../hooks/useAuth';
import AuthModal from '../components/AuthModal';

export default function SignIn() {
  const nav = useNavigate();
  const location = useLocation();
  const auth = useAuth(() => {});

  const [open, setOpen] = useState(true);

  const next = useMemo(() => {
    return (
      location.state?.returnTo ||
      new URLSearchParams(location.search).get('next') ||
      '/'
    );
  }, [location.state, location.search]);

  // Already signed in? go to next
  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then(() => mounted && nav(next, { replace: true }))
      .catch(() => {});
    return () => { mounted = false; };
  }, [nav, next]);

  const hasError = Boolean(auth?.loginError);

  // Wrap login so modal keeps open on failure
  const handleLoginWrapped = async () => {
    const ok = await auth.handleLogin();
    if (!ok && !open) setOpen(true);
    return ok; // AuthModal should treat false as "stay open"
  };

  // Defensive: verify session before navigating
  const verifySignedIn = async () => {
    try { await getCurrentUser(); return true; } catch { return false; }
  };

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-6 flex items-center justify-center relative">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-lg">
        <h1 className="text-2xl font-bold text-orange-400 mb-3 text-center">
          Sign In to Continue
        </h1>

        {/* Error banner (page-level, subtle) */}
        {hasError && (
          <div className="mb-3 text-center text-sm text-red-300">
            {String(auth.loginError)}
          </div>
        )}

        {/* IMPORTANT: spread {...auth} FIRST, then override with our props */}
        <AuthModal
          isOpen={open}
          {...auth}
          error={auth?.loginError}
          handleLogin={handleLoginWrapped}
          onClose={() => {
            // Treat any onClose as an explicit X (your modal calls this on X)
            setOpen(false);
            auth?.clearLoginError?.();
            nav('/', { replace: true });
          }}
          onSuccess={async () => {
            const ok = await verifySignedIn();
            if (!ok) {
              if (!open) setOpen(true);
              return;
            }
            auth?.clearLoginError?.();
            setOpen(false);
            nav(next, { replace: true });
          }}
          onError={() => {
            if (!open) setOpen(true);
          }}
        />

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

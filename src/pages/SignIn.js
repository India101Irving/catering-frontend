// src/pages/SignIn.js
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentUser, resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import useAuth from '../hooks/useAuth';
import AuthModal from '../components/AuthModal';

export default function SignIn() {
  const nav = useNavigate();
  const location = useLocation();
  const auth = useAuth(() => {});

  const [open, setOpen] = useState(true);

  // Forgot Password state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [fpStep, setFpStep] = useState('request'); // 'request' | 'confirm' | 'done'
  const [fpEmail, setFpEmail] = useState('');
  const [fpCode, setFpCode] = useState('');
  const [fpPassword, setFpPassword] = useState('');
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState('');
  const [fpMsg, setFpMsg] = useState('');

  const next = useMemo(() => {
    return (
      location.state?.returnTo ||
      new URLSearchParams(location.search).get('next') ||
      '/'
    );
  }, [location.state, location.search]);

  useEffect(() => {
    let mounted = true;
    getCurrentUser()
      .then(() => mounted && nav(next, { replace: true }))
      .catch(() => {});
    return () => { mounted = false; };
  }, [nav, next]);

  const hasError = Boolean(auth?.loginError);

  const handleLoginWrapped = async () => {
    const ok = await auth.handleLogin();
    if (!ok && !open) setOpen(true);
    return ok;
  };

  const verifySignedIn = async () => {
    try { await getCurrentUser(); return true; } catch { return false; }
  };

  // Forgot Password handlers
  const openForgotFlow = () => {
    setFpStep('request');
    // Prefill from login form username first, then any stored email
    const prefill = (auth?.loginForm?.username || auth?.email || '').trim();
    setFpEmail(prefill);
    setFpCode('');
    setFpPassword('');
    setFpError('');
    setFpMsg('');
    setForgotOpen(true);
  };

  const closeForgotFlow = () => {
    setForgotOpen(false);
    setFpLoading(false);
    setFpError('');
    setFpMsg('');
  };

  const handleRequestCode = async (e) => {
    e?.preventDefault?.();
    setFpError('');
    setFpMsg('');
    if (!fpEmail) { setFpError('Please enter your email.'); return; }
    setFpLoading(true);
    try {
      await resetPassword({ username: fpEmail.trim() });
      setFpStep('confirm');
      setFpMsg('Verification code sent. Check your email.');
    } catch (err) {
      setFpError(err?.message || 'Failed to start password reset.');
    } finally { setFpLoading(false); }
  };

  const handleConfirmReset = async (e) => {
    e?.preventDefault?.();
    setFpError(''); setFpMsg('');
    if (!fpEmail || !fpCode || !fpPassword) { setFpError('Please fill in all fields.'); return; }
    setFpLoading(true);
    try {
      await confirmResetPassword({
        username: fpEmail.trim(),
        confirmationCode: fpCode.trim(),
        newPassword: fpPassword,
      });
      setFpStep('done');
      setFpMsg('Password updated. You can now sign in.');
    } catch (err) {
      setFpError(err?.message || 'Failed to confirm password reset.');
    } finally { setFpLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#1c1b1b] text-white p-6 flex items-center justify-center relative">
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-lg">
        <h1 className="text-2xl font-bold text-orange-400 mb-3 text-center">
          Sign In to Continue
        </h1>

        <AuthModal
          isOpen={open && !forgotOpen}
          {...auth}
          // Render the link inside the same error banner
          errorExtra={
            hasError ? (
              <button
                type="button"
                onClick={openForgotFlow}
                className="text-orange-300 hover:text-orange-200 underline underline-offset-2"
              >
                Forgot password?
              </button>
            ) : null
          }
          handleLogin={handleLoginWrapped}
          onClose={() => {
            setOpen(false);
            auth?.clearLoginError?.();
            nav('/', { replace: true });
          }}
          onSuccess={async () => {
            const ok = await verifySignedIn();
            if (!ok) { if (!open) setOpen(true); return; }
            auth?.clearLoginError?.();
            setOpen(false);
            nav(next, { replace: true });
          }}
          onError={() => {
            if (!open) setOpen(true);
          }}
        />

        {/* Forgot Password mini-modal */}
        {forgotOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={closeForgotFlow} />
            <div className="relative bg-[#2c2a2a] border border-[#3a3939] rounded-2xl w-[92%] max-w-md p-5 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xl font-semibold">
                  {fpStep === 'request' && 'Reset your password'}
                  {fpStep === 'confirm' && 'Enter code & new password'}
                  {fpStep === 'done' && 'Password updated'}
                </h2>
                <button
                  onClick={closeForgotFlow}
                  className="px-2 py-1 rounded text-sm bg-[#3a3939] hover:bg-[#4a4949]"
                >
                  ✕
                </button>
              </div>

              {fpError && <div className="mb-3 text-sm text-red-300">{fpError}</div>}
              {fpMsg && <div className="mb-3 text-sm text-green-300">{fpMsg}</div>}

              {fpStep === 'request' && (
                <form onSubmit={handleRequestCode} className="space-y-3">
                  <label className="block text-sm text-neutral-300">
                    Email
                    <input
                      type="email"
                      value={fpEmail}
                      onChange={(e) => setFpEmail(e.target.value)}
                      className="mt-1 w-full bg-[#1f1e1e] border border-[#3a3939] rounded px-3 py-2"
                      placeholder="you@example.com"
                      autoComplete="username"
                    />
                  </label>
                  <div className="flex gap-2 justify-end pt-1">
                    <button type="button" onClick={closeForgotFlow} className="px-4 py-2 rounded bg-[#3a3939] hover:bg-[#4a4949]">
                      Cancel
                    </button>
                    <button type="submit" disabled={fpLoading} className="px-4 py-2 rounded bg-[#F58735] hover:bg-orange-600 text-black disabled:opacity-70">
                      {fpLoading ? 'Sending…' : 'Send Code'}
                    </button>
                  </div>
                </form>
              )}

              {fpStep === 'confirm' && (
                <form onSubmit={handleConfirmReset} className="space-y-3">
                  <label className="block text-sm text-neutral-300">
                    Email
                    <input
                      type="email"
                      value={fpEmail}
                      onChange={(e) => setFpEmail(e.target.value)}
                      className="mt-1 w-full bg-[#1f1e1e] border border-[#3a3939] rounded px-3 py-2"
                      autoComplete="username"
                    />
                  </label>
                  <label className="block text-sm text-neutral-300">
                    Verification Code
                    <input
                      type="text"
                      value={fpCode}
                      onChange={(e) => setFpCode(e.target.value)}
                      className="mt-1 w-full bg-[#1f1e1e] border border-[#3a3939] rounded px-3 py-2"
                      placeholder="6-digit code"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="block text-sm text-neutral-300">
                    New Password
                    <input
                      type="password"
                      value={fpPassword}
                      onChange={(e) => setFpPassword(e.target.value)}
                      className="mt-1 w-full bg-[#1f1e1e] border border-[#3a3939] rounded px-3 py-2"
                      autoComplete="new-password"
                    />
                  </label>
                  <div className="flex gap-2 justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleRequestCode}
                      disabled={fpLoading}
                      className="px-3 py-2 rounded bg-[#3a3939] hover:bg-[#4a4949] text-sm"
                    >
                      Resend Code
                    </button>
                    <div className="flex gap-2">
                      <button type="button" onClick={closeForgotFlow} className="px-4 py-2 rounded bg-[#3a3939] hover:bg-[#4a4949]">
                        Cancel
                      </button>
                      <button type="submit" disabled={fpLoading} className="px-4 py-2 rounded bg-[#F58735] hover:bg-orange-600 text-black disabled:opacity-70">
                        {fpLoading ? 'Updating…' : 'Update Password'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {fpStep === 'done' && (
                <div className="space-y-4">
                  <p className="text-sm text-neutral-200">
                    Your password has been updated successfully. You can now sign in with your new password.
                  </p>
                  <div className="flex justify-end">
                    <button
                      onClick={() => { closeForgotFlow(); if (!open) setOpen(true); }}
                      className="px-4 py-2 rounded bg-[#F58735] hover:bg-orange-600 text-black"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!open && !forgotOpen && (
          <div className="bg-[#2c2a2a] border border-[#3a3939] rounded-2xl p-4 text-center">
            <p className="text-sm text-neutral-300 mb-3">
              You closed the sign-in window. Would you like to open it again?
            </p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setOpen(true)} className="px-4 py-2 rounded bg-[#F58735] hover:bg-orange-600 text-black">
                Open Sign-In
              </button>
              <button onClick={() => nav('/', { replace: true })} className="px-4 py-2 rounded bg-[#3a3939] hover:bg-[#4a4949]">
                Back Home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState } from 'react';

export default function AuthModal({
  isOpen,
  onClose,
  onSuccess,              // unchanged

  /* auth props from useAuth */
  isSignUp,  setIsSignUp,
  loginForm, setLoginForm,
  signUpForm,setSignUpForm,
  loginError,
  handleLogin,
  handleSignUp,
}) {
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo]             = useState('');     // 🆕 banner text

  if (!isOpen) return null;

  /* wrappers */
  const doLogin = async () => {
    try { setSubmitting(true); await handleLogin(); onSuccess?.(); }
    finally { setSubmitting(false); }
  };

  const doSignUp = async () => {
    try {
      setSubmitting(true);
      await handleSignUp();
      /* 🆕  show verification hint and switch to Sign-In form */
      setInfo('Account created! We’ve emailed you a verification link. ' +
              'Verify your email, then sign in to continue.');
      setIsSignUp(false);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
      <div className="relative bg-white text-black p-6 rounded-lg shadow-lg w-full max-w-md">

        <button onClick={onClose}
          className="absolute top-3 right-4 text-2xl leading-none text-gray-600 hover:text-black">
          &times;
        </button>

        <h2 className="text-xl font-bold mb-4 text-center">
          {isSignUp ? 'Create an Account' : 'Sign In'}
        </h2>

        {/* 🆕 info banner */}
        {info && (
          <p className="bg-green-100 text-green-800 text-sm p-2 mb-4 rounded">
            {info}
          </p>
        )}

        {/* ───── Sign-Up form ───── */}
        {isSignUp ? (
          <>
            <input
              type="text"
              placeholder="Full Name"
              className="w-full mb-2 px-3 py-2 rounded border"
              value={signUpForm.name}
              onChange={e=>setSignUpForm({ ...signUpForm, name:e.target.value })}
            />
            <input
              type="email"
              placeholder="Email"
              className="w-full mb-2 px-3 py-2 rounded border"
              value={signUpForm.email}
              onChange={e=>setSignUpForm({ ...signUpForm, email:e.target.value })}
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full mb-4 px-3 py-2 rounded border"
              value={signUpForm.password}
              onChange={e=>setSignUpForm({ ...signUpForm, password:e.target.value })}
            />
            <button
              onClick={doSignUp}
              disabled={submitting}
              className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 mb-2 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Account'}
            </button>
            <p className="text-sm text-center">
              Already have an account?{' '}
              <button onClick={()=>setIsSignUp(false)}
                className="text-blue-600 hover:underline">
                Sign In
              </button>
            </p>
          </>
        ) : (
        /* ───── Sign-In form ───── */
          <>
            <input
              type="email"
              placeholder="Email"
              className="w-full mb-2 px-3 py-2 rounded border"
              value={loginForm.username}
              onChange={e=>setLoginForm({ ...loginForm, username:e.target.value })}
            />
            <input
              type="password"
              placeholder="Password"
              className="w-full mb-4 px-3 py-2 rounded border"
              value={loginForm.password}
              onChange={e=>setLoginForm({ ...loginForm, password:e.target.value })}
            />
            <button
              onClick={doLogin}
              disabled={submitting}
              className="w-full bg-[#F58735] text-white py-2 rounded hover:bg-orange-600 mb-2 disabled:opacity-50">
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="text-sm text-center">
              New here?{' '}
              <button onClick={()=>setIsSignUp(true)}
                className="text-blue-600 hover:underline">
                Create an Account
              </button>
            </p>
          </>
        )}

        {loginError && (
          <p className="text-red-500 mt-2 text-sm text-center">{loginError}</p>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * Route guard for /admin. Previously the admin route had NO authorization check
 * at all — any signed-in Cognito user (including a self-registered customer on
 * the same pool) could open /admin. This verifies the user's ID token carries
 * the `admin` group claim before rendering admin children.
 *
 * Note: this is a client-side defense-in-depth guard. The authoritative
 * boundary is the backend (Identity Pool IAM role / API authorizers); scoping
 * those to the admin group is tracked as a separate backend task.
 */
const ADMIN_GROUP = 'admin';

export default function RequireAdmin({ children }) {
  const [state, setState] = useState('checking'); // checking | allowed | denied
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await fetchAuthSession();
        const groups =
          session?.tokens?.idToken?.payload?.['cognito:groups'] || [];
        const isAdmin = Array.isArray(groups) && groups.includes(ADMIN_GROUP);
        if (!active) return;
        setState(isAdmin ? 'allowed' : 'denied');
      } catch (err) {
        console.warn('Admin auth check failed:', err);
        if (active) setState('denied');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[color:var(--page)] text-neutral-400">
        <div className="text-sm tracking-wide">Verifying access…</div>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[color:var(--page)] px-6">
        <div className="ui-card max-w-md text-center">
          <h1 className="font-display text-xl font-semibold text-white mb-2">
            Access restricted
          </h1>
          <p className="text-sm text-neutral-400 mb-5">
            This area is for India 101 staff. Sign in with an authorized account
            to continue.
          </p>
          <button className="ui-btn-primary" onClick={() => navigate('/signin')}>
            Go to sign in
          </button>
        </div>
      </div>
    );
  }

  return children;
}

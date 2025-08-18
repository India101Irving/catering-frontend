import { useState } from 'react';
import {
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { decodeJwt } from 'jose';

/**
 * useAuth – wraps Cognito sign-in / sign-up / sign-out.
 *
 * @param {function} onPostLogin  – async (session, groups) => void
 * @returns {object}              – auth state + handlers
 */
export default function useAuth(onPostLogin) {
  /* form + user state */
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm]   = useState({ username: '', password: '' });
  const [signUpForm, setSignUpForm] = useState({
    name: '', email: '', password: '', phone: '', address: '', gender: '',
  });

  const [isSignUp, setIsSignUp]   = useState(false);
  const [loginError, setLoginError] = useState('');

  /* ───────── Handlers ───────── */
  const handleLogin = async () => {
    try {
      setLoginError('');
      await signIn(loginForm);

      /* wait until tokens are actually populated */
      const waitForSession = async (tries = 6) => {
        for (let i = 0; i < tries; i++) {
          try {
            const currUser = await getCurrentUser();
            const session  = await fetchAuthSession({ forceRefresh: true });
            const raw      = session.tokens?.accessToken?.toString();
            if (!raw) throw new Error();

            const groups = decodeJwt(raw)['cognito:groups'] || [];
            setUser(currUser);
            await onPostLogin(session, groups);   // <-- hand back to caller
            return;
          } catch {
            await new Promise(r => setTimeout(r, 400));
          }
        }
        throw new Error('Failed to load session after login');
      };

      await waitForSession();
    } catch (err) {
      setLoginError(err.message || 'Invalid email or password');
    }
  };

  const handleSignUp = async () => {
    try {
      const { email, password, name } = signUpForm;
      await signUp({
        username: email,
        password,
        options: {
          userAttributes: { email, name },
        },
      });
      /* auto-verified pools → pre-fill sign-in */
      setIsSignUp(false);
      setLoginForm({ username: email, password });
      setLoginError('');
    } catch (err) {
      setLoginError(err.message || 'Sign-up failed');
    }
  };

  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  };

  return {
    /* state */
    user, loginForm, setLoginForm, signUpForm, setSignUpForm,
    isSignUp, setIsSignUp, loginError,

    /* actions */
    handleLogin, handleSignUp, handleLogout,
  };
}

import { useState } from 'react';
import {
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { decodeJwt } from 'jose';

function friendlyAuthMessage(err) {
  const name = err?.name || err?.code || '';
  const msg  = (err?.message || '').toLowerCase();
  if (name === 'UserNotConfirmedException') return 'Please verify your email before signing in.';
  if (name === 'PasswordResetRequiredException') return 'Password reset required. Use “Forgot password”.';
  if (name === 'UserNotFoundException') return 'No account found for this email.';
  if (name === 'NotAuthorizedException' || msg.includes('incorrect username or password')) return 'Incorrect email or password.';
  if (name === 'TooManyRequestsException' || msg.includes('attempts exceeded')) return 'Too many attempts. Please try again shortly.';
  if (msg.includes('network')) return 'Network error. Please check your connection.';
  return 'Sign-in failed. Please try again.';
}

export default function useAuth(onPostLogin) {
  const [user, setUser] = useState(null);
  const [loginForm, setLoginForm]   = useState({ username: '', password: '' });
  const [signUpForm, setSignUpForm] = useState({
    name: '', email: '', password: '', phone: '', address: '', gender: '',
  });

  const [isSignUp, setIsSignUp]     = useState(false);
  const [loginError, setLoginError] = useState('');

  const clearLoginError = () => setLoginError('');

  const handleLogin = async () => {
    clearLoginError();
    try {
      await signIn(loginForm);
      for (let i = 0; i < 6; i++) {
        try {
          const currUser = await getCurrentUser();
          const session  = await fetchAuthSession({ forceRefresh: true });
          const raw      = session.tokens?.accessToken?.toString();
          if (!raw) throw new Error('no token yet');
          const groups = decodeJwt(raw)['cognito:groups'] || [];
          setUser(currUser);
          if (typeof onPostLogin === 'function') await onPostLogin(session, groups);
          return true;
        } catch {
          await new Promise(r => setTimeout(r, 400));
        }
      }
      throw new Error('Failed to load session after login');
    } catch (err) {
      setLoginError(friendlyAuthMessage(err));
      return false; // do NOT throw (prevents red overlay)
    }
  };

  const handleSignUp = async () => {
    clearLoginError();
    try {
      const { email, password, name } = signUpForm;
      await signUp({
        username: email,
        password,
        options: { userAttributes: { email, name } },
      });
      setIsSignUp(false);
      setLoginForm({ username: email, password });
      setLoginError('');
      return true;
    } catch (err) {
      setLoginError(err?.message || 'Sign-up failed. Please try again.');
      return false;
    }
  };

  const handleLogout = async () => {
    await signOut();
    window.location.reload();
  };

  return {
    user,
    loginForm, setLoginForm,
    signUpForm, setSignUpForm,
    isSignUp, setIsSignUp,
    loginError,

    handleLogin, handleSignUp, handleLogout, clearLoginError,
  };
}

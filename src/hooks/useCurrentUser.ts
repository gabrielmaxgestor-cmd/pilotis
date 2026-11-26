import { useCallback, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  sendEmailVerification,
  signOut,
  type User,
} from 'firebase/auth';
import { isAuthorizedCompanyEmail } from '../config/companyAuth';
import { auth } from '../lib/firebase';

export type AuthIssue = 'unauthorized_email' | 'email_not_verified' | null;

export interface CurrentUserState {
  user: User | null;
  loading: boolean;
  isAuthorized: boolean;
  authIssue: AuthIssue;
  logout: () => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  reloadUser: () => Promise<boolean>;
}

export function useCurrentUser(): CurrentUserState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authIssue, setAuthIssue] = useState<AuthIssue>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setAuthIssue(null);
        setLoading(false);
        return;
      }

      if (!isAuthorizedCompanyEmail(firebaseUser.email)) {
        setUser(firebaseUser);
        setAuthIssue('unauthorized_email');
        setLoading(false);
        void signOut(auth);
        return;
      }

      if (!firebaseUser.emailVerified) {
        setUser(firebaseUser);
        setAuthIssue('email_not_verified');
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      setAuthIssue(null);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setUser(null);
    setAuthIssue(null);
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('Nenhuma sessão pendente de verificação.');
    }
    await sendEmailVerification(auth.currentUser);
  }, []);

  const reloadUser = useCallback(async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    const refreshed = auth.currentUser;
    if (
      refreshed &&
      isAuthorizedCompanyEmail(refreshed.email) &&
      refreshed.emailVerified
    ) {
      // Firestore evaluates the verification claim in the ID token.
      await refreshed.getIdToken(true);
      if (auth.currentUser?.uid !== refreshed.uid) return false;
      setUser(refreshed);
      setAuthIssue(null);
      return true;
    }
    if (refreshed && !refreshed.emailVerified) {
      setAuthIssue('email_not_verified');
    }
    return false;
  }, []);

  const isAuthorized = Boolean(
    user && isAuthorizedCompanyEmail(user.email) && user.emailVerified,
  );

  return {
    user,
    loading,
    isAuthorized,
    authIssue,
    logout,
    resendVerificationEmail,
    reloadUser,
  };
}

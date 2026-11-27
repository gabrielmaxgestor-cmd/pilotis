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
export type VerificationEmailResult = 'sent' | 'already-verified';

export interface CurrentUserState {
  user: User | null;
  loading: boolean;
  isAuthorized: boolean;
  authIssue: AuthIssue;
  logout: () => Promise<void>;
  resendVerificationEmail: () => Promise<VerificationEmailResult>;
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

  const reloadUser = useCallback(async (): Promise<boolean> => {
    const session = auth.currentUser;
    if (!session || !isAuthorizedCompanyEmail(session.email)) return false;
    await session.reload();
    const refreshed = auth.currentUser;
    if (refreshed?.uid !== session.uid) return false;
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

  const resendVerificationEmail = useCallback(async (): Promise<VerificationEmailResult> => {
    const before = auth.currentUser;
    if (!before || !isAuthorizedCompanyEmail(before.email)) {
      throw new Error('Entre com a conta autorizada para solicitar a verificação.');
    }
    if (await reloadUser()) return 'already-verified';
    const current = auth.currentUser;
    if (!current || current.uid !== before.uid || !isAuthorizedCompanyEmail(current.email)) {
      throw new Error('A sessão mudou. Entre novamente para solicitar a verificação.');
    }
    await sendEmailVerification(current);
    return 'sent';
  }, [reloadUser]);

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

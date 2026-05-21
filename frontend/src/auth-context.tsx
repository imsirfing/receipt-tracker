import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { onIdTokenChanged, signOut, User } from "firebase/auth";
import { auth } from "./firebase";
import { setApiToken } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onIdTokenChanged fires on sign-in, sign-out, and token refresh.
    // We push the fresh token into api.ts so the interceptor never reads
    // auth.currentUser directly (avoids mobile timing issues).
    return onIdTokenChanged(auth, async (u) => {
      if (u) {
        const token = await u.getIdToken();
        setApiToken(token);
      } else {
        setApiToken(null);
      }
      setUser(u);
      setLoading(false);
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signOut: () => signOut(auth) }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

/**
 * UserContext – stores the calling user's access level fetched from /api/admin/me.
 * Mounted once after Firebase auth resolves. Used by pages to conditionally render
 * edit/delete controls for non-owner / read-only users.
 */
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { getMe, MeInfo } from "./api";
import { useAuth } from "./auth-context";

interface UserState {
  me: MeInfo | null;
  loading: boolean;
  canWrite: boolean;
  isOwner: boolean;
}

const UserContext = createContext<UserState>({
  me: null,
  loading: true,
  canWrite: false,
  isOwner: false,
});

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [me, setMe] = useState<MeInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setMe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  const canWrite = me?.role === "write";
  const isOwner = me?.is_owner ?? false;

  return (
    <UserContext.Provider value={{ me, loading, canWrite, isOwner }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);

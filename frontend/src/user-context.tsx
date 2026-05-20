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
  accessDenied: boolean;
}

const UserContext = createContext<UserState>({
  me: null,
  loading: true,
  canWrite: false,
  isOwner: false,
  accessDenied: false,
});

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [me, setMe] = useState<MeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setMe(null);
      setAccessDenied(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setAccessDenied(false);
    getMe()
      .then(setMe)
      .catch((err) => {
        if (err?.response?.status === 403) setAccessDenied(true);
        setMe(null);
      })
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  const canWrite = me?.role === "write";
  const isOwner = me?.is_owner ?? false;

  return (
    <UserContext.Provider value={{ me, loading, canWrite, isOwner, accessDenied }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => useContext(UserContext);

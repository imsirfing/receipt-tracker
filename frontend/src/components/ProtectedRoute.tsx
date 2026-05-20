import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth-context";
import { useUser } from "../user-context";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { accessDenied, loading: userLoading } = useUser();

  if (authLoading || userLoading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (accessDenied) {
    signOut();
    return <Navigate to="/login?reason=unauthorized" replace />;
  }
  return <>{children}</>;
}

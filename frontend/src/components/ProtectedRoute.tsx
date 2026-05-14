import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth-context";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

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
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="text-xl font-semibold text-slate-800">Access not granted</h1>
        <p className="text-slate-500 text-sm max-w-sm">
          Your account ({user.email}) hasn't been given access to this app.
          Contact James to request access.
        </p>
        <button
          onClick={() => signOut()}
          className="mt-2 text-sm text-indigo-600 hover:underline"
        >
          Sign out
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

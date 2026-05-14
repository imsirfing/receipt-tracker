import { Link, Outlet, useLocation } from "react-router-dom";
import { BarChart3, LogOut, MessageSquare, Receipt } from "lucide-react";
import { useAuth } from "../auth-context";

const nav = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/receipts", label: "Receipts", icon: Receipt },
  { to: "/chat", label: "Chat report", icon: MessageSquare },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-60 bg-white border-r border-slate-200 p-4 flex flex-col">
        <div className="text-lg font-semibold mb-6 text-indigo-700">Receipts</div>
        <nav className="flex-1 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                  active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon size={16} /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="text-xs text-slate-500 mt-4 mb-1 truncate">{user?.email}</div>
        <button
          onClick={() => signOut()}
          className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        >
          <LogOut size={14} /> Sign out
        </button>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

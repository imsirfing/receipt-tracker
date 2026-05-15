import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { BarChart3, ClipboardList, Inbox, LogOut, MessageSquare, Receipt, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth-context";
import { triggerIngest, listPending } from "../api";

const nav = [
  { to: "/", label: "Dashboard", icon: BarChart3 },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/review", label: "Review", icon: ClipboardList },
  { to: "/receipts", label: "Receipts", icon: Receipt },
  { to: "/chat", label: "Chat report", icon: MessageSquare },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    listPending().then(items => setPendingCount(items.length)).catch(() => {});
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await triggerIngest();
      toast.success(`Synced — ${result.processed ?? 0} new receipts`);
      setLastSync(new Date());
    } catch {
      toast.error("Sync failed — check backend logs");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-60 bg-white border-r border-slate-200 p-4 flex flex-col">
        <div className="text-lg font-semibold mb-4 text-indigo-700">Receipts</div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center justify-center gap-2 w-full mb-5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync Inbox"}
        </button>
        {lastSync && (
          <div className="text-xs text-slate-400 text-center mt-1">
            Last synced {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
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
                {label === "Review" && pendingCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {pendingCount}
                  </span>
                )}
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

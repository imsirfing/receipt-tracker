import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { BarChart3, ClipboardList, LogOut, MessageSquare, Receipt, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../auth-context";
import { triggerIngest, getIngestStatus, listPending, getMe } from "../api";

const baseNav = [
  { to: "/", label: "Dashboard", icon: BarChart3, writeOnly: false },
  { to: "/review", label: "Review", icon: ClipboardList, writeOnly: true },
  { to: "/receipts", label: "Receipts", icon: Receipt, writeOnly: false },
  { to: "/chat", label: "Chat report", icon: MessageSquare, writeOnly: false },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [canWrite, setCanWrite] = useState(true);

  useEffect(() => {
    listPending().then(data => setPendingCount(data.total)).catch(() => {});
    getMe().then(me => {
      setIsOwner(me.is_owner);
      setCanWrite(me.role === "write" || me.is_owner);
    }).catch(() => {});
  }, []);

  const nav = [
    ...baseNav.filter(item => !item.writeOnly || canWrite),
    ...(isOwner ? [{ to: "/admin/access", label: "Access", icon: ShieldCheck, writeOnly: false }] : []),
  ];

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await triggerIngest();
      // Poll for completion
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes of polling
      await new Promise<void>((resolve) => {
        const poll = setInterval(async () => {
          attempts++;
          try {
            const status = await getIngestStatus();
            if (!status.running) {
              clearInterval(poll);
              if (status.last_error) {
                toast.error(`Sync error: ${status.last_error}`);
              } else {
                toast.success(`Synced — ${status.last_processed ?? 0} new receipt${status.last_processed !== 1 ? "s" : ""}`);
                setLastSync(new Date());
              }
              resolve();
            } else if (attempts >= maxAttempts) {
              clearInterval(poll);
              toast.error("Sync timed out — check back in a moment");
              resolve();
            }
          } catch {
            clearInterval(poll);
            toast.error("Lost contact with backend during sync");
            resolve();
          }
        }, 1000);
      });
    } catch {
      toast.error("Sync failed — check backend logs");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="hidden md:flex w-60 bg-white border-r border-slate-200 p-4 flex-col">
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
      <main className="flex-1 p-4 md:p-8 pb-20 md:pb-0 overflow-auto">
        <Outlet />
      </main>
      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t border-slate-200 flex z-40">
        {nav.map(({ to, label, icon: Icon }) => {
          const active = location.pathname === to;
          const shortLabel = label === "Chat report" ? "Chat" : label;
          return (
            <Link
              key={to}
              to={to}
              className={`flex-1 relative flex flex-col items-center justify-center py-2 min-h-[56px] text-xs ${
                active ? "text-indigo-700" : "text-slate-500"
              }`}
            >
              <Icon size={20} />
              <span className="mt-1">{shortLabel}</span>
              {label === "Review" && pendingCount > 0 && (
                <span className="absolute top-1 right-1/4 bg-red-500 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full leading-none">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </Link>
          );
        })}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] text-xs text-slate-500 disabled:opacity-50"
        >
          <RefreshCw size={20} className={syncing ? "animate-spin" : ""} />
          <span className="mt-1">{syncing ? "Syncing" : "Sync"}</span>
        </button>
        <button
          onClick={() => signOut()}
          className="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] text-xs text-slate-500"
        >
          <LogOut size={20} />
          <span className="mt-1">Sign out</span>
        </button>
      </nav>
    </div>
  );
}

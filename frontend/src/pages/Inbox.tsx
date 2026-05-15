import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listReceipts, Receipt } from "../api";
import { SkeletonCard } from "../components/Skeleton";

export default function InboxPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    listReceipts()
      .then((rows) => {
        // Sort newest first
        rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        setReceipts(rows);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Inbox</h1>

      {error && <div className="text-red-600 mb-4">{error}</div>}

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : receipts.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">📭</div>
          <div className="font-medium text-slate-600 mb-1">Inbox is empty</div>
          <div className="text-sm">Hit Sync Inbox in the sidebar to pull in new receipts.</div>
        </div>
      ) : (
      <div className="flex flex-col gap-2">
        {receipts.map((r) => {
          const uncategorized = r.category_variable === "uncategorized";
          return (
            <div
              key={r.id}
              onClick={() => navigate(`/receipts/${r.id}`)}
              className={`bg-white rounded-xl shadow-sm border border-slate-200 px-4 py-3 cursor-pointer hover:shadow-md transition-shadow flex items-start gap-4 ${
                uncategorized ? "border-l-4 border-l-amber-400" : ""
              }`}
            >
              {/* Left: payee + purpose */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-slate-900 truncate">{r.payee}</span>
                  {uncategorized ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 shrink-0">
                      uncategorized
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700 shrink-0">
                      {r.category_variable}
                    </span>
                  )}
                </div>
                {r.inferred_purpose && (
                  <div className="text-sm text-slate-500 truncate">{r.inferred_purpose}</div>
                )}
              </div>

              {/* Right: amount + date */}
              <div className="text-right shrink-0">
                <div className="font-semibold text-slate-900">${Number(r.amount).toFixed(2)}</div>
                <div className="text-xs text-slate-400 mt-0.5">{r.date}</div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listReceipts, Receipt } from "../api";
import { SkeletonCard } from "../components/Skeleton";

const PAGE_SIZE = 50;

export default function InboxPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => { setSearch(searchInput); setPage(0); }, 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchInput]);

  useEffect(() => {
    setLoading(true);
    listReceipts(PAGE_SIZE, page * PAGE_SIZE, undefined, undefined, search || undefined)
      .then((data) => {
        const rows = data.items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        setReceipts(rows);
        setTotal(data.total);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [page, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        {!loading && <span className="text-sm text-slate-400">{total} receipt{total !== 1 ? "s" : ""}</span>}
      </div>

      <div className="mb-4">
        <input
          type="search"
          placeholder="Search payee, purpose, category..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

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

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-6 text-sm text-slate-500">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-50"
          >← Prev</button>
          <span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-slate-50"
          >Next →</button>
        </div>
      )}
    </div>
  );
}

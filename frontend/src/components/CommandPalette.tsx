import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Receipt, X } from "lucide-react";
import { listReceipts, Receipt as ReceiptType } from "../api";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReceiptType[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search
  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await listReceipts(8, 0, undefined, undefined, q);
        setResults(data.items);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, []);

  const handleSelect = (receipt: ReceiptType) => {
    setOpen(false);
    navigate(`/receipts/${receipt.id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      handleSelect(results[selectedIndex]);
    }
  };

  const formatAmount = (amt: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amt);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Palette */}
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <Search size={16} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder="Search receipts…"
            className="flex-1 text-sm text-slate-800 placeholder-slate-400 outline-none bg-transparent"
          />
          {loading && (
            <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin shrink-0" />
          )}
          <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="max-h-80 overflow-y-auto py-2">
            {results.map((r, i) => (
              <li key={r.id}>
                <button
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === selectedIndex ? "bg-indigo-50" : "hover:bg-slate-50"
                  }`}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => handleSelect(r)}
                >
                  <Receipt size={14} className="text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {r.canonical_payee || r.payee}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {r.date} · {r.category_variable}
                      {r.inferred_purpose ? ` · ${r.inferred_purpose}` : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-700 shrink-0">
                    {formatAmount(r.amount)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Empty state */}
        {!loading && query.trim() && results.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">No receipts found</div>
        )}

        {/* Hint */}
        {!query.trim() && (
          <div className="px-4 py-6 text-center text-xs text-slate-400">
            Type to search receipts by payee, purpose, or amount
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-100 px-4 py-2 flex items-center gap-4 text-xs text-slate-400">
          <span><kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">↵</kbd> open</span>
          <span><kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">Esc</kbd> close</span>
          <span className="ml-auto"><kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}

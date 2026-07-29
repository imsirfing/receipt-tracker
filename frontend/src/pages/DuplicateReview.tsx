import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useUser } from "../user-context";
import { fmtCurrency } from "../utils";
import {
  DuplicateCandidate,
  listDuplicateCandidates,
  mergeDuplicate,
  linkDuplicate,
  dismissDuplicate,
  triggerDuplicateScan,
} from "../api";

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    high: "bg-green-100 text-green-800 border-green-200",
    medium: "bg-amber-100 text-amber-800 border-amber-200",
    low: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
        styles[confidence] ?? "bg-slate-100 text-slate-700 border-slate-200"
      }`}
    >
      {confidence}
    </span>
  );
}

const REASON_LABELS: Record<string, string> = {
  invoice_number: "Same invoice number",
  amount_payee_date: "Same amount, payee & date",
  amount_payee: "Same amount & payee",
  manual: "Manually flagged",
};

interface ReceiptCardProps {
  receipt: DuplicateCandidate["receipt_a"];
  label: string;
}

function ReceiptCard({ receipt, label }: ReceiptCardProps) {
  return (
    <div className="flex-1 min-w-0 bg-slate-50 rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{label}</div>
      <Link
        to={`/receipts/${receipt.id}`}
        className="text-base font-semibold text-slate-900 hover:text-indigo-700 truncate block"
      >
        {receipt.canonical_payee || receipt.payee}
      </Link>
      {receipt.canonical_payee && receipt.canonical_payee !== receipt.payee && (
        <div className="text-xs text-slate-400 truncate">{receipt.payee}</div>
      )}
      <div className="text-lg font-bold text-indigo-700 mt-1">{fmtCurrency(receipt.amount)}</div>
      <div className="text-xs text-slate-500 mt-0.5">{receipt.date}</div>
      {receipt.invoice_number && (
        <div className="text-xs text-slate-600 mt-1">
          <span className="font-medium">Invoice:</span> {receipt.invoice_number}
        </div>
      )}
      {receipt.inferred_purpose && (
        <div className="text-xs text-slate-500 mt-1 line-clamp-2 italic">{receipt.inferred_purpose}</div>
      )}
      <div className="text-xs text-slate-400 mt-1">
        Category: <span className="text-slate-600">{receipt.category_variable}</span>
      </div>
    </div>
  );
}

export default function DuplicateReviewPage() {
  const { isOwner, loading: userLoading } = useUser();

  if (!userLoading && !isOwner) {
    return <Navigate to="/dashboard" replace />;
  }

  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Notes confirm flow
  type PendingAction = { label: string; fn: (notes: string) => Promise<unknown> };
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionNotes, setActionNotes] = useState("");

  const load = () => {
    setLoading(true);
    listDuplicateCandidates()
      .then(setCandidates)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const current = candidates[0] ?? null;

  const handleAction = async (action: () => Promise<unknown>) => {
    setActioningId(current?.id ?? null);
    setError(null);
    try {
      await action();
      setCandidates((prev) => prev.slice(1));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActioningId(null);
    }
  };

  const confirmAction = async () => {
    if (!pendingAction || !current) return;
    const notes = actionNotes.trim();
    setActioningId(current.id);
    setError(null);
    try {
      await pendingAction.fn(notes);
      setCandidates((prev) => prev.slice(1));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActioningId(null);
      setPendingAction(null);
      setActionNotes("");
    }
  };

  const cancelAction = () => {
    setPendingAction(null);
    setActionNotes("");
  };

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await triggerDuplicateScan();
      load();
      if (res.new_candidates === 0) {
        // no-op, list already reloaded
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-slate-800">Duplicate Review</h1>
        {!loading && candidates.length > 0 && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
            {candidates.length} pending
          </span>
        )}
        <button
          onClick={handleScan}
          disabled={scanning || loading}
          className="ml-auto px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          {scanning ? "Scanning…" : "Re-scan"}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-slate-500 text-sm mt-8 text-center">Loading…</div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">🎉</div>
          <div className="font-medium text-slate-600 mb-1">No duplicates to review</div>
          <div className="text-sm">All clear — run a re-scan if you want to check for new matches.</div>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="text-xs text-slate-400 text-right mb-3">
            Reviewing 1 of {candidates.length}
          </div>

          {/* Pair card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-4">
            {/* Match metadata */}
            <div className="flex items-center gap-2 mb-4">
              <ConfidenceBadge confidence={current.confidence} />
              <span className="text-xs text-slate-500">
                {REASON_LABELS[current.match_reason] ?? current.match_reason}
              </span>
              <span className="ml-auto text-xs text-slate-400">
                Found {new Date(current.created_at).toLocaleDateString()}
              </span>
            </div>

            {/* Side-by-side receipts */}
            <div className="flex gap-3">
              <ReceiptCard receipt={current.receipt_a} label="Receipt A" />
              <ReceiptCard receipt={current.receipt_b} label="Receipt B" />
            </div>

            {/* Actions */}
            {pendingAction ? (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="text-sm font-medium text-slate-700 mb-2">
                  {pendingAction.label} — add a note (optional)
                </div>
                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  rows={2}
                  placeholder="Notes (optional)…"
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  autoFocus
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={confirmAction}
                    disabled={actioningId !== null}
                    className="flex-1 px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {actioningId !== null ? "Processing…" : "Confirm"}
                  </button>
                  <button
                    onClick={cancelAction}
                    disabled={actioningId !== null}
                    className="px-3 py-2 text-sm font-medium bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() => handleAction(() => mergeDuplicate(current.id, current.receipt_id_a))}
                  disabled={actioningId !== null}
                  className="flex-1 min-w-[100px] px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  Keep A
                </button>
                <button
                  onClick={() => handleAction(() => mergeDuplicate(current.id, current.receipt_id_b))}
                  disabled={actioningId !== null}
                  className="flex-1 min-w-[100px] px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  Keep B
                </button>
                <button
                  onClick={() => setPendingAction({ label: "Link — keep both", fn: (notes) => linkDuplicate(current.id, notes || undefined) })}
                  disabled={actioningId !== null}
                  className="flex-1 min-w-[140px] px-3 py-2 text-sm font-medium bg-white text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Link — keep both
                </button>
                <button
                  onClick={() => setPendingAction({ label: "Dismiss", fn: (notes) => dismissDuplicate(current.id, notes || undefined) })}
                  disabled={actioningId !== null}
                  className="flex-1 min-w-[100px] px-3 py-2 text-sm font-medium bg-white text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {/* Queue preview */}
          {candidates.length > 1 && (
            <div className="text-xs text-slate-400 text-center">
              {candidates.length - 1} more pair{candidates.length - 1 !== 1 ? "s" : ""} in queue
            </div>
          )}
        </>
      )}
    </div>
  );
}

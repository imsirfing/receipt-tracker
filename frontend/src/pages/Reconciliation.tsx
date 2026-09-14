import { useCallback, useEffect, useRef, useState } from "react";
import { fmtCurrency } from "../utils";
import {
  ReconciliationMatch,
  ReconciliationSession,
  createReconciliationSession,
  exportReconciliationSession,
  listReceiptCategories,
  listReconciliationMatches,
  patchReconciliationMatch,
  uploadStatement,
} from "../api";

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  if (!confidence || confidence === "none") return null;
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

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step: _step, current }: { step: number; current: number }) {
  const labels = ["Category", "Upload", "Review", "Export"];
  return (
    <div className="flex items-center gap-2 mb-8">
      {labels.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={idx} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 transition-colors ${
                done
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : active
                  ? "bg-white border-indigo-600 text-indigo-700"
                  : "bg-white border-slate-200 text-slate-400"
              }`}
            >
              {done ? "✓" : idx}
            </div>
            <span
              className={`text-sm font-medium hidden sm:block ${
                active ? "text-indigo-700" : done ? "text-slate-500" : "text-slate-300"
              }`}
            >
              {label}
            </span>
            {i < labels.length - 1 && (
              <div
                className={`w-8 h-0.5 ml-1 ${done ? "bg-indigo-400" : "bg-slate-200"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── File upload status ────────────────────────────────────────────────────────

interface FileStatus {
  file: File;
  state: "pending" | "uploading" | "done" | "error";
  txnCount?: number;
  error?: string;
}

// ── Match row ─────────────────────────────────────────────────────────────────

function MatchRow({
  match,
  onConfirm,
  onDismiss,
}: {
  match: ReconciliationMatch;
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const r = match.receipt;
  const t = match.statement_transaction;
  const isDismissed = match.status === "dismissed";
  const isConfirmed = match.status === "confirmed";

  return (
    <tr className={`border-b border-slate-100 ${isDismissed ? "opacity-40" : ""}`}>
      {/* Receipt side */}
      <td className="py-3 pr-3 align-top min-w-[180px]">
        {r ? (
          <div>
            <div className="text-sm font-medium text-slate-800">{r.payee}</div>
            <div className="text-xs text-slate-500">{r.date}</div>
            <div className="text-sm font-bold text-indigo-700 mt-0.5">{fmtCurrency(r.amount)}</div>
            {r.payment_category && (
              <div className="text-xs text-slate-400 mt-0.5">{r.payment_category}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400 italic">No receipt</span>
        )}
      </td>

      {/* Confidence arrow */}
      <td className="py-3 px-2 text-center align-middle">
        {r && t ? (
          <div className="flex flex-col items-center gap-1">
            <span className="text-slate-300 text-lg">↔</span>
            <ConfidenceBadge confidence={match.confidence} />
            {match.amount_delta !== null && Math.abs(match.amount_delta) > 0.01 && (
              <span className="text-xs text-amber-600">Δ{fmtCurrency(Math.abs(match.amount_delta))}</span>
            )}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* Statement side */}
      <td className="py-3 pl-3 align-top min-w-[180px]">
        {t ? (
          <div>
            <div className="text-sm font-medium text-slate-800 truncate max-w-[200px]">{t.payee_raw}</div>
            <div className="text-xs text-slate-500">{t.date}</div>
            <div className="text-sm font-bold text-indigo-700 mt-0.5">{fmtCurrency(t.amount)}</div>
            {t.account_label && (
              <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{t.account_label}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400 italic">No charge found</span>
        )}
      </td>

      {/* Actions */}
      <td className="py-3 pl-4 align-middle whitespace-nowrap">
        {isConfirmed ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
            ✓ Confirmed
          </span>
        ) : isDismissed ? (
          <span className="text-xs text-slate-400">Dismissed</span>
        ) : (
          <div className="flex gap-2">
            {r && t && (
              <button
                onClick={() => onConfirm(match.id)}
                className="px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Confirm
              </button>
            )}
            <button
              onClick={() => onDismiss(match.id)}
              className="px-2.5 py-1 text-xs font-medium bg-white text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [session, setSession] = useState<ReconciliationSession | null>(null);

  // Step 2
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [runningMatch, setRunningMatch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 3
  const [matches, setMatches] = useState<ReconciliationMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);

  // Load categories from existing receipts
  useEffect(() => {
    listReceiptCategories()
      .then((cats) => setCategories(cats))
      .catch(() => setError("Failed to load categories. Please refresh."));
  }, []);

  // ── Step 1: Create session ────────────────────────────────────────────────

  const handleCreateSession = async () => {
    if (!selectedCategory) return;
    setError(null);
    setCreatingSession(true);
    try {
      const s = await createReconciliationSession(selectedCategory);
      setSession(s);
      setStep(2);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingSession(false);
    }
  };

  // ── Step 2: Upload files ──────────────────────────────────────────────────

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const newFiles: FileStatus[] = Array.from(files).map((f) => ({
      file: f,
      state: "pending",
    }));
    setFileStatuses((prev) => [...prev, ...newFiles]);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const uploadAll = useCallback(async () => {
    if (!session) return;
    setError(null);
    setRunningMatch(true);

    const pending = fileStatuses.filter((fs) => fs.state === "pending");
    for (let i = 0; i < pending.length; i++) {
      const fs = pending[i];
      setFileStatuses((prev) =>
        prev.map((x) => (x.file === fs.file ? { ...x, state: "uploading" } : x))
      );
      try {
        const result = await uploadStatement(session.id, fs.file);
        setFileStatuses((prev) =>
          prev.map((x) =>
            x.file === fs.file ? { ...x, state: "done", txnCount: result.transactions_parsed } : x
          )
        );
      } catch (e: unknown) {
        setFileStatuses((prev) =>
          prev.map((x) =>
            x.file === fs.file
              ? { ...x, state: "error", error: e instanceof Error ? e.message : String(e) }
              : x
          )
        );
      }
    }
    setRunningMatch(false);
  }, [session, fileStatuses]);

  const proceedToReview = async () => {
    if (!session) return;
    setLoadingMatches(true);
    setError(null);
    try {
      const m = await listReconciliationMatches(session.id);
      setMatches(m);
      setStep(3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMatches(false);
    }
  };

  // ── Step 3: Review actions ────────────────────────────────────────────────

  const handleConfirm = async (matchId: string) => {
    if (!session) return;
    setError(null);
    try {
      const updated = await patchReconciliationMatch(session.id, matchId, { status: "confirmed" });
      setMatches((prev) => prev.map((m) => (m.id === matchId ? updated : m)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDismiss = async (matchId: string) => {
    if (!session) return;
    setError(null);
    try {
      const updated = await patchReconciliationMatch(session.id, matchId, { status: "dismissed" });
      setMatches((prev) => prev.map((m) => (m.id === matchId ? updated : m)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Step 4: Export ────────────────────────────────────────────────────────

  const handleDownload = async () => {
    if (!session) return;
    setError(null);
    try {
      const data = await exportReconciliationSession(session.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reconciliation-${session.category_variable}-${session.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStartNew = () => {
    setStep(1);
    setSession(null);
    setSelectedCategory("");
    setFileStatuses([]);
    setMatches([]);
    setError(null);
  };

  // ── Match grouping ────────────────────────────────────────────────────────
  const matchedPairs = matches.filter(
    (m) => m.receipt !== null && m.statement_transaction !== null
  );
  const unmatchedReceipts = matches.filter(
    (m) => m.receipt !== null && m.statement_transaction === null
  );
  const unmatchedCharges = matches.filter(
    (m) => m.receipt === null && m.statement_transaction !== null
  );
  const confirmed = matches.filter((m) => m.status === "confirmed").length;
  const hasDone = fileStatuses.some((fs) => fs.state === "done");

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-semibold text-slate-800">Statement Reconciliation</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Match receipts to bank or credit card statement charges.
      </p>

      <StepIndicator step={step} current={step} />

      {error && (
        <div className="mb-5 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          {error}
        </div>
      )}

      {/* ── Step 1: Category ───────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Select a Category</h2>
          <p className="text-sm text-slate-500 mb-5">
            Choose the receipt category to reconcile against your statements.
          </p>
          <div className="mb-5">
            <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">— select —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {session && (
            <div className="mb-5 p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-sm text-slate-700">
              Your receipts span{" "}
              <strong>{session.date_from}</strong> to <strong>{session.date_to}</strong> (
              {session.receipt_count} receipt{session.receipt_count !== 1 ? "s" : ""},{" "}
              {fmtCurrency(session.total_amount_cents / 100)} total). Pull statements covering this
              range.
            </div>
          )}

          <button
            onClick={handleCreateSession}
            disabled={!selectedCategory || creatingSession}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {creatingSession ? "Creating…" : "Next →"}
          </button>
        </div>
      )}

      {/* ── Step 2: Upload ─────────────────────────────────────────────────── */}
      {step === 2 && session && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Upload Statements</h2>
          <p className="text-sm text-slate-500 mb-1">
            Upload PDF or CSV statements covering{" "}
            <strong>
              {session.date_from} – {session.date_to}
            </strong>
            .
          </p>
          <p className="text-sm text-slate-400 mb-5">
            {session.receipt_count} receipt{session.receipt_count !== 1 ? "s" : ""} ·{" "}
            {fmtCurrency(session.total_amount_cents / 100)} total
          </p>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-300 hover:bg-slate-50 transition-colors mb-4"
          >
            <div className="text-3xl mb-2">📄</div>
            <div className="text-sm text-slate-600 font-medium">
              Drag &amp; drop PDFs or CSVs here or click to browse
            </div>
            <div className="text-xs text-slate-400 mt-1">Bank &amp; credit card statements</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.csv,text/csv"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {fileStatuses.length > 0 && (
            <div className="space-y-2 mb-5">
              {fileStatuses.map((fs, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg border border-slate-100"
                >
                  <span className="text-lg">
                    {fs.state === "done"
                      ? "✅"
                      : fs.state === "error"
                      ? "❌"
                      : fs.state === "uploading"
                      ? "⏳"
                      : "📄"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700 truncate">
                      {fs.file.name}
                    </div>
                    {fs.state === "done" && (
                      <div className="text-xs text-green-600">
                        {fs.txnCount} transaction{fs.txnCount !== 1 ? "s" : ""} parsed
                      </div>
                    )}
                    {fs.state === "error" && (
                      <div className="text-xs text-red-600">{fs.error}</div>
                    )}
                    {fs.state === "uploading" && (
                      <div className="text-xs text-slate-400">Parsing…</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 flex-wrap">
            {fileStatuses.some((fs) => fs.state === "pending") && (
              <button
                onClick={uploadAll}
                disabled={runningMatch}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {runningMatch ? "Uploading…" : "Upload & Parse"}
              </button>
            )}
            {hasDone && !runningMatch && (
              <button
                onClick={proceedToReview}
                disabled={loadingMatches}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {loadingMatches ? "Loading…" : "Review Matches →"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Review ─────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          {/* Matched pairs */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <span className="text-lg">✅</span>
              <h2 className="text-base font-semibold text-slate-800">
                Matched ({matchedPairs.length})
              </h2>
            </div>
            {matchedPairs.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-400 text-center">No matches found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-slate-400 border-b border-slate-100">
                      <th className="text-left px-5 py-2 font-medium">Receipt</th>
                      <th className="text-center px-2 py-2 font-medium">Match</th>
                      <th className="text-left px-3 py-2 font-medium">Statement Charge</th>
                      <th className="text-left px-4 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 px-5">
                    {matchedPairs.map((m) => (
                      <MatchRow
                        key={m.id}
                        match={m}
                        onConfirm={handleConfirm}
                        onDismiss={handleDismiss}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Unmatched receipts */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <h2 className="text-base font-semibold text-slate-800">
                Unmatched Receipts ({unmatchedReceipts.length})
              </h2>
            </div>
            {unmatchedReceipts.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-400 text-center">All receipts matched!</div>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  {unmatchedReceipts.map((m) => (
                    <MatchRow
                      key={m.id}
                      match={m}
                      onConfirm={handleConfirm}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Unmatched charges */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <span className="text-lg">🔍</span>
              <h2 className="text-base font-semibold text-slate-800">
                Unmatched Charges ({unmatchedCharges.length})
              </h2>
            </div>
            {unmatchedCharges.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-400 text-center">No unmatched charges.</div>
            ) : (
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  {unmatchedCharges.map((m) => (
                    <MatchRow
                      key={m.id}
                      match={m}
                      onConfirm={handleConfirm}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep(4)}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Export →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Export ─────────────────────────────────────────────────── */}
      {step === 4 && session && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-5">Export Summary</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Confirmed", value: confirmed, color: "text-green-700" },
              {
                label: "Unmatched Receipts",
                value: unmatchedReceipts.filter((m) => m.status !== "dismissed").length,
                color: "text-amber-700",
              },
              {
                label: "Unmatched Charges",
                value: unmatchedCharges.filter((m) => m.status !== "dismissed").length,
                color: "text-red-700",
              },
              {
                label: "Total Receipts",
                value: session.receipt_count,
                color: "text-slate-700",
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="bg-slate-50 rounded-xl border border-slate-100 p-4 text-center"
              >
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-slate-500 mt-1">{label}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleDownload}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              ⬇ Download JSON
            </button>
            <button
              onClick={handleStartNew}
              className="px-4 py-2 text-sm font-medium bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Start New
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useUser } from "../user-context";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  PendingEmail,
  ConvertRequest,
  listPending,
  dismissPending,
  convertPending,
} from "../api";

const PAGE_SIZE = 20;

function EmailBodyPreview({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const COLLAPSE_HEIGHT = 120; // px

  return (
    <div className="mt-3">
      <pre
        ref={preRef}
        className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap break-words font-mono overflow-y-auto transition-all"
        style={{ maxHeight: expanded ? "480px" : `${COLLAPSE_HEIGHT}px` }}
      >
        {body}
      </pre>
      <button
        onClick={() => setExpanded(e => !e)}
        className="mt-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
      >
        <span className="flex items-center gap-1">
          {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show more</>}
        </span>
      </button>
    </div>
  );
}

const KNOWN_CATEGORIES = [
  "personal",
  "realestate",
  "traverse",
  "edgehill",
  "trust",
  "nopa",
  "uncategorized",
];

const today = new Date().toISOString().slice(0, 10);

interface ModalState {
  pending: PendingEmail;
  form: ConvertRequest;
}

export default function ReviewPage() {
  const { canWrite, isOwner, loading } = useUser();

  if (!loading && !isOwner) {
    return <Navigate to="/dashboard" replace />;
  }
  const [items, setItems] = useState<PendingEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchInput]);

  const loadItems = () => {
    setLoading(true);
    listPending(search || undefined, PAGE_SIZE, page * PAGE_SIZE)
      .then((data) => { setItems(data.items); setTotal(data.total); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadItems(); }, [search, page]);

  const handleDismiss = async (id: string) => {
    await dismissPending(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
  };

  const openModal = (pending: PendingEmail) => {
    setModal({
      pending,
      form: {
        payee: "",
        amount: 0,
        date: pending.received_date ?? today,
        category_variable: pending.category_variable,
        recurring_type: "one_off",
        payment_category: "",
        payment_detail: "",
        inferred_purpose: "",
      },
    });
  };

  const closeModal = () => {
    setModal(null);
    setError(null);
  };

  const handleConvert = async () => {
    if (!modal) return;
    setSaving(true);
    setError(null);
    try {
      await convertPending(modal.pending.id, modal.form);
      setItems((prev) => prev.filter((p) => p.id !== modal.pending.id));
      closeModal();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to save receipt.");
    } finally {
      setSaving(false);
    }
  };

  const updateForm = (patch: Partial<ConvertRequest>) => {
    setModal((prev) => prev ? { ...prev, form: { ...prev.form, ...patch } } : prev);
  };

  const parseErrors = items.filter(i => i.skip_reason.startsWith("parse error:"));
  const reviewable = items.filter(i => !i.skip_reason.startsWith("parse error:"));
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const renderItem = (item: PendingEmail, isParseError = false) => (
    <div
      key={item.id}
      className={`bg-white rounded-xl shadow-sm border p-5 ${
        isParseError ? "border-red-200" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-slate-900 truncate">
            {item.subject}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {item.from_address}
            {item.received_date && (
              <span className="ml-2">· {item.received_date}</span>
            )}
          </p>
          {isParseError && (
            <p className="text-xs font-mono text-slate-400 mt-0.5">ID: {item.gmail_message_id}</p>
          )}
        </div>
        {isParseError ? (
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
            parse error
          </span>
        ) : (
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
            {item.category_variable}
          </span>
        )}
      </div>

      {item.skip_reason && (
        <p className="mt-2 text-xs text-slate-400 italic">
          {isParseError ? item.skip_reason : `Claude: ${item.skip_reason}`}
        </p>
      )}

      {!isParseError && item.body_preview && (
        <EmailBodyPreview body={item.body_preview} />
      )}

      <div className="mt-4 flex gap-2">
        {canWrite && (
          <button
              onClick={() => openModal(item)}
              className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Create Receipt
            </button>
        )}
        {canWrite && (
          <button
            onClick={() => handleDismiss(item.id)}
            className="px-3 py-1.5 text-sm font-medium bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-2xl font-semibold text-slate-800">Review</h1>
        {!search && reviewable.length > 0 && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
            {total} pending
          </span>
        )}
        {!search && parseErrors.length > 0 && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            {parseErrors.length} parse error{parseErrors.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="mb-5">
        <input
          type="search"
          placeholder="Search subject, sender, body…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm w-full max-w-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm mt-8 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">✅</div>
          <div className="font-medium text-slate-600 mb-1">Nothing to review</div>
          <div className="text-sm">All caught up — new uncertain emails will appear here.</div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {reviewable.map((item) => renderItem(item, false))}
            {parseErrors.length > 0 && reviewable.length > 0 && (
              <div className="pt-2 pb-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 border-t border-slate-200" />
                  <span className="text-xs text-slate-400">parse errors</span>
                  <div className="flex-1 border-t border-slate-200" />
                </div>
              </div>
            )}
            {parseErrors.map((item) => renderItem(item, true))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 px-1">
              <div className="text-sm text-slate-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Receipt Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Create Receipt</h2>
            <p className="text-xs text-slate-500 mb-4 truncate">{modal.pending.subject}</p>

            {error && (
              <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                {error}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payee *</label>
                <input
                  type="text"
                  required
                  value={modal.form.payee}
                  onChange={(e) => updateForm({ payee: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={modal.form.amount}
                  onChange={(e) => updateForm({ amount: parseFloat(e.target.value) || 0 })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                <input
                  type="date"
                  required
                  value={modal.form.date}
                  onChange={(e) => updateForm({ date: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category *</label>
                <select
                  required
                  value={modal.form.category_variable}
                  onChange={(e) => updateForm({ category_variable: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {KNOWN_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Recurring type *</label>
                <select
                  required
                  value={modal.form.recurring_type}
                  onChange={(e) => updateForm({ recurring_type: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="one_off">One-off</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment category</label>
                <input
                  type="text"
                  value={modal.form.payment_category ?? ""}
                  onChange={(e) => updateForm({ payment_category: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment detail</label>
                <input
                  type="text"
                  value={modal.form.payment_detail ?? ""}
                  onChange={(e) => updateForm({ payment_detail: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Purpose / notes</label>
                <textarea
                  rows={3}
                  value={modal.form.inferred_purpose ?? ""}
                  onChange={(e) => updateForm({ inferred_purpose: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConvert}
                disabled={saving || !modal.form.payee || !modal.form.date}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

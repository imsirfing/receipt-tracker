import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../user-context";
import { fmtCurrency } from "../utils";
import { Camera, Check, Pencil, X } from "lucide-react";
import { SkeletonRow } from "../components/Skeleton";
import { toast } from "sonner";
import { auth } from "../firebase";
import {
  attachImage,
  bulkSetReimbursementStatus,
  createReceipt,
  deleteReceipt,
  listReceipts,
  markReimbursed,
  parseReceiptImage,
  ParseImageResult,
  Receipt,
  ReceiptCreateRequest,
  updateReceipt,
} from "../api";

const PAGE_SIZE = 50;

const KNOWN_CATEGORIES = ["personal", "realestate", "traverse", "edgehill", "trust", "nopa", "uncategorized"];

type SortKey = "date" | "payee" | "amount" | "category_variable";

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<Partial<ReceiptCreateRequest>>({ recurring_type: "one_off", category_variable: "personal" });
  const [createSaving, setCreateSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  // Upload receipt photo state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadParsing, setUploadParsing] = useState(false);
  const [uploadResult, setUploadResult] = useState<ParseImageResult | null>(null);

  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterReimbursementStatus, setFilterReimbursementStatus] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDesc, setSortDesc] = useState(true);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchInput]);

  const navigate = useNavigate();
  const { canWrite } = useUser();
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await listReceipts(PAGE_SIZE, page * PAGE_SIZE, filterCategory || undefined, undefined, search || undefined, filterReimbursementStatus || undefined);
      setReceipts(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(String(e));
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [page, filterCategory, filterReimbursementStatus, search]);

  const filtered = useMemo(() => {
    let rows = receipts.slice();
    rows.sort((a, b) => {
      const av = a[sortKey] as string | number;
      const bv = b[sortKey] as string | number;
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return rows;
  }, [receipts, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const handleReimburse = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await markReimbursed(id);
    await refresh();
  };

  const handleBulkSetStatus = async (newStatus: 'none' | 'pending' | 'reimbursed') => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const result = await bulkSetReimbursementStatus(Array.from(selectedIds), newStatus);
      const label = newStatus === 'reimbursed' ? 'reimbursed' : newStatus === 'pending' ? 'pending' : 'not reimbursed';
      toast.success(`Marked ${result.updated} receipt${result.updated !== 1 ? "s" : ""} as ${label}.`);
      setSelectedIds(new Set());
      await refresh();
    } catch (e) {
      toast.error("Bulk update failed.");
    } finally {
      setBulkLoading(false);
    }
  };

  // Unreimbursed receipts visible in the current filtered view
  const selectableIds = filtered.filter(r => r.reimbursement_status !== 'reimbursed').map(r => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  const someSelected = selectableIds.some(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    await deleteReceipt(id);
    setEditing(null);
    setReceipts(prev => prev.filter(r => r.id !== id));
    setTotal(prev => prev - 1);
    toast.success("Receipt deleted.");
  };

  const handleSave = async (patch: Partial<Receipt>) => {
    if (!editing) return;
    await updateReceipt(editing.id, patch);
    setEditing(null);
    await refresh();
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    setUploadParsing(true);
    try {
      const result = await parseReceiptImage(file);
      setUploadResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Could not parse receipt: ${msg}`);
    } finally {
      setUploadParsing(false);
    }
  };

  return (
    <div>
      {/* Hidden file input for camera/photo upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoSelect}
      />

      {/* Parsing overlay */}
      {uploadParsing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl px-8 py-6 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <div className="text-slate-700 font-medium">Parsing receipt…</div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <div className="flex gap-2">
          {canWrite && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-700 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <Camera size={15} /> Add Receipt
            </button>
          )}
          {canWrite && (
            <button
              onClick={() => { setCreateForm({ recurring_type: "one_off", category_variable: "personal" }); setShowCreate(true); }}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              + Create Receipt
            </button>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5">
          <span className="text-sm text-indigo-700 font-medium">{selectedIds.size} selected</span>
          <button
            onClick={() => handleBulkSetStatus('pending')}
            disabled={bulkLoading}
            className="inline-flex items-center gap-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 font-medium"
          >
            <Check size={14} /> {bulkLoading ? "Marking…" : "Mark Pending"}
          </button>
          <button
            onClick={() => handleBulkSetStatus('reimbursed')}
            disabled={bulkLoading}
            className="inline-flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 font-medium"
          >
            <Check size={14} /> {bulkLoading ? "Marking…" : "Mark Reimbursed"}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-slate-500 hover:text-slate-700 ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="search"
          placeholder="Search payee, purpose, category…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <select
          className="border rounded px-2 py-1 text-sm"
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(0); }}
        >
          <option value="">All categories</option>
          {KNOWN_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          className="border rounded px-2 py-1 text-sm"
          value={filterReimbursementStatus}
          onChange={(e) => { setFilterReimbursementStatus(e.target.value); setPage(0); }}
        >
          <option value="">Any status</option>
          <option value="none">Not reimbursed</option>
          <option value="pending">Pending reimbursement</option>
          <option value="reimbursed">Reimbursed</option>
        </select>
      </div>

      {error && <div className="text-red-600 mb-3">{error}</div>}
      {
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="px-3 py-2 w-8">
                  {canWrite && selectableIds.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                      onClick={e => e.stopPropagation()}
                    />
                  )}
                </th>
                {(["date", "payee", "amount", "category_variable"] as SortKey[]).map((k) => (
                  <th
                    key={k}
                    className="text-left px-3 py-2 cursor-pointer"
                    onClick={() => toggleSort(k)}
                  >
                    {k} {sortKey === k ? (sortDesc ? "↓" : "↑") : ""}
                  </th>
                ))}
                <th className="hidden md:table-cell text-left px-3 py-2">payment category</th>
                <th className="hidden md:table-cell text-left px-3 py-2">payment detail</th>
                <th className="hidden md:table-cell text-left px-3 py-2">recurring</th>
                <th className="text-left px-3 py-2">reimbursed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-12 text-slate-400">
                    <div className="text-3xl mb-2">🧾</div>
                    <div className="text-sm">No receipts found. Try adjusting your filter or syncing the inbox.</div>
                  </td>
                </tr>
              ) : filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => navigate(`/receipts/${r.id}`)}
                  className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${
                    selectedIds.has(r.id) ? "bg-indigo-50" :
                    r.category_variable === "uncategorized" ? "bg-amber-50 hover:bg-amber-100" : ""
                  }`}
                >
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    {canWrite && r.reimbursement_status !== 'reimbursed' && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => {}}
                        onClick={(e) => toggleSelect(e, r.id)}
                        className="cursor-pointer"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">{r.date}</td>
                  <td className="px-3 py-2">
                    <div>{r.canonical_payee || r.payee}</div>
                    {r.canonical_payee && r.canonical_payee !== r.payee && (
                      <div className="text-xs text-slate-400 truncate max-w-xs">{r.payee}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{fmtCurrency(r.amount)}</td>
                  <td className="px-3 py-2">
                    {r.category_variable === "uncategorized" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">uncategorized</span>
                    ) : (
                      r.category_variable
                    )}
                  </td>
                  <td className="hidden md:table-cell px-3 py-2 text-slate-500 text-xs">{r.payment_category ?? "—"}</td>
                  <td className="hidden md:table-cell px-3 py-2 text-slate-500 text-xs max-w-xs truncate" title={r.payment_detail ?? ""}>{r.payment_detail ?? "—"}</td>
                  <td className="hidden md:table-cell px-3 py-2">{r.recurring_type}</td>
                  <td className="px-3 py-2">
                    {r.reimbursement_status === 'reimbursed' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">reimbursed</span>
                    ) : r.reimbursement_status === 'pending' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">pending</span>
                    ) : (
                      <span className="text-slate-400 text-xs">none</span>
                    )}
                  </td>
                  <td className="px-3 py-2 flex gap-2 justify-end">
                    {canWrite && !r.is_reimbursed && (
                      <button
                        onClick={(e) => handleReimburse(e, r.id)}
                        className="inline-flex items-center gap-1 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded"
                      >
                        <Check size={12} /> reimburse
                      </button>
                    )}
                    {canWrite && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(r); }}
                        className="inline-flex items-center gap-1 text-xs bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded"
                      >
                        <Pencil size={12} /> edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }

      {total > 0 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white rounded-b-xl">
          <div className="text-sm text-slate-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
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

      {editing && <EditDrawer receipt={editing} onClose={() => setEditing(null)} onSave={handleSave} onDelete={handleDelete} />}

      {uploadResult && (
        <UploadReceiptModal
          parsed={uploadResult}
          onClose={() => setUploadResult(null)}
          onSaved={async () => {
            setUploadResult(null);
            setPage(0);
            await refresh();
          }}
        />
      )}

      {/* Create Receipt Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Create Receipt</h2>
            <div className="space-y-3">
              {([
                ["Payee", "payee", "text"],
                ["Amount", "amount", "number"],
                ["Date", "date", "date"],
                ["Purpose", "inferred_purpose", "text"],
                ["Payment Category", "payment_category", "text"],
                ["Payment Detail", "payment_detail", "text"],
                ["Notes", "notes", "text"],
              ] as [string, keyof ReceiptCreateRequest, string][]).map(([label, field, type]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={(createForm[field] as string | number) ?? ""}
                    onChange={(e) => setCreateForm(f => ({ ...f, [field]: type === "number" ? parseFloat(e.target.value) : e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
                <select
                  value={createForm.category_variable ?? "personal"}
                  onChange={(e) => setCreateForm(f => ({ ...f, category_variable: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm"
                >
                  {KNOWN_CATEGORIES.filter(c => c !== "uncategorized").map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Recurring</label>
                <select
                  value={createForm.recurring_type ?? "one_off"}
                  onChange={(e) => setCreateForm(f => ({ ...f, recurring_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="one_off">One-off</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button
                disabled={createSaving}
                onClick={async () => {
                  if (!createForm.payee || !createForm.amount || !createForm.date) {
                    toast.error("Payee, amount, and date are required.");
                    return;
                  }
                  setCreateSaving(true);
                  try {
                    await createReceipt(createForm as ReceiptCreateRequest);
                    toast.success("Receipt created!");
                    setShowCreate(false);
                    setPage(0);
                  } catch (e) {
                    toast.error("Failed to create receipt.");
                  } finally {
                    setCreateSaving(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {createSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadReceiptModal({
  parsed,
  onClose,
  onSaved,
}: {
  parsed: ParseImageResult;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<ReceiptCreateRequest>>({
    payee: parsed.payee,
    amount: parsed.amount,
    date: parsed.date,
    inferred_purpose: parsed.inferred_purpose,
    payment_category: parsed.payment_category,
    payment_detail: parsed.payment_detail,
    recurring_type: parsed.recurring_type ?? "one_off",
    category_variable: "personal",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.payee || !form.amount || !form.date) {
      toast.error("Payee, amount, and date are required.");
      return;
    }
    // Explicit auth guard: surface the problem immediately instead of
    // letting the request fail silently without a token.
    await auth.authStateReady();
    if (!auth.currentUser) {
      toast.error("Not signed in — please sign out and sign back in.");
      return;
    }
    setSaving(true);
    try {
      const receipt = await createReceipt(form as ReceiptCreateRequest);
      await attachImage(receipt.id, {
        gcs_uri: parsed.attachment_gcs_uri,
        file_type: parsed.attachment_file_type,
        filename: parsed.attachment_filename ?? undefined,
      });
      toast.success("Receipt saved!");
      await onSaved();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to save receipt: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-slate-800">Review Parsed Receipt</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-500 mb-1">AI extracted these fields — review and edit before saving.</p>
        <p className="text-xs mb-4 font-mono {auth.currentUser ? 'text-green-600' : 'text-red-500'}">
          {auth.currentUser ? `✓ signed in as ${auth.currentUser.email}` : '✗ not signed in'}
        </p>
        <div className="space-y-3">
          {([
            ["Payee", "payee", "text"],
            ["Amount", "amount", "number"],
            ["Date", "date", "date"],
            ["Purpose", "inferred_purpose", "text"],
            ["Payment Category", "payment_category", "text"],
            ["Payment Detail", "payment_detail", "text"],
          ] as [string, keyof ReceiptCreateRequest, string][]).map(([label, field, type]) => (
            <div key={field}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <input
                type={type}
                value={(form[field] as string | number) ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    [field]: type === "number" ? parseFloat(e.target.value) : e.target.value,
                  }))
                }
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
            <select
              value={form.category_variable ?? "personal"}
              onChange={(e) => setForm((f) => ({ ...f, category_variable: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm"
            >
              {KNOWN_CATEGORIES.filter((c) => c !== "uncategorized").map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Recurring</label>
            <select
              value={form.recurring_type ?? "one_off"}
              onChange={(e) => setForm((f) => ({ ...f, recurring_type: e.target.value }))}
              className="w-full border rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="one_off">One-off</option>
              <option value="ongoing">Ongoing</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditDrawer({
  receipt,
  onClose,
  onSave,
  onDelete,
}: {
  receipt: Receipt;
  onClose: () => void;
  onSave: (patch: Partial<Receipt>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [payee, setPayee] = useState(receipt.payee);
  const [amount, setAmount] = useState(String(receipt.amount));
  const [date, setDate] = useState(receipt.date);

  // Category state — detect if current value is outside known list
  const isCustomInitial = !KNOWN_CATEGORIES.includes(receipt.category_variable);
  const [categorySelect, setCategorySelect] = useState(
    isCustomInitial ? "__custom__" : receipt.category_variable
  );
  const [customCategory, setCustomCategory] = useState(
    isCustomInitial ? receipt.category_variable : ""
  );
  const effectiveCategory =
    categorySelect === "__custom__" ? customCategory.trim() : categorySelect;

  // New fields
  const [recurringType, setRecurringType] = useState<"one_off" | "ongoing">(
    receipt.recurring_type
  );
  const [paymentCategory, setPaymentCategory] = useState(receipt.payment_category ?? "");
  const [paymentDetail, setPaymentDetail] = useState(receipt.payment_detail ?? "");
  const [inferredPurpose, setInferredPurpose] = useState(receipt.inferred_purpose ?? "");
  const [notes, setNotes] = useState(receipt.notes ?? "");
  const [reimbursementOwner, setReimbursementOwner] = useState(
    receipt.reimbursement_owner ?? ""
  );
  const [isTaxDeductible, setIsTaxDeductible] = useState(
    receipt.is_tax_deductible ?? false
  );
  const [reimbursementStatus, setReimbursementStatus] = useState<
    "none" | "pending" | "reimbursed"
  >(receipt.reimbursement_status);

  const [saving, setSaving] = useState(false);

  // Drive the slide-in: mount off-screen, then animate to open on next tick.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        payee,
        amount: Number(amount),
        date,
        category_variable: effectiveCategory || receipt.category_variable,
        recurring_type: recurringType,
        payment_category: paymentCategory.trim() || null,
        payment_detail: paymentDetail.trim() || null,
        inferred_purpose: inferredPurpose.trim() || null,
        notes: notes.trim() || null,
        reimbursement_owner: reimbursementOwner.trim() || null,
        is_tax_deductible: isTaxDeductible,
        reimbursement_status: reimbursementStatus,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div>
            <div className="font-medium">Edit receipt</div>
            <div className="text-sm text-slate-500">{receipt.payee}</div>
          </div>
          <button onClick={onClose} className="mt-0.5">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <label className="block text-sm mb-2">
            Payee
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="block text-sm mb-2">
            Amount
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="block text-sm mb-2">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="block text-sm mb-1">
            Category
            <select
              value={categorySelect}
              onChange={(e) => setCategorySelect(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            >
              {KNOWN_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="__custom__">+ new category…</option>
            </select>
          </label>
          {categorySelect === "__custom__" && (
            <input
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="e.g. medical"
              className="border rounded px-2 py-1 w-full mb-2 text-sm"
              autoFocus
            />
          )}
          <label className="block text-sm mb-2">
            Recurring type
            <select
              value={recurringType}
              onChange={(e) => setRecurringType(e.target.value as "one_off" | "ongoing")}
              className="border rounded px-2 py-1 w-full mt-1"
            >
              <option value="one_off">one_off</option>
              <option value="ongoing">ongoing</option>
            </select>
          </label>
          <label className="block text-sm mb-2">
            Payment category
            <input
              value={paymentCategory}
              onChange={(e) => setPaymentCategory(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="block text-sm mb-2">
            Payment detail
            <input
              value={paymentDetail}
              onChange={(e) => setPaymentDetail(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="block text-sm mb-2">
            Inferred purpose
            <textarea
              value={inferredPurpose}
              onChange={(e) => setInferredPurpose(e.target.value)}
              rows={2}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="block text-sm mb-2">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="block text-sm mb-2">
            Reimbursement owner
            <input
              value={reimbursementOwner}
              onChange={(e) => setReimbursementOwner(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input
              type="checkbox"
              checked={isTaxDeductible}
              onChange={(e) => setIsTaxDeductible(e.target.checked)}
              className="rounded"
            />
            Is tax deductible
          </label>
          <label className="block text-sm mb-2">
            Reimbursement status
            <select
              value={reimbursementStatus}
              onChange={(e) =>
                setReimbursementStatus(e.target.value as "none" | "pending" | "reimbursed")
              }
              className="border rounded px-2 py-1 w-full mt-1"
            >
              <option value="none">none</option>
              <option value="pending">pending</option>
              <option value="reimbursed">reimbursed</option>
            </select>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <button
            onClick={async () => {
              if (!window.confirm("Delete this receipt? This can't be undone.")) return;
              setDeleting(true);
              try { await onDelete(receipt.id); } finally { setDeleting(false); }
            }}
            disabled={deleting}
            className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1 text-sm">Cancel</button>
            <button
              onClick={submit}
              disabled={saving}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded text-sm"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

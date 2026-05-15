import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAttachmentUrl, getReceipt, updateReceipt, Receipt } from "../api";
import { ArrowLeft, Pencil, X } from "lucide-react";

const KNOWN_CATEGORIES = ["personal", "realestate", "traverse", "edgehill", "trust", "nopa", "uncategorized"];

export default function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!id) return;
    getReceipt(id)
      .then(setReceipt)
      .catch((e) => {
        const msg = String(e);
        if (msg.includes("404") || msg.includes("not found")) {
          setNotFound(true);
        } else {
          setError(msg);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async (patch: Partial<Receipt>) => {
    if (!id) return;
    const updated = await updateReceipt(id, patch);
    setReceipt(updated);
    setEditing(false);
  };

  const handleDownload = async (attachmentId: string) => {
    if (!id) return;
    setDownloadingId(attachmentId);
    try {
      const result = await getAttachmentUrl(id, attachmentId);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert("Failed to get download URL: " + String(e));
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="text-slate-500 mt-8">Loading…</div>
    );
  }

  if (notFound) {
    return (
      <div className="mt-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="text-slate-500">Receipt not found.</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  if (!receipt) return null;

  const uncategorized = receipt.category_variable === "uncategorized";

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{receipt.payee}</h1>
          <div className="text-sm text-slate-500 mt-1">{receipt.date}</div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`text-xl font-semibold px-3 py-1 rounded-lg ${
              uncategorized ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-700"
            }`}
          >
            ${Number(receipt.amount).toFixed(2)}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
          >
            <Pencil size={12} /> Edit
          </button>
        </div>
      </div>

      {/* Purpose card */}
      {receipt.inferred_purpose && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Purpose</div>
          <div className="text-slate-800">{receipt.inferred_purpose}</div>
        </div>
      )}

      {/* Details card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Details</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Date</dt>
          <dd className="text-slate-800">{receipt.date}</dd>

          <dt className="text-slate-500">Amount</dt>
          <dd className="text-slate-800">${Number(receipt.amount).toFixed(2)}</dd>

          <dt className="text-slate-500">Category</dt>
          <dd>
            {uncategorized ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                uncategorized
              </span>
            ) : (
              <span className="text-slate-800">{receipt.category_variable}</span>
            )}
          </dd>

          <dt className="text-slate-500">Payment category</dt>
          <dd className="text-slate-800">{receipt.payment_category ?? "—"}</dd>

          <dt className="text-slate-500">Payment detail</dt>
          <dd className="text-slate-800 break-words">{receipt.payment_detail ?? "—"}</dd>

          <dt className="text-slate-500">Recurring</dt>
          <dd className="text-slate-800">{receipt.recurring_type}</dd>

          <dt className="text-slate-500">Reimbursed</dt>
          <dd className="text-slate-800">
            {receipt.is_reimbursed ? (
              <span className="text-green-700">
                Yes{receipt.reimbursed_at ? ` — ${new Date(receipt.reimbursed_at).toLocaleDateString()}` : ""}
              </span>
            ) : (
              <span className="text-slate-500">No</span>
            )}
          </dd>

          <dt className="text-slate-500">Created</dt>
          <dd className="text-slate-800">{new Date(receipt.created_at).toLocaleString()}</dd>
        </dl>
      </div>

      {editing && receipt && (
        <EditModal receipt={receipt} onClose={() => setEditing(false)} onSave={handleSave} />
      )}

      {/* Attachments */}
      {receipt.attachments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Attachments</div>
          <div className="flex flex-col gap-2">
            {receipt.attachments.map((att) => {
              const filename = att.gcs_uri.split("/").pop() ?? att.id;
              const isDownloading = downloadingId === att.id;
              return (
                <div key={att.id} className="flex items-center justify-between py-1">
                  <span className="text-sm text-slate-700 truncate mr-4">{filename}</span>
                  <button
                    onClick={() => handleDownload(att.id)}
                    disabled={isDownloading}
                    className="shrink-0 inline-flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
                  >
                    {isDownloading ? "Getting link…" : "Download"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EditModal({
  receipt,
  onClose,
  onSave,
}: {
  receipt: Receipt;
  onClose: () => void;
  onSave: (patch: Partial<Receipt>) => Promise<void>;
}) {
  const isCustomInitial = !KNOWN_CATEGORIES.includes(receipt.category_variable);
  const [payee, setPayee] = useState(receipt.payee);
  const [amount, setAmount] = useState(String(receipt.amount));
  const [date, setDate] = useState(receipt.date);
  const [categorySelect, setCategorySelect] = useState(
    isCustomInitial ? "__custom__" : receipt.category_variable
  );
  const [customCategory, setCustomCategory] = useState(
    isCustomInitial ? receipt.category_variable : ""
  );
  const effectiveCategory =
    categorySelect === "__custom__" ? customCategory.trim() : categorySelect;

  const [inferredPurpose, setInferredPurpose] = useState(receipt.inferred_purpose ?? "");
  const [paymentCategory, setPaymentCategory] = useState(receipt.payment_category ?? "");
  const [paymentDetail, setPaymentDetail] = useState(receipt.payment_detail ?? "");
  const [notes, setNotes] = useState(receipt.notes ?? "");
  const [isTaxDeductible, setIsTaxDeductible] = useState(receipt.is_tax_deductible ?? false);
  const [reimbursementOwner, setReimbursementOwner] = useState(receipt.reimbursement_owner ?? "");

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        payee,
        amount: Number(amount),
        date,
        category_variable: effectiveCategory || receipt.category_variable,
        inferred_purpose: inferredPurpose || null,
        payment_category: paymentCategory || null,
        payment_detail: paymentDetail || null,
        notes: notes || null,
        is_tax_deductible: isTaxDeductible,
        reimbursement_owner: reimbursementOwner || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium">Edit receipt</div>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <label className="block text-sm">
            Payee
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>

          <label className="block text-sm">
            Amount
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>

          <label className="block text-sm">
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
              className="border rounded px-2 py-1 w-full text-sm"
              autoFocus
            />
          )}

          <label className="block text-sm">
            Purpose
            <input
              value={inferredPurpose}
              onChange={(e) => setInferredPurpose(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>

          <label className="block text-sm">
            Payment category
            <input
              value={paymentCategory}
              onChange={(e) => setPaymentCategory(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>

          <label className="block text-sm">
            Payment detail
            <input
              value={paymentDetail}
              onChange={(e) => setPaymentDetail(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>

          <label className="block text-sm">
            Notes
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1 resize-none"
            />
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isTaxDeductible}
              onChange={(e) => setIsTaxDeductible(e.target.checked)}
              className="rounded"
            />
            Tax deductible
          </label>

          <label className="block text-sm">
            Reimbursed by / owed by
            <input
              value={reimbursementOwner}
              onChange={(e) => setReimbursementOwner(e.target.value)}
              className="border rounded px-2 py-1 w-full mt-1"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1 text-sm">
            Cancel
          </button>
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
  );
}

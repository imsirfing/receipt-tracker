import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useUser } from "../user-context";
import { fmtCurrency } from "../utils";
import { downloadAttachment, getReceipt, getReceiptAudit, updateReceipt, downloadEvidencePackage, Receipt, AuditEntry } from "../api";
import { ArrowLeft, Pencil, X, CheckCircle, Edit3, Trash2, Clock } from "lucide-react";

const KNOWN_CATEGORIES = ["personal", "realestate", "traverse", "edgehill", "trust", "nopa", "uncategorized"];

type Tab = "details" | "audit";

export default function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const { canWrite } = useUser();
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("details");
  const [auditLog, setAuditLog] = useState<AuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);

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

  useEffect(() => {
    if (activeTab !== "audit" || !id || auditLog !== null) return;
    setAuditLoading(true);
    getReceiptAudit(id)
      .then(setAuditLog)
      .catch((e) => setAuditError(String(e)))
      .finally(() => setAuditLoading(false));
  }, [activeTab, id, auditLog]);

  const handleSave = async (patch: Partial<Receipt>) => {
    if (!id) return;
    const updated = await updateReceipt(id, patch);
    setReceipt(updated);
    setEditing(false);
    // Invalidate audit cache so it reloads next time the tab is opened
    setAuditLog(null);
  };

  const handleDownload = async (att: { id: string; gcs_uri: string; filename?: string | null }) => {
    if (!id) return;
    setDownloadingId(att.id);
    const filename = att.filename || att.gcs_uri.split("/").pop() || att.id;
    try {
      await downloadAttachment(id, att.id, filename);
    } catch (e) {
      alert("Failed to download attachment: " + String(e));
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
  const isGmailSource = receipt.source === "gmail_auto";
  const gmailLink = isGmailSource && !receipt.raw_email_id.startsWith("manual-")
    ? `https://mail.google.com/mail/u/0/#all/${receipt.raw_email_id}`
    : null;

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{receipt.canonical_payee || receipt.payee}</h1>
          {receipt.canonical_payee && receipt.canonical_payee !== receipt.payee && (
            <div className="text-xs text-slate-400 mt-0.5">{receipt.payee}</div>
          )}
          <div className="text-sm text-slate-500 mt-1">{receipt.date}</div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`text-xl font-semibold px-3 py-1 rounded-lg ${
              uncategorized ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-700"
            }`}
          >
            {fmtCurrency(receipt.amount)}
          </div>
          <button
            onClick={async () => {
              if (!id) return;
              setEvidenceLoading(true);
              try {
                await downloadEvidencePackage(id);
              } catch (e) {
                alert("Failed to generate evidence package: " + String(e));
              } finally {
                setEvidenceLoading(false);
              }
            }}
            disabled={evidenceLoading}
            className="inline-flex items-center gap-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 px-2 py-1 rounded"
          >
            {evidenceLoading ? "Generating…" : "📦 Evidence Package"}
          </button>
          {canWrite && (
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
            >
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {(["details", "audit"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-indigo-600 text-indigo-600 -mb-px"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab === "audit" ? "Audit Trail" : "Details"}
          </button>
        ))}
      </div>

      {activeTab === "details" && (
        <>
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
              <dd className="text-slate-800">{fmtCurrency(receipt.amount)}</dd>

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

              <dt className="text-slate-500">Source</dt>
              <dd>
                {isGmailSource ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                    Gmail auto-parse
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                    Manual
                  </span>
                )}
              </dd>

              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-800">{new Date(receipt.created_at).toLocaleString()}</dd>

              {receipt.updated_at && receipt.updated_at !== receipt.created_at && (
                <>
                  <dt className="text-slate-500">Last edited</dt>
                  <dd className="text-slate-800">{new Date(receipt.updated_at).toLocaleString()}</dd>
                </>
              )}

              {gmailLink && (
                <>
                  <dt className="text-slate-500">Gmail</dt>
                  <dd>
                    <a
                      href={gmailLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline text-xs"
                    >
                      View original email ↗
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </div>

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
                        onClick={() => handleDownload(att)}
                        disabled={isDownloading}
                        className="shrink-0 inline-flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
                      >
                        {isDownloading ? "Downloading…" : "Download"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "audit" && (
        <AuditTrailTab
          log={auditLog}
          loading={auditLoading}
          error={auditError}
          rawEmailId={receipt.raw_email_id}
        />
      )}

      {editing && receipt && (
        <EditModal receipt={receipt} onClose={() => setEditing(false)} onSave={handleSave} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Trail Tab
// ---------------------------------------------------------------------------

const EVENT_ICON: Record<string, React.ReactNode> = {
  created: <CheckCircle size={16} className="text-green-600" />,
  updated: <Edit3 size={16} className="text-blue-600" />,
  deleted: <Trash2 size={16} className="text-red-500" />,
  restored: <CheckCircle size={16} className="text-purple-600" />,
  exported: <Clock size={16} className="text-slate-500" />,
};

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  deleted: "Deleted (soft)",
  restored: "Restored",
  exported: "Evidence package exported",
};

function formatFieldLabel(field: string): string {
  return field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function AuditTrailTab({
  log,
  loading,
  error,
  rawEmailId,
}: {
  log: AuditEntry[] | null;
  loading: boolean;
  error: string | null;
  rawEmailId: string;
}) {
  if (loading) return <div className="text-slate-500 text-sm mt-4">Loading audit trail…</div>;
  if (error) return <div className="text-red-600 text-sm mt-4">{error}</div>;
  if (!log || log.length === 0) {
    return (
      <div className="text-slate-400 text-sm mt-4 italic">
        No audit events yet. Events are recorded going forward from when audit trail was enabled.
      </div>
    );
  }

  const gmailLink = rawEmailId && !rawEmailId.startsWith("manual-")
    ? `https://mail.google.com/mail/u/0/#all/${rawEmailId}`
    : null;

  return (
    <div className="space-y-3">
      {/* Email provenance banner */}
      {gmailLink && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm flex items-center justify-between">
          <div>
            <div className="font-medium text-blue-800 text-xs uppercase tracking-wide mb-0.5">Original Source</div>
            <div className="text-blue-700">Parsed from Gmail email</div>
          </div>
          <a
            href={gmailLink}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg"
          >
            View in Gmail ↗
          </a>
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />

        <div className="space-y-4">
          {log.map((entry) => (
            <div key={entry.id} className="relative flex gap-4">
              {/* Icon bubble */}
              <div className="shrink-0 w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center z-10">
                {EVENT_ICON[entry.event_type] ?? <Clock size={16} className="text-slate-400" />}
              </div>

              {/* Card */}
              <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm p-3 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-slate-800">
                    {EVENT_LABEL[entry.event_type] ?? entry.event_type}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {new Date(entry.event_at).toLocaleString()}
                  </span>
                </div>

                {entry.edit_reason && (
                  <div className="text-xs text-slate-500 italic mb-2">
                    Reason: {entry.edit_reason}
                  </div>
                )}

                {/* Field diffs for updates */}
                {entry.event_type === "updated" && entry.fields_changed && entry.fields_changed.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {entry.fields_changed.map((field) => {
                      const before = entry.snapshot_before?.[field];
                      const after = entry.snapshot_after?.[field];
                      return (
                        <div key={field} className="text-xs">
                          <span className="font-medium text-slate-600">{formatFieldLabel(field)}:</span>{" "}
                          <span className="line-through text-slate-400">
                            {before !== undefined && before !== null ? String(before) : "—"}
                          </span>
                          {" → "}
                          <span className="text-slate-800 font-medium">
                            {after !== undefined && after !== null ? String(after) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Created: show source info */}
                {entry.event_type === "created" && entry.snapshot_after && (
                  <div className="text-xs text-slate-500">
                    Source: {String(entry.snapshot_after["source"] ?? "manual")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
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

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getAttachmentUrl, getReceipt, Receipt } from "../api";
import { ArrowLeft } from "lucide-react";

export default function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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
        <div
          className={`text-xl font-semibold px-3 py-1 rounded-lg ${
            uncategorized ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-700"
          }`}
        >
          ${Number(receipt.amount).toFixed(2)}
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

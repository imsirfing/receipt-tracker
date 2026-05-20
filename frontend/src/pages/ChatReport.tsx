import { useState } from "react";
import { Send } from "lucide-react";
import { requestReport } from "../api";

export default function ChatReport() {
  const [message, setMessage] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const pdfUrl = await requestReport(message);
      setPdfUrl(pdfUrl);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Chat report</h1>
      <p className="text-slate-500 mb-4 text-sm">
        Describe what you want — e.g. "Show me all Edgehill expenses this month" or "Unreimbursed traverse receipts".
      </p>

      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 mb-6">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Your query…"
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-medium"
        >
          <Send size={16} /> {loading ? "Working…" : "Generate PDF"}
        </button>
      </form>

      {error && <div className="text-red-600 mb-4">{error}</div>}

      {pdfUrl && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="mb-2 text-sm">
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
              Download PDF
            </a>
          </div>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="md:hidden block w-full text-center py-3 bg-indigo-600 text-white rounded-lg font-medium mb-3"
          >
            Open / Download PDF ↗
          </a>
          <iframe src={pdfUrl} title="report" className="hidden md:block w-full h-[600px] border" />
        </div>
      )}
    </div>
  );
}

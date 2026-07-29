import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PlusCircle, RefreshCw, Wallet } from "lucide-react";
import { listCashBoxes, createCashBox, createCashTransaction, CashBox } from "../api";

const fmtDollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const CATEGORIES = ["personal", "realestate", "traverse", "edgehill", "trust", "nopa", "uncategorized"];

export default function CashBoxes() {
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<CashBox[]>([]);
  const [loading, setLoading] = useState(true);

  // New box modal
  const [showNewBox, setShowNewBox] = useState(false);
  const [newBoxName, setNewBoxName] = useState("");
  const [newBoxCategory, setNewBoxCategory] = useState("");
  const [newBoxNotes, setNewBoxNotes] = useState("");
  const [savingBox, setSavingBox] = useState(false);

  // Replenish modal
  const [replenishTarget, setReplenishTarget] = useState<CashBox | null>(null);
  const [replenishAmount, setReplenishAmount] = useState("");
  const [replenishDate, setReplenishDate] = useState(new Date().toISOString().split("T")[0]);
  const [replenishDesc, setReplenishDesc] = useState("");
  const [savingReplenish, setSavingReplenish] = useState(false);

  const load = () => {
    setLoading(true);
    listCashBoxes()
      .then(setBoxes)
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreateBox = async () => {
    if (!newBoxName.trim()) { toast.error("Name is required"); return; }
    setSavingBox(true);
    try {
      await createCashBox({
        name: newBoxName.trim(),
        category_variable: newBoxCategory || null,
        notes: newBoxNotes || null,
      });
      toast.success("Cash box created");
      setShowNewBox(false);
      setNewBoxName(""); setNewBoxCategory(""); setNewBoxNotes("");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingBox(false);
    }
  };

  const handleReplenish = async () => {
    if (!replenishTarget) return;
    const dollars = parseFloat(replenishAmount);
    if (isNaN(dollars) || dollars <= 0) { toast.error("Enter a valid amount"); return; }
    setSavingReplenish(true);
    try {
      await createCashTransaction(replenishTarget.id, {
        type: "replenishment",
        amount_cents: Math.round(dollars * 100),
        date: replenishDate,
        description: replenishDesc || null,
      });
      toast.success("Replenishment logged");
      setReplenishTarget(null);
      setReplenishAmount(""); setReplenishDesc("");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingReplenish(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Wallet size={22} className="text-indigo-600" />
          <h1 className="text-2xl font-semibold text-slate-800">Petty Cash</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button
            onClick={() => setShowNewBox(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <PlusCircle size={14} /> New Cash Box
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : boxes.length === 0 ? (
        <div className="text-center text-slate-400 py-16">
          <Wallet size={40} className="mx-auto mb-3 opacity-40" />
          <p>No cash boxes yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Category Scope</th>
                <th className="text-right px-4 py-3">Balance</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((box) => (
                <tr
                  key={box.id}
                  onClick={() => navigate(`/cash-boxes/${box.id}`)}
                  className="border-b border-slate-100 last:border-0 hover:bg-indigo-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{box.name}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {box.category_variable || <span className="italic opacity-50">All</span>}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${
                    box.balance_cents < 2000 ? "text-amber-600" : "text-emerald-600"
                  }`}>
                    {fmtDollars(box.balance_cents)}
                    {box.balance_cents < 2000 && (
                      <span className="ml-1.5 text-xs font-normal text-amber-500">Low</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setReplenishTarget(box);
                        setReplenishAmount("");
                        setReplenishDate(new Date().toISOString().split("T")[0]);
                        setReplenishDesc("");
                      }}
                      className="px-2.5 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                    >
                      Replenish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Cash Box Modal */}
      {showNewBox && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4 text-slate-800">New Cash Box</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="e.g. Office Petty Cash"
                  value={newBoxName}
                  onChange={(e) => setNewBoxName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category Scope (optional)</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={newBoxCategory}
                  onChange={(e) => setNewBoxCategory(e.target.value)}
                >
                  <option value="">— Any category —</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  rows={2}
                  value={newBoxNotes}
                  onChange={(e) => setNewBoxNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowNewBox(false)}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBox}
                disabled={savingBox}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingBox ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replenish Modal */}
      {replenishTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-1 text-slate-800">Replenish</h2>
            <p className="text-sm text-slate-500 mb-4">{replenishTarget.name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount ($) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="0.00"
                  value={replenishAmount}
                  onChange={(e) => setReplenishAmount(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={replenishDate}
                  onChange={(e) => setReplenishDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="Optional description"
                  value={replenishDesc}
                  onChange={(e) => setReplenishDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setReplenishTarget(null)}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReplenish}
                disabled={savingReplenish}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingReplenish ? "Saving…" : "Replenish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

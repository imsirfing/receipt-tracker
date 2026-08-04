import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, PlusCircle, Scale, Trash2 } from "lucide-react";
import {
  listCashBoxes,
  listCashTransactions,
  createCashTransaction,
  deleteCashTransaction,
  CashBox,
  CashTransaction,
} from "../api";

const fmtDollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const TRANSACTION_COLORS: Record<string, string> = {
  replenishment: "text-emerald-600",
  expense: "text-red-600",
  adjustment: "text-amber-600",
  reconciliation: "text-blue-600",
};

export default function CashBoxDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [box, setBox] = useState<CashBox | null>(null);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Expense modal
  const [showExpense, setShowExpense] = useState(false);
  const [expAmt, setExpAmt] = useState("");
  const [expDate, setExpDate] = useState(new Date().toISOString().split("T")[0]);
  const [expDesc, setExpDesc] = useState("");
  const [expReceiptId, setExpReceiptId] = useState("");
  const [expNotes, setExpNotes] = useState("");
  const [savingExp, setSavingExp] = useState(false);

  // Reconcile modal
  const [showReconcile, setShowReconcile] = useState(false);
  const [reconcileAmt, setReconcileAmt] = useState("");
  const [reconcileNotes, setReconcileNotes] = useState("");
  const [savingReconcile, setSavingReconcile] = useState(false);
  const [deletingTxnId, setDeletingTxnId] = useState<string | null>(null);

  const computeBalance = (txns: CashTransaction[]) => {
    let bal = 0;
    for (const t of txns) {
      if (t.type === "replenishment" || t.type === "adjustment") bal += t.amount_cents;
      else if (t.type === "expense" || t.type === "reconciliation") bal -= t.amount_cents;
    }
    return bal;
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [boxes, txns] = await Promise.all([listCashBoxes(), listCashTransactions(id)]);
      const found = boxes.find((b) => b.id === id);
      if (!found) { toast.error("Cash box not found"); navigate("/cash-boxes"); return; }
      setBox(found);
      setTransactions(txns);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleExpense = async () => {
    if (!id) return;
    const dollars = parseFloat(expAmt);
    if (isNaN(dollars) || dollars <= 0) { toast.error("Enter a valid amount"); return; }
    setSavingExp(true);
    try {
      await createCashTransaction(id, {
        type: "expense",
        amount_cents: Math.round(dollars * 100),
        date: expDate,
        description: expDesc || null,
        receipt_id: expReceiptId || null,
        notes: expNotes || null,
      });
      toast.success("Expense logged");
      setShowExpense(false);
      setExpAmt(""); setExpDesc(""); setExpReceiptId(""); setExpNotes("");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingExp(false);
    }
  };

  const handleDeleteTransaction = async (txnId: string) => {
    if (!id) return;
    if (!window.confirm("Delete this transaction? This cannot be undone.")) return;
    setDeletingTxnId(txnId);
    try {
      await deleteCashTransaction(id, txnId);
      toast.success("Transaction deleted");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeletingTxnId(null);
    }
  };

  const handleReconcile = async () => {
    if (!id) return;
    const actual = parseFloat(reconcileAmt);
    if (isNaN(actual)) { toast.error("Enter a valid amount"); return; }
    const currentBalance = computeBalance(transactions);
    const delta = Math.round(actual * 100) - currentBalance;
    // delta > 0 → add adjustment; delta < 0 → post reconciliation to deduct
    const type = delta >= 0 ? "adjustment" : "reconciliation";
    const amount_cents = Math.abs(delta);
    if (amount_cents === 0) { toast.success("Balance already matches — no adjustment needed"); setShowReconcile(false); return; }
    setSavingReconcile(true);
    try {
      await createCashTransaction(id, {
        type,
        amount_cents,
        date: new Date().toISOString().split("T")[0],
        description: `Reconciliation — actual count: ${fmtDollars(Math.round(actual * 100))}`,
        notes: reconcileNotes || null,
      });
      toast.success(`Reconciliation posted (${delta >= 0 ? "+" : ""}${fmtDollars(delta)})`);
      setShowReconcile(false);
      setReconcileAmt(""); setReconcileNotes("");
      load();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSavingReconcile(false);
    }
  };

  if (loading) {
    return <div className="text-slate-400 text-sm p-8">Loading…</div>;
  }

  if (!box) return null;

  const balance = computeBalance(transactions);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/cash-boxes")} className="text-slate-400 hover:text-slate-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-slate-800">{box.name}</h1>
          {box.category_variable && (
            <p className="text-xs text-slate-400 mt-0.5">Scope: {box.category_variable}</p>
          )}
        </div>
        <div className={`text-2xl font-bold tabular-nums ${balance < 2000 ? "text-amber-600" : "text-emerald-600"}`}>
          {fmtDollars(balance)}
          {balance < 2000 && <span className="ml-2 text-xs font-normal text-amber-500">Low</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => { setShowExpense(true); setExpDate(new Date().toISOString().split("T")[0]); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
        >
          <PlusCircle size={14} /> Log Cash Expense
        </button>
        <button
          onClick={() => setShowReconcile(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
        >
          <Scale size={14} /> Reconcile
        </button>
      </div>

      {/* Transaction history */}
      {transactions.length === 0 ? (
        <div className="text-center text-slate-400 py-16 border border-dashed border-slate-200 rounded-xl">
          No transactions yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{t.date}</td>
                  <td className={`px-4 py-3 capitalize ${TRANSACTION_COLORS[t.type] ?? "text-slate-600"}`}>
                    {t.type}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.description || <span className="italic opacity-40">—</span>}
                    {t.receipt_id && (
                      <Link
                        to={`/receipts/${t.receipt_id}`}
                        className="ml-2 text-indigo-500 hover:underline text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Receipt ↗
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleDeleteTransaction(t.id)}
                      disabled={deletingTxnId === t.id}
                      className="text-slate-300 hover:text-red-500 disabled:opacity-30 transition-colors"
                      title="Delete transaction"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${
                    t.type === "replenishment" || t.type === "adjustment"
                      ? "text-emerald-600"
                      : "text-red-600"
                  }`}>
                    {t.type === "replenishment" || t.type === "adjustment" ? "+" : "−"}
                    {fmtDollars(t.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Log Expense Modal */}
      {showExpense && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4 text-slate-800">Log Cash Expense</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount ($) *</label>
                <input
                  type="number" min="0.01" step="0.01" autoFocus
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="0.00" value={expAmt} onChange={(e) => setExpAmt(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  value={expDate} onChange={(e) => setExpDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="What was it for?" value={expDesc} onChange={(e) => setExpDesc(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Receipt ID (optional)</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="UUID of linked receipt" value={expReceiptId} onChange={(e) => setExpReceiptId(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  rows={2} value={expNotes} onChange={(e) => setExpNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowExpense(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button onClick={handleExpense} disabled={savingExp} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {savingExp ? "Saving…" : "Log Expense"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reconcile Modal */}
      {showReconcile && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-1 text-slate-800">Reconcile Cash Box</h2>
            <p className="text-sm text-slate-500 mb-4">
              Current balance: <span className="font-semibold text-slate-700">{fmtDollars(balance)}</span>. Enter the actual amount you counted.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Actual Count ($) *</label>
                <input
                  type="number" min="0" step="0.01" autoFocus
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="0.00" value={reconcileAmt} onChange={(e) => setReconcileAmt(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                <textarea
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  rows={2} value={reconcileNotes} onChange={(e) => setReconcileNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowReconcile(false)} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
              <button onClick={handleReconcile} disabled={savingReconcile} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {savingReconcile ? "Saving…" : "Post Reconciliation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

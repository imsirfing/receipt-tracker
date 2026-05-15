import { useEffect, useMemo, useState } from "react";
import { Check, Pencil, RefreshCw, X } from "lucide-react";
import { listReceipts, markReimbursed, Receipt, triggerIngest, updateReceipt } from "../api";

type SortKey = "date" | "payee" | "amount" | "category_variable";

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterReimbursed, setFilterReimbursed] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDesc, setSortDesc] = useState(true);

  const [editing, setEditing] = useState<Receipt | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await triggerIngest();
      setSyncMsg(result.message);
      await refresh();
    } catch (e) {
      setSyncMsg("Sync failed — check backend logs.");
    } finally {
      setSyncing(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const rows = await listReceipts();
      setReceipts(rows);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filtered = useMemo(() => {
    let rows = receipts.slice();
    if (filterCategory) rows = rows.filter((r) => r.category_variable === filterCategory);
    if (filterReimbursed) rows = rows.filter((r) => String(r.is_reimbursed) === filterReimbursed);
    rows.sort((a, b) => {
      const av = a[sortKey] as string | number;
      const bv = b[sortKey] as string | number;
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return rows;
  }, [receipts, filterCategory, filterReimbursed, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const handleReimburse = async (id: string) => {
    await markReimbursed(id);
    await refresh();
  };

  const handleSave = async (patch: Partial<Receipt>) => {
    if (!editing) return;
    await updateReceipt(editing.id, patch);
    setEditing(null);
    await refresh();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Receipts</h1>
        <div className="flex items-center gap-3">
          {syncMsg && <span className="text-sm text-slate-600">{syncMsg}</span>}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync Inbox"}
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          className="border rounded px-2 py-1 text-sm"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {["personal", "realestate", "traverse", "edgehill", "trust"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          className="border rounded px-2 py-1 text-sm"
          value={filterReimbursed}
          onChange={(e) => setFilterReimbursed(e.target.value)}
        >
          <option value="">Any status</option>
          <option value="false">Unreimbursed</option>
          <option value="true">Reimbursed</option>
        </select>
      </div>

      {error && <div className="text-red-600 mb-3">{error}</div>}
      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                {(["date", "payee", "amount", "category_variable"] as SortKey[]).map((k) => (
                  <th
                    key={k}
                    className="text-left px-3 py-2 cursor-pointer"
                    onClick={() => toggleSort(k)}
                  >
                    {k} {sortKey === k ? (sortDesc ? "↓" : "↑") : ""}
                  </th>
                ))}
                <th className="text-left px-3 py-2">recurring</th>
                <th className="text-left px-3 py-2">reimbursed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.date}</td>
                  <td className="px-3 py-2">{r.payee}</td>
                  <td className="px-3 py-2">${Number(r.amount).toFixed(2)}</td>
                  <td className="px-3 py-2">{r.category_variable}</td>
                  <td className="px-3 py-2">{r.recurring_type}</td>
                  <td className="px-3 py-2">
                    {r.is_reimbursed ? (
                      <span className="text-green-700">yes</span>
                    ) : (
                      <span className="text-slate-500">no</span>
                    )}
                  </td>
                  <td className="px-3 py-2 flex gap-2 justify-end">
                    {!r.is_reimbursed && (
                      <button
                        onClick={() => handleReimburse(r.id)}
                        className="inline-flex items-center gap-1 text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded"
                      >
                        <Check size={12} /> reimburse
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(r)}
                      className="inline-flex items-center gap-1 text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded"
                    >
                      <Pencil size={12} /> edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditModal receipt={editing} onClose={() => setEditing(null)} onSave={handleSave} />}
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
  const [payee, setPayee] = useState(receipt.payee);
  const [amount, setAmount] = useState(String(receipt.amount));
  const [date, setDate] = useState(receipt.date);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ payee, amount: Number(amount), date });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-96 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium">Edit receipt</div>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>
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
        <label className="block text-sm mb-4">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border rounded px-2 py-1 w-full mt-1"
          />
        </label>
        <div className="flex justify-end gap-2">
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

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listReceipts, Receipt } from "../api";

const CATEGORIES = ["personal", "realestate", "traverse", "edgehill"];

export default function Dashboard() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReceipts()
      .then((rows) => setReceipts(rows))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const chartData = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      category: cat,
      total: receipts
        .filter((r) => r.category_variable === cat)
        .reduce((s, r) => s + Number(r.amount), 0),
    }));
  }, [receipts]);

  const totalSpend = receipts.reduce((s, r) => s + Number(r.amount), 0);
  const unreimbursed = receipts
    .filter((r) => !r.is_reimbursed)
    .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>

      {error && <div className="text-red-600 mb-4">{error}</div>}
      {loading && <div className="text-slate-500">Loading…</div>}

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card label="Total receipts" value={receipts.length.toString()} />
        <Card label="Total spend" value={`$${totalSpend.toFixed(2)}`} />
        <Card label="Unreimbursed" value={`$${unreimbursed.toFixed(2)}`} accent />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="font-medium mb-3">Spend by category</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" />
            <YAxis />
            <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
            <Bar dataKey="total" fill="#4F46E5" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent ? "text-indigo-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

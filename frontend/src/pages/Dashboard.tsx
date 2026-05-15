import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  PieChart, Pie, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { listReceipts, Receipt } from "../api";

const CATEGORIES = ["personal", "realestate", "traverse", "edgehill", "trust", "nopa", "uncategorized"];

const CATEGORY_COLORS: Record<string, string> = {
  personal:      "#6366f1", // indigo
  realestate:    "#0ea5e9", // sky
  traverse:      "#10b981", // emerald
  edgehill:      "#f59e0b", // amber
  trust:         "#8b5cf6", // violet
  nopa:          "#ec4899", // pink
  uncategorized: "#94a3b8", // slate
};

const categoryColor = (cat: string) => CATEGORY_COLORS[cat] ?? "#94a3b8";

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

  const byCategory = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      name: cat,
      total: receipts
        .filter((r) => r.category_variable === cat)
        .reduce((s, r) => s + Number(r.amount), 0),
    }));
  }, [receipts]);

  const pieData = byCategory.filter((d) => d.total > 0);

  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    receipts.forEach((r) => {
      const month = r.date.substring(0, 7);
      map[month] = (map[month] ?? 0) + Number(r.amount);
    });
    return Object.entries(map)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([month, total]) => ({ month, total }));
  }, [receipts]);

  const topPayees = useMemo(() => {
    const map: Record<string, number> = {};
    receipts.forEach((r) => {
      map[r.payee] = (map[r.payee] ?? 0) + Number(r.amount);
    });
    return Object.entries(map)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [receipts]);

  const totalSpend = receipts.reduce((s, r) => s + Number(r.amount), 0);
  const unreimbursed = receipts
    .filter((r) => !r.is_reimbursed)
    .reduce((s, r) => s + Number(r.amount), 0);
  const uncategorizedCount = receipts.filter((r) => r.category_variable === "uncategorized").length;
  const recurringTotal = receipts
    .filter((r) => r.recurring_type === "ongoing")
    .reduce((s, r) => s + Number(r.amount), 0);
  const oneOffTotal = receipts
    .filter((r) => r.recurring_type === "one_off")
    .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>

      {error && <div className="text-red-600 mb-4">{error}</div>}
      {loading && <div className="text-slate-500">Loading…</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        <Card label="Total receipts" value={receipts.length.toString()} />
        <Card label="Total spend" value={`$${totalSpend.toFixed(2)}`} />
        <Card label="Unreimbursed" value={`$${unreimbursed.toFixed(2)}`} accent />
        <Card label="Uncategorized" value={uncategorizedCount.toString()} amber />
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Recurring spend</div>
          <div className="text-2xl font-bold text-violet-600">${recurringTotal.toFixed(2)}</div>
          <div className="text-xs text-slate-400 mt-1">vs ${oneOffTotal.toFixed(2)} one-off</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-sm font-medium text-slate-700 mb-3">Spend by category</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {byCategory.map((entry) => (
                  <Cell key={entry.name} fill={categoryColor(entry.name)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-sm font-medium text-slate-700 mb-3">Spend by category</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="total"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.name} fill={categoryColor(entry.name)} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="text-sm font-medium text-slate-700 mb-3">Top payees</div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={topPayees} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
            <Bar dataKey="total" fill="#6366f1" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mt-6">
        <div className="font-medium mb-3">Spend by month</div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
            <Line type="monotone" dataKey="total" stroke="#4F46E5" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Card({ label, value, accent, amber }: { label: string; value: string; accent?: boolean; amber?: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent ? "text-indigo-600" : amber ? "text-amber-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

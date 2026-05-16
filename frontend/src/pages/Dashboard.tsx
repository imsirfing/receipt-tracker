import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const [monthsBack, setMonthsBack] = useState(12);
  const navigate = useNavigate();

  useEffect(() => {
    listReceipts()
      .then((data) => setReceipts(data.items))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filteredReceipts = useMemo(() => {
    if (monthsBack >= 9999) return receipts;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsBack);
    return receipts.filter(r => new Date(r.date) >= cutoff);
  }, [receipts, monthsBack]);

  const byCategory = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      name: cat,
      total: filteredReceipts
        .filter((r) => r.category_variable === cat)
        .reduce((s, r) => s + Number(r.amount), 0),
    }));
  }, [filteredReceipts]);

  const pieData = byCategory.filter((d) => d.total > 0);

  const monthlyData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredReceipts.forEach((r) => {
      const month = r.date.substring(0, 7);
      map[month] = (map[month] ?? 0) + Number(r.amount);
    });
    return Object.entries(map)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([month, total]) => ({ month, total }));
  }, [filteredReceipts]);

  const topPayees = useMemo(() => {
    const map: Record<string, number> = {};
    filteredReceipts.forEach((r) => {
      map[r.payee] = (map[r.payee] ?? 0) + Number(r.amount);
    });
    return Object.entries(map)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [filteredReceipts]);

  const totalSpend = filteredReceipts.reduce((s, r) => s + Number(r.amount), 0);
  const unreimbursed = filteredReceipts
    .filter((r) => !r.is_reimbursed)
    .reduce((s, r) => s + Number(r.amount), 0);
  const uncategorizedCount = filteredReceipts.filter((r) => r.category_variable === "uncategorized").length;
  const recurringTotal = filteredReceipts
    .filter((r) => r.recurring_type === "ongoing")
    .reduce((s, r) => s + Number(r.amount), 0);
  const oneOffTotal = filteredReceipts
    .filter((r) => r.recurring_type === "one_off")
    .reduce((s, r) => s + Number(r.amount), 0);

  const avgMonthlySpend = useMemo(() => {
    if (filteredReceipts.length === 0) return 0;
    const months = new Set(filteredReceipts.map(r => r.date.slice(0, 7))).size;
    const total = filteredReceipts.reduce((s, r) => s + Number(r.amount), 0);
    return months > 0 ? total / months : 0;
  }, [filteredReceipts]);

  const unreimbursedByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    filteredReceipts
      .filter(r => !r.is_reimbursed)
      .forEach(r => {
        const cat = r.category_variable || "uncategorized";
        map[cat] = (map[cat] ?? 0) + Number(r.amount);
      });
    return Object.entries(map)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
  }, [filteredReceipts]);

  const recentReceipts = useMemo(() =>
    [...filteredReceipts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6),
    [filteredReceipts]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <select
          value={monthsBack}
          onChange={e => setMonthsBack(Number(e.target.value))}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
          <option value={12}>Last 12 months</option>
          <option value={24}>Last 24 months</option>
          <option value={9999}>All time</option>
        </select>
      </div>

      {error && <div className="text-red-600 mb-4">{error}</div>}
      {loading && <div className="text-slate-500">Loading…</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <Card label="Total receipts" value={filteredReceipts.length.toString()} />
        <Card label="Total spend" value={`$${totalSpend.toFixed(2)}`} />
        <Card label="Unreimbursed" value={`$${unreimbursed.toFixed(2)}`} accent />
        <Card label="Uncategorized" value={uncategorizedCount.toString()} amber />
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Recurring spend</div>
          <div className="text-2xl font-bold text-violet-600">${recurringTotal.toFixed(2)}</div>
          <div className="text-xs text-slate-400 mt-1">vs ${oneOffTotal.toFixed(2)} one-off</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Avg / month</div>
          <div className="text-2xl font-bold text-sky-600">${avgMonthlySpend.toFixed(2)}</div>
          <div className="text-xs text-slate-400 mt-1">across {new Set(filteredReceipts.map(r => r.date.slice(0,7))).size} months</div>
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="text-sm font-medium text-slate-700 mb-3">Unreimbursed by category</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={unreimbursedByCategory} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
            <Bar dataKey="total" radius={[0, 4, 4, 0]}>
              {unreimbursedByCategory.map((entry) => (
                <Cell key={entry.name} fill={categoryColor(entry.name)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mt-6 mb-6">
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="text-sm font-medium text-slate-700 mb-3">Recent receipts</div>
        <div className="space-y-2">
          {recentReceipts.map(r => (
            <div
              key={r.id}
              onClick={() => navigate(`/receipts/${r.id}`)}
              className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <div>
                <div className="text-sm font-medium text-slate-800">{r.payee}</div>
                <div className="text-xs text-slate-400">{r.date} · {r.category_variable || "uncategorized"}</div>
              </div>
              <div className="text-sm font-semibold text-slate-700">${Number(r.amount).toFixed(2)}</div>
            </div>
          ))}
        </div>
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

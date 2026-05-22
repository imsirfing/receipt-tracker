import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Filter } from "lucide-react";
import { toast } from "sonner";
import {
  getUnreimbursedReport,
  downloadUnreimbursedReportPdf,
  UnreimbursedReport,
  ReportReceiptLine,
} from "../api";
import { fmtCurrency } from "../utils";

// ── Colour palette ────────────────────────────────────────────────────────────
const PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
  "#94a3b8", "#e11d48",
];
const catColor = (idx: number) => PALETTE[idx % PALETTE.length];

// ── Filter dimensions ────────────────────────────────────────────────────────
const FILTER_DIMS = [
  { value: "", label: "All unreimbursed" },
  { value: "category", label: "By category" },
  { value: "payee", label: "By payee" },
  { value: "reimbursement_owner", label: "By owner" },
  { value: "payment_category", label: "By payment type" },
];

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-800">{value}</div>
    </div>
  );
}

// ── Custom tooltip for monetary charts ───────────────────────────────────────
function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm">
      <div className="font-medium text-slate-700 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-slate-600">{p.name}:</span>
          <span className="font-semibold text-slate-800">{fmtCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Reports() {
  // Filter state
  const [filterBy, setFilterBy] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");

  // Data state
  const [report, setReport] = useState<UnreimbursedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUnreimbursedReport({
        filter_by: filterBy || undefined,
        filter_value: filterValue || undefined,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      });
      setReport(data);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [filterBy, filterValue, dateStart, dateEnd]);

  // Load on mount and whenever filters change
  useEffect(() => { fetch(); }, [fetch]);

  // Clear filter value when dimension changes
  const handleFilterByChange = (v: string) => {
    setFilterBy(v);
    setFilterValue("");
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadUnreimbursedReportPdf({
        filter_by: filterBy || undefined,
        filter_value: filterValue || undefined,
        date_start: dateStart || undefined,
        date_end: dateEnd || undefined,
      });
    } catch {
      toast.error("PDF export failed — endpoint may not be deployed yet");
    } finally {
      setExporting(false);
    }
  };

  // Chart data derived from report
  const pieData = useMemo(
    () => report?.by_category.map((c, i) => ({ name: c.category, value: c.total, idx: i })) ?? [],
    [report],
  );

  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    (report?.categories ?? []).forEach((c, i) => { m[c] = catColor(i); });
    return m;
  }, [report]);

  const summary = report?.summary;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Unreimbursed Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            All expenses not yet marked as reimbursed
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || !report || report.summary.count === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Download size={15} />
          {exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-600">
          <Filter size={14} /> Filters
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Filter dimension */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Filter by</label>
            <select
              value={filterBy}
              onChange={(e) => handleFilterByChange(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {FILTER_DIMS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Filter value (shown when a dimension is selected) */}
          {filterBy && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Value</label>
              <input
                type="text"
                value={filterValue}
                onChange={(e) => setFilterValue(e.target.value)}
                placeholder={`Enter ${filterBy}…`}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          )}

          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">From</label>
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">To</label>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Clear filters */}
          {(filterBy || dateStart || dateEnd) && (
            <button
              onClick={() => { setFilterBy(""); setFilterValue(""); setDateStart(""); setDateEnd(""); }}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Loading / Error ── */}
      {loading && (
        <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {/* ── Empty state ── */}
      {!loading && !error && report && report.summary.count === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🎉</div>
          <div className="text-slate-700 font-medium">All caught up — no unreimbursed expenses match this filter.</div>
        </div>
      )}

      {/* ── Data ── */}
      {!loading && !error && report && report.summary.count > 0 && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total owed" value={fmtCurrency(summary!.total)} />
            <StatCard label="Receipts" value={String(summary!.count)} />
            <StatCard label="Avg per receipt" value={fmtCurrency(summary!.avg)} />
            <StatCard
              label="Date range"
              value={
                summary!.oldest_date && summary!.newest_date
                  ? summary!.oldest_date === summary!.newest_date
                    ? summary!.oldest_date
                    : `${summary!.oldest_date} → ${summary!.newest_date}`
                  : "—"
              }
            />
          </div>

          {/* Charts row: pie + stacked bar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pie — by category */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">By Category</h2>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, pct }) => `${name} ${pct?.toFixed(1) ?? ""}%`}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={catColor(entry.idx)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Stacked bar — by month × category */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">Monthly Breakdown by Category</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={report.stacked_by_month} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  {report.categories.map((cat, i) => (
                    <Bar key={cat} dataKey={cat} stackId="a" fill={catColor(i)} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Line chart — monthly trend total */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Monthly Spend Trend</h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={report.by_month} margin={{ left: 0, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11 }} />
                <Tooltip content={<MoneyTooltip />} />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#6366f1" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Category bar chart (horizontal) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Amount by Category</h2>
            <ResponsiveContainer width="100%" height={Math.max(120, report.by_category.length * 48)}>
              <BarChart
                data={report.by_category}
                layout="vertical"
                margin={{ left: 60, right: 32 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={60} />
                <Tooltip content={<MoneyTooltip />} />
                <Bar dataKey="total" name="Total" radius={[0, 4, 4, 0]}>
                  {report.by_category.map((_, i) => (
                    <Cell key={i} fill={catColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Receipts table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                Receipts ({report.summary.count})
              </h2>
              <span className="text-xs text-slate-400">Sorted newest first</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-2 font-medium">Date</th>
                    <th className="text-left px-4 py-2 font-medium">Payee</th>
                    <th className="text-left px-4 py-2 font-medium">Category</th>
                    <th className="text-left px-4 py-2 font-medium">Type</th>
                    <th className="text-left px-4 py-2 font-medium">Owner</th>
                    <th className="text-right px-4 py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {report.receipts.map((r: ReportReceiptLine, i) => (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-50 hover:bg-slate-50 ${i % 2 === 0 ? "" : "bg-slate-50/40"}`}
                    >
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[180px] truncate">{r.payee}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                          style={{ background: colorMap[r.category_variable] ?? "#94a3b8" }}
                        >
                          {r.category_variable}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{r.payment_category ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{r.reimbursement_owner ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                        {fmtCurrency(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold text-slate-800">
                    <td colSpan={5} className="px-4 py-3 text-right text-sm">Total</td>
                    <td className="px-4 py-3 text-right text-sm">{fmtCurrency(report.summary.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

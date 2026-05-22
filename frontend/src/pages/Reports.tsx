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
const KNOWN_CATEGORIES = [
  "personal", "realestate", "traverse", "edgehill", "trust", "nopa", "uncategorized",
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
  const [selectedCategory, setSelectedCategory] = useState(""); // category pill
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  // derived for API compat
  const filterBy = selectedCategory ? "category" : "";
  const filterValue = selectedCategory;

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

  // All categories to show as pills: live data first, fall back to known list
  const categoryPills = useMemo(() => {
    if (report?.categories?.length) return report.categories;
    return KNOWN_CATEGORIES;
  }, [report]);

  // Chart data derived from report
  const drillDown = !!selectedCategory; // true = show payment_category breakdown

  const pieData = useMemo(
    () => drillDown
      ? (report?.by_payment_category ?? []).map((c, i) => ({ name: c.category, value: c.total, idx: i }))
      : (report?.by_category ?? []).map((c, i) => ({ name: c.category, value: c.total, idx: i })),
    [report, drillDown],
  );

  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    (report?.categories ?? []).forEach((c, i) => { m[c] = catColor(i); });
    return m;
  }, [report]);

  // Receipts grouped by payment_category for drill-down view
  const receiptsByPayment = useMemo(() => {
    if (!drillDown || !report) return null;
    const groups: Record<string, typeof report.receipts> = {};
    for (const r of report.receipts) {
      const key = r.payment_category ?? "Unassigned";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    // Sort groups by total desc (matching by_payment_category order)
    const order = report.payment_categories;
    return Object.entries(groups).sort(
      ([a], [b]) => order.indexOf(a) - order.indexOf(b)
    );
  }, [drillDown, report]);

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
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <Filter size={14} /> Filters
        </div>

        {/* Category pills — always visible */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500 mr-1">Category</span>
          <button
            onClick={() => setSelectedCategory("")}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              selectedCategory === ""
                ? "bg-slate-800 text-white border-slate-800"
                : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
            }`}
          >
            All
          </button>
          {categoryPills.map((cat, i) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? "" : cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedCategory === cat
                  ? "text-white border-transparent"
                  : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
              }`}
              style={selectedCategory === cat ? { background: catColor(i), borderColor: catColor(i) } : {}}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex flex-wrap gap-3 items-end">
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
          {(selectedCategory || dateStart || dateEnd) && (
            <button
              onClick={() => { setSelectedCategory(""); setDateStart(""); setDateEnd(""); }}
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

          {/* Drill-down context banner */}
          {drillDown && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Viewing</span>
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ background: catColor(categoryPills.indexOf(selectedCategory)) }}
              >
                {selectedCategory}
              </span>
              <span className="text-slate-400">— broken down by payment type</span>
            </div>
          )}

          {/* Charts row: pie + stacked bar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pie */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">
                {drillDown ? "By Payment Type" : "By Category"}
              </h2>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }: any) => percent > 0.03 ? `${name} ${(percent * 100).toFixed(1)}%` : ""}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={catColor(entry.idx)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Stacked bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">
                {drillDown ? "Monthly Breakdown by Payment Type" : "Monthly Breakdown by Category"}
              </h2>
              <ResponsiveContainer width="100%" height={240}>
                {drillDown ? (
                  <BarChart data={report.stacked_by_month_payment} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                    <Tooltip content={<MoneyTooltip />} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    {report.payment_categories.map((pcat, i) => (
                      <Bar key={pcat} dataKey={pcat} stackId="a" fill={catColor(i)} />
                    ))}
                  </BarChart>
                ) : (
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
                )}
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

          {/* Horizontal bar — breakdown */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">
              {drillDown ? "Amount by Payment Type" : "Amount by Category"}
            </h2>
            {(() => {
              const barData = drillDown ? report.by_payment_category : report.by_category;
              return (
                <ResponsiveContainer width="100%" height={Math.max(120, barData.length * 48)}>
                  <BarChart data={barData} layout="vertical" margin={{ left: 80, right: 32 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={80} />
                    <Tooltip content={<MoneyTooltip />} />
                    <Bar dataKey="total" name="Total" radius={[0, 4, 4, 0]}>
                      {barData.map((_, i) => <Cell key={i} fill={catColor(i)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Receipts table — grouped by payment_category when drilled in */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                Receipts ({report.summary.count})
              </h2>
              <span className="text-xs text-slate-400">
                {drillDown ? "Grouped by payment type" : "Sorted newest first"}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-4 py-2 font-medium">Date</th>
                    <th className="text-left px-4 py-2 font-medium">Payee</th>
                    {!drillDown && <th className="text-left px-4 py-2 font-medium">Category</th>}
                    <th className="text-left px-4 py-2 font-medium">Payment type</th>
                    <th className="text-left px-4 py-2 font-medium">Owner</th>
                    <th className="text-right px-4 py-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {drillDown && receiptsByPayment
                    ? receiptsByPayment.flatMap(([pcat, rows], gi) => [
                        // Group header row
                        <tr key={`hdr-${pcat}`} className="bg-slate-50 border-b border-slate-200">
                          <td colSpan={5} className="px-4 py-2">
                            <span
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold text-white"
                              style={{ background: catColor(gi) }}
                            >
                              {pcat}
                            </span>
                            <span className="ml-2 text-xs text-slate-400">
                              {rows.length} receipt{rows.length !== 1 ? "s" : ""}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-xs font-semibold text-slate-700">
                            {fmtCurrency(rows.reduce((s, r) => s + r.amount, 0))}
                          </td>
                        </tr>,
                        // Receipt rows
                        ...rows.map((r: ReportReceiptLine, i: number) => (
                          <tr key={r.id} className={`border-b border-slate-50 hover:bg-slate-50 ${i % 2 === 0 ? "" : "bg-slate-50/40"}`}>
                            <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                            <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[200px] truncate">{r.payee}</td>
                            <td className="px-4 py-2.5 text-slate-500 text-xs">{r.payment_category ?? "—"}</td>
                            <td className="px-4 py-2.5 text-slate-500 text-xs">{r.reimbursement_owner ?? "—"}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">{fmtCurrency(r.amount)}</td>
                          </tr>
                        )),
                      ])
                    : report.receipts.map((r: ReportReceiptLine, i: number) => (
                        <tr key={r.id} className={`border-b border-slate-50 hover:bg-slate-50 ${i % 2 === 0 ? "" : "bg-slate-50/40"}`}>
                          <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800 max-w-[180px] truncate">{r.payee}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                              style={{ background: colorMap[r.category_variable] ?? "#94a3b8" }}>
                              {r.category_variable}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{r.payment_category ?? "—"}</td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{r.reimbursement_owner ?? "—"}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">{fmtCurrency(r.amount)}</td>
                        </tr>
                      ))
                  }
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold text-slate-800">
                    <td colSpan={drillDown ? 4 : 5} className="px-4 py-3 text-right text-sm">Total</td>
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

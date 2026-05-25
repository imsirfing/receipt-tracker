import { useEffect, useState } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Zap, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  listPayeeAliases,
  createPayeeAlias,
  deletePayeeAlias,
  togglePayeeAlias,
  previewNormalize,
  normalizeAll,
  listBuiltinRules,
  PayeeAlias,
  BuiltinRule,
} from "../api";

export default function PayeeNormalizerPage() {
  const [aliases, setAliases] = useState<PayeeAlias[]>([]);
  const [builtins, setBuiltins] = useState<BuiltinRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuiltins, setShowBuiltins] = useState(false);
  const [normalizing, setNormalizing] = useState(false);

  const [pattern, setPattern] = useState("");
  const [canonical, setCanonical] = useState("");
  const [priority, setPriority] = useState(5);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  const [previewInput, setPreviewInput] = useState("");
  const [previewResult, setPreviewResult] = useState<{ raw: string; canonical: string | null; matched: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = async () => {
    try {
      const [a, b] = await Promise.all([listPayeeAliases(), listBuiltinRules()]);
      setAliases(a);
      setBuiltins(b);
    } catch {
      toast.error("Failed to load normalization rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim() || !canonical.trim()) return;
    setAdding(true);
    try {
      const alias = await createPayeeAlias({ pattern: pattern.trim(), canonical: canonical.trim(), priority, note: note.trim() || undefined });
      setAliases((prev) => [...prev, alias]);
      setPattern(""); setCanonical(""); setPriority(5); setNote("");
      toast.success("Rule added");
    } catch {
      toast.error("Failed to add rule");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePayeeAlias(id);
      setAliases((prev) => prev.filter((a) => a.id !== id));
      toast.success("Rule removed");
    } catch {
      toast.error("Failed to delete rule");
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const updated = await togglePayeeAlias(id, !enabled);
      setAliases((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch {
      toast.error("Failed to toggle rule");
    }
  };

  const handlePreview = async () => {
    if (!previewInput.trim()) return;
    setPreviewing(true);
    try {
      const result = await previewNormalize(previewInput.trim());
      setPreviewResult(result);
    } catch {
      toast.error("Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const handleNormalizeAll = async () => {
    setNormalizing(true);
    try {
      const result = await normalizeAll();
      toast.success(`Normalized ${result.updated} receipt${result.updated !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Normalization failed");
    } finally {
      setNormalizing(false);
    }
  };

  if (loading) return <div className="text-slate-400 text-sm p-8">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Payee Normalization</h1>
        <p className="text-slate-500 text-sm mt-1">Clean up vendor name variants — e.g. "AMZN MKTP US*123" → "Amazon"</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-slate-800">Apply to all receipts</div>
          <div className="text-sm text-slate-500 mt-0.5">Re-runs all rules and updates canonical payee names</div>
        </div>
        <button onClick={handleNormalizeAll} disabled={normalizing} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors shrink-0">
          <Zap size={14} />
          {normalizing ? "Running…" : "Run now"}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className="font-medium text-slate-800 flex items-center gap-2"><Eye size={16} className="text-slate-400" />Preview normalization</div>
        <div className="flex gap-2">
          <input value={previewInput} onChange={(e) => setPreviewInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handlePreview()} placeholder="e.g. AMZN MKTP US*1A2B3C" className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
          <button onClick={handlePreview} disabled={previewing || !previewInput.trim()} className="px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {previewing ? "…" : "Test"}
          </button>
        </div>
        {previewResult && (
          <div className={`rounded-lg px-4 py-3 text-sm ${previewResult.matched ? "bg-green-50 text-green-800" : "bg-slate-50 text-slate-600"}`}>
            {previewResult.matched ? <span>"{previewResult.raw}" → <strong>{previewResult.canonical}</strong></span> : <span>"{previewResult.raw}" — no rule matched</span>}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-medium text-slate-800">Custom rules</div>
          <div className="text-xs text-slate-400">{aliases.length} rule{aliases.length !== 1 ? "s" : ""} · priority &lt; 10 overrides built-ins</div>
        </div>
        <form onSubmit={handleAdd} className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-40">
            <label className="block text-xs text-slate-500 mb-1">Regex pattern</label>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. AMZN|AMAZON" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
          </div>
          <div className="flex-1 min-w-32">
            <label className="block text-xs text-slate-500 mb-1">Canonical name</label>
            <input value={canonical} onChange={(e) => setCanonical(e.target.value)} placeholder="e.g. Amazon" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
          </div>
          <div className="w-20">
            <label className="block text-xs text-slate-500 mb-1">Priority</label>
            <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} min={1} max={99} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
          </div>
          <button type="submit" disabled={adding || !pattern.trim() || !canonical.trim()} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            <Plus size={14} />Add
          </button>
        </form>
        {aliases.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">No custom rules yet</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {aliases.map((a) => (
              <li key={a.id} className={`flex items-center gap-3 px-5 py-3 ${!a.enabled ? "opacity-50" : ""}`}>
                <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono shrink-0">p{a.priority}</span>
                <code className="text-xs text-slate-600 flex-1 truncate">{a.pattern}</code>
                <span className="text-sm text-slate-800 font-medium shrink-0">→ {a.canonical}</span>
                <button onClick={() => handleToggle(a.id, a.enabled)} className="text-slate-400 hover:text-indigo-600 shrink-0">
                  {a.enabled ? <ToggleRight size={18} className="text-indigo-500" /> : <ToggleLeft size={18} />}
                </button>
                <button onClick={() => handleDelete(a.id)} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors" onClick={() => setShowBuiltins((v) => !v)}>
          <div className="font-medium text-slate-800">Built-in rules <span className="text-slate-400 font-normal">({builtins.length})</span></div>
          {showBuiltins ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {showBuiltins && (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {builtins.map((b, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-2.5">
                <code className="text-xs text-slate-500 flex-1 truncate">{b.pattern}</code>
                <span className="text-sm text-slate-700 shrink-0">→ {b.canonical}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

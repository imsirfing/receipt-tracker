import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AccessGrant, grantAccess, listAccess, revokeAccess } from "../api";
import { useUser } from "../user-context";

const CATEGORIES = ["all", "personal", "realestate", "traverse", "edgehill", "trust", "nopa", "uncategorized"];
const ROLES = ["read", "write"] as const;

function PillPicker<T extends string>({
  options,
  value,
  onChange,
  colorFn,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  colorFn?: (v: T, selected: boolean) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const selected = opt === value;
        const cls = colorFn
          ? colorFn(opt, selected)
          : selected
          ? "bg-indigo-600 text-white border-indigo-600"
          : "bg-white text-slate-600 border-slate-300 hover:border-indigo-400";
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${cls}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function roleColor(v: string, selected: boolean) {
  if (v === "write")
    return selected
      ? "bg-amber-500 text-white border-amber-500"
      : "bg-white text-slate-600 border-slate-300 hover:border-amber-400";
  return selected
    ? "bg-indigo-600 text-white border-indigo-600"
    : "bg-white text-slate-600 border-slate-300 hover:border-indigo-400";
}

export default function AccessManager() {
  const navigate = useNavigate();
  const { isOwner, loading: userLoading } = useUser();

  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [loading, setLoading] = useState(true);

  // New grant form
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<string>("edgehill");
  const [role, setRole] = useState<string>("read");
  const [saving, setSaving] = useState(false);

  // Inline edit state: maps grant id → { role }
  const [editing, setEditing] = useState<Record<string, { role: string }>>({});
  const [editSaving, setEditSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!userLoading && !isOwner) navigate("/");
  }, [isOwner, userLoading, navigate]);

  useEffect(() => {
    if (!isOwner) return;
    listAccess()
      .then(setGrants)
      .catch(() => toast.error("Failed to load access grants"))
      .finally(() => setLoading(false));
  }, [isOwner]);

  function startEdit(g: AccessGrant) {
    setEditing((prev) => ({ ...prev, [g.id]: { role: g.role } }));
  }

  function cancelEdit(id: string) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function saveEdit(g: AccessGrant) {
    const patch = editing[g.id];
    if (!patch) return;
    setEditSaving(g.id);
    try {
      // To change role for a specific grant: revoke + re-add
      await revokeAccess(g.id);
      const updated = await grantAccess(g.email, g.category, patch.role);
      setGrants((prev) => prev.map((x) => (x.id === g.id ? updated : x)));
      cancelEdit(g.id);
      toast.success(`Updated access for ${g.email}`);
    } catch {
      toast.error("Failed to update access");
    } finally {
      setEditSaving(null);
    }
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    try {
      const grant = await grantAccess(email.trim(), category, role);
      // Insert new grant (or return existing row if email+category already exists)
      setGrants((prev) => {
        const idx = prev.findIndex((g) => g.id === grant.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = grant;
          return next;
        }
        return [...prev, grant];
      });
      setEmail("");
      toast.success(`Access granted to ${grant.email}`);
    } catch {
      toast.error("Failed to grant access");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(id: string, email: string) {
    if (!confirm(`Revoke access for ${email}?`)) return;
    try {
      await revokeAccess(id);
      setGrants((prev) => prev.filter((g) => g.id !== id));
      cancelEdit(id);
      toast.success(`Access revoked for ${email}`);
    } catch {
      toast.error("Failed to revoke access");
    }
  }

  if (userLoading || loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-slate-800">Access Management</h1>

      {/* Current grants */}
      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Current grants</h2>
        {grants.length === 0 ? (
          <p className="text-slate-400 text-sm">No access grants yet.</p>
        ) : (
          <div className="space-y-4">
            {/* Group grants by email */}
            {Array.from(new Set(grants.map((g) => g.email))).map((emailAddr) => {
              const emailGrants = grants.filter((g) => g.email === emailAddr);
              return (
                <div key={emailAddr} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <div className="font-medium text-slate-800 text-sm mb-3">{emailAddr}</div>
                  <div className="space-y-2">
                    {emailGrants.map((g) => {
                      const isEditing = !!editing[g.id];
                      const patch = editing[g.id] ?? { role: g.role };
                      return (
                        <div key={g.id} className="border border-slate-100 rounded-lg p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex gap-2 items-center">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs font-medium">{g.category}</span>
                              {!isEditing && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${g.role === "write" ? "bg-amber-100 text-amber-700" : "bg-indigo-50 text-indigo-600"}`}>{g.role}</span>
                              )}
                            </div>
                            <div className="flex gap-2 shrink-0">
                              {!isEditing ? (
                                <button onClick={() => startEdit(g)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Edit</button>
                              ) : (
                                <button onClick={() => cancelEdit(g.id)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                              )}
                              <button onClick={() => handleRevoke(g.id, g.email)} className="text-xs text-red-500 hover:text-red-700 font-medium">Revoke</button>
                            </div>
                          </div>
                          {isEditing && (
                            <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                              <div className="text-xs text-slate-400">To change category, revoke and re-add.</div>
                              <div>
                                <div className="text-xs text-slate-400 mb-1.5">Role</div>
                                <PillPicker
                                  options={ROLES}
                                  value={patch.role}
                                  onChange={(v) => setEditing((prev) => ({ ...prev, [g.id]: { ...prev[g.id], role: v } }))}
                                  colorFn={roleColor}
                                />
                              </div>
                              <button
                                onClick={() => saveEdit(g)}
                                disabled={editSaving === g.id}
                                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                              >
                                {editSaving === g.id ? "Saving…" : "Save changes"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add new grant */}
      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Grant access</h2>
        <form onSubmit={handleGrant} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 block">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1.5 block">Category</label>
            <PillPicker options={CATEGORIES} value={category} onChange={setCategory} />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1.5 block">Role</label>
            <PillPicker options={ROLES} value={role} onChange={setRole} colorFn={roleColor} />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg"
          >
            {saving ? "Saving…" : "Add access"}
          </button>
        </form>
      </section>
    </div>
  );
}

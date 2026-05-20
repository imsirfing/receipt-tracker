import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AccessGrant, grantAccess, listAccess, revokeAccess } from "../api";
import { useUser } from "../user-context";

const KNOWN_CATEGORIES = [
  "all",
  "personal",
  "realestate",
  "traverse",
  "edgehill",
  "trust",
  "nopa",
  "uncategorized",
];

export default function AccessManager() {
  const navigate = useNavigate();
  const { isOwner, loading: userLoading } = useUser();

  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("edgehill");
  const [role, setRole] = useState("read");
  const [saving, setSaving] = useState(false);

  // Redirect non-owners
  useEffect(() => {
    if (!userLoading && !isOwner) {
      navigate("/");
    }
  }, [isOwner, userLoading, navigate]);

  // Load grants
  useEffect(() => {
    if (!isOwner) return;
    listAccess()
      .then(setGrants)
      .catch(() => toast.error("Failed to load access grants"))
      .finally(() => setLoading(false));
  }, [isOwner]);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    try {
      const grant = await grantAccess(email.trim(), category, role);
      setGrants((prev) => {
        const existing = prev.findIndex((g) => g.email === grant.email);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = grant;
          return updated;
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
      toast.success(`Access revoked for ${email}`);
    } catch {
      toast.error("Failed to revoke access");
    }
  }

  if (userLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Access Management</h1>

      {/* Current grants table */}
      <section>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Current Grants</h2>
        {grants.length === 0 ? (
          <p className="text-slate-500 text-sm">No access grants yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-700">
            <table className="w-full text-sm text-slate-300">
              <thead className="bg-slate-800 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id} className="border-t border-slate-700 hover:bg-slate-800/50">
                    <td className="px-4 py-2">{g.email}</td>
                    <td className="px-4 py-2">{g.category}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          g.role === "write"
                            ? "bg-amber-900/40 text-amber-300"
                            : "bg-slate-700 text-slate-300"
                        }`}
                      >
                        {g.role}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleRevoke(g.id, g.email)}
                        className="text-red-400 hover:text-red-300 text-xs font-medium"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Grant form */}
      <section>
        <h2 className="text-lg font-semibold text-slate-300 mb-3">Grant Access</h2>
        <form onSubmit={handleGrant} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 w-64 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {KNOWN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="read">read</option>
              <option value="write">write</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded"
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </form>
      </section>
    </div>
  );
}

"use client";

/**
 * Roles panel (Settings → Users & Roles; Navigation Restructure):
 * the core.user_roles table — email, role, scope — from the
 * admin-only GET /api/platform/settings/users. Changing a role
 * select writes through POST to the same route (setUserRole
 * server-side; demoting the last admin is refused and surfaced).
 */

import { useCallback, useEffect, useState } from "react";

interface UserRoleRow {
  email: string;
  role: "admin" | "internal" | "guest";
  scope: Record<string, unknown>;
  updatedAt: string | null;
}

const ROLES: UserRoleRow["role"][] = ["admin", "internal", "guest"];

function scopeLabel(scope: Record<string, unknown>): string {
  const keys = Object.keys(scope ?? {});
  if (keys.length === 0) return "—";
  try {
    const text = JSON.stringify(scope);
    return text.length > 80 ? text.slice(0, 80) + "…" : text;
  } catch {
    return keys.join(", ");
  }
}

export default function RolesPanel() {
  const [users, setUsers] = useState<UserRoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingEmail, setSavingEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/platform/settings/users");
      if (res.status === 403) {
        setError("Admins only — your role cannot manage user roles.");
        setUsers([]);
        return;
      }
      if (!res.ok) {
        setError("Could not load user roles.");
        return;
      }
      const data = (await res.json()) as { users?: UserRoleRow[] };
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch {
      setError("Could not load user roles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (email: string, role: UserRoleRow["role"]) => {
    setSavingEmail(email);
    setError("");
    try {
      const res = await fetch("/api/platform/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        users?: UserRoleRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not save the role change.");
        void load();
        return;
      }
      if (Array.isArray(data.users)) setUsers(data.users);
    } catch {
      setError("Could not save the role change.");
    } finally {
      setSavingEmail("");
    }
  };

  const removeUser = async (email: string) => {
    if (
      !window.confirm(
        `Remove ${email}? Their stored role is deleted and they fall back to the domain default (internal for @cannycapitalpartners.com).`
      )
    ) {
      return;
    }
    setSavingEmail(email);
    setError("");
    try {
      const res = await fetch("/api/platform/settings/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        users?: UserRoleRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not remove the user.");
        void load();
        return;
      }
      if (Array.isArray(data.users)) setUsers(data.users);
    } catch {
      setError("Could not remove the user.");
    } finally {
      setSavingEmail("");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="skel h-10" />
        <div className="skel h-10" />
        <span className="sr-only">Loading user roles…</span>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}
      {users.length === 0 && !error ? (
        <p className="text-sm text-slate-500 dark:text-white/50">
          No stored user roles yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-white/10 dark:text-white/40">
                <th scope="col" className="py-2 pr-3 font-semibold">Email</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Role</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Scope</th>
                <th scope="col" className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {users.map((u) => (
                <tr key={u.email}>
                  <td className="py-2.5 pr-3 font-medium text-[#0d1f3c] dark:text-white">
                    {u.email}
                  </td>
                  <td className="py-2.5 pr-3">
                    <select
                      value={u.role}
                      disabled={savingEmail === u.email}
                      onChange={(e) =>
                        void changeRole(
                          u.email,
                          e.target.value as UserRoleRow["role"]
                        )
                      }
                      aria-label={`Role for ${u.email}`}
                      className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 focus:border-[#b8975a] focus:outline-none disabled:opacity-50 dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="max-w-[280px] truncate py-2.5 pr-3 text-xs text-slate-500 dark:text-white/50" title={scopeLabel(u.scope)}>
                    {scopeLabel(u.scope)}
                  </td>
                  <td className="py-2.5">
                    <button
                      type="button"
                      disabled={savingEmail === u.email}
                      onClick={() => void removeUser(u.email)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-700 disabled:opacity-50 dark:border-white/15 dark:text-white/70 dark:hover:border-red-500/40 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
        Roles come from core.user_roles. The last remaining admin cannot
        be demoted or removed — promote someone else first. Removing a
        user deletes their stored role; they fall back to the domain
        default rather than being locked out.
      </p>
    </div>
  );
}

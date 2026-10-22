"use client";

/**
 * Management Users (Phase 9, Settings) — portfolio-company management
 * logins managed against /api/portmgmt/users: list, create (email /
 * name / company multi-select from the monitoring companies list /
 * password), disable/enable, reset password, edit company scope.
 * These are the role-'guest' accounts that land on /my-company.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, SkeletonRows } from "@/components/ui";
import { ErrorBanner } from "@/components/monitoring/shared";
import {
  api as monApi,
  inputCls,
  labelCls,
  listFrom,
  type Rec,
} from "@/components/monitoring/types";
import { PM, api, pick, rowsFrom, str } from "@/components/portmgmt/pm";

interface CompanyOption {
  id: string;
  name: string;
}

function userCompanies(u: Rec): string[] {
  const ids = pick(u, "companyIds", "companies");
  if (Array.isArray(ids)) {
    return ids.map((x) =>
      typeof x === "object" && x !== null ? str(pick(x as Rec, "id", "companyId")) : String(x)
    ).filter(Boolean);
  }
  return [];
}

function isDisabled(u: Rec): boolean {
  if (pick(u, "disabled") === true) return true;
  const s = str(pick(u, "status")).toLowerCase();
  return s === "disabled" || s === "inactive" || pick(u, "active") === false;
}

export default function ManagementUsers() {
  const [users, setUsers] = useState<Rec[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyEmail, setBusyEmail] = useState("");

  const [form, setForm] = useState({ email: "", name: "", password: "", companyIds: [] as string[] });
  const [creating, setCreating] = useState(false);
  const [editingEmail, setEditingEmail] = useState("");
  const [editCompanyIds, setEditCompanyIds] = useState<string[]>([]);
  const [resetFor, setResetFor] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [u, c] = await Promise.all([
        api<Rec>(`${PM}/users`),
        monApi<Rec>(`/api/platform/monitoring/companies`).catch(() => ({}) as Rec),
      ]);
      setUsers(rowsFrom(u, "users", "items"));
      setCompanies(
        listFrom(c, "items", "companies").map((r) => {
          const baseline = (pick(r, "baselineCompany") ?? {}) as Rec;
          return {
            id: str(pick(r, "companyId", "id")),
            name:
              str(pick(baseline, "name", "companyName")) ||
              str(pick(r, "companyName", "name")) ||
              str(pick(r, "companyId", "id")),
          };
        }).filter((x) => x.id)
      );
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const create = async () => {
    if (!form.email.trim() || !form.password || creating) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      await api(`${PM}/users`, {
        method: "POST",
        body: JSON.stringify({
          email: form.email.trim(),
          name: form.name.trim() || undefined,
          password: form.password,
          companyIds: form.companyIds,
          role: "guest",
        }),
      });
      setForm({ email: "", name: "", password: "", companyIds: [] });
      setNotice(`Management user ${form.email.trim()} created.`);
      await load();
    } catch {
      setError("Could not create that user. The email may already exist.");
    } finally {
      setCreating(false);
    }
  };

  const toggleDisabled = async (u: Rec) => {
    const email = str(pick(u, "email"));
    if (!email) return;
    setBusyEmail(email);
    setError("");
    try {
      await api(`${PM}/users/${encodeURIComponent(email)}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: !isDisabled(u), active: isDisabled(u) }),
      });
      await load();
    } catch {
      setError("Could not update that user.");
    } finally {
      setBusyEmail("");
    }
  };

  const saveScope = async (email: string) => {
    setBusyEmail(email);
    setError("");
    try {
      await api(`${PM}/users/${encodeURIComponent(email)}`, {
        method: "PATCH",
        body: JSON.stringify({ companyIds: editCompanyIds }),
      });
      setEditingEmail("");
      setNotice(`Company scope updated for ${email}.`);
      await load();
    } catch {
      setError("Could not update that user's company scope.");
    } finally {
      setBusyEmail("");
    }
  };

  const doReset = async (email: string) => {
    if (!resetPassword) return;
    setBusyEmail(email);
    setError("");
    try {
      await api(`${PM}/users/${encodeURIComponent(email)}/password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetFor("");
      setResetPassword("");
      setNotice(`Password reset for ${email}.`);
    } catch {
      setError("Could not reset that password.");
    } finally {
      setBusyEmail("");
    }
  };

  const remove = async (u: Rec) => {
    const email = str(pick(u, "email"));
    if (!email || !window.confirm(`Delete the management user ${email}?`)) return;
    setBusyEmail(email);
    setError("");
    try {
      await api(`${PM}/users/${encodeURIComponent(email)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Could not delete that user.");
    } finally {
      setBusyEmail("");
    }
  };

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  const companyPicker = (
    selected: string[],
    onToggle: (id: string) => void,
    idPrefix: string
  ) => (
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
      {companies.length === 0 && (
        <span className="text-xs text-slate-400 dark:text-white/40">No monitoring companies available.</span>
      )}
      {companies.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={`${idPrefix}-${c.id}`}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(c.id)}
            className={`chip min-h-[44px] ${on ? "chip-active" : ""}`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );

  if (loading) return <SkeletonRows rows={4} />;
  if (loadFailed) {
    return (
      <div>
        <ErrorBanner message="Management users could not be loaded." />
        <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <ErrorBanner message={error} />
      {notice && (
        <p role="status" className="mb-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {users.length === 0 ? (
        <EmptyState
          title="No management users yet"
          message="Create the first portfolio-company login below — they sign in and land on their scoped /my-company portal."
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {users.map((u, i) => {
            const email = str(pick(u, "email"));
            const disabled = isDisabled(u);
            const scoped = userCompanies(u);
            return (
              <li key={email || String(i)} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {str(pick(u, "name")) || email}
                    </p>
                    <p className="truncate text-xs text-slate-400 dark:text-white/40">{email}</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {scoped.length === 0 ? (
                        <span className="badge badge-warn">no companies</span>
                      ) : (
                        scoped.map((id) => (
                          <span key={id} className="badge badge-neutral">{companyName(id)}</span>
                        ))
                      )}
                      {disabled && <span className="badge badge-danger">disabled</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-[44px]"
                      onClick={() => {
                        setEditingEmail(editingEmail === email ? "" : email);
                        setEditCompanyIds(scoped);
                      }}
                    >
                      Edit scope
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-[44px]"
                      onClick={() => setResetFor(resetFor === email ? "" : email)}
                    >
                      Reset password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-[44px]"
                      loading={busyEmail === email}
                      onClick={() => void toggleDisabled(u)}
                    >
                      {disabled ? "Enable" : "Disable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="min-h-[44px]"
                      disabled={busyEmail === email}
                      onClick={() => void remove(u)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {editingEmail === email && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <p className={labelCls}>Company scope</p>
                    {companyPicker(editCompanyIds, (id) => setEditCompanyIds((s) => toggleIn(s, id)), `edit-${email}`)}
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" className="min-h-[44px]" loading={busyEmail === email} onClick={() => void saveScope(email)}>
                        Save scope
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setEditingEmail("")}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {resetFor === email && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
                    <div className="min-w-[220px] flex-1">
                      <label className={labelCls} htmlFor={`reset-${email}`}>New password</label>
                      <input
                        id={`reset-${email}`}
                        type="password"
                        className={`${inputCls} min-h-[44px]`}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                    <Button size="sm" className="min-h-[44px]" loading={busyEmail === email} disabled={!resetPassword} onClick={() => void doReset(email)}>
                      Set password
                    </Button>
                    <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setResetFor("")}>
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
        <h3 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">New management user</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="mu-email">Email</label>
            <input id="mu-email" type="email" className={`${inputCls} min-h-[44px]`} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} autoComplete="off" />
          </div>
          <div>
            <label className={labelCls} htmlFor="mu-name">Name</label>
            <input id="mu-name" className={`${inputCls} min-h-[44px]`} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls} htmlFor="mu-password">Password</label>
            <input id="mu-password" type="password" className={`${inputCls} min-h-[44px]`} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
          </div>
          <div>
            <label className={labelCls}>Companies</label>
            {companyPicker(form.companyIds, (id) => setForm((f) => ({ ...f, companyIds: toggleIn(f.companyIds, id) })), "new")}
          </div>
        </div>
        <div className="mt-3">
          <Button
            className="min-h-[44px]"
            loading={creating}
            disabled={!form.email.trim() || !form.password}
            onClick={() => void create()}
          >
            Create user
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
          Management users sign in with email + password and land on /my-company, scoped to the companies selected here.
        </p>
      </div>
    </div>
  );
}

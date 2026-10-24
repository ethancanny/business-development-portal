"use client";

/**
 * Codename editor (Deal Identity, Oct 24, 2026) — edits the deal's
 * codename + the per-deal external-rule toggle via
 * PATCH /api/platform/identity/codename.
 *
 * Rule recap: INTERNAL surfaces always show the real name with the
 * codename beside it. EXTERNAL surfaces (guest data rooms, shared
 * links, generated reports, invites to others) show the codename
 * ONLY and hide the logo — unless the toggle is off, which is
 * Ethan's per-deal override back to the real name.
 */

import { useState } from "react";

export default function CodenameEditor({
  dealId,
  codename,
  codenameExternal,
  onSaved,
}: {
  dealId: string;
  codename?: string;
  codenameExternal?: boolean;
  onSaved?: (codename: string, codenameExternal: boolean) => void;
}) {
  const [value, setValue] = useState(codename ?? "");
  const [external, setExternal] = useState(codenameExternal !== false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const dirty =
    value.trim() !== (codename ?? "").trim() ||
    external !== (codenameExternal !== false);

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/platform/identity/codename", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          codename: value.trim(),
          codenameExternal: external,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        codename?: string;
        codenameExternal?: boolean;
      };
      if (!res.ok || !data.ok) {
        setMsg(data.error || "Could not save the codename.");
        return;
      }
      setMsg("Saved.");
      onSaved?.(data.codename ?? "", data.codenameExternal !== false);
    } catch {
      setMsg("Could not save the codename.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card p-4">
      <h3 className="text-sm font-bold text-[#0d1f3c] dark:text-white">
        Codename
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-caption">
        Optional. Inside the portal the real name always shows, with the
        codename beside it. Outside the portal — guest data rooms,
        shared links, generated reports — the codename replaces the
        name and the logo is hidden, unless you turn that off for this
        deal.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='e.g. "Project Falcon"'
          aria-label="Deal codename"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/[0.04] dark:text-white sm:max-w-xs"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
          <input
            type="checkbox"
            checked={external}
            onChange={(e) => setExternal(e.target.checked)}
            className="h-4 w-4 accent-[#b8975a]"
          />
          Use codename outside the portal
        </label>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="btn-gold px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && (
        <p className="mt-2 text-xs text-caption" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

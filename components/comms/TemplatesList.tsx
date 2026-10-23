"use client";

/**
 * TemplatesList — the Communications home Templates tab: cards by
 * purpose/audience with the routine badge, Edit → template editor
 * page, and a minimal New template create (name/purpose/audience)
 * that lands in the editor for the full setup.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  AUDIENCES,
  COMMS_API,
  PURPOSES,
  api,
  bool,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  pick,
  selectCls,
  templateBlocks,
  templateSubjectKinds,
  type CommsTemplate,
  type Rec,
} from "@/components/comms/types";

export default function TemplatesList() {
  const router = useRouter();
  const [templates, setTemplates] = useState<CommsTemplate[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("investor_update");
  const [audience, setAudience] = useState("investor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await api<Record<string, unknown>>(`${COMMS_API}/templates`);
      setTemplates(listFrom<CommsTemplate>(data, "items", "templates"));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<Record<string, unknown>>(`${COMMS_API}/templates`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          purpose,
          audience,
          subjectKinds: ["company"],
          blocks: [],
          disclaimers: [],
          routine: false,
        }),
      });
      const t = (data.template ?? data) as Rec;
      const id = typeof t.id === "string" ? t.id : "";
      if (id) {
        router.push(`/communications/templates/${encodeURIComponent(id)}`);
      } else {
        setShowNew(false);
        void load();
      }
    } catch {
      setError("Could not create the template. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: CommsTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api(`${COMMS_API}/templates/${encodeURIComponent(t.id)}`, {
        method: "DELETE",
      });
      void load();
    } catch {
      window.alert("Could not delete the template.");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-white/50">
          Templates define the blocks, audience, and disclaimers every
          report is assembled from.
        </p>
        <Button variant="primary" size="sm" className="min-h-[44px] shrink-0" onClick={() => setShowNew(true)}>
          New template
        </Button>
      </div>

      <div className="mt-4">
        {phase === "loading" && <SkeletonRows rows={4} />}
        {phase === "error" && <ErrorState onRetry={() => void load()} />}
        {phase === "ready" && templates.length === 0 && (
          <EmptyState
            title="No templates yet"
            message="Create the first report template to get started."
            actionLabel="New template"
            onAction={() => setShowNew(true)}
          />
        )}
        {phase === "ready" && templates.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => {
              const routine = bool(pick(t as Rec, "routine"));
              const isSystem = bool(pick(t as Rec, "isSystem", "is_system"));
              const kinds = templateSubjectKinds(t);
              return (
                <div key={t.id} className="card-surface flex flex-col p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-display text-lg font-semibold text-navy-900 dark:text-white">
                      {t.name}
                    </h3>
                    <span className="flex flex-wrap gap-1.5">
                      {routine && <span className="badge badge-fit">Routine</span>}
                      {isSystem && <span className="badge badge-neutral">System</span>}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
                    {labelOf(PURPOSES, t.purpose)} · {labelOf(AUDIENCES, t.audience)}
                  </p>
                  <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
                    {templateBlocks(t).length} block{templateBlocks(t).length === 1 ? "" : "s"}
                    {kinds.length > 0 ? ` · ${kinds.map((k) => labelOf(
                      [
                        { key: "company", label: "Company" },
                        { key: "deal", label: "Deal" },
                        { key: "investor", label: "Investor" },
                        { key: "portfolio_company", label: "Portfolio company" },
                      ],
                      k
                    )).join(", ")}` : ""}
                  </p>
                  <div className="mt-4 flex gap-2 pt-1 mt-auto">
                    <Link
                      href={`/communications/templates/${encodeURIComponent(t.id)}`}
                      className="btn btn-primary btn-sm min-h-[40px]"
                    >
                      Edit
                    </Link>
                    {!isSystem && (
                      <Button variant="ghost" size="sm" onClick={() => void remove(t)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="New template"
          onClick={() => !busy && setShowNew(false)}
        >
          <div className="card-surface w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
              New template
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className={labelCls} htmlFor="nt-name">Name</label>
                <input
                  id="nt-name"
                  className={`${inputCls} min-h-[44px]`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Quarterly investor update"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="nt-purpose">Purpose</label>
                <select
                  id="nt-purpose"
                  className={`${selectCls} min-h-[44px]`}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                >
                  {PURPOSES.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="nt-audience">Audience</label>
                <select
                  id="nt-audience"
                  className={`${selectCls} min-h-[44px]`}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                >
                  {AUDIENCES.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {error && (
              <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowNew(false)} disabled={busy}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={() => void create()} disabled={!name.trim() || busy} loading={busy}>
                Create &amp; edit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

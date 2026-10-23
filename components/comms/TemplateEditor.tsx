"use client";

/**
 * TemplateEditor — full template editing: name / purpose / audience /
 * tone / subject kinds / disclaimers (one per line), the blocks
 * editor (add by type, heading, visibility, config text for
 * text/internal_notes blocks, move up/down, remove), and the routine
 * toggle — DISABLED with the reason whenever routineAllowed (mirrored
 * client-side from the contract rule) is false. The service enforces
 * the same rule on save.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import {
  AUDIENCES,
  BLOCK_TYPES,
  COMMS_API,
  PURPOSES,
  SUBJECT_KINDS,
  api,
  inputCls,
  labelCls,
  labelOf,
  routineAllowed,
  routineBlockReason,
  selectCls,
  type CommsTemplate,
  type Rec,
  type TemplateBlock,
} from "@/components/comms/types";

interface FormState {
  name: string;
  purpose: string;
  customPurpose: string;
  audience: string;
  tone: string;
  subjectKinds: string[];
  disclaimers: string;
  blocks: TemplateBlock[];
  routine: boolean;
}

function formFrom(t: CommsTemplate): FormState {
  const knownPurpose = PURPOSES.some((p) => p.key === t.purpose);
  const rawBlocks = Array.isArray(t.blocks) ? t.blocks : [];
  return {
    name: t.name ?? "",
    purpose: knownPurpose ? t.purpose : "__custom__",
    customPurpose: knownPurpose ? "" : (t.purpose ?? ""),
    audience: t.audience ?? "internal",
    tone: typeof t.tone === "string" ? t.tone : "",
    subjectKinds: Array.isArray(
      (t as Rec).subjectKinds ?? (t as Rec).subject_kinds
    )
      ? ((t as Rec).subjectKinds ?? (t as Rec).subject_kinds) as string[]
      : [],
    disclaimers: Array.isArray(t.disclaimers) ? t.disclaimers.join("\n") : "",
    blocks: rawBlocks.map((b) => ({
      key: b.key,
      type: b.type,
      heading: b.heading ?? "",
      visibility: b.visibility ?? "all",
      config: b.config ?? {},
    })),
    routine: t.routine === true,
  };
}

let blockSeq = 0;
function newBlockKey(type: string, existing: TemplateBlock[]): string {
  let key = "";
  do {
    blockSeq += 1;
    key = `${type}_${blockSeq}`;
  } while (existing.some((b) => b.key === key));
  return key;
}

export default function TemplateEditor({ templateId }: { templateId: string }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [addType, setAddType] = useState("financial_summary");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/templates/${encodeURIComponent(templateId)}`
      );
      const t = (data.template ?? data) as CommsTemplate;
      setForm(formFrom(t));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error" || !form)
    return <ErrorState onRetry={() => void load()} />;

  const purpose =
    form.purpose === "__custom__" ? form.customPurpose.trim() : form.purpose;
  const allowed = routineAllowed({ purpose, blocks: form.blocks });
  const reason = routineBlockReason({ purpose, blocks: form.blocks });

  const set = (patch: Partial<FormState>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const updateBlock = (idx: number, patch: Partial<TemplateBlock>) =>
    setForm((f) =>
      f
        ? {
            ...f,
            blocks: f.blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
          }
        : f
    );

  const moveBlock = (idx: number, dir: -1 | 1) =>
    setForm((f) => {
      if (!f) return f;
      const next = [...f.blocks];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return f;
      const [item] = next.splice(idx, 1);
      next.splice(j, 0, item);
      return { ...f, blocks: next };
    });

  const addBlock = () => {
    const heading =
      BLOCK_TYPES.find((b) => b.key === addType)?.label ?? addType;
    set({
      blocks: [
        ...form.blocks,
        {
          key: newBlockKey(addType, form.blocks),
          type: addType,
          heading,
          visibility: addType === "internal_notes" ? "internal_only" : "all",
          config: {},
        },
      ],
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      await api(`${COMMS_API}/templates/${encodeURIComponent(templateId)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          purpose,
          audience: form.audience,
          tone: form.tone,
          subjectKinds: form.subjectKinds,
          disclaimers: form.disclaimers
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          blocks: form.blocks,
          routine: allowed ? form.routine : false,
        }),
      });
      setNote("Template saved.");
      void load();
    } catch (err) {
      const code =
        err && typeof err === "object" && "body" in err
          ? String((err as { body: Rec }).body?.error ?? "")
          : "";
      setError(
        code === "routine_not_allowed"
          ? "The server rejected routine mode for this template (memo purpose or a narrative block)."
          : "Could not save the template. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Link
        href="/communications"
        className="text-xs font-semibold uppercase tracking-wider text-gold-700 hover:underline dark:text-gold-400"
      >
        ← Communications
      </Link>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-display text-3xl font-semibold text-navy-900 dark:text-white">
          {form.name || "Template"}
        </h2>
        <Button variant="primary" size="sm" className="min-h-[44px]" onClick={() => void save()} loading={saving} disabled={saving}>
          Save template
        </Button>
      </div>

      {note && (
        <p className="mt-3 rounded-xl bg-green-500/10 px-4 py-3 text-sm text-green-800 dark:text-green-300">{note}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <div className="card-surface mt-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="te-name">Name</label>
            <input id="te-name" className={`${inputCls} min-h-[44px]`} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="te-tone">Tone</label>
            <input
              id="te-tone"
              className={`${inputCls} min-h-[44px]`}
              value={form.tone}
              onChange={(e) => set({ tone: e.target.value })}
              placeholder="e.g. Direct, factual, partner-level"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="te-purpose">Purpose</label>
            <select
              id="te-purpose"
              className={`${selectCls} min-h-[44px]`}
              value={form.purpose}
              onChange={(e) => set({ purpose: e.target.value })}
            >
              {PURPOSES.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
            {form.purpose === "__custom__" && (
              <input
                className={`${inputCls} mt-2 min-h-[44px]`}
                value={form.customPurpose}
                onChange={(e) => set({ customPurpose: e.target.value })}
                placeholder="Custom purpose key"
              />
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="te-audience">Audience</label>
            <select
              id="te-audience"
              className={`${selectCls} min-h-[44px]`}
              value={form.audience}
              onChange={(e) => set({ audience: e.target.value })}
            >
              {AUDIENCES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <span className={labelCls}>Applies to subjects</span>
          <div className="flex flex-wrap gap-3">
            {SUBJECT_KINDS.map((k) => (
              <label key={k.key} className="flex min-h-[36px] items-center gap-2 text-sm text-slate-700 dark:text-white/80">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.subjectKinds.includes(k.key)}
                  onChange={(e) =>
                    set({
                      subjectKinds: e.target.checked
                        ? [...form.subjectKinds, k.key]
                        : form.subjectKinds.filter((x) => x !== k.key),
                    })
                  }
                />
                {k.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className={labelCls} htmlFor="te-disclaimers">
            Disclaimers (one per line — printed in the report footer)
          </label>
          <textarea
            id="te-disclaimers"
            className={`${inputCls} min-h-[88px]`}
            value={form.disclaimers}
            onChange={(e) => set({ disclaimers: e.target.value })}
          />
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-white/80">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={allowed && form.routine}
              disabled={!allowed}
              onChange={(e) => set({ routine: e.target.checked })}
            />
            <span>
              <span className="font-semibold">Routine template</span> — schedules
              using it can be approved to generate and send without a
              per-run review.
              {!allowed && (
                <span className="mt-1 block text-amber-700 dark:text-amber-300">
                  {reason} The routine toggle is disabled for this template.
                </span>
              )}
            </span>
          </label>
        </div>
      </div>

      {/* Blocks editor */}
      <div className="card-surface mt-5 p-5">
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          Blocks
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Blocks render in order. “Internal only” blocks are stripped by
          the audience filter before any external recipient sees the
          report.
        </p>

        <div className="mt-4 space-y-3">
          {form.blocks.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-white/40">
              No blocks yet — add the first one below.
            </p>
          )}
          {form.blocks.map((b, i) => (
            <div key={b.key} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge badge-neutral">{labelOf(BLOCK_TYPES, b.type)}</span>
                <span className="text-xs text-slate-400 dark:text-white/40">{b.key}</span>
                <span className="ml-auto flex gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => moveBlock(i, -1)} disabled={i === 0} aria-label="Move block up">↑</Button>
                  <Button variant="ghost" size="sm" onClick={() => moveBlock(i, 1)} disabled={i === form.blocks.length - 1} aria-label="Move block down">↓</Button>
                  <Button variant="ghost" size="sm" onClick={() => set({ blocks: form.blocks.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Heading</label>
                  <input
                    className={`${inputCls} min-h-[40px]`}
                    value={b.heading}
                    onChange={(e) => updateBlock(i, { heading: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>Visibility</label>
                  <select
                    className={`${selectCls} min-h-[40px]`}
                    value={b.type === "internal_notes" ? "internal_only" : b.visibility}
                    disabled={b.type === "internal_notes"}
                    onChange={(e) => updateBlock(i, { visibility: e.target.value })}
                  >
                    <option value="all">All audiences</option>
                    <option value="internal_only">Internal only</option>
                  </select>
                  {b.type === "internal_notes" && (
                    <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                      Internal notes are always internal only.
                    </p>
                  )}
                </div>
              </div>
              {(b.type === "text" || b.type === "internal_notes") && (
                <div className="mt-3">
                  <label className={labelCls}>
                    {b.type === "text" ? "Text (printed verbatim)" : "Notes (printed verbatim, internal only)"}
                  </label>
                  <textarea
                    className={`${inputCls} min-h-[72px]`}
                    value={b.config?.text ?? ""}
                    onChange={(e) =>
                      updateBlock(i, { config: { ...(b.config ?? {}), text: e.target.value } })
                    }
                  />
                </div>
              )}
              {b.type !== "text" && b.type !== "internal_notes" && (
                <div className="mt-3">
                  <label className={labelCls}>Config note (optional)</label>
                  <input
                    className={`${inputCls} min-h-[40px]`}
                    value={b.config?.note ?? ""}
                    onChange={(e) =>
                      updateBlock(i, { config: { ...(b.config ?? {}), note: e.target.value } })
                    }
                    placeholder="Assembler hint for this block"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className={labelCls} htmlFor="te-add-type">Add block</label>
            <select
              id="te-add-type"
              className={`${selectCls} min-h-[44px]`}
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
            >
              {BLOCK_TYPES.map((b) => (
                <option key={b.key} value={b.key}>{b.label}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={addBlock}>
            Add block
          </Button>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="primary" size="sm" className="min-h-[44px]" onClick={() => void save()} loading={saving} disabled={saving}>
          Save template
        </Button>
      </div>
    </div>
  );
}

"use client";

/**
 * Stage moving (Oct 24, 2026): the explicit "move to stage" control
 * Ethan asked for. Before this, the only stage control in the product
 * was a <select> buried in the deal edit form (DealModal) — no drag on
 * the Kanban, no menu on table rows or cards, and nothing at all on
 * the deal detail page.
 *
 * Everything here rides the EXISTING machinery: a stage-only
 * PUT /api/deals/[id] (the route is merge-semantics — every field
 * absent from the body keeps its stored value), the Phase 10 stage
 * gates (409 stage_gate_blocked naming the unmet conditions), the
 * logged gate override (gateOverride.reason, recorded server-side),
 * and the server-side deal_closed / deal_stage_changed cascades. No
 * parallel write path.
 *
 * Stage options ALWAYS come from the deal's own investment-type
 * config (bd.type_config, via the bootstrap payload); the lib/types
 * constants are only the pre-config fallback — the same rule
 * DealModal's stage select uses.
 */

import { useEffect, useRef, useState } from "react";
import type { Deal, InvestmentTypeKey } from "@/lib/types";
import { EARLY_STAGE_STAGES, PLATFORM_LBO_STAGES } from "@/lib/types";
import {
  fetchBdBootstrap,
  stagesForType,
  type BdBootstrap,
} from "@/components/InvestmentTypeBits";
import { StageChip } from "@/components/SectorChip";
import { stageColor } from "@/lib/sector-colors";
import { showToast } from "@/components/Toast";

export interface GateUnmet {
  key: string;
  label: string;
}

type MoveResult =
  | { ok: true }
  | { ok: false; unmet: GateUnmet[] }
  | { ok: false; error: string };

/** One stage move through the shared deals PUT. */
export async function moveDealStage(
  dealId: string,
  targetStage: string,
  gateOverrideReason?: string
): Promise<MoveResult> {
  let res: Response;
  try {
    res = await fetch(`/api/deals/${dealId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        gateOverrideReason
          ? {
              stage: targetStage,
              gateOverride: { reason: gateOverrideReason },
            }
          : { stage: targetStage }
      ),
    });
  } catch {
    return { ok: false, error: "Network error — the move was not saved." };
  }
  if (res.ok) return { ok: true };
  const d = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    unmet?: GateUnmet[];
  };
  if (res.status === 409 && d.error === "stage_gate_blocked") {
    return { ok: false, unmet: Array.isArray(d.unmet) ? d.unmet : [] };
  }
  return {
    ok: false,
    error:
      d.message ?? `The move failed (${res.status}). Nothing was changed.`,
  };
}

/** The deal's OWN type stage list — config first, constants as fallback. */
export function stageOptionsForDeal(
  bd: BdBootstrap | null,
  deal: Deal
): string[] {
  const typeKey = (deal.investmentType ??
    "platform_lbo") as InvestmentTypeKey;
  const fromCfg = bd ? stagesForType(bd.config, typeKey) : [];
  if (fromCfg.length) return fromCfg;
  return typeKey === "early_stage"
    ? [...EARLY_STAGE_STAGES]
    : [...PLATFORM_LBO_STAGES];
}

interface GateState {
  target: string;
  unmet: GateUnmet[];
}

/**
 * Shared move flow for the menu and the stepper: optimistic stage,
 * busy state, the gate dialog state, and the override retry. When
 * `bdProp` is undefined the hook loads the bd bootstrap itself
 * (cached) — surfaces that already hold it (Pipeline) pass it down.
 */
function useStageMove(
  deal: Deal,
  bdProp: BdBootstrap | null | undefined,
  onMoved?: () => void
) {
  const [bdState, setBdState] = useState<BdBootstrap | null>(null);
  const bd = bdProp !== undefined ? bdProp : bdState;
  useEffect(() => {
    if (bdProp !== undefined) return;
    let live = true;
    void fetchBdBootstrap().then((b) => {
      if (live) setBdState(b);
    });
    return () => {
      live = false;
    };
  }, [bdProp]);

  // Optimistic stage: a successful move shows immediately, before the
  // parent's refetch lands; a fresh deal prop resyncs it.
  const [stage, setStage] = useState(deal.stage);
  useEffect(() => {
    setStage(deal.stage);
  }, [deal.id, deal.stage]);

  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<GateState | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState("");
  const [error, setError] = useState("");

  const succeed = (target: string) => {
    setStage(target);
    setGate(null);
    setGateError("");
    setError("");
    showToast(`Moved ${deal.companyName} to ${target}`);
    onMoved?.();
  };

  const attempt = (target: string) => {
    if (busy || target === stage) return;
    setBusy(true);
    setError("");
    void moveDealStage(deal.id, target).then((r) => {
      setBusy(false);
      if (r.ok) succeed(target);
      else if ("unmet" in r) setGate({ target, unmet: r.unmet });
      else setError(r.error);
    });
  };

  const confirmGate = (reason: string) => {
    if (!gate || gateBusy) return;
    const target = gate.target;
    setGateBusy(true);
    setGateError("");
    void moveDealStage(deal.id, target, reason).then((r) => {
      setGateBusy(false);
      if (r.ok) succeed(target);
      else if ("unmet" in r) setGate({ target, unmet: r.unmet });
      else setGateError(r.error);
    });
  };

  return {
    bd,
    stage,
    busy,
    gate,
    gateBusy,
    gateError,
    error,
    attempt,
    confirmGate,
    cancelGate: () => {
      setGate(null);
      setGateError("");
    },
    dismissError: () => setError(""),
  };
}

type Flow = ReturnType<typeof useStageMove>;

/** The gate dialog: names every unmet condition, takes the override
 * reason (required), and explains the override is audit-logged. */
function StageGateDialog({
  deal,
  fromStage,
  flow,
}: {
  deal: Deal;
  fromStage: string;
  flow: Flow;
}) {
  const gate = flow.gate;
  const [reason, setReason] = useState("");
  const cancel = flow.cancelGate;
  const busy = flow.gateBusy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, cancel]);
  if (!gate) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      onClick={() => {
        if (!busy) cancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Stage gate for ${deal.companyName}`}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-[#132847]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          Stage gate — {deal.companyName}
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
          Moving from <strong>{fromStage}</strong> to{" "}
          <strong>{gate.target}</strong> is blocked until these conditions
          are met:
        </p>
        <ul className="mt-3 space-y-1.5">
          {gate.unmet.map((u) => (
            <li
              key={u.key}
              className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
            >
              <span aria-hidden>⚠</span>
              <span>{u.label}</span>
            </li>
          ))}
          {gate.unmet.length === 0 && (
            <li className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              One or more stage conditions are unmet.
            </li>
          )}
        </ul>
        <label
          htmlFor={`gate-reason-${deal.id}`}
          className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50"
        >
          Override reason (recorded in the audit trail)
        </label>
        <textarea
          id={`gate-reason-${deal.id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why is this move proceeding without the conditions above?"
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
        />
        {flow.gateError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-300">
            {flow.gateError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-white/15 dark:text-white/70 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => flow.confirmGate(reason.trim())}
            disabled={busy || !reason.trim()}
            className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            {busy ? "Moving…" : "Override and move"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveErrorNote({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  return (
    <span className="mt-1.5 flex w-60 max-w-full items-start gap-2 whitespace-normal rounded-lg bg-red-50 px-2.5 py-1.5 text-left text-xs font-normal text-red-700 dark:bg-red-500/15 dark:text-red-300">
      <span className="flex-1">{error}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="font-bold leading-none"
      >
        ×
      </button>
    </span>
  );
}

/**
 * "Move to stage" dropdown for table rows, cards, and Kanban cards.
 * The trigger is the stage chip itself (plus a caret); the panel is
 * fixed-positioned from the trigger's rect so table overflow and card
 * clipping can never swallow it. Clicks never propagate — the menu
 * lives inside row/card click targets that open the deal modal.
 */
export function StageMoveMenu({
  deal,
  bd: bdProp,
  onMoved,
  className = "",
}: {
  deal: Deal;
  bd?: BdBootstrap | null;
  onMoved?: () => void;
  className?: string;
}) {
  const flow = useStageMove(deal, bdProp, onMoved);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const options = stageOptionsForDeal(flow.bd, deal);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.max(196, r.width);
      const estHeight = Math.min(320, options.length * 37 + 34);
      const left = Math.max(
        8,
        Math.min(r.left, window.innerWidth - width - 8)
      );
      const top =
        r.bottom + 4 + estHeight > window.innerHeight - 8
          ? Math.max(8, r.top - estHeight - 4)
          : r.bottom + 4;
      setPos({ left, top, width });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open ]);

  return (
    <span
      className={`inline-block ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={flow.busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Move ${deal.companyName} to another stage`}
        className="inline-flex items-center gap-0.5 rounded-full transition hover:brightness-95 disabled:opacity-60 dark:hover:brightness-125"
      >
        <StageChip stage={flow.stage} />
        <span
          aria-hidden
          className="pr-0.5 text-[10px] text-slate-500 dark:text-white/60"
        >
          ▾
        </span>
      </button>
      {open && pos && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={`Move ${deal.companyName} to stage`}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            width: pos.width,
            zIndex: 65,
          }}
          className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-white/10 dark:bg-[#132847]"
        >
          <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">
            Move to stage
          </p>
          {options.map((s) => {
            const current = s === flow.stage;
            return (
              <button
                key={s}
                type="button"
                role="menuitem"
                disabled={current || flow.busy}
                onClick={() => {
                  setOpen(false);
                  flow.attempt(s);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                  current
                    ? "cursor-default font-semibold text-slate-400 dark:text-white/40"
                    : "text-slate-700 hover:bg-slate-100 dark:text-[#e8dfc8] dark:hover:bg-white/5"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: stageColor(s) }}
                />
                <span className="flex-1 text-left">{s}</span>
                {current && (
                  <span className="text-[11px] font-semibold uppercase tracking-wide">
                    Current
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {flow.error && (
        <MoveErrorNote error={flow.error} onDismiss={flow.dismissError} />
      )}
      {flow.gate && (
        <StageGateDialog deal={deal} fromStage={deal.stage} flow={flow} />
      )}
    </span>
  );
}

/**
 * Stage stepper for the deal detail page header: the deal's own
 * type's stage list as a step row, current stage filled, earlier
 * stages checked, every other stage one click away (gates apply).
 */
export function StageStepper({
  deal,
  bd: bdProp,
  onMoved,
}: {
  deal: Deal;
  bd?: BdBootstrap | null;
  onMoved?: () => void;
}) {
  const flow = useStageMove(deal, bdProp, onMoved);
  const options = stageOptionsForDeal(flow.bd, deal);
  const currentIdx = options.indexOf(flow.stage);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
          Stage
        </span>
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label={`Stage for ${deal.companyName}: ${flow.stage}`}
        >
          {currentIdx === -1 && (
            <span className="inline-flex items-center gap-2">
              <StageChip stage={flow.stage} />
              <span className="text-xs text-slate-400 dark:text-white/40">
                (not in this type&rsquo;s stage list)
              </span>
            </span>
          )}
          {options.map((s, i) => {
            const isCurrent = s === flow.stage;
            const isDone = currentIdx >= 0 && i < currentIdx;
            return (
              <span key={s} className="inline-flex items-center gap-1.5">
                {i > 0 && (
                  <span aria-hidden className="text-slate-300 dark:text-white/20">
                    ›
                  </span>
                )}
                <button
                  type="button"
                  disabled={isCurrent || flow.busy}
                  onClick={() => flow.attempt(s)}
                  title={
                    isCurrent
                      ? `${s} — current stage`
                      : `Move ${deal.companyName} to ${s}`
                  }
                  className={
                    isCurrent
                      ? "inline-flex items-center gap-1.5 rounded-full bg-[#0d1f3c] px-3 py-1 text-xs font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                      : "inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-500 transition hover:border-[#b8975a] hover:text-slate-800 disabled:opacity-50 dark:border-white/15 dark:text-white/55 dark:hover:border-[#b8975a] dark:hover:text-white"
                  }
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: stageColor(s) }}
                  />
                  {isDone ? `✓ ${s}` : s}
                </button>
              </span>
            );
          })}
          {flow.busy && (
            <span className="text-xs text-slate-400 dark:text-white/40">
              Moving…
            </span>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-slate-400 dark:text-white/40">
        Select a stage to move this deal. Stage gates apply — an override
        needs a reason and is recorded.
      </p>
      {flow.error && (
        <MoveErrorNote error={flow.error} onDismiss={flow.dismissError} />
      )}
      {flow.gate && (
        <StageGateDialog deal={deal} fromStage={deal.stage} flow={flow} />
      )}
    </div>
  );
}

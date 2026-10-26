"use client";

/**
 * QuickLog — Relationship CRM Phase 1 (Oct 25, 2026).
 *
 * Global "Log interaction" dialog: QuickLogProvider + useQuickLog().
 * Mounted once in AppShell; opened from the FAB ("Log interaction"),
 * Ctrl/Cmd+L anywhere, and /directory?touch=1.
 *
 * Contract (DESIGN.md, Lane B):
 *  POST /api/platform/directory/interactions
 *    -> 201 on success, 409 { duplicateOf } on a possible duplicate
 *       (resubmit with force:true for "Save anyway").
 *  GET  /api/platform/directory/interaction-templates
 *    -> { items: InteractionTemplate[] } | InteractionTemplate[]
 *  GET  /api/platform/directory?q=&kind=person&limit=&offset=
 *    -> { items, total } (existing directory list)
 *  POST /api/platform/directory { kind:"person", name } (existing
 *    record POST) for the inline "Add new person" flow.
 *  GET  /api/deals -> Deal[] (existing endpoint the client already
 *    uses, e.g. PipelineView) for the deal picker — filtered
 *    client-side; this endpoint returns the full list.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { showToast } from "@/components/Toast";

/* ---------------- Local contract types ---------------- */

export type InteractionType =
  | "call" | "meeting" | "email" | "text" | "note" | "event" | "intro";
export type InteractionDirection = "outbound" | "inbound" | "na";
export type InteractionVisibility = "shared" | "private";

export interface QuickLogPerson {
  id: string;
  name: string;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface InteractionTemplate {
  id: string;
  name: string;
  type: string;
  summary: string;
  outcome: string;
}

interface DealOption { id: string; name: string }

interface QuickLogContextValue {
  open: boolean;
  openQuickLog: (preset?: { person?: QuickLogPerson }) => void;
  closeQuickLog: () => void;
}

const QuickLogContext = createContext<QuickLogContextValue>({
  open: false,
  openQuickLog: () => {},
  closeQuickLog: () => {},
});

export function useQuickLog(): QuickLogContextValue {
  return useContext(QuickLogContext);
}

/* ---------------- Constants / styles ---------------- */

const TYPES: { id: InteractionType; label: string }[] = [
  { id: "call", label: "Call" },
  { id: "meeting", label: "Meeting" },
  { id: "email", label: "Email" },
  { id: "text", label: "Text" },
  { id: "note", label: "Note" },
  { id: "event", label: "Event" },
  { id: "intro", label: "Intro" },
];

const OUTCOMES = [
  "none", "awaiting_reply", "replied", "meeting_set", "declined",
  "no_reply", "spoke", "voicemail", "no_answer", "completed",
] as const;

const inputCls =
  "w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizePeople(data: unknown): QuickLogPerson[] {
  const items =
    data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: unknown[] }).items)
      : Array.isArray(data) ? data : [];
  return items
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: String(x.id ?? ""),
      name: String(x.name ?? ""),
      organizationId: (x.organizationId as string) ?? null,
      organizationName: (x.organizationName as string) ?? null,
    }))
    .filter((p) => p.id && p.name);
}

function normalizeDeals(data: unknown): DealOption[] {
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
      ? ((data as { items: unknown[] }).items as unknown[])
      : [];
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      id: String(x.id ?? ""),
      name: String(x.companyName ?? x.name ?? x.dealName ?? ""),
    }))
    .filter((d) => d.id && d.name);
}

/* ---------------- Dialog ---------------- */

function QuickLogDialog({ onClose, initialPerson }: { onClose: () => void; initialPerson?: QuickLogPerson | null }) {
  const [people, setPeople] = useState<QuickLogPerson[]>(initialPerson ? [initialPerson] : []);
  const [personQ, setPersonQ] = useState("");
  const [personResults, setPersonResults] = useState<QuickLogPerson[]>([]);
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");

  const [type, setType] = useState<InteractionType>("call");
  const [direction, setDirection] = useState<InteractionDirection>("outbound");
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(new Date()));
  const [templates, setTemplates] = useState<InteractionTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [summary, setSummary] = useState("");
  const [outcome, setOutcome] = useState<string>("none");
  const [predictedReplyPct, setPredictedReplyPct] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextStepDue, setNextStepDue] = useState("");
  const [dealQ, setDealQ] = useState("");
  const [deals, setDeals] = useState<DealOption[]>([]);
  const [dealId, setDealId] = useState("");
  const [linkToRaise, setLinkToRaise] = useState(false);
  const [organizationId, setOrganizationId] = useState("");
  const [visibility, setVisibility] = useState<InteractionVisibility>("shared");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<unknown>(null);
  const summaryRef = useRef<HTMLTextAreaElement | null>(null);

  const speechAvailable = useMemo(
    () =>
      typeof window !== "undefined" &&
      !!((window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition),
    []
  );

  /* Templates + deals load once on open. */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/platform/directory/interaction-templates");
        if (!r.ok) return;
        const data: unknown = await r.json().catch(() => null);
        const items = Array.isArray(data)
          ? data
          : data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)
            ? ((data as { items: InteractionTemplate[] }).items)
            : [];
        setTemplates(items as InteractionTemplate[]);
      } catch { /* templates are an enhancement */ }
    })();
    (async () => {
      try {
        const r = await fetch("/api/deals");
        if (!r.ok) return;
        setDeals(normalizeDeals(await r.json().catch(() => null)));
      } catch { /* deal link is optional */ }
    })();
  }, []);

  /* Person search — debounced, existing directory list endpoint. */
  useEffect(() => {
    const q = personQ.trim();
    if (!q) { setPersonResults([]); return; }
    let cancelled = false;
    const t = window.setTimeout(() => {
      (async () => {
        try {
          const params = new URLSearchParams({ kind: "person", q, limit: "10", offset: "0" });
          const r = await fetch(`/api/platform/directory?${params.toString()}`);
          if (!r.ok || cancelled) return;
          if (!cancelled) setPersonResults(normalizePeople(await r.json()));
        } catch { /* search is best-effort */ }
      })();
    }, 200);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [personQ]);

  /* Organization auto-fills from the primary (first) person. */
  useEffect(() => {
    const primary = people[0];
    setOrganizationId(primary?.organizationId ? String(primary.organizationId) : "");
  }, [people]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const addPerson = (p: QuickLogPerson) => {
    setPeople((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setPersonQ("");
    setPersonResults([]);
  };

  const createPerson = async () => {
    const name = (newPersonName || personQ).trim();
    if (!name || addingPerson) return;
    setAddingPerson(true);
    try {
      const r = await fetch("/api/platform/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "person", name }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: unknown = await r.json().catch(() => null);
      const obj = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
      const rec = (obj.record ?? obj.item ?? obj) as Record<string, unknown>;
      if (typeof rec.id === "string") {
        addPerson({
          id: rec.id,
          name: String(rec.name || name),
          organizationId: (rec.organizationId as string) ?? null,
          organizationName: (rec.organizationName as string) ?? null,
        });
        setNewPersonName("");
      } else {
        setError("Person created, but its id was not returned — search for them above.");
      }
    } catch {
      setError("Could not add that person — please try again.");
    } finally { setAddingPerson(false); }
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (TYPES.some((x) => x.id === t.type)) setType(t.type as InteractionType);
    if (t.summary) setSummary(t.summary);
    if (t.outcome) setOutcome(t.outcome);
  };

  const startDictation = () => {
    if (!speechAvailable || listening) return;
    try {
      const w = window as unknown as Record<string, unknown>;
      const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as new () => {
        lang: string; interimResults: boolean;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onend: (() => void) | null; onerror: (() => void) | null;
        start: () => void; stop: () => void;
      };
      const rec = new Ctor();
      recognitionRef.current = rec;
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0]?.transcript ?? "";
        const t = text.trim();
        if (t) setSummary((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${t}` : t));
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      setListening(true);
      rec.start();
    } catch { setListening(false); }
  };

  const submit = async (force = false) => {
    if (busy) return;
    if (people.length === 0) { setError("Add at least one person first."); return; }
    setBusy(true);
    setError("");
    try {
      const primary = people[0];
      const pct = predictedReplyPct.trim() === "" ? undefined : Number(predictedReplyPct);
      const body: Record<string, unknown> = {
        personIds: people.map((p) => p.id),
        participantPersonIds: people.map((p) => p.id),
        primaryPersonId: primary.id,
        type,
        direction,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
        summary: summary.trim(),
        outcome,
        nextStep: nextStep.trim() || undefined,
        nextStepDue: nextStepDue || undefined,
        predictedReplyPct: direction === "outbound" && pct !== undefined && Number.isFinite(pct) ? pct : undefined,
        dealId: dealId || undefined,
        raiseDealId: linkToRaise && dealId ? dealId : undefined,
        organizationId: organizationId || undefined,
        visibility,
        force: force || undefined,
      };
      const r = await fetch("/api/platform/directory/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status === 409) {
        const data: unknown = await r.json().catch(() => null);
        const dup = data && typeof data === "object" ? (data as { duplicateOf?: unknown }).duplicateOf : null;
        setDuplicateOf(typeof dup === "string" ? dup : "existing");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      showToast("Interaction logged");
      window.dispatchEvent(new CustomEvent("ccp:interaction-logged"));
      onClose();
    } catch {
      setError("Could not log that interaction — please try again.");
    } finally { setBusy(false); }
  };

  const filteredDeals = dealQ.trim()
    ? deals.filter((d) => d.name.toLowerCase().includes(dealQ.trim().toLowerCase())).slice(0, 10)
    : deals.slice(0, 10);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Log interaction">
      <button type="button" aria-label="Close log interaction" onClick={onClose} className="absolute inset-0 h-full w-full bg-[#0d1f3c]/50" />
      <div className="absolute inset-0 flex flex-col overflow-y-auto bg-white p-5 shadow-2xl dark:bg-[#0f2242] sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:w-full sm:max-w-[560px] sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">Log interaction</h3>
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm min-h-[44px]">Close</button>
        </div>

        {/* People */}
        <div>
          <label className={labelCls} htmlFor="ql-person-search">People</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {people.map((p) => (
              <span key={p.id} className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-[#0d1f3c] py-1 pl-2.5 pr-1.5 text-xs font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                {p.name}
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPeople((prev) => prev.filter((x) => x.id !== p.id))} className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px]">×</button>
              </span>
            ))}
          </div>
          <input id="ql-person-search" autoFocus value={personQ} onChange={(e) => setPersonQ(e.target.value)} placeholder="Search people…" className={inputCls} />
          {personResults.length > 0 && (
            <ul className="mt-1 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
              {personResults.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => addPerson(p)} className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#0d1f3c] hover:bg-slate-50 dark:text-white dark:hover:bg-white/5">
                    <span className="flex-1 truncate">{p.name}</span>
                    {p.organizationName && <span className="truncate text-xs text-slate-400">{p.organizationName}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {personQ.trim() && (
            <div className="mt-2 flex gap-2">
              <input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder={personQ.trim()} aria-label="New person name" className={inputCls} />
              <button type="button" disabled={addingPerson} onClick={() => void createPerson()} className="btn btn-secondary btn-sm min-h-[44px] shrink-0">＋ Add new person</button>
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="ql-type">Type</label>
            <select id="ql-type" value={type} onChange={(e) => setType(e.target.value as InteractionType)} className={inputCls}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ql-when">Date &amp; time</label>
            <input id="ql-when" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ql-direction">Direction</label>
            <select id="ql-direction" value={direction} onChange={(e) => setDirection(e.target.value as InteractionDirection)} className={inputCls}>
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
              <option value="na">N/A</option>
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ql-template">Template</label>
            <select id="ql-template" value={templateId} onChange={(e) => applyTemplate(e.target.value)} className={inputCls}>
              <option value="">No template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className={labelCls} htmlFor="ql-summary">Summary</label>
          <div className="flex gap-2">
            <textarea id="ql-summary" ref={summaryRef} value={summary} onChange={(e) => setSummary(e.target.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void submit(false); } }}
              rows={3} placeholder="What happened? (Ctrl+Enter to save)" className={`${inputCls} min-h-[72px] flex-1`} />
            {speechAvailable && (
              <button type="button" onClick={startDictation} aria-pressed={listening} className="btn btn-secondary btn-sm min-h-[44px] shrink-0 self-start">
                {listening ? "Listening…" : "🎤 Dictate"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="ql-outcome">Outcome</label>
            <select id="ql-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputCls}>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          {direction === "outbound" && (
            <div>
              <label className={labelCls} htmlFor="ql-predicted">Predicted reply %</label>
              <input id="ql-predicted" type="number" min={0} max={100} value={predictedReplyPct} onChange={(e) => setPredictedReplyPct(e.target.value)} placeholder="0–100" className={inputCls} />
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="ql-next-step">Next step</label>
            <input id="ql-next-step" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Creates a task" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="ql-next-due">Next step due</label>
            <input id="ql-next-due" type="date" value={nextStepDue} onChange={(e) => setNextStepDue(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Deal picker */}
        <div className="mt-4">
          <label className={labelCls} htmlFor="ql-deal-search">Deal (optional)</label>
          <input id="ql-deal-search" value={dealQ} onChange={(e) => { setDealQ(e.target.value); }} placeholder="Search deals…" className={inputCls} />
          <select aria-label="Deal" value={dealId} onChange={(e) => setDealId(e.target.value)} className={`${inputCls} mt-2`}>
            <option value="">No deal</option>
            {filteredDeals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <label className="mt-2 flex min-h-[44px] items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
            <input type="checkbox" checked={linkToRaise} disabled={!dealId} onChange={(e) => setLinkToRaise(e.target.checked)} className="h-4 w-4 accent-[#b8975a]" />
            Link to raise
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className={labelCls} style={{ marginBottom: 0 }}>Visibility</span>
          <div className="flex gap-1.5" role="group" aria-label="Visibility">
            {(["shared", "private"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={visibility === v} onClick={() => setVisibility(v)} className={`chip min-h-[44px] ${visibility === v ? "chip-active" : ""}`}>
                {v === "shared" ? "Shared" : "Private"}
              </button>
            ))}
          </div>
          {people[0]?.organizationName && (
            <span className="text-xs text-slate-400 dark:text-white/40">Organization: {people[0].organizationName}</span>
          )}
        </div>

        {duplicateOf && (
          <div className="mt-4 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-800 dark:text-amber-200" role="alert">
            <p className="font-semibold">Possible duplicate</p>
            <p className="mt-0.5">A similar interaction for this person and time already exists.</p>
            <button type="button" disabled={busy} onClick={() => void submit(true)} className="btn btn-primary btn-sm mt-2 min-h-[44px]">Save anyway</button>
          </div>
        )}
        {error && <p className="mt-4 rounded-xl bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">{error}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || people.length === 0} onClick={() => void submit(false)} className="btn btn-primary min-h-[44px]">
            {busy ? "Saving…" : "Log interaction"}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost min-h-[44px]">Cancel</button>
          <span className="text-xs text-slate-400 dark:text-white/40">Ctrl/Cmd+L opens this dialog · Ctrl+Enter saves</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Provider ---------------- */

export function QuickLogProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [presetPerson, setPresetPerson] = useState<QuickLogPerson | null>(null);
  const [mountKey, setMountKey] = useState(0);

  const openQuickLog = useCallback((preset?: { person?: QuickLogPerson }) => {
    setPresetPerson(preset?.person ?? null);
    setMountKey((k) => k + 1);
    setIsOpen(true);
  }, []);
  const closeQuickLog = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        openQuickLog();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openQuickLog]);

  // Allow non-React callers (e.g. page ?touch=1 handling) to open it.
  useEffect(() => {
    const onEvent = () => openQuickLog();
    window.addEventListener("ccp:open-quicklog", onEvent);
    return () => window.removeEventListener("ccp:open-quicklog", onEvent);
  }, [openQuickLog]);

  const value = useMemo(
    () => ({ open: isOpen, openQuickLog, closeQuickLog }),
    [isOpen, openQuickLog, closeQuickLog]
  );

  return (
    <QuickLogContext.Provider value={value}>
      {children}
      {isOpen && (
        <QuickLogDialog key={mountKey} initialPerson={presetPerson} onClose={closeQuickLog} />
      )}
    </QuickLogContext.Provider>
  );
}


export default QuickLogProvider;

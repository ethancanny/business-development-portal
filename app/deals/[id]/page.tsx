"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import TaskList from "@/components/TaskList";
import { DealModal } from "@/components/Modals";
import type {
  ActivityEvent,
  Attachment,
  Contact,
  Deal,
  Executive,
  Interaction,
  Task,
} from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/format";
import PageHero from "@/components/PageHero";

export default function DealDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [execs, setExecs] = useState<Executive[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [editing, setEditing] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showContactForm, setShowContactForm] = useState(false);
  const [showIxForm, setShowIxForm] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    try {
      const [dealRes, tasksRes, execsRes, actRes, conRes, ixRes, attRes] =
        await Promise.all([
          fetch(`/api/deals/${id}`),
          fetch("/api/tasks"),
          fetch("/api/executives"),
          fetch("/api/activity?limit=200"),
          fetch(`/api/contacts`),
          fetch(`/api/interactions?dealId=${id}`),
          fetch(`/api/attachments?dealId=${id}`),
        ]);
      if (dealRes.status === 401) {
        router.replace("/login");
        return;
      }
      if (dealRes.status === 404) {
        setNotFound(true);
        return;
      }
      if (dealRes.ok) setDeal(await dealRes.json());
      if (tasksRes.ok) {
        const all: Task[] = await tasksRes.json();
        setTasks(
          all.filter((t) => t.relatedKind === "deal" && t.relatedId === id)
        );
      }
      if (execsRes.ok) setExecs(await execsRes.json());
      if (actRes.ok) {
        const all: ActivityEvent[] = await actRes.json();
        setActivity(all.filter((e) => e.dealId === id).slice(0, 30));
      }
      if (conRes.ok) {
        const all: Contact[] = await conRes.json();
        setContacts(all.filter((c) => c.dealId === id));
      }
      if (ixRes.ok) setInteractions(await ixRes.json());
      if (attRes.ok) setAttachments(await attRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-white/50">Loading account…</p>
      </div>
    );
  }

  if (notFound || !deal) {
    return (
      <main className="mx-auto max-w-[860px] px-4 py-16 text-center sm:px-6">
        <p className="text-lg font-semibold text-slate-700 dark:text-white">
          This account no longer exists.
        </p>
        <Link
          href="/pipeline"
          className="mt-4 inline-block text-sm font-semibold text-[#8a6f3c] hover:underline"
        >
          ← Back to pipeline
        </Link>
      </main>
    );
  }

  return (
    <>
      <PageHero
        eyebrow="Acquisition target"
        title={deal.companyName}
        subtitle={
          [deal.industry, deal.city].filter(Boolean).join(" · ") || undefined
        }
      />
      <main className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <Link
          href="/pipeline"
          className="text-sm font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
        >
          ← Back to pipeline
        </Link>

        {/* Dossier header */}
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-[#132847]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-[#0d1f3c] px-3 py-1 text-xs font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                {deal.stage}
              </span>
              {deal.owner ? (
                <span className="rounded-full bg-[#b8975a]/20 px-3 py-1 text-xs font-semibold text-[#8a6f3c] dark:bg-white/10 dark:text-[#e8dfc8]">
                  Claimed by {deal.owner}
                </span>
              ) : (
                <span className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs font-medium text-slate-400 dark:border-white/25 dark:text-white/50">
                  Unclaimed
                </span>
              )}
              {(deal.operatorIds ?? []).map((oid) => {
                const op = execs.find((e) => e.id === oid);
                if (!op) return null;
                const match =
                  deal.industry.trim() !== "" &&
                  (op.industries ?? []).some(
                    (ind) =>
                      ind.toLowerCase() === deal.industry.trim().toLowerCase()
                  );
                return (
                  <span
                    key={oid}
                    title={
                      match
                        ? `Industry match: ${deal.industry}`
                        : "Paired operator"
                    }
                    className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                  >
                    ◈ {op.name}
                    {match ? " ✓" : ""}
                  </span>
                );
              })}
              {(!deal.operatorIds || deal.operatorIds.length === 0) && (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-full border border-dashed border-amber-400 px-3 py-1 text-xs font-semibold text-amber-600 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-500/10"
                >
                  + Pair an operator
                </button>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-white/50">
                Deal value
              </p>
              <p className="text-2xl font-bold text-[#0d1f3c] dark:text-white">
                {fmtMoney(deal.dealValue)}
              </p>
              <button
                onClick={() => setEditing(true)}
                className="mt-3 rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
              >
                Edit account
              </button>
            </div>
          </div>

        {(deal.revenue != null ||
          deal.ebitda != null ||
          deal.askingPrice != null ||
          deal.broker ||
          deal.source) && (
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-5 dark:border-white/10">
            {[
              { label: "Revenue", value: deal.revenue != null ? fmtMoney(deal.revenue) : "—" },
              { label: "EBITDA", value: deal.ebitda != null ? fmtMoney(deal.ebitda) : "—" },
              { label: "Asking price", value: deal.askingPrice != null ? fmtMoney(deal.askingPrice) : "—" },
              { label: "Broker", value: deal.broker || "—" },
              { label: "Source", value: deal.source || "—" },
            ].map((f) => (
              <div key={f.label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                  {f.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-[#e8dfc8]">
                  {f.value}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 grid gap-6 border-t border-slate-100 pt-6 md:grid-cols-2 dark:border-white/10">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Contacts ({contacts.length})
              </h2>
              <button
                onClick={() => setShowContactForm((v) => !v)}
                className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
              >
                {showContactForm ? "Cancel" : "+ Add contact"}
              </button>
            </div>
            <ContactManager
              dealId={id}
              contacts={contacts}
              onChanged={load}
              showForm={showContactForm}
              setShowForm={setShowContactForm}
            />
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Links
            </h2>
            {deal.links && deal.links.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {deal.links.map((l, i) => (
                  <li key={i}>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                    >
                      {l.label || l.url} ↗
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400 dark:text-white/40">
                No links yet — add CIM or data-room links via Edit.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-6 dark:border-white/10">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Paired operators
            </h2>
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
            >
              Manage pairing
            </button>
          </div>
          {deal.operatorIds && deal.operatorIds.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {deal.operatorIds.map((id) => {
                const op = execs.find((e) => e.id === id);
                if (!op) return null;
                return (
                  <li
                    key={id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5"
                  >
                    <span className="text-sm font-medium text-slate-800 dark:text-[#e8dfc8]">
                      {op.name}
                    </span>
                    <span className="flex gap-1">
                      {(op.industries ?? []).map((ind) => (
                        <span
                          key={ind}
                          className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-[11px] font-medium text-[#8a6f3c] dark:text-[#d4b37a]"
                        >
                          {ind}
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 dark:text-white/40">
              No operators paired yet — use Edit to pair operators with this
              account.
            </p>
          )}
        </div>

        {deal.notes && (
          <div className="mt-6 border-t border-slate-100 pt-6 dark:border-white/10">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Notes
            </h2>
            <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-[#e8dfc8]">
              {deal.notes}
            </p>
          </div>
        )}

        <div className="mt-6 grid gap-6 border-t border-slate-100 pt-6 md:grid-cols-2 dark:border-white/10">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
                Touch history ({interactions.length})
              </h2>
              <button
                onClick={() => setShowIxForm((v) => !v)}
                className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
              >
                {showIxForm ? "Cancel" : "+ Log interaction"}
              </button>
            </div>
            <InteractionTimeline
              dealId={id}
              interactions={interactions}
              onChanged={load}
              showForm={showIxForm}
              setShowForm={setShowIxForm}
            />
          </div>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/50">
              Files ({attachments.length})
            </h2>
            <AttachmentManager
              dealId={id}
              attachments={attachments}
              onChanged={load}
            />
          </div>
        </div>

        <p className="mt-6 text-xs text-slate-400 dark:text-white/40">
          Added {fmtDate(deal.createdAt)} · Updated {fmtDate(deal.updatedAt)}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Follow-ups for this account */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
          <h2 className="mb-4 text-base font-bold text-[#0d1f3c] dark:text-white">
            Follow-ups for this account
          </h2>
          <TaskList
            tasks={tasks}
            deals={[]}
            execs={execs}
            onChanged={load}
            presetLink={{
              kind: "deal",
              id: deal.id,
              name: deal.companyName,
            }}
          />
        </section>

        {/* Account history */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#132847]">
          <h2 className="mb-4 text-base font-bold text-[#0d1f3c] dark:text-white">
            Account history
          </h2>
          {activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-white/40">
              No recorded history yet.
            </p>
          ) : (
            <ol className="relative space-y-1 border-l-2 border-slate-200 dark:border-white/10">
              {activity.map((e) => (
                <li key={e.id} className="relative pl-6 pb-4">
                  <span className="absolute left-[-5px] top-1.5 h-2 w-2 rounded-full bg-[#b8975a] ring-2 ring-white" />
                  <p className="text-sm text-slate-700 dark:text-[#e8dfc8]">{e.message}</p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                    {fmtDate(e.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {editing && (
        <DealModal
          deal={deal}
          executives={execs}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
          onDeleted={() => router.replace("/pipeline")}
        />
      )}
      </main>
    </>
  );
}

// ---------------- Contact manager ----------------

function ContactManager({
  dealId,
  contacts,
  onChanged,
  showForm,
  setShowForm,
}: {
  dealId: string;
  contacts: Contact[];
  onChanged: () => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    role: "",
    email: "",
    phone: "",
    linkedin: "",
    notes: "",
  });

  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, dealId }),
    });
    setBusy(false);
    if (res.ok) {
      setForm({ name: "", role: "", email: "", phone: "", linkedin: "", notes: "" });
      setShowForm(false);
      onChanged();
    }
  };

  const remove = async (cid: string, name: string) => {
    if (!window.confirm(`Remove contact "${name}"?`)) return;
    await fetch(`/api/contacts/${cid}`, { method: "DELETE" });
    onChanged();
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-white/5 dark:text-[#e8dfc8]";

  return (
    <div>
      {contacts.length === 0 && !showForm && (
        <p className="text-sm text-slate-400 dark:text-white/40">
          No contacts yet — add the owner, broker, or advisors for this account.
        </p>
      )}
      {contacts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-[#e8dfc8]">
                    {c.name}
                    {c.role && (
                      <span className="ml-2 text-xs font-normal text-slate-500 dark:text-white/50">
                        {c.role}
                      </span>
                    )}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                      >
                        {c.email}
                      </a>
                    )}
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        className="text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                      >
                        {c.phone}
                      </a>
                    )}
                    {c.linkedin && (
                      <a
                        href={c.linkedin}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                      >
                        LinkedIn ↗
                      </a>
                    )}
                  </div>
                  {c.notes && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                      {c.notes}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => remove(c.id, c.name)}
                  className="text-xs text-slate-400 hover:text-red-600 dark:text-white/40"
                  aria-label={`Remove ${c.name}`}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {showForm && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-white/10">
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputCls}
              placeholder="Name *"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              className={inputCls}
              placeholder="Role (Owner, Broker…)"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputCls}
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <input
              className={inputCls}
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <input
            className={inputCls}
            placeholder="LinkedIn URL"
            value={form.linkedin}
            onChange={(e) => setForm((f) => ({ ...f, linkedin: e.target.value }))}
          />
          <textarea
            className={inputCls}
            rows={2}
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <button
            onClick={save}
            disabled={busy || !form.name.trim()}
            className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            {busy ? "Saving…" : "Add contact"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- Interaction timeline ----------------

const IX_STYLE: Record<string, { label: string; cls: string }> = {
  call: { label: "Call", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  email: { label: "Email", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
  meeting: { label: "Meeting", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  note: { label: "Note", cls: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60" },
};

function InteractionTimeline({
  dealId,
  interactions,
  onChanged,
  showForm,
  setShowForm,
}: {
  dealId: string;
  interactions: Interaction[];
  onChanged: () => void;
  showForm: boolean;
  setShowForm: (v: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("note");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState("");

  const save = async () => {
    if (!summary.trim()) return;
    setBusy(true);
    const res = await fetch("/api/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dealId, kind, occurredAt: date, summary }),
    });
    setBusy(false);
    if (res.ok) {
      setSummary("");
      setShowForm(false);
      onChanged();
    }
  };

  const remove = async (iid: string) => {
    if (!window.confirm("Delete this log entry?")) return;
    await fetch(`/api/interactions/${iid}`, { method: "DELETE" });
    onChanged();
  };

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-white/5 dark:text-[#e8dfc8]";

  return (
    <div>
      {interactions.length === 0 && !showForm && (
        <p className="text-sm text-slate-400 dark:text-white/40">
          No touches logged yet — record calls, emails, and meetings here.
        </p>
      )}
      {interactions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {interactions.map((ix) => {
            const st = IX_STYLE[ix.kind] ?? IX_STYLE.note;
            return (
              <li
                key={ix.id}
                className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}
                >
                  {st.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-800 dark:text-[#e8dfc8]">
                    {ix.summary}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                    {ix.occurredAt || ix.createdAt.slice(0, 10)}
                  </p>
                </div>
                <button
                  onClick={() => remove(ix.id)}
                  className="text-xs text-slate-400 hover:text-red-600 dark:text-white/40"
                  aria-label="Delete log entry"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {showForm && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-white/10">
          <div className="grid grid-cols-2 gap-2">
            <select
              className={inputCls}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
            </select>
            <input
              type="date"
              className={inputCls}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <textarea
            className={inputCls}
            rows={2}
            placeholder="What happened? Outcome, next step…"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <button
            onClick={save}
            disabled={busy || !summary.trim()}
            className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            {busy ? "Saving…" : "Log it"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- Attachments ----------------

function AttachmentManager({
  dealId,
  attachments,
  onChanged,
}: {
  dealId: string;
  attachments: Attachment[];
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError("File too large (5 MB max).");
      return;
    }
    setUploading(true);
    setError("");
    const data = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const res = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealId,
        filename: file.name,
        mimeType: file.type,
        data,
      }),
    });
    setUploading(false);
    if (res.ok) onChanged();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Upload failed");
    }
  };

  const remove = async (aid: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    await fetch(`/api/attachments/${aid}`, { method: "DELETE" });
    onChanged();
  };

  const fmtSize = (b: number) =>
    b > 1024 * 1024
      ? `${(b / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1024))} KB`;

  return (
    <div>
      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}
      {attachments.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-white/40">
          No files yet — attach CIMs, IOIs, or LOIs (5 MB max each).
        </p>
      )}
      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5"
            >
              <a
                href={`/api/attachments/${a.id}`}
                className="truncate text-sm font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
              >
                📎 {a.filename}
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {fmtSize(a.size)}
                </span>
              </a>
              <button
                onClick={() => remove(a.id, a.filename)}
                className="ml-2 shrink-0 text-xs text-slate-400 hover:text-red-600 dark:text-white/40"
                aria-label={`Delete ${a.filename}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="inline-block cursor-pointer rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-500 hover:border-[#b8975a] hover:text-[#8a6f3c] dark:border-white/25 dark:text-white/60">
        {uploading ? "Uploading…" : "+ Attach file"}
        <input
          type="file"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}

import { ensureSchema as ensureLegacySchema } from "../db-postgres";
import { ensurePlatformSchema, sql, str, num, isoOrNull } from "./db";
import {
  repairNormalizedNames,
  runBackfillOnce,
  topUpBackfill,
} from "./migrate";
import {
  ensureBuiltinJobs,
  enqueueUniqueJob,
  listJobs,
  retryJob,
  runDueJobs,
  runJobNow,
} from "./jobs";
import { getOverview } from "./summaries";
import { findDuplicates, merge } from "./dedupe";
import { cached } from "./cache";
import { CACHE_TTLS } from "./config";
import { logUsage } from "./usage";
import type {
  CompanyCard,
  CompanyDetail,
  CompanyStage,
  DuplicatePair,
  IntegrationStatus,
  JobRow,
  OverviewSummary,
  Participant,
  RagStatus,
  TimelineItem,
} from "./types";

/**
 * Platform service façade — the only surface API routes call. Wires
 * schema + one-time backfill + builtin job registration (ensurePlatform)
 * and the read services for Overview / Companies / Jobs / Integrations /
 * Duplicates.
 */

let platformReady: Promise<void> | null = null;
let backfillSettled = false;

export async function ensurePlatform(): Promise<void> {
  if (!platformReady) {
    platformReady = (async () => {
      // Legacy tables must exist before the backfill SELECTs from them.
      await ensureLegacySchema().catch((err) => {
        console.error("[platform] legacy schema ensure failed", err);
      });
      await ensurePlatformSchema();
    })().catch((err) => {
      platformReady = null;
      throw err;
    });
  }
  await platformReady;
  if (!backfillSettled) {
    // Backfill statements are idempotent; if one fails we log and leave
    // the marker unset so a later call retries — without breaking reads.
    try {
      await runBackfillOnce(sql());
      await ensureBuiltinJobs();
      backfillSettled = true;
    } catch (err) {
      console.error("[platform] backfill failed (will retry)", err);
    }
    // First-run bootstrap: if no Overview summary has ever been built,
    // enqueue the refresh and drain due jobs inline — the serverless
    // form of the rules' "immediate background job". Later refreshes
    // are event-driven (see events.ts). Never breaks reads.
    try {
      const db = sql();
      const existing = await db`
        SELECT id FROM core.overview_summary WHERE id = 'main' LIMIT 1`;
      if (!existing.length) {
        await enqueueUniqueJob("refresh_overview_summary", {
          reason: "bootstrap",
        });
        await runDueJobs(3);
      }
    } catch (err) {
      console.error("[platform] summary bootstrap failed", err);
    }
  }
  // Backfill top-up: rows created in the legacy tables after the
  // one-time backfill (e.g. by the Oct 21 outage-recovery import) are
  // picked up by an idempotent re-run, gated to once per hour by the
  // 'phase1-backfill-topup' marker. Never breaks reads.
  try {
    await topUpBackfill(sql());
  } catch (err) {
    console.error("[platform] backfill top-up failed", err);
  }
  // One-time normalized_name repair (Phase 2; marker-guarded inside).
  // Never breaks reads.
  try {
    await repairNormalizedNames(sql());
  } catch (err) {
    console.error("[platform] normalized-name repair failed", err);
  }
  // Event-driven push (Oct 21, 2026): keep the daily digest job
  // scheduled and drain due push jobs opportunistically on platform
  // activity — this is one of the queue's drain triggers (no polling
  // loop). Never breaks reads.
  try {
    const { ensureMorningDigestJob, drainPushJobs } = await import(
      "../push-schedule"
    );
    await ensureMorningDigestJob();
    await drainPushJobs(3);
  } catch (err) {
    console.error("[platform] push schedule/drain failed", err);
  }
}

/* ------------------------------ Overview ------------------------------ */

export async function getOverviewData(
  cardsLimit = 24
): Promise<{ summary: OverviewSummary; cards: CompanyCard[] }> {
  return getOverview(cardsLimit);
}

/* ------------------------------ Companies ----------------------------- */

export interface CompanyFilters {
  stage?: string;
  vertical?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

function rowToCard(r: Record<string, unknown>): CompanyCard {
  const stage = str(r.stage);
  return {
    id: str(r.id),
    name: str(r.name),
    vertical: str(r.vertical),
    stage: (stage === "diligence" || stage === "portfolio"
      ? stage
      : "pipeline") as CompanyStage,
    dealStage: str(r.deal_stage),
    city: str(r.city),
    state: str(r.state) || "AZ",
    lat: r.lat === null || r.lat === undefined ? null : num(r.lat),
    lng: r.lng === null || r.lng === undefined ? null : num(r.lng),
    thesisFit: str(r.thesis_fit),
    ownerContext: str(r.owner_context),
    nextAction: str(r.next_action),
    lastActivityAt: isoOrNull(r.last_act) ?? isoOrNull(r.updated_at),
    rag:
      stage === "portfolio" &&
      (r.rag === "green" || r.rag === "amber" || r.rag === "red")
        ? (r.rag as RagStatus)
        : null,
    logoUrl: str(r.logo_url),
    heroUrl: str(r.hero_url),
  };
}

export async function listCompanies(
  filters: CompanyFilters
): Promise<CompanyCard[]> {
  const db = sql();
  const stage = (filters.stage ?? "").trim();
  const vertical = (filters.vertical ?? "").trim();
  const q = (filters.q ?? "").trim();
  const like = `%${q}%`;
  const limit = Math.min(50, Math.max(1, filters.limit || 25));
  const offset = Math.max(0, filters.offset || 0);
  const rows = await db`
    SELECT c.id, c.name, c.vertical, c.stage, c.deal_stage, c.city, c.state,
      c.lat, c.lng, c.thesis_fit, c.owner_context, c.next_action, c.rag,
      c.logo_url, c.hero_url, c.updated_at,
      (SELECT max(a.created_at) FROM core.activity_log a
        WHERE a.entity_id = c.id) AS last_act
    FROM core.companies c
    WHERE c.deleted_at IS NULL
      AND (${stage} = '' OR c.stage = ${stage})
      AND (${vertical} = '' OR c.vertical = ${vertical})
      AND (${q} = '' OR c.normalized_name ILIKE ${like}
        OR c.search_vector @@ plainto_tsquery('english', ${q}))
    ORDER BY c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const cards = rows.map((r) => rowToCard(r as Record<string, unknown>));
  logUsage("companies_list", cards.length, JSON.stringify(cards).length);
  return cards;
}

export async function countCompanies(
  filters: CompanyFilters
): Promise<number> {
  const db = sql();
  const stage = (filters.stage ?? "").trim();
  const vertical = (filters.vertical ?? "").trim();
  const q = (filters.q ?? "").trim();
  const like = `%${q}%`;
  const rows = await db`
    SELECT count(*)::int AS n
    FROM core.companies c
    WHERE c.deleted_at IS NULL
      AND (${stage} = '' OR c.stage = ${stage})
      AND (${vertical} = '' OR c.vertical = ${vertical})
      AND (${q} = '' OR c.normalized_name ILIKE ${like}
        OR c.search_vector @@ plainto_tsquery('english', ${q}))`;
  return rows.length ? num((rows[0] as Record<string, unknown>).n) : 0;
}

export async function getCompanyDetail(id: string): Promise<CompanyDetail | null> {
  return cached(`company:${id}`, CACHE_TTLS.companyDetail, async () => {
    const db = sql();
    const rows = await db`
      SELECT c.id, c.name, c.vertical, c.stage, c.deal_stage, c.city, c.state,
        c.lat, c.lng, c.thesis_fit, c.owner_context, c.next_action, c.rag,
        c.logo_url, c.hero_url, c.gallery, c.notes, c.source,
        c.legacy_deal_id, c.legacy_mi_id, c.created_at, c.updated_at,
        (SELECT max(a.created_at) FROM core.activity_log a
          WHERE a.entity_id = c.id) AS last_act
      FROM core.companies c
      WHERE c.id = ${id} AND c.deleted_at IS NULL
      LIMIT 1`;
    if (!rows.length) return null;
    const rec = rows[0] as Record<string, unknown>;
    const legacyDealId = rec.legacy_deal_id ? str(rec.legacy_deal_id) : null;
    const galleryRaw = rec.gallery;
    const gallery = Array.isArray(galleryRaw)
      ? galleryRaw.map((g) => String(g))
      : [];

    const card = rowToCard(rec);
    const company: CompanyDetail["company"] = {
      ...card,
      source: str(rec.source),
      gallery,
      notes: str(rec.notes),
      legacyDealId,
      legacyMiId: rec.legacy_mi_id ? str(rec.legacy_mi_id) : null,
      createdAt: isoOrNull(rec.created_at) ?? "",
      updatedAt: isoOrNull(rec.updated_at) ?? "",
    };

    const partRows = await db`
      SELECT dp.id, dp.deal_id, dp.entity_kind, dp.entity_id, dp.entity_name,
        dp.role, dp.status, dp.created_at, dp.updated_at
      FROM core.deal_participants dp
      JOIN core.deals d ON d.id = dp.deal_id
      WHERE d.company_id = ${id}
      ORDER BY dp.created_at ASC
      LIMIT 100`;
    const participants: Participant[] = partRows.map((r) => {
      const p = r as Record<string, unknown>;
      return {
        id: str(p.id),
        dealId: str(p.deal_id),
        entityKind: str(p.entity_kind),
        entityId: str(p.entity_id),
        entityName: str(p.entity_name),
        name: str(p.entity_name),
        role: str(p.role),
        status: str(p.status),
        createdAt: isoOrNull(p.created_at) ?? "",
        updatedAt: isoOrNull(p.updated_at) ?? "",
      };
    });

    const timelineRows = await db`
      SELECT id, kind, actor, message, source, created_at
      FROM core.activity_log
      WHERE entity_id = ${id}
        OR (${legacyDealId ?? ""} <> '' AND entity_id = ${legacyDealId ?? ""})
      ORDER BY created_at DESC
      LIMIT 50`;
    const timeline: TimelineItem[] = timelineRows.map((r) => {
      const t = r as Record<string, unknown>;
      return {
        id: str(t.id),
        kind: str(t.kind),
        actor: str(t.actor),
        message: str(t.message),
        source: str(t.source),
        createdAt: isoOrNull(t.created_at) ?? "",
        at: isoOrNull(t.created_at) ?? "",
      };
    });

    const dealRows = await db`
      SELECT cd.id, cd.company_id, cd.stage, cd.updated_at,
        coalesce(ld.company_name, '') AS company_name
      FROM core.deals cd
      LEFT JOIN deals ld ON ld.id = cd.id
      WHERE cd.company_id = ${id}
      ORDER BY cd.updated_at DESC LIMIT 50`;
    const deals = dealRows.map((r) => {
      const d = r as Record<string, unknown>;
      return {
        id: str(d.id),
        name: str(d.company_name),
        companyId: d.company_id ? str(d.company_id) : null,
        stage: str(d.stage),
        updatedAt: isoOrNull(d.updated_at) ?? "",
      };
    });

    let tasks: CompanyDetail["linked"]["tasks"] = [];
    if (legacyDealId) {
      const taskRows = await db`
        SELECT id, title, due_date, done, owner FROM tasks
        WHERE related_id = ${legacyDealId}
        ORDER BY (due_date = '') ASC, due_date ASC
        LIMIT 50`;
      tasks = taskRows.map((r) => {
        const t = r as Record<string, unknown>;
        return {
          id: str(t.id),
          title: str(t.title),
          dueDate: str(t.due_date),
          done: Boolean(t.done),
          owner: str(t.owner),
        };
      });
    }

    const docRows = await db`
      SELECT id, name, mime, size_bytes, storage_url, company_id, deal_id, created_at
      FROM core.documents
      WHERE company_id = ${id}
        OR (${legacyDealId ?? ""} <> '' AND deal_id = ${legacyDealId ?? ""})
      ORDER BY created_at DESC
      LIMIT 50`;
    const documents = docRows.map((r) => {
      const d = r as Record<string, unknown>;
      return {
        id: str(d.id),
        name: str(d.name),
        mime: str(d.mime),
        sizeBytes: num(d.size_bytes),
        storageUrl: str(d.storage_url),
        companyId: d.company_id ? str(d.company_id) : null,
        dealId: d.deal_id ? str(d.deal_id) : null,
        createdAt: isoOrNull(d.created_at) ?? "",
        at: isoOrNull(d.created_at) ?? "",
      };
    });

    logUsage("company_detail", 1 + participants.length + timeline.length, 0);
    return { company, participants, timeline, linked: { deals, tasks, documents } };
  });
}

/* -------------------------------- Jobs -------------------------------- */

export async function listJobsSvc(
  status?: string,
  limit = 50
): Promise<JobRow[]> {
  return listJobs(status, limit);
}

export async function retryJobSvc(id: string): Promise<boolean> {
  return retryJob(id);
}

export async function runJobSvc(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  return runJobNow(id);
}

/* ----------------------------- Duplicates ----------------------------- */

export async function listDuplicates(kind: string): Promise<DuplicatePair[]> {
  return findDuplicates(kind);
}

export async function mergeDuplicates(
  kind: string,
  keepId: string,
  mergeId: string,
  actor = ""
): Promise<{ ok: boolean; error?: string }> {
  return merge(kind, keepId, mergeId, actor);
}

/* ---------------------------- Integrations ---------------------------- */

export async function getIntegrations(): Promise<IntegrationStatus[]> {
  const out: IntegrationStatus[] = [];
  const db = sql();

  // Neon itself: if this query runs, the DB is reachable.
  try {
    await db`SELECT 1 AS one`;
    out.push({
      key: "neon",
      name: "Neon Postgres",
      status: "ok",
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      detail: "Database reachable",
    });
  } catch (err) {
    out.push({
      key: "neon",
      name: "Neon Postgres",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Database query failed",
    });
  }

  // Market Intel sync log: latest row per job + last success per job.
  try {
    const latest = await db`
      SELECT DISTINCT ON (job) job, status, message, ran_at
      FROM mi_sync_log
      ORDER BY job, ran_at DESC
      LIMIT 25`;
    const lastOk = await db`
      SELECT job, max(ran_at) AS last_ok FROM mi_sync_log
      WHERE status = 'ok' GROUP BY job`;
    const okByJob = new Map<string, string | null>();
    for (const r of lastOk) {
      const rec = r as Record<string, unknown>;
      okByJob.set(str(rec.job), isoOrNull(rec.last_ok));
    }
    for (const r of latest) {
      const rec = r as Record<string, unknown>;
      const job = str(rec.job);
      const status = str(rec.status);
      out.push({
        key: `mi:${job}`,
        name: `Market Intel · ${job}`,
        status: status === "ok" ? "ok" : "error",
        lastSuccessAt: okByJob.get(job) ?? null,
        lastError: status === "ok" ? null : str(rec.message) || status,
        detail: `Last run ${isoOrNull(rec.ran_at) ?? "unknown"} — ${status}`,
      });
    }
    if (!latest.length) {
      out.push({
        key: "mi",
        name: "Market Intel",
        status: "unknown",
        lastSuccessAt: null,
        lastError: null,
        detail: "No sync runs recorded yet",
      });
    }
  } catch (err) {
    out.push({
      key: "mi",
      name: "Market Intel",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Could not read mi_sync_log",
    });
  }

  // Microsoft Graph calendar mirror (tokens + state live in ms_state).
  try {
    const stateRows = await db`SELECT key FROM ms_state LIMIT 25`;
    const eventRows = await db`
      SELECT count(*)::int AS n FROM calendar_events`;
    const n = eventRows.length ? num(eventRows[0].n) : 0;
    out.push({
      key: "microsoft_calendar",
      name: "Microsoft Calendar (Graph)",
      status: stateRows.length ? "ok" : "unknown",
      lastSuccessAt: null,
      lastError: null,
      detail: stateRows.length
        ? `Connected — ${n} mirrored events`
        : "No Graph state recorded (not connected or never synced)",
    });
  } catch (err) {
    out.push({
      key: "microsoft_calendar",
      name: "Microsoft Calendar (Graph)",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Could not read calendar mirror state",
    });
  }

  // Web push: latest delivery attempt.
  try {
    const rows = await db`
      SELECT status, error, created_at FROM push_log
      ORDER BY created_at DESC LIMIT 1`;
    if (rows.length) {
      const rec = rows[0] as Record<string, unknown>;
      const status = str(rec.status);
      out.push({
        key: "push",
        name: "Web Push",
        status: status === "sent" ? "ok" : status === "failed" ? "error" : "ok",
        lastSuccessAt: status === "sent" ? isoOrNull(rec.created_at) : null,
        lastError: status === "failed" ? str(rec.error) || "delivery failed" : null,
        detail: `Last push ${isoOrNull(rec.created_at) ?? "unknown"} — ${status}`,
      });
    } else {
      out.push({
        key: "push",
        name: "Web Push",
        status: "unknown",
        lastSuccessAt: null,
        lastError: null,
        detail: "No pushes logged yet",
      });
    }
  } catch (err) {
    out.push({
      key: "push",
      name: "Web Push",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Could not read push_log",
    });
  }

  // Document storage (Phase 3): the interim provider status, plus the
  // SharePoint state — setup_required until Ethan consents to the
  // Graph Files/Sites scopes (a REAL DECISION; never self-service).
  try {
    const { getStorageStatus, sharepointProvider } = await import(
      "../storage"
    );
    const active = await getStorageStatus();
    out.push({
      key: "document_storage",
      name: "Document Storage",
      status: active.configured ? "ok" : "error",
      lastSuccessAt: null,
      lastError: active.configured ? null : active.detail,
      detail: `Provider: ${active.provider} — ${active.detail}`,
    });
    const sp = await sharepointProvider.status();
    out.push({
      key: "microsoft_sharepoint",
      name: "Microsoft SharePoint (Data Rooms)",
      status: sp.setupRequired ? "unknown" : "ok",
      lastSuccessAt: null,
      lastError: null,
      detail: sp.detail,
    });
  } catch (err) {
    out.push({
      key: "document_storage",
      name: "Document Storage",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Could not read storage provider status",
    });
  }

  // Document intelligence (Part 5B): Azure AI Document Intelligence
  // is the contract-extraction provider when its env vars are set —
  // Microsoft does not train models on customer documents. Until
  // then, extraction runs on the built-in local pattern provider and
  // this entry reports the Azure state honestly as setup-required.
  try {
    const { getDocintStatus, AZURE_NO_TRAINING_DETAIL } = await import(
      "../docint/provider"
    );
    const st = await getDocintStatus();
    out.push({
      key: "azure_docint",
      name: "Document Intelligence (Azure AI)",
      status: st.azure.configured ? "ok" : "unknown",
      lastSuccessAt: null,
      lastError: null,
      detail: st.azure.configured
        ? `Configured — uploaded documents extract via Azure automatically for supported media types; types Azure rejects (plain text, CSV) fall back to local pattern extraction for that run. Azure is never called by automated data collection. ${AZURE_NO_TRAINING_DETAIL}`
        : `Setup required: ${st.azure.detail} Active provider meanwhile: ${st.activeProvider} (local pattern extraction over extracted document text). ${AZURE_NO_TRAINING_DETAIL}`,
    });
  } catch (err) {
    out.push({
      key: "azure_docint",
      name: "Document Intelligence (Azure AI)",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Could not read document-intelligence provider status",
    });
  }

  // Accounting integrations (Phase 9): framework only — no live
  // connections exist yet. Status follows the house convention for
  // setup-gated integrations (cf. microsoft_sharepoint / azure_docint
  // above): 'ok' only when every provider env var is present (config
  // present still does NOT mean a company is connected — per-company
  // connection state lives in portmgmt.acct_connections), otherwise
  // 'unknown' with the setup summary in the detail.
  try {
    const { PROVIDERS, missingConfig } = await import(
      "../portmgmt/accounting"
    );
    for (const provider of Object.values(PROVIDERS)) {
      const missing = missingConfig(provider.key);
      out.push({
        key: `accounting:${provider.key}`,
        name: `Accounting · ${provider.name}`,
        status: missing.length ? "unknown" : "ok",
        lastSuccessAt: null,
        lastError: null,
        detail: missing.length
          ? `Setup required: missing env vars ${missing.join(", ")}. ${provider.setupSteps[0]}`
          : `Configured (${provider.envVars.join(", ")} present) — per-company connections are managed from each company's Accounting tab; no live sync has run yet.`,
      });
    }
  } catch (err) {
    out.push({
      key: "accounting",
      name: "Accounting Integrations",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Could not read accounting provider catalog",
    });
  }

  // Passkeys (WebAuthn credentials count).
  try {
    const rows = await db`
      SELECT count(*)::int AS n FROM webauthn_credentials`;
    const n = rows.length ? num(rows[0].n) : 0;
    out.push({
      key: "webauthn",
      name: "Passkeys (WebAuthn)",
      status: "ok",
      lastSuccessAt: null,
      lastError: null,
      detail: `${n} credential${n === 1 ? "" : "s"} registered`,
    });
  } catch (err) {
    out.push({
      key: "webauthn",
      name: "Passkeys (WebAuthn)",
      status: "error",
      lastSuccessAt: null,
      lastError: err instanceof Error ? err.message : String(err),
      detail: "Could not read webauthn_credentials",
    });
  }

  logUsage("integrations", out.length, JSON.stringify(out).length);
  return out;
}

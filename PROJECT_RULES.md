# Canny Capital platform: standing rules

CONTEXT
The existing Canny Capital portal (CRM) is being restructured into a multi-module deal and portfolio platform. Keep ALL existing CRM functionality and data intact: restructure and extend, do not rebuild. Times are Arizona time (no DST).

MODULES (built in phases I will send one at a time)
Overview, Calendar, Business Development (the existing CRM), Due Diligence, Value Creation, Data Rooms, Investors & Capital, Portfolio Monitoring, Directory, Settings.

ARCHITECTURE PRINCIPLES
- Company is the central entity. Everything else links to it by ID. Every fact is stored once and referenced by ID elsewhere. No duplicated company, contact, or financial data across modules.
- Internal event system: key actions publish events (financials_posted, deal_stage_changed, deal_closed, document_uploaded, covenant_breached, reporting_received, initiative_updated, investor_commitment_changed, contact_updated). Handlers update everything that depends on them in the same transaction or an immediate background job. Never poll to detect changes.
- Summary tables or materialized views power the Overview, portfolio rollups, and charts, updated from events. Never recompute from raw data on page load.
- Invalidate only affected cache keys when an event fires.
- Every record shows "last updated" and its source (manual, upload, sync), with a per-record activity log. Soft delete with restore, audit trail on edits, daily automated database backups.

SECURITY
- Role-based access (admin, internal team, external guest limited to specific data rooms). MFA for internal users. Log access to sensitive records and financial data. Encrypt in transit and at rest. Keep client financial data out of logs.
- Never store credentials in code or in chat. Read secrets from environment variables, and give me setup steps when a new integration needs them.

DESIGN AND IMAGERY
- One shared design system: consistent components, spacing (8px grid), typography (serif headlines, clean sans for body and data), navy/charcoal/ivory palette with one accent color, soft shadows, dark mode option, loading skeletons, helpful empty states, clear errors.
- Real-world imagery: company logos, hero banners, and photo galleries uploaded by me; curated licensed stock fallbacks matched to vertical (never fake team photos or AI-generated images of real businesses); map/aerial imagery per location following provider terms. Consistent aspect ratios, subtle overlays, rounded corners.
- Images live in object storage or SharePoint behind a CDN, never in the database. Serve WebP, responsive sizes, lazy loading, blur-up placeholders. Cap upload size, auto-resize, strip location metadata before external sharing.
- One charting library throughout. Charts support tooltips, drill-down (chart > line items > source document), export, and load from pre-aggregated summaries only.
- Every entity name is a clickable link, with hover preview cards, breadcrumbs, and a "linked records" panel on every record.

DATA TRANSFER EFFICIENCY (we hit our Neon 5 GB limit)
All pulls are incremental (only fetch and write new or changed records).
- Email sync: every 15 min Mon-Fri 7am-7pm, hourly otherwise; use provider push/webhooks if supported.
- Calendar sync: Microsoft Graph change notifications or delta queries; if polling, every 30 min Mon-Fri 7am-7pm and hourly otherwise, plus refresh on app open if data is older than 15 min.
- News & Intelligence: twice daily on weekdays (6am, 4pm), once daily on weekends (8am).
- Arizona Corporation Commission fit sourcing: nightly 2am. Maricopa permit data: weekly, Sunday 3am. Watchlist checks and market events: daily 5am.
- Fit enrichment: once per new record only.
- Data room access logs: on demand, cached 15 min.
- Reminders and push notifications: scheduled at due time when created or edited, no scanning loops.
- Frontend: fetch on screen open and pull-to-refresh only, stale time 5-10 min, no refetch on focus/reconnect, no interval polling.
Query rules for every screen:
1. SELECT only columns rendered; no SELECT *. Never return large fields (raw scraped HTML, email bodies, BPMN XML, parsed documents) in list or card views.
2. Paginate everything (25-50 rows max).
3. Filter, sort, aggregate, and dedup in SQL.
4. Cache read-heavy data server-side 5-15 min with HTTP cache headers.
5. Files and images never go in the database.
6. Fix N+1 queries with joins or batched queries.
Put every sync interval in one config file. Show "last synced" per source with manual "Refresh now" for email, news, and calendar. Keep a lightweight usage log (query name, rows returned, approx bytes) for heavy endpoints.

WORKING AGREEMENTS
- Build only the phase I send. Do not start later modules.
- After each phase: summarize what was built, report estimated monthly data transfer and top offenders, then pause for my confirmation.
- Maintain a "Build log" section at the bottom of this file listing completed phases, tables, events, shared components, and integration status, so later phases reuse them instead of recreating them.

MOBILE AND APP REQUIREMENTS
- Build the platform as a mobile-first, responsive Progressive Web App (installable, home-screen icon, service worker, web push notifications, camera and photo upload, biometric/passkey login where supported). Keep the API cleanly separated so a native app wrapper can be added later without rewriting the backend.
- Every screen must work at 375px width. Touch targets at least 44px, no hover-only interactions, safe-area insets respected, bottom tab bar for the top 5 sections on mobile with the rest in the drawer.
- Tables collapse to cards on small screens. Charts have simplified mobile variants (fewer labels, swipeable between views, tap for tooltips), and drill-downs open full-screen.
- Mobile-priority workflows: Overview, Calendar, tasks, alerts and approvals, comments, document preview, quick capture of notes and photos (site visits, meetings), and data room access for guests.
- Offline support for site visit notes, photos, and task updates: queue locally and sync when back online with conflict handling. All other data is read from cache when offline, with a clear offline banner.
- Mobile efficiency: smaller payloads, image sizes matched to screen width, no background polling, push notifications instead of refresh loops.
- Test every phase on mobile before reporting it complete.

MODULE BOUNDARIES
- Build as a modular monolith. Each module (Business Development, Due Diligence, Value Creation, Investors & Capital, Portfolio Monitoring, Data Rooms) owns its own tables, grouped in a separate database schema, and exposes its data to other modules only through internal service functions or events, never through direct cross-module queries.
- Portfolio Monitoring is the longest-lived module and must be separable. It receives data from the rest of the platform only through the deal_closed handoff (a copied baseline of company record, financials, value creation plan targets, and participants) and through shared reference data (company ID, people, organizations). Design its schema so it can be moved to its own database later with only configuration and migration work.
- Plan for years of monthly data per company: partition or index monitoring tables by company and period, and archive raw uploads to storage rather than keeping them in the database.

BUILD LOG
- Phase 1 — Platform foundation (built Oct 21, 2026; DB-backed behavior pending first run after the Neon outage — schema/backfill execute server-side via ensurePlatform() on first platform API call):
  - Tables (Postgres schema `core`): migration_state, companies, organizations, people, deals (link/projection to legacy deals), deal_participants, comments, documents (metadata only), activity_log, events, jobs, overview_summary, company_cards, usage_log, audit_log, user_roles. Legacy public-schema CRM tables untouched and still canonical for the existing CRM UI.
  - Migration: idempotent one-time backfill (marker phase1-backfill-v1), SQL-side INSERT...SELECT: deals→companies+deal links, executives→people (operator), investors→organizations+people (investor), contacts→people, deal operator_ids→deal_participants, attachments→documents (metadata only; file bytes never copied), activity→activity_log, mi_companies fits (status='fit', non-chain, non-institutional)→companies.
  - Events registered: financials_posted, deal_stage_changed, deal_closed, document_uploaded, covenant_breached, reporting_received, initiative_updated, investor_commitment_changed, contact_updated (lib/platform/events.ts). Built-in handlers invalidate targeted cache keys and enqueue a unique refresh_overview_summary job; publish never throws.
  - Jobs: core.jobs queue with list/retry/run APIs and a Settings status panel; builtin daily db_backup job registered (actual snapshot mechanism is Neon point-in-time restore; the job writes an audit entry).
  - Summaries: lib/platform/summaries.ts rebuilds core.overview_summary + core.company_cards from events/jobs only; Overview reads summaries, never raw tables. RAG on portfolio companies is a Phase 1 activity-recency heuristic (<14d green, <30d amber, else red) until Phase 8 KPIs exist.
  - Platform APIs (/api/platform/*): overview, companies (list + detail), search (Postgres FTS across companies/people/documents/tasks/notes), jobs, integrations, duplicates (detect + merge for companies and people). All auth-gated, paginated ≤50, selected columns only, Cache-Control private max-age=300 on read-heavy GETs; usage logged to core.usage_log.
  - Roles: core.user_roles + lib/platform/permissions.ts (admin/internal/guest; domain default internal; ethan = admin). MFA builds on the existing passkey/WebAuthn system. Soft delete (deleted_at) + audit_log on merges/edits.
  - Shared components: Sidebar + AppShell (desktop sidebar, mobile drawer, per-device collapsed state), GlobalSearch (Cmd/Ctrl+K), EntityBits (EntityLink with hover preview, Breadcrumbs, LinkedRecords), ComingSoon, PlatformOverview, CompanyCards, IntegrationStatus, JobQueuePanel, DuplicatesPanel; ui.tsx extended with Skeleton, CardSkeleton, ErrorState, DataTable/SortableTable, SavedViewChips, BulkActionBar, Kbd, WidgetCard.
  - Navigation: sidebar order Overview, Calendar, Business Development, Due Diligence, Value Creation, Data Rooms, Investors & Capital, Portfolio Monitoring, Directory, Settings. Existing CRM lives under Business Development (/business-development hub links the unchanged routes); unbuilt modules are coming-soon pages. Company profiles at /companies/[id].
  - Sync intervals centralized in lib/platform/config.ts (SYNC_INTERVALS) per the data-transfer rules.
  - Integration status: Microsoft Graph calendar (connected), Neon Postgres, Web Push, WebAuthn — surfaced live in Settings → Integrations from sync logs.
  - Addendum (Oct 21, 2026): the backfill is re-runnable by design — an hourly idempotent top-up (marker phase1-backfill-topup) re-runs the INSERT…SELECT statements so rows created in legacy tables after the first backfill (e.g. the outage-recovery import) are picked up, deal stage mirrors upsert on conflict, and soft-delete propagates when a stable legacy source row is deleted (mi_companies-sourced companies excluded — spine rebuilds re-key those rows).
  - Cadence (Ethan, Oct 21, 2026): phases run consecutively — stop only for real decisions (integration credentials, new Microsoft/Entra permissions, provider keys). Each phase still delivers its summary + estimated data transfer report in chat and updates this Build log.
- Phase 2 — Directory, Calendar framework, Collaboration (built Oct 21, 2026; live-verified against the production database the same day):
  - Tables: Postgres schema `directory` (type_tags, email_templates, email_links) layered on core.people/core.organizations; schema `calgen` (generated_events); core.notifications. All created idempotently server-side (ensureDirectory / calgen schema guard / ensureNotificationsSchema).
  - Directory (lib/directory/*, APIs /api/platform/directory/*): one record system for people + organizations. Type taxonomy: operator, investor, lp, lender, broker, attorney, accountant, advisor, seller, portfolio_contact, contact (directory.type_tags, backfilled from core kinds; tag add/remove API). Detail = full core record + types + linked deals via core.deal_participants, plus legacy investor fields for investor people. Create/update write core.people/core.organizations, audit-logged, publish contact_updated. Global search extended to organizations. The unified /directory page replaces the legacy tabs; deep links /directory?q=<name> preserved.
  - CSV import with column-mapping UI and per-row duplicate detection (people: normalized name OR email; organizations: normalized name; duplicates skipped and reported, force flag supported for people), Excel + CSV export honoring current filters (1000-row cap).
  - Email templates (CRUD) and email links (manual linking of email references to a person/organization/company). Templates compose via mailto/copy only — the Microsoft token has NO Mail scope, so there is no Graph sending or inbox sync (see Real decisions in the Phase 2 checkpoint).
  - Calendar: existing Graph plumbing unchanged (webhook + watchdog; cadences in lib/platform/config.ts). /calendar gains month/week/agenda views; merged read API GET /api/calendar/platform-events serves Outlook events + generated events with color-coded, toggleable layers (by type and by deal) and click-through hrefs to source records. Auto-generated events framework (lib/calgen/*): a source registry — tasks/follow-ups wired live; milestone, deadline, reporting, covenant, capital_call, closing, meeting, dataroom registered as stubs for later phases; recurrence monthly/quarterly expanded on read; refresh via core.jobs kind refresh_generated_events (enqueued on task create/update/delete) plus a 15-minute freshness regeneration on read. Generated events create NO new notification path (single-notification ownership preserved).
  - Entra ID setup documentation lives in Settings → Integrations (components/EntraSetup.tsx): app registration steps, redirect URI https://portal.cannycapitalpartners.com/api/calendar/microsoft/callback, permissions as currently consented (User.Read, Calendars.ReadWrite, offline_access), env vars MS_CLIENT_ID / MS_CLIENT_SECRET. No permission changes were made.
  - Collaboration (lib/platform/collab.ts; components Comments, ActivityFeed, NotificationCenter, UnifiedTasks): comments with @mentions on ANY record via core.comments (mentionables = the three partners + directory people; a mention notification is written only for a mentioned partner with a known login email — today only Ethan; no email addresses were invented for Ronan/Ian); activity feed on core.activity_log; ONE notification center in AppShell merging core.notifications with the pre-existing unread Activity (deal_flow) stream — no duplicate notification paths, no web push for mentions; unified tasks read model over the existing tasks/follow-ups system (assignee, due, linked record, on-calendar), mounted on the Business Development hub, and dated tasks surface on the Calendar through calgen.
  - Data repair (Phase 1 defect found by Phase 2 verification): core.normalize_name() originally shipped with its whitespace-collapse pattern as 's+' instead of '\s+' (the backslash was eaten by the JS template literal in lib/platform/db.ts), corrupting every backfilled normalized_name containing the letter "s". The function was rewritten backslash-free to mirror the TS normalizeName(), and a one-time marker-guarded repair (phase2-normalized-repair-v4 in lib/platform/migrate.ts) recomputed normalized_name on core.people/companies/organizations, merged organization collisions deterministically (keeper = most linked people, then oldest), and tombstoned soft-deleted orgs' normalized values ('deleted:<id>') because the organizations unique index is not partial. Verified live: directory import dedupe now matches for people and organizations, including names containing "s".

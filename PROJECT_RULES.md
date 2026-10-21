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

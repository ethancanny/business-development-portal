/**
 * Phase 2 — Microsoft Entra ID setup reference (Settings card).
 *
 * Documents the EXISTING app registration Ethan created on Oct 9, 2026
 * and the exact configuration lib/microsoft.ts expects. Static
 * guidance only — no credentials, no values, no scope changes. If any
 * step here ever disagrees with lib/microsoft.ts, the code wins.
 */

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "1 · App registration (already done)",
    body: (
      <>
        Entra ID → <strong>App registrations</strong> → the Canny Capital
        portal app Ethan registered on <strong>Oct 9, 2026</strong>. The
        portal reads its client ID and secret from Vercel environment
        variables at runtime — nothing is stored in code or in this page.
        If the app is ever re-registered, update those env vars and
        redeploy; no code change is needed.
      </>
    ),
  },
  {
    title: "2 · API permissions — calendar only",
    body: (
      <>
        Microsoft Graph, <strong>delegated</strong> permissions, exactly
        these three: <code>Calendars.ReadWrite</code>,{" "}
        <code>offline_access</code>, and <code>User.Read</code> (the
        sign-in profile the code requests alongside them).{" "}
        <strong>No Mail scopes</strong> — do not add{" "}
        <code>Mail.Read</code>, <code>Mail.Send</code> or any other mail
        permission. Mail features use manual linking until Ethan
        explicitly approves a scope change and a fresh consent.
      </>
    ),
  },
  {
    title: "3 · Redirect URI",
    body: (
      <>
        Under <strong>Authentication → Web</strong>, the redirect URI must
        be exactly:
        <span className="mt-1.5 block break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-[#0d1f3c] dark:bg-white/[0.04] dark:text-white">
          https://portal.cannycapitalpartners.com/api/calendar/microsoft/callback
        </span>
        This is the <code>MS_REDIRECT_URI</code> constant in{" "}
        <code>lib/microsoft.ts</code> — the value the OAuth authorize and
        token requests actually send. A mismatch here is the most common
        cause of a failed Connect.
      </>
    ),
  },
  {
    title: "4 · Credentials — Vercel env vars only",
    body: (
      <>
        The code reads exactly two Microsoft env vars (names only — never
        paste values into chat, code, or this portal):
        <span className="mt-1.5 block rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-[#0d1f3c] dark:bg-white/[0.04] dark:text-white">
          MS_CLIENT_ID
          <br />
          MS_CLIENT_SECRET
        </span>
        Tokens themselves are stored server-side in Neon (
        <code>ms_tokens</code>), never in the browser. Rotate the client
        secret in Entra, update <code>MS_CLIENT_SECRET</code> in Vercel,
        redeploy, and reconnect from the Calendar page if sign-in breaks.
      </>
    ),
  },
  {
    title: "5 · Webhook subscription + watchdog renewal",
    body: (
      <>
        On connect, the portal creates a Graph change-notification
        subscription on <code>/me/events</code> (created / updated /
        deleted) pointing at{" "}
        <code>/api/calendar/microsoft/webhook</code>, with a{" "}
        <code>clientState</code> secret verified on every notification.
        Graph caps event subscriptions at ~4,230 minutes (~2.9 days), so{" "}
        <code>ensureSubscription()</code> in <code>lib/microsoft.ts</code>{" "}
        recreates the subscription whenever the stored expiry is within
        12 hours, deleting the old one — a watchdog keeps this alive, so
        no manual renewal is needed while the connection is active.
        Cadence (lib/platform/config.ts): Graph change notifications /
        delta first; polling fallback 30 min in business hours, hourly
        otherwise; refresh on open if data is older than 15 minutes.
      </>
    ),
  },
];

export default function EntraSetup() {
  return (
    <div className="space-y-4">
      {STEPS.map((s) => (
        <div key={s.title}>
          <h3 className="text-sm font-bold text-[#0d1f3c] dark:text-white">
            {s.title}
          </h3>
          <div className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-white/70">
            {s.body}
          </div>
        </div>
      ))}
      <p className="rounded-lg border border-[#b8975a]/40 bg-[#b8975a]/10 px-3 py-2 text-xs text-[#8a6f3e] dark:text-[#d4b37a]">
        Changing scopes requires a new admin/user consent in Entra and is
        Ethan&apos;s call — this card documents the current, approved
        configuration only.
      </p>
    </div>
  );
}

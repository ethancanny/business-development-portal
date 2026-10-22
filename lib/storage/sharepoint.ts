import {
  StorageSetupRequiredError,
  type StorageProvider,
  type StorageStatus,
} from "./types";

/**
 * SharePoint / Microsoft Graph storage provider (Phase 3) — STUB by
 * design. The portal's Graph token today holds ONLY User.Read +
 * Calendars.ReadWrite + offline_access (see the SCOPES constant in
 * lib/microsoft.ts). No Files/Sites scopes have been consented, and
 * consent is ETHAN'S decision: this provider therefore reports a clean
 * "setup required" state and refuses every operation with a typed
 * error the API layer translates into that same state. It NEVER
 * attempts a token exchange, re-consent, or scope change.
 *
 * Once Ethan completes the Entra setup (steps in SHAREPOINT_SETUP_STEPS
 * and the Phase 3 report), this file is where the Graph drive-items
 * implementation lands — callers do not change.
 */

export const SHAREPOINT_MISSING_SCOPES = [
  "Files.ReadWrite.All",
  "Sites.ReadWrite.All",
] as const;

export const SHAREPOINT_SETUP_STEPS: string[] = [
  "Entra admin center (entra.microsoft.com) → Identity → Applications → App registrations → open the existing portal app (the same one used for Calendar; client id is the MS_CLIENT_ID env var).",
  "API permissions → Add a permission → Microsoft Graph → Delegated permissions → add Files.ReadWrite.All and Sites.ReadWrite.All (keep the existing User.Read, Calendars.ReadWrite, offline_access).",
  "Grant admin consent for the tenant on the new permissions.",
  "Decide the site layout (recommended: ONE SharePoint site, e.g. \"Canny Capital — Deals\", with one document library per data room created by the app; alternative: one site per deal for hard isolation).",
  "Sign out of the portal's Microsoft connection and reconnect (Settings → Integrations → Microsoft) so the refreshed token carries the new scopes; no redirect URI change is needed — the existing https://portal.cannycapitalpartners.com/api/calendar/microsoft/callback stays.",
  "Tell Muse the layout choice; the SharePoint driver then replaces the interim local provider behind the storage interface (env STORAGE_PROVIDER=sharepoint), with no data-model or UI changes.",
];

function setupError(): StorageSetupRequiredError {
  return new StorageSetupRequiredError(
    "SharePoint storage is not set up: the Microsoft Graph token has no " +
      "Files/Sites scopes. Ethan must add the delegated permissions in " +
      "Entra and re-consent (see Settings → Integrations).",
    [...SHAREPOINT_MISSING_SCOPES]
  );
}

export const sharepointProvider: StorageProvider = {
  name: "sharepoint",

  async status(): Promise<StorageStatus> {
    return {
      provider: "sharepoint",
      configured: false,
      setupRequired: true,
      missingScopes: [...SHAREPOINT_MISSING_SCOPES],
      detail:
        "Setup required — the Graph app registration has no Files/Sites " +
        "permissions (current scopes: User.Read, Calendars.ReadWrite, " +
        "offline_access). Ethan's Entra setup + re-consent is required; " +
        "the interim local provider serves file bytes until then.",
    };
  },

  async put() {
    throw setupError();
  },
  async get() {
    throw setupError();
  },
  async delete() {
    throw setupError();
  },
  async exists() {
    throw setupError();
  },
  async beginUpload() {
    throw setupError();
  },
  async appendChunk() {
    throw setupError();
  },
  async uploadSize() {
    throw setupError();
  },
  async finalizeUpload() {
    throw setupError();
  },
  async abortUpload() {
    throw setupError();
  },
};

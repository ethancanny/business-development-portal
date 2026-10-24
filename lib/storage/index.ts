import { localProvider } from "./local";
import { sharepointProvider } from "./sharepoint";
import type { StorageProvider, StorageStatus } from "./types";

export * from "./types";
export {
  SHAREPOINT_MISSING_SCOPES,
  SHAREPOINT_SETUP_STEPS,
  sharepointProvider,
} from "./sharepoint";
export { localProvider } from "./local";

/**
 * Active storage provider selection. Default is the interim `local`
 * provider; set env STORAGE_PROVIDER=sharepoint only AFTER the Entra
 * Files/Sites consent is granted AND the portal has been reconnected
 * AND the library is provisioned (Settings → Integrations). The
 * SharePoint driver (lib/storage/sharepoint.ts) probes honestly and
 * reports setup-required until all three hold.
 */
export function getStorageProvider(): StorageProvider {
  const choice = (process.env.STORAGE_PROVIDER ?? "local").trim().toLowerCase();
  return choice === "sharepoint" ? sharepointProvider : localProvider;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  return getStorageProvider().status();
}

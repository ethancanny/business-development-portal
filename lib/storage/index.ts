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
 * provider; set env STORAGE_PROVIDER=sharepoint only AFTER Ethan has
 * completed the Entra Files/Sites consent (the sharepoint provider
 * reports setup-required — and refuses operations — until the Graph
 * driver is implemented on top of the consented scopes).
 */
export function getStorageProvider(): StorageProvider {
  const choice = (process.env.STORAGE_PROVIDER ?? "local").trim().toLowerCase();
  return choice === "sharepoint" ? sharepointProvider : localProvider;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  return getStorageProvider().status();
}

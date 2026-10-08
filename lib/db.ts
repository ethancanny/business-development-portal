import * as jsonDb from "./db-json";
import * as pgDb from "./db-postgres";
import type { ActivityEvent } from "./types";

/**
 * Storage router: Postgres (Neon) when DATABASE_URL is set, otherwise the
 * local JSON files. Same function signatures either way, so API routes are
 * untouched.
 */
const usePostgres = () => Boolean(process.env.DATABASE_URL);

export function newId(): string {
  return jsonDb.newId();
}

// --- Deals ---
export const getDeals: typeof jsonDb.getDeals = () =>
  usePostgres() ? pgDb.getDeals() : jsonDb.getDeals();
export const saveDeals: typeof jsonDb.saveDeals = (deals) =>
  usePostgres() ? pgDb.saveDeals(deals) : jsonDb.saveDeals(deals);

// --- Executives ---
export const getExecutives: typeof jsonDb.getExecutives = () =>
  usePostgres() ? pgDb.getExecutives() : jsonDb.getExecutives();
export const saveExecutives: typeof jsonDb.saveExecutives = (execs) =>
  usePostgres()
    ? pgDb.saveExecutives(execs)
    : jsonDb.saveExecutives(execs);

// --- Tasks ---
export const getTasks: typeof jsonDb.getTasks = () =>
  usePostgres() ? pgDb.getTasks() : jsonDb.getTasks();
export const saveTasks: typeof jsonDb.saveTasks = (tasks) =>
  usePostgres() ? pgDb.saveTasks(tasks) : jsonDb.saveTasks(tasks);

// --- Activity ---
export const getActivity: typeof jsonDb.getActivity = () =>
  usePostgres() ? pgDb.getActivity() : jsonDb.getActivity();
export const logActivity = (
  event: Omit<ActivityEvent, "id" | "createdAt">
): Promise<void> =>
  usePostgres() ? pgDb.logActivity(event) : jsonDb.logActivity(event);

// --- Contacts ---
export const getContacts: typeof jsonDb.getContacts = () =>
  usePostgres() ? pgDb.getContacts() : jsonDb.getContacts();
export const saveContacts: typeof jsonDb.saveContacts = (c) =>
  usePostgres() ? pgDb.saveContacts(c) : jsonDb.saveContacts(c);

// --- Interactions ---
export const getInteractions: typeof jsonDb.getInteractions = () =>
  usePostgres() ? pgDb.getInteractions() : jsonDb.getInteractions();
export const saveInteractions: typeof jsonDb.saveInteractions = (i) =>
  usePostgres() ? pgDb.saveInteractions(i) : jsonDb.saveInteractions(i);

// --- Attachments ---
export const getAttachments: typeof jsonDb.getAttachments = () =>
  usePostgres() ? pgDb.getAttachments() : jsonDb.getAttachments();
export const saveAttachments: typeof jsonDb.saveAttachments = (a) =>
  usePostgres() ? pgDb.saveAttachments(a) : jsonDb.saveAttachments(a);

// --- Deal flow ---
export const getDealFlow: typeof jsonDb.getDealFlow = () =>
  usePostgres() ? pgDb.getDealFlow() : jsonDb.getDealFlow();
export const saveDealFlow: typeof jsonDb.saveDealFlow = (f) =>
  usePostgres() ? pgDb.saveDealFlow(f) : jsonDb.saveDealFlow(f);

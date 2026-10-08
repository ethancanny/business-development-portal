import { promises as fs } from "fs";
import path from "path";
import type {
  ActivityEvent,
  Attachment,
  Contact,
  Deal,
  DealFlowItem,
  Executive,
  Interaction,
  Task,
} from "./types";

const dataDir = path.join(process.cwd(), "data");
const dealsFile = path.join(dataDir, "deals.json");
const executivesFile = path.join(dataDir, "executives.json");
const tasksFile = path.join(dataDir, "tasks.json");
const activityFile = path.join(dataDir, "activity.json");
const contactsFile = path.join(dataDir, "contacts.json");
const interactionsFile = path.join(dataDir, "interactions.json");
const attachmentsFile = path.join(dataDir, "attachments.json");
const dealFlowFile = path.join(dataDir, "deal-flow.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Deals ---
export const getDeals = async (): Promise<Deal[]> => {
  const deals = await readJson<Deal[]>(dealsFile, []);
  // Backfill newer fields for records written before they existed.
  return deals.map((d) => ({
    ...d,
    city: d.city ?? "",
    lat: d.lat ?? null,
    lng: d.lng ?? null,
    links: Array.isArray(d.links) ? d.links : [],
    operatorIds: Array.isArray(d.operatorIds) ? d.operatorIds : [],
    revenue: d.revenue ?? null,
    ebitda: d.ebitda ?? null,
    askingPrice: d.askingPrice ?? null,
    broker: d.broker ?? "",
    source: d.source ?? "",
  }));
};
export const saveDeals = (deals: Deal[]) => writeJson(dealsFile, deals);

// --- Executives ---
export const getExecutives = async (): Promise<Executive[]> => {
  const execs = await readJson<Executive[]>(executivesFile, []);
  return execs.map((e) => ({
    ...e,
    industries: Array.isArray(e.industries) ? e.industries : [],
  }));
};
export const saveExecutives = (execs: Executive[]) =>
  writeJson(executivesFile, execs);

// --- Tasks ---
export const getTasks = () => readJson<Task[]>(tasksFile, []);
export const saveTasks = (tasks: Task[]) => writeJson(tasksFile, tasks);

// --- Activity ---
const ACTIVITY_CAP = 500;
export const getActivity = () => readJson<ActivityEvent[]>(activityFile, []);

export async function logActivity(
  event: Omit<ActivityEvent, "id" | "createdAt">
): Promise<void> {
  const events = await getActivity();
  events.unshift({
    ...event,
    id: newId(),
    createdAt: new Date().toISOString(),
  });
  await writeJson(activityFile, events.slice(0, ACTIVITY_CAP));
}

// --- Contacts ---
export const getContacts = () => readJson<Contact[]>(contactsFile, []);
export const saveContacts = (c: Contact[]) => writeJson(contactsFile, c);

// --- Interactions ---
export const getInteractions = () =>
  readJson<Interaction[]>(interactionsFile, []);
export const saveInteractions = (i: Interaction[]) =>
  writeJson(interactionsFile, i);

// --- Attachments ---
export const getAttachments = () =>
  readJson<Attachment[]>(attachmentsFile, []);
export const saveAttachments = (a: Attachment[]) =>
  writeJson(attachmentsFile, a);

// --- Deal flow ---
export const getDealFlow = () =>
  readJson<DealFlowItem[]>(dealFlowFile, []);
export const saveDealFlow = (f: DealFlowItem[]) => writeJson(dealFlowFile, f);

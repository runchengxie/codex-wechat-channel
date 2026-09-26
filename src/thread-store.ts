import { object, string, type ThreadSettings } from "./protocol.js";

export interface SavedThread {
  threadId: string;
  name: string | null;
  cwd: string | null;
}

export interface ThreadRecord extends ThreadSettings {
  threadId?: string;
  name?: string | null;
  history?: SavedThread[];
  conversationKey?: string;
  isGroup?: boolean;
  lastSenderId?: string;
  lastReplyTarget?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type ThreadStore = Record<string, ThreadRecord>;
export type ActiveThread = ThreadRecord & { threadId: string };

export function isActiveThread(record: ThreadRecord | undefined): record is ActiveThread {
  return typeof record?.threadId === "string" && record.threadId.length > 0;
}

function recordFromJson(value: unknown): ThreadRecord {
  const data = object(value);
  const result: ThreadRecord = {};
  for (const key of ["threadId", "cwd", "conversationKey", "lastSenderId", "lastReplyTarget", "createdAt", "updatedAt"] as const) {
    if (data[key] != null) result[key] = string(data[key]);
  }
  for (const key of ["name", "model", "effort"] as const) {
    if (data[key] !== undefined) result[key] = data[key] === null ? null : string(data[key]);
  }
  if (data.isGroup !== undefined) {
    if (typeof data.isGroup !== "boolean") throw new Error("Expected isGroup to be boolean");
    result.isGroup = data.isGroup;
  }
  if (data.history !== undefined) {
    if (!Array.isArray(data.history)) throw new Error("Expected thread history array");
    result.history = data.history.map((item: unknown) => {
      const saved = object(item);
      return {
        threadId: string(saved.threadId),
        name: saved.name == null ? null : string(saved.name),
        cwd: saved.cwd == null ? null : string(saved.cwd),
      };
    });
  }
  return result;
}

export function threadStoreFromJson(value: unknown): ThreadStore {
  return Object.fromEntries(Object.entries(object(value)).map(([key, record]) => [key, recordFromJson(record)]));
}

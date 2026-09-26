import type { SandboxMode } from "./sandbox.js";

/** JSON objects received from disk or another process require runtime checks. */
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string");
  return value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ThreadSettings {
  sandbox?: SandboxMode;
  cwd?: string;
  model?: string | null;
  effort?: string | null;
}

export interface Model {
  id: string;
  model?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string }[];
}

export function model(value: unknown): Model {
  const entry = object(value);
  const result: Model = { id: string(entry.id) };
  if (entry.model !== undefined) result.model = string(entry.model);
  if (entry.hidden !== undefined) {
    if (typeof entry.hidden !== "boolean") throw new Error("Expected hidden to be boolean");
    result.hidden = entry.hidden;
  }
  if (entry.supportedReasoningEfforts !== undefined) {
    if (!Array.isArray(entry.supportedReasoningEfforts)) throw new Error("Expected reasoning efforts array");
    result.supportedReasoningEfforts = entry.supportedReasoningEfforts.map((item: unknown) => ({
      reasoningEffort: string(object(item).reasoningEffort),
    }));
  }
  return result;
}

export type UserInput =
  | { type: "text"; text: string; text_elements: unknown[] }
  | { type: "localImage"; path: string }
  | { type: "localAudio"; path: string };

export interface TurnResult {
  text: string;
  commentary: string;
}

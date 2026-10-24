import type { IngestEvent } from "@/lib/types";
import { normalizeGraph, normalizePerson, type GraphPayload, type PersonListItem } from "./model";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; input: unknown; cypher?: string; rowCount?: number; ms?: number }
  | { type: "suggestions"; items: string[] }
  | { type: "done" }
  | { type: "error"; message: string };

export async function fetchPeople(): Promise<PersonListItem[]> {
  const response = await fetch("/api/people", { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, "Couldn't load people.");
  const data = (await response.json()) as unknown;
  if (!data || typeof data !== "object" || !Array.isArray((data as { people?: unknown }).people)) {
    throw new ApiError(response.status, "Couldn't load people.");
  }
  return (data as { people: unknown[] }).people.flatMap((item) => {
    const person = normalizePerson(item);
    return person ? [person] : [];
  });
}

export async function postPerson(lumaUrl: string): Promise<PersonListItem> {
  const response = await fetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ luma_url: lumaUrl }),
  });
  if (response.status === 404) throw new ApiError(404, "Adding people isn't ready yet.");
  if (!response.ok) throw new ApiError(response.status, await readErrorMessage(response, "That didn't work."));
  const data = (await response.json()) as unknown;
  const person = data && typeof data === "object" ? normalizePerson((data as { person?: unknown }).person) : null;
  if (!person) throw new ApiError(response.status, "That didn't work.");
  return person;
}

export async function fetchGraph(slug: string): Promise<GraphPayload> {
  const response = await fetch(`/api/graph/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (response.status === 404) throw new ApiError(404, "This graph isn't ready yet.");
  if (!response.ok) throw new ApiError(response.status, await readErrorMessage(response, "Couldn't load this graph."));
  const graph = normalizeGraph(await response.json());
  if (!graph) throw new ApiError(response.status, "Couldn't load this graph.");
  return graph;
}

export async function streamIngest(slug: string, onEvent: (event: IngestEvent) => void): Promise<void> {
  const response = await fetch(`/api/ingest/${encodeURIComponent(slug)}`, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
  });
  if (response.status === 404) throw new ApiError(404, "Ingest isn't ready yet.");
  if (!response.ok) throw new ApiError(response.status, await readErrorMessage(response, "Ingest didn't start."));
  await readSse(response, (value) => {
    const event = normalizeIngestEvent(value);
    if (event) onEvent(event);
  });
}

export async function streamChat(
  body: {
    viewer: string;
    person: string;
    messages: { role: "user" | "assistant"; content: string }[];
    mode?: "brief";
    dropProtected?: boolean;
  },
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 404) throw new ApiError(404, "Chat isn't ready yet.");
  if (!response.ok) throw new ApiError(response.status, await readErrorMessage(response, "Chat didn't start."));
  await readSse(response, (value) => {
    const event = normalizeChatEvent(value);
    if (event) onEvent(event);
  });
}

export function normalizeIngestEvent(value: unknown): IngestEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.slug !== "string" || typeof raw.source !== "string" || typeof raw.status !== "string") return null;
  const statuses = ["pending", "fetching", "extracting", "writing", "done", "error", "skipped"] as const;
  if (!statuses.includes(raw.status as (typeof statuses)[number])) return null;
  return {
    slug: raw.slug,
    source: raw.source,
    status: raw.status as IngestEvent["status"],
    count: typeof raw.count === "number" ? raw.count : undefined,
    message: typeof raw.message === "string" ? raw.message : undefined,
    at: typeof raw.at === "string" ? raw.at : new Date().toISOString(),
  };
}

export function normalizeChatEvent(value: unknown): ChatStreamEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type === "text" && typeof raw.delta === "string") return { type: "text", delta: raw.delta };
  if (raw.type === "done") return { type: "done" };
  if (raw.type === "error") {
    return { type: "error", message: typeof raw.message === "string" ? raw.message : "That didn't work." };
  }
  if (raw.type === "suggestions" && Array.isArray(raw.items)) {
    return { type: "suggestions", items: raw.items.filter((item): item is string => typeof item === "string") };
  }
  if (raw.type === "tool" && typeof raw.id === "string" && typeof raw.name === "string") {
    return {
      type: "tool",
      id: raw.id,
      name: raw.name,
      input: raw.input,
      cypher: typeof raw.cypher === "string" ? raw.cypher : undefined,
      rowCount: typeof raw.rowCount === "number" ? raw.rowCount : undefined,
      ms: typeof raw.ms === "number" ? raw.ms : undefined,
    };
  }
  return null;
}

async function readSse(response: Response, onData: (value: unknown) => void): Promise<void> {
  if (!response.body) throw new ApiError(response.status, "Nothing came back.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("<!DOCTYPE") || buffer.includes("<html")) {
      throw new ApiError(response.status, "That didn't work.");
    }
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onData(JSON.parse(payload) as unknown);
      } catch {
        /* skip a bad line */
      }
    }
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const text = await response.text();
    return clipMessage(text, fallback);
  } catch {
    return fallback;
  }
}

function clipMessage(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) return fallback;
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (typeof record.error === "string") return clipMessage(record.error, fallback);
      if (typeof record.message === "string") return clipMessage(record.message, fallback);
    }
  } catch {
    /* plain text */
  }
  const flat = trimmed.replace(/\s+/g, " ");
  if (!flat || flat.length > 160) return fallback;
  return flat;
}

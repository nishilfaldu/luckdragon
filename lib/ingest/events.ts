import type { IngestEvent, IngestStatus } from "@/lib/types";

type Run = { startedAt: string };

const globalForRuns = globalThis as typeof globalThis & {
  __luckdragonIngest?: Map<string, Run>;
};

function runs(): Map<string, Run> {
  if (!globalForRuns.__luckdragonIngest) globalForRuns.__luckdragonIngest = new Map();
  return globalForRuns.__luckdragonIngest;
}

export function isIngesting(slug: string): boolean {
  return runs().has(slug);
}

/** Returns false when a run for this slug is already active. */
export function beginRun(slug: string): boolean {
  const table = runs();
  if (table.has(slug)) return false;
  table.set(slug, { startedAt: new Date().toISOString() });
  return true;
}

export function endRun(slug: string): void {
  runs().delete(slug);
}

export function ingestEvent(
  slug: string,
  source: string,
  status: IngestStatus,
  extra?: { count?: number; message?: string },
): IngestEvent {
  return {
    slug,
    source,
    status,
    at: new Date().toISOString(),
    ...extra,
  };
}

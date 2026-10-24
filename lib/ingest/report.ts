import { query } from "@/lib/falkor";
import type { IngestEvent } from "@/lib/types";

/** Pipeline steps that aren't data sources. */
const NOT_SOURCES = new Set(["seed", "graph", "room", "all"]);

export type SourceOutcome = { source: string; status: "ok" | "failed" | "none"; count?: number; message?: string };
export type IngestReport = { at: string; sources: SourceOutcome[] };

/** Folds a run's events into one final outcome per source (the last fetch outcome wins; extraction failures count as failed). */
export function reportFrom(events: IngestEvent[]): IngestReport {
  const outcome = new Map<string, SourceOutcome>();
  let at = "";
  for (const event of events) {
    if (event.source === "all" && event.status === "done") at = event.at;
    if (NOT_SOURCES.has(event.source)) continue;
    if (event.status === "done" && event.message !== "extracted") {
      outcome.set(event.source, { source: event.source, status: (event.count ?? 0) > 0 ? "ok" : "none", count: event.count });
    } else if (event.status === "skipped") {
      if (!outcome.has(event.source) || outcome.get(event.source)?.status === "none") {
        outcome.set(event.source, { source: event.source, status: "none", message: event.message });
      }
    } else if (event.status === "error") {
      outcome.set(event.source, { source: event.source, status: "failed", message: event.message });
    }
  }
  return { at: at || new Date().toISOString(), sources: [...outcome.values()] };
}

export async function saveReport(slug: string, report: IngestReport): Promise<void> {
  await query(slug, "MATCH (p:Person {id: 'person_root'}) SET p.last_ingest_at = $at, p.ingest_report = $report", {
    at: report.at,
    report: JSON.stringify(report.sources),
  });
}

import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { closeFalkor, listPersonGraphs } from "@/lib/falkor";
import { reportFrom, saveReport } from "@/lib/ingest/report";
import type { IngestEvent } from "@/lib/types";

config({ path: path.join(process.cwd(), ".env.local") });

/** Rebuilds each person's ingest report from `npm run ingest` logs (JSON event lines); the latest run per person wins. */
async function main(): Promise<void> {
  const runs = new Map<string, IngestEvent[][]>();
  for (const file of process.argv.slice(2)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.startsWith("{")) continue;
      let event: IngestEvent;
      try {
        event = JSON.parse(line) as IngestEvent;
      } catch {
        continue;
      }
      if (!event.slug || !event.source || !event.at) continue;
      const list = runs.get(event.slug) ?? [];
      if (event.source === "seed" && event.status === "pending") list.push([]);
      if (list.length === 0) list.push([]);
      list[list.length - 1]!.push(event);
      runs.set(event.slug, list);
    }
  }
  const graphs = new Set(await listPersonGraphs());
  for (const [slug, list] of runs) {
    if (!graphs.has(`person:${slug}`)) continue;
    const finished = list.filter((events) => events.some((e) => e.source === "all" && e.status === "done"));
    const latest = finished.sort((a, b) => lastAt(a).localeCompare(lastAt(b))).at(-1);
    if (!latest) continue;
    const report = reportFrom(latest);
    await saveReport(slug, report);
    const ok = report.sources.filter((s) => s.status === "ok").length;
    const failed = report.sources.filter((s) => s.status === "failed").map((s) => s.source);
    console.log(`${slug} ${report.at} ok=${ok} failed=${failed.join(",") || "-"}`);
  }
  await closeFalkor();
}

function lastAt(events: IngestEvent[]): string {
  return events.at(-1)?.at ?? "";
}

void main();

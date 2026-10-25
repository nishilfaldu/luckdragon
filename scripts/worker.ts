import { config } from "dotenv";
import path from "node:path";

config({ path: path.join(process.cwd(), ".env.local") });
// The worker reads and writes FalkorDB Cloud, where the public site looks.
if (process.env.FALKORDB_CLOUD_URL) process.env.FALKORDB_URL = process.env.FALKORDB_CLOUD_URL;

/** Runs ingest jobs queued by the public site, streaming each event back through FalkorDB. */
async function main(): Promise<void> {
  const { appendEvent, claimJob, finishJob } = await import("@/lib/queue");
  const { runIngest } = await import("@/lib/ingest/pipeline");
  const { upsertPerson } = await import("@/lib/people");
  console.log("worker: watching FalkorDB Cloud for ingest jobs");
  for (;;) {
    const person = await claimJob().catch((error: unknown) => {
      console.error("worker: claim failed", error instanceof Error ? error.message : error);
      return null;
    });
    if (!person) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    console.log(`worker: ingesting ${person.slug}`);
    upsertPerson(person);
    let failed = false;
    await runIngest(person.slug, {}, (event) => {
      if (event.source === "all" && event.status === "error") failed = true;
      void appendEvent(event).catch(() => undefined);
    });
    await finishJob(person.slug, failed ? "error" : "done");
    console.log(`worker: ${person.slug} ${failed ? "failed" : "done"}`);
  }
}

void main();

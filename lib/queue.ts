import { getFalkor } from "@/lib/falkor";
import type { IngestEvent, PersonRow } from "@/lib/types";

/**
 * Ingest job queue for the public deploy. Vercel functions stop after 5 minutes and an ingest
 * takes about 10, so the site enqueues a job in FalkorDB and a worker on the presenter's laptop
 * (`npm run worker`) runs the normal pipeline, writing progress events back for the site to stream.
 */
const JOBS = "jobs";
export const DAILY_ADD_LIMIT = 5;

export function queueMode(): boolean {
  return process.env.LUCKDRAGON_QUEUE === "1";
}

async function jobs(cypher: string, params?: Record<string, unknown>, readOnly = false) {
  const graph = (await getFalkor()).selectGraph(JOBS);
  const options = { TIMEOUT: 8_000, ...(params ? { params: params as never } : {}) };
  const reply = readOnly ? await graph.roQuery(cypher, options) : await graph.query(cypher, options);
  return (reply.data ?? []) as Record<string, unknown>[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function enqueueJob(person: PersonRow): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [count] = await jobs("MATCH (j:Job {day: $day}) RETURN count(j) AS n", { day: today() });
  if (Number(count?.n ?? 0) >= DAILY_ADD_LIMIT) {
    return { ok: false, reason: `Today's limit of ${DAILY_ADD_LIMIT} live adds is used up.` };
  }
  await jobs("MATCH (j:Job {slug: $slug}) WHERE j.status IN ['queued', 'running'] DETACH DELETE j", { slug: person.slug });
  await jobs("MATCH (e:Event {slug: $slug}) DELETE e", { slug: person.slug });
  await jobs(
    "CREATE (:Job {slug: $slug, person: $person, status: 'queued', created_at: $at, day: $day})",
    { slug: person.slug, person: JSON.stringify(person), at: new Date().toISOString(), day: today() },
  );
  return { ok: true };
}

export async function jobStatus(slug: string): Promise<string | null> {
  const [row] = await jobs("MATCH (j:Job {slug: $slug}) RETURN j.status AS status ORDER BY j.created_at DESC LIMIT 1", { slug }, true);
  return row ? String(row.status) : null;
}

/** Events after the first `after` ones, in order. */
export async function eventsSince(slug: string, after: number): Promise<IngestEvent[]> {
  const rows = await jobs(
    "MATCH (e:Event {slug: $slug}) RETURN e.json AS json ORDER BY e.seq SKIP $after LIMIT 200",
    { slug, after },
    true,
  );
  return rows.map((row) => JSON.parse(String(row.json)) as IngestEvent);
}

let seq = 0;
export async function appendEvent(event: IngestEvent): Promise<void> {
  seq += 1;
  await jobs("CREATE (:Event {slug: $slug, seq: $seq, json: $json})", {
    slug: event.slug,
    seq: Date.now() * 1000 + (seq % 1000),
    json: JSON.stringify(event),
  });
}

export async function claimJob(): Promise<PersonRow | null> {
  const [row] = await jobs(
    "MATCH (j:Job {status: 'queued'}) WITH j ORDER BY j.created_at LIMIT 1 SET j.status = 'running' RETURN j.person AS person",
  );
  return row ? (JSON.parse(String(row.person)) as PersonRow) : null;
}

export async function finishJob(slug: string, status: "done" | "error"): Promise<void> {
  await jobs("MATCH (j:Job {slug: $slug, status: 'running'}) SET j.status = $status", { slug, status });
}

/** A new person row for a queued add, without touching the CSV (the deploy has none). */
export async function rowForQueuedAdd(parsed: import("@/lib/people").ClassifiedPerson): Promise<PersonRow> {
  const { slugify, uniqueSlug } = await import("@/lib/people");
  const { listPersonGraphs } = await import("@/lib/falkor");
  const taken = new Set((await listPersonGraphs()).map((name) => name.slice("person:".length)));
  const name =
    parsed.kind === "luma"
      ? (new URL(parsed.url).pathname.split("/").filter(Boolean).pop() ?? "guest").replace(/[-_]/g, " ")
      : parsed.name;
  return {
    slug: uniqueSlug(slugify(name), taken),
    name,
    role: "guest",
    luma_url: parsed.kind === "luma" ? parsed.url : "",
    headline: parsed.kind === "name" ? parsed.headline : "",
    avatar_url: "",
    linkedin: parsed.kind === "linkedin" ? parsed.url : "",
    x: "",
    github: "",
    youtube: "",
    instagram: "",
    tiktok: "",
    website: parsed.kind === "website" ? parsed.url : "",
    other_links: "",
  };
}

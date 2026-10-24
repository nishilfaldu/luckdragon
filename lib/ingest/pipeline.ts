import { applyLuma, accountsFromPerson, readLumaProfile, type KnownAccount } from "@/lib/ingest/accounts";
import { beginRun, endRun, ingestEvent } from "@/lib/ingest/events";
import { extractBatch, mergeGraphs, seedGraph, type GraphBatch } from "@/lib/ingest/extract";
import type { RawItem } from "@/lib/ingest/items";
import { resetWebSearchBudget } from "@/lib/ingest/openai";
import { mapPool } from "@/lib/ingest/pool";
import { researchPerson } from "@/lib/ingest/research-agent";
import { resolveAccounts } from "@/lib/ingest/resolve";
import { SOURCE_ADAPTERS } from "@/lib/ingest/sources";
import type { SourceContext } from "@/lib/ingest/sources/types";
import { loadGraphModules, persistGraph } from "@/lib/ingest/store";
import { getPerson } from "@/lib/people";
import type { IngestEvent, PersonRow } from "@/lib/types";

const SOURCE_CONCURRENCY = 8;
const EXTRACT_CONCURRENCY = 6;

const ROW_FIELD: Record<string, keyof PersonRow> = {
  linkedin: "linkedin",
  x: "x",
  github: "github",
  youtube: "youtube",
  instagram: "instagram",
  tiktok: "tiktok",
  website: "website",
};

export type IngestOptions = { fresh?: boolean };

export async function runIngest(
  slug: string,
  options: IngestOptions,
  onEvent: (event: IngestEvent) => void,
): Promise<void> {
  const fresh = options.fresh ?? false;
  if (!beginRun(slug)) {
    onEvent(ingestEvent(slug, "all", "error", { message: "Ingest already running" }));
    onEvent(ingestEvent(slug, "all", "done"));
    return;
  }
  resetWebSearchBudget();
  const emit = (source: string, status: IngestEvent["status"], extra?: { count?: number; message?: string }) => {
    onEvent(ingestEvent(slug, source, status, extra));
  };
  try {
    await loadGraphModules();
    emit("seed", "pending");
    const row = getPerson(slug);
    if (!row) {
      emit("seed", "error", { message: `No person with slug ${slug}` });
      emit("all", "done");
      return;
    }
    const profile = readLumaProfile(row.slug, row.luma_url);
    let person = applyLuma(row, profile);
    emit("seed", "done");

    emit("luma", "fetching");
    const hint = [
      profile?.luma_account?.job_title && profile.luma_account.company
        ? `${profile.luma_account.job_title} at ${profile.luma_account.company}`
        : "",
      person.headline,
    ]
      .filter(Boolean)
      .join(". ");
    emit("luma", "done", { message: profile ? "saved profile" : person.luma_url ? "will fetch" : "no luma url" });

    emit("resolve", "fetching");
    let resolved: KnownAccount[] = [];
    try {
      resolved = await resolveAccounts(person, hint, fresh);
      emit("resolve", "done", { count: resolved.length });
    } catch (error) {
      emit("resolve", "error", { message: messageOf(error) });
    }
    const accounts = mergeAccounts(accountsFromPerson(person), resolved);
    person = applyResolved(person, accounts);

    const ctx: SourceContext = { person, accounts, fresh, hint };
    const fetched: Array<{ source: string; items: RawItem[] }> = [];
    await mapPool(SOURCE_ADAPTERS, SOURCE_CONCURRENCY, async (adapter) => {
      emit(adapter.id, "fetching");
      try {
        const items = (await adapter.run(ctx)) ?? [];
        fetched.push({ source: adapter.id, items });
        emit(adapter.id, items.length ? "done" : "skipped", { count: items.length });
      } catch (error) {
        const message = messageOf(error);
        if (/cap reached/i.test(message)) emit(adapter.id, "skipped", { count: 0, message });
        else emit(adapter.id, "error", { message });
      }
    });

    emit("research", "fetching");
    try {
      const known = [
        ...accounts.map((account) => account.url),
        ...fetched.flatMap((batch) => batch.items.map((item) => item.url)),
      ];
      const items = await researchPerson(person, known, hint, fresh);
      fetched.push({ source: "research", items });
      emit("research", items.length ? "done" : "skipped", { count: items.length });
    } catch (error) {
      emit("research", "error", { message: messageOf(error) });
    }

    const fetchedAt = new Date().toISOString();
    const batches: GraphBatch[] = [seedGraph(person, accounts, fetchedAt)];
    const toExtract = fetched.filter((batch) => batch.items.length > 0);
    await mapPool(toExtract, EXTRACT_CONCURRENCY, async (batch) => {
      emit(batch.source, "extracting", { count: batch.items.length });
      try {
        const graph = await extractBatch(person, batch.source, batch.items);
        batches.push(graph);
        emit(batch.source, "done", { count: graph.nodes.length, message: "extracted" });
      } catch (error) {
        emit(batch.source, "error", { message: messageOf(error) });
      }
    });

    const merged = mergeGraphs(batches);
    emit("graph", "writing", { count: merged.nodes.length });
    await persistGraph(slug, merged.nodes, merged.edges);
    emit("graph", "done", { count: merged.nodes.length, message: `${merged.edges.length} edges` });
    emit("all", "done", { count: merged.nodes.length });
  } catch (error) {
    emit("all", "error", { message: messageOf(error) });
    emit("all", "done");
  } finally {
    endRun(slug);
  }
}

export async function* iterateIngest(slug: string, options: IngestOptions = {}): AsyncGenerator<IngestEvent> {
  const pending: IngestEvent[] = [];
  let resolveWait: (() => void) | null = null;
  let finished = false;

  const done = runIngest(slug, options, (event) => {
    pending.push(event);
    resolveWait?.();
  }).finally(() => {
    finished = true;
    resolveWait?.();
  });

  while (!finished || pending.length > 0) {
    if (pending.length === 0) {
      await new Promise<void>((resolve) => {
        resolveWait = () => resolve();
        if (finished || pending.length > 0) resolve();
      });
      continue;
    }
    const event = pending.shift();
    if (event) yield event;
  }
  await done;
}

function mergeAccounts(base: KnownAccount[], extra: KnownAccount[]): KnownAccount[] {
  const merged = [...base];
  const seen = new Set(base.map((account) => account.platform));
  for (const account of extra) {
    if (seen.has(account.platform)) continue;
    seen.add(account.platform);
    merged.push(account);
  }
  return merged;
}

function applyResolved(person: PersonRow, accounts: KnownAccount[]): PersonRow {
  const next = { ...person };
  const extras: string[] = [];
  for (const account of accounts) {
    const field = ROW_FIELD[account.platform];
    if (field) {
      if (!next[field]) next[field] = account.url;
    } else if (!next.other_links.includes(account.url)) {
      extras.push(account.url);
    }
  }
  if (extras.length) next.other_links = `${next.other_links} ${extras.join(" ")}`.trim();
  return next;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

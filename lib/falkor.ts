import { FalkorDB, type QueryOptions, type QueryParams } from "falkordb";

const DEFAULT_URL = "falkor://localhost:6379";

/** Server-side query timeout passed to FalkorDB, in milliseconds. */
export const QUERY_TIMEOUT_MS = 8_000;

/** Maximum rows returned to callers. Extra rows are dropped. */
export const ROW_CAP = 200;

export type FalkorQueryResult = {
  data: Record<string, unknown>[];
  metadata: string[];
  truncated: boolean;
};

const globalForFalkor = globalThis as typeof globalThis & {
  __luckdragonFalkor?: Promise<FalkorDB>;
};

/**
 * Procedures a read-only query may CALL. Anything else is rejected, including
 * index creation and other procedures that write.
 */
const READ_ONLY_PROCEDURES = new Set([
  "db.labels",
  "db.relationshiptypes",
  "db.propertykeys",
  "db.indexes",
  "db.constraints",
  "db.idx.fulltext.querynodes",
  "db.idx.fulltext.queryrelationships",
  "db.idx.vector.querynodes",
  "db.idx.vector.queryrelationships",
]);

const WRITE_CLAUSE = /(?:^|[^\w.])(CREATE|MERGE|SET|DELETE|REMOVE|DROP|FOREACH)\b/i;
const LOAD_CSV = /(?:^|[^\w.])LOAD\s+CSV\b/i;
const CALL_PROCEDURE = /\bCALL\s+([A-Za-z_][\w.]*)/gi;

/** Graph name for one person. Re-ingesting the same slug hits the same graph. */
export function graphName(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed) throw new Error("Person slug is empty");
  return `person:${trimmed}`;
}

/** Lazy connection, reused across hot reloads. */
export function getFalkor(): Promise<FalkorDB> {
  if (!globalForFalkor.__luckdragonFalkor) {
    const url = process.env.FALKORDB_URL || DEFAULT_URL;
    const client: Promise<FalkorDB> = FalkorDB.connect({ url })
      .then((db) => {
        // FalkorDB Cloud drops idle connections; without a listener the 'error' event crashes the process.
        // Forget the client so the next query reconnects.
        db.on("error", (error: unknown) => {
          console.warn("falkordb connection error:", error instanceof Error ? error.message : error);
          if (globalForFalkor.__luckdragonFalkor === client) globalForFalkor.__luckdragonFalkor = undefined;
        });
        return db;
      })
      .catch((error: unknown) => {
        globalForFalkor.__luckdragonFalkor = undefined;
        throw error;
      });
    globalForFalkor.__luckdragonFalkor = client;
  }
  return globalForFalkor.__luckdragonFalkor;
}

export async function closeFalkor(): Promise<void> {
  const pending = globalForFalkor.__luckdragonFalkor;
  if (!pending) return;
  globalForFalkor.__luckdragonFalkor = undefined;
  const db = await pending;
  await db.close();
}

export async function listPersonGraphs(): Promise<string[]> {
  const db = await getFalkor();
  const names = await db.list();
  return names.filter((name) => name.startsWith("person:")).sort();
}

export async function query(
  slug: string,
  cypher: string,
  params?: QueryParams,
): Promise<FalkorQueryResult> {
  return run(slug, cypher, params, false);
}

/**
 * Read-only query. Uses FalkorDB's GRAPH.RO_QUERY and rejects write clauses
 * and procedure calls that are not in the read-only allowlist.
 */
export async function roQuery(
  slug: string,
  cypher: string,
  params?: QueryParams,
): Promise<FalkorQueryResult> {
  assertReadOnly(cypher);
  return run(slug, cypher, params, true);
}

export function assertReadOnly(cypher: string): void {
  const stripped = stripCypherNoise(cypher);
  const write = stripped.match(WRITE_CLAUSE);
  if (write) {
    throw new Error(`Read-only query rejected a write clause (${write[1] ?? write[0].trim()})`);
  }
  const load = stripped.match(LOAD_CSV);
  if (load) {
    throw new Error("Read-only query rejected a write clause (LOAD CSV)");
  }
  CALL_PROCEDURE.lastIndex = 0;
  for (const match of stripped.matchAll(CALL_PROCEDURE)) {
    const name = match[1].toLowerCase();
    if (!READ_ONLY_PROCEDURES.has(name)) {
      throw new Error(`Read-only query rejected procedure ${match[1]}`);
    }
  }
}

async function run(
  slug: string,
  cypher: string,
  params: QueryParams | undefined,
  readOnly: boolean,
): Promise<FalkorQueryResult> {
  const trimmed = cypher.trim();
  if (!trimmed) throw new Error("Query is empty");

  const db = await getFalkor();
  const graph = db.selectGraph(graphName(slug));
  const options: QueryOptions = { TIMEOUT: QUERY_TIMEOUT_MS };
  if (params && Object.keys(params).length > 0) options.params = params;

  const pending = (readOnly ? graph.roQuery(trimmed, options) : graph.query(trimmed, options)).then(
    (reply) => ({ reply, error: undefined }),
    (error: unknown) => ({ reply: undefined, error }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), QUERY_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([pending, timeout]);
    if ("timedOut" in outcome) {
      throw new Error(`Query timed out after ${QUERY_TIMEOUT_MS}ms`);
    }
    if (outcome.error) {
      if (readOnly && outcome.error instanceof Error && /empty key/i.test(outcome.error.message)) {
        throw new Error(`Graph ${graphName(slug)} does not exist`, { cause: outcome.error });
      }
      throw outcome.error;
    }
    const reply = outcome.reply;
    const rows = (reply?.data ?? []) as Record<string, unknown>[];
    const truncated = rows.length > ROW_CAP;
    return {
      data: truncated ? rows.slice(0, ROW_CAP) : rows,
      metadata: reply?.metadata ?? [],
      truncated,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Blank comments, strings, and backtick names so a write cannot hide in one or be erased by one. */
function stripCypherNoise(cypher: string): string {
  const chars = [...cypher];
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j += 1) {
      if (chars[j] !== "\n") chars[j] = " ";
    }
  };
  while (i < chars.length) {
    const current = chars[i];
    const next = chars[i + 1];
    if (current === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < chars.length && chars[i] !== "\n") i += 1;
      blank(start, i);
      continue;
    }
    if (current === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) i += 1;
      i = Math.min(chars.length, i + 2);
      blank(start, i);
      continue;
    }
    if (current === "'" || current === '"') {
      const quote = current;
      const start = i;
      i += 1;
      while (i < chars.length) {
        if (chars[i] === quote && chars[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (chars[i] === "\\" && i + 1 < chars.length) {
          i += 2;
          continue;
        }
        if (chars[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      blank(start, i);
      continue;
    }
    if (current === "`") {
      const start = i;
      i += 1;
      while (i < chars.length) {
        if (chars[i] === "`" && chars[i + 1] === "`") {
          i += 2;
          continue;
        }
        if (chars[i] === "`") {
          i += 1;
          break;
        }
        i += 1;
      }
      blank(start, i);
      continue;
    }
    i += 1;
  }
  return chars.join("");
}

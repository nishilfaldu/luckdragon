import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import { FalkorDB, type Graph, type QueryParam, type QueryParams } from "falkordb";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env.local"), quiet: true });
loadEnv({ path: path.join(root, ".env"), quiet: true });

const CHUNK = 80;
const QUERY_TIMEOUT = 30_000;
const ATTEMPTS = 3;

type StoredNode = { labels: string[]; props: QueryParams };
type StoredEdge = { source: string; target: string; type: string; props: QueryParams };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prefix = readPrefix(args);
  const cleanup = args.includes("--cleanup");
  if (args.some((arg) => arg === "--help" || arg === "-h")) {
    console.log("Usage: npx tsx scripts/copy-to-cloud.ts [--target-prefix copytest:] [--cleanup]");
    console.log("Without --target-prefix, copies person:* graphs from FALKORDB_URL to FALKORDB_CLOUD_URL.");
    return;
  }

  const sourceUrl = process.env.FALKORDB_URL || "falkor://localhost:6379";
  const targetUrl = prefix ? sourceUrl : process.env.FALKORDB_CLOUD_URL;
  if (!targetUrl) throw new Error("FALKORDB_CLOUD_URL is not set");
  if (prefix === "person:") throw new Error("Refusing target prefix person:");

  const source = await FalkorDB.connect({ url: sourceUrl });
  const target = await FalkorDB.connect({ url: targetUrl });
  try {
    if (cleanup) {
      if (!prefix) throw new Error("--cleanup needs --target-prefix so it cannot delete person:* graphs");
      await deletePrefix(target, prefix);
      return;
    }

    const names = (await source.list()).filter((name) => name.startsWith("person:")).sort();
    if (names.length === 0) {
      console.log("no person:* graphs");
      return;
    }

    for (const name of names) {
      const targetName = `${prefix ?? ""}${name}`;
      if (sameUrl(sourceUrl, targetUrl) && targetName === name) {
        throw new Error(`Refusing to overwrite ${name} on the source server`);
      }
      await copyWithRetry(source, target, name, targetName);
    }
    console.log(`copied ${names.length} graph${names.length === 1 ? "" : "s"}`);
  } finally {
    await source.close().catch(() => undefined);
    await target.close().catch(() => undefined);
  }
}

async function copyWithRetry(source: FalkorDB, target: FalkorDB, sourceName: string, targetName: string): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      await copyGraph(source, target, sourceName, targetName);
      return;
    } catch (error) {
      last = error;
      if (attempt === ATTEMPTS) break;
      console.error(`retry ${attempt} ${sourceName}: ${scrub(error)}`);
      await delay(200);
    }
  }
  throw last;
}

async function copyGraph(source: FalkorDB, target: FalkorDB, sourceName: string, targetName: string): Promise<void> {
  const snapshot = await readGraph(source.selectGraph(sourceName));
  await dropIfExists(target, targetName);
  const graph = target.selectGraph(targetName);

  const labels = [...new Set(snapshot.nodes.flatMap((node) => node.labels))];
  for (const label of labels) await ensureIdIndex(graph, label);

  const byLabel = new Map<string, QueryParams[]>();
  for (const node of snapshot.nodes) {
    const key = node.labels.join(":");
    const list = byLabel.get(key) ?? [];
    list.push(node.props);
    byLabel.set(key, list);
  }
  for (const [key, rows] of byLabel) {
    await unwind(graph, `UNWIND $rows AS row\nCREATE (n:${key})\nSET n = row`, rows);
  }

  const byType = new Map<string, QueryParams[]>();
  for (const edge of snapshot.edges) {
    const list = byType.get(edge.type) ?? [];
    list.push({ source: edge.source, target: edge.target, props: edge.props });
    byType.set(edge.type, list);
  }
  for (const [type, rows] of byType) {
    const setsProps = rows.some((row) => Object.keys(row.props as QueryParams).length > 0);
    const setClause = setsProps ? "\nSET rel = row.props" : "";
    await unwind(
      graph,
      `UNWIND $rows AS row
MATCH (src {id: row.source})
MATCH (dst {id: row.target})
CREATE (src)-[rel:${type}]->(dst)${setClause}`,
      rows,
    );
  }

  const targetNodes = await count(graph, "MATCH (n) RETURN count(n) AS count");
  const targetEdges = await count(graph, "MATCH ()-[r]->() RETURN count(r) AS count");
  console.log(
    `${sourceName}: source ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges; ${targetName}: ${targetNodes} nodes, ${targetEdges} edges`,
  );
  if (targetNodes !== snapshot.nodes.length || targetEdges !== snapshot.edges.length) {
    throw new Error(
      `Mismatch for ${sourceName}: source ${snapshot.nodes.length} nodes / ${snapshot.edges.length} edges, target ${targetNodes} nodes / ${targetEdges} edges`,
    );
  }
}

async function readGraph(graph: Graph): Promise<{ nodes: StoredNode[]; edges: StoredEdge[] }> {
  const nodeReply = await graph.query<Record<string, unknown>>("MATCH (n) RETURN n", { TIMEOUT: QUERY_TIMEOUT });
  const nodes: StoredNode[] = [];
  const ids = new Set<string>();
  for (const row of nodeReply.data ?? []) {
    const stored = asRecord(row.n ?? Object.values(row)[0]);
    if (!stored || !Array.isArray(stored.labels)) throw new Error("Node reply is missing labels");
    const labels = stored.labels.filter((label): label is string => typeof label === "string").map(assertName);
    if (labels.length === 0) throw new Error("Node has no labels");
    const properties = asRecord(stored.properties);
    if (!properties) throw new Error("Node reply is missing properties");
    const props = propsToParams(properties);
    const id = props.id;
    if (typeof id !== "string" || !id) throw new Error("Node is missing an id");
    if (ids.has(id)) throw new Error(`Duplicate node id ${id}`);
    ids.add(id);
    nodes.push({ labels, props });
  }

  const edgeReply = await graph.query<Record<string, unknown>>(
    "MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, type(r) AS type, properties(r) AS props",
    { TIMEOUT: QUERY_TIMEOUT },
  );
  const edges: StoredEdge[] = [];
  for (const row of edgeReply.data ?? []) {
    const source = typeof row.source === "string" ? row.source : "";
    const target = typeof row.target === "string" ? row.target : "";
    const type = typeof row.type === "string" ? assertName(row.type) : "";
    if (!source || !target || !type) throw new Error("Edge reply is missing source, target, or type");
    if (!ids.has(source) || !ids.has(target)) {
      throw new Error(`Edge ${type} references a node that was not in the snapshot`);
    }
    const rawProps = row.props == null ? {} : asRecord(row.props);
    if (!rawProps) throw new Error(`Edge ${type} properties were not a map`);
    edges.push({ source, target, type, props: propsToParams(rawProps) });
  }
  return { nodes, edges };
}

async function dropIfExists(db: FalkorDB, name: string): Promise<void> {
  const names = await db.list();
  if (!names.includes(name)) return;
  await db.selectGraph(name).delete();
}

async function deletePrefix(db: FalkorDB, prefix: string): Promise<void> {
  const names = (await db.list()).filter((name) => name.startsWith(prefix));
  for (const name of names) {
    await db.selectGraph(name).delete();
    console.log(`deleted ${name}`);
  }
  console.log(`deleted ${names.length} graph${names.length === 1 ? "" : "s"}`);
}

async function ensureIdIndex(graph: Graph, label: string): Promise<void> {
  try {
    await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.id)`, { TIMEOUT: QUERY_TIMEOUT });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/index/i.test(message) && /already|exist/i.test(message)) return;
    throw error;
  }
}

async function unwind(graph: Graph, cypher: string, rows: QueryParams[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await graph.query(cypher, { params: { rows: rows.slice(i, i + CHUNK) }, TIMEOUT: QUERY_TIMEOUT });
  }
}

async function count(graph: Graph, cypher: string): Promise<number> {
  const reply = await graph.query<Record<string, unknown>>(cypher, { TIMEOUT: QUERY_TIMEOUT });
  const row = reply.data?.[0];
  const value = row?.count ?? (row ? Object.values(row)[0] : 0);
  const counted = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(counted) ? counted : 0;
}

function propsToParams(raw: Record<string, unknown>): QueryParams {
  const row: QueryParams = {};
  for (const [key, value] of Object.entries(raw)) {
    assertName(key);
    const flat = toParam(value);
    if (flat !== undefined) row[key] = flat;
  }
  return row;
}

function toParam(value: unknown): QueryParam | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: QueryParam[] = [];
    for (const item of value) {
      if (item == null) continue;
      if (typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) {
        items.push(item);
        continue;
      }
      return JSON.stringify(value);
    }
    return items;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return undefined;
}

function assertName(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe graph name ${value}`);
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPrefix(args: string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith("--target-prefix="));
  const index = args.indexOf("--target-prefix");
  const value = inline ? inline.slice("--target-prefix=".length) : index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && (value === undefined || value.startsWith("--"))) {
    throw new Error("--target-prefix needs a value that ends with ':'");
  }
  if (value === undefined) return undefined;
  if (!value.endsWith(":")) throw new Error("--target-prefix must end with ':' (for example copytest:)");
  return value;
}

function sameUrl(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, "") === b.trim().replace(/\/+$/, "");
}

function scrub(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\/\/[^/\s]+@/g, "//***@");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(scrub(error));
  process.exitCode = 1;
});

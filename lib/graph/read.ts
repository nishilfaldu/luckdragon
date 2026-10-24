import { isProtectedNode } from "@/lib/protected";
import { graphName, listPersonGraphs, roQuery } from "@/lib/falkor";
import { EDGE_TYPES, NODE_TYPES, type EdgeType, type GraphEdge, type GraphNode, type NodeType } from "@/lib/types";

import { assertPersonSlug } from "./ids";

export type PersonGraph = {
  root: GraphNode;
  nodes: GraphNode[];
  links: GraphEdge[];
};

export class GraphNotFoundError extends Error {
  readonly slug: string;

  constructor(slug: string) {
    super(`No graph for ${slug}`);
    this.name = "GraphNotFoundError";
    this.slug = slug;
  }
}

const NODE_QUERY = "MATCH (n) RETURN n";
const EDGE_QUERY = "MATCH (a)-[r]->(b) RETURN a, r, b";

export async function graphExists(slug: string): Promise<boolean> {
  const name = graphName(assertPersonSlug(slug));
  const names = await listPersonGraphs();
  return names.includes(name);
}

export async function nodeCount(slug: string): Promise<number> {
  if (!(await graphExists(slug))) return 0;
  const result = await roQuery(slug, "MATCH (n) RETURN count(n) AS count");
  const row = result.data[0];
  const value = row?.count ?? (row ? Object.values(row)[0] : 0);
  const count = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

/** Protected-trait nodes are left out unless `dropProtected` is false. */
export async function getGraph(slug: string, options: { dropProtected?: boolean } = {}): Promise<PersonGraph> {
  const dropProtected = options.dropProtected !== false;
  const person = assertPersonSlug(slug);
  if (!(await graphExists(person))) throw new GraphNotFoundError(person);

  const [nodeResult, edgeResult] = await Promise.all([
    roQuery(person, NODE_QUERY),
    roQuery(person, EDGE_QUERY),
  ]);

  const nodes: GraphNode[] = [];
  for (const row of nodeResult.data) {
    const node = fromStoredNode(row.n);
    if (node && !(dropProtected && isProtectedNode(node))) nodes.push(node);
  }

  const known = new Set(nodes.map((node) => node.id));
  const links: GraphEdge[] = [];
  for (const row of edgeResult.data) {
    const link = fromStoredEdge(row.a, row.r, row.b);
    if (!link) continue;
    if (!known.has(link.source) || !known.has(link.target)) continue;
    links.push(link);
  }

  const root = nodes.find((node) => node.id === "person_root");
  if (!root) throw new GraphNotFoundError(person);

  nodes.sort(compareNodes);
  links.sort((a, b) => a.type.localeCompare(b.type) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));

  return { root, nodes, links };
}

const CORE_PROPS = new Set(["id", "label", "source_url", "fetched_at", "confidence"]);

function fromStoredNode(value: unknown): GraphNode | null {
  const stored = asRecord(value);
  if (!stored || !Array.isArray(stored.labels)) return null;
  const properties = asRecord(stored.properties) ?? {};
  const id = typeof properties.id === "string" ? properties.id : "";
  if (!id) return null;
  const type = (stored.labels as unknown[]).find((label): label is NodeType =>
    typeof label === "string" && (NODE_TYPES as readonly string[]).includes(label),
  );
  if (!type) return null;

  const props: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (!CORE_PROPS.has(key)) props[key] = prop;
  }

  return {
    id,
    type,
    label: typeof properties.label === "string" ? properties.label : id,
    props,
    source_url: typeof properties.source_url === "string" ? properties.source_url : undefined,
    fetched_at: typeof properties.fetched_at === "string" ? properties.fetched_at : undefined,
    confidence: typeof properties.confidence === "number" ? properties.confidence : undefined,
  };
}

function fromStoredEdge(source: unknown, edge: unknown, target: unknown): GraphEdge | null {
  const src = fromStoredNode(source);
  const dst = fromStoredNode(target);
  const stored = asRecord(edge);
  if (!src || !dst || !stored || typeof stored.relationshipType !== "string") return null;
  if (!(EDGE_TYPES as readonly string[]).includes(stored.relationshipType)) return null;
  const properties = asRecord(stored.properties) ?? {};
  const props = Object.keys(properties).length > 0 ? properties : undefined;
  return {
    source: src.id,
    target: dst.id,
    type: stored.relationshipType as EdgeType,
    props,
  };
}

function compareNodes(a: GraphNode, b: GraphNode): number {
  if (a.id === "person_root") return -1;
  if (b.id === "person_root") return 1;
  return a.type.localeCompare(b.type) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

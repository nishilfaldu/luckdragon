import type { QueryParams } from "falkordb";

import { query } from "@/lib/falkor";
import { EDGE_TYPES, type EdgeType, type GraphEdge, type GraphNode, type NodeType } from "@/lib/types";

import { canonicalType } from "./ids";

const CHUNK = 80;

type Row = QueryParams;

/**
 * Batched MERGE into `person:<slug>`. Nodes merge on `id` with their type as the label.
 * Props are flattened onto the node; dates should already be ISO strings.
 * Safe to call again for the same slug.
 */
export async function writeGraph(
  slug: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<{ nodes: number; edges: number }> {
  const nodeRows = dedupeNodes(nodes);
  const edgeRows = dedupeEdges(edges);
  const ids = new Set(nodeRows.keys());

  for (const edge of edgeRows.values()) {
    if (!ids.has(String(edge.source)) || !ids.has(String(edge.target))) {
      throw new Error(`Edge ${edge.type} references a node that is not in this write`);
    }
  }

  const byLabel = new Map<NodeType, Row[]>();
  for (const node of nodeRows.values()) {
    const label = node.type;
    const list = byLabel.get(label) ?? [];
    list.push(nodeRow(node));
    byLabel.set(label, list);
  }

  for (const label of byLabel.keys()) {
    await ensureIdIndex(slug, label);
  }

  for (const [label, rows] of byLabel) {
    await unwind(
      slug,
      `UNWIND $rows AS row
MERGE (n:${label} {id: row.id})
SET n = row`,
      rows,
    );
  }

  const byType = new Map<EdgeType, Row[]>();
  for (const edge of edgeRows.values()) {
    const list = byType.get(edge.type) ?? [];
    list.push({
      source: edge.source,
      target: edge.target,
      props: edge.props,
    });
    byType.set(edge.type, list);
  }

  for (const [type, rows] of byType) {
    const setsProps = rows.some((row) => Object.keys(row.props as QueryParams).length > 0);
    const setClause = setsProps ? "\nSET rel += row.props" : "";
    await unwind(
      slug,
      `UNWIND $rows AS row
MATCH (src {id: row.source})
MATCH (dst {id: row.target})
MERGE (src)-[rel:${type}]->(dst)${setClause}`,
      rows,
    );
  }

  return { nodes: nodeRows.size, edges: edgeRows.size };
}

async function ensureIdIndex(slug: string, label: NodeType): Promise<void> {
  try {
    await query(slug, `CREATE INDEX FOR (n:${label}) ON (n.id)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/index/i.test(message) && /already|exist/i.test(message)) return;
    throw error;
  }
}

async function unwind(slug: string, cypher: string, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await query(slug, cypher, { rows: rows.slice(i, i + CHUNK) });
  }
}

function dedupeNodes(nodes: GraphNode[]): Map<string, GraphNode> {
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    const type = canonicalType(node.type);
    if (!node.id) throw new Error("Node is missing an id");
    byId.set(node.id, { ...node, type });
  }
  return byId;
}

function dedupeEdges(edges: GraphEdge[]): Map<string, { source: string; target: string; type: EdgeType; props: QueryParams }> {
  const byKey = new Map<string, { source: string; target: string; type: EdgeType; props: QueryParams }>();
  for (const edge of edges) {
    if (!(EDGE_TYPES as readonly string[]).includes(edge.type)) {
      throw new Error(`Unknown edge type ${edge.type}`);
    }
    const props = flattenProps(edge.props ?? {});
    byKey.set(`${edge.source}|${edge.type}|${edge.target}`, {
      source: edge.source,
      target: edge.target,
      type: edge.type,
      props,
    });
  }
  return byKey;
}

function nodeRow(node: GraphNode): Row {
  const row: Row = {
    ...flattenProps(node.props),
    id: node.id,
    label: node.label,
  };
  if (node.source_url) row.source_url = node.source_url;
  if (node.fetched_at) row.fetched_at = toIso(node.fetched_at);
  if (typeof node.confidence === "number") row.confidence = node.confidence;
  return row;
}

function flattenProps(props: Record<string, unknown>): QueryParams {
  const row: QueryParams = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "id" || key === "label") continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const flat = flattenValue(value);
    if (flat !== undefined) row[key] = flat;
  }
  return row;
}

function flattenValue(value: unknown): QueryParams[string] | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const scalars = value.filter((item) => item != null && ["string", "number", "boolean"].includes(typeof item));
    if (scalars.length === value.filter((item) => item != null).length) {
      return scalars as QueryParams[string];
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

function toIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

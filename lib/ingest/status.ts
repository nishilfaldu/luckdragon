import { graphName, listPersonGraphs, query } from "@/lib/falkor";
import { isIngesting } from "@/lib/ingest/events";
import { readPeople } from "@/lib/people";
import type { PersonRow } from "@/lib/types";

export type PersonStatus = "none" | "ingesting" | "ready";

export type PersonListRow = PersonRow & {
  status: PersonStatus;
  nodeCount: number;
  sources: string[];
};

export async function listPeople(): Promise<PersonListRow[]> {
  const people = readPeople();
  let graphs: Set<string> | null = null;
  try {
    graphs = new Set(await listPersonGraphs());
  } catch {
    graphs = null;
  }
  const rows: PersonListRow[] = [];
  for (const person of people) {
    const ingesting = isIngesting(person.slug);
    const ready = graphs?.has(graphName(person.slug)) ?? false;
    if (!ready) {
      rows.push({ ...person, status: ingesting ? "ingesting" : "none", nodeCount: 0, sources: [] });
      continue;
    }
    const stats = await graphStats(person.slug);
    rows.push({
      ...person,
      status: ingesting ? "ingesting" : "ready",
      nodeCount: stats.nodeCount,
      sources: stats.sources,
    });
  }
  return rows;
}

export async function summarizeGraph(slug: string): Promise<{
  nodes: Record<string, number>;
  edges: Record<string, number>;
  samples: Array<{ id: string; type: string; label: string }>;
}> {
  const nodes: Record<string, number> = {};
  const edges: Record<string, number> = {};
  const samples: Array<{ id: string; type: string; label: string }> = [];
  const nodeRows = await query(slug, "MATCH (n) RETURN labels(n) AS labels, n.id AS id, n.label AS label");
  for (const row of nodeRows.data) {
    const type = firstLabel(row.labels);
    nodes[type] = (nodes[type] ?? 0) + 1;
    if (samples.length < 8) {
      samples.push({
        id: String(row.id ?? ""),
        type,
        label: String(row.label ?? ""),
      });
    }
  }
  const edgeRows = await query(slug, "MATCH ()-[r]->() RETURN type(r) AS type");
  for (const row of edgeRows.data) {
    const type = String(row.type ?? "UNKNOWN");
    edges[type] = (edges[type] ?? 0) + 1;
  }
  return { nodes, edges, samples };
}

async function graphStats(slug: string): Promise<{ nodeCount: number; sources: string[] }> {
  try {
    const nodes = await query(slug, "MATCH (n) RETURN count(n) AS count");
    const accounts = await query(slug, "MATCH (a:Account) RETURN a.platform AS platform");
    const count = Number(nodes.data[0]?.count ?? 0);
    const sources = [
      ...new Set(
        accounts.data
          .map((row) => (typeof row.platform === "string" ? row.platform : ""))
          .filter(Boolean),
      ),
    ];
    return { nodeCount: Number.isFinite(count) ? count : 0, sources };
  } catch {
    return { nodeCount: 0, sources: [] };
  }
}

function firstLabel(value: unknown): string {
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (typeof value === "string") return value;
  return "Unknown";
}

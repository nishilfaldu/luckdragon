import type { GraphEdge, GraphNode, NodeType } from "@/lib/types";

/** Keep the prompt small enough for the cheap model. Structural nodes are pinned; the rest are the newest. */
export const SERIALIZE_NODE_CAP = 400;

const DATE_PROPS = ["posted_at", "published_at", "pushed_at", "at"] as const;

const PREFERRED_PROPS: Record<NodeType, string[]> = {
  Person: ["headline", "location"],
  Account: ["platform", "handle", "followers", "matched_via"],
  Organization: ["kind", "industry"],
  Post: ["platform", "likes", "text"],
  Video: ["kind", "views"],
  Repo: ["language", "stars", "description"],
  Package: ["registry", "downloads"],
  Article: ["outlet"],
  Topic: ["name"],
  Skill: ["name"],
  Location: ["name"],
};

const PINNED_TYPES = new Set<NodeType>([
  "Person",
  "Account",
  "Organization",
  "Skill",
  "Topic",
  "Location",
]);

/** ISO date (YYYY-MM-DD) from the node's own timestamp, ignoring fetched_at. */
export function contentDate(node: GraphNode): string | undefined {
  for (const key of DATE_PROPS) {
    const value = node.props[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const day = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  }
  return undefined;
}

/**
 * Compact graph text for the agent.
 * Node line: `id | Type | label | key props | date`
 * Edge line: `src -TYPE-> dst` plus any edge props.
 * Newest dated nodes come first. The root person stays at the top.
 */
export function serializeGraph(
  slug: string,
  graph: { nodes: GraphNode[]; links: GraphEdge[] },
): string {
  const kept = capNodes(graph.nodes);
  const keptIds = new Set(kept.map((node) => node.id));
  const links = graph.links.filter((link) => keptIds.has(link.source) && keptIds.has(link.target));
  const byId = new Map(kept.map((node) => [node.id, node]));

  const truncated = kept.length < graph.nodes.length;
  const header = `# ${slug} (${kept.length} nodes, ${links.length} edges${
    truncated ? `, truncated from ${graph.nodes.length}` : ""
  })`;

  const nodeLines = [...kept].sort((a, b) => compareSerialized(a, b)).map((node) => nodeLine(node, links));
  const edgeLines = [...links]
    .sort((a, b) => compareEdges(a, b, byId))
    .map((link) => edgeLine(link, byId));

  return [header, "NODES", ...nodeLines, "EDGES", ...edgeLines].join("\n");
}

function capNodes(nodes: GraphNode[]): GraphNode[] {
  if (nodes.length <= SERIALIZE_NODE_CAP) return nodes;
  const pinned = nodes.filter((node) => node.id === "person_root" || PINNED_TYPES.has(node.type));
  const rest = nodes
    .filter((node) => !pinned.includes(node))
    .sort((a, b) => compareSerialized(a, b));
  const room = Math.max(0, SERIALIZE_NODE_CAP - pinned.length);
  const kept = [...pinned, ...rest.slice(0, room)];
  if (kept.length <= SERIALIZE_NODE_CAP) return kept;
  return [...kept].sort((a, b) => compareSerialized(a, b)).slice(0, SERIALIZE_NODE_CAP);
}

function compareSerialized(a: GraphNode, b: GraphNode): number {
  if (a.id === "person_root") return -1;
  if (b.id === "person_root") return 1;
  const aDate = contentDate(a);
  const bDate = contentDate(b);
  if (aDate && bDate && aDate !== bDate) return bDate.localeCompare(aDate);
  if (aDate && !bDate) return -1;
  if (!aDate && bDate) return 1;
  return a.type.localeCompare(b.type) || a.label.localeCompare(b.label);
}

function compareEdges(a: GraphEdge, b: GraphEdge, nodes: Map<string, GraphNode>): number {
  const aFromRoot = a.source === "person_root" ? 0 : 1;
  const bFromRoot = b.source === "person_root" ? 0 : 1;
  if (aFromRoot !== bFromRoot) return aFromRoot - bFromRoot;
  const aDate = edgeDate(a, nodes);
  const bDate = edgeDate(b, nodes);
  if (aDate !== bDate) return bDate.localeCompare(aDate);
  return a.type.localeCompare(b.type) || a.source.localeCompare(b.source);
}

function edgeDate(edge: GraphEdge, nodes: Map<string, GraphNode>): string {
  const dates = [nodes.get(edge.source), nodes.get(edge.target)]
    .map((node) => (node ? contentDate(node) : undefined))
    .filter((date): date is string => Boolean(date));
  return dates.sort().at(-1) ?? "";
}

function nodeLine(node: GraphNode, links: GraphEdge[]): string {
  const hint = relationHint(node, links);
  const props = [propText(node), hint].filter(Boolean).join(" ");
  const date = contentDate(node) ?? "";
  return `${node.id} | ${node.type} | ${cell(node.label)} | ${props} | ${date}`;
}

const ROLE_EDGES = new Set(["WORKS_AT", "WORKED_AT", "STUDIED_AT"]);

/** Keep job title and dates on the organization line. They live on the edge. */
function relationHint(node: GraphNode, links: GraphEdge[]): string {
  if (node.type !== "Organization") return "";
  return links
    .filter((link) => link.source === "person_root" && link.target === node.id && ROLE_EDGES.has(link.type))
    .map((link) => {
      const props = propTextFrom(link.props ?? {}, []);
      return props ? `${link.type}(${props})` : link.type;
    })
    .join(" ");
}

function edgeLine(edge: GraphEdge, nodes: Map<string, GraphNode>): string {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  const base = `${edge.source} -${edge.type}-> ${edge.target}`;
  const labels = [source?.label, target?.label].filter(Boolean).join(" -> ");
  const extra = edge.props ? propTextFrom(edge.props, []) : "";
  const tail = [labels, extra].filter(Boolean).join(" | ");
  return tail ? `${base} | ${tail}` : base;
}

function propText(node: GraphNode): string {
  return propTextFrom(node.props, PREFERRED_PROPS[node.type], node.label);
}

function propTextFrom(props: Record<string, unknown>, preferred: string[], label?: string): string {
  const keys = preferred.length > 0 ? preferred.filter((key) => props[key] != null) : Object.keys(props);
  const parts: string[] = [];
  for (const key of keys) {
    const formatted = formatValue(props[key]);
    if (!formatted) continue;
    if (label && formatted === label) continue;
    parts.push(`${key}=${formatted}`);
  }
  return parts.join(" ");
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const clipped = text.length > 160 ? `${text.slice(0, 157)}...` : text;
  if (/[\s|"]/.test(clipped)) return `"${clipped.replace(/"/g, "'")}"`;
  return clipped;
}

function cell(value: string): string {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

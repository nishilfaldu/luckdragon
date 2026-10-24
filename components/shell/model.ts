import {
  EDGE_TYPES,
  NODE_TYPES,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type PersonRow,
} from "@/lib/types";

export type PersonListItem = PersonRow & {
  status: "none" | "ingesting" | "ready";
  nodeCount: number;
  sources: string[];
};

export type GraphPayload = {
  root: GraphNode;
  nodes: GraphNode[];
  links: GraphEdge[];
};

export type GraphState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: GraphPayload };

export type SourceRow = {
  source: string;
  status: "pending" | "fetching" | "extracting" | "writing" | "done" | "error" | "skipped";
  count?: number;
  message?: string;
};

export type IngestRun = {
  running: boolean;
  error: string | null;
  sources: SourceRow[];
};

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  cypher?: string;
  rowCount?: number;
  ms?: number;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  suggestions: string[];
};

export type ChatThread = {
  messages: UiMessage[];
  streaming: boolean;
  error: string | null;
};

export type Citation = {
  slug: string;
  nodeId: string;
};

export type FocusTarget = {
  slug: string;
  id: string;
};

export const VIEWER_KEY = "luckdragon-viewer";

const DATE_KEYS = ["posted_at", "published_at", "pushed_at", "at"];
const HIDE_PROPS = new Set(["avatar_url", "name", "matched_via", ...DATE_KEYS]);

const SOURCE_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  github: "GitHub",
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
  website: "Website",
  web: "Website",
  luma: "Luma",
  threads: "Threads",
  bluesky: "Bluesky",
  reddit: "Reddit",
  crunchbase: "Crunchbase",
  npm: "npm",
  pypi: "PyPI",
  serp: "Web search",
  research: "Research",
  seed: "Profile",
  resolve: "Identity",
  packages: "Packages",
  graph: "Graph",
};

const SOCIAL_FIELDS: { key: keyof PersonRow; label: string }[] = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "x", label: "X" },
  { key: "github", label: "GitHub" },
  { key: "youtube", label: "YouTube" },
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "website", label: "Website" },
];

function blankRow(slug: string, name: string, role: string, headline: string): PersonListItem {
  return {
    slug,
    name,
    role,
    headline,
    luma_url: "",
    avatar_url: "",
    linkedin: "",
    x: "",
    github: "",
    youtube: "",
    instagram: "",
    tiktok: "",
    website: "",
    other_links: "",
    status: "ready",
    nodeCount: 0,
    sources: [],
  };
}

export const FIXTURE_PEOPLE: PersonListItem[] = [
  blankRow("demo-viewer", "Demo Viewer", "viewer", "Fixture graph"),
  blankRow("demo-alex", "Alex", "judge", "Fixture graph"),
];

export function chatKey(viewer: string, person: string): string {
  return `${viewer}::${person}`;
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const first = parts[0][0] ?? "";
  const last = parts[parts.length - 1][0] ?? "";
  return (first + last).toUpperCase();
}

export function displayLabel(label: string): string {
  const text = label.replace(/\s+/g, " ").trim();
  if (!text.startsWith("@")) return text;
  const bare = text.replace(/^@+/, "");
  return bare ? `@${bare}` : "@";
}

export function sourceLabel(source: string): string {
  const key = source.trim().toLowerCase();
  return SOURCE_LABELS[key] ?? source;
}

export function sourceLabels(person: PersonListItem): string[] {
  if (person.sources.length > 0) {
    return [...new Set(person.sources.map(sourceLabel))];
  }
  return SOCIAL_FIELDS.filter(({ key }) => person[key].trim()).map(({ label }) => label);
}

export function citationsIn(text: string): Citation[] {
  const cites: Citation[] = [];
  const pattern = /\[\[([a-z0-9-]+):([A-Za-z0-9_]+)\]\]/g;
  for (const match of text.matchAll(pattern)) {
    const slug = match[1];
    const nodeId = match[2];
    if (!slug || !nodeId) continue;
    if (cites.some((cite) => cite.slug === slug && cite.nodeId === nodeId)) continue;
    cites.push({ slug, nodeId });
  }
  return cites;
}

export function findNode(state: GraphState | undefined, id: string): GraphNode | undefined {
  if (!state || state.status !== "ready") return undefined;
  return state.data.nodes.find((node) => node.id === id) ?? (state.data.root.id === id ? state.data.root : undefined);
}

export function presentPerson(person: PersonListItem, state: GraphState | undefined): PersonListItem {
  if (!state || state.status !== "ready") return person;
  const props = state.data.root.props;
  const graphName = str(props.name) || state.data.root.label;
  const graphHeadline = str(props.headline);
  const graphAvatar = str(props.avatar_url);
  const placeholderName = person.name === "Demo Viewer" || person.name === "Alex" || person.name === person.slug;
  const placeholderHeadline = !person.headline || person.headline === "Fixture graph";
  return {
    ...person,
    name: placeholderName && graphName ? graphName : person.name || graphName,
    headline: placeholderHeadline ? graphHeadline || person.headline : person.headline,
    avatar_url: person.avatar_url || graphAvatar,
    sources: person.sources.length > 0 ? person.sources : sourcesFromGraph(state.data),
  };
}

export function nodeDate(node: GraphNode): string | null {
  for (const key of DATE_KEYS) {
    const value = str(node.props[key]);
    if (value) return formatWhen(value);
  }
  return null;
}

export function keyProps(node: GraphNode): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(node.props)) {
    if (HIDE_PROPS.has(key) || value == null || value === "") continue;
    if (typeof value === "object") continue;
    const text = clipText(String(value));
    if (!text || text === node.label) continue;
    rows.push({ key: propName(key), value: text });
    if (rows.length === 4) break;
  }
  return rows;
}

export function matchedVia(node: GraphNode): string {
  return str(node.props.matched_via);
}

export function formatConfidence(value: number): string {
  if (value >= 0 && value <= 1) return `${Math.round(value * 100)}%`;
  return String(value);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

export function propName(key: string): string {
  return key.replace(/_/g, " ");
}

export function normalizePerson(value: unknown): PersonListItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.slug !== "string" || !raw.slug) return null;
  const status = raw.status === "ingesting" || raw.status === "ready" || raw.status === "none" ? raw.status : "none";
  const sources = Array.isArray(raw.sources) ? raw.sources.filter((item): item is string => typeof item === "string") : [];
  return {
    slug: raw.slug,
    name: str(raw.name) || raw.slug,
    role: str(raw.role),
    luma_url: str(raw.luma_url),
    headline: str(raw.headline),
    avatar_url: str(raw.avatar_url),
    linkedin: str(raw.linkedin),
    x: str(raw.x),
    github: str(raw.github),
    youtube: str(raw.youtube),
    instagram: str(raw.instagram),
    tiktok: str(raw.tiktok),
    website: str(raw.website),
    other_links: str(raw.other_links),
    status,
    nodeCount: typeof raw.nodeCount === "number" ? raw.nodeCount : 0,
    sources,
  };
}

export function normalizeGraph(value: unknown): GraphPayload | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const root = normalizeNode(raw.root);
  if (!root) return null;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes.flatMap((item) => {
    const node = normalizeNode(item);
    return node ? [node] : [];
  }) : [];
  const links = Array.isArray(raw.links) ? raw.links.flatMap((item) => {
    const link = normalizeLink(item);
    return link ? [link] : [];
  }) : [];
  return { root, nodes, links };
}

function sourcesFromGraph(graph: GraphPayload): string[] {
  const nodes = graph.nodes.some((node) => node.id === graph.root.id) ? graph.nodes : [graph.root, ...graph.nodes];
  const found: string[] = [];
  for (const node of nodes) {
    if (node.type !== "Account") continue;
    const platform = str(node.props.platform);
    if (platform && !found.includes(platform)) found.push(platform);
  }
  return found;
}

function formatWhen(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(time));
}

function clipText(value: string, max = 140): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function isNodeType(value: string): value is NodeType {
  return (NODE_TYPES as readonly string[]).includes(value);
}

function isEdgeType(value: string): value is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(value);
}

function normalizeNode(value: unknown): GraphNode | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.label !== "string" || typeof raw.type !== "string") return null;
  if (!isNodeType(raw.type)) return null;
  const props = raw.props && typeof raw.props === "object" && !Array.isArray(raw.props)
    ? { ...(raw.props as Record<string, unknown>) }
    : {};
  const node: GraphNode = { id: raw.id, type: raw.type, label: raw.label, props };
  if (typeof raw.source_url === "string") node.source_url = raw.source_url;
  if (typeof raw.fetched_at === "string") node.fetched_at = raw.fetched_at;
  if (typeof raw.confidence === "number") node.confidence = raw.confidence;
  return node;
}

function normalizeLink(value: unknown): GraphEdge | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.source !== "string" || typeof raw.target !== "string" || typeof raw.type !== "string") return null;
  if (!isEdgeType(raw.type)) return null;
  const link: GraphEdge = { source: raw.source, target: raw.target, type: raw.type };
  if (raw.props && typeof raw.props === "object" && !Array.isArray(raw.props)) {
    link.props = raw.props as Record<string, unknown>;
  }
  return link;
}

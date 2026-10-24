import { z } from "zod";
import { nameKey, urlKey, type RawItem } from "@/lib/ingest/items";
import { structured } from "@/lib/ingest/openai";
import { nodeId, PERSON_ROOT_ID } from "@/lib/ingest/store";
import type { GraphEdge, GraphNode, NodeType, PersonRow } from "@/lib/types";
import { EDGE_TYPES, NODE_TYPES } from "@/lib/types";

const pair = z.object({ key: z.string(), value: z.string() });

const ExtractionSchema = z.object({
  nodes: z.array(
    z.object({
      type: z.enum(NODE_TYPES),
      label: z.string(),
      key: z.string(),
      source_url: z.string().nullable(),
      confidence: z.number(),
      props: z.array(pair),
    }),
  ),
  edges: z.array(
    z.object({
      type: z.enum(EDGE_TYPES),
      source_type: z.enum(NODE_TYPES),
      source_key: z.string(),
      target_type: z.enum(NODE_TYPES),
      target_key: z.string(),
      props: z.array(pair),
    }),
  ),
});

export type GraphBatch = { nodes: GraphNode[]; edges: GraphEdge[] };

export async function extractBatch(person: PersonRow, source: string, items: RawItem[]): Promise<GraphBatch> {
  if (items.length === 0) return { nodes: [], edges: [] };
  const fetchedAt = new Date().toISOString();
  try {
    return stampVia(await extractWithModel(person, source, items, fetchedAt), source);
  } catch (error) {
    const fallback = fallbackGraph(source, items, fetchedAt);
    if (fallback.nodes.length === 0) throw error;
    return fallback;
  }
}

async function extractWithModel(
  person: PersonRow,
  source: string,
  items: RawItem[],
  fetchedAt: string,
): Promise<GraphBatch> {
  const payload = items.slice(0, 20).map((item) => ({
    url: item.url,
    kind: item.kind,
    title: item.title ?? "",
    date: item.date ?? "",
    text: (item.text ?? "").slice(0, 900),
    meta: item.meta ?? {},
  }));
  const instructions = [
    `Turn these ${source} items about ${person.name} into graph nodes and edges.`,
    person.headline ? `Headline: ${person.headline}.` : "",
    "The person already exists as key \"root\". Do not emit a Person node.",
    "key is the item URL when there is one, otherwise the normalized name.",
    "source_url is that URL or null. confidence is 0 to 1. Do not invent URLs.",
    "Create Topic nodes (free text) and Skill nodes. Link posts, videos, repos, and articles to topics with ABOUT.",
    "Link the person with AUTHORED (prop at = the date), HAS_SKILL, WORKS_AT or WORKED_AT (props title, start, end), STUDIED_AT (degree, start, end), BASED_IN, and POSTED_ON from a post or video to its Account.",
    "Account props: platform, handle, url, followers, matched_via (luma, search, or agent).",
    "Repo props: name, url, description, stars, language, pushed_at. Video props: title, url, published_at, views, kind (talk, podcast, or video).",
    "Post props: platform, text, url, posted_at, likes. Article props: title, url, published_at, outlet.",
    "Organization props: name, kind (company, school, or community), url, industry, size.",
    "Package props: registry, name, url, downloads. Location props: name.",
    "props is a list of {key, value} strings. Use an empty list when there are none.",
    "Skip items that are not about this person.",
    JSON.stringify(payload),
  ]
    .filter(Boolean)
    .join("\n");

  const parsed = await structured("graph_extract", ExtractionSchema, instructions);
  return materialize(parsed, fetchedAt);
}

function materialize(parsed: z.infer<typeof ExtractionSchema>, fetchedAt: string): GraphBatch {
  const nodes: GraphNode[] = [];
  const index = new Map<string, string>();
  index.set("Person|root", PERSON_ROOT_ID);
  index.set(`Person|${nameKey("root")}`, PERSON_ROOT_ID);

  for (const node of parsed.nodes) {
    if (node.type === "Person") continue;
    const key = canonicalKey(node.key, node.source_url);
    if (!key || !node.label.trim()) continue;
    const id = nodeId(node.type, key);
    const props = pairsToProps(node.props);
    nodes.push({
      id,
      type: node.type,
      label: node.label.trim(),
      props,
      source_url: node.source_url || (node.key.startsWith("http") ? urlKey(node.key) : undefined),
      fetched_at: fetchedAt,
      confidence: clamp(node.confidence),
    });
    remember(index, node.type, node.key, id);
    remember(index, node.type, key, id);
  }

  const edges: GraphEdge[] = [];
  for (const edge of parsed.edges) {
    const source = lookup(index, edge.source_type, edge.source_key);
    const target = lookup(index, edge.target_type, edge.target_key);
    if (!source || !target) continue;
    edges.push({
      source,
      target,
      type: edge.type,
      props: pairsToProps(edge.props),
    });
  }
  return { nodes, edges };
}

export function fallbackGraph(source: string, items: RawItem[], fetchedAt: string): GraphBatch {
  if (source === "github") return stampVia(githubFallback(items, fetchedAt), source);
  if (source === "website" || source === "luma" || source === "research" || source === "serp") {
    return stampVia(pageFallback(source, items, fetchedAt), source);
  }
  return { nodes: [], edges: [] };
}

function githubFallback(items: RawItem[], fetchedAt: string): GraphBatch {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const skills = new Set<string>();
  for (const item of items) {
    if (item.kind !== "repo" || !item.url.startsWith("http")) continue;
    const id = nodeId("Repo", urlKey(item.url));
    const language = typeof item.meta?.language === "string" ? item.meta.language : "";
    const stars = typeof item.meta?.stars === "number" ? item.meta.stars : Number(item.meta?.stars ?? 0);
    nodes.push({
      id,
      type: "Repo",
      label: item.title || item.url,
      props: {
        name: item.title || "",
        url: item.url,
        description: item.text || "",
        stars: Number.isFinite(stars) ? stars : 0,
        language,
        pushed_at: item.date || "",
      },
      source_url: item.url,
      fetched_at: fetchedAt,
      confidence: 0.9,
    });
    edges.push({ source: PERSON_ROOT_ID, target: id, type: "AUTHORED", props: { at: item.date || "" } });
    if (language) skills.add(language);
  }
  for (const skill of skills) {
    const id = nodeId("Skill", nameKey(skill));
    nodes.push({
      id,
      type: "Skill",
      label: skill,
      props: { name: skill },
      fetched_at: fetchedAt,
      confidence: 0.8,
    });
    edges.push({ source: PERSON_ROOT_ID, target: id, type: "HAS_SKILL" });
  }
  return { nodes, edges };
}

function pageFallback(source: string, items: RawItem[], fetchedAt: string): GraphBatch {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const item of items) {
    if (!item.url.startsWith("http")) continue;
    if (item.kind === "profile" && source === "luma") {
      const company = typeof item.meta?.company === "string" ? item.meta.company : "";
      const job = typeof item.meta?.job_title === "string" ? item.meta.job_title : "";
      if (company && company.toLowerCase() !== "independent") {
        const id = nodeId("Organization", nameKey(company));
        nodes.push({
          id,
          type: "Organization",
          label: company,
          props: { name: company, kind: "company", url: "" },
          source_url: item.url,
          fetched_at: fetchedAt,
          confidence: 0.7,
        });
        edges.push({
          source: PERSON_ROOT_ID,
          target: id,
          type: "WORKS_AT",
          props: { title: job },
        });
      }
      continue;
    }
    const id = nodeId("Article", urlKey(item.url));
    nodes.push({
      id,
      type: "Article",
      label: item.title || item.url,
      props: {
        title: item.title || "",
        url: item.url,
        published_at: item.date || "",
        outlet: source,
      },
      source_url: item.url,
      fetched_at: fetchedAt,
      confidence: 0.6,
    });
    edges.push({ source: PERSON_ROOT_ID, target: id, type: "AUTHORED", props: { at: item.date || "" } });
  }
  return { nodes, edges };
}

export function mergeGraphs(batches: GraphBatch[]): GraphBatch {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const batch of batches) {
    for (const node of batch.nodes) {
      const prev = nodes.get(node.id);
      if (!prev) {
        nodes.set(node.id, node);
        continue;
      }
      const incomingWins = (node.confidence ?? 0) > (prev.confidence ?? 0);
      const winner = incomingWins ? node : prev;
      const loser = incomingWins ? prev : node;
      nodes.set(node.id, { ...winner, props: { ...loser.props, ...winner.props } });
    }
    for (const edge of batch.edges) {
      edges.set(`${edge.source}|${edge.type}|${edge.target}`, edge);
    }
  }
  const present = new Set(nodes.keys());
  for (const [key, edge] of [...edges]) {
    if (!present.has(edge.source) || !present.has(edge.target)) edges.delete(key);
  }
  const weights = new Map<string, number>();
  for (const edge of edges.values()) {
    if (edge.type !== "ABOUT") continue;
    const topic = nodes.get(edge.target);
    if (topic?.type !== "Topic") continue;
    weights.set(edge.target, (weights.get(edge.target) ?? 0) + 1);
  }
  for (const [topicId, weight] of weights) {
    edges.set(`${PERSON_ROOT_ID}|INTERESTED_IN|${topicId}`, {
      source: PERSON_ROOT_ID,
      target: topicId,
      type: "INTERESTED_IN",
      props: { weight },
    });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function seedGraph(
  person: PersonRow,
  accounts: KnownAccountLike[],
  fetchedAt: string,
): GraphBatch {
  const nodes: GraphNode[] = [
    {
      id: PERSON_ROOT_ID,
      type: "Person",
      label: person.name,
      props: {
        name: person.name,
        headline: person.headline,
        avatar_url: person.avatar_url,
        luma_url: person.luma_url,
        role: person.role,
      },
      source_url: person.luma_url || undefined,
      fetched_at: fetchedAt,
      confidence: 1,
    },
  ];
  const edges: GraphEdge[] = [];
  for (const account of accounts) {
    const id = nodeId("Account", urlKey(account.url));
    nodes.push({
      id,
      type: "Account",
      label: account.platform,
      props: {
        platform: account.platform,
        handle: handleOf(account.url),
        url: account.url,
        matched_via: account.matched_via,
        followers: 0,
      },
      source_url: account.url,
      fetched_at: fetchedAt,
      confidence: account.confidence,
    });
    edges.push({ source: PERSON_ROOT_ID, target: id, type: "HAS_ACCOUNT" });
  }
  return stampVia({ nodes, edges }, "seed");
}

/** Ingest source ids recorded on each node as `props.via`. */
const VIA_SOURCES = new Set([
  "linkedin",
  "x",
  "serp",
  "website",
  "luma",
  "github",
  "youtube",
  "bluesky",
  "reddit",
  "instagram",
  "threads",
  "crunchbase",
  "packages",
  "research",
  "resolve",
  "seed",
]);

function stampVia(batch: GraphBatch, source: string): GraphBatch {
  const via = source.trim().toLowerCase();
  if (!VIA_SOURCES.has(via)) return batch;
  return {
    nodes: batch.nodes.map((node) => ({
      ...node,
      props: { ...node.props, via },
    })),
    edges: batch.edges,
  };
}

type KnownAccountLike = { platform: string; url: string; matched_via: string; confidence: number };

function canonicalKey(key: string, sourceUrl: string | null): string {
  if (sourceUrl && sourceUrl.startsWith("http")) return urlKey(sourceUrl);
  if (key.startsWith("http")) return urlKey(key);
  return nameKey(key);
}

function remember(index: Map<string, string>, type: NodeType, key: string, id: string): void {
  index.set(`${type}|${key}`, id);
  index.set(`${type}|${nameKey(key)}`, id);
  if (key.startsWith("http")) index.set(`${type}|${urlKey(key)}`, id);
}

function lookup(index: Map<string, string>, type: NodeType, key: string): string | undefined {
  if (type === "Person" || key === "root") return PERSON_ROOT_ID;
  return index.get(`${type}|${key}`) ?? index.get(`${type}|${nameKey(key)}`) ?? (key.startsWith("http") ? index.get(`${type}|${urlKey(key)}`) : undefined);
}

function pairsToProps(pairs: Array<{ key: string; value: string }>): Record<string, string | number> {
  const props: Record<string, string | number> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !pair.value.trim()) continue;
    const numeric = Number(pair.value);
    props[key] = pair.value.trim() !== "" && Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(pair.value.trim())
      ? numeric
      : pair.value.trim();
  }
  return props;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function handleOf(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return (parts[parts.length - 1] ?? "").replace(/^@/, "");
  } catch {
    return "";
  }
}

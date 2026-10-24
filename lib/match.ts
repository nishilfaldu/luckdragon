import { listPersonGraphs, roQuery } from "@/lib/falkor";
import { assertPersonSlug } from "@/lib/graph/ids";
import { readPeople } from "@/lib/people";
import { isProtectedText } from "@/lib/protected";
import type { PersonRow } from "@/lib/types";

const FACETS = ["Organization", "Skill", "Topic", "Location"] as const;

type Facet = (typeof FACETS)[number];

const WEIGHT: Record<Facet, number> = {
  Organization: 3,
  Skill: 2,
  Topic: 1,
  Location: 1,
};

/** How many graphs to read at once. Falkor is local, but a room of profiles still shouldn't stampede it. */
const CONCURRENCY = 4;

const CACHE_MS = 60_000;

const SHARED_LIMIT = 5;

/** Labels longer than this are sentences, not chips. */
const MAX_WORDS = 5;
const MAX_CHARS = 48;

/**
 * Applied after singularizing, so "agents" and "large language models" hit the singular keys.
 * Values are the canonical label and are not singularized again.
 */
const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  llm: "llm",
  llms: "llm",
  "large language model": "llm",
  "large language models": "llm",
  agent: "ai agents",
  agents: "ai agents",
  "ai agent": "ai agents",
  "ai agents": "ai agents",
  "agent skill": "agent skills",
  "ai agent skill": "agent skills",
  ml: "machine learning",
  "artificial intelligence": "ai",
  "model context protocol": "mcp",
  "next js": "nextjs",
  nextjs: "nextjs",
  "node js": "nodejs",
  nodejs: "nodejs",
  "react js": "react",
  reactjs: "react",
};

const PRETTY: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  llm: "LLM",
  ai: "AI",
  "ai agents": "AI agents",
  "agent skills": "Agent skills",
  "machine learning": "Machine learning",
  mcp: "MCP",
  nextjs: "Next.js",
  nodejs: "Node.js",
  "san francisco": "San Francisco",
  cincinnati: "Cincinnati",
};

/** Not plurals. Singularizing them manufactures junk stems ("analysis" → "analysi"). */
const UNCOUNTABLE = new Set(["series", "species", "news", "maths", "graphics"]);

/**
 * Labels that show up as overlap and mean nothing. Kept small on purpose;
 * rare real labels should still score.
 */
const SKIP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "http",
  "https",
  "www",
  "com",
  "org",
  "null",
  "none",
  "undefined",
  "unknown",
  "n a",
  "na",
  "other",
  "various",
  "general",
  "misc",
  "independent",
  "self employed",
  "freelance",
  "freelancer",
  "student",
  // Resume sludge and GitHub linguist defaults. They overlapped constantly and
  // outranked the labels people actually have in common.
  "software engineering",
  "software development",
  "web development",
  "software",
  "programming",
  "computer science",
  "technology",
  "tech",
  "internet",
  "html",
  "css",
  "shell",
  "makefile",
  "dockerfile",
  "markdown",
  "batchfile",
  "powershell",
  "json",
  "yaml",
  "xml",
  "svg",
  "toml",
  "readme",
  "github profile",
  "github profile readme",
  "personal website",
  "personal websites",
  "story",
]);

export type SharedGround = {
  type: Facet;
  label: string;
  viewerNodeId: string;
  theirNodeId: string;
};

export type PersonMatch = {
  slug: string;
  name: string;
  headline: string;
  avatar_url: string;
  role: string;
  score: number;
  shared: SharedGround[];
  /** Newest dated item tied to the overlap, or their newest item overall. */
  whyNow: WhyNow | null;
};

export type WhyNow = {
  nodeId: string;
  type: string;
  label: string;
  date: string;
  sharedLabel?: string;
  url?: string;
};

export type RoomPlanRow = {
  slug: string;
  name: string;
  headline: string;
  avatar_url: string;
  role: string;
  score: number;
  shared: SharedGround[];
  whyNow: WhyNow | null;
  opener: string;
};

type Signal = {
  type: Facet;
  key: string;
  label: string;
  id: string;
};

type Profile = {
  slug: string;
  name: string;
  headline: string;
  avatar_url: string;
  role: string;
  signals: Map<string, Signal>;
};

type CacheEntry = { at: number; matches: PersonMatch[] };

const globalForMatch = globalThis as typeof globalThis & {
  __luckdragonMatches?: Map<string, CacheEntry>;
  __luckdragonMatchesInflight?: Map<string, Promise<PersonMatch[]>>;
};

/**
 * Rank other people by weighted label overlap with the viewer.
 * Organization 3, Skill 2, Topic 1, Location 1, times an IDF factor so a label
 * everyone has (df = N) counts less than a label only a few graphs mention.
 * `candidates` limits who is scored; omit it to score every other stored graph.
 * Results are cached for 60 seconds per viewer (and candidate set).
 */
export async function matchesFor(
  viewerSlug: string,
  candidates?: string[],
  dropProtected = true,
): Promise<PersonMatch[]> {
  const all = await allMatches(viewerSlug, candidates);
  return dropProtected ? all.flatMap(withoutProtected) : all;
}

/** Drop protected shared items and why-now items; a match with nothing left to share is dropped. */
function withoutProtected(match: PersonMatch): PersonMatch[] {
  const shared = match.shared.filter((item) => !isProtectedText(item.label));
  if (shared.length === 0) return [];
  const whyNow =
    match.whyNow && !isProtectedText(`${match.whyNow.label} ${match.whyNow.sharedLabel ?? ""}`) ? match.whyNow : null;
  return [{ ...match, shared, whyNow }];
}

async function allMatches(viewerSlug: string, candidates?: string[]): Promise<PersonMatch[]> {
  const viewer = viewerSlug.trim();
  if (!viewer) return [];

  const key = cacheKey(viewer, candidates);
  const now = Date.now();
  const hit = cache().get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.matches;

  const pending = inflight().get(key);
  if (pending) return pending;

  const promise = compute(viewer, candidates)
    .then((matches) => {
      cache().set(key, { at: Date.now(), matches });
      inflight().delete(key);
      return matches;
    })
    .catch((error: unknown) => {
      inflight().delete(key);
      throw error;
    });
  inflight().set(key, promise);
  return promise;
}

/** Lowercase, strip punctuation, singularize, then apply the alias map. */
export function normalizeLabel(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9+#\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const singular = cleaned
    .split(" ")
    .map((word) => (UNCOUNTABLE.has(word) ? word : singularizeWord(word)))
    .join(" ");
  return ALIASES[singular] ?? singular;
}

async function compute(viewerSlug: string, candidates: string[] | undefined): Promise<PersonMatch[]> {
  // Fixture graphs (demo-*) are for development only.
  const graphs = (await listPersonGraphs()).filter((name) => !name.startsWith("person:demo-"));
  const slugs = graphs.map(slugOf).filter((slug): slug is string => slug !== null);
  if (!slugs.includes(viewerSlug)) return [];

  const allowed = candidates ? new Set(candidates.map((slug) => slug.trim()).filter(Boolean)) : null;
  const targets = slugs.filter((slug) => slug === viewerSlug || (slug !== viewerSlug && (!allowed || allowed.has(slug))));
  const people = peopleBySlug();
  const profiles = (
    await mapPool(targets, CONCURRENCY, (slug) => loadProfile(slug, people, slug === viewerSlug))
  ).filter((profile): profile is Profile => profile !== null);

  const viewer = profiles.find((profile) => profile.slug === viewerSlug);
  if (!viewer || viewer.signals.size === 0) return [];

  const df = new Map<string, number>();
  for (const profile of profiles) {
    for (const key of profile.signals.keys()) df.set(key, (df.get(key) ?? 0) + 1);
  }
  const total = profiles.length;

  const ranked: Array<Omit<PersonMatch, "whyNow"> & { sharedCount: number }> = [];
  for (const other of profiles) {
    if (other.slug === viewer.slug) continue;
    const found = overlap(viewer, other, df, total);
    if (found.length === 0) continue;
    const score = round(found.reduce((sum, item) => sum + item.contribution, 0));
    if (score <= 0) continue;
    ranked.push({
      slug: other.slug,
      name: other.name,
      headline: other.headline,
      avatar_url: other.avatar_url,
      role: other.role,
      score,
      shared: found.slice(0, SHARED_LIMIT).map((item) => ({
        type: item.type,
        label: item.label,
        viewerNodeId: item.viewerNodeId,
        theirNodeId: item.theirNodeId,
      })),
      sharedCount: found.length,
    });
  }

  ranked.sort((a, b) => b.score - a.score || b.sharedCount - a.sharedCount || a.name.localeCompare(b.name));
  const ordered = ranked.map((match) => ({
    slug: match.slug,
    name: match.name,
    headline: match.headline,
    avatar_url: match.avatar_url,
    role: match.role,
    score: match.score,
    shared: match.shared,
  }));
  return mapPool(ordered, CONCURRENCY, async (match) => ({
    ...match,
    whyNow: await whyNowFor(match.slug, match.shared),
  }));
}

/**
 * Top matches plus a one-sentence opener. The opener names their why-now item
 * and, when one exists, the viewer's newest item on that same shared label.
 */
export async function planFor(viewerSlug: string, limit: number, dropProtected = true): Promise<RoomPlanRow[]> {
  const matches = await matchesFor(viewerSlug, undefined, dropProtected);
  const slice = matches.slice(0, Math.max(0, limit));
  return mapPool(slice, CONCURRENCY, (match) => planRow(viewerSlug, match));
}

type ScoredShare = SharedGround & { contribution: number };

function overlap(viewer: Profile, other: Profile, df: Map<string, number>, total: number): ScoredShare[] {
  const found: ScoredShare[] = [];
  for (const [key, mine] of viewer.signals) {
    const theirs = other.signals.get(key);
    if (!theirs) continue;
    const seen = df.get(key) ?? 1;
    const idf = Math.log((total + 1) / seen);
    // Topic "TypeScript" still matches skill "TypeScript", scored as the weaker type.
    const contribution = Math.min(WEIGHT[mine.type], WEIGHT[theirs.type]) * idf;
    if (contribution <= 0) continue;
    found.push({
      type: mine.type,
      label: mine.label,
      viewerNodeId: mine.id,
      theirNodeId: theirs.id,
      contribution,
    });
  }

  // Same words stored as both a skill and a topic should count once, at the heavier type.
  const best = new Map<string, ScoredShare>();
  for (const item of found) {
    const labelKey = normalizeLabel(item.label);
    const prev = best.get(labelKey);
    if (!prev || item.contribution > prev.contribution) best.set(labelKey, item);
  }

  return [...best.values()].sort(
    (a, b) => b.contribution - a.contribution || WEIGHT[b.type] - WEIGHT[a.type] || a.label.localeCompare(b.label),
  );
}

async function loadProfile(slug: string, people: Map<string, PersonRow>, required: boolean): Promise<Profile | null> {
  try {
    const [root, ...groups] = await Promise.all([
      roQuery(
        slug,
        "MATCH (p:Person {id: 'person_root'}) RETURN coalesce(p.label, p.name, '') AS name, coalesce(p.headline, '') AS headline, coalesce(p.avatar_url, '') AS avatar_url, coalesce(p.role, '') AS role LIMIT 1",
      ),
      ...FACETS.map((type) =>
        roQuery(
          slug,
          `MATCH (n:${type}) RETURN n.id AS id, coalesce(n.label, n.name, '') AS label ORDER BY n.id`,
        ),
      ),
      roQuery(
        slug,
        "MATCH (r:Repo)-[:USES]->(s:Skill) RETURN s.id AS id, coalesce(s.label, s.name, r.language, '') AS label ORDER BY s.id",
      ),
      roQuery(
        slug,
        "MATCH (r:Repo) WHERE r.language IS NOT NULL AND r.language <> '' RETURN r.id AS id, r.language AS label ORDER BY r.id",
      ),
    ]);

    const signals = new Map<string, Signal>();
    FACETS.forEach((type, index) => {
      addNodes(signals, type, groups[index]?.data ?? [], false);
    });
    addNodes(signals, "Skill", groups[FACETS.length]?.data ?? [], false);
    addNodes(signals, "Skill", groups[FACETS.length + 1]?.data ?? [], true);

    const row = root.data[0];
    const person = people.get(slug);
    const graphName = text(row?.name);
    const graphHeadline = text(row?.headline);
    const graphAvatar = text(row?.avatar_url);

    return {
      slug,
      name: person?.name || graphName || slug,
      headline: person?.headline || graphHeadline || "",
      avatar_url: person?.avatar_url || graphAvatar || "",
      role: person?.role || text(row?.role) || "",
      signals,
    };
  } catch (error) {
    if (required) throw error;
    const message = error instanceof Error ? error.message : "query failed";
    if (!/does not exist/i.test(message)) console.error(`match: skip ${slug}: ${message}`);
    return null;
  }
}

function addNodes(
  signals: Map<string, Signal>,
  type: Facet,
  rows: Record<string, unknown>[],
  fromRepo: boolean,
): void {
  for (const row of rows) {
    const raw = text(row.label);
    const key = canonicalKey(type, normalizeLabel(raw));
    if (!keep(key)) continue;
    const id = text(row.id);
    if (!id) continue;
    const next: Signal = { type, key, label: displayLabel(raw, key), id };
    const prev = signals.get(key);
    if (!prev) {
      signals.set(key, next);
      continue;
    }
    if (fromRepo) {
      signals.set(key, { ...prev, label: nicer(prev.label, next.label) });
      continue;
    }
    signals.set(key, betterSignal(prev, next));
  }
}

/** One concept, one bucket. A skill beats a topic; a real node beats a repo language. */
function betterSignal(prev: Signal, next: Signal): Signal {
  const prevWeight = WEIGHT[prev.type];
  const nextWeight = WEIGHT[next.type];
  const label = nicer(prev.label, next.label);
  if (nextWeight > prevWeight) return { ...next, label };
  if (nextWeight < prevWeight) return { ...prev, label };
  if (next.type === "Location" && prev.type !== "Location") return { ...next, label };
  return { ...prev, label, id: preferId(prev.type, prev.id, next.id) };
}

function canonicalKey(type: Facet, key: string): string {
  if (type === "Location") return foldPlace(key);
  if (type === "Organization") return foldOrg(key);
  return key;
}

function foldPlace(key: string): string {
  if (key === "sf" || key === "sfo" || key === "bay area" || key === "sf bay area") return "san francisco";
  const text = key.replace("bay area", " ").replace(/\s+/g, " ").trim();
  const drop = new Set([
    "ca",
    "california",
    "ny",
    "nyc",
    "oh",
    "ohio",
    "dc",
    "uk",
    "us",
    "usa",
    "bay",
    "area",
    "united",
    "state",
    "states",
    "kingdom",
    "america",
  ]);
  const kept = text.split(" ").filter((word) => word && !drop.has(word));
  return kept.length > 0 ? kept.join(" ") : key;
}

function foldOrg(key: string): string {
  const drop = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "company"]);
  const kept = key.split(" ").filter((word) => !drop.has(word));
  return kept.length > 0 ? kept.join(" ") : key;
}

function keep(key: string): boolean {
  if (key.length < 2 || key.length > MAX_CHARS) return false;
  if (key.split(" ").length > MAX_WORDS) return false;
  if (SKIP.has(key)) return false;
  if (key.includes("github profile") || key.includes("personal website")) return false;
  if (key === "readme" || key.endsWith(" readme")) return false;
  if (/^\d+$/.test(key)) return false;
  return true;
}

function displayLabel(raw: string, normalized: string): string {
  const pretty = PRETTY[normalized];
  if (pretty) return pretty;
  const trimmed = raw.trim();
  if (!trimmed) return titleCase(normalized);
  if (trimmed === trimmed.toLowerCase()) return titleCase(trimmed);
  return trimmed;
}

function nicer(current: string, next: string): string {
  return labelScore(next) > labelScore(current) ? next : current;
}

function labelScore(value: string): number {
  const capitals = value.replace(/[^A-Z]/g, "").length;
  const lowers = value.replace(/[^a-z]/g, "").length;
  const mixed = capitals > 0 && lowers > 0 ? 100 : 0;
  return mixed + Math.min(value.length, 48);
}

function preferId(type: Facet, current: string, next: string): string {
  const prefix = `${type.toLowerCase()}_`;
  if (next.startsWith(prefix) && !current.startsWith(prefix)) return next;
  return current;
}

function singularizeWord(word: string): string {
  if (word.length <= 4) return word;
  if (!word.endsWith("s")) return word;
  if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) return word;
  return word.slice(0, -1);
}

function titleCase(value: string): string {
  return value.replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}

function peopleBySlug(): Map<string, PersonRow> {
  try {
    const map = new Map<string, PersonRow>();
    for (const person of readPeople()) map.set(person.slug, person);
    return map;
  } catch {
    return new Map();
  }
}

function slugOf(graph: string): string | null {
  if (!graph.startsWith("person:")) return null;
  try {
    return assertPersonSlug(graph.slice("person:".length));
  } catch {
    return null;
  }
}

function cacheKey(viewer: string, candidates: string[] | undefined): string {
  const list = candidates?.map((slug) => slug.trim()).filter(Boolean).sort().join(",") ?? "";
  return `why2:${viewer}::${list}`;
}

function cache(): Map<string, CacheEntry> {
  if (!globalForMatch.__luckdragonMatches) globalForMatch.__luckdragonMatches = new Map();
  return globalForMatch.__luckdragonMatches;
}

function inflight(): Map<string, Promise<PersonMatch[]>> {
  if (!globalForMatch.__luckdragonMatchesInflight) globalForMatch.__luckdragonMatchesInflight = new Map();
  return globalForMatch.__luckdragonMatchesInflight;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return "";
}

/**
 * Date props on ingested graphs: Post.posted_at, Video/Article.published_at, Repo.pushed_at.
 * `date` is rarely stored. AUTHORED.at copies the item date and covers nodes that only have that.
 */
const DATED = `coalesce(
  CASE WHEN i.posted_at <> '' THEN i.posted_at END,
  CASE WHEN i.published_at <> '' THEN i.published_at END,
  CASE WHEN i.pushed_at <> '' THEN i.pushed_at END,
  CASE WHEN i.date <> '' THEN i.date END,
  CASE WHEN a.at <> '' THEN a.at END
)`;

const CONTENT = "(i:Post OR i:Video OR i:Repo OR i:Article OR i:Package)";

const CONNECTED_ITEM = `
MATCH (i)
WHERE ${CONTENT}
OPTIONAL MATCH (i)-[:ABOUT|USES]->(t)
WHERE t.id IN $ids OR toLower(coalesce(t.label, t.name, '')) IN $labels
WITH i, head(collect(coalesce(t.label, t.name))) AS via
WHERE (via IS NOT NULL AND via <> '')
   OR toLower(coalesce(i.language, '')) IN $labels
   OR toLower(coalesce(i.label, '')) IN $labels
   OR toLower(coalesce(i.name, '')) IN $labels
OPTIONAL MATCH (:Person)-[a:AUTHORED]->(i)
WITH i, via, ${DATED} AS dated
WHERE dated IS NOT NULL AND dated <> ''
RETURN i.id AS nodeId, labels(i)[0] AS type, coalesce(i.label, i.name, i.title, '') AS label,
  dated AS date,
  CASE
    WHEN via IS NOT NULL AND via <> '' THEN via
    WHEN toLower(coalesce(i.language, '')) IN $labels THEN coalesce(i.language, '')
    ELSE coalesce(i.label, i.name, '')
  END AS sharedLabel,
  coalesce(i.url, i.source_url, '') AS url
ORDER BY dated DESC
LIMIT 1`;

const LATEST_ITEM = `
MATCH (i)
WHERE ${CONTENT}
OPTIONAL MATCH (:Person)-[a:AUTHORED]->(i)
WITH i, ${DATED} AS dated
WHERE dated IS NOT NULL AND dated <> ''
RETURN i.id AS nodeId, labels(i)[0] AS type, coalesce(i.label, i.name, i.title, '') AS label,
  dated AS date, coalesce(i.url, i.source_url, '') AS url
ORDER BY dated DESC
LIMIT 1`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function planRow(viewerSlug: string, match: PersonMatch): Promise<RoomPlanRow> {
  const shared = chipsFor(match);
  const focus = focusShares(match);
  const viewerItem = focus.length > 0 ? await connectedItem(viewerSlug, focus) : null;
  return {
    slug: match.slug,
    name: match.name,
    headline: match.headline,
    avatar_url: match.avatar_url,
    role: match.role,
    score: match.score,
    shared,
    whyNow: match.whyNow,
    opener: openerFor(match.whyNow, viewerItem, shared),
  };
}

/** Their newest item on a shared label, else their newest dated item. */
async function whyNowFor(slug: string, shared: SharedGround[]): Promise<WhyNow | null> {
  try {
    const connected = await connectedItem(slug, shared);
    if (connected) return connected;
    const latest = await roQuery(slug, LATEST_ITEM);
    return readWhy(latest.data[0], false);
  } catch (error) {
    const message = error instanceof Error ? error.message : "query failed";
    if (!/does not exist/i.test(message)) console.error(`why-now: skip ${slug}: ${message}`);
    return null;
  }
}

/** Newest Post, Video, Repo, Article, or Package tied to these labels. No overall fallback. */
async function connectedItem(slug: string, shared: SharedGround[]): Promise<WhyNow | null> {
  const ids = [...new Set(shared.flatMap((item) => [item.viewerNodeId, item.theirNodeId]).filter(Boolean))];
  const labels = labelKeys(shared);
  if (ids.length === 0 && labels.length === 0) return null;
  try {
    const result = await roQuery(slug, CONNECTED_ITEM, {
      ids: ids.length > 0 ? ids : ["__none__"],
      labels: labels.length > 0 ? labels : ["__none__"],
    });
    return readWhy(result.data[0], true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "query failed";
    if (/does not exist/i.test(message)) return null;
    throw error;
  }
}

/** Keep the why-now label in the three chips when it is one of the scored shares. */
function chipsFor(match: PersonMatch): SharedGround[] {
  const label = match.whyNow?.sharedLabel;
  const top = match.shared.slice(0, 3);
  if (!label) return top;
  const hit = match.shared.find((item) => sameLabel(item.label, label));
  if (!hit || top.some((item) => sameLabel(item.label, label))) return top;
  return [hit, ...top.filter((item) => item !== hit)].slice(0, 3);
}

function focusShares(match: PersonMatch): SharedGround[] {
  const label = match.whyNow?.sharedLabel;
  if (!label) return match.shared.slice(0, 3);
  const hit = match.shared.filter((item) => sameLabel(item.label, label));
  if (hit.length > 0) return hit;
  return [{ type: "Topic", label, viewerNodeId: "", theirNodeId: "" }];
}

function openerFor(why: WhyNow | null, viewerItem: WhyNow | null, shared: SharedGround[]): string {
  if (!why) {
    const labels = shared.slice(0, 2).map((item) => item.label).filter(Boolean);
    if (labels.length === 0) return "";
    return labels.length === 1 ? `You share ${labels[0]}.` : `You share ${labels[0]} and ${labels[1]}.`;
  }
  const type = why.type.toLowerCase();
  const subject = clip(why.sharedLabel || why.label, 72);
  const lead = `Saw your ${type} on ${subject} (${formatMatchDay(why.date)})`;
  if (!viewerItem?.label) return `${lead}.`;
  return `${lead}, I've been working on ${clip(viewerItem.label, 72)}.`;
}

function labelKeys(shared: SharedGround[]): string[] {
  const keys = new Set<string>();
  for (const item of shared) {
    const raw = item.label.toLowerCase().trim();
    if (raw) keys.add(raw);
    const norm = normalizeLabel(item.label);
    if (norm) keys.add(norm);
  }
  return [...keys];
}

function sameLabel(left: string, right: string): boolean {
  const a = normalizeLabel(left);
  const b = normalizeLabel(right);
  if (a && b && a === b) return true;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function readWhy(row: Record<string, unknown> | undefined, withShared: boolean): WhyNow | null {
  if (!row) return null;
  const nodeId = text(row.nodeId);
  const type = text(row.type);
  const date = text(row.date);
  if (!nodeId || !type || !date) return null;
  const why: WhyNow = {
    nodeId,
    type,
    label: text(row.label) || type,
    date,
  };
  const sharedLabel = withShared ? text(row.sharedLabel) : "";
  const url = text(row.url);
  if (sharedLabel) why.sharedLabel = sharedLabel;
  if (url) why.url = url;
  return why;
}

function formatMatchDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value.trim();
  return `${month} ${Number(match[3])}`;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

import { getFalkor, listPersonGraphs, query } from "@/lib/falkor";

/**
 * The room graph: one shared FalkorDB graph (`room`) projected from the per-person graphs.
 * Person nodes link to normalized Facet nodes (topics, skills, organizations, places) and to
 * their recent dated items, so matches, "why now", and intro paths are multi-hop Cypher queries.
 */
export const ROOM = "room";

const FACET_LABELS = ["Topic", "Skill", "Organization", "Location"] as const;
const ITEM_LABELS = ["Post", "Video", "Repo", "Article", "Package"] as const;
const ITEMS_PER_PERSON = 40;

/** Labels that match nearly everyone and say nothing about a person. */
const IGNORED = new Set([
  "html", "css", "shell", "github profile readme", "github", "software", "technology", "programming",
  "software development", "software engineering", "web development", "engineering",
]);
const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  llms: "llm",
  "large language model": "llm",
  "large language models": "llm",
  agents: "ai agents",
  "ai agent": "ai agents",
  ml: "machine learning",
  "bay area": "san francisco",
  "san francisco bay area": "san francisco",
  "san francisco, ca": "san francisco",
  "san francisco, california": "san francisco",
};

export function facetKey(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[“”"'`’()[\]{}!?.:;]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/, (united states|usa|us)$/, "");
  return ALIASES[key] ?? key;
}

// lib/falkor's query helpers prefix `person:`, so the room graph is selected by its raw name.
async function roomQuery(cypher: string, params?: Record<string, unknown>, readOnly = true) {
  const db = await getFalkor();
  const graph = db.selectGraph(ROOM);
  const options = { TIMEOUT: 8_000, ...(params ? { params: params as never } : {}) };
  const reply = readOnly ? await graph.roQuery(cypher, options) : await graph.query(cypher, options);
  return (reply.data ?? []) as Record<string, unknown>[];
}

type PersonFacts = {
  slug: string;
  name: string;
  headline: string;
  role: string;
  avatar_url: string;
  facets: { kind: string; key: string; label: string; nodeId: string }[];
  items: { nodeId: string; type: string; label: string; date: string; url: string; about: string[] }[];
};

async function readPerson(slug: string): Promise<PersonFacts | null> {
  const root = await query(slug, "MATCH (p:Person {id: 'person_root'}) RETURN p.name AS name, p.headline AS headline, p.role AS role, p.avatar_url AS avatar_url");
  const row = root.data[0];
  if (!row) return null;
  const facets = await query(
    slug,
    `MATCH (n) WHERE ${FACET_LABELS.map((label) => `n:${label}`).join(" OR ")}
     RETURN labels(n)[0] AS kind, n.id AS id, coalesce(n.label, n.name) AS label`,
  );
  const items = await query(
    slug,
    `MATCH (i) WHERE ${ITEM_LABELS.map((label) => `i:${label}`).join(" OR ")}
     WITH i, coalesce(i.posted_at, i.published_at, i.pushed_at, i.date, '') AS date
     WHERE date <> ''
     OPTIONAL MATCH (i)-[:ABOUT|USES]->(t)
     RETURN i.id AS id, labels(i)[0] AS type, coalesce(i.label, i.title, i.name) AS label, date,
            coalesce(i.url, i.source_url, '') AS url, collect(coalesce(t.label, t.name)) AS about
     ORDER BY date DESC LIMIT ${ITEMS_PER_PERSON}`,
  );
  const seen = new Set<string>();
  return {
    slug,
    name: String(row.name ?? slug),
    headline: String(row.headline ?? ""),
    role: String(row.role ?? ""),
    avatar_url: String(row.avatar_url ?? ""),
    facets: facets.data.flatMap((facet) => {
      const label = String(facet.label ?? "");
      const key = facetKey(label);
      if (!key || IGNORED.has(key) || seen.has(key)) return [];
      seen.add(key);
      return [{ kind: String(facet.kind), key, label, nodeId: String(facet.id) }];
    }),
    items: items.data.map((item) => ({
      nodeId: String(item.id),
      type: String(item.type),
      label: String(item.label ?? ""),
      date: String(item.date ?? ""),
      url: String(item.url ?? ""),
      about: ((item.about as unknown[]) ?? []).map((value) => facetKey(String(value ?? ""))).filter(Boolean),
    })),
  };
}

/** Replace one person's slice of the room graph, then reweight facets. */
export async function updateRoomPerson(slug: string): Promise<void> {
  const facts = await readPerson(slug);
  await roomQuery("MATCH (p:Person {slug: $slug}) OPTIONAL MATCH (p)-[:AUTHORED]->(i:Item) DETACH DELETE i, p", { slug }, false);
  if (!facts) return;
  await roomQuery(
    "CREATE (:Person {slug: $slug, name: $name, headline: $headline, role: $role, avatar_url: $avatar_url})",
    { slug, name: facts.name, headline: facts.headline, role: facts.role, avatar_url: facts.avatar_url },
    false,
  );
  if (facts.facets.length) {
    await roomQuery(
      `MATCH (p:Person {slug: $slug})
       UNWIND $facets AS f
       MERGE (x:Facet {key: f.key})
       ON CREATE SET x.label = f.label, x.kind = f.kind
       CREATE (p)-[:HAS {kind: f.kind, node_id: f.nodeId}]->(x)`,
      { slug, facets: facts.facets },
      false,
    );
  }
  if (facts.items.length) {
    await roomQuery(
      `MATCH (p:Person {slug: $slug})
       UNWIND $items AS it
       CREATE (p)-[:AUTHORED]->(i:Item {slug: $slug, node_id: it.nodeId, type: it.type, label: it.label, date: it.date, url: it.url})
       WITH i, it
       UNWIND it.about AS key
       MATCH (x:Facet {key: key})
       MERGE (i)-[:ABOUT]->(x)`,
      { slug, items: facts.items },
      false,
    );
  }
  await reweight();
}

/** Rare shared facets count more than ones half the room has. */
async function reweight(): Promise<void> {
  await roomQuery(
    `MATCH (x:Facet)
     OPTIONAL MATCH (x)<-[:HAS]-(p:Person)
     WITH x, count(DISTINCT p) AS people
     SET x.people = people,
         x.weight = CASE x.kind WHEN 'Organization' THEN 3.0 WHEN 'Skill' THEN 2.0 ELSE 1.0 END / sqrt(CASE WHEN people < 1 THEN 1 ELSE people END)`,
    undefined,
    false,
  );
  await roomQuery("MATCH (x:Facet) WHERE x.people = 0 AND NOT (x)<-[:ABOUT]-() DELETE x", undefined, false);
}

/** Rebuild the whole room graph from every person graph (skips fixtures). */
export async function buildRoom(log: (line: string) => void = () => {}): Promise<number> {
  const db = await getFalkor();
  if ((await db.list()).includes(ROOM)) await db.selectGraph(ROOM).delete();
  await roomQuery("CREATE INDEX FOR (p:Person) ON (p.slug)", undefined, false);
  await roomQuery("CREATE INDEX FOR (x:Facet) ON (x.key)", undefined, false);
  const slugs = (await listPersonGraphs()).map((name) => name.slice("person:".length)).filter((slug) => !slug.startsWith("demo-"));
  for (const slug of slugs) {
    await updateRoomPerson(slug);
    log(slug);
  }
  return slugs.length;
}

export type CypherTrace = { name: string; cypher: string; rowCount: number; ms: number };

async function traced(name: string, cypher: string, params: Record<string, unknown>, traces: CypherTrace[]) {
  const started = Date.now();
  const rows = await roomQuery(cypher, params);
  traces.push({ name, cypher: cypher.replace(/\s+\n/g, "\n").trim(), rowCount: rows.length, ms: Date.now() - started });
  return rows;
}

export const MATCHES_CYPHER = `MATCH (me:Person {slug: $viewer})-[mine:HAS]->(x:Facet)<-[theirs:HAS]-(them:Person)
WHERE them.slug <> $viewer
WITH them, x, mine, theirs ORDER BY x.weight DESC
WITH them, sum(x.weight) AS score,
     collect({label: x.label, kind: x.kind, mine: mine.node_id, theirs: theirs.node_id})[0..5] AS shared
RETURN them.slug AS slug, them.name AS name, them.headline AS headline, them.role AS role,
       them.avatar_url AS avatar_url, score, shared
ORDER BY score DESC LIMIT $limit`;

export async function roomMatches(viewer: string, limit = 8, traces: CypherTrace[] = []) {
  return traced("best_matches", MATCHES_CYPHER, { viewer, limit }, traces);
}

const SHARED_CYPHER = `MATCH (me:Person {slug: $viewer})-[mine:HAS]->(x:Facet)<-[theirs:HAS]-(them:Person {slug: $person})
RETURN x.label AS label, x.kind AS kind, x.people AS people, mine.node_id AS mine, theirs.node_id AS theirs
ORDER BY x.weight DESC LIMIT 8`;

const WHY_NOW_CYPHER = `MATCH (me:Person {slug: $viewer})-[:HAS]->(x:Facet)<-[:ABOUT]-(i:Item)<-[:AUTHORED]-(them:Person {slug: $person})
RETURN i.node_id AS item, i.type AS type, i.label AS label, i.date AS date, i.url AS url, x.label AS via
ORDER BY i.date DESC LIMIT 3`;

const INTRO_CYPHER = `MATCH (me:Person {slug: $viewer})-[:HAS]->(a:Facet)<-[:HAS]-(mutual:Person)-[:HAS]->(b:Facet)<-[:HAS]-(them:Person {slug: $person})
WHERE mutual.slug <> $viewer AND mutual.slug <> $person AND a <> b
RETURN mutual.slug AS mutual, mutual.name AS mutualName, a.label AS mine, b.label AS theirs, a.weight + b.weight AS strength
ORDER BY strength DESC LIMIT 3`;

// Explicit directed patterns: FalkorDB Cloud rejects undirected shortestPath, and these read clearly on screen.
const TWO_PEOPLE_CYPHER = `MATCH (me:Person {slug: $viewer})-[:HAS]->(a:Facet)<-[:HAS]-(p1:Person)-[:HAS]->(b:Facet)<-[:HAS]-(p2:Person)-[:HAS]->(c:Facet)<-[:HAS]-(them:Person {slug: $person})
WHERE p1 <> p2 AND p1.slug <> $person AND p2.slug <> $viewer
RETURN [me.name, a.label, p1.name, b.label, p2.name, c.label, them.name] AS path
ORDER BY a.weight + b.weight + c.weight DESC LIMIT 1`;

export type RoomPaths = Awaited<ReturnType<typeof roomPaths>>;

/** Everything the graph can say about how the viewer connects to one person. */
export async function roomPaths(viewer: string, person: string) {
  const traces: CypherTrace[] = [];
  const params = { viewer, person };
  const [shared, whyNow, intros, names] = await Promise.all([
    traced("shared_facets", SHARED_CYPHER, params, traces),
    traced("why_now", WHY_NOW_CYPHER, params, traces),
    traced("intro_paths", INTRO_CYPHER, params, traces),
    roomQuery("MATCH (p:Person) WHERE p.slug IN [$viewer, $person] RETURN p.slug AS slug, p.name AS name", params),
  ]);
  const nameOf = (slug: string) => String(names.find((row) => row.slug === slug)?.name ?? slug);
  // Shortest path: 2 hops through a shared facet, else 4 hops through a mutual, else 6 hops through two people.
  let shortest: string[] = [];
  if (shared[0]) shortest = [nameOf(viewer), String(shared[0].label), nameOf(person)];
  else if (intros[0]) {
    const best = intros[0];
    shortest = [nameOf(viewer), String(best.mine), String(best.mutualName), String(best.theirs), nameOf(person)];
  } else {
    const rows = await traced("two_hop_people", TWO_PEOPLE_CYPHER, params, traces);
    shortest = ((rows[0]?.path as unknown[]) ?? []).map(String);
  }
  return { shared, whyNow, intros, shortest, traces };
}

export async function roomExists(): Promise<boolean> {
  return (await (await getFalkor()).list()).includes(ROOM);
}

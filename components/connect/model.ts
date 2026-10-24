/**
 * View model for GET /api/connect.
 * Shapes match lib/room.ts `roomPaths`: shared mine/theirs are node ids,
 * intro mine/theirs are facet labels, shortest alternates person, facet, person.
 */

export type ConnectShared = {
  label: string;
  kind: string;
  people: number;
  mine: string;
  theirs: string;
};

export type ConnectWhyNow = {
  item: string;
  type: string;
  label: string;
  date: string;
  url: string;
  via: string;
};

export type ConnectIntro = {
  mutual: string;
  mutualName: string;
  mine: string;
  theirs: string;
  strength: number;
};

export type ConnectTrace = {
  name: string;
  cypher: string;
  rowCount: number;
  ms: number;
};

export type ConnectResponse = {
  viewerName: string;
  personName: string;
  shared: ConnectShared[];
  whyNow: ConnectWhyNow[];
  intros: ConnectIntro[];
  shortest: string[];
  traces: ConnectTrace[];
};

export type PathRole = "you" | "them" | "mutual" | "facet";

export type PathNode = {
  role: PathRole;
  label: string;
  title: string;
};

export type ConnectView = {
  direct: PathNode[];
  intros: { id: string; caption: string; nodes: PathNode[] }[];
  shared: ConnectShared[];
  whyNow: ConnectWhyNow[];
  empty: boolean;
};

const SHARED_LIMIT = 6;
const INTRO_LIMIT = 2;
const WHY_LIMIT = 3;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function firstName(name: string): string {
  const word = name.trim().split(/\s+/)[0] ?? "";
  return word;
}

export function formatDay(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(trimmed);
  if (!match) return trimmed;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return trimmed;
  const day = match[3];
  if (day && Number(day) >= 1) return `${month} ${Number(day)}`;
  return `${month} ${match[1]}`;
}

export function connectUrl(viewer: string, person: string, dropProtected: boolean): string {
  const params = new URLSearchParams({ viewer, person });
  if (!dropProtected) params.set("protected", "allow");
  return `/api/connect?${params.toString()}`;
}

/** Only http(s) links become anchors. */
export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    /* not a url */
  }
  return null;
}

/** Next's own 404 is HTML. A JSON 404 is the route telling us something real. */
export function missingConnectRoute(status: number, contentType: string | null): boolean {
  return status === 404 && !(contentType ?? "").toLowerCase().includes("application/json");
}

export function parseConnect(body: unknown): ConnectResponse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Connection data was not an object.");
  }
  const row = body as Record<string, unknown>;
  return {
    viewerName: asString(row.viewerName),
    personName: asString(row.personName),
    shared: asArray(row.shared).map(parseShared).filter((item) => item.label),
    whyNow: asArray(row.whyNow).map(parseWhy).filter((item) => item.label),
    intros: asArray(row.intros).map(parseIntro).filter((item) => item.mutualName || item.mutual),
    shortest: asArray(row.shortest).map(asString),
    traces: asArray(row.traces).map(parseTrace).filter((item) => item.name),
  };
}

/** Shortest paths alternate person, facet, person and always start with the viewer. */
export function directSegments(shortest: string[], personName: string): PathNode[] {
  const labels = shortest.map((label) => label.trim());
  if (labels.filter(Boolean).length < 2) return [];
  const nodes: PathNode[] = [];
  labels.forEach((label, index) => {
    if (index === 0) {
      nodes.push({ role: "you", label: "You", title: label || "You" });
      return;
    }
    if (index === labels.length - 1) {
      const title = personName.trim() || label || "Them";
      nodes.push({ role: "them", label: firstName(title) || "Them", title });
      return;
    }
    if (!label) return;
    if (index % 2 === 0) {
      nodes.push({ role: "mutual", label: firstName(label) || label, title: label });
      return;
    }
    nodes.push({ role: "facet", label, title: label });
  });
  return nodes;
}

export function introSegments(intro: ConnectIntro, personName: string): PathNode[] {
  const them = personName.trim() || "Them";
  const mutual = intro.mutualName.trim() || intro.mutual.trim();
  return [
    { role: "you", label: "You", title: "You" },
    { role: "facet", label: intro.mine.trim(), title: intro.mine.trim() },
    { role: "mutual", label: firstName(mutual) || mutual, title: mutual },
    { role: "facet", label: intro.theirs.trim(), title: intro.theirs.trim() },
    { role: "them", label: firstName(them) || "Them", title: them },
  ];
}

export function connectView(data: ConnectResponse, personName: string): ConnectView {
  const them = personName.trim() || data.personName;
  const direct = directSegments(data.shortest, them);
  const middlePeople = new Set(
    data.shortest
      .map((label) => label.trim().toLowerCase())
      .filter((label, index, all) => label && index % 2 === 0 && index > 0 && index < all.length - 1),
  );
  const seen = new Set<string>();
  const intros: ConnectView["intros"] = [];
  for (const intro of data.intros) {
    const mutual = intro.mutualName.trim() || intro.mutual.trim();
    const key = (intro.mutual.trim() || mutual).toLowerCase();
    if (!key || seen.has(key)) continue;
    if (!intro.mine.trim() || !intro.theirs.trim() || !mutual) continue;
    if (middlePeople.has(mutual.toLowerCase())) continue;
    seen.add(key);
    intros.push({
      id: key,
      caption: `Through ${firstName(mutual) || mutual}`,
      nodes: introSegments(intro, them),
    });
    if (intros.length === INTRO_LIMIT) break;
  }
  const shared = data.shared.slice(0, SHARED_LIMIT);
  const whyNow = data.whyNow.slice(0, WHY_LIMIT);
  return {
    direct,
    intros,
    shared,
    whyNow,
    empty: shared.length === 0 && direct.length === 0 && intros.length === 0 && whyNow.length === 0,
  };
}

/** Stand-in used only while /api/connect is not mounted. Labels follow the caller's names. */
export function sampleConnect(viewer: { slug: string; name: string }, person: { slug: string; name: string }): ConnectResponse {
  const you = viewer.name.trim() || viewer.slug || "You";
  const them = person.name.trim() || person.slug || "Them";
  return {
    viewerName: you,
    personName: them,
    shared: [
      { label: "AI agents", kind: "Topic", people: 4, mine: "topic_sample0001", theirs: "topic_sample0002" },
      { label: "TypeScript", kind: "Skill", people: 6, mine: "skill_sample0001", theirs: "skill_sample0002" },
      { label: "San Francisco", kind: "Location", people: 8, mine: "location_sam01", theirs: "location_sam02" },
    ],
    whyNow: [
      {
        item: "post_sample0001",
        type: "Post",
        label: "What we learned shipping an agent that reads the room",
        date: "2026-10-20",
        url: "https://example.com/agents",
        via: "AI agents",
      },
    ],
    intros: [
      { mutual: "harrison-chase", mutualName: "Harrison Chase", mine: "AI agents", theirs: "LangChain", strength: 4.2 },
      { mutual: "swyx", mutualName: "Swyx", mine: "TypeScript", theirs: "AI engineering", strength: 2.4 },
    ],
    shortest: [you, "AI agents", them],
    traces: [
      {
        name: "room.shared_facets",
        cypher: "MATCH (me:Person {slug: $viewer})-[mine:HAS]->(x:Facet)<-[theirs:HAS]-(them:Person {slug: $person})\nRETURN x.label AS label, x.kind AS kind, mine.node_id AS mine, theirs.node_id AS theirs",
        rowCount: 3,
        ms: 18,
      },
      {
        name: "room.why_now",
        cypher: "MATCH (me:Person {slug: $viewer})-[:HAS]->(x:Facet)<-[:ABOUT]-(i:Item)<-[:AUTHORED]-(them:Person {slug: $person})\nRETURN i.label AS label, i.date AS date, x.label AS via",
        rowCount: 1,
        ms: 11,
      },
      {
        name: "room.intro_paths",
        cypher: "MATCH (me:Person {slug: $viewer})-[:HAS]->(a:Facet)<-[:HAS]-(mutual:Person)-[:HAS]->(b:Facet)<-[:HAS]-(them:Person {slug: $person})\nRETURN mutual.name AS mutualName, a.label AS mine, b.label AS theirs",
        rowCount: 2,
        ms: 22,
      },
    ],
  };
}

function parseShared(value: unknown): ConnectShared {
  const row = asRecord(value);
  return {
    label: asString(row.label),
    kind: asString(row.kind),
    people: asNumber(row.people),
    mine: asString(row.mine),
    theirs: asString(row.theirs),
  };
}

function parseWhy(value: unknown): ConnectWhyNow {
  const row = asRecord(value);
  return {
    item: asString(row.item),
    type: asString(row.type),
    label: asString(row.label),
    date: asString(row.date),
    url: asString(row.url),
    via: asString(row.via),
  };
}

function parseIntro(value: unknown): ConnectIntro {
  const row = asRecord(value);
  return {
    mutual: asString(row.mutual),
    mutualName: asString(row.mutualName),
    mine: asString(row.mine),
    theirs: asString(row.theirs),
    strength: asNumber(row.strength),
  };
}

function parseTrace(value: unknown): ConnectTrace {
  const row = asRecord(value);
  return {
    name: asString(row.name),
    cypher: asString(row.cypher),
    rowCount: asNumber(row.rowCount),
    ms: asNumber(row.ms),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

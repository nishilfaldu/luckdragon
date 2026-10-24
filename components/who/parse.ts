/** Shapes and copy for GET /api/who. The component renders these strings so the card stays in one place. */

export type SharedChip = {
  label: string;
  kind: string;
  mine: string;
  theirs: string;
};

export type WhyNow = {
  item: string;
  type: string;
  label: string;
  date: string;
  url: string;
  via: string;
};

export type WhoRow = {
  slug: string;
  name: string;
  headline: string;
  role: string;
  avatar_url: string;
  score: number;
  shared: SharedChip[];
  whyNow: WhyNow | null;
  opener: string;
};

export type Trace = {
  name: string;
  cypher?: string;
  rowCount?: number;
  ms?: number;
};

export type WhoResponse = {
  people: WhoRow[];
  traces: Trace[];
  /** Optional note from the API when the list is empty. */
  reason?: string;
};

export const INTRO =
  "Ranked by what you and each person have in common in your public work. Why now is their newest post or project on something you share.";

export const EMPTY_VIEWER = "Add yourself to see who to meet";

export const EMPTY_LIST = "No one to meet yet.";

export const NO_ACTIVITY = "No recent activity on shared topics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TYPE_WORDS: Record<string, string> = {
  post: "post",
  posts: "post",
  talk: "talk",
  talks: "talk",
  video: "talk",
  videos: "talk",
  repo: "repo",
  repos: "repo",
  repository: "repo",
  article: "article",
  package: "package",
};

const CHIP_LIMIT = 4;
const PEOPLE_LIMIT = 8;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `dropProtected` is `useDropProtected()`. True keeps the server default and omits the flag. */
export function whoUrl(viewer: string, dropProtected: boolean): string {
  const query = `viewer=${encodeURIComponent(viewer)}&limit=8`;
  if (dropProtected) return `/api/who?${query}`;
  return `/api/who?${query}&protected=allow`;
}

export function parseWhoResponse(value: unknown): WhoResponse | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.people)) return null;
  const people = raw.people.flatMap((item) => {
    const row = parseRow(item);
    return row ? [row] : [];
  });
  const traces = Array.isArray(raw.traces)
    ? raw.traces.flatMap((item) => {
        const trace = parseTrace(item);
        return trace ? [trace] : [];
      })
    : [];
  const reason = str(raw.reason);
  return { people: people.slice(0, PEOPLE_LIMIT), traces, ...(reason ? { reason } : {}) };
}

/** Drop the viewer and duplicate slugs. Keeps the API's rank order. */
export function visiblePeople(people: WhoRow[], viewer: string): WhoRow[] {
  const seen = new Set<string>();
  const rows: WhoRow[] = [];
  for (const person of people) {
    if (!person.slug || person.slug === viewer || seen.has(person.slug)) continue;
    seen.add(person.slug);
    rows.push(person);
    if (rows.length === PEOPLE_LIMIT) break;
  }
  return rows;
}

/** Judge is the amber tag. Guest, viewer, and a blank role are not shown. */
export function roleLabel(role: string): string | null {
  const kind = role.trim().toLowerCase();
  if (!kind || kind === "guest" || kind === "viewer") return null;
  if (kind === "judge") return "Judge";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function whyNowParts(whyNow: WhyNow | null): { line: string; word: string | null; quiet: boolean } {
  if (!whyNow) return { line: NO_ACTIVITY, word: null, quiet: true };
  const when = formatDay(whyNow.date);
  const label = itemLabel(whyNow);
  const bits = [when, label].filter(Boolean);
  return {
    line: bits.length > 0 ? bits.join(" · ") : "Recent activity",
    word: typeWord(whyNow.type),
    quiet: false,
  };
}

export function shareChips(shared: SharedChip[]): SharedChip[] {
  const seen = new Set<string>();
  const chips: SharedChip[] = [];
  for (const chip of shared) {
    const key = chip.label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chips.push(chip);
    if (chips.length === CHIP_LIMIT) break;
  }
  return chips;
}

export function sayLine(opener: string): string | null {
  let text = opener.trim();
  if (!text) return null;
  const wrapped =
    (text.startsWith("“") && text.endsWith("”")) || (text.startsWith("\"") && text.endsWith("\""));
  if (wrapped) text = text.slice(1, -1).trim();
  if (!text) return null;
  return `“${text}”`;
}

function formatDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value.trim();
  return `${month} ${Number(match[3])}`;
}

function typeWord(type: string): string | null {
  const key = type.trim().toLowerCase();
  if (!key) return null;
  return TYPE_WORDS[key] ?? key.split(/\s+/)[0]?.slice(0, 16) ?? null;
}

function itemLabel(whyNow: WhyNow): string {
  if (whyNow.label) return whyNow.label;
  if (!whyNow.item || /^[a-z]+_[0-9a-f]{6,}$/i.test(whyNow.item)) return "";
  return whyNow.item;
}

function parseRow(value: unknown): WhoRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const slug = str(raw.slug);
  if (!slug) return null;
  const shared = Array.isArray(raw.shared)
    ? raw.shared.flatMap((item) => {
        const chip = parseShared(item);
        return chip ? [chip] : [];
      })
    : [];
  return {
    slug,
    name: str(raw.name) || slug,
    headline: str(raw.headline),
    role: str(raw.role),
    avatar_url: str(raw.avatar_url),
    score: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0,
    shared,
    whyNow: parseWhyNow(raw.whyNow),
    opener: str(raw.opener),
  };
}

function parseShared(value: unknown): SharedChip | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const label = str(raw.label);
  if (!label) return null;
  return {
    label,
    kind: str(raw.kind),
    mine: str(raw.mine),
    theirs: str(raw.theirs),
  };
}

function parseWhyNow(value: unknown): WhyNow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const whyNow: WhyNow = {
    item: str(raw.item),
    type: str(raw.type),
    label: str(raw.label),
    date: str(raw.date),
    url: str(raw.url),
    via: str(raw.via),
  };
  if (!whyNow.item && !whyNow.type && !whyNow.label && !whyNow.date) return null;
  return whyNow;
}

function parseTrace(value: unknown): Trace | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = str(raw.name);
  const cypher = str(raw.cypher);
  if (!name && !cypher) return null;
  const trace: Trace = { name: name || "query" };
  if (cypher) trace.cypher = cypher;
  if (typeof raw.rowCount === "number" && Number.isFinite(raw.rowCount)) trace.rowCount = raw.rowCount;
  if (typeof raw.ms === "number" && Number.isFinite(raw.ms)) trace.ms = raw.ms;
  return trace;
}

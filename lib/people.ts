import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { listPersonGraphs, roQuery } from "@/lib/falkor";
import { isIngesting } from "@/lib/ingest/events";
import type { PersonRow } from "@/lib/types";

const COLUMNS: (keyof PersonRow)[] = [
  "slug",
  "name",
  "role",
  "luma_url",
  "headline",
  "avatar_url",
  "linkedin",
  "x",
  "github",
  "youtube",
  "instagram",
  "tiktok",
  "website",
  "other_links",
];

const EMPTY: Omit<PersonRow, "slug" | "name"> = {
  role: "",
  luma_url: "",
  headline: "",
  avatar_url: "",
  linkedin: "",
  x: "",
  github: "",
  youtube: "",
  instagram: "",
  tiktok: "",
  website: "",
  other_links: "",
};

/**
 * Sync fallback when the CSV has not been written yet.
 * The people API uses the graphs in that case (see peopleFromGraphs).
 */
const FIXTURES: PersonRow[] = [
  { ...EMPTY, slug: "demo-viewer", name: "Demo Viewer", role: "viewer" },
  { ...EMPTY, slug: "demo-alex", name: "Demo Alex", role: "guest" },
];

export function peopleFile(): string {
  return path.join(process.cwd(), "data", "people.csv");
}

export function peopleCsvExists(): boolean {
  return fs.existsSync(peopleFile());
}

export type GraphPersonRow = PersonRow & {
  status: "none" | "ingesting" | "ready";
  nodeCount: number;
  sources: string[];
};

const LINK_FIELDS = ["linkedin", "x", "github", "youtube", "instagram", "tiktok", "website"] as const;

const PLATFORM_FIELD: Record<string, (typeof LINK_FIELDS)[number]> = {
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  github: "github",
  youtube: "youtube",
  instagram: "instagram",
  tiktok: "tiktok",
  website: "website",
};

/**
 * People list for a deploy that has no CSV. Each `person:*` graph contributes
 * one row from its `person_root` node. Account nodes fill link fields the root
 * does not already store.
 */
export async function peopleFromGraphs(): Promise<GraphPersonRow[]> {
  const names = await listPersonGraphs();
  const slugs = names.map(slugFromGraph).filter((slug): slug is string => Boolean(slug));
  const people: GraphPersonRow[] = [];
  const batch = 4;
  for (let i = 0; i < slugs.length; i += batch) {
    const rows = await Promise.all(slugs.slice(i, i + batch).map((slug) => personFromGraph(slug)));
    for (const row of rows) {
      if (row) people.push(row);
    }
  }
  people.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  return people;
}

export function readPeople(): PersonRow[] {
  const file = peopleFile();
  if (!fs.existsSync(file)) return FIXTURES.map((row) => ({ ...row }));
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return FIXTURES.map((row) => ({ ...row }));
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return rows.map(toPerson).filter((row) => row.slug && row.name);
}

export function getPerson(slug: string): PersonRow | undefined {
  return readPeople().find((row) => row.slug === slug);
}

export function writePeople(people: PersonRow[]): void {
  const file = peopleFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [COLUMNS.join(",")];
  for (const person of people) {
    lines.push(COLUMNS.map((column) => csvEscape(person[column] ?? "")).join(","));
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${lines.join("\n")}\n`);
  fs.renameSync(tmp, file);
}

/** Insert or replace one row. Rewrites the CSV, so callers should not run this during a bulk edit of the same file. */
export function upsertPerson(person: PersonRow): PersonRow {
  const people = fs.existsSync(peopleFile()) ? readPeople() : [];
  const index = people.findIndex((row) => row.slug === person.slug || sameUrl(row.luma_url, person.luma_url));
  if (index >= 0) {
    people[index] = { ...people[index], ...compact(person) };
    writePeople(people);
    return people[index]!;
  }
  people.push(person);
  writePeople(people);
  return person;
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "person";
}

export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function toPerson(row: Record<string, string>): PersonRow {
  const person = { ...EMPTY, slug: "", name: "" };
  for (const column of COLUMNS) person[column] = (row[column] ?? "").trim();
  return person;
}

function compact(person: PersonRow): PersonRow {
  const next = { ...person };
  for (const column of COLUMNS) next[column] = (person[column] ?? "").trim();
  return next;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function sameUrl(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

function slugFromGraph(name: string): string | null {
  if (!name.startsWith("person:")) return null;
  const slug = name.slice("person:".length);
  if (!slug || slug.includes(":")) return null;
  return slug;
}

async function personFromGraph(slug: string): Promise<GraphPersonRow | null> {
  const root = await roQuery(slug, "MATCH (n {id: $id}) RETURN n", { id: "person_root" });
  const stored = asNode(root.data[0]?.n);
  if (!stored) return null;

  const person = blankPerson(slug, textProp(stored, "name") || textProp(stored, "label") || slug);
  person.headline = textProp(stored, "headline");
  person.avatar_url = textProp(stored, "avatar_url");
  person.role = textProp(stored, "role");
  person.luma_url = textProp(stored, "luma_url");
  person.other_links = textList(stored.other_links);
  const links = linkMap(stored.links);
  for (const field of LINK_FIELDS) {
    person[field] = textProp(stored, field) || links[field] || "";
  }

  const accounts = await roQuery(
    slug,
    "MATCH (n {id: $id})-[:HAS_ACCOUNT]->(a) RETURN a.platform AS platform, a.url AS url",
    { id: "person_root" },
  );
  const sources: string[] = [];
  const extras = new Set(person.other_links.split(/\s+/).filter(Boolean));
  for (const row of accounts.data) {
    const platform = typeof row.platform === "string" ? row.platform.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (platform && !sources.includes(platform)) sources.push(platform);
    const field = PLATFORM_FIELD[platform.toLowerCase()];
    if (field && url && !person[field]) person[field] = url;
    else if (!field && url) extras.add(url);
  }
  person.other_links = [...extras].join(" ");
  if (sources.length === 0) {
    for (const field of LINK_FIELDS) {
      if (person[field]) sources.push(field);
    }
  }

  const counted = await roQuery(slug, "MATCH (n) RETURN count(n) AS count");
  const nodeCount = countOf(counted.data[0]);
  return {
    ...person,
    status: isIngesting(slug) ? "ingesting" : "ready",
    nodeCount,
    sources,
  };
}

function blankPerson(slug: string, name: string): PersonRow {
  return { ...EMPTY, slug, name };
}

function asNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const properties = (value as { properties?: unknown }).properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  return properties as Record<string, unknown>;
}

function textProp(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").join(" ");
}

function linkMap(value: unknown): Record<string, string> {
  let record: Record<string, unknown> | null = null;
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
    } catch {
      record = null;
    }
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    record = value as Record<string, unknown>;
  }
  if (!record) return {};
  const links: Record<string, string> = {};
  for (const field of LINK_FIELDS) links[field] = textProp(record, field);
  return links;
}

function countOf(row: Record<string, unknown> | undefined): number {
  if (!row) return 0;
  const value = row.count ?? Object.values(row)[0];
  const count = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

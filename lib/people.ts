import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { graphName, listPersonGraphs, query, roQuery } from "@/lib/falkor";
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

export const PERSON_INPUT_ERROR = "Enter a name, LinkedIn, or Luma URL.";

const LUMA_URL = /^https?:\/\/([a-z0-9-]+\.)?luma\.com\//i;
const NAME_WORD = /^[\p{L}][\p{L}'.-]*$/u;

export type ClassifiedPerson =
  | { kind: "luma"; url: string }
  | { kind: "linkedin"; url: string; name: string }
  | { kind: "website"; url: string; name: string }
  | { kind: "name"; name: string; headline: string };

/** A Luma URL, a LinkedIn /in/ URL, any other http URL, or a 2–6 word name. "Name, Company" keeps the company as a headline hint. */
export function classifyPersonInput(raw: string): ClassifiedPerson | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const url = canonicalUrl(trimmed);
  if (url) {
    if (LUMA_URL.test(trimmed)) return { kind: "luma", url: trimmed };
    const vanity = linkedInVanity(url);
    if (vanity) {
      const name = nameFromVanity(vanity);
      if (!name) return null;
      return { kind: "linkedin", url: `https://www.linkedin.com/in/${vanity}`, name };
    }
    const name = hostLabel(url);
    if (!name) return null;
    return { kind: "website", url, name };
  }
  return parseName(trimmed.replace(/\s+/g, " "));
}

/** Append a non-Luma row. The same LinkedIn URL, website, or name returns the row already in the CSV. */
export function addClassifiedPerson(parsed: Exclude<ClassifiedPerson, { kind: "luma" }>): PersonRow {
  const people = fs.existsSync(peopleFile()) ? readPeople() : [];
  const existing = findExisting(parsed, people);
  if (existing) {
    if (parsed.kind === "name" && parsed.headline && !existing.headline) {
      const next = { ...existing, headline: parsed.headline };
      writePersonRow(next);
      return next;
    }
    return existing;
  }
  const taken = new Set(people.map((row) => row.slug));
  const person: PersonRow = {
    ...EMPTY,
    slug: uniqueSlug(slugify(parsed.name), taken),
    name: parsed.name,
    headline: parsed.kind === "name" ? parsed.headline : "",
    linkedin: parsed.kind === "linkedin" ? parsed.url : "",
    website: parsed.kind === "website" ? parsed.url : "",
  };
  writePersonRow(person);
  return person;
}

/** LinkedIn /in/ slug, or "" when the URL is not a person profile. */
export function linkedInVanity(value: string): string {
  if (!value.trim()) return "";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "";
  }
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part.toLowerCase() === "in");
  const raw = index >= 0 ? parts[index + 1] : "";
  if (!raw) return "";
  let vanity = raw;
  try {
    vanity = decodeURIComponent(raw);
  } catch {
    return "";
  }
  vanity = vanity.trim().toLowerCase();
  if (!/^[\p{L}\p{N}_-]{2,100}$/u.test(vanity)) return "";
  return vanity;
}

/** Display name for a LinkedIn vanity slug: "kent-c-dodds" → "Kent C Dodds". */
export function nameFromVanity(vanity: string): string {
  const words = vanity
    .replace(/[-_]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .split(" ")
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

/** True when `name` is the placeholder derived from this LinkedIn slug. */
export function nameMatchesVanity(name: string, vanity: string): boolean {
  const fromSlug = nameFromVanity(vanity);
  if (!fromSlug) return false;
  return slugify(name) === slugify(fromSlug);
}

/** Replace the CSV name and headline, and the person_root label when that graph already exists. The slug stays put. */
export async function updatePersonIdentity(
  slug: string,
  fields: { name?: string; headline?: string },
): Promise<PersonRow | undefined> {
  const current = getPerson(slug);
  if (!current) return undefined;
  const name = fields.name?.trim() || current.name;
  const headline = fields.headline?.trim() || current.headline;
  if (name === current.name && headline === current.headline) return current;
  const next = { ...current, name, headline };
  writePersonRow(next);
  try {
    await syncRootIdentity(next.slug, next.name, next.headline);
  } catch {
    // The CSV row is the source for the next seed. A missing graph is not a failed rename.
  }
  return next;
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

function parseName(input: string): ClassifiedPerson | null {
  const comma = input.indexOf(",");
  const name = (comma >= 0 ? input.slice(0, comma) : input).trim();
  const headline = comma >= 0 ? input.slice(comma + 1).trim() : "";
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 6) return null;
  if (!words.every((word) => NAME_WORD.test(word))) return null;
  if (headline && !/[\p{L}\p{N}]/u.test(headline)) return null;
  return { kind: "name", name, headline: headline.slice(0, 240) };
}

function findExisting(
  parsed: Exclude<ClassifiedPerson, { kind: "luma" }>,
  people: PersonRow[],
): PersonRow | undefined {
  if (parsed.kind === "linkedin") {
    const vanity = linkedInVanity(parsed.url);
    return people.find((row) => linkedInVanity(row.linkedin) === vanity);
  }
  if (parsed.kind === "website") {
    return people.find((row) => canonicalUrl(row.website) === parsed.url);
  }
  return people.find((row) => row.name.trim().toLowerCase() === parsed.name.toLowerCase());
}

/** Insert or replace one CSV line. Other lines are left as they are. */
function writePersonRow(person: PersonRow): void {
  const file = peopleFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = compact(person);
  const line = COLUMNS.map((column) => csvEscape(row[column] ?? "")).join(",");
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, `${COLUMNS.join(",")}\n${line}\n`);
    return;
  }
  const text = fs.readFileSync(file, "utf8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const parts = text.split(/\r?\n/);
  const lastEmpty = parts.length > 0 && parts[parts.length - 1] === "";
  const body = lastEmpty ? parts.slice(0, -1) : parts;
  const index = body.findIndex((entry, entryIndex) => entryIndex > 0 && csvSlug(entry) === row.slug);
  if (index >= 0) body[index] = line;
  else body.push(line);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${body.join(newline)}${newline}`);
  fs.renameSync(tmp, file);
}

function csvSlug(line: string): string {
  if (line.startsWith("\"")) {
    const end = line.indexOf("\"", 1);
    return end > 1 ? line.slice(1, end).replace(/""/g, "\"") : "";
  }
  return line.split(",")[0] ?? "";
}

function canonicalUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.username = "";
  url.password = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
  }
  let text = url.toString();
  if (text.endsWith("/")) text = text.slice(0, -1);
  return text;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

async function syncRootIdentity(slug: string, name: string, headline: string): Promise<void> {
  const names = await listPersonGraphs();
  if (!names.includes(graphName(slug))) return;
  await query(slug, "MATCH (n {id: $id}) SET n.name = $name, n.label = $name, n.headline = $headline", {
    id: "person_root",
    name,
    headline,
  });
}

function countOf(row: Record<string, unknown> | undefined): number {
  if (!row) return 0;
  const value = row.count ?? Object.values(row)[0];
  const count = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

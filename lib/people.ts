import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
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

/** Used only when data/people.csv has not been written yet. */
const FIXTURES: PersonRow[] = [
  { ...EMPTY, slug: "demo-viewer", name: "Demo Viewer", role: "viewer" },
  { ...EMPTY, slug: "demo-alex", name: "Demo Alex", role: "guest" },
];

export function peopleFile(): string {
  return path.join(process.cwd(), "data", "people.csv");
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

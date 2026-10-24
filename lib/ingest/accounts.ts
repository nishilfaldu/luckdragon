import fs from "node:fs";
import path from "node:path";
import type { PersonRow } from "@/lib/types";
import { hostname, urlKey, type RawItem } from "@/lib/ingest/items";
import { linkedInVanity, nameMatchesVanity, updatePersonIdentity } from "@/lib/people";

export type MatchedVia = "luma" | "search" | "agent";

export type KnownAccount = {
  platform: string;
  url: string;
  matched_via: MatchedVia;
  confidence: number;
  reason?: string;
};

const PLATFORM_HOSTS: Array<{ platform: string; pattern: RegExp }> = [
  { platform: "linkedin", pattern: /linkedin\.com/i },
  { platform: "x", pattern: /(^|\.)x\.com$|twitter\.com/i },
  { platform: "github", pattern: /github\.com/i },
  { platform: "youtube", pattern: /youtube\.com|youtu\.be/i },
  { platform: "instagram", pattern: /instagram\.com/i },
  { platform: "threads", pattern: /threads\.(net|com)/i },
  { platform: "bluesky", pattern: /bsky\.app/i },
  { platform: "reddit", pattern: /reddit\.com/i },
  { platform: "crunchbase", pattern: /crunchbase\.com/i },
  { platform: "npm", pattern: /npmjs\.com/i },
  { platform: "pypi", pattern: /pypi\.org/i },
  { platform: "tiktok", pattern: /tiktok\.com/i },
];

const ROW_FIELDS: Array<{ platform: string; field: keyof PersonRow }> = [
  { platform: "linkedin", field: "linkedin" },
  { platform: "x", field: "x" },
  { platform: "github", field: "github" },
  { platform: "youtube", field: "youtube" },
  { platform: "instagram", field: "instagram" },
  { platform: "tiktok", field: "tiktok" },
  { platform: "website", field: "website" },
];

export type LumaProfile = {
  name?: string;
  headline?: string;
  avatar_url?: string;
  luma_url?: string;
  linkedin?: string | null;
  x?: string | null;
  github?: string | null;
  youtube?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  website?: string | null;
  other_links?: string[] | string | null;
  profile_text?: string;
  bio_raw?: string;
  links_shown?: string[];
  luma_account?: { company?: string; job_title?: string; github_username?: string };
};

export function readLumaProfile(slug: string, lumaUrl: string): LumaProfile | null {
  const direct = path.join(process.cwd(), "data", "luma", `${slug}.json`);
  if (fs.existsSync(direct)) return parseLuma(direct);
  const dir = path.join(process.cwd(), "data", "luma");
  if (!fs.existsSync(dir)) return null;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "event.json") continue;
    const full = path.join(dir, file);
    const profile = parseLuma(full);
    if (!profile) continue;
    if (profile.luma_url && urlKey(profile.luma_url) === urlKey(lumaUrl)) return profile;
  }
  return null;
}

/** Fill empty CSV fields from a saved Luma profile. Does not write the CSV. */
export function applyLuma(person: PersonRow, profile: LumaProfile | null): PersonRow {
  if (!profile) return person;
  const next = { ...person };
  const fill = (field: keyof PersonRow, value: string | null | undefined) => {
    if (!next[field] && value) next[field] = value;
  };
  fill("name", profile.name);
  fill("headline", profile.headline ?? profile.bio_raw);
  fill("avatar_url", profile.avatar_url);
  fill("luma_url", profile.luma_url);
  fill("linkedin", profile.linkedin);
  fill("x", profile.x);
  fill("github", profile.github);
  fill("youtube", profile.youtube);
  fill("instagram", profile.instagram);
  fill("tiktok", profile.tiktok);
  fill("website", cleanWebsite(profile.website));
  if (!next.github && profile.luma_account?.github_username) {
    next.github = `https://github.com/${profile.luma_account.github_username}`;
  }
  const extras = extraLinks(profile);
  if (!next.other_links && extras.length) next.other_links = extras.join(" ");
  return next;
}

export function accountsFromPerson(person: PersonRow): KnownAccount[] {
  const accounts: KnownAccount[] = [];
  const seen = new Set<string>();
  const add = (platform: string, url: string | null | undefined, via: MatchedVia, confidence: number) => {
    const cleaned = (url ?? "").trim();
    if (!cleaned.startsWith("http")) return;
    const key = `${platform}|${urlKey(cleaned)}`;
    if (seen.has(key)) return;
    seen.add(key);
    accounts.push({ platform, url: urlKey(cleaned), matched_via: via, confidence });
  };

  for (const { platform, field } of ROW_FIELDS) add(platform, person[field], "luma", 1);
  for (const url of person.other_links.split(/\s+/)) {
    const platform = platformForUrl(url);
    if (platform) add(platform, url, "luma", 1);
  }
  return accounts;
}

export function platformForUrl(url: string): string | null {
  const host = hostname(url);
  if (!host) return null;
  for (const entry of PLATFORM_HOSTS) {
    if (entry.pattern.test(host)) return entry.platform;
  }
  return null;
}

export function accountFor(accounts: KnownAccount[], platform: string): KnownAccount | undefined {
  return accounts.find((account) => account.platform === platform);
}

export function handleFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    return last.replace(/^@/, "");
  } catch {
    return "";
  }
}

const PERSON_WORD = /^[\p{L}][\p{L}'.-]*$/u;

/**
 * Name and headline from a LinkedIn profile item (the adapter's profile record:
 * title is the name, the first line of text is the headline).
 * Call this with the linkedin source items before the graph is seeded.
 */
export function linkedInIdentity(items: RawItem[]): { name: string; headline: string } | null {
  const profile = items.find((item) => item.source === "linkedin" && item.kind === "profile" && item.title?.trim());
  const name = profile?.title?.trim() ?? "";
  if (!looksLikePersonName(name)) return null;
  const given = typeof profile?.meta?.headline === "string" ? profile.meta.headline.trim() : "";
  const firstLine =
    (profile?.text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && line.toLowerCase() !== name.toLowerCase()) ?? "";
  const headline = given || firstLine;
  return { name, headline: headline.slice(0, 240) };
}

/**
 * When the CSV name is still the LinkedIn slug, replace it (and an empty headline)
 * from the profile item. Mutates `person` so a later seed uses the real name.
 * No-op unless the current name was derived from the /in/ slug.
 */
export async function applyLinkedInItems(person: PersonRow, items: RawItem[]): Promise<PersonRow> {
  const vanity = linkedInVanity(person.linkedin);
  if (!vanity || !nameMatchesVanity(person.name, vanity)) return person;
  const identity = linkedInIdentity(items);
  if (!identity) return person;
  const saved = await updatePersonIdentity(person.slug, {
    name: identity.name,
    headline: identity.headline || person.headline,
  });
  if (!saved) return person;
  person.name = saved.name;
  person.headline = saved.headline;
  return person;
}

function looksLikePersonName(name: string): boolean {
  const words = name.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  return words.every((word) => PERSON_WORD.test(word));
}

function extraLinks(profile: LumaProfile): string[] {
  const raw = profile.other_links;
  if (Array.isArray(raw)) return raw.filter((link) => typeof link === "string");
  if (typeof raw === "string" && raw.trim()) return raw.split(/\s+/);
  return (profile.links_shown ?? []).filter((link) => platformForUrl(link) == null);
}

function cleanWebsite(value: string | null | undefined): string {
  if (!value) return "";
  return urlKey(value);
}

function parseLuma(file: string): LumaProfile | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LumaProfile;
  } catch {
    return null;
  }
}

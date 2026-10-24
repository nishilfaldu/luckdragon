import { z } from "zod";
import {
  accountFor,
  accountsFromPerson,
  applyLinkedInItems,
  handleFromUrl,
  platformForUrl,
  type KnownAccount,
} from "@/lib/ingest/accounts";
import { hasBrightDataToken, organicLinks, scrape, serp } from "@/lib/ingest/brightdata/client";
import { linkedinPeopleSearchInput, xDiscoverByUsername } from "@/lib/ingest/brightdata/datasets";
import { cachedRaw, readRawCache } from "@/lib/ingest/cache";
import { urlKey, type RawItem } from "@/lib/ingest/items";
import { structured, webSearchText } from "@/lib/ingest/openai";
import { mapPool } from "@/lib/ingest/pool";
import { parseModelJson } from "@/lib/ingest/text";
import { linkedInVanity, nameMatchesVanity } from "@/lib/people";
import type { PersonRow } from "@/lib/types";

const PLATFORMS = ["linkedin", "x", "github", "youtube", "instagram", "threads", "bluesky", "reddit", "website"] as const;

const SITE: Record<(typeof PLATFORMS)[number], string> = {
  linkedin: "linkedin.com/in",
  x: "x.com",
  github: "github.com",
  youtube: "youtube.com",
  instagram: "instagram.com",
  threads: "threads.net",
  bluesky: "bsky.app",
  reddit: "reddit.com/user",
  website: "",
};

const MIN_CONFIDENCE = 0.5;

const PickSchema = z.object({
  matches: z.array(
    z.object({
      platform: z.string(),
      url: z.string(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

type Candidate = { platform: string; url: string; title: string; snippet: string };

/** Find accounts that are missing from the CSV. Drops anything the model scores under 0.5. */
export async function resolveAccounts(
  person: PersonRow,
  hint: string,
  fresh: boolean,
): Promise<KnownAccount[]> {
  await adoptLinkedInName(person, fresh);
  const existing = accountsFromPerson(person);
  const missing = PLATFORMS.filter((platform) => !accountFor(existing, platform));
  if (missing.length === 0) return [];

  const items = await cachedRaw(person.slug, "resolve", fresh, async () => {
    const candidates = hasBrightDataToken()
      ? await brightCandidates(person, missing, hint)
      : await searchCandidates(person, missing, hint);
    if (candidates.length === 0) return [];
    const picked = await pickMatches(person, hint, candidates);
    return picked.map((match) => ({
      source: "resolve",
      url: match.url,
      kind: "account",
      title: match.platform,
      text: match.reason,
      meta: { platform: match.platform, confidence: match.confidence, reason: match.reason },
    }));
  });
  return itemsToAccounts(items);
}

async function searchCandidates(person: PersonRow, missing: string[], hint: string): Promise<Candidate[]> {
  const instructions = [
    `Find profile URLs for ${person.name} on: ${missing.join(", ")}.`,
    person.headline ? `Headline: ${person.headline}.` : "",
    hint ? `Context: ${hint}` : "",
    "Only URLs that are clearly this person. Skip lookalikes.",
    'Return JSON: {"candidates":[{"platform":"","url":"","title":"","snippet":""}]}',
  ]
    .filter(Boolean)
    .join("\n");
  const text = await webSearchText(instructions);
  const parsed = parseModelJson(text) as { candidates?: Array<Record<string, unknown>> };
  const candidates: Candidate[] = [];
  for (const row of parsed.candidates ?? []) {
    const platform = typeof row.platform === "string" ? row.platform : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!missing.includes(platform) || !url.startsWith("http")) continue;
    candidates.push({
      platform,
      url,
      title: typeof row.title === "string" ? row.title : "",
      snippet: typeof row.snippet === "string" ? row.snippet : "",
    });
  }
  return candidates;
}

async function brightCandidates(person: PersonRow, missing: string[], hint: string): Promise<Candidate[]> {
  const company = hint;
  const found: Candidate[] = [];
  await mapPool(missing, 4, async (platform) => {
    const site = SITE[platform as (typeof PLATFORMS)[number]] ?? "";
    const query = [`"${person.name}"`, company, site ? `site:${site}` : ""].filter(Boolean).join(" ");
    try {
      const payload = await serp(query);
      for (const row of organicLinks(payload).slice(0, 4)) {
        if (!row.link) continue;
        found.push({ platform, url: row.link, title: row.title ?? "", snippet: row.description ?? "" });
      }
    } catch {
      // One search engine failure should not drop the other platforms.
    }
  });
  if (missing.includes("linkedin")) found.push(...(await linkedinCandidates(person)));
  if (missing.includes("x")) found.push(...(await xCandidates(person)));
  return found;
}

async function linkedinCandidates(person: PersonRow): Promise<Candidate[]> {
  const [first = "", ...rest] = person.name.split(/\s+/);
  const url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(person.name)}`;
  try {
    const rows = await scrape(linkedinPeopleSearchInput(url, first, rest.join(" ")));
    return rows.slice(0, 4).flatMap((row) => {
      const link = typeof row.url === "string" ? row.url : "";
      if (!link) return [];
      const title = typeof row.name === "string" ? row.name : "";
      const snippet = [row.subtitle, row.location, row.experience].filter((part) => typeof part === "string").join(" · ");
      return [{ platform: "linkedin", url: link, title, snippet }];
    });
  } catch {
    return [];
  }
}

async function xCandidates(person: PersonRow): Promise<Candidate[]> {
  const guesses = usernameGuesses(person.name).slice(0, 2);
  const found: Candidate[] = [];
  for (const guess of guesses) {
    try {
      const rows = await scrape(xDiscoverByUsername(guess));
      for (const row of rows.slice(0, 2)) {
        const link = typeof row.url === "string" ? row.url : `https://x.com/${guess}`;
        const title = typeof row.profile_name === "string" ? row.profile_name : guess;
        const snippet = typeof row.biography === "string" ? row.biography : "";
        found.push({ platform: "x", url: link, title, snippet });
      }
    } catch {
      // A bad username guess is not a failed ingest.
    }
  }
  return found;
}

async function pickMatches(person: PersonRow, hint: string, candidates: Candidate[]): Promise<KnownAccount[]> {
  const known = accountsFromPerson(person)
    .map((account) => `${account.platform} ${account.url}`)
    .join("\n");
  const instructions = [
    `Choose the profile URL for ${person.name} on each platform, or none.`,
    person.headline ? `Headline: ${person.headline}.` : "",
    hint ? `Context: ${hint}` : "",
    known ? `Already known:\n${known}` : "",
    "Candidates:",
    JSON.stringify(candidates),
    "Return one match per platform at most. confidence is 0 to 1.",
    "Use a URL copied from the candidates. Explain the match in reason.",
    "If none of the candidates are this person, return an empty matches array.",
  ]
    .filter(Boolean)
    .join("\n");
  const parsed = await structured("identity_match", PickSchema, instructions);
  const allowed = new Set(candidates.map((candidate) => urlKey(candidate.url)));
  const matches: KnownAccount[] = [];
  for (const match of parsed.matches) {
    if (!PLATFORMS.includes(match.platform as (typeof PLATFORMS)[number])) continue;
    if (!match.url.startsWith("http")) continue;
    if (!allowed.has(urlKey(match.url))) continue;
    if (match.confidence < MIN_CONFIDENCE) continue;
    const hostPlatform = match.platform === "website" ? "website" : platformForUrl(match.url);
    if (match.platform !== "website" && hostPlatform && hostPlatform !== match.platform) continue;
    matches.push({
      platform: match.platform,
      url: urlKey(match.url),
      matched_via: "search",
      confidence: Math.min(1, match.confidence),
      reason: match.reason,
    });
  }
  return matches;
}

/**
 * A LinkedIn URL is stored under a slug-derived name. Load the profile once
 * (the pipeline then reads that cache) and copy the real name onto the row
 * before the other searches run.
 */
async function adoptLinkedInName(person: PersonRow, fresh: boolean): Promise<void> {
  const vanity = linkedInVanity(person.linkedin);
  if (!vanity || !nameMatchesVanity(person.name, vanity)) return;
  try {
    const cached = fresh ? null : readRawCache(person.slug, "linkedin");
    const items = cached?.length ? cached : fresh ? [] : await fetchLinkedInItems(person);
    if (items.length) await applyLinkedInItems(person, items);
  } catch {
    // The LinkedIn source still runs in the pipeline.
  }
}

async function fetchLinkedInItems(person: PersonRow): Promise<RawItem[]> {
  const { linkedin } = await import("@/lib/ingest/sources/linkedin");
  return linkedin.run({
    person,
    accounts: accountsFromPerson(person),
    fresh: false,
    hint: person.headline,
  });
}

function itemsToAccounts(items: RawItem[]): KnownAccount[] {
  const accounts: KnownAccount[] = [];
  for (const item of items) {
    const platform = typeof item.meta?.platform === "string" ? item.meta.platform : item.title ?? "";
    const confidence = typeof item.meta?.confidence === "number" ? item.meta.confidence : 0;
    if (!platform || !item.url || confidence < MIN_CONFIDENCE) continue;
    accounts.push({
      platform,
      url: item.url,
      matched_via: "search",
      confidence,
      reason: item.text,
    });
  }
  return accounts;
}

function usernameGuesses(name: string): string[] {
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const joined = parts.join("");
  const underscored = parts.join("_");
  const firstLast = parts.length > 1 ? `${parts[0]}${parts[parts.length - 1]}` : joined;
  return [...new Set([joined, underscored, firstLast, handleFromUrl(joined)])].filter((value) => value.length > 2);
}

import { platformForUrl } from "@/lib/ingest/accounts";
import { readPeople, slugify, uniqueSlug, upsertPerson } from "@/lib/people";
import { fetchPage, hrefs, metaContent, pageTitle } from "@/lib/ingest/text";
import type { PersonRow } from "@/lib/types";

const EMPTY: Omit<PersonRow, "slug" | "name" | "luma_url"> = {
  role: "",
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

export async function addPersonFromLuma(lumaUrl: string): Promise<PersonRow> {
  const normalized = lumaUrl.trim();
  const existing = readPeople().find((row) => row.luma_url.replace(/\/+$/, "") === normalized.replace(/\/+$/, ""));
  if (existing) return existing;

  const page = await fetchPage(normalized);
  const title = pageTitle(page.html).replace(/\s*\(@[^)]+\)\s*$/, "").trim();
  const name = title || usernameFrom(normalized) || "New person";
  const description = metaContent(page.html, "og:description") || metaContent(page.html, "description");
  const avatar = metaContent(page.html, "og:image");
  const taken = new Set(readPeople().map((row) => row.slug));
  const person: PersonRow = {
    ...EMPTY,
    slug: uniqueSlug(slugify(name), taken),
    name,
    role: "",
    luma_url: normalized,
    headline: description.slice(0, 240),
    avatar_url: avatar,
  };
  const extras: string[] = [];
  for (const href of hrefs(page.html)) {
    let absolute = href;
    try {
      absolute = new URL(href, normalized).toString();
    } catch {
      continue;
    }
    const platform = platformForUrl(absolute);
    if (platform === "linkedin" && !person.linkedin) person.linkedin = absolute;
    else if (platform === "x" && !person.x) person.x = absolute;
    else if (platform === "github" && !person.github) person.github = absolute;
    else if (platform === "youtube" && !person.youtube) person.youtube = absolute;
    else if (platform === "instagram" && !person.instagram) person.instagram = absolute;
    else if (platform === "tiktok" && !person.tiktok) person.tiktok = absolute;
    else if (platform) extras.push(absolute);
  }
  person.other_links = [...new Set(extras)].join(" ");
  return upsertPerson(person);
}

function usernameFrom(lumaUrl: string): string {
  try {
    const parts = new URL(lumaUrl).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1]?.replace(/[-_]/g, " ") ?? "";
  } catch {
    return "";
  }
}

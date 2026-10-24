import { scrape } from "@/lib/ingest/brightdata/client";
import { linkedinPostsInput, linkedinProfileInput } from "@/lib/ingest/brightdata/datasets";
import { clip, type RawItem } from "@/lib/ingest/items";
import { pickString, recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const linkedin = remoteSource({
  id: "linkedin",
  platform: "linkedin",
  fallbackFocus: "LinkedIn posts and current role for this exact person. Prefer their known LinkedIn URL.",
  async bright(_person, account) {
    if (!account) return [];
    const [profile, posts] = await Promise.all([
      scrape(linkedinProfileInput(account.url)),
      scrape(linkedinPostsInput(account.url)).catch(() => []),
    ]);
    const record = profile[0];
    const postItems = recordsToItems("linkedin", "post", posts);
    if (!record) return postItems;
    // The profile record carries roles, schools, and recent activity; keep them as separate items
    // so extraction can turn them into Organization, WORKED_AT, and STUDIED_AT nodes.
    return [
      profileItem(record, account.url),
      ...experienceItems(record, account.url),
      ...educationItems(record, account.url),
      ...(postItems.length ? postItems : profilePostItems(record)),
    ];
  },
});

function profileItem(record: Record<string, unknown>, url: string): RawItem {
  const current = asRecord(record.current_company);
  const text = [
    pickString(record, ["position", "headline"]),
    current ? `Current company: ${pickString(current, ["name"])}` : "",
    pickString(record, ["about"]),
    pickString(record, ["city", "location"]) ? `Location: ${pickString(record, ["city", "location"])}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    source: "linkedin",
    url: pickString(record, ["url"]) || url,
    kind: "profile",
    title: pickString(record, ["name"]),
    text: clip(text, 1500),
    meta: { followers: record.followers, city: record.city, headline: shortHeadline(record) },
  };
}

/** A one-line headline: their title, else the first sentence of About, else the company. */
function shortHeadline(record: Record<string, unknown>): string {
  const position = pickString(record, ["position", "headline"]);
  if (position) return position.slice(0, 120);
  const about = pickString(record, ["about"]).replace(/…$/, "");
  const sentence = about.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  if (sentence && sentence.length <= 140) return sentence;
  return pickString(asRecord(record.current_company) ?? {}, ["name"]);
}

function experienceItems(record: Record<string, unknown>, url: string): RawItem[] {
  return asRecords(record.experience)
    .slice(0, 8)
    .map((role, index) => {
      const company = pickString(role, ["company", "company_name"]);
      const title = pickString(role, ["title", "position"]);
      const dates = [pickString(role, ["start_date"]), pickString(role, ["end_date"]) || "present"].join(" – ");
      return {
        source: "linkedin",
        url: pickString(role, ["url", "company_url"]) || `${url}#experience-${index}`,
        kind: "role",
        title: [title, company].filter(Boolean).join(" at "),
        text: clip(
          [dates, pickString(role, ["location"]), stripHtml(pickString(role, ["description", "description_html"]))]
            .filter(Boolean)
            .join("\n"),
          600,
        ),
        date: pickString(role, ["start_date"]) || undefined,
        meta: { company, position: title },
      };
    })
    .filter((item) => item.title);
}

function educationItems(record: Record<string, unknown>, url: string): RawItem[] {
  return asRecords(record.education)
    .slice(0, 4)
    .map((school, index) => ({
      source: "linkedin",
      url: pickString(school, ["url"]) || `${url}#education-${index}`,
      kind: "education",
      title: pickString(school, ["title", "school", "name"]),
      text: [pickString(school, ["degree"]), pickString(school, ["field"]), years(school)].filter(Boolean).join(", "),
      meta: {},
    }))
    .filter((item) => item.title);
}

function profilePostItems(record: Record<string, unknown>): RawItem[] {
  return [...asRecords(record.posts), ...asRecords(record.activity)]
    .slice(0, 12)
    .map((post) => ({
      source: "linkedin",
      url: pickString(post, ["link", "url"]),
      kind: "post",
      title: clip(pickString(post, ["title"]), 180),
      text: clip(pickString(post, ["title", "interaction", "attribution"]), 600),
      date: pickString(post, ["created_at", "date"]) || undefined,
      meta: {},
    }))
    .filter((item) => item.url);
}

function years(school: Record<string, unknown>): string {
  const start = pickString(school, ["start_year"]);
  const end = pickString(school, ["end_year"]);
  return start || end ? `${start}–${end}` : "";
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((row): row is Record<string, unknown> => !!row) : [];
}

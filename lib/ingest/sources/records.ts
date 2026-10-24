import { capRecent, clip, type RawItem } from "@/lib/ingest/items";

const DATE_KEYS = [
  "date_posted",
  "date",
  "published_at",
  "posted_at",
  "created_at",
  "pushed_at",
  "timestamp",
  "latest_update",
  "date_joined",
];

const TEXT_KEYS = ["post_text", "description", "text", "about", "biography", "comment", "headline", "summary"];
const TITLE_KEYS = ["title", "name", "headline", "full_name", "package_name"];
const URL_KEYS = ["url", "post_url", "link", "profile_url", "external_url", "website"];

export function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

export function recordsToItems(
  source: string,
  kind: string,
  records: Record<string, unknown>[],
  options?: { keepUndated?: boolean; cap?: number },
): RawItem[] {
  const items: RawItem[] = [];
  for (const record of records) {
    const url = pickString(record, URL_KEYS);
    const date = pickString(record, DATE_KEYS) || undefined;
    const title = clip(pickString(record, TITLE_KEYS), 180);
    const text = clip(pickString(record, TEXT_KEYS), 1500);
    if (!url && !title && !text) continue;
    items.push({
      source,
      url: url || `${source}:${kind}:${title ?? items.length}`,
      kind,
      title,
      text,
      date,
      meta: compactMeta(record),
    });
  }
  return capRecent(items, options?.cap ?? 20);
}

function compactMeta(record: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const keep = [
    "likes",
    "followers",
    "following",
    "views",
    "stars",
    "num_stared",
    "language",
    "code_language",
    "company",
    "position",
    "location",
    "city",
    "handle",
    "user_posted",
    "profile_name",
    "account",
    "downloads",
    "industry",
    "industries",
    "company_size",
  ];
  for (const key of keep) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") meta[key] = value;
  }
  return meta;
}

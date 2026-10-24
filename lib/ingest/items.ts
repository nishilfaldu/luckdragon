/** One fetched page, post, repo, or profile before extraction. */

export type RawItem = {
  source: string;
  url: string;
  kind: string;
  title?: string;
  text?: string;
  date?: string;
  meta?: Record<string, unknown>;
};

export const ITEM_CAP = 20;
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

export function windowDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - YEAR_MS);
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return { start: day(start), end: day(end) };
}

export function inLastYear(date: string | undefined): boolean {
  if (!date) return true;
  const time = Date.parse(date);
  if (Number.isNaN(time)) return true;
  return time >= Date.now() - YEAR_MS;
}

/** Keep undated items, drop anything older than a year, then cap. */
export function capRecent(items: RawItem[], cap = ITEM_CAP): RawItem[] {
  const fresh = items.filter((item) => inLastYear(item.date));
  fresh.sort((a, b) => {
    const left = Date.parse(a.date ?? "") || 0;
    const right = Date.parse(b.date ?? "") || 0;
    return right - left;
  });
  return fresh.slice(0, cap);
}

export function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith("utm_")) parsed.searchParams.delete(key);
    }
    let value = parsed.toString();
    if (value.endsWith("/")) value = value.slice(0, -1);
    return value;
  } catch {
    return url.trim();
  }
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

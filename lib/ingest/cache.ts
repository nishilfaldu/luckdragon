import fs from "node:fs";
import path from "node:path";
import type { RawItem } from "@/lib/ingest/items";

type CacheFile = {
  fetched_at: string;
  items: RawItem[];
};

export function rawCachePath(slug: string, source: string): string {
  return path.join(process.cwd(), "data", "raw", slug, `${source}.json`);
}

export function readRawCache(slug: string, source: string): RawItem[] | null {
  const file = rawCachePath(slug, source);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as CacheFile;
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

export function writeRawCache(slug: string, source: string, items: RawItem[]): void {
  const file = rawCachePath(slug, source);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: CacheFile = { fetched_at: new Date().toISOString(), items };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * Reuse data/raw/<slug>/<source>.json unless fresh.
 * `load` returning null means "nothing to do" and is not cached.
 */
export async function cachedRaw(
  slug: string,
  source: string,
  fresh: boolean,
  load: () => Promise<RawItem[] | null>,
): Promise<RawItem[]> {
  if (!fresh) {
    const hit = readRawCache(slug, source);
    if (hit) return hit;
  }
  const items = await load();
  if (!items) return [];
  writeRawCache(slug, source, items);
  return items;
}

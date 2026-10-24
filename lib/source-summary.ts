import { roQuery, ROW_CAP } from "@/lib/falkor";
import type { SourceOutcome } from "@/lib/ingest/report";
import { assertPersonSlug } from "@/lib/graph/ids";
import { graphExists, GraphNotFoundError } from "@/lib/graph/read";

export type SourceProvider = "Bright Data" | "GitHub API" | "LLM";

export type SourceProduct = {
  product: string;
  provider: SourceProvider;
  count: number;
  sampleUrls: string[];
};

export type SourceSummary = {
  slug: string;
  total: number;
  products: SourceProduct[];
  /** The last ingest: when it ran and each source's outcome (null for graphs ingested before reports existed). */
  freshness: { at: string; sources: SourceOutcome[] } | null;
};

type Classified = { product: string; provider: SourceProvider };

const BD = "Bright Data" as const;

const LINKEDIN: Classified = { product: "LinkedIn · Web Scraper API", provider: BD };
const X: Classified = { product: "X · Web Scraper API", provider: BD };
const YOUTUBE: Classified = { product: "YouTube · Web Scraper API", provider: BD };
const BLUESKY: Classified = { product: "Bluesky · Web Scraper API", provider: BD };
const REDDIT: Classified = { product: "Reddit · Web Scraper API", provider: BD };
const INSTAGRAM: Classified = { product: "Instagram · Web Scraper API", provider: BD };
const THREADS: Classified = { product: "Threads · Web Scraper API", provider: BD };
const CRUNCHBASE: Classified = { product: "Crunchbase · Web Scraper API", provider: BD };
const PACKAGES: Classified = { product: "Packages · Web Scraper API", provider: BD };
const NPM: Classified = { product: "npm · Web Scraper API", provider: BD };
const PYPI: Classified = { product: "PyPI · Web Scraper API", provider: BD };
const GITHUB: Classified = { product: "GitHub", provider: "GitHub API" };
const LUMA: Classified = { product: "Luma · Web Unlocker", provider: BD };
const WEB: Classified = { product: "Web · SERP + Web Unlocker", provider: BD };
const DERIVED: Classified = { product: "Derived", provider: "LLM" };
const SEED: Classified = { product: "Seed", provider: "LLM" };

/** `props.via` wins over the URL. These are the ingest source ids. */
const VIA_PRODUCT: Record<string, Classified> = {
  linkedin: LINKEDIN,
  x: X,
  youtube: YOUTUBE,
  bluesky: BLUESKY,
  reddit: REDDIT,
  instagram: INSTAGRAM,
  threads: THREADS,
  crunchbase: CRUNCHBASE,
  packages: PACKAGES,
  github: GITHUB,
  luma: LUMA,
  serp: WEB,
  website: WEB,
  research: WEB,
  resolve: WEB,
  seed: SEED,
};

const HOST_RULES: Array<{ host: string; classified: Classified }> = [
  { host: "linkedin.com", classified: LINKEDIN },
  { host: "x.com", classified: X },
  { host: "twitter.com", classified: X },
  { host: "youtube.com", classified: YOUTUBE },
  { host: "youtu.be", classified: YOUTUBE },
  { host: "bsky.app", classified: BLUESKY },
  { host: "reddit.com", classified: REDDIT },
  { host: "instagram.com", classified: INSTAGRAM },
  { host: "threads.net", classified: THREADS },
  { host: "threads.com", classified: THREADS },
  { host: "crunchbase.com", classified: CRUNCHBASE },
  { host: "npmjs.com", classified: NPM },
  { host: "pypi.org", classified: PYPI },
  { host: "github.com", classified: GITHUB },
  { host: "luma.com", classified: LUMA },
  { host: "lu.ma", classified: LUMA },
];

const PAGE = ROW_CAP;

/**
 * Count nodes in `person:<slug>` by the Bright Data product (or GitHub / LLM)
 * that produced them. `via` is the ingest source id; older nodes are inferred
 * from `source_url`.
 */
export async function sourceSummary(slug: string): Promise<SourceSummary> {
  const person = assertPersonSlug(slug);
  if (!(await graphExists(person))) throw new GraphNotFoundError(person);

  const rows = await readProvenance(person);
  const buckets = new Map<string, SourceProduct>();

  for (const row of rows) {
    const sourceUrl = httpUrl(row.source_url);
    const classified = classify(row.via, sourceUrl);
    const bucket = buckets.get(classified.product) ?? {
      product: classified.product,
      provider: classified.provider,
      count: 0,
      sampleUrls: [],
    };
    bucket.count += 1;
    if (sourceUrl && bucket.sampleUrls.length < 3 && !bucket.sampleUrls.includes(sourceUrl)) {
      bucket.sampleUrls.push(sourceUrl);
    }
    buckets.set(classified.product, bucket);
  }

  const products = [...buckets.values()].sort(
    (a, b) => b.count - a.count || a.product.localeCompare(b.product),
  );

  return { slug: person, total: rows.length, products, freshness: await readFreshness(person) };
}

function classify(via: unknown, sourceUrl: string | undefined): Classified {
  const key = typeof via === "string" ? via.trim().toLowerCase() : "";
  const fromVia = key ? VIA_PRODUCT[key] : undefined;
  if (fromVia) return fromVia;
  return fromHost(sourceUrl);
}

function fromHost(sourceUrl: string | undefined): Classified {
  if (!sourceUrl) return DERIVED;
  let hostname = "";
  try {
    hostname = new URL(sourceUrl).hostname.toLowerCase();
  } catch {
    return WEB;
  }
  if (!hostname) return WEB;
  for (const rule of HOST_RULES) {
    if (hostname === rule.host || hostname.endsWith(`.${rule.host}`)) return rule.classified;
  }
  return WEB;
}

async function readProvenance(slug: string): Promise<Array<{ via: unknown; source_url: unknown }>> {
  const rows: Array<{ via: unknown; source_url: unknown }> = [];
  for (let page = 0; page < 40; page += 1) {
    const skip = page * PAGE;
    const result = await roQuery(
      slug,
      `MATCH (n) RETURN n.via AS via, n.source_url AS source_url SKIP ${skip} LIMIT ${PAGE}`,
    );
    for (const row of result.data) rows.push({ via: row.via, source_url: row.source_url });
    if (result.data.length < PAGE) break;
  }
  return rows;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

async function readFreshness(slug: string): Promise<SourceSummary["freshness"]> {
  const result = await roQuery(slug, "MATCH (p:Person {id: 'person_root'}) RETURN p.last_ingest_at AS at, p.ingest_report AS report");
  const row = result.data[0];
  if (!row || typeof row.at !== "string" || typeof row.report !== "string") return null;
  try {
    return { at: row.at, sources: JSON.parse(row.report) as SourceOutcome[] };
  } catch {
    return null;
  }
}

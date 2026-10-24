/**
 * Bright Data HTTP client.
 *
 * Scraper API: POST /datasets/v3/scrape (sync, format=json). A 202 with snapshot_id
 * falls through to POST /datasets/v3/trigger semantics by polling
 * GET /datasets/v3/progress/{id} and GET /datasets/v3/snapshot/{id}.
 * Web Unlocker and SERP: POST /request with zone + url + format.
 */

const API = "https://api.brightdata.com";
const SYNC_TIMEOUT_MS = 70_000;
const POLL_TIMEOUT_MS = 4 * 60_000;
const POLL_EVERY_MS = 10_000;

export type ScrapeRequest = {
  datasetId: string;
  input: Record<string, unknown>[];
  /** Sets type=discover_new and discover_by. Omit for collect. */
  discoverBy?: string;
  limit?: number;
};

export function hasBrightDataToken(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_TOKEN?.trim());
}

export type HttpPreview = {
  method: "POST";
  url: string;
  body: Record<string, unknown>;
};

export function previewScrape(request: ScrapeRequest): HttpPreview {
  return {
    method: "POST",
    url: `${API}/datasets/v3/scrape?${scrapeParams(request)}`,
    body: scrapeBody(request),
  };
}

export function previewUnlocker(url: string, format: "markdown" | "raw" = "markdown"): HttpPreview {
  return {
    method: "POST",
    url: `${API}/request`,
    body: unlockerBody(url, format),
  };
}

export function previewSerp(query: string, jsonMode = false): HttpPreview {
  return {
    method: "POST",
    url: `${API}/request`,
    body: serpBody(query, jsonMode),
  };
}

export async function scrape(request: ScrapeRequest): Promise<Record<string, unknown>[]> {
  const token = requireToken();
  const preview = previewScrape(request);
  const response = await fetch(preview.url, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(preview.body),
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  });
  if (response.status === 202) {
    const payload = (await response.json()) as { snapshot_id?: string };
    if (!payload.snapshot_id) throw new Error("Bright Data scrape returned 202 without snapshot_id");
    return downloadSnapshot(token, payload.snapshot_id);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`Bright Data scrape ${response.status}: ${text.slice(0, 280)}`);
  const records = parseRecords(text);
  if (records && !Array.isArray(records) && records.snapshot_id) {
    return downloadSnapshot(token, records.snapshot_id);
  }
  return usableRecords(records);
}

/** Web Unlocker. `format` "markdown" sends data_format=markdown and format=raw. */
export async function unlocker(url: string, format: "markdown" | "raw" = "markdown"): Promise<string> {
  const token = requireToken();
  const preview = previewUnlocker(url, format);
  if (!process.env.BRIGHTDATA_UNLOCKER_ZONE?.trim()) throw new Error("BRIGHTDATA_UNLOCKER_ZONE is not set");
  const response = await postRequest(token, preview);
  const text = await response.text();
  if (!response.ok) throw new Error(`Bright Data unlocker ${response.status}: ${text.slice(0, 280)}`);
  return text;
}

export type SerpOrganic = { link?: string; title?: string; description?: string };

/** Google SERP via POST /request. Returns the parsed JSON body. */
export async function serp(query: string): Promise<Record<string, unknown>> {
  const token = requireToken();
  if (!process.env.BRIGHTDATA_SERP_ZONE?.trim()) throw new Error("BRIGHTDATA_SERP_ZONE is not set");
  // Our SERP zone returns HTML by default, so ask for parsed JSON (brd_json=1) first.
  const first = await serpOnce(token, previewSerp(query, true));
  if (Array.isArray(first.organic)) return first;
  return serpOnce(token, previewSerp(query, false));
}

export function organicLinks(payload: Record<string, unknown>): SerpOrganic[] {
  const organic = payload.organic;
  if (!Array.isArray(organic)) return [];
  return organic.filter((row): row is SerpOrganic => !!row && typeof row === "object");
}

async function downloadSnapshot(token: string, snapshotId: string): Promise<Record<string, unknown>[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const progress = await fetch(`${API}/datasets/v3/progress/${snapshotId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await progress.json().catch(() => ({}))) as { status?: string };
    if (!progress.ok) throw new Error(`Bright Data progress ${progress.status} for ${snapshotId}`);
    const status = (body.status ?? "").toLowerCase();
    if (status === "ready" || status === "done" || status === "success") {
      const snap = await fetch(`${API}/datasets/v3/snapshot/${snapshotId}?format=json`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60_000),
      });
      const text = await snap.text();
      if (!snap.ok) throw new Error(`Bright Data snapshot ${snap.status}: ${text.slice(0, 200)}`);
      return usableRecords(parseRecords(text));
    }
    if (status === "failed" || status === "error" || status === "canceled") {
      throw new Error(`Bright Data snapshot ${snapshotId} ${status}`);
    }
    await sleep(POLL_EVERY_MS);
  }
  throw new Error(`Bright Data snapshot ${snapshotId} timed out`);
}

function scrapeParams(request: ScrapeRequest): URLSearchParams {
  const params = new URLSearchParams({
    dataset_id: request.datasetId,
    format: "json",
    include_errors: "true",
  });
  if (request.discoverBy) {
    params.set("type", "discover_new");
    params.set("discover_by", request.discoverBy);
  }
  return params;
}

function scrapeBody(request: ScrapeRequest): Record<string, unknown> {
  return {
    input: request.input,
    limit_per_input: request.limit ?? 20,
  };
}

function unlockerBody(url: string, format: "markdown" | "raw"): Record<string, unknown> {
  return {
    zone: process.env.BRIGHTDATA_UNLOCKER_ZONE?.trim() ?? "",
    url,
    format: "raw",
    ...(format === "markdown" ? { data_format: "markdown" } : {}),
  };
}

function googleSearchUrl(query: string, jsonMode: boolean): string {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&num=10`;
  return jsonMode ? `${url}&brd_json=1` : url;
}

function serpBody(query: string, jsonMode: boolean): Record<string, unknown> {
  return {
    zone: process.env.BRIGHTDATA_SERP_ZONE?.trim() ?? "",
    url: googleSearchUrl(query, jsonMode),
    format: "json",
  };
}

/** POST /request, retried once on a 5xx or network error (SERP and Unlocker both flake under load). */
async function postRequest(token: string, preview: HttpPreview): Promise<Response> {
  const send = () =>
    fetch(preview.url, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(preview.body),
      signal: AbortSignal.timeout(60_000),
    });
  try {
    const response = await send();
    if (response.status < 500) return response;
  } catch {
    // fall through to the retry
  }
  await sleep(2_000);
  return send();
}

async function serpOnce(token: string, preview: HttpPreview): Promise<Record<string, unknown>> {
  const response = await postRequest(token, preview);
  const text = await response.text();
  if (!response.ok) throw new Error(`Bright Data SERP ${response.status}: ${text.slice(0, 280)}`);
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Bright Data SERP returned a non-object body");
  }
  return unwrapSerpBody(parsed as Record<string, unknown>);
}

function unwrapSerpBody(payload: Record<string, unknown>): Record<string, unknown> {
  if (typeof payload.body !== "string") return payload;
  try {
    const inner = JSON.parse(payload.body) as unknown;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as Record<string, unknown>;
  } catch {
    return payload;
  }
  return payload;
}

function requireToken(): string {
  const token = process.env.BRIGHTDATA_API_TOKEN?.trim();
  if (!token) throw new Error("BRIGHTDATA_API_TOKEN is not set");
  return token;
}

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function parseRecords(text: string): Record<string, unknown>[] | { snapshot_id: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter(isRecord);
    if (isRecord(parsed) && typeof parsed.snapshot_id === "string" && !Array.isArray(parsed)) {
      return { snapshot_id: parsed.snapshot_id };
    }
    if (isRecord(parsed)) return [parsed];
    return [];
  }
  const rows: Record<string, unknown>[] = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as unknown;
    if (isRecord(parsed)) rows.push(parsed);
  }
  return rows;
}

function usableRecords(records: Record<string, unknown>[] | { snapshot_id: string } | null): Record<string, unknown>[] {
  if (!records || !Array.isArray(records)) return [];
  const errors = records.filter((row) => typeof row.error === "string" || typeof row.error === "object");
  const ok = records.filter((row) => !errors.includes(row));
  if (ok.length === 0 && errors.length > 0) {
    const first = errors[0]?.error;
    const message = typeof first === "string" ? first : JSON.stringify(first);
    throw new Error(`Bright Data returned only errors: ${message.slice(0, 240)}`);
  }
  return ok;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

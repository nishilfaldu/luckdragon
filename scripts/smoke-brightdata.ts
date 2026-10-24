import { config } from "dotenv";
import path from "node:path";
import {
  hasBrightDataToken,
  previewScrape,
  previewSerp,
  previewUnlocker,
  scrape,
  serp,
  unlocker,
  type HttpPreview,
} from "@/lib/ingest/brightdata/client";
import { smokeRequests } from "@/lib/ingest/brightdata/datasets";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

type Check = { name: string; run: () => Promise<unknown> };

async function main(): Promise<void> {
  if (!hasBrightDataToken()) {
    console.log("dry-run BRIGHTDATA_API_TOKEN is not set");
    const previews: Array<{ name: string; request: HttpPreview }> = [
      { name: "unlocker", request: previewUnlocker("https://example.com", "markdown") },
      { name: "serp", request: previewSerp("Bright Data") },
      { name: "serp-retry", request: previewSerp("Bright Data", true) },
      ...smokeRequests().map((entry) => ({ name: entry.name, request: previewScrape(entry.request) })),
    ];
    for (const preview of previews) {
      console.log(`dry ${preview.name} ${JSON.stringify(preview.request)}`);
    }
    return;
  }

  const checks: Check[] = [
    { name: "unlocker", run: () => unlocker("https://example.com", "markdown") },
    { name: "serp", run: () => serp("Bright Data") },
    ...smokeRequests().map((entry) => ({
      name: entry.name,
      run: () => scrape(entry.request),
    })),
  ];

  let failed = 0;
  for (const check of checks) {
    try {
      const value = await check.run();
      const fields = topFields(value);
      console.log(`ok ${check.name} ${fields.join(",")}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "failed";
      console.log(`fail ${check.name} ${message.replace(/\s+/g, " ").slice(0, 180)}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

function topFields(value: unknown): string[] {
  if (Array.isArray(value)) {
    const first = value[0];
    if (first && typeof first === "object") return Object.keys(first as object).slice(0, 12);
    return [`items:${value.length}`];
  }
  if (typeof value === "string") return [`text:${value.length}`];
  if (value && typeof value === "object") return Object.keys(value as object).slice(0, 12);
  return [];
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "smoke failed";
  console.error(message);
  process.exitCode = 1;
});

import { scrape } from "@/lib/ingest/brightdata/client";
import { crunchbaseInput } from "@/lib/ingest/brightdata/datasets";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const crunchbase = remoteSource({
  id: "crunchbase",
  platform: "crunchbase",
  fallbackFocus: "the Crunchbase company page for this person's current company, only if it is clearly theirs.",
  async bright(_person, account) {
    if (!account) return [];
    const rows = await scrape(crunchbaseInput(account.url));
    return recordsToItems("crunchbase", "company", rows, { cap: 3 });
  },
});

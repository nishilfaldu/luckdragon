import { scrape } from "@/lib/ingest/brightdata/client";
import { blueskyPostsInput } from "@/lib/ingest/brightdata/datasets";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const bluesky = remoteSource({
  id: "bluesky",
  platform: "bluesky",
  fallbackFocus: "recent Bluesky posts by this exact person.",
  async bright(_person, account) {
    if (!account) return [];
    const posts = await scrape(blueskyPostsInput(account.url));
    return recordsToItems("bluesky", "post", posts);
  },
});

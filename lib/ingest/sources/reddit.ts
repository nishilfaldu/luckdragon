import { scrape } from "@/lib/ingest/brightdata/client";
import { redditPostsInput, redditProfileInput } from "@/lib/ingest/brightdata/datasets";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const reddit = remoteSource({
  id: "reddit",
  platform: "reddit",
  fallbackFocus: "recent Reddit posts by this exact person.",
  async bright(_person, account) {
    if (!account) return [];
    const profile = await scrape(redditProfileInput(account.url));
    const posts = await scrape(redditPostsInput(account.url)).catch(() => []);
    return [
      ...recordsToItems("reddit", "profile", profile, { cap: 1 }),
      ...recordsToItems("reddit", "post", posts),
    ];
  },
});

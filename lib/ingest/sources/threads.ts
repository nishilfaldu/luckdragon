import { scrape } from "@/lib/ingest/brightdata/client";
import { threadsPostsInput, threadsProfileInput } from "@/lib/ingest/brightdata/datasets";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const threads = remoteSource({
  id: "threads",
  platform: "threads",
  fallbackFocus: "recent Threads posts by this exact person.",
  async bright(_person, account) {
    if (!account) return [];
    const profile = await scrape(threadsProfileInput(account.url));
    const posts = await scrape(threadsPostsInput(account.url)).catch(() => []);
    return [
      ...recordsToItems("threads", "profile", profile, { cap: 1 }),
      ...recordsToItems("threads", "post", posts),
    ];
  },
});

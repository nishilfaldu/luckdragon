import { scrape } from "@/lib/ingest/brightdata/client";
import { xPostsInput, xProfileInput } from "@/lib/ingest/brightdata/datasets";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const x = remoteSource({
  id: "x",
  platform: "x",
  fallbackFocus: "recent posts on X (Twitter) by this exact person. Prefer their known X URL.",
  async bright(_person, account) {
    if (!account) return [];
    const profile = await scrape(xProfileInput(account.url));
    const posts = await scrape(xPostsInput(account.url)).catch(() => []);
    return [...recordsToItems("x", "profile", profile, { cap: 1 }), ...recordsToItems("x", "post", posts)];
  },
});

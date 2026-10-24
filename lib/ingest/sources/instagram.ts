import { scrape } from "@/lib/ingest/brightdata/client";
import { instagramPostsInput, instagramProfileInput } from "@/lib/ingest/brightdata/datasets";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { remoteSource } from "@/lib/ingest/sources/types";

export const instagram = remoteSource({
  id: "instagram",
  platform: "instagram",
  fallbackFocus: "recent Instagram posts by this exact person. Prefer their known Instagram URL.",
  async bright(_person, account) {
    if (!account) return [];
    const profile = await scrape(instagramProfileInput(account.url));
    const posts = await scrape(instagramPostsInput(account.url)).catch(() => []);
    return [
      ...recordsToItems("instagram", "profile", profile, { cap: 1 }),
      ...recordsToItems("instagram", "post", posts),
    ];
  },
});

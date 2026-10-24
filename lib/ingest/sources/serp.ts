import { hasBrightDataToken, organicLinks, serp as serpSearch } from "@/lib/ingest/brightdata/client";
import { cachedRaw } from "@/lib/ingest/cache";
import { capRecent, clip, type RawItem } from "@/lib/ingest/items";
import { discoverItems, type SourceAdapter } from "@/lib/ingest/sources/types";

export const serp: SourceAdapter = {
  id: "serp",
  async run(ctx) {
    return cachedRaw(ctx.person.slug, "serp", ctx.fresh, async () => {
      const query = [ctx.person.name, ctx.person.headline].filter(Boolean).join(" ");
      if (hasBrightDataToken()) {
        const payload = await serpSearch(query);
        const items: RawItem[] = organicLinks(payload).map((row) => ({
          source: "serp",
          url: row.link || "",
          kind: "result",
          title: clip(row.title, 180),
          text: clip(row.description, 400),
        }));
        return capRecent(items.filter((item) => item.url.startsWith("http")), 10);
      }
      try {
        return discoverItems(
          ctx.person,
          "serp",
          ctx.hint,
          "talks, posts, articles, projects, and social profiles. Include the URL and a date when you can find one.",
        );
      } catch (error) {
        if (error instanceof Error && /cap reached/i.test(error.message)) return null;
        throw error;
      }
    });
  },
};

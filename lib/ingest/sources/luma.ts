import { platformForUrl, readLumaProfile, type LumaProfile } from "@/lib/ingest/accounts";
import { cachedRaw } from "@/lib/ingest/cache";
import { clip, type RawItem } from "@/lib/ingest/items";
import type { SourceAdapter } from "@/lib/ingest/sources/types";
import { fetchPage, hrefs } from "@/lib/ingest/text";

export const luma: SourceAdapter = {
  id: "luma",
  async run(ctx) {
    return cachedRaw(ctx.person.slug, "luma", ctx.fresh, async () => {
      const saved = readLumaProfile(ctx.person.slug, ctx.person.luma_url);
      if (saved) return itemsFromProfile(ctx.person.luma_url, saved);
      if (!ctx.person.luma_url) return null;
      const page = await fetchPage(ctx.person.luma_url);
      const links = hrefs(page.html).filter((href) => href.startsWith("http") && platformForUrl(href));
      return [
        {
          source: "luma",
          url: ctx.person.luma_url,
          kind: "profile",
          title: ctx.person.name,
          text: clip(page.text, 2000),
          meta: { links: links.join(" ") },
        },
      ];
    });
  },
};

function itemsFromProfile(lumaUrl: string, profile: LumaProfile): RawItem[] {
  const company = profile.luma_account?.company ?? "";
  const title = profile.luma_account?.job_title ?? "";
  const text = clip(
    [profile.profile_text || profile.bio_raw || profile.headline || "", title && company ? `${title} at ${company}` : ""]
      .filter(Boolean)
      .join("\n"),
    2000,
  );
  return [
    {
      source: "luma",
      url: profile.luma_url || lumaUrl,
      kind: "profile",
      title: profile.name,
      text,
      meta: {
        company,
        job_title: title,
        headline: profile.headline || "",
      },
    },
  ];
}

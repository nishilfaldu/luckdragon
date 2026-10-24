import { accountFor } from "@/lib/ingest/accounts";
import { cachedRaw } from "@/lib/ingest/cache";
import { clip, type RawItem } from "@/lib/ingest/items";
import type { SourceAdapter } from "@/lib/ingest/sources/types";
import { fetchPage, hrefs } from "@/lib/ingest/text";

export const website: SourceAdapter = {
  id: "website",
  async run(ctx) {
    const account = accountFor(ctx.accounts, "website");
    if (!account) return [];
    return cachedRaw(ctx.person.slug, "website", ctx.fresh, async () => {
      const home = await fetchPage(account.url);
      const items: RawItem[] = [
        {
          source: "website",
          url: account.url,
          kind: "page",
          title: ctx.person.name,
          text: clip(home.text, 4000),
        },
      ];
      for (const url of sameHostLinks(account.url, home.html).slice(0, 4)) {
        try {
          const page = await fetchPage(url);
          items.push({
            source: "website",
            url,
            kind: "page",
            title: url,
            text: clip(page.text, 2500),
          });
        } catch {
          // A dead inner link should not drop the homepage.
        }
      }
      return items;
    });
  },
};

function sameHostLinks(pageUrl: string, html: string): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const interesting = /about|blog|project|writing|talk|work|now|essay/i;
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  const links: string[] = [];
  for (const href of hrefs(html)) {
    let absolute: URL;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (absolute.origin !== origin) continue;
    if (!interesting.test(absolute.pathname)) continue;
    absolute.hash = "";
    const value = absolute.toString().replace(/\/$/, "");
    if (seen.has(value)) continue;
    seen.add(value);
    links.push(value);
  }
  return links;
}

import { hasBrightDataToken, scrape } from "@/lib/ingest/brightdata/client";
import { npmInput, pypiInput } from "@/lib/ingest/brightdata/datasets";
import { cachedRaw } from "@/lib/ingest/cache";
import { accountFor } from "@/lib/ingest/accounts";
import { recordsToItems } from "@/lib/ingest/sources/records";
import { discoverItems, type SourceAdapter } from "@/lib/ingest/sources/types";
import type { RawItem } from "@/lib/ingest/items";

export const packages: SourceAdapter = {
  id: "packages",
  async run(ctx) {
    const npmAccount = accountFor(ctx.accounts, "npm");
    const pypiAccount = accountFor(ctx.accounts, "pypi");
    if (!npmAccount && !pypiAccount) return [];
    return cachedRaw(ctx.person.slug, "packages", ctx.fresh, async () => {
      if (hasBrightDataToken()) {
        const items: RawItem[] = [];
        const npmName = packageName(npmAccount?.url, "/package/");
        const pypiName = packageName(pypiAccount?.url, "/project/");
        if (npmName) items.push(...recordsToItems("npm", "package", await scrape(npmInput(npmName)), { cap: 5 }));
        if (pypiName) items.push(...recordsToItems("pypi", "package", await scrape(pypiInput(pypiName)), { cap: 5 }));
        if (items.length) return items;
      }
      try {
        return discoverItems(
          ctx.person,
          "packages",
          ctx.hint,
          "npm and PyPI packages this person has published. Return package pages only.",
        );
      } catch (error) {
        if (error instanceof Error && /cap reached/i.test(error.message)) return null;
        throw error;
      }
    });
  },
};

function packageName(url: string | undefined, marker: string): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const name = marker.replace(/\//g, "");
    const index = parts.indexOf(name);
    if (index >= 0 && parts[index + 1]) return decodeURIComponent(parts[index + 1]!);
  } catch {
    return null;
  }
  return null;
}

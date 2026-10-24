import type { PersonRow } from "@/lib/types";
import type { KnownAccount } from "@/lib/ingest/accounts";
import { cachedRaw } from "@/lib/ingest/cache";
import { capRecent, clip, type RawItem } from "@/lib/ingest/items";
import { webSearchText } from "@/lib/ingest/openai";
import { parseModelJson } from "@/lib/ingest/text";

export type SourceContext = {
  person: PersonRow;
  accounts: KnownAccount[];
  fresh: boolean;
  /** Profile text and company from Luma, for prompts. */
  hint: string;
};

export type SourceAdapter = {
  id: string;
  run(ctx: SourceContext): Promise<RawItem[]>;
};

export async function discoverItems(
  person: PersonRow,
  source: string,
  hint: string,
  focus: string,
): Promise<RawItem[]> {
  const known = [person.linkedin, person.x, person.github, person.youtube, person.instagram, person.website]
    .filter(Boolean)
    .join(", ");
  const instructions = [
    `Find public ${focus} that are really about ${person.name}.`,
    person.headline ? `Headline: ${person.headline}.` : "",
    hint ? `Context: ${hint}` : "",
    known ? `Known links: ${known}.` : "",
    "Only the last 12 months. At most 12 items. Skip lookalikes.",
    'Return JSON: {"items":[{"url":"","title":"","text":"","date":"YYYY-MM-DD","kind":"post|video|article|profile|repo"}]}',
  ]
    .filter(Boolean)
    .join("\n");
  const text = await webSearchText(instructions);
  const parsed = parseModelJson(text) as { items?: Array<Record<string, unknown>> };
  const items: RawItem[] = [];
  for (const row of parsed.items ?? []) {
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!url.startsWith("http")) continue;
    items.push({
      source,
      url,
      kind: typeof row.kind === "string" ? row.kind : "post",
      title: clip(typeof row.title === "string" ? row.title : undefined, 180),
      text: clip(typeof row.text === "string" ? row.text : undefined, 700),
      date: typeof row.date === "string" ? row.date : undefined,
    });
  }
  return capRecent(items, 12);
}

export function remoteSource(spec: {
  id: string;
  platform: string;
  fallbackFocus: string;
  allowWithoutUrl?: boolean;
  bright: (person: PersonRow, account: KnownAccount | undefined) => Promise<RawItem[]>;
}): SourceAdapter {
  return {
    id: spec.id,
    async run(ctx) {
      const account = ctx.accounts.find((item) => item.platform === spec.platform);
      if (!account && !spec.allowWithoutUrl) return [];
      return cachedRaw(ctx.person.slug, spec.id, ctx.fresh, async () => {
        try {
          const { hasBrightDataToken } = await import("@/lib/ingest/brightdata/client");
          if (hasBrightDataToken()) return spec.bright(ctx.person, account);
          return discoverItems(ctx.person, spec.id, ctx.hint, spec.fallbackFocus);
        } catch (error) {
          if (error instanceof Error && /cap reached/i.test(error.message)) return null;
          throw error;
        }
      });
    },
  };
}

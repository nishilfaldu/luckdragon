import { Agent, run, tool, webSearchTool } from "@openai/agents";
import { z } from "zod";
import { organicLinks, serp, unlocker } from "@/lib/ingest/brightdata/client";
import { cachedRaw } from "@/lib/ingest/cache";
import { capRecent, clip, type RawItem } from "@/lib/ingest/items";
import { openaiModel } from "@/lib/models";
import type { PersonRow } from "@/lib/types";

/** Each tool call is a turn, plus one turn for the final answer. */
const RESEARCH_MAX_TURNS = 8;

const ResearchSchema = z.object({
  items: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      text: z.string(),
      date: z.string(),
      kind: z.string(),
    }),
  ),
});

export async function researchPerson(
  person: PersonRow,
  knownUrls: string[],
  hint: string,
  fresh: boolean,
): Promise<RawItem[]> {
  return cachedRaw(person.slug, "research", fresh, async () => {
    // OpenAI's hosted MCP blocks brightdata.com, so Bright Data SERP and Unlocker run as local function tools.
    const tools = process.env.BRIGHTDATA_API_TOKEN?.trim()
      ? [searchWebTool, readPageTool]
      : [webSearchTool({ searchContextSize: "low" })];

    const agent = new Agent({
      name: "Footprint research",
      model: openaiModel(),
      instructions: [
        "Find public talks, podcasts, articles, and side projects by this person that the known links do not already cover.",
        "Use at most 5 tool calls, then stop and return items.",
        "Every item needs a real http URL. Skip anything you cannot tie to this person.",
        "kind is talk, podcast, article, or project. date is YYYY-MM-DD or empty.",
        "Prefer the last 12 months.",
      ].join(" "),
      tools,
      outputType: ResearchSchema,
    });

    const prompt = [
      `Person: ${person.name}`,
      person.headline ? `Headline: ${person.headline}` : "",
      hint ? `Context: ${hint}` : "",
      knownUrls.length ? `Already covered:\n${knownUrls.slice(0, 40).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await run(agent, prompt, { maxTurns: RESEARCH_MAX_TURNS });
    const output = result.finalOutput;
    if (!output || typeof output === "string") return [];
    const items: RawItem[] = [];
    for (const row of output.items) {
      if (!row.url.startsWith("http")) continue;
      if (knownUrls.includes(row.url)) continue;
      items.push({
        source: "research",
        url: row.url,
        kind: row.kind || "article",
        title: clip(row.title, 180),
        text: clip(row.text, 700),
        date: row.date || undefined,
        meta: { matched_via: "agent" },
      });
    }
    return capRecent(items, 12);
  });
}

const searchWebTool = tool({
  name: "search_web",
  description: "Google search through Bright Data SERP. Returns the top results as title, link, and snippet.",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const results = organicLinks(await serp(query)).slice(0, 8);
    return results.map((row) => `${row.title ?? ""}\n${row.link ?? ""}\n${row.description ?? ""}`).join("\n\n");
  },
});

const readPageTool = tool({
  name: "read_page",
  description: "Fetch a web page as markdown through Bright Data Web Unlocker.",
  parameters: z.object({ url: z.string() }),
  execute: async ({ url }) => clip(await unlocker(url, "markdown"), 6000),
});

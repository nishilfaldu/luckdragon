import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";

import { openaiModel } from "@/lib/models";

/** Per-person cap on Responses web_search calls. Research-agent turns are counted separately. */
const WEB_SEARCH_CAP = 6;

const globalForOpenAI = globalThis as typeof globalThis & {
  __luckdragonOpenAI?: OpenAI;
  __luckdragonWebSearches?: number;
};

export function resetWebSearchBudget(): void {
  globalForOpenAI.__luckdragonWebSearches = 0;
}

export function webSearchesUsed(): number {
  return globalForOpenAI.__luckdragonWebSearches ?? 0;
}

function client(): OpenAI {
  if (!globalForOpenAI.__luckdragonOpenAI) globalForOpenAI.__luckdragonOpenAI = new OpenAI();
  return globalForOpenAI.__luckdragonOpenAI;
}

export async function structured<T>(
  name: string,
  schema: ZodType<T>,
  instructions: string,
): Promise<T> {
  const format = zodTextFormat(schema, name);
  const response = await client().responses.parse({
    model: openaiModel(),
    input: instructions,
    text: { format },
  });
  if (response.output_parsed == null) throw new Error(`Empty structured output (${name})`);
  return response.output_parsed;
}

/** One Responses call with the web_search tool. Throws when the per-person cap is spent. */
export async function webSearchText(instructions: string): Promise<string> {
  const used = globalForOpenAI.__luckdragonWebSearches ?? 0;
  if (used >= WEB_SEARCH_CAP) throw new Error("Web search cap reached");
  globalForOpenAI.__luckdragonWebSearches = used + 1;
  const response = await client().responses.create({
    model: openaiModel(),
    tools: [{ type: "web_search", search_context_size: "low" }],
    input: instructions,
  });
  return response.output_text ?? "";
}

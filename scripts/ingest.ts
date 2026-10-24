import { config } from "dotenv";
import path from "node:path";
import { closeFalkor } from "@/lib/falkor";
import { iterateIngest } from "@/lib/ingest/pipeline";
import { openaiModel } from "@/lib/models";
import { summarizeGraph } from "@/lib/ingest/status";
import { readPeople } from "@/lib/people";

config({ path: path.join(process.cwd(), ".env.local") });
config({ path: path.join(process.cwd(), ".env") });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  const all = args.includes("--all");
  const concurrency = readNumber(args, "--concurrency") ?? 3;
  const slugs = args.filter((arg, index) => {
    if (arg.startsWith("--")) return false;
    const previous = args[index - 1];
    return previous !== "--concurrency";
  });

  const targets = all ? readPeople().map((person) => person.slug) : slugs;
  if (targets.length === 0) {
    console.error("Usage: npm run ingest -- <slug>|--all [--fresh] [--concurrency 3]");
    process.exitCode = 1;
    return;
  }

  let model: string;
  try {
    model = openaiModel();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "OPENAI_MODEL is not set");
    process.exitCode = 1;
    return;
  }
  console.log(`model ${model}`);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const slug = targets[cursor];
      cursor += 1;
      if (!slug) continue;
      for await (const event of iterateIngest(slug, { fresh })) {
        console.log(JSON.stringify(event));
      }
      try {
        const summary = await summarizeGraph(slug);
        console.log(JSON.stringify({ slug, summary }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "summary failed";
        console.log(JSON.stringify({ slug, summaryError: message }));
      }
    }
  });
  await Promise.all(workers);
}

function readNumber(args: string[], flag: string): number | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "ingest failed";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeFalkor();
  });

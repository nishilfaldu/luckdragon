import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import { closeFalkor } from "../lib/falkor";
import { matchesFor, normalizeLabel } from "../lib/match";

const VIEWER = "nishil-faldu";

const NORMALIZE: Array<[string, string]> = [
  ["TS", "typescript"],
  ["JavaScript", "javascript"],
  ["LLMs", "llm"],
  ["large language models", "llm"],
  ["Agents", "ai agents"],
  ["AI agents", "ai agents"],
  ["ML", "machine learning"],
  ["Frameworks", "framework"],
  ["Node.js", "nodejs"],
  ["Next.js", "nextjs"],
  ["artificial intelligence", "ai"],
  ["Model Context Protocol", "mcp"],
  ["C++", "c++"],
  ["analysis", "analysis"],
  ["series", "series"],
];

function loadLocalEnv(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  loadEnv({ path: path.join(root, ".env.local") });
  loadEnv({ path: path.join(root, ".env") });
}

function checkNormalize(): void {
  for (const [input, expected] of NORMALIZE) {
    const got = normalizeLabel(input);
    if (got !== expected) {
      throw new Error(`normalize(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  checkNormalize();
  const matches = (await matchesFor(VIEWER)).slice(0, 8);
  if (matches.length === 0) {
    console.log(`No matches for ${VIEWER}.`);
    return;
  }
  console.log(`Best matches for ${VIEWER} (${matches.length})`);
  matches.forEach((match, index) => {
    const role = match.role ? `  ${match.role}` : "";
    console.log(`\n${index + 1}. ${match.name} — ${match.score.toFixed(2)}${role}`);
    if (match.headline) console.log(`   ${match.headline}`);
    for (const item of match.shared) {
      console.log(`   ${item.type} · ${item.label}  (${item.viewerNodeId} → ${item.theirNodeId})`);
    }
  });
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeFalkor();
  });

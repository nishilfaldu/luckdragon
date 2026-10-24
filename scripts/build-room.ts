import { config } from "dotenv";
import path from "node:path";
import { closeFalkor } from "@/lib/falkor";
import { buildRoom, roomMatches, roomPaths } from "@/lib/room";

config({ path: path.join(process.cwd(), ".env.local") });

/** Rebuild the shared room graph from every person graph, then print a sample. */
async function main(): Promise<void> {
  const count = await buildRoom((slug) => console.log(`room + ${slug}`));
  console.log(`room built from ${count} people`);
  const viewer = process.argv[2] ?? "nishil-faldu";
  const person = process.argv[3] ?? "riken-shah";
  for (const row of await roomMatches(viewer, 5)) console.log("match", row.slug, Number(row.score).toFixed(2), JSON.stringify(row.shared).slice(0, 160));
  const paths = await roomPaths(viewer, person);
  console.log("shared", JSON.stringify(paths.shared).slice(0, 400));
  console.log("whyNow", JSON.stringify(paths.whyNow).slice(0, 400));
  console.log("intros", JSON.stringify(paths.intros).slice(0, 400));
  console.log("shortest", paths.shortest.join(" — "));
  console.log("traces", paths.traces.map((t) => `${t.name}:${t.rowCount}r/${t.ms}ms`).join(" "));
  await closeFalkor();
}

void main();

import { config } from "dotenv";
import path from "node:path";
import { closeFalkor, listPersonGraphs, query } from "@/lib/falkor";
import { readPeople } from "@/lib/people";

config({ path: path.join(process.cwd(), ".env.local") });

/** Copies role and headline from data/people.csv onto each graph's person_root, so a deploy without the CSV keeps them. */
async function main(): Promise<void> {
  const graphs = new Set(await listPersonGraphs());
  for (const person of readPeople()) {
    if (!graphs.has(`person:${person.slug}`)) continue;
    await query(person.slug, "MATCH (p:Person {id: 'person_root'}) SET p.role = $role, p.headline = $headline", {
      role: person.role,
      headline: person.headline,
    });
    console.log(`${person.slug} ${person.role}`);
  }
  await closeFalkor();
}

void main();

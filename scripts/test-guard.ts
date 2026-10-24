import { assertReadOnly } from "@/lib/falkor";

type Case = { name: string; query: string; allow: boolean };

const cases: Case[] = [
  { name: "lowercase merge", query: "MATCH (n) merge (m:Person {id: 'x'}) RETURN m", allow: false },
  { name: "SET inside a string", query: "MATCH (n) WHERE n.name = 'please SET this' RETURN n", allow: true },
  { name: "SET inside double quotes", query: 'MATCH (n) WHERE n.note = "do not SET me" RETURN n', allow: true },
  { name: "write only in a line comment", query: "MATCH (n) RETURN n // CREATE (x:Person {id: 'x'})", allow: true },
  { name: "write only in a block comment", query: "/* MERGE (n:Person {id: 'x'}) */ MATCH (n) RETURN n", allow: true },
  { name: "comment does not hide a later write", query: "MATCH (n) RETURN n // note\nSET n.a = 1", allow: false },
  { name: "block comment does not hide DELETE", query: "MATCH (n) /* safe */ DELETE n", allow: false },
  {
    name: "http in a string does not swallow the write",
    query: "MATCH (n) WHERE n.url = 'http://example.com' CREATE (m:Person {id: 'x'}) RETURN m",
    allow: false,
  },
  {
    name: "CALL db.idx.fulltext.createNodeIndex",
    query: "CALL db.idx.fulltext.createNodeIndex('idx', ['name'])",
    allow: false,
  },
  { name: "DETACH DELETE", query: "MATCH (n) DETACH DELETE n", allow: false },
  { name: "LOAD CSV", query: "LOAD CSV FROM 'file:///tmp/a.csv' AS row RETURN row", allow: false },
  { name: "FOREACH", query: "MATCH (n) FOREACH (x IN [1] | SET n.a = x) RETURN n", allow: false },
  { name: "mixed-case drop", query: "dRoP INDEX FOR (n:Person) ON (n.id)", allow: false },
  { name: "REMOVE", query: "MATCH (n) REMOVE n.name RETURN n", allow: false },
  { name: "SET inside backticks", query: "MATCH (n) WHERE n.`SET` = 1 RETURN n", allow: true },
  {
    name: "allowed fulltext query",
    query: "CALL db.idx.fulltext.queryNodes('idx', 'hello') YIELD node RETURN node",
    allow: true,
  },
  { name: "plain match", query: "MATCH (n) RETURN n.id LIMIT 5", allow: true },
];

let failed = 0;
for (const item of cases) {
  let rejected = false;
  let message = "";
  try {
    assertReadOnly(item.query);
  } catch (error) {
    rejected = true;
    message = error instanceof Error ? error.message : "rejected";
  }
  const ok = item.allow ? !rejected : rejected;
  if (!ok) failed += 1;
  const verdict = ok ? "ok" : "FAIL";
  const detail = rejected ? message : "allowed";
  console.log(`${verdict} ${item.name} ${item.allow ? "allow" : "block"} ${detail}`);
}

if (failed > 0) {
  console.error(`${failed} guard case${failed === 1 ? "" : "s"} failed`);
  process.exitCode = 1;
} else {
  console.log(`${cases.length} guard cases passed`);
}

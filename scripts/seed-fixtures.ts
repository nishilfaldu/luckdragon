import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

import { assertReadOnly, closeFalkor, query, roQuery } from "../lib/falkor";
import { nodeId } from "../lib/graph/ids";
import { getGraph } from "../lib/graph/read";
import { writeGraph } from "../lib/graph/write";
import {
  NODE_TYPES,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type NodeType,
} from "../lib/types";

const FETCHED = "2026-10-23T16:00:00.000Z";

type ContentKind = "Post" | "Video" | "Repo" | "Package" | "Article";

type Content = {
  type: ContentKind;
  label: string;
  url: string;
  date?: string;
  topics?: string[];
  skills?: string[];
  account?: string;
  props: Record<string, unknown>;
};

type Profile = {
  slug: string;
  name: string;
  headline: string;
  location: string;
  luma: string;
  avatar: string;
  website: string;
  accounts: Array<{
    platform: string;
    handle: string;
    url: string;
    followers: number;
    matched_via: string;
    confidence: number;
  }>;
  works: { name: string; url: string; title: string; start: string; industry: string; size: string };
  worked: { name: string; url: string; title: string; start: string; end: string; industry: string; size: string };
  school: { name: string; url: string; degree: string; start: string; end: string };
  community: { name: string; url: string };
  skills: string[];
  items: Content[];
};

const NORTHLINE = { name: "Northline", url: "https://northline.dev" };

const maya: Profile = {
  slug: "demo-viewer",
  name: "Maya Ellison",
  headline: "Staff engineer building TypeScript agents and the tools around them",
  location: "San Francisco",
  luma: "https://luma.com/user/mayaellison",
  avatar: "https://github.com/mayaellison.png",
  website: "https://mayaellison.dev",
  accounts: [
    { platform: "github", handle: "mayaellison", url: "https://github.com/mayaellison", followers: 2400, matched_via: "luma", confidence: 0.99 },
    { platform: "x", handle: "maya_builds", url: "https://x.com/maya_builds", followers: 8100, matched_via: "luma", confidence: 0.99 },
    { platform: "linkedin", handle: "mayaellison", url: "https://www.linkedin.com/in/mayaellison", followers: 4200, matched_via: "luma", confidence: 0.98 },
    { platform: "youtube", handle: "@mayaellison", url: "https://www.youtube.com/@mayaellison", followers: 1900, matched_via: "search", confidence: 0.81 },
    { platform: "website", handle: "mayaellison.dev", url: "https://mayaellison.dev", followers: 0, matched_via: "luma", confidence: 0.99 },
  ],
  works: { name: "Lumenfield", url: "https://lumenfield.dev", title: "Staff Engineer", start: "2024-03", industry: "AI infrastructure", size: "40" },
  worked: { ...NORTHLINE, title: "Senior Engineer", start: "2021-06", end: "2024-02", industry: "developer tools", size: "120" },
  school: { name: "University of Washington", url: "https://www.washington.edu", degree: "BS Computer Science", start: "2013", end: "2017" },
  community: { name: "SF Agents", url: "https://lu.ma/sf-agents" },
  skills: ["TypeScript", "Node.js", "Zod", "Cypher", "Prompt design"],
  items: [
    post("x", "https://x.com/maya_builds/status/184200000000000001", "2026-10-12", "Typed tool calls, finally", "Shipped a typed tool-caller for our agent runtime. Zod schemas in, JSON schema out, and the model stops inventing arguments.", 186, ["TypeScript", "tool calling", "AI agents"]),
    post("x", "https://x.com/maya_builds/status/184200000000000002", "2026-10-01", "DevWorld talks on agent memory", "Watching the DevWorld talks on agent memory. The graph-as-memory one is the first that matches how our loop actually works.", 142, ["AI agents", "graph databases"]),
    post("x", "https://x.com/maya_builds/status/184200000000000003", "2026-09-28", "MCP servers are the new plugins", "MCP servers are the new plugins. Wrote up how we host them beside the agent instead of inside it.", 240, ["MCP", "AI agents"]),
    post("linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:maya-evals-202608", "2026-08-04", "An eval harness that fails the build", "An eval harness that fails the build when a tool call regresses. TypeScript in, a red check in CI out.", 96, ["evals", "AI agents"]),
    post("x", "https://x.com/maya_builds/status/184200000000000004", "2026-07-22", "Zod 4 as the tool contract", "Zod 4 schemas are the tool contract now. If it doesn't parse, the agent never sees the call.", 88, ["TypeScript", "tool calling"]),
    post("x", "https://x.com/maya_builds/status/184200000000000005", "2026-06-19", "agents-kit 0.4", "agents-kit 0.4 is out: handoffs as typed functions, traces on by default.", 74, ["TypeScript", "developer tools"]),
    post("x", "https://x.com/maya_builds/status/184200000000000006", "2026-04-02", "Trace the tool error, not the model", "Most of our agent bugs were tool errors with a confident paragraph on top. Trace the tool call.", 51, ["tool calling"]),
    post("linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:maya-northline-202601", "2026-01-15", "What I learned leaving Northline", "What I learned leaving Northline for Lumenfield: the platform work was the product, I just couldn't see it from inside.", 132, ["developer tools"]),
    post("x", "https://x.com/maya_builds/status/184200000000000007", "2025-12-09", "SF Agents meetup notes", "SF Agents meetup notes: everyone is rebuilding memory, almost nobody is putting a real query language under it.", 40, ["AI agents", "graph databases"]),
    post("x", "https://x.com/maya_builds/status/184200000000000008", "2025-11-20", "Graph query in the agent loop", "Rough notes on running a graph query inside the agent loop. Cypher is easier to cite than a vector hit.", 63, ["graph databases", "AI agents", "Cypher"]),
    post("linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:maya-mcp-bridge-202609", "2026-09-05", "mcp-bridge is public", "Open sourced mcp-bridge, the small TypeScript server we use to expose internal tools to agents.", 77, ["MCP", "TypeScript"]),
    video("podcast", "https://www.youtube.com/watch?v=mayaMem0ry01", "2026-09-15", "Agents that query their own memory", 6100, ["AI agents", "graph databases"]),
    video("talk", "https://www.youtube.com/watch?v=mayaTools0001", "2026-07-02", "TypeScript at the edge of the tool call", 2400, ["TypeScript", "tool calling"]),
    video("video", "https://www.youtube.com/watch?v=mayaKitWalk1", "2026-03-18", "agents-kit walkthrough", 1800, ["developer tools", "TypeScript"]),
    video("podcast", "https://www.youtube.com/watch?v=mayaLeave001", "2025-12-02", "Leaving a platform team", 900, ["developer tools"]),
    repo("https://github.com/mayaellison/agents-kit", "agents-kit", "2026-10-18", "Typed tools, handoffs, and tracing for TypeScript agents", 840, ["AI agents", "TypeScript", "tool calling"], ["TypeScript", "Zod"]),
    repo("https://github.com/mayaellison/mcp-bridge", "mcp-bridge", "2026-09-02", "Host MCP servers next to a TypeScript agent runtime", 210, ["MCP", "developer tools"], ["TypeScript", "Node.js"]),
    repo("https://github.com/mayaellison/eval-runner", "eval-runner", "2026-08-01", "CI evals for agent tool calls", 120, ["evals", "AI agents"], ["TypeScript"]),
    repo("https://github.com/mayaellison/graph-notes", "graph-notes", "2026-08-28", "Notes and sample Cypher for querying agent memory", 64, ["graph databases", "Cypher"], ["Cypher"]),
    repo("https://github.com/mayaellison/northline-cli", "northline-cli", "2026-04-11", "Personal mirror of the Northline internal CLI I still use for traces", 38, ["developer tools"], ["TypeScript", "Node.js"]),
    pkg("npm", "@lumenfield/agents", "https://www.npmjs.com/package/@lumenfield/agents", 18000),
    pkg("npm", "@lumenfield/mcp-bridge", "https://www.npmjs.com/package/@lumenfield/mcp-bridge", 4200),
    article("https://mayaellison.dev/blog/graph-database-agent-loop", "2026-08-30", "What I want from a graph database in an agent loop", "mayaellison.dev", ["graph databases", "AI agents"]),
    article("https://mayaellison.dev/blog/handoffs-are-typed-functions", "2026-05-12", "Handoffs are just typed functions", "mayaellison.dev", ["TypeScript", "AI agents"]),
    article("https://lumenfield.dev/blog/shipping-mcp", "2026-02-03", "Shipping MCP without a platform team", "lumenfield.dev", ["MCP", "developer tools"]),
  ],
};

const alex: Profile = {
  slug: "demo-alex",
  name: "Alex Rivera",
  headline: "Founder of Harbor, building devtools for agents. Speaks at conferences.",
  location: "San Francisco",
  luma: "https://luma.com/user/alexrivera",
  avatar: "https://github.com/alexrivera.png",
  website: "https://harbor.dev",
  accounts: [
    { platform: "github", handle: "alexrivera", url: "https://github.com/alexrivera", followers: 5600, matched_via: "luma", confidence: 0.99 },
    { platform: "x", handle: "alex_harbor", url: "https://x.com/alex_harbor", followers: 15200, matched_via: "luma", confidence: 0.99 },
    { platform: "linkedin", handle: "alexrivera", url: "https://www.linkedin.com/in/alexrivera", followers: 9800, matched_via: "luma", confidence: 0.98 },
    { platform: "youtube", handle: "@alexrivera", url: "https://www.youtube.com/@alexrivera", followers: 6400, matched_via: "search", confidence: 0.84 },
    { platform: "website", handle: "harbor.dev", url: "https://harbor.dev", followers: 0, matched_via: "luma", confidence: 0.99 },
  ],
  works: { name: "Harbor", url: "https://harbor.dev", title: "Founder", start: "2023-01", industry: "developer tools", size: "12" },
  worked: { ...NORTHLINE, title: "Engineering Manager", start: "2019-04", end: "2022-11", industry: "developer tools", size: "120" },
  school: { name: "UC Berkeley", url: "https://www.berkeley.edu", degree: "BS EECS", start: "2011", end: "2015" },
  community: { name: "DevWorld SF", url: "https://devworldsf.com" },
  skills: ["TypeScript", "Go", "Cypher", "Public speaking", "Product"],
  items: [
    post("x", "https://x.com/alex_harbor/status/185500000000000001", "2026-10-20", "DevWorld talk is up", "DevWorld talk is up: graphs as the memory layer for coding agents. Slides and the Cypher are in the repo.", 510, ["AI agents", "graph databases", "conference talks"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000002", "2026-10-02", "Harbor 0.9 traces every tool call", "Harbor 0.9: trace every tool call your agent makes, then replay the bad one without rerunning the model.", 430, ["tool calling", "developer tools"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000003", "2026-09-25", "MCP support in Harbor", "Harbor can now attach MCP servers and record them on the same trace as local tools.", 205, ["MCP", "developer tools"]),
    post("linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:alex-devworld-202608", "2026-08-20", "Speaking at DevWorld SF", "Speaking at DevWorld SF in October about agent memory. I'll show the Cypher, not a diagram of a vector store.", 188, ["conference talks", "graph databases"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000004", "2026-07-14", "Replay a bad tool call", "agent-cli can replay a bad tool call from a trace. That's the demo I keep giving, because it's the one people remember.", 260, ["tool calling", "developer tools"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000005", "2026-06-16", "Office hours on agent memory", "San Francisco office hours on agent memory this Thursday. Bring a trace, not a pitch.", 64, ["AI agents", "graph databases"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000006", "2026-05-30", "Hiring engineers who care about DX", "We hired two engineers who still argue about CLI help text. That's the job.", 90, ["developer tools"]),
    post("linkedin", "https://www.linkedin.com/feed/update/urn:li:activity:alex-northline-202603", "2026-03-11", "Northline taught me to watch the tool", "Northline taught me to watch the tool, not the model. Harbor is that lesson as a product.", 140, ["developer tools", "tool calling"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000007", "2026-01-08", "Harbor is open source", "Harbor is open source now. The trace format is the part I want other CLIs to adopt.", 980, ["developer tools", "TypeScript"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000008", "2025-11-18", "Devtools founders should still write Cypher", "Why devtools founders should still write Cypher: if you can't query your own product's memory, your users can't either.", 70, ["Cypher", "graph databases"]),
    post("x", "https://x.com/alex_harbor/status/185500000000000009", "2026-09-02", "TypeScript strict mode in the CLI", "Turned strict on in agent-cli. The tool schemas got shorter the same day.", 155, ["TypeScript", "developer tools"]),
    video("talk", "https://www.youtube.com/watch?v=alexGraphMem1", "2026-10-08", "Graphs as the memory layer for coding agents", 12400, ["graph databases", "AI agents", "conference talks"]),
    video("talk", "https://www.youtube.com/watch?v=alexDevtool01", "2026-06-25", "Build a devtool people open every day", 8000, ["developer tools", "conference talks"]),
    video("podcast", "https://www.youtube.com/watch?v=alexFounder01", "2026-02-14", "Founder diary: Harbor", 3200, ["developer tools"]),
    video("talk", "https://www.youtube.com/watch?v=alexCliAgent1", "2025-11-05", "The CLI is the agent interface", 5400, ["developer tools", "AI agents"]),
    repo("https://github.com/harbor-dev/agent-cli", "agent-cli", "2026-10-11", "CLI for running, tracing, and replaying agent tool calls", 1204, ["AI agents", "tool calling", "developer tools"], ["TypeScript"]),
    repo("https://github.com/harbor-dev/harbor", "harbor", "2026-10-02", "Trace and replay agent tool calls", 3500, ["tool calling", "developer tools"], ["TypeScript", "Go"]),
    repo("https://github.com/harbor-dev/trace-spec", "trace-spec", "2026-09-12", "A small JSON trace format for agent tool calls", 410, ["tool calling"], ["TypeScript"]),
    repo("https://github.com/alexrivera/devworld-2026", "devworld-2026", "2026-10-09", "Slides and Cypher from the DevWorld SF talk on graph memory", 96, ["graph databases", "conference talks", "Cypher"], ["Cypher"]),
    repo("https://github.com/alexrivera/northline-sdk", "northline-sdk", "2026-02-02", "A personal mirror of the Northline tracing SDK", 44, ["developer tools"], ["TypeScript"]),
    pkg("npm", "harbor-cli", "https://www.npmjs.com/package/harbor-cli", 42000),
    pkg("npm", "@harbor-dev/trace", "https://www.npmjs.com/package/@harbor-dev/trace", 9600),
    article("https://harbor.dev/blog/why-we-left-vector-only-memory", "2026-09-18", "Why we left vector-only memory", "harbor.dev", ["graph databases", "AI agents"]),
    article("https://harbor.dev/blog/tracing-is-the-product", "2026-04-22", "Tracing is the product", "harbor.dev", ["tool calling", "developer tools"]),
    article("https://harbor.dev/blog/leaving-northline", "2025-12-12", "Founding notes: leaving Northline", "harbor.dev", ["developer tools"]),
    article("https://harbor.dev/blog/checklist-before-you-speak", "2026-08-01", "A checklist before you speak", "harbor.dev", ["conference talks"]),
  ],
};

function post(
  platform: string,
  url: string,
  date: string,
  label: string,
  text: string,
  likes: number,
  topics: string[],
): Content {
  return {
    type: "Post",
    label,
    url,
    date,
    topics,
    account: platform,
    props: { platform, text, url, posted_at: iso(date), likes },
  };
}

function video(kind: string, url: string, date: string, title: string, views: number, topics: string[]): Content {
  return {
    type: "Video",
    label: title,
    url,
    date,
    topics,
    account: "youtube",
    props: { title, url, published_at: iso(date), views, kind },
  };
}

function repo(
  url: string,
  name: string,
  date: string,
  description: string,
  stars: number,
  topics: string[],
  skills: string[],
): Content {
  return {
    type: "Repo",
    label: name,
    url,
    date,
    topics,
    skills,
    account: "github",
    props: { name, url, description, stars, language: "TypeScript", pushed_at: iso(date) },
  };
}

function pkg(registry: string, name: string, url: string, downloads: number): Content {
  return {
    type: "Package",
    label: name,
    url,
    props: { registry, name, url, downloads },
  };
}

function article(url: string, date: string, title: string, outlet: string, topics: string[]): Content {
  return {
    type: "Article",
    label: title,
    url,
    date,
    topics,
    props: { title, url, published_at: iso(date), outlet },
  };
}

function iso(day: string): string {
  return `${day}T15:00:00.000Z`;
}

function build(profile: Profile): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const bag = { nodes, edges };

  const person = add(bag, "Person", profile.name, profile.name, {
    name: profile.name,
    headline: profile.headline,
    avatar_url: profile.avatar,
    location: profile.location,
    luma_url: profile.luma,
  }, profile.luma, 1);

  const location = add(bag, "Location", profile.location, profile.location, { name: profile.location }, profile.luma, 0.95);
  link(bag, person, "BASED_IN", location);

  const accounts = new Map<string, GraphNode>();
  for (const account of profile.accounts) {
    const node = add(
      bag,
      "Account",
      `@${account.handle.replace(/^@+/, "")}`,
      account.url,
      { platform: account.platform, handle: account.handle, url: account.url, followers: account.followers, matched_via: account.matched_via },
      account.url,
      account.confidence,
    );
    accounts.set(account.platform, node);
    link(bag, person, "HAS_ACCOUNT", node);
  }

  const current = add(bag, "Organization", profile.works.name, profile.works.url, {
    name: profile.works.name,
    kind: "company",
    url: profile.works.url,
    industry: profile.works.industry,
    size: profile.works.size,
  }, profile.works.url, 0.97);
  link(bag, person, "WORKS_AT", current, { title: profile.works.title, start: profile.works.start });

  const past = add(bag, "Organization", profile.worked.name, profile.worked.url, {
    name: profile.worked.name,
    kind: "company",
    url: profile.worked.url,
    industry: profile.worked.industry,
    size: profile.worked.size,
  }, profile.worked.url, 0.96);
  link(bag, person, "WORKED_AT", past, {
    title: profile.worked.title,
    start: profile.worked.start,
    end: profile.worked.end,
  });

  const school = add(bag, "Organization", profile.school.name, profile.school.url, {
    name: profile.school.name,
    kind: "school",
    url: profile.school.url,
  }, profile.school.url, 0.94);
  link(bag, person, "STUDIED_AT", school, {
    degree: profile.school.degree,
    start: profile.school.start,
    end: profile.school.end,
  });

  const community = add(bag, "Topic", profile.community.name, profile.community.name, {
    name: profile.community.name,
  }, profile.community.url, 0.8);
  link(bag, person, "INTERESTED_IN", community, { weight: 1 });

  const skills = new Map<string, GraphNode>();
  for (const name of profile.skills) {
    const node = add(bag, "Skill", name, name, { name }, profile.website, 0.9);
    skills.set(name.toLowerCase(), node);
    link(bag, person, "HAS_SKILL", node);
  }

  const topicWeights = new Map<string, { node: GraphNode; weight: number }>();

  for (const item of profile.items) {
    const node = add(bag, item.type, item.label, item.url, item.props, item.url, 0.92);
    link(bag, person, "AUTHORED", node, item.date ? { at: iso(item.date) } : undefined);
    if ((item.type === "Post" || item.type === "Video") && item.account) {
      const account = accounts.get(item.account);
      if (account) link(bag, node, "POSTED_ON", account);
    }
    if (item.type === "Repo") {
      for (const skillName of item.skills ?? []) {
        const skill = skills.get(skillName.toLowerCase()) ?? add(bag, "Skill", skillName, skillName, { name: skillName }, profile.website, 0.88);
        skills.set(skillName.toLowerCase(), skill);
        link(bag, node, "USES", skill);
      }
    }
    if (item.type !== "Package") {
      for (const topicName of item.topics ?? []) {
        const topic = add(bag, "Topic", topicName, topicName, { name: topicName }, item.url, 0.86);
        link(bag, node, "ABOUT", topic);
        const currentWeight = topicWeights.get(topic.id) ?? { node: topic, weight: 0 };
        currentWeight.weight += 1;
        topicWeights.set(topic.id, currentWeight);
      }
    }
  }

  for (const { node, weight } of topicWeights.values()) {
    link(bag, person, "INTERESTED_IN", node, { weight });
  }

  return bag;
}

function add(
  bag: { nodes: GraphNode[]; edges: GraphEdge[] },
  type: NodeType,
  label: string,
  key: string,
  props: Record<string, unknown>,
  source: string | undefined,
  confidence: number,
): GraphNode {
  const id = nodeId(type, key);
  const existing = bag.nodes.find((node) => node.id === id);
  if (existing) return existing;
  const node: GraphNode = {
    id,
    type,
    label,
    props,
    source_url: source,
    fetched_at: FETCHED,
    confidence,
  };
  bag.nodes.push(node);
  return node;
}

function link(
  bag: { nodes: GraphNode[]; edges: GraphEdge[] },
  source: GraphNode,
  type: EdgeType,
  target: GraphNode,
  props?: Record<string, unknown>,
) {
  bag.edges.push({ source: source.id, target: target.id, type, props });
}

function check(profile: Profile, graph: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const missing = NODE_TYPES.filter((type) => !counts.get(type));
  if (missing.length > 0) throw new Error(`${profile.slug} is missing node types: ${missing.join(", ")}`);
  if (graph.nodes.length < 40 || graph.nodes.length > 60) {
    throw new Error(`${profile.slug} has ${graph.nodes.length} nodes, expected 40–60`);
  }
  const recent = graph.nodes.filter((node) => {
    const date = node.props.posted_at ?? node.props.published_at ?? node.props.pushed_at;
    return typeof date === "string" && date.slice(0, 10) >= "2026-07-26";
  });
  if (recent.length < 5) throw new Error(`${profile.slug} has only ${recent.length} recent items`);
  if (!graph.nodes.some((node) => node.label === "Northline")) {
    throw new Error(`${profile.slug} is missing Northline`);
  }
  console.log(
    `${profile.slug}: ${graph.nodes.length} nodes, ${graph.edges.length} edges, root ${graph.nodes.find((node) => node.id === "person_root")?.label}`,
  );
  console.log(
    [...counts.entries()].map(([type, count]) => `${type}=${count}`).join(" "),
  );
}

async function seedOne(profile: Profile, graph: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  await query(profile.slug, "MATCH (n) DETACH DELETE n");
  const written = await writeGraph(profile.slug, graph.nodes, graph.edges);
  const read = await getGraph(profile.slug);
  if (read.nodes.length !== written.nodes) {
    throw new Error(`${profile.slug} read ${read.nodes.length} nodes after writing ${written.nodes}`);
  }
  if (read.links.length !== written.edges) {
    throw new Error(`${profile.slug} read ${read.links.length} edges after writing ${written.edges}`);
  }
  if (read.root.label !== profile.name) {
    throw new Error(`${profile.slug} root label is ${read.root.label}`);
  }
  console.log(`read back ${profile.slug}: ${read.nodes.length} nodes, ${read.links.length} links`);
}

async function checkReadOnlyGuard() {
  assertReadOnly("MATCH (n) RETURN n.id LIMIT 5");
  for (const sample of ["CREATE (n:Person {id: 'x'})", "MERGE (n:Person {id: 'x'})", "MATCH (n) DELETE n", "MATCH (n) SET n.a = 1", "DROP INDEX FOR (n:Person) ON (n.id)"]) {
    let blocked = false;
    try {
      assertReadOnly(sample);
    } catch (error) {
      blocked = error instanceof Error && /write clause/i.test(error.message);
    }
    if (!blocked) throw new Error(`Read-only guard allowed: ${sample}`);
  }
  let queryBlocked = false;
  try {
    await roQuery("demo-alex", "CREATE (n:Person {id: 'should-not-exist'})");
  } catch (error) {
    queryBlocked = error instanceof Error && /write clause/i.test(error.message);
  }
  if (!queryBlocked) throw new Error("roQuery allowed a CREATE");
  const leftover = await roQuery("demo-alex", "MATCH (n {id: 'should-not-exist'}) RETURN n.id AS id");
  if (leftover.data.length > 0) throw new Error("A rejected write still created a node");
  console.log("read-only guard blocked CREATE, MERGE, SET, DELETE, and DROP");
}

async function main() {
  const viewer = build(maya);
  const alexGraph = build(alex);
  check(maya, viewer);
  check(alex, alexGraph);

  const viewerNorthline = viewer.nodes.find((node) => node.label === "Northline");
  const alexNorthline = alexGraph.nodes.find((node) => node.label === "Northline");
  if (!viewerNorthline || viewerNorthline.id !== alexNorthline?.id) {
    throw new Error("Northline ids diverged");
  }
  if (viewerNorthline.id !== nodeId("Organization", NORTHLINE.url)) {
    throw new Error("Northline id does not match the source URL key");
  }

  await seedOne(maya, viewer);
  await seedOne(alex, alexGraph);
  await checkReadOnlyGuard();
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

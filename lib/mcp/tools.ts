import { streamChat, type ChatRequest } from "@/lib/agent/chat";
import { graphName, listPersonGraphs, roQuery } from "@/lib/falkor";
import { assertPersonSlug } from "@/lib/graph/ids";
import { getGraph } from "@/lib/graph/read";
import { contentDate } from "@/lib/graph/serialize";
import { matchesFor } from "@/lib/match";
import { peopleCsvExists, peopleFromGraphs } from "@/lib/people";
import { listPeople } from "@/lib/ingest/status";
import type { GraphNode } from "@/lib/types";

const DATE_PROPS = ["posted_at", "published_at", "pushed_at", "at"] as const;
const MAX_TEXT = 100_000;
const MAX_LIMIT = 30;

type JsonSchemaProperty = {
  type: "string" | "integer";
  description: string;
  minimum?: number;
  maximum?: number;
};

type JsonSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
};

type ToolSpec = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  openWorldHint: boolean;
  call: (args: Record<string, unknown>) => Promise<unknown>;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: {
    readOnlyHint: true;
    destructiveHint: false;
    openWorldHint: boolean;
  };
};

export type ToolCallResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const slugSchema = {
  type: "string" as const,
  description: "Person slug, such as nishil-faldu. Letters, digits, dots, underscores, and hyphens.",
};

const TOOLS: ToolSpec[] = [
  {
    name: "list_people",
    title: "List people",
    description:
      "List people in the room. Each row has slug, name, headline, role, and nodeCount (nodes in that person's FalkorDB graph). nodeCount is 0 when that person has not been ingested.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    openWorldHint: false,
    call: () => listPeopleTool(),
  },
  {
    name: "best_matches",
    title: "Best matches",
    description:
      "Rank other people by what they share with the viewer: organizations, skills, topics, and locations. Higher score means more in common. Each shared item includes the node id on the viewer's graph and on the other person's graph. Omit limit to return every match.",
    inputSchema: {
      type: "object",
      properties: {
        viewer_slug: {
          ...slugSchema,
          description: "Slug of the person the matches are for, such as nishil-faldu.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: "How many matches to return, from 1 to 30. Omit it to return every match.",
        },
      },
      required: ["viewer_slug"],
      additionalProperties: false,
    },
    openWorldHint: false,
    call: (args) => bestMatchesTool(args),
  },
  {
    name: "brief",
    title: "Brief",
    description:
      "Write the automatic Brief a viewer sees when they open someone: who that person is, what they have done lately, what the two have in common, and conversation starters. The text cites nodes as [[slug:nodeId]]. This calls the language model once. Do not call it in a loop.",
    inputSchema: {
      type: "object",
      properties: {
        viewer_slug: {
          ...slugSchema,
          description: "Slug of the person reading the Brief.",
        },
        person_slug: {
          ...slugSchema,
          description: "Slug of the person the Brief is about.",
        },
      },
      required: ["viewer_slug", "person_slug"],
      additionalProperties: false,
    },
    openWorldHint: true,
    call: (args) =>
      collectChat({
        viewer: requireSlug(args, "viewer_slug"),
        person: requireSlug(args, "person_slug"),
        messages: [],
        mode: "brief",
      }),
  },
  {
    name: "ask",
    title: "Ask",
    description:
      "Ask one question about a person. The answer is written for the viewer, against both graphs, and cites nodes as [[slug:nodeId]]. This calls the language model. One question per call.",
    inputSchema: {
      type: "object",
      properties: {
        viewer_slug: {
          ...slugSchema,
          description: "Slug of the person asking.",
        },
        person_slug: {
          ...slugSchema,
          description: "Slug of the person the question is about.",
        },
        question: {
          type: "string",
          description: "One question about that person.",
        },
      },
      required: ["viewer_slug", "person_slug", "question"],
      additionalProperties: false,
    },
    openWorldHint: true,
    call: (args) =>
      collectChat({
        viewer: requireSlug(args, "viewer_slug"),
        person: requireSlug(args, "person_slug"),
        messages: [{ role: "user", content: requireQuestion(args) }],
      }),
  },
  {
    name: "run_cypher",
    title: "Run Cypher",
    description:
      "Run one read-only Cypher query against a single person's graph (person:<person_slug>). The graph is already selected, so the query must not name it. CREATE, MERGE, SET, DELETE, REMOVE, DROP, and other writes are rejected. Returns the projected rows, up to 200.",
    inputSchema: {
      type: "object",
      properties: {
        person_slug: {
          ...slugSchema,
          description: "Slug of the person whose graph to query.",
        },
        query: {
          type: "string",
          description:
            "One read-only Cypher query. Example: MATCH (n:Post) RETURN n.label, n.posted_at ORDER BY n.posted_at DESC LIMIT 3",
        },
      },
      required: ["person_slug", "query"],
      additionalProperties: false,
    },
    openWorldHint: false,
    call: (args) => runCypherTool(args),
  },
  {
    name: "graph_summary",
    title: "Graph summary",
    description:
      "Counts of nodes by type for one person, plus the 10 newest nodes that have a date (id, type, label, and YYYY-MM-DD). Dates come from posted_at, published_at, pushed_at, or at.",
    inputSchema: {
      type: "object",
      properties: {
        person_slug: {
          ...slugSchema,
          description: "Slug of the person whose graph to summarize.",
        },
      },
      required: ["person_slug"],
      additionalProperties: false,
    },
    openWorldHint: false,
    call: (args) => graphSummaryTool(args),
  },
];

export function toolDefinitions(): ToolDefinition[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: tool.openWorldHint,
    },
  }));
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) {
    return toolError(`Unknown tool: ${name}`);
  }
  try {
    onlyKeys(args, Object.keys(tool.inputSchema.properties));
    for (const key of tool.inputSchema.required ?? []) {
      if (args[key] === undefined || args[key] === null) {
        throw new Error(`${key} is required`);
      }
    }
    const value = await tool.call(args);
    const text = typeof value === "string" ? value : JSON.stringify(toJsonable(value), null, 2);
    return { content: [{ type: "text", text: clip(text) }] };
  } catch (error) {
    return toolError(safeMessage(error));
  }
}

async function listPeopleTool(): Promise<{
  people: Array<{ slug: string; name: string; headline: string; role: string; nodeCount: number }>;
}> {
  const people = peopleCsvExists() ? await listPeople() : await peopleFromGraphs();
  return {
    people: people.map((person) => ({
      slug: person.slug,
      name: person.name,
      headline: person.headline,
      role: person.role,
      nodeCount: person.nodeCount,
    })),
  };
}

async function bestMatchesTool(args: Record<string, unknown>) {
  const viewer = requireSlug(args, "viewer_slug");
  const limit = optionalLimit(args);
  const names = await listPersonGraphs();
  if (!names.includes(graphName(viewer))) {
    throw new Error(`No graph for ${viewer}`);
  }
  const matches = await matchesFor(viewer);
  return {
    viewer,
    matches: limit === undefined ? matches : matches.slice(0, limit),
  };
}

async function runCypherTool(args: Record<string, unknown>) {
  const person = requireSlug(args, "person_slug");
  const query = requireString(args, "query");
  const result = await roQuery(person, query);
  return {
    rowCount: result.data.length,
    truncated: result.truncated,
    rows: result.data,
  };
}

async function graphSummaryTool(args: Record<string, unknown>) {
  const person = requireSlug(args, "person_slug");
  const graph = await getGraph(person);
  const counts: Record<string, number> = {};
  for (const node of graph.nodes) {
    counts[node.type] = (counts[node.type] ?? 0) + 1;
  }
  const newest = graph.nodes
    .flatMap((node) => {
      const date = contentDate(node);
      const at = timestamp(node);
      return date && at ? [{ node, date, at }] : [];
    })
    .sort((a, b) => b.at.localeCompare(a.at) || a.node.id.localeCompare(b.node.id))
    .slice(0, 10)
    .map(({ node, date }) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      date,
      ...(node.source_url ? { source_url: node.source_url } : {}),
    }));
  return { slug: person, counts, newest };
}

async function collectChat(request: ChatRequest): Promise<string> {
  let text = "";
  for await (const event of streamChat(request)) {
    if (event.type === "text") text += event.delta;
    if (event.type === "error") throw new Error(event.message);
  }
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The agent returned no text");
  return trimmed;
}

function requireQuestion(args: Record<string, unknown>): string {
  const question = requireString(args, "question");
  if (question.length > 4_000) throw new Error("question is too long");
  return question;
}

function requireSlug(args: Record<string, unknown>, key: string): string {
  const value = requireString(args, key);
  try {
    return assertPersonSlug(value);
  } catch {
    throw new Error(`${key} is not a valid person slug`);
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalLimit(args: Record<string, unknown>): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(args, "limit") || args.limit === undefined) return undefined;
  const limit = args.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return limit;
}

function onlyKeys(args: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw new Error(`Unexpected argument ${key}`);
  }
}

function timestamp(node: GraphNode): string | undefined {
  for (const key of DATE_PROPS) {
    const value = node.props[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function toolError(message: string): ToolCallResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function clip(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  return `${text.slice(0, MAX_TEXT)}\n…truncated`;
}

export function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed";
  if (message.includes("://") && message.includes("@")) return "Could not read graphs";
  return message.replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-…");
}

function toJsonable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (Array.isArray(value)) return value.map((item) => toJsonable(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return null;
    seen.add(value);
    if (value instanceof Date) return value.toISOString();
    const named = value.constructor?.name ?? "";
    if (named.startsWith("Temporal")) return String(value);
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === "function") {
      const json = toJSON.call(value);
      if (json !== value) return toJsonable(json, seen);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toJsonable(item, seen);
    }
    return out;
  }
  return String(value);
}

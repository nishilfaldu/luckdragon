import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";

import { roQuery } from "@/lib/falkor";
import { assertPersonSlug } from "@/lib/graph/ids";
import { getGraph } from "@/lib/graph/read";
import { contentDate } from "@/lib/graph/serialize";

export type ToolTrace = {
  id: string;
  name: string;
  input: unknown;
  cypher?: string;
  rowCount?: number;
  ms?: number;
};

export type AgentContext = {
  viewer: string;
  person: string;
  onTool: (trace: ToolTrace) => void;
};

const slugField = z.string().describe("Person slug. Only the viewer or the selected person is allowed.");

const cypherParams = z.object({
  person_slug: slugField,
  query: z.string().describe("One read-only Cypher query. The graph is already selected by person_slug."),
});

const nodeParams = z.object({
  person_slug: slugField,
  id: z.string().describe("Node id, such as person_root or post_abc123."),
});

const summaryParams = z.object({
  person_slug: slugField,
});

export function createAgentTools() {
  const runCypher = tool<typeof cypherParams, AgentContext>({
    name: "run_cypher",
    description:
      "Run one read-only Cypher query against a single person's graph. Use this for a date filter, a count, or a detail the serialization left out. Writes are rejected.",
    parameters: cypherParams,
    execute: (input, context, details) =>
      runTool(context, details, "run_cypher", input, input.query, async () => {
        const slug = allowSlug(context, input.person_slug);
        const result = await roQuery(slug, input.query);
        return {
          rowCount: result.data.length,
          payload: { rows: result.data, truncated: result.truncated, rowCount: result.data.length },
        };
      }),
  });

  const getNode = tool<typeof nodeParams, AgentContext>({
    name: "get_node",
    description: "Full properties and source_url for one node in the viewer or selected person's graph.",
    parameters: nodeParams,
    execute: (input, context, details) => {
      const cypher = "MATCH (n {id: $id}) RETURN n";
      return runTool(context, details, "get_node", input, cypher, async () => {
        const slug = allowSlug(context, input.person_slug);
        const result = await roQuery(slug, cypher, { id: input.id });
        const node = result.data[0]?.n;
        return {
          rowCount: node ? 1 : 0,
          payload: node ? { found: true, node } : { found: false, id: input.id },
        };
      });
    },
  });

  const graphSummary = tool<typeof summaryParams, AgentContext>({
    name: "graph_summary",
    description: "Counts by type, the latest dated items, and the top topics for one person.",
    parameters: summaryParams,
    execute: (input, context, details) => {
      const cypher = "MATCH (n) RETURN n";
      return runTool(context, details, "graph_summary", input, cypher, async () => {
        const slug = allowSlug(context, input.person_slug);
        const graph = await getGraph(slug);
        const counts: Record<string, number> = {};
        for (const node of graph.nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
        const latest = [...graph.nodes]
          .map((node) => ({ node, date: contentDate(node) }))
          .filter((item): item is { node: typeof item.node; date: string } => Boolean(item.date))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 8)
          .map((item) => ({
            id: item.node.id,
            type: item.node.type,
            label: item.node.label,
            date: item.date,
          }));
        const topTopics = graph.links
          .filter((link) => link.type === "INTERESTED_IN")
          .map((link) => {
            const topic = graph.nodes.find((node) => node.id === link.target);
            const weight = typeof link.props?.weight === "number" ? link.props.weight : 0;
            return topic ? { id: topic.id, label: topic.label, weight } : null;
          })
          .filter((topic): topic is { id: string; label: string; weight: number } => topic != null)
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 6);
        return {
          rowCount: graph.nodes.length,
          payload: { slug, nodeCount: graph.nodes.length, counts, latest, topTopics },
        };
      });
    },
  });

  return [runCypher, getNode, graphSummary];
}

function allowSlug(context: RunContext<AgentContext> | undefined, slug: string): string {
  const ctx = context?.context;
  if (!ctx) throw new Error("Missing agent context");
  const person = assertPersonSlug(slug);
  if (person !== ctx.viewer && person !== ctx.person) {
    throw new Error(`Slug ${person} is not the viewer or the selected person`);
  }
  return person;
}

async function runTool(
  context: RunContext<AgentContext> | undefined,
  details: { toolCall?: { callId?: string } } | undefined,
  name: string,
  input: unknown,
  cypher: string,
  work: () => Promise<{ rowCount: number; payload: unknown }>,
): Promise<string> {
  const started = Date.now();
  const id = details?.toolCall?.callId || name;
  try {
    const result = await work();
    context?.context.onTool({
      id,
      name,
      input,
      cypher,
      rowCount: result.rowCount,
      ms: Date.now() - started,
    });
    return clip(result.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed";
    context?.context.onTool({
      id,
      name,
      input,
      cypher,
      rowCount: 0,
      ms: Date.now() - started,
    });
    return `Error: ${message}`;
  }
}

function clip(value: unknown): string {
  const text = JSON.stringify(value);
  if (!text) return "null";
  if (text.length <= 8_000) return text;
  return `${text.slice(0, 8_000)}…`;
}

import { Agent, assistant, run, setTracingDisabled, user } from "@openai/agents";

import { graphExists, GraphNotFoundError, getGraph, type PersonGraph } from "@/lib/graph/read";
import { assertPersonSlug } from "@/lib/graph/ids";
import { openaiModel } from "@/lib/models";

import { buildInstructions } from "./prompt";
import { createAgentTools, type AgentContext, type ToolTrace } from "./tools";

setTracingDisabled(true);

const SUGGESTION_MARKER = "<<<SUGGESTIONS>>>";

const FALLBACK_SUGGESTIONS = [
  "What have they shipped lately?",
  "Where do we overlap most?",
  "Give me an opener about their latest talk",
];

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  viewer: string;
  person: string;
  messages: ChatMessage[];
  mode?: "brief";
  dropProtected?: boolean;
};

export type ChatEvent =
  | { type: "text"; delta: string }
  | ({ type: "tool" } & ToolTrace)
  | { type: "suggestions"; items: string[] }
  | { type: "done" }
  | { type: "error"; message: string };

export async function* streamChat(request: ChatRequest): AsyncGenerator<ChatEvent> {
  let viewer: string;
  let person: string;
  try {
    viewer = assertPersonSlug(request.viewer);
    person = assertPersonSlug(request.person);
  } catch (error) {
    yield { type: "error", message: publicError(error) };
    return;
  }

  let model: string;
  try {
    model = openaiModel();
  } catch (error) {
    yield { type: "error", message: publicError(error) };
    return;
  }

  let personGraph: PersonGraph;
  let viewerGraph: PersonGraph | null = null;
  try {
    if (!(await graphExists(person))) throw new GraphNotFoundError(person);
    personGraph = await getGraph(person);
    if (await graphExists(viewer)) viewerGraph = await getGraph(viewer);
  } catch (error) {
    yield { type: "error", message: publicError(error) };
    return;
  }

  const today = new Date();
  const recent = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const agent = new Agent<AgentContext>({
    name: "luckdragon",
    model,
    instructions: buildInstructions({
      viewer,
      person,
      viewerGraph,
      personGraph,
      today: today.toISOString().slice(0, 10),
      recentSince: recent.toISOString().slice(0, 10),
      dropProtected: request.dropProtected,
    }),
    tools: createAgentTools(),
    modelSettings: request.mode === "brief" ? { toolChoice: "none" } : { toolChoice: "auto" },
  });

  const pending: ChatEvent[] = [];
  const context: AgentContext = {
    viewer,
    person,
    onTool(trace) {
      pending.push({ type: "tool", ...trace });
    },
  };

  const input = buildInput(request);
  const splitter = new SuggestionSplit();
  let streamed = false;

  try {
    const result = await run(agent, input, {
      stream: true,
      context,
      maxTurns: request.mode === "brief" ? 3 : 8,
    });

    for await (const event of result) {
      yield* drain(pending);
      if (event.type !== "raw_model_stream_event") continue;
      if (event.data.type !== "output_text_delta" || !event.data.delta) continue;
      const visible = splitter.push(event.data.delta);
      if (!visible) continue;
      streamed = true;
      yield { type: "text", delta: visible };
    }

    yield* drain(pending);
    if (result.error) {
      yield { type: "error", message: publicError(result.error) };
      return;
    }

    if (!streamed && typeof result.finalOutput === "string" && result.finalOutput) {
      const visible = splitter.push(result.finalOutput);
      if (visible) yield { type: "text", delta: visible };
    }
    const rest = splitter.finish();
    if (rest) yield { type: "text", delta: rest };
  } catch (error) {
    yield* drain(pending);
    yield { type: "error", message: publicError(error) };
    return;
  }

  yield { type: "suggestions", items: suggestionsFrom(splitter.suggestion) };
  yield { type: "done" };
}

function buildInput(request: ChatRequest) {
  const history = request.messages.slice(-12).map((message) =>
    message.role === "user" ? user(message.content) : assistant(message.content),
  );
  if (request.mode === "brief" && request.messages.length === 0) {
    return [
      user(
        `Write the Brief about ${request.person}. The viewer reading it is ${request.viewer}. Who and Lately are only about ${request.person}.`,
      ),
    ];
  }
  if (history.length === 0) return [user("What should I know about this person?")];
  return history;
}

function suggestionsFrom(block: string): string[] {
  const parsed = block
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter((line) => line && !line.startsWith("```") && !line.includes(SUGGESTION_MARKER));
  const items: string[] = [];
  for (const line of parsed) {
    if (items.length === 3) break;
    if (!items.includes(line)) items.push(line);
  }
  for (const fallback of FALLBACK_SUGGESTIONS) {
    if (items.length === 3) break;
    if (!items.includes(fallback)) items.push(fallback);
  }
  return items;
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Chat failed";
  return message.replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-…");
}

async function* drain(pending: ChatEvent[]): AsyncGenerator<ChatEvent> {
  while (pending.length > 0) {
    const event = pending.shift();
    if (event) yield event;
  }
}

class SuggestionSplit {
  suggestion = "";
  private pending = "";
  private capturing = false;

  push(delta: string): string {
    if (this.capturing) {
      this.suggestion += delta;
      return "";
    }
    this.pending += delta;
    const index = this.pending.indexOf(SUGGESTION_MARKER);
    if (index !== -1) {
      const visible = this.pending.slice(0, index).replace(/\s+$/, "");
      this.suggestion = this.pending.slice(index + SUGGESTION_MARKER.length);
      this.pending = "";
      this.capturing = true;
      return visible;
    }
    const hold = suffixThatStartsMarker(this.pending);
    if (hold === 0) {
      const visible = this.pending;
      this.pending = "";
      return visible;
    }
    const visible = this.pending.slice(0, -hold);
    this.pending = this.pending.slice(-hold);
    return visible;
  }

  finish(): string {
    if (this.capturing) return "";
    const rest = this.pending;
    this.pending = "";
    return rest;
  }
}

function suffixThatStartsMarker(text: string): number {
  const max = Math.min(text.length, SUGGESTION_MARKER.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (SUGGESTION_MARKER.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

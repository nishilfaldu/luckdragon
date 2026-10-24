import type { GraphNode } from "@/lib/types";
import type { ChatThread, GraphPayload, GraphState, PersonListItem } from "./model";

/** Layout preview for ?sample=1. It never calls the chat API. */
export function wantsSample(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("sample") === "1";
}

export function wantsCard(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("card") === "1";
}

export function sampleGraph(slug: string): GraphPayload | null {
  if (slug === "demo-viewer") return viewerGraph;
  if (slug === "demo-alex") return alexGraph;
  return null;
}

export function sampleThread(
  viewer: PersonListItem,
  person: PersonListItem,
  graphs: Record<string, GraphState>,
): ChatThread {
  const yours = citedNode(graphs[viewer.slug], viewerGraph.nodes[1] ?? viewerGraph.root);
  const theirs = citedNode(graphs[person.slug], alexGraph.nodes[2] ?? alexGraph.root);
  const content = [
    `**${person.name}** shows up most clearly around ${theirs.label} [[${person.slug}:${theirs.id}]].`,
    "",
    `On your side, ${yours.label} [[${viewer.slug}:${yours.id}]] is the closest thread.`,
    "",
    "- Ask what they've done with it lately",
    "- The overlap is the easy opener",
    "- A short question beats a long intro",
  ].join("\n");
  return {
    streaming: false,
    error: null,
    messages: [
      {
        id: "sample-brief",
        role: "assistant",
        content,
        tools: [
          {
            id: "sample-tool",
            name: "run_cypher",
            input: { person_slug: person.slug },
            cypher: "MATCH (n)\nRETURN n.id, n.label\nLIMIT 8",
            rowCount: 8,
            ms: 12,
          },
        ],
        suggestions: [
          "What have they shipped lately?",
          "Where do we overlap most?",
          "Give me an opener about their latest post",
        ],
      },
    ],
  };
}

function citedNode(state: GraphState | undefined, fallback: GraphNode): GraphNode {
  if (!state || state.status !== "ready") return fallback;
  const nodes = state.data.nodes.filter((node) => node.id !== state.data.root.id);
  return (
    nodes.find((node) => node.type === "Post" || node.type === "Article" || node.type === "Video" || node.type === "Repo") ??
    nodes[0] ??
    state.data.root
  );
}

function node(
  id: string,
  type: GraphNode["type"],
  label: string,
  props: Record<string, unknown>,
  extra?: Pick<GraphNode, "source_url" | "confidence">,
): GraphNode {
  return { id, type, label, props, ...extra };
}

const viewerRoot = node("person_root", "Person", "Mina Chen", {
  name: "Mina Chen",
  headline: "Design engineer",
});

const viewerGraph: GraphPayload = {
  root: viewerRoot,
  nodes: [
    viewerRoot,
    node("account_viewer", "Account", "github.com/mina", { platform: "github", handle: "mina", matched_via: "luma" }, {
      source_url: "https://example.com/mina",
      confidence: 0.98,
    }),
    node("repo_sample", "Repo", "glance", { language: "TypeScript", stars: 128, pushed_at: "2026-10-02" }, {
      source_url: "https://example.com/glance",
      confidence: 0.95,
    }),
    node("topic_maps", "Topic", "call graphs", { name: "call graphs" }),
    node("skill_ts", "Skill", "TypeScript", { name: "TypeScript" }),
    node("org_mina", "Organization", "Independent", { kind: "company" }),
  ],
  links: [
    { source: "person_root", target: "account_viewer", type: "HAS_ACCOUNT" },
    { source: "person_root", target: "repo_sample", type: "AUTHORED" },
    { source: "person_root", target: "topic_maps", type: "INTERESTED_IN" },
    { source: "person_root", target: "skill_ts", type: "HAS_SKILL" },
    { source: "repo_sample", target: "skill_ts", type: "USES" },
    { source: "person_root", target: "org_mina", type: "WORKS_AT", props: { title: "Design engineer" } },
  ],
};

const alexRoot = node("person_root", "Person", "Alex Rivera", {
  name: "Alex Rivera",
  headline: "Maps and developer tools",
});

const alexGraph: GraphPayload = {
  root: alexRoot,
  nodes: [
    alexRoot,
    node("account_alex", "Account", "github.com/arivera", { platform: "github", handle: "arivera", matched_via: "search" }, {
      source_url: "https://example.com/arivera",
      confidence: 0.82,
    }),
    node("post_sample", "Post", "Force layouts for code", { platform: "blog", likes: 42, posted_at: "2026-09-18" }, {
      source_url: "https://example.com/force-layouts",
      confidence: 0.9,
    }),
    node("topic_graphs", "Topic", "graphs", { name: "graphs" }),
    node("org_lab", "Organization", "Northwind Labs", { kind: "company" }),
  ],
  links: [
    { source: "person_root", target: "account_alex", type: "HAS_ACCOUNT" },
    { source: "person_root", target: "post_sample", type: "AUTHORED" },
    { source: "post_sample", target: "topic_graphs", type: "ABOUT" },
    { source: "person_root", target: "org_lab", type: "WORKS_AT", props: { title: "Engineer" } },
  ],
};

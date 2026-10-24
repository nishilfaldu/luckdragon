import type { RawItem } from "@/lib/ingest/items";
import type { GraphNode } from "@/lib/types";

/** Human names and the product behind each ingest step, for the live activity feed. */
const SOURCES: Record<string, { label: string; product: string }> = {
  seed: { label: "People list", product: "luckdragon" },
  luma: { label: "Luma profile", product: "Bright Data · Web Unlocker" },
  resolve: { label: "Finding their accounts", product: "Bright Data · SERP API" },
  website: { label: "Personal website", product: "Bright Data · Web Unlocker" },
  github: { label: "GitHub", product: "GitHub API" },
  linkedin: { label: "LinkedIn", product: "Bright Data · Web Scraper API" },
  x: { label: "X", product: "Bright Data · Web Scraper API" },
  youtube: { label: "YouTube", product: "Bright Data · Web Scraper API" },
  instagram: { label: "Instagram", product: "Bright Data · Web Scraper API" },
  threads: { label: "Threads", product: "Bright Data · Web Scraper API" },
  bluesky: { label: "Bluesky", product: "Bright Data · Web Scraper API" },
  reddit: { label: "Reddit", product: "Bright Data · Web Scraper API" },
  crunchbase: { label: "Crunchbase", product: "Bright Data · Web Scraper API" },
  packages: { label: "npm and PyPI", product: "Bright Data · Web Scraper API" },
  serp: { label: "Google search", product: "Bright Data · SERP API" },
  research: { label: "Research agent", product: "Bright Data · SERP + Web Unlocker" },
  graph: { label: "Saving to FalkorDB", product: "FalkorDB" },
  room: { label: "Linking into the room graph", product: "FalkorDB" },
  all: { label: "Done", product: "luckdragon" },
};

export function sourceMeta(source: string): { label: string; product: string } {
  return SOURCES[source] ?? { label: source, product: "" };
}

const PLURAL: Record<string, string> = { post: "posts", profile: "profile", repo: "repos", video: "videos", page: "pages", article: "articles", talk: "talks", role: "roles", education: "schools", result: "results" };

/** "Profile, 8 posts, 3 roles" plus the first few titles. */
export function describeFetch(items: RawItem[]): { detail: string; items: string[] } {
  const byKind = new Map<string, number>();
  for (const item of items) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  const detail = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => (n === 1 && kind === "profile" ? "profile" : `${n} ${PLURAL[kind] ?? kind}`))
    .join(", ");
  const titles = items
    .map((item) => (item.title || item.text || "").replace(/\s+/g, " ").trim())
    .filter((title) => title && !/^https?:/.test(title))
    .slice(0, 4)
    .map((title) => (title.length > 70 ? `${title.slice(0, 69)}…` : title));
  return { detail, items: titles };
}

/** "41 facts: 12 topics, 5 skills, 9 posts" plus a few facts like "Topic · Remix". */
export function describeFacts(nodes: GraphNode[]): { detail: string; items: string[] } {
  const facts = nodes.filter((node) => node.type !== "Person" && node.type !== "Account");
  const byType = new Map<string, number>();
  for (const node of facts) byType.set(node.type, (byType.get(node.type) ?? 0) + 1);
  const parts = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([type, n]) => `${n} ${type.toLowerCase()}${n === 1 ? "" : "s"}`);
  const picks = ["Topic", "Skill", "Organization", "Repo", "Video", "Post", "Article"]
    .flatMap((type) => facts.filter((node) => node.type === type).slice(0, 2))
    .slice(0, 5)
    .map((node) => `${node.type} · ${node.label.length > 40 ? `${node.label.slice(0, 39)}…` : node.label}`);
  return { detail: `${facts.length} facts${parts.length ? `: ${parts.join(", ")}` : ""}`, items: picks };
}

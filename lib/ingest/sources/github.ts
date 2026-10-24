import { execFile } from "node:child_process";
import { hasBrightDataToken, scrape } from "@/lib/ingest/brightdata/client";
import { githubSearchInput } from "@/lib/ingest/brightdata/datasets";
import { cachedRaw } from "@/lib/ingest/cache";
import { capRecent, clip, inLastYear, type RawItem } from "@/lib/ingest/items";
import { accountFor, handleFromUrl } from "@/lib/ingest/accounts";
import type { SourceAdapter } from "@/lib/ingest/sources/types";

type GhRepo = {
  name?: string;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  pushed_at?: string;
  fork?: boolean;
  topics?: string[];
};

type GhUser = {
  login?: string;
  name?: string;
  bio?: string | null;
  blog?: string;
  location?: string | null;
  company?: string | null;
  followers?: number;
  public_repos?: number;
  html_url?: string;
};

type GhEvent = {
  type?: string;
  created_at?: string;
  repo?: { name?: string };
  payload?: { action?: string };
};

const KEEP_EVENTS = new Set(["ReleaseEvent", "PullRequestEvent", "CreateEvent", "PublicEvent"]);

export const github: SourceAdapter = {
  id: "github",
  async run(ctx) {
    const account = accountFor(ctx.accounts, "github");
    if (!account) return [];
    const login = handleFromUrl(account.url);
    if (!login) return [];
    return cachedRaw(ctx.person.slug, "github", ctx.fresh, async () => {
      const token = await githubToken();
      const user = await ghGet<GhUser>(`/users/${login}`, token);
      const repos = await ghGet<GhRepo[]>(`/users/${login}/repos?sort=pushed&per_page=30&type=owner`, token);
      const events = await ghGet<GhEvent[]>(`/users/${login}/events/public?per_page=30`, token).catch(
        () => [] as GhEvent[],
      );
      const items: RawItem[] = [
        {
          source: "github",
          url: user.html_url || account.url,
          kind: "profile",
          title: user.name || user.login || login,
          text: clip(
            [user.bio, user.company ? `Company: ${user.company}` : "", user.location ? `Location: ${user.location}` : ""]
              .filter(Boolean)
              .join("\n"),
            800,
          ),
          meta: {
            followers: user.followers ?? 0,
            public_repos: user.public_repos ?? 0,
            blog: user.blog || "",
            location: user.location || "",
            company: user.company || "",
            login,
          },
        },
      ];
      const repoItems = repoItemsFrom(repos ?? []);
      items.push(...repoItems);
      for (const event of (events ?? []).filter((item) => item.type && KEEP_EVENTS.has(item.type))) {
        if (!inLastYear(event.created_at)) continue;
        const repo = event.repo?.name ?? "";
        items.push({
          source: "github",
          url: repo ? `https://github.com/${repo}` : account.url,
          kind: "activity",
          title: `${event.type?.replace("Event", "")} ${repo}`.trim(),
          date: event.created_at,
          text: event.payload?.action ? `${event.type} ${event.payload.action}` : event.type,
        });
      }
      if (hasBrightDataToken()) {
        const searchUrl = `https://github.com/search?q=${encodeURIComponent(`user:${login}`)}&type=repositories`;
        const discovered = await scrape(githubSearchInput(searchUrl)).catch(() => []);
        const known = new Set(items.map((item) => item.url));
        for (const row of discovered) {
          const url = typeof row.url === "string" ? row.url : "";
          if (!url || known.has(url)) continue;
          items.push({ source: "github", url, kind: "repo", title: url.split("/").pop() });
        }
      }
      const profile = items[0] ? [items[0]] : [];
      return [...profile, ...capRecent(items.slice(1), 20)];
    });
  },
};

function repoItemsFrom(repos: GhRepo[]): RawItem[] {
  const owned = repos.filter((repo) => repo.html_url && !repo.fork);
  const recent = owned.filter((repo) => inLastYear(repo.pushed_at));
  const chosen = (recent.length > 0 ? recent : owned).slice(0, 15);
  return chosen.map((repo) => ({
    source: "github",
    url: repo.html_url || "",
    kind: "repo",
    title: repo.name || repo.full_name,
    text: clip(repo.description ?? "", 400),
    date: repo.pushed_at,
    meta: {
      stars: repo.stargazers_count ?? 0,
      language: repo.language || "",
      topics: (repo.topics ?? []).slice(0, 8).join(", "),
    },
  }));
}

async function githubToken(): Promise<string | undefined> {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return new Promise((resolve) => {
    execFile("gh", ["auth", "token"], { timeout: 8000 }, (error, stdout) => {
      if (error) resolve(undefined);
      else resolve(stdout.trim() || undefined);
    });
  });
}

async function ghGet<T>(pathname: string, token: string | undefined): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "luckdragon",
    "x-github-api-version": "2022-11-28",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub ${pathname} failed (${response.status})`);
  return (await response.json()) as T;
}

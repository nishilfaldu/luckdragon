# luckdragon — plan

A people explorer for the room. Each attendee gets their own FalkorDB graph built
from their public footprint. You browse a person by clicking through their graph,
and an LLM agent compares their graph with yours and answers questions about
them. Every claim cites the graph nodes it came from.

Hackathon: Patch the Conference, Sat 2026-10-24, Bright Data SF. Build until 5:30pm,
then a live demo on stage. Target tracks: **FalkorDB** (graph at the core, explainable
answers, a real conference problem) and **Bright Data** (live web data at the core).

## Decisions

| Topic | Decision |
|---|---|
| People | `data/people.csv`, about 30 rows. First pulled from the user's Luma event attendees by a browser agent. No consent flow (demo only). |
| Identity | Luma profile socials first. Missing socials are found by search (SERP, LinkedIn people search, X by username), and an LLM picks the best candidate with a confidence score. |
| Sources | All in, through Bright Data: LinkedIn (profile, posts, company), X (profile, posts), YouTube (channel, videos, "<name> talk" keyword search), GitHub (repos via Bright Data plus the GitHub REST API for the profile), Instagram, Threads, Bluesky, Reddit, Crunchbase, npm/PyPI, plus Google SERP and Web Unlocker (`scrape_as_markdown`) for Luma pages, personal sites, blogs and talk pages. |
| "Who they know" | Out of scope. |
| Graphs | **One FalkorDB graph per person**, named `person:<slug>`. No shared or room graph for now. |
| Overlap | No hand-written matching code. An LLM agent reads both graphs (the viewer's and the selected person's) and finds the overlap. |
| Viewer | "You" is a person in the list (chosen with "I am …") or someone added live by pasting a Luma URL. |
| Ingestion | A fixed pipeline per known social, then a research agent (OpenAI Agents SDK + Bright Data MCP) for everything beyond them, capped at a fixed number of calls per person. All 30 are ingested ahead of time. Only the viewer is ingested live on stage, with progress shown per source. |
| Window | Last 12 months, about 20 items per source, each item dated. |
| Provenance | Every node stores `source_url`, `fetched_at`, `confidence`, and `matched_via` (for accounts). Hovering a node in the UI shows them. |
| LLM | OpenAI, one model for everything: `OPENAI_MODEL` (gpt-6.1-sol). Structured outputs for extraction, Agents SDK for chat and research. |
| UI | Web app, laptop-first, glance's theme (tokens copied from `~/Desktop/glance/public/index.html`) with System, Light and Dark modes. Left: people list. Middle: graph(s). Right: AI chat. |
| Hosting | FalkorDB in Docker locally. FalkorDB Cloud plus a quick deploy if time allows. |
| Repo | Local git only. **Never push.** |

## Stack

- Next.js 16.4 (App Router, already scaffolded at repo root) + React 19 + TypeScript + Tailwind 4, **npm** (package-lock.json). Read `node_modules/next/dist/docs/` before writing Next code (see AGENTS.md).
- `falkordb` (the official Node client)
- `@openai/agents` + `openai` + `zod`
- Bright Data: REST `POST /datasets/v3/scrape` (sync) and `/trigger` + snapshot polling (async), SERP and Web Unlocker via `POST /request`, MCP at `https://mcp.brightdata.com/mcp?token=…` for the research agent
- `react-force-graph-2d` for the graph pane
- FalkorDB `docker run -p 6379:6379 -p 3001:3000 falkordb/falkordb` (FalkorDB's own browser UI on :3001, the app on :3000)

## Graph schema (one graph per person: `person:<slug>`)

Every node has `id` (stable hash of type + key), `label`, `source_url`, `fetched_at`, `confidence` (0–1).

| Node | Key props |
|---|---|
| `Person` (exactly one, the root) | name, headline, avatar_url, location, luma_url |
| `Account` | platform, handle, url, followers, matched_via (`luma` / `search` / `agent`) |
| `Organization` | name, kind (company / school / community), url, industry, size |
| `Post` | platform, text, url, posted_at, likes |
| `Video` | title, url, published_at, views, kind (talk / podcast / video) |
| `Repo` | name, url, description, stars, language, pushed_at |
| `Package` | registry, name, url, downloads |
| `Article` | title, url, published_at, outlet |
| `Topic` | name (free text from the LLM; not normalized) |
| `Skill` | name |
| `Location` | name |

| Edge | From → To | Props |
|---|---|---|
| `HAS_ACCOUNT` | Person → Account | |
| `WORKS_AT` / `WORKED_AT` | Person → Organization | title, start, end |
| `STUDIED_AT` | Person → Organization | degree, start, end |
| `AUTHORED` | Person → Post / Video / Repo / Package / Article | at |
| `POSTED_ON` | Post / Video → Account | |
| `ABOUT` | Post / Video / Repo / Article → Topic | |
| `USES` | Repo → Skill | |
| `HAS_SKILL` | Person → Skill | |
| `INTERESTED_IN` | Person → Topic | weight (count of items about it) |
| `BASED_IN` | Person → Location | |

Writes always use `MERGE` on `id`, so re-ingesting is safe.

## Ingestion pipeline (`lib/ingest/`)

1. **Seed:** a row from `people.csv` (`slug,name,luma_url,linkedin,x,github,youtube,instagram,website,…`).
2. **Luma profile:** scrape the Luma page (Web Unlocker) and fill in missing socials.
3. **Resolve:** for each missing platform, search (SERP `"<name>" <company> site:<platform>`, LinkedIn people search, X `discover_by_user_name`), then an LLM picks a candidate and gives a confidence. Candidates below 0.5 are dropped.
4. **Fetch:** each source is an adapter `(person, account) => RawItem[]`. Raw responses are cached in `data/raw/<slug>/<source>.json`; re-runs read the cache unless `--fresh`.
5. **Research agent:** OpenAI Agents SDK + Bright Data MCP (`search_engine`, `scrape_as_markdown`) with "find talks, articles, podcasts and projects by this person that aren't covered yet." Capped at about 8 tool calls. Returns RawItems with URLs.
6. **Extract:** one LLM call per source batch with a zod schema → nodes and edges (with `source_url` on each), including topics.
7. **Write:** batched MERGE into `person:<slug>`.
8. **Progress:** each step emits an event; `POST /api/ingest/[slug]` streams them over SSE, and the UI shows a row per source (pending → fetching → n items → written).

**Tonight's fallback (no Bright Data token yet):** every Bright Data adapter is written from the docs behind `BRIGHTDATA_API_TOKEN`. When the token is missing, the pipeline falls back to the GitHub REST API (`gh auth token` if available), a plain `fetch` of personal sites, the Luma data the browser agent saved in `data/luma/`, and OpenAI's `web_search` tool for discovery. This lets us build real graphs tonight and switch to Bright Data at the event by setting one env var.

## Chat agent (`lib/agent/`)

- Context on open: a compact serialization of the **viewer's** graph and the **selected person's** graph (nodes as `id | type | label | key props | date`, edges as `src -TYPE-> dst`).
- Tools:
  - `run_cypher(person_slug, query)` is **read-only**: it rejects `CREATE|MERGE|SET|DELETE|REMOVE|DROP|CALL db.` and has a timeout and a row cap.
  - `get_node(person_slug, id)` returns full properties and source.
  - `graph_summary(person_slug)` returns counts by type, the latest items, and the top topics.
- Output: markdown where every claim ends with citations like `[[slug:nodeId]]`. The UI turns these into chips; hovering a chip highlights the node in the graph pane, and clicking it opens the source.
- Explainability: every Cypher query the agent ran is shown in a collapsed "How I know this" section under the answer.
- When a person is opened, the agent posts an automatic **Brief**: who they are (2 lines), what they've done recently, what you have in common, and 3 conversation starters, all cited.
- Suggested follow-ups appear as chips ("What have they shipped lately?", "Where do we overlap most?", "Give me an opener about their latest talk").

## UI (`app/`, `components/`)

- Header: wordmark "luckdragon", a viewer picker ("I am …"), and the theme toggle (System / Light / Dark, same as glance).
- **Left:** a searchable people list showing avatar, name, headline, a status dot (not ingested / ingesting / ready), and a small count of how many sources were found. The viewer is pinned at the top. A "+ Add person" button takes a Luma URL and ingests it live.
- **Middle:** the force graph of the selected person, with the root in the middle and nodes colored by type using the token colors. When comparing with the viewer, the two graphs sit side by side and nodes the agent cited are highlighted in both. Hovering a node shows a card with label, type, date, source link and confidence. Clicking a node expands it, and in the chat pane "Ask about this" pre-fills a question.
- **Right:** chat with the streaming Brief, follow-up chips, citation chips, and "How I know this".
- Theme: copy glance's `:root` tokens, dark overrides, Inter, and spacing and radius conventions exactly. Graph colors come from the tokens so both modes work.

## API

| Route | Does |
|---|---|
| `GET /api/people` | people from the CSV plus their ingestion status (graph exists, node counts) |
| `GET /api/graph/[slug]` | `{nodes, links}` for the graph pane |
| `POST /api/ingest/[slug]` | runs the pipeline, SSE progress |
| `POST /api/people` | add a person from a Luma URL |
| `POST /api/chat` | streams the agent answer; body `{viewer, person, messages}` |

## Repo layout

```
PLAN.md  docker-compose.yml  .env.example  package.json
data/people.csv  data/luma/  data/raw/<slug>/
scripts/ingest-all.ts  scripts/smoke-brightdata.ts
lib/falkor.ts                     # client, graph naming, read-only guard
lib/graph/{schema,ids,write,serialize,read}.ts
lib/ingest/{pipeline,resolve,extract,research-agent,events}.ts
lib/ingest/brightdata/{client,datasets}.ts   # dataset ids from docs.brightdata.com/scrapers.json
lib/ingest/sources/{luma,linkedin,x,youtube,github,instagram,threads,bluesky,reddit,crunchbase,packages,website,serp}.ts
lib/agent/{chat,tools,prompt}.ts
app/{layout,page}.tsx  app/api/**  components/**  app/tokens.css
```

## Bright Data dataset IDs (from `docs.brightdata.com/scrapers.json`)

| Scraper | dataset_id | methods |
|---|---|---|
| LinkedIn people profiles | `gd_l1viktl72bvl7bjuj0` | collect_by_url |
| LinkedIn people search | `gd_m8d03he47z8nwb5xc` | collect_by_url |
| LinkedIn posts | `gd_lyy3tktm25m4avu764` | discover_by_profile_url |
| LinkedIn company | `gd_l1vikfnt1wgvvqz95w` | collect_by_url |
| X profiles | `gd_lwxmeb2u1cniijd7t4` | collect_by_url, discover_by_user_name |
| X posts | `gd_lwxkxvnf1cynvib9co` | discover_by_profile_url |
| YouTube channels | `gd_lk538t2k2p1k3oos71` | collect_by_url |
| YouTube videos | `gd_lk56epmy2i5g7lzu0k` | discover_by_keyword, discover_by_url |
| GitHub repository | `gd_lyrexgxc24b3d4imjt` | collect_by_url, discover_by_search_url |
| Instagram profiles / posts | `gd_l1vikfch901nx3by4` / `gd_lk5ns7kz21pck8jpis` | collect_by_url |
| Threads profiles / posts | `gd_mde7jg3ld2h3hnnf2` / `gd_md75myxy14rihbjksa` | |
| Bluesky posts | `gd_m6hn4r5s27zfhc7w4` | discover_by_profile_url |
| Reddit profiles / posts | `gd_mgnh0p8w16o65lmhp` / `gd_lvz8ah06191smkebj4` | |
| Crunchbase companies | `gd_l1vijqt9jfj7olije` | collect_by_url |
| npm / PyPI | `gd_mk57m0301khq4jmsul` / `gd_mk57kc3t1wwgmnepp9` | |

## Build schedule

**Tonight (Grok 4.7 High agents in the Cursor CLI, coordinated by Claude)**

| # | Agent | Owns | Done when |
|---|---|---|---|
| 0 | Scaffold | package.json, Next app, tokens.css, docker-compose, `lib/falkor.ts`, `.env.example` | `npm run dev` serves a themed empty 3-pane page; FalkorDB answers `RETURN 1` |
| L | Luma (browser) | `data/people.csv`, `data/luma/*.json` | 30 rows with every social listed on each Luma profile |
| F | FalkorDB Cloud (browser) | `.env.local` `FALKORDB_CLOUD_URL` | a free instance answers `RETURN 1` |
| G | Graph + agent | `lib/graph/**`, `lib/agent/**`, `/api/graph`, `/api/chat`, a fixture graph for 2 people | the chat answers with citations against the fixture graphs |
| U | UI | `app/**` (non-API), `components/**` | 3 panes work against the API, both themes, side-by-side compare, citation highlighting |
| I | Ingestion | `lib/ingest/**`, `/api/ingest`, `/api/people`, `scripts/**` | `npm run ingest -- <slug>` builds a real graph with the fallback sources; Bright Data adapters compile and match the docs |

Order: 0 runs first. Then L, F, G, U and I run in parallel, each in its own directories (all dependencies are installed in step 0, so nobody else edits package.json). Then an integration pass ingests all 30 people with fallback sources.

**At the event**

| Time | Do |
|---|---|
| 9–10 | Claim Bright Data and OpenAI credits; `scripts/smoke-brightdata.ts` hits one dataset per platform; fix adapter field mappings |
| 10–11 | Workshops (FalkorDB and Bright Data); note anything to show off |
| 11–2 | Re-ingest all 30 with Bright Data (`--fresh`), turn on resolution and the research agent, live viewer ingestion |
| 2–4:30 | Polish: Brief quality, graph readability, empty and error states; deploy (FalkorDB Cloud + Vercel) |
| 4:30–5:30 | Rehearse the demo 3 times, record a backup video, submit |

## Demo (about 3 minutes)

1. Problem: you walk into a room of 200 strangers with nothing but name tags.
2. Paste your own Luma URL. Sources light up live (LinkedIn, X, YouTube, GitHub, …) and your graph grows in the middle pane.
3. Pick a judge from the list. Their graph opens next to yours, and the Brief streams in: recent work, common ground, 3 openers. Every line has a citation chip that lights up nodes in both graphs.
4. Ask "What did they talk about most recently and how does it relate to what I build?" Open "How I know this" to show the Cypher the agent ran against FalkorDB.
5. Close: one graph per person, built from live web data with Bright Data, and each answer comes with the path it came from.

## Cut list (in this order, if behind)

1. Deploy (demo from the laptop)
2. Research agent (the fixed pipeline only)
3. Side-by-side (one graph, with a toggle between you and them)
4. Minor platforms (Threads, Bluesky, Reddit, Instagram, npm/PyPI, Crunchbase)
5. Live viewer ingestion (pre-ingest the viewer as well)

## Risks

- **Bright Data async jobs are slow:** pre-ingest, cache raw responses, and use sync `/scrape` with a timeout where it's offered.
- **Wrong identity matches:** confidence scores plus `matched_via` shown in the UI; drop matches below 0.5.
- **LLM cost and latency during extraction:** batch per source and cap items per source.
- **FalkorDB Cypher differs from Neo4j** (no APOC): keep queries plain, and test the read-only guard.
- **Stage Wi-Fi:** cached data, local FalkorDB, and a backup video.

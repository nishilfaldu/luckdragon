# luckdragon — stage card (3 min)

Light theme, full screen. Re-check the judges in WHO TO MEET before you go up. Counts move.

## 15 min before

- `docker compose up -d`. FalkorDB on **6379**. `npm run dev` → **:3000**. Do not open **:3001** (FalkorDB's own UI). Full screen (Ctrl-Cmd-F). Click the sun (tooltip **Light**).
- After any ingest, if matches, the plan, or **How I know this** look stale: `npm run room:build`. Not on stage.
- Judge = highest `nodeCount` among `role=judge` and `status=ready`.

```bash
curl -s localhost:3000/api/people | python3 -c 'import json,sys; p=json.load(sys.stdin)["people"]; j=sorted((x for x in p if x["role"]=="judge"), key=lambda x:-x["nodeCount"])[0]; print("JUDGE", j["name"], j["nodeCount"]); print("NONE", ", ".join(x["name"] for x in p if x["status"]=="none"))'
```

  Prefer **Riken Shah** (last check **169 nodes**), else **Satyam Singh**. Say the name and the count on the row.
- Header already reads **Protected traits dropped**. Leave it. Pick **I am Nishil Faldu**, then click **← Who to meet** (or reload) so nobody is selected: the middle is **WHO TO MEET**, the right is **HOW IT WORKS**. Three judges are in the list: **Schezeen Fazulbhoy** (why now: Oct 23 · Judging Patch the Conference Hackathon), **Satyam Singh**, **Riken Shah** (Oct 24 · Monorepos and complete context for coding agents).
- Live add: a name you met today, else **Jason Lengstorf** (Kent C. Dodds is already in the room, added live this afternoon). Backup, already open, do not reload: https://luckdragon.nishilfaldu.site (read-only: no **+ Add person**).

## Script

Still skeleton bars at 1:20? Ask anyway.

**0:00.** "You walk into a room of strangers and a name tag. What they work on is already public, scattered across LinkedIn, X, GitHub, and talks."

**0:12.** Read the right column, **HOW IT WORKS**, in one breath: "Bright Data reads public work for everyone here, FalkorDB turns each person into a graph of facts and links the room, and every suggestion shows its evidence."

**0:25.** Middle, **WHO TO MEET**. Point at **Schezeen Fazulbhoy · Judge**: "Why now: she posted yesterday that she's judging this hackathon. You share: Next.js, MCP, hackathons. And a line to say." Then click **Open brief ›** on **Riken Shah**.

**0:45.** Person page. Middle: **Riken Shah · Judge**, the **● You ● Them** legend, then the Brief: **Who**, **Lately**, **Common ground**, **How you connect**, **Best opener** (scored, e.g. 9/10, with the reason). Right: **How you connect**: **Direct** (You — shared topic — Riken), **Through Harrison** (an intro path via a mutual), **What you share**, **Why now**. "This is the path FalkorDB found between us, drawn."

**1:15.** Hover an amber citation chip. Under the Brief, click the quiet pill **⌁ N graph queries · N rows · N ms ›**. Dialog **How I know this**: **Shared topics, skills, employers, and places** (`you → facet ← them`), **Their newest item about something you share** (`you → facet ← their item ← them`), **Intro paths through a mutual person**, each with rows, ms, and the Cypher. "Every sentence cites a fact, every fact cites a web page, and every answer shows the Cypher FalkorDB ran." **Close**.

**1:45.** Composer **Ask a follow-up about Riken…**: type `What did Riken post this week about coding agents? Show the query.` Enter. Click the new pill: **A query the agent wrote for your question**, on **person:riken-shah**. **Close**.

**2:05.** Right column → **Show full graphs**. Both graphs, You and Riken. On Riken's graph click **Data sources**: "Fetched today at 1:23 PM · 8 of 8 sources OK", the per-source counts (LinkedIn, X, YouTube, Web search, Research agent), and the **Bright Data** badges. "LinkedIn, X, and Google come through Bright Data; when a source fails we retry once, skip it, and keep the rest." **Close**.

**2:25.** Left, **+ Add person**. Type the name you met, else `Jason Lengstorf`. **Add**. "They weren't in the room. Identity search finds their accounts, then each source lights up." Don't wait; the row shows progress.

**2:40.** Header switch **Protected traits dropped** (on by default): "Graphs, matches, and briefs never use health, religion, politics, ethnicity, orientation, family, or age."

**2:50.** "One graph per person plus a shared room graph in FalkorDB, built live from the web with Bright Data. Every answer shows its path. And `/api/mcp` lets Claude or Cursor query the room."

## FalkorDB

One graph per person (`person:<slug>`) and a room graph projected from them (`npm run room:build`). Matches, why-now, and intro paths are multi-hop Cypher on that room graph.

Chat reads with `GRAPH.RO_QUERY`. Writes are rejected. The Cypher, the row count, and the milliseconds are in the **How I know this** dialog.

## Bright Data

Web Scraper API (LinkedIn, X, YouTube, GitHub, Instagram, Threads, Bluesky, Reddit, Crunchbase, npm/PyPI), SERP API, and Web Unlocker. Identity search uses SERP, LinkedIn people search, and X.

On stage: **Show full graphs** → **Data sources** (fetched time, sources OK, the **Bright Data** badges) and the live ingest (sources lighting up).

## If they ask

- **Privacy.** Public pages only. No contacts or private messages. Header switch **Protected traits dropped** is on by default. The graph, Brief, matches, and plan skip health, religion, politics, ethnicity, orientation, family, and age. Every node has a **Source** link.
- **Wrong person.** Luma links win. Search matches under 0.5 are dropped. The card shows **Matched via** (`luma`, `search`, `agent`) and **Confidence**. A miss stays in that person's graph.
- **Cost.** Roughly 20–30 Bright Data requests per person (about 3 cents at pay-as-you-go; an estimate, not a bill). Research caps at 5 calls. About 20 items a source, last 12 months. The Brief is one chat on stored graphs. Fetches are cached.
- **Why not one big graph?** A bad match stays in that person's graph, and re-ingest merges only that graph. The room graph is a projection, rebuilt from the person graphs.
- **A thousand people.** Ingest ahead of time. The screen still opens one person. Same caps, plus 400 nodes in the prompt.
- **Failures.** Each source fails alone: one retry on 5xx, slow scrapes fall back to async snapshots, then the source is skipped and the rest kept. **Data sources** shows what ran and when.
- **Next.** A feed of what the room shipped this week.

## If it breaks

- **Wi-Fi or a dead app.** Graphs are local. Chat and ingest need the network. Switch to https://luckdragon.nishilfaldu.site. Don't reload it. It is read-only: no **+ Add person**.
- **Slow brief.** Talk over what streamed and ask. **Try again** once, then the public URL.
- **Stale room.** Empty **WHO TO MEET** or an empty **How you connect**: run `npm run room:build` before going up. On stage, open **Show full graphs** and stay on the two graphs.
- **Ingest.** One red row is one source. Don't add a second person. If add fails, go back to Riken and open **Data sources**.

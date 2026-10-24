# luckdragon — stage card (3 min)

Light theme, 125% zoom. Re-rank the judge before you go up. Counts were still moving.

## 15 min before

- `docker compose up -d` and `docker compose ps`. FalkorDB on **6379**. Do not project **:3001** (FalkorDB's own UI). `npm run dev` → **:3000**. Full screen (Ctrl-Cmd-F).
- Judge = highest `nodeCount` among `role=judge` and `status=ready`. Skip guests, even if their graphs are bigger.

```bash
curl -s localhost:3000/api/people | python3 -c 'import json,sys; p=json.load(sys.stdin)["people"]; j=sorted((x for x in p if x["role"]=="judge"), key=lambda x:-x["nodeCount"])[0]; print("JUDGE", j["name"], j["nodeCount"]); print("NONE", ", ".join(x["name"] for x in p if x["status"]=="none"))'
```

  Last check: **Riken Shah, 169.** Then satyam singh 130, Schezeen Fazulbhoy 115. Nishil was ready at 140. Say whatever name the command prints.
- Ingest target: hollow dot plus an **Ingest** button. **Lee Robinson**, else **Kunal Kushwaha**. Empty `NONE` → skip that beat.
- Zoom 125% (two steps up from 100). Drop to 110% if the composer is cut off. Click the **sun** (tooltip Light). System on this laptop is dark.
- Ignore the round **N**. Overlay: Escape. Couldn't load: **Reload**.
- Backup tab: Light, Nishil, search `Riken`, wait for **Who / Lately / Common ground / Openers**. Do not reload it. QuickTime video paused on frame one.

## Script

Still on **Writing the brief…** at 1:20? Ask anyway.

**0:00.** "You walk into a room of strangers and a name tag. The useful stuff is already public. It's scattered across LinkedIn, GitHub, talks, and posts."

**0:18.** Header pill → search `Nishil` → **Nishil Faldu**. "I'll be myself. I am Nishil Faldu." He pins under **YOU** (green dot, node count).

**0:32.** Left **Search** → `Riken` → the **Judge** row → clear Search (**YOU** hides while the box doesn't match you). "Riken Shah. Biggest graph on the judging side." Panes: **You** and **Riken Shah**. Chat: **Writing the brief…**, then **Who**, **Lately**, **Common ground**, **Openers**. "Who he is, what he did lately, where we overlap, and three things I could say."

**1:05.** Hover an amber chip, then a blue one. Don't click (a click covers the graph). "Amber is his, blue is mine. Hovering lights that node." Tooltip says `Riken Shah's graph` or `Your graph`.

**1:20.** Click **Ask about them**, Enter, don't use the suggestion chips:

`How many posts does he have since July, and what is the latest one? Run it as a query.`

"The brief already had the graphs. This has to ask FalkorDB." Open **How I know this** (not on the brief): `run_cypher`, rows, milliseconds, the query. "Read-only, one graph, query stays up." If it's missing: `Count his nodes by label with Cypher.`

**2:15.** Search `Lee` or `Kunal`. Click **Ingest**, not the name. The graph leaves Riken. Don't wait. "Wasn't built yet. LinkedIn, X, GitHub, YouTube go Fetching, then a count." Dot pulses amber. **Ingesting** on the row. A red line is one source.

**2:40.** "One FalkorDB graph per person, from live public pages through Bright Data. The answer cites the node, and you can open the query."

## FalkorDB

Graph name `person:<slug>`. The agent passes the slug and does not put it in the Cypher. Chat is read-only. `CREATE`, `MERGE`, and `DELETE` are rejected. Eight seconds, 200 rows. Overlap is two graphs read by the model, not a join. You showed the query.

## Bright Data

Public pages, not a fixture. Scraper datasets (LinkedIn, X, YouTube, GitHub, and the rest), SERP when an account is missing, Web Unlocker when research opens a page. Left column is that pipeline. Raw JSON is cached. The last beat was it running live.

## If they ask

- **Privacy.** Public pages only. No contacts or private messages. One local graph per person. Every node has a source URL.
- **Wrong person.** Luma links win. Search matches under 0.5 are dropped. Card shows **Matched via** (`luma`, `search`, `agent`) and **Confidence**. A miss stays in that graph.
- **Cost.** Cheap model only. Research caps at 5 calls. ~20 items a source, last 12 months. Brief is one chat on stored graphs. Fetches are cached. No dollar-per-person number yet.
- **Why separate graphs.** A bad match can't spread. Re-ingest merges one graph. No conference-wide join.
- **A thousand people.** Ingest ahead of time. The screen still opens one person. Same caps, plus 400 nodes in the prompt.
- **Next.** A common-ground score, intro paths through mutuals, a feed of what the room shipped this week.

## If it breaks

- **Wi-Fi.** Graphs are local. Switch to the backup tab. Don't reload it. Chat and ingest need the network. Dead app: play the video.
- **Slow brief.** After ~20s, talk over what streamed and ask. **Try again** once, then the backup tab.
- **Ingest.** One red row is one source. Don't start a second person. Lee already green? Kunal. Nobody left? Point at Riken's chips: LinkedIn, X, GitHub, Website.

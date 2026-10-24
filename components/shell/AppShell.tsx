"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode } from "@/lib/types";
import { ApiError, fetchGraph, fetchPeople, postPerson, streamChat, streamIngest, type ChatStreamEvent } from "./api";
import { ChatPane } from "./ChatPane";
import { GraphPane } from "./GraphPane";
import { Header } from "./Header";
import {
  FIXTURE_PEOPLE,
  VIEWER_KEY,
  chatKey,
  citationsIn,
  makeId,
  presentPerson,
  type ChatThread,
  type Citation,
  type FocusTarget,
  type GraphState,
  type IngestRun,
  type PersonListItem,
  type ToolCall,
  type UiMessage,
} from "./model";
import { PeoplePane } from "./PeoplePane";
import { sampleGraph, sampleThread, wantsCard, wantsSample } from "./sample";

const briefStarted = new Set<string>();
const briefLock = new Set<string>();

export function AppShell() {
  const [people, setPeople] = useState<PersonListItem[] | null>(null);
  const [peopleNote, setPeopleNote] = useState<string | null>(null);
  const [viewerSlug, setViewerSlug] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [graphs, setGraphs] = useState<Record<string, GraphState>>({});
  const [threads, setThreads] = useState<Record<string, ChatThread>>({});
  const [ingest, setIngest] = useState<Record<string, IngestRun>>({});
  const [hoverCite, setHoverCite] = useState<Citation | null>(null);
  const [centerNonce, setCenterNonce] = useState(0);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [prefill, setPrefill] = useState<{ nonce: number; text: string } | null>(null);
  const fromApi = useRef(false);
  const appliedPerson = useRef(false);
  const appliedViewer = useRef(false);
  const threadsRef = useRef(threads);
  const viewerRef = useRef(viewerSlug);
  const selectedRef = useRef(selectedSlug);
  const graphReq = useRef<Record<string, number>>({});
  const activeChat = useRef<AbortController | null>(null);

  useEffect(() => {
    threadsRef.current = threads;
    viewerRef.current = viewerSlug;
    selectedRef.current = selectedSlug;
  }, [threads, viewerSlug, selectedSlug]);

  const loadPeople = useCallback(async () => {
    try {
      const list = await fetchPeople();
      fromApi.current = true;
      setPeople(withFixtures(list));
      setPeopleNote(null);
    } catch {
      if (fromApi.current) {
        setPeopleNote("Couldn't refresh the people list.");
        return;
      }
      setPeople(FIXTURE_PEOPLE);
      setPeopleNote("People list isn't ready. Showing the two fixture graphs.");
    }
  }, []);

  const loadGraph = useCallback((slug: string) => {
    const id = (graphReq.current[slug] ?? 0) + 1;
    graphReq.current[slug] = id;
    setGraphs((prev) => {
      if (prev[slug]?.status === "ready") return prev;
      return { ...prev, [slug]: { status: "loading" } };
    });
    return fetchGraph(slug)
      .then((data) => {
        if (graphReq.current[slug] !== id) return;
        setGraphs((prev) => ({ ...prev, [slug]: { status: "ready", data } }));
      })
      .catch((err: unknown) => {
        if (graphReq.current[slug] !== id) return;
        const fallback = wantsSample() ? sampleGraph(slug) : null;
        if (fallback) {
          setGraphs((prev) => {
            if (prev[slug]?.status === "ready") return prev;
            return { ...prev, [slug]: { status: "ready", data: fallback } };
          });
          return;
        }
        const message = err instanceof ApiError ? err.message : "Couldn't load this graph.";
        setGraphs((prev) => {
          if (prev[slug]?.status === "ready") return prev;
          return { ...prev, [slug]: { status: "error", message } };
        });
      });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPeople();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPeople]);

  useEffect(() => {
    if (!people?.length || appliedViewer.current) return;
    const fromQuery = new URLSearchParams(window.location.search).get("viewer");
    if (addFixture(fromQuery, people, setPeople)) return;
    const next = pickViewer(people, fromQuery);
    const timer = window.setTimeout(() => {
      appliedViewer.current = true;
      setViewerSlug((current) => current ?? next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [people]);

  useEffect(() => {
    if (!people || appliedPerson.current) return;
    const fromQuery = new URLSearchParams(window.location.search).get("person");
    if (addFixture(fromQuery, people, setPeople)) return;
    if (!fromQuery || !people.some((person) => person.slug === fromQuery)) {
      appliedPerson.current = true;
      return;
    }
    const slug = fromQuery;
    const timer = window.setTimeout(() => {
      appliedPerson.current = true;
      setSelectedSlug(slug);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [people]);

  useEffect(() => {
    if (!viewerSlug) return;
    const slug = viewerSlug;
    const timer = window.setTimeout(() => {
      void loadGraph(slug);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [viewerSlug, loadGraph]);

  useEffect(() => {
    if (!selectedSlug) return;
    const slug = selectedSlug;
    const timer = window.setTimeout(() => {
      void loadGraph(slug);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedSlug, loadGraph]);

  useEffect(() => {
    if (!viewerSlug) return;
    if (new URLSearchParams(window.location.search).get("viewer") === viewerSlug) return;
    try {
      localStorage.setItem(VIEWER_KEY, viewerSlug);
    } catch {
      /* storage can be blocked */
    }
  }, [viewerSlug]);

  const runChatRef = useRef<(args: { viewer: string; person: string; mode?: "brief"; text?: string }) => void>(() => {});

  async function runChat(args: { viewer: string; person: string; mode?: "brief"; text?: string }) {
    const key = chatKey(args.viewer, args.person);
    const controller = new AbortController();
    activeChat.current?.abort();
    activeChat.current = controller;
    const history = (threadsRef.current[key]?.messages ?? [])
      .filter((message) => message.content.trim())
      .map((message) => ({ role: message.role, content: message.content }));
    if (args.text) history.push({ role: "user", content: args.text });
    const assistantId = makeId();
    const userMessage: UiMessage | null = args.text
      ? { id: makeId(), role: "user", content: args.text, tools: [], suggestions: [] }
      : null;

    setThreads((prev) => {
      const existing = args.mode === "brief" ? [] : dropEmptyTail(prev[key]?.messages ?? []);
      const messages = [...existing, ...(userMessage ? [userMessage] : []), emptyAssistant(assistantId)];
      return { ...prev, [key]: { messages, streaming: true, error: null } };
    });

    const current = () => activeChat.current === controller;
    try {
      await streamChat(
        {
          viewer: args.viewer,
          person: args.person,
          messages: args.mode === "brief" ? [] : history,
          ...(args.mode === "brief" ? { mode: "brief" as const } : {}),
        },
        (event) => {
          if (!current()) return;
          applyEvent(key, assistantId, event);
        },
        controller.signal,
      );
      if (!current()) return;
      finishThread(key, assistantId);
    } catch (err) {
      if (!current()) return;
      if (isAbort(err)) {
        setThreads((prev) => {
          const thread = prev[key];
          if (!thread) return prev;
          return { ...prev, [key]: { ...thread, streaming: false } };
        });
        return;
      }
      const message = err instanceof ApiError ? err.message : "That didn't work.";
      setThreads((prev) => {
        const thread = prev[key];
        if (!thread) return prev;
        return {
          ...prev,
          [key]: {
            streaming: false,
            error: message,
            messages: thread.messages.map((item) =>
              item.id === assistantId && !item.content.trim() ? { ...item, content: message } : item,
            ),
          },
        };
      });
    }
  }

  function applyEvent(key: string, assistantId: string, event: ChatStreamEvent) {
    setThreads((prev) => {
      const thread = prev[key];
      if (!thread) return prev;
      const messages = thread.messages.map((message) => {
        if (message.id !== assistantId) return message;
        if (event.type === "text") return { ...message, content: message.content + event.delta };
        if (event.type === "tool") return { ...message, tools: upsertTool(message.tools, event) };
        if (event.type === "suggestions") return { ...message, suggestions: event.items };
        if (event.type === "error" && !message.content.trim()) return { ...message, content: event.message };
        return message;
      });
      return {
        ...prev,
        [key]: {
          messages,
          streaming: event.type === "done" ? false : thread.streaming,
          error: event.type === "error" ? event.message : thread.error,
        },
      };
    });
  }

  function finishThread(key: string, assistantId: string) {
    setThreads((prev) => {
      const thread = prev[key];
      if (!thread) return prev;
      let error = thread.error;
      const messages = thread.messages.map((message) => {
        if (message.id !== assistantId || message.content.trim()) return message;
        error = error || "Nothing came back.";
        return { ...message, content: error };
      });
      return { ...prev, [key]: { messages, streaming: false, error } };
    });
  }

  useEffect(() => {
    runChatRef.current = (args) => {
      void runChat(args);
    };
  });

  useEffect(() => {
    if (wantsSample() || !viewerSlug || !selectedSlug) return;
    if (ingest[viewerSlug]?.running || ingest[selectedSlug]?.running) return;
    if (graphs[viewerSlug]?.status !== "ready" || graphs[selectedSlug]?.status !== "ready") return;
    const key = chatKey(viewerSlug, selectedSlug);
    const existing = threadsRef.current[key];
    if (existing?.streaming) return;
    if (existing?.messages.some((message) => message.role === "user")) return;
    if (existing && hasRealAnswer(existing)) return;
    if (briefLock.has(key) && !threadMissesGraph(existing)) return;
    briefLock.add(key);
    runChatRef.current({ viewer: viewerSlug, person: selectedSlug, mode: "brief" });
  }, [viewerSlug, selectedSlug, graphs, ingest]);

  useEffect(() => {
    if (!wantsSample() || !viewerSlug || !selectedSlug || !people) return;
    const key = chatKey(viewerSlug, selectedSlug);
    if (briefStarted.has(key)) return;
    const viewerGraph = graphs[viewerSlug];
    const personGraph = graphs[selectedSlug];
    if (!viewerGraph || viewerGraph.status === "loading") return;
    if (!personGraph || personGraph.status === "loading") return;
    const viewer = people.find((person) => person.slug === viewerSlug);
    const person = people.find((item) => item.slug === selectedSlug);
    if (!viewer || !person) return;
    briefStarted.add(key);
    const thread = sampleThread(presentPerson(viewer, viewerGraph), presentPerson(person, personGraph), graphs);
    window.setTimeout(() => {
      setThreads((prev) => ({ ...prev, [key]: thread }));
      if (wantsCard()) {
        const cite = citationsIn(thread.messages[0]?.content ?? "").find((item) => item.slug === selectedSlug);
        if (cite) setFocus({ slug: cite.slug, id: cite.nodeId });
      }
    }, 0);
  }, [viewerSlug, selectedSlug, graphs, people]);

  async function startIngest(slug: string) {
    if (ingest[slug]?.running) return;
    setSelectedSlug(slug);
    setPeople((prev) => prev?.map((person) => (person.slug === slug ? { ...person, status: "ingesting" } : person)) ?? prev);
    setIngest((prev) => ({ ...prev, [slug]: { running: true, error: null, sources: prev[slug]?.sources ?? [] } }));
    let sawDone = false;
    let finished = false;
    try {
      await streamIngest(slug, (event) => {
        if (event.source === "all") {
          if (event.status === "done") finished = true;
          if (event.status === "error") {
            setIngest((prev) => ({
              ...prev,
              [slug]: {
                running: false,
                error: event.message || "Ingest failed.",
                sources: prev[slug]?.sources ?? [],
              },
            }));
          }
          return;
        }
        if (event.status === "done") {
          sawDone = true;
          void loadGraph(slug);
        }
        setIngest((prev) => {
          const current = prev[slug] ?? { running: true, error: null, sources: [] };
          const sources = current.sources.slice();
          const row = { source: event.source, status: event.status, count: event.count, message: event.message };
          const index = sources.findIndex((item) => item.source === event.source);
          if (index >= 0) sources[index] = row;
          else sources.push(row);
          return { ...prev, [slug]: { ...current, running: true, sources } };
        });
      });
      const ready = finished || sawDone;
      if (ready) {
        releaseBrief(slug, viewerRef.current, selectedRef.current, threadsRef.current);
        await loadGraph(slug);
      }
      setIngest((prev) => ({
        ...prev,
        [slug]: { running: false, error: prev[slug]?.error ?? null, sources: prev[slug]?.sources ?? [] },
      }));
      setPeople((prev) =>
        prev?.map((person) => (person.slug === slug ? { ...person, status: ready ? "ready" : "none" } : person)) ?? prev,
      );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Ingest didn't start.";
      setIngest((prev) => ({
        ...prev,
        [slug]: { running: false, error: message, sources: prev[slug]?.sources ?? [] },
      }));
      setPeople((prev) =>
        prev?.map((person) => (person.slug === slug ? { ...person, status: sawDone ? "ready" : "none" } : person)) ?? prev,
      );
    }
  }

  async function addPerson(lumaUrl: string) {
    const person = await postPerson(lumaUrl);
    setPeople((prev) => {
      const list = prev ?? [];
      if (list.some((item) => item.slug === person.slug)) {
        return list.map((item) => (item.slug === person.slug ? { ...item, ...person, status: item.status } : item));
      }
      return [...list, { ...person, status: "none" }];
    });
    setPeopleNote(null);
    await startIngest(person.slug);
  }

  const presented = useMemo(
    () => people?.map((person) => presentPerson(person, graphs[person.slug])) ?? null,
    [people, graphs],
  );
  const viewer = presented?.find((person) => person.slug === viewerSlug) ?? null;
  const selected = presented?.find((person) => person.slug === selectedSlug) ?? null;
  const thread = viewer && selected ? threads[chatKey(viewer.slug, selected.slug)] ?? null : null;
  const citations = useMemo(() => {
    const last = [...(thread?.messages ?? [])].reverse().find((message) => message.role === "assistant");
    return citationsIn(last?.content ?? "");
  }, [thread]);

  function hoverCitation(cite: Citation | null) {
    setHoverCite(cite);
    if (cite) setCenterNonce((value) => value + 1);
  }

  function ask(node: GraphNode) {
    setPrefill({ nonce: Date.now(), text: `What should I know about ${node.label}?` });
  }

  return (
    <div className="shell" data-ready={people ? "true" : "false"}>
      <Header people={presented} viewerSlug={viewerSlug} onViewer={setViewerSlug} />
      <div className="panes">
        <PeoplePane
          people={presented}
          note={peopleNote}
          viewerSlug={viewerSlug}
          selectedSlug={selectedSlug}
          ingest={ingest}
          onSelect={setSelectedSlug}
          onIngest={(slug) => void startIngest(slug)}
          onAdd={addPerson}
          onRetry={() => void loadPeople()}
        />
        <GraphPane
          viewer={viewer}
          person={selected}
          graphs={graphs}
          citations={citations}
          hoverCite={hoverCite}
          centerNonce={centerNonce}
          focus={focus}
          onFocus={setFocus}
          onAsk={ask}
          onRetry={loadGraph}
        />
        <ChatPane
          person={selected}
          viewer={viewer}
          thread={thread}
          graphs={graphs}
          activeCite={hoverCite}
          prefill={prefill}
          onCiteHover={hoverCitation}
          onCiteClick={(cite) => {
            hoverCitation(cite);
            setFocus({ slug: cite.slug, id: cite.nodeId });
          }}
          onSend={(text) => {
            if (!viewerSlug || !selectedSlug) return;
            void runChat({ viewer: viewerSlug, person: selectedSlug, text });
          }}
          onRetry={() => {
            if (!viewerSlug || !selectedSlug) return;
            void runChat({ viewer: viewerSlug, person: selectedSlug, mode: "brief" });
          }}
        />
      </div>
    </div>
  );
}

function threadMissesGraph(thread: ChatThread | undefined): boolean {
  if (!thread) return false;
  const text = `${thread.error ?? ""}\n${thread.messages.map((message) => message.content).join("\n")}`;
  return /no graph for/i.test(text);
}

function hasRealAnswer(thread: ChatThread): boolean {
  if (threadMissesGraph(thread)) return false;
  return thread.messages.some((message) => message.role === "assistant" && message.content.trim());
}

function releaseBrief(
  slug: string,
  viewer: string | null,
  selected: string | null,
  threads: Record<string, ChatThread>,
) {
  if (!viewer || !selected) return;
  if (slug !== viewer && slug !== selected) return;
  const key = chatKey(viewer, selected);
  const thread = threads[key];
  if (!thread || threadMissesGraph(thread)) briefLock.delete(key);
}

function emptyAssistant(id: string): UiMessage {
  return { id, role: "assistant", content: "", tools: [], suggestions: [] };
}

function dropEmptyTail(messages: UiMessage[]): UiMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && !last.content.trim()) return messages.slice(0, -1);
  return messages;
}

function upsertTool(tools: ToolCall[], event: Extract<ChatStreamEvent, { type: "tool" }>): ToolCall[] {
  const tool: ToolCall = {
    id: event.id,
    name: event.name,
    input: event.input,
    cypher: event.cypher,
    rowCount: event.rowCount,
    ms: event.ms,
  };
  const index = tools.findIndex((item) => item.id === tool.id);
  if (index < 0) return [...tools, tool];
  const next = tools.slice();
  next[index] = { ...next[index], ...tool };
  return next;
}

function withFixtures(list: PersonListItem[]): PersonListItem[] {
  const slugs = new Set(list.map((person) => person.slug));
  const extra = FIXTURE_PEOPLE.filter((person) => !slugs.has(person.slug));
  return extra.length > 0 ? [...list, ...extra] : list;
}

function addFixture(
  slug: string | null,
  people: PersonListItem[],
  update: (value: PersonListItem[] | ((current: PersonListItem[] | null) => PersonListItem[] | null)) => void,
): boolean {
  if (!slug || people.some((person) => person.slug === slug)) return false;
  const fixture = FIXTURE_PEOPLE.find((person) => person.slug === slug);
  if (!fixture) return false;
  update((prev) => {
    if (!prev || prev.some((person) => person.slug === fixture.slug)) return prev;
    return [...prev, fixture];
  });
  return true;
}

function pickViewer(people: PersonListItem[], fromQuery: string | null): string {
  if (fromQuery && people.some((person) => person.slug === fromQuery)) return fromQuery;
  const stored = readStored();
  if (stored && people.some((person) => person.slug === stored)) return stored;
  return people.find((person) => person.role.toLowerCase() === "viewer")?.slug ?? people[0].slug;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(VIEWER_KEY);
  } catch {
    return null;
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

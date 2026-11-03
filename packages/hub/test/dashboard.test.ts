import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
if (!script) throw new Error("dashboard script missing");

/** Only the DOM operations the dashboard uses; text never becomes executable markup. */
class Element {
  children: Element[] = [];
  private ownText = "";
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.ownText = value; this.children = []; }
  hidden = false;
  value = "";
  dateTime = "";
  checked = false;
  disabled = false;
  open = false;
  id = "";
  className = "";
  title = "";
  attributes = new Map<string, string>();
  tag = "div";
  onFocus: ((element: Element) => void) | undefined;
  private listeners = new Map<string, Array<() => void>>();
  private parent: Element | undefined;
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  set innerHTML(_value: string) { throw new Error("untrusted markup must not be parsed"); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  focus() { this.onFocus?.(this); }
  contains(element: Element | null): boolean { return element === this || this.children.some(child => child.contains(element)); }
  querySelectorAll(selector: string): Element[] {
    const matches = (element: Element) => selector === "details" ? element.tag === "details"
      : selector.startsWith("[data-field=") ? element.getAttribute("data-field") === selector.slice(12, -1) : false;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  appendChild(child: Element) { child.parent = this; this.children.push(child); }
  replaceChildren(...children: Element[]) {
    for (const child of this.children) child.parent = undefined;
    this.ownText = ""; this.children = [];
    for (const child of children) this.appendChild(child);
  }
}

interface SnapshotResponse { ok: boolean; json: () => Promise<unknown> }
interface FetchOptions { credentials: string; cache: string; signal: AbortSignal }
interface PendingFetch {
  resolve: (response: SnapshotResponse) => void;
  reject: (error: Error) => void;
}

function dashboard() {
  const sessions = new Element();
  const deliveries = new Element();
  const feed = new Element();
  const connection = new Element();
  const error = new Element();
  const lastUpdate = new Element();
  const sessionSummary = new Element();
  const deliverySummary = new Element();
  const feedSummary = new Element();
  const search = new Element();
  const state = new Element();
  const wake = new Element();
  const feedType = new Element();
  const clear = new Element();
  connection.textContent = "Loading snapshot; connecting to live updates…";
  sessionSummary.textContent = "Loading sessions…";
  deliverySummary.textContent = "Loading deliveries…";
  lastUpdate.textContent = "Not yet";
  error.hidden = true;
  const elements: Record<string, Element> = {
    "#sessions": sessions, "#deliveries": deliveries,
    "#feed": feed, "#connection": connection, "#snapshot-error": error,
    "#last-update": lastUpdate, "#session-summary": sessionSummary, "#delivery-summary": deliverySummary,
    "#feed-summary": feedSummary, "#session-search": search, "#session-state": state,
    "#session-wake": wake, "#feed-type": feedType, "#clear-session-filters": clear,
  };
  for (const id of ["announcements", "topics", "topic-summary", "topic-search", "topic-kind", "topic-ended", "clear-topic-filters", "session-ended", "delivery-search", "delivery-state", "clear-delivery-filters", "refresh", "pause", "overview-summary", "metric-sessions", "metric-states", "metric-hosts", "metric-topics", "metric-deliveries", "focus-notice", "sessions-heading", "topics-heading", "deliveries-heading", "activity-heading"]) elements["#" + id] = new Element();
  let activeElement: Element | null = null;
  const allElements = new Set(Object.values(elements));
  const focus = (element: Element) => { activeElement = element; };
  for (const element of allElements) element.onFocus = focus;
  const listeners = new Map<string, Array<(event: { data: string }) => void>>();
  const streamUrls: string[] = [];
  let readyState = 0;
  class EventSource {
    constructor(url: string) { streamUrls.push(url); }
    get readyState() { return readyState; }
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    }
  }
  const requests: PendingFetch[] = [];
  const fetch = vi.fn((_url: string, options: FetchOptions) => new Promise<SnapshotResponse>((resolve, reject) => {
    requests.push({ resolve, reject });
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  runInNewContext(script, {
    document: {
      querySelector: (selector: string) => elements[selector] ?? null,
      createElement: (tag: string) => { const element = new Element(); element.tag = tag; element.onFocus = focus; allElements.add(element); return element; },
      get activeElement() { return activeElement; },
      getElementById: (id: string) => [...allElements].find(element => element.id === id && Object.values(elements).some(root => root.contains(element))) ?? null,
    },
    EventSource, fetch, setTimeout, clearTimeout, setInterval, AbortController, Date,
  });
  const emit = (type: string, data = "") => {
    for (const listener of listeners.get(type) ?? []) listener({ data });
  };
  return {
    sessions, deliveries, feed, connection, error, fetch, streamUrls, emit,
    element: (id: string) => elements["#" + id] as Element,
    focused: () => activeElement,
    lastUpdate, sessionSummary, deliverySummary, feedSummary, search, state, wake, feedType, clear,
    closeStream() { readyState = 2; emit("error"); },
    event(type: string, data: unknown = {}) {
      emit(type, JSON.stringify({ type, at: "2026-10-25T12:34:56.000Z", data }));
    },
    request(index: number) {
      const request = requests[index];
      if (!request) throw new Error(`missing snapshot request ${index}`);
      return request;
    },
    respond(index: number, value: unknown, ok = true) {
      const normalized = value && typeof value === "object" && "sessions" in value
        ? { topics: [], ...value, sessions: Array.isArray(value.sessions) ? value.sessions.map((row: unknown, i: number) => row && typeof row === "object" ? { id: `session-${i}`, ...row } : row) : value.sessions }
        : value;
      this.request(index).resolve({ ok, json: async () => normalized });
    },
  };
}

const empty = { sessions: [], deliveries: [] };
const valueOf = (element: Element, field: string) => element.querySelectorAll(`[data-field=${field}]`)[0]?.textContent ?? "";
const rowText = (element: Element) => element.children.filter(row => !row.className.includes("empty")).map(row =>
  valueOf(row, "handle") ? ["handle", "vendor", "project", "state", "wake", "status"].map(field => valueOf(row, field))
    : [valueOf(row,"seq").replace("Recipient sequence ", ""), valueOf(row,"recipient"), valueOf(row,"sender"), valueOf(row,"subject") === "Message" ? valueOf(row,"preview") : valueOf(row,"subject"), valueOf(row,"receipt")]);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime("2026-10-25T12:00:00.000Z"); });
afterEach(() => vi.useRealTimers());

describe("minimal dashboard", () => {
  it("renders session and delivery snapshots as text, replaces old rows and labels marked-read receipts", async () => {
    const page = dashboard();
    await vi.advanceTimersByTimeAsync(1);
    expect(page.streamUrls).toEqual(["/api/events"]);
    expect(page.fetch).toHaveBeenCalledWith("/api/snapshot", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    page.respond(0, {
      sessions: [{ handle: "author@mac", vendor: "claude-code", project_key: null, state: "idle", wake: "off", status_line: "<img src=x onerror=alert(1)>" }],
      deliveries: [
        { seq: 1, recipient: "author@mac", sender: "reviewer@mac", subject: "<script>bad()</script>", preview: "unused", state: "unread" },
        { seq: 2, recipient: "reviewer@mac", sender: "author@mac", subject: null, preview: "preview & details", state: "read" },
      ],
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions)).toEqual([["author@mac", "claude-code", "No project", "idle", "off", "<img src=x onerror=alert(1)>"]]);
    expect(rowText(page.deliveries)).toEqual([
      ["1", "author@mac", "reviewer@mac", "<script>bad()</script>", "Pending receipt"],
      ["2", "reviewer@mac", "author@mac", "preview & details", "Marked read"],
    ]);
    page.event("session.gone");
    await vi.advanceTimersByTimeAsync(1);
    page.respond(1, empty);
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions)).toEqual([]);
    expect(rowText(page.deliveries)).toEqual([]);
  });

  it("shows all seven live events with timestamps, coalesces activity and bounds untrusted feed lines", async () => {
    const page = dashboard();
    const types = ["session.registered", "session.updated", "session.gone", "message.sent", "delivery.created", "delivery.read", "board.put"];
    for (const type of types) page.event(type, { session_id: "<script>alert(1)</script>", body: "PRIVATE BODY" });
    await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.feed.children).toHaveLength(7);
    for (const line of page.feed.children) {
      expect(line.textContent).toContain("<script>alert(1)</script>");
      expect(line.textContent).not.toContain("PRIVATE BODY");
      expect(line.children[0]?.dateTime).toBe("2026-10-25T12:34:56.000Z");
    }
    for (let index = 0; index < 210; index++) page.event("board.put", { entry: {key:String(index)+":"+"😀".repeat(2000),topic:"QA",body:"PRIVATE BODY"} });
    expect(page.feed.children).toHaveLength(200);
    expect(page.feed.children[0]?.textContent).toContain('"key":"209:');
    expect(page.feed.children.at(-1)?.textContent).toContain('"key":"10:');
    const bounded = page.feed.children[0]?.querySelectorAll("details")[0]?.children[1]?.textContent ?? "";
    expect(Array.from(bounded)).toHaveLength(1000);
    expect(bounded.endsWith("…")).toBe(true);
    for (const data of ["not json", "null", "[]", '{"type":"board.put","at":5,"data":{}}']) page.emit("board.put", data);
    expect(page.feed.children).toHaveLength(200);
  });

  it("refreshes when SSE first opens and reopens, and preserves invalidations received during a pending fetch", async () => {
    const page = dashboard();
    await vi.advanceTimersByTimeAsync(1);
    page.emit("open");
    page.event("session.registered");
    page.event("message.sent");
    page.event("delivery.created");
    await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(1);
    page.respond(0, empty);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(2);
    page.respond(1, { sessions: [{ handle: "new@mac" }], deliveries: [{ state: "unread" }] });
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions)[0]?.[0]).toBe("new@mac");
    expect(page.connection.textContent).toBe("Connected · Live updates");
    page.emit("error");
    expect(page.connection.textContent).toContain("Reconnecting");
    expect(page.sessionSummary.textContent).toContain("stale");
    page.emit("open");
    expect(page.connection.textContent).toBe("Refreshing snapshot…");
    await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(3);
    page.event("delivery.read");
    page.respond(2, empty);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(4);
    page.respond(3, { sessions: [], deliveries: [{ state: "read" }] });
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.deliveries)[0]?.[4]).toBe("Marked read");
    expect(page.connection.textContent).toBe("Connected · Live updates");
  });

  it.each(["http", "network", "json", "shape", "timeout"])("retains the last snapshot and retries after a %s failure", async failure => {
    const page = dashboard();
    await vi.advanceTimersByTimeAsync(1);
    page.respond(0, { sessions: [{ handle: "retained@mac" }], deliveries: [] });
    await vi.advanceTimersByTimeAsync(1);
    page.emit("open");
    await vi.advanceTimersByTimeAsync(1);
    if (failure === "http") page.respond(1, empty, false);
    if (failure === "network") page.request(1).reject(new Error("offline"));
    if (failure === "json") page.request(1).resolve({ ok: true, json: async () => { throw new Error("bad JSON"); } });
    if (failure === "shape") page.respond(1, { sessions: [null], deliveries: [] });
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.error.hidden).toBe(false);
    expect(page.error.textContent).toBe("Snapshot unavailable; retrying. The dashboard retains the last successful snapshot.");
    expect(page.connection.textContent).toBe("Stale data — snapshot unavailable; retrying.");
    expect(page.sessionSummary.textContent).toContain("stale");
    expect(rowText(page.sessions)[0]?.[0]).toBe("retained@mac");
    expect(page.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(page.fetch).toHaveBeenCalledTimes(3);
    page.respond(2, empty);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.error.hidden).toBe(true);
    expect(page.error.textContent).toBe("");
    expect(rowText(page.sessions)).toEqual([]);
  });

  it("distinguishes loading, unavailable, empty and stale snapshots without a false connected status", async () => {
    const page = dashboard();
    expect(page.sessionSummary.textContent).toBe("Loading sessions…");
    expect(page.deliverySummary.textContent).toBe("Loading deliveries…");
    expect(page.lastUpdate.textContent).toBe("Not yet");
    page.emit("open");
    expect(page.connection.textContent).toBe("Loading snapshot…");
    await vi.advanceTimersByTimeAsync(1);
    page.respond(0, empty, false);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.connection.textContent).toBe("Snapshot unavailable; retrying.");
    expect(page.sessionSummary.textContent).toBe("Sessions unavailable until a snapshot succeeds.");
    expect(page.deliverySummary.textContent).toBe("Deliveries unavailable until a snapshot succeeds.");
    expect(page.lastUpdate.textContent).toBe("Not yet");
    await vi.advanceTimersByTimeAsync(3000);
    page.respond(1, empty);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.connection.textContent).toBe("Connected · Live updates");
    expect(page.sessionSummary.textContent).toBe("No sessions in this snapshot.");
    expect(page.deliverySummary.textContent).toBe("No deliveries in this snapshot.");
    const lastSuccess = page.lastUpdate.textContent;
    expect(page.lastUpdate.dateTime).toMatch(/^2026-10-25T12:00:03\./);
    expect(lastSuccess).toBe(new Date(page.lastUpdate.dateTime).toLocaleString());
    expect(page.lastUpdate.title).toBe(page.lastUpdate.dateTime);
    page.event("session.updated");
    await vi.advanceTimersByTimeAsync(1);
    page.request(2).reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(1);
    expect(page.sessionSummary.textContent).toBe("No sessions in this snapshot. Last successful snapshot; data may be stale.");
    expect(page.deliverySummary.textContent).toContain("stale");
    expect(page.lastUpdate.textContent).toBe(lastSuccess);
    page.closeStream();
    expect(page.connection.textContent).toBe("Disconnected — reload this page to reconnect.");
  });

  it("marks the current snapshot stale while an ordinary live event refresh is pending", async () => {
    const page = dashboard();
    page.emit("open");
    await vi.advanceTimersByTimeAsync(1);
    page.respond(0, { sessions: [{ handle: "author@mac", state: "idle", wake: "on" }], deliveries: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(page.connection.textContent).toBe("Connected · Live updates");
    const lastSuccess = page.lastUpdate.textContent;

    page.event("session.gone");
    expect(page.connection.textContent).toBe("Refreshing snapshot…");
    expect(page.sessionSummary.textContent).toContain("stale");
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.fetch).toHaveBeenCalledTimes(2);
    expect(rowText(page.sessions)[0]?.[3]).toBe("idle");
    expect(page.connection.textContent).toBe("Refreshing snapshot…");
    expect(page.deliverySummary.textContent).toContain("stale");
    expect(page.lastUpdate.textContent).toBe(lastSuccess);

    page.element("session-ended").checked = true;
    page.respond(1, { sessions: [{ handle: "author@mac", state: "gone", wake: "on" }], deliveries: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions)[0]?.[3]).toBe("gone");
    expect(page.connection.textContent).toBe("Connected · Live updates");
    expect(page.sessionSummary.textContent).not.toContain("stale");
    expect(page.lastUpdate.textContent).not.toBe(lastSuccess);
  });

  it("combines search, all four server states and wake filters, retains filters on refresh and can clear them", async () => {
    const page = dashboard();
    page.emit("open");
    await vi.advanceTimersByTimeAsync(1);
    const rows = [
      { handle: "active@mac", state: "active", wake: "on", project_key: "Alpha" },
      { handle: "idle@mac", state: "idle", wake: "off", project_key: "Alpha" },
      { handle: "gone@mac", state: "gone", wake: "off", project_key: "Beta" },
      { handle: "unknown@mac", state: "unknown", wake: "on", project_key: null, status_line: "Waiting on ALPHA" },
    ];
    page.respond(0, { sessions: rows, deliveries: [] });
    await vi.advanceTimersByTimeAsync(1);
    for (const row of rows) {
      page.state.value = row.state;
      page.state.emit("change");
      expect(rowText(page.sessions).map(cells => cells[0])).toEqual([row.handle]);
      expect(rowText(page.sessions)[0]?.[4]).toBe(row.wake);
    }
    page.state.value = "";
    page.search.value = " ALPHA ";
    page.search.emit("input");
    expect(rowText(page.sessions).map(cells => cells[0])).toEqual(["active@mac", "idle@mac", "unknown@mac"]);
    page.wake.value = "off";
    page.wake.emit("change");
    expect(rowText(page.sessions).map(cells => cells[0])).toEqual(["idle@mac"]);
    expect(page.sessionSummary.textContent).toBe("Showing 1 of 4 retained sessions.");
    page.state.value = "active";
    page.state.emit("change");
    expect(page.sessionSummary.textContent).toBe("No sessions match these filters.");
    page.event("session.updated");
    await vi.advanceTimersByTimeAsync(1);
    page.respond(1, { sessions: [...rows, { handle: "new@mac", state: "active", wake: "off", project_key: "Alpha" }], deliveries: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions).map(cells => cells[0])).toEqual(["new@mac"]);
    page.clear.emit("click");
    expect(rowText(page.sessions)).toHaveLength(4);
    expect([page.search.value, page.state.value, page.wake.value]).toEqual(["", "", ""]);
    expect(page.fetch).toHaveBeenCalledTimes(2);
  });

  it("filters retained feed events without losing hidden events or exceeding the global 200-event bound", () => {
    const page = dashboard();
    page.emit("open");
    expect(page.feedSummary.textContent).toBe("No live events received yet.");
    page.feedType.value = "delivery.read";
    page.feedType.emit("change");
    page.event("board.put", { key: "decisions" });
    expect(page.feedSummary.textContent).toBe("No events match this event type.");
    expect(page.feed.children[0]?.textContent).toBe("No events match this event type.");
    page.event("delivery.read", { id: "marked" });
    expect(page.feed.children).toHaveLength(1);
    expect(page.feedSummary.textContent).toBe("Showing 1 of 2 retained live events.");
    for (let index = 0; index < 200; index++) page.event("board.put", { entry: {key:String(index)} });
    expect(page.feed.children[0]?.textContent).toBe("No events match this event type.");
    page.feedType.value = "";
    page.feedType.emit("change");
    expect(page.feed.children).toHaveLength(200);
    expect(page.feed.children[0]?.textContent).toContain('"key":"199"');
    expect(page.feed.children.at(-1)?.textContent).toContain('"key":"0"');
  });
});

describe("dashboard topics and update controls", () => {
  const memberRows = [
    { id:"current", handle:"builder@host", host:"host", role:"developer", vendor:"codex", state:"active", ended_at:null },
    { id:"ended", handle:"reviewer@host", host:"host", role:"reviewer", vendor:"claude-code", state:"gone", ended_at:"2026-10-24" },
  ];
  const topic = { id:2, name:"<img onerror=alert(1)>", kind:"adhoc", current_members:1, total_members:4, hidden_ended_members:2, members:["current","ended"] };
  it("shows real subscribers and accurate truncated history counts, and filters topics without guessing membership", async () => {
    const page=dashboard(); page.emit("open"); await vi.advanceTimersByTimeAsync(1);
    page.respond(0,{sessions:memberRows,deliveries:[],topics:[topic,{id:3,name:"empty-topic",kind:"project",current_members:0,total_members:0,hidden_ended_members:0,members:[]}]});
    await vi.advanceTimersByTimeAsync(1);
    const topics=page.element("topics");
    expect(topics.children).toHaveLength(2);
    expect(topics.children[0]?.textContent).toContain("<img onerror=alert(1)>");
    expect(topics.children[0]?.textContent).toContain("1 current · 4 total subscribers");
    expect(topics.children[0]?.textContent).toContain("builder@host");
    expect(topics.children[0]?.textContent).not.toContain("reviewer@host");
    expect(topics.children[1]?.textContent).toContain("No subscribers yet.");
    expect(page.element("metric-sessions").textContent).toBe("1");
    expect(page.element("metric-hosts").textContent).toBe("1");
    expect(page.element("metric-topics").textContent).toBe("2");
    page.element("topic-ended").checked=true; page.element("topic-ended").emit("change");
    expect(topics.children[0]?.textContent).toContain("reviewer@host");
    expect(topics.children[0]?.textContent).toContain("2 older ended subscribers");
    page.element("topic-kind").value="project";page.element("topic-kind").emit("change");
    expect(topics.children).toHaveLength(1);expect(topics.children[0]?.textContent).toContain("empty-topic");
    page.element("topic-search").value="missing";page.element("topic-search").emit("input");
    expect(page.element("topic-summary").textContent).toBe("No topics match these filters.");
    page.element("clear-topic-filters").emit("click");expect(topics.children).toHaveLength(2);
    expect(page.element("topic-ended").checked).toBe(false);
  });

  it.each([
    { ...topic, members:["missing"] },
    { ...topic, members:["current","current"] },
    { ...topic, total_members:-1 },
    { ...topic, current_members:5 },
    { ...topic, hidden_ended_members:0 },
    { ...topic, name:4 },
  ])("retains known-good topics when membership metadata is malformed: %j", async malformed => {
    const page=dashboard();page.emit("open");await vi.advanceTimersByTimeAsync(1);
    page.respond(0,{sessions:memberRows,deliveries:[],topics:[topic]});await vi.advanceTimersByTimeAsync(1);
    page.element("refresh").emit("click");await vi.advanceTimersByTimeAsync(1);
    page.respond(1,{sessions:memberRows,deliveries:[],topics:[malformed]});await vi.advanceTimersByTimeAsync(1);
    expect(page.error.hidden).toBe(false);
    expect(page.element("topics").textContent).toContain("1 current · 4 total subscribers");
    expect(page.element("topic-summary").textContent).toContain("stale");
  });

  it("refreshes memberships without SSE events and coalesces periodic invalidation with an in-flight request", async () => {
    const page=dashboard();page.emit("open");await vi.advanceTimersByTimeAsync(1);
    page.respond(0,{sessions:memberRows,deliveries:[],topics:[topic]});await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(page.fetch).toHaveBeenCalledTimes(2);
    page.event("session.updated");page.event("session.updated");
    expect(page.fetch).toHaveBeenCalledTimes(2);
    page.respond(1,{sessions:memberRows,deliveries:[],topics:[{...topic,members:["ended"],current_members:0,total_members:3}]});
    await vi.advanceTimersByTimeAsync(1);expect(page.fetch).toHaveBeenCalledTimes(3);
    expect(page.element("topics").textContent).toContain("No current subscribers.");
  });

  it("freezes snapshots and activity on pause, supports a one-shot refresh, and catches up on resume", async () => {
    const page=dashboard();page.emit("open");await vi.advanceTimersByTimeAsync(1);
    page.respond(0,{sessions:memberRows,deliveries:[],topics:[topic]});await vi.advanceTimersByTimeAsync(1);
    page.event("message.sent",{message:{subject:"before pause"}});await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(2);
    page.element("pause").emit("click");
    page.respond(1,empty);await vi.advanceTimersByTimeAsync(1);
    expect(page.element("metric-sessions").textContent).toBe("1");
    const feedBefore=page.feed.textContent;
    page.event("message.sent",{message:{subject:"discarded"}});
    await vi.advanceTimersByTimeAsync(30000);
    expect(page.fetch).toHaveBeenCalledTimes(2);expect(page.feed.textContent).toBe(feedBefore);
    expect(page.connection.textContent).toContain("Updates paused");
    page.element("refresh").emit("click");await vi.advanceTimersByTimeAsync(1);
    page.respond(2,empty);await vi.advanceTimersByTimeAsync(1);
    expect(page.element("metric-sessions").textContent).toBe("0");expect(page.connection.textContent).toContain("Updates paused");
    await vi.advanceTimersByTimeAsync(30000);expect(page.fetch).toHaveBeenCalledTimes(3);
    page.element("pause").emit("click");await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(4);page.respond(3,{sessions:memberRows,deliveries:[],topics:[topic]});await vi.advanceTimersByTimeAsync(1);
    expect(page.element("metric-sessions").textContent).toBe("1");expect(page.connection.textContent).toBe("Connected · Live updates");
    expect(page.feed.textContent).not.toContain("discarded");
    page.event("message.sent",{message:{subject:"after resume"}});expect(page.feed.textContent).toContain("after resume");
  });

  it("preserves disclosure and focused control across changes, and moves focus to the heading if removed", async () => {
    const page=dashboard();page.emit("open");await vi.advanceTimersByTimeAsync(1);
    page.respond(0,{sessions:memberRows,deliveries:[],topics:[topic]});await vi.advanceTimersByTimeAsync(1);
    const first=page.element("topics").children[0] as Element;first.open=true;first.children[0]?.focus();
    page.element("refresh").emit("click");await vi.advanceTimersByTimeAsync(1);
    page.respond(1,{sessions:memberRows,deliveries:[],topics:[{...topic,name:"renamed-topic"}]});await vi.advanceTimersByTimeAsync(1);
    const updated=page.element("topics").children[0] as Element;
    expect(updated.open).toBe(true);expect(page.focused()).toBe(updated.children[0]);
    page.element("refresh").emit("click");await vi.advanceTimersByTimeAsync(1);
    page.respond(2,{sessions:memberRows,deliveries:[],topics:[]});await vi.advanceTimersByTimeAsync(1);
    expect(page.focused()).toBe(page.element("topics-heading"));expect(page.element("focus-notice").textContent).toContain("no longer displayed");
  });

  it("hides ended sessions by default and prevents contradictory gone-state filtering", async () => {
    const page=dashboard();page.emit("open");await vi.advanceTimersByTimeAsync(1);
    page.respond(0,{sessions:memberRows,deliveries:[],topics:[topic]});await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions).map(row=>row[0])).toEqual(["builder@host"]);
    page.state.value="gone";page.state.emit("change");expect(page.element("session-ended").checked).toBe(true);
    expect(rowText(page.sessions).map(row=>row[0])).toEqual(["reviewer@host"]);
    page.element("session-ended").checked=false;page.element("session-ended").emit("change");
    expect(page.state.value).toBe("");expect(rowText(page.sessions).map(row=>row[0])).toEqual(["builder@host"]);
  });
});

describe("dashboard readability and announcements", () => {
  it("uses known handles for activity, announces user filters without heartbeat chatter, and guards focused Refresh", async () => {
    const page=dashboard();page.emit("open");await vi.advanceTimersByTimeAsync(1);
    const data={sessions:[{id:"recipient-id",handle:"reader@host",state:"active",host:"host"}],deliveries:[],topics:[]};
    page.respond(0,data);await vi.advanceTimersByTimeAsync(1);
    expect(page.element("announcements").textContent).toBe("Dashboard connected.");
    page.event("delivery.created",{session_id:"recipient-id",seq:1});
    expect(page.feed.textContent).toContain("Recipient reader@host");
    expect(page.element("announcements").textContent).toBe("Dashboard connected.");
    await vi.advanceTimersByTimeAsync(1);page.respond(1,data);await vi.advanceTimersByTimeAsync(1);
    page.search.value="missing";page.search.emit("input");
    expect(page.element("announcements").textContent).toBe("No sessions match these filters.");
    const button=page.element("refresh");button.focus();button.emit("click");await vi.advanceTimersByTimeAsync(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");expect(button.disabled).toBe(false);expect(page.focused()).toBe(button);
    button.emit("click");expect(page.fetch).toHaveBeenCalledTimes(3);
    page.respond(2,data);await vi.advanceTimersByTimeAsync(1);
    expect(button.getAttribute("aria-disabled")).toBe("false");expect(page.focused()).toBe(button);
    expect(page.element("announcements").textContent).toBe("Snapshot refreshed.");
  });
});

describe("dashboard QA recovery and delivery flows", () => {
  const retained = { sessions: [{ id: "retained", handle: "builder@host", state: "active", host: "host" }], deliveries: [], topics: [] };

  it("keeps a paused manual refresh failure actionable without automatic retries or loss of the last snapshot", async () => {
    const page = dashboard(); page.emit("open"); await vi.advanceTimersByTimeAsync(1);
    page.respond(0, retained); await vi.advanceTimersByTimeAsync(1);
    const lastSuccess = page.lastUpdate.dateTime;
    page.element("pause").emit("click");
    page.element("refresh").emit("click"); await vi.advanceTimersByTimeAsync(1);
    page.request(1).reject(new Error("network unavailable")); await vi.advanceTimersByTimeAsync(1);
    expect(page.error.hidden).toBe(false);
    expect(page.error.textContent).toBe("Snapshot unavailable. Updates are paused; use Refresh now to retry.");
    expect(page.element("announcements").textContent).toBe(page.error.textContent);
    expect(page.element("refresh").getAttribute("aria-disabled")).toBe("false");
    expect(rowText(page.sessions)[0]?.[0]).toBe("builder@host");
    expect(page.lastUpdate.dateTime).toBe(lastSuccess);
    page.emit("error"); page.emit("open");
    page.event("session.updated", { session_id: "retained" });
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.fetch).toHaveBeenCalledTimes(2);
    expect(page.connection.textContent).toContain("Updates paused");
    page.element("refresh").emit("click"); await vi.advanceTimersByTimeAsync(1);
    page.respond(2, empty); await vi.advanceTimersByTimeAsync(1);
    expect(page.error.hidden).toBe(true);
    expect(page.element("metric-sessions").textContent).toBe("0");
    expect(page.element("announcements").textContent).toBe("Snapshot refreshed. Updates remain paused.");
    expect(page.element("pause").getAttribute("aria-pressed")).toBe("true");
  });

  it("discards an older request failure across pause and resume before fetching current data", async () => {
    const page = dashboard(); page.emit("open"); await vi.advanceTimersByTimeAsync(1);
    page.respond(0, retained); await vi.advanceTimersByTimeAsync(1);
    page.event("session.updated", { session_id: "retained" }); await vi.advanceTimersByTimeAsync(1);
    page.element("pause").emit("click"); page.element("pause").emit("click");
    expect(page.fetch).toHaveBeenCalledTimes(2);
    page.request(1).reject(new Error("response from before pause")); await vi.advanceTimersByTimeAsync(1);
    expect(page.error.hidden).toBe(true);
    expect(rowText(page.sessions)[0]?.[0]).toBe("builder@host");
    expect(page.fetch).toHaveBeenCalledTimes(3);
    expect(page.connection.textContent).toBe("Refreshing snapshot…");
    page.respond(2, empty); await vi.advanceTimersByTimeAsync(1);
    expect(page.connection.textContent).toBe("Connected · Live updates");
    expect(page.element("metric-sessions").textContent).toBe("0");
  });

  it("can pause before the initial fetch without pretending empty data was loaded", async () => {
    const page = dashboard();
    page.element("pause").emit("click"); page.emit("open");
    await vi.advanceTimersByTimeAsync(30000);
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.lastUpdate.textContent).toBe("Not yet");
    expect(page.sessionSummary.textContent).toBe("Loading sessions…");
    expect(page.element("metric-sessions").textContent).not.toBe("0");
    page.element("refresh").emit("click"); await vi.advanceTimersByTimeAsync(1);
    page.respond(0, retained); await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions)[0]?.[0]).toBe("builder@host");
    expect(page.connection.textContent).toContain("Updates paused");
    await vi.advanceTimersByTimeAsync(30000);
    expect(page.fetch).toHaveBeenCalledTimes(1);
  });

  it("combines delivery search and receipt filters, preserves them on refresh and clears without network reads", async () => {
    const page = dashboard(); page.emit("open"); await vi.advanceTimersByTimeAsync(1);
    const deliveries = [
      { id: "a", seq: 1, sender: "builder@host", recipient: "reviewer@host", subject: "Review request", preview: "Database migration", state: "unread" },
      { id: "b", seq: 2, sender: "reviewer@host", recipient: "builder@host", subject: "Review complete", preview: "Ready to ship", state: "read" },
    ];
    page.respond(0, { ...retained, deliveries }); await vi.advanceTimersByTimeAsync(1);
    page.element("delivery-search").value = " MIGRATION "; page.element("delivery-search").emit("input");
    expect(rowText(page.deliveries).map(row => row[0])).toEqual(["1"]);
    page.element("delivery-state").value = "read"; page.element("delivery-state").emit("change");
    expect(page.deliverySummary.textContent).toBe("No deliveries match these filters.");
    expect(page.element("announcements").textContent).toBe("No deliveries match these filters.");
    expect(page.fetch).toHaveBeenCalledTimes(1);
    page.event("delivery.read", { session_id: "retained", id: "a" }); await vi.advanceTimersByTimeAsync(1);
    page.respond(1, { ...retained, deliveries: [{ ...deliveries[0], state: "read" }, deliveries[1]] }); await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.deliveries).map(row => [row[0], row[4]])).toEqual([["1", "Marked read"]]);
    expect(page.element("delivery-search").value).toBe(" MIGRATION ");
    expect(page.element("delivery-state").value).toBe("read");
    page.element("clear-delivery-filters").emit("click");
    expect(rowText(page.deliveries)).toHaveLength(2);
    expect(page.element("delivery-search").value).toBe("");
    expect(page.element("delivery-state").value).toBe("");
    expect(page.fetch).toHaveBeenCalledTimes(2);
  });
});

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
if (!script) throw new Error("dashboard script missing");

/** Only the DOM operations the dashboard uses; text never becomes executable markup. */
class Element {
  children: Element[] = [];
  textContent = "";
  hidden = false;
  value = "";
  dateTime = "";
  private listeners = new Map<string, Array<() => void>>();
  private parent: Element | undefined;
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
  set innerHTML(_value: string) { throw new Error("untrusted markup must not be parsed"); }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(); }
  appendChild(child: Element) { child.parent = this; this.children.push(child); }
  replaceChildren(...children: Element[]) {
    for (const child of this.children) child.parent = undefined;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = undefined;
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
    "#sessions tbody": sessions, "#deliveries tbody": deliveries,
    "#feed": feed, "#connection": connection, "#snapshot-error": error,
    "#last-update": lastUpdate, "#session-summary": sessionSummary, "#delivery-summary": deliverySummary,
    "#feed-summary": feedSummary, "#session-search": search, "#session-state": state,
    "#session-wake": wake, "#feed-type": feedType, "#clear-session-filters": clear,
  };
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
      createElement: () => new Element(),
    },
    EventSource, fetch, setTimeout, clearTimeout, AbortController, Date,
  });
  const emit = (type: string, data = "") => {
    for (const listener of listeners.get(type) ?? []) listener({ data });
  };
  return {
    sessions, deliveries, feed, connection, error, fetch, streamUrls, emit,
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
      this.request(index).resolve({ ok, json: async () => value });
    },
  };
}

const empty = { sessions: [], deliveries: [] };
const rowText = (element: Element) => element.children.map(row => row.children.map(cell => cell.textContent));

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
    expect(rowText(page.sessions)).toEqual([["author@mac", "claude-code", "", "idle", "off", "<img src=x onerror=alert(1)>"]]);
    expect(rowText(page.deliveries)).toEqual([
      ["1", "author@mac", "reviewer@mac", "<script>bad()</script>", "no"],
      ["2", "reviewer@mac", "author@mac", "preview & details", "yes"],
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
    for (const type of types) page.event(type, { wake: true, body: "<script>alert(1)</script>\nnext" });
    await vi.advanceTimersByTimeAsync(1);
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.feed.children.map(line => line.textContent)).toEqual(types.map(type =>
      `2026-10-25T12:34:56.000Z ${type} {"wake":true,"body":"<script>alert(1)</script>\\nnext"}`));
    for (let index = 0; index < 210; index++) page.event("board.put", { index, body: "😀".repeat(2000) });
    expect(page.feed.children).toHaveLength(200);
    expect(page.feed.children[0]?.textContent).toContain('"index":10');
    expect(Array.from(page.feed.children.at(-1)?.textContent ?? "")).toHaveLength(1035);
    expect(page.feed.children.at(-1)?.textContent.endsWith("…")).toBe(true);
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
    expect(page.connection.textContent).toBe("connected");
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
    expect(rowText(page.deliveries)[0]?.[4]).toBe("yes");
    expect(page.connection.textContent).toBe("connected");
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
    expect(page.error.textContent).toBe("Snapshot unavailable; retrying. The tables retain the last successful snapshot.");
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
    expect(page.connection.textContent).toBe("connected");
    expect(page.sessionSummary.textContent).toBe("No sessions in this snapshot.");
    expect(page.deliverySummary.textContent).toBe("No deliveries in this snapshot.");
    const lastSuccess = page.lastUpdate.textContent;
    expect(lastSuccess).toMatch(/^2026-10-25T12:00:03\./);
    expect(page.lastUpdate.dateTime).toBe(lastSuccess);
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
    expect(page.connection.textContent).toBe("connected");
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

    page.respond(1, { sessions: [{ handle: "author@mac", state: "gone", wake: "on" }], deliveries: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions)[0]?.[3]).toBe("gone");
    expect(page.connection.textContent).toBe("connected");
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
    expect(page.sessionSummary.textContent).toBe("Showing 1 of 4 sessions.");
    page.state.value = "active";
    page.state.emit("change");
    expect(page.sessionSummary.textContent).toBe("No sessions match these filters.");
    page.event("session.updated");
    await vi.advanceTimersByTimeAsync(1);
    page.respond(1, { sessions: [...rows, { handle: "new@mac", state: "active", wake: "off", project_key: "Alpha" }], deliveries: [] });
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText(page.sessions).map(cells => cells[0])).toEqual(["new@mac"]);
    page.clear.emit("click");
    expect(rowText(page.sessions)).toHaveLength(5);
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
    expect(page.feed.children).toHaveLength(0);
    page.event("delivery.read", { id: "marked" });
    expect(page.feed.children).toHaveLength(1);
    expect(page.feedSummary.textContent).toBe("Showing 1 of 2 retained live events.");
    for (let index = 0; index < 200; index++) page.event("board.put", { index });
    expect(page.feed.children).toHaveLength(0);
    page.feedType.value = "";
    page.feedType.emit("change");
    expect(page.feed.children).toHaveLength(200);
    expect(page.feed.children[0]?.textContent).toContain('"index":0');
    expect(page.feed.children.at(-1)?.textContent).toContain('"index":199');
  });
});

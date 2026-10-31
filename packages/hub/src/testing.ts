import * as z from "zod";
import { PROTOCOL_VERSION, Notifications } from "@kommutator/protocol";
import { openDatabase } from "./db.js";
import { createHubRuntime, type HubRuntimeOptions } from "./rpc.js";
import type { HubPeer } from "./context.js";

const Reply = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const DeliveryEvent = z.object({ host: z.string(), notification: Notifications.deliver });

export class RemoteRpcError extends Error {
  constructor(public readonly code: number, message: string) { super(message); this.name = "RemoteRpcError"; }
}

/** Socket-free harness; it executes the production JSON dispatcher and SQLite handlers. */
export function createConformanceHarness(options: Omit<HubRuntimeOptions, "db"> = {}) {
  const db = openDatabase(":memory:");
  const runtime = createHubRuntime({ ...options, db });
  let requestId = 0;
  const disconnects = new Set<() => void>();
  const hosts = new Map<string, () => void>();

  return {
    db,
    runtime,
    connect(host: string) {
      const peer: HubPeer = {};
      let connected = true;
      const deliveries: Array<z.output<typeof Notifications.deliver>> = [];
      function request(method: string, params: unknown = {}): unknown {
        if (!connected) throw new Error("fake agentd is disconnected");
        const id = ++requestId;
        const raw = runtime.dispatch(JSON.stringify({ jsonrpc: "2.0", id, method, params }), peer);
        if (!raw) throw new Error("missing RPC reply");
        const reply = Reply.parse(JSON.parse(raw));
        if (reply.id !== id) throw new Error("RPC correlation mismatch");
        if (reply.error) throw new RemoteRpcError(reply.error.code, reply.error.message);
        return reply.result;
      }
      request("hello", { host, agentd_version: "conformance", protocol_version: PROTOCOL_VERSION });
      const boundHost = peer.host;
      if (!boundHost) throw new Error("hello did not bind a host");
      hosts.get(boundHost)?.();
      const unsubscribe = runtime.events.subscribe((event) => {
        if (event.type !== "deliver") return;
        const data = DeliveryEvent.parse(event.data);
        if (data.host === peer.host) deliveries.push(data.notification);
      });
      const disconnect = () => {
        connected = false;
        unsubscribe();
        disconnects.delete(disconnect);
        if (hosts.get(boundHost) === disconnect) hosts.delete(boundHost);
      };
      disconnects.add(disconnect);
      hosts.set(boundHost, disconnect);
      return {
        request,
        deliveries,
        /** Explicit fixture binding, not a model of unresolved vendor identity discovery. */
        bindSession(sessionId: string) {
          return {
            request(method: string, params: Record<string, unknown> = {}): unknown {
              return request(method, { ...params, session_id: sessionId });
            },
          };
        },
        disconnect,
      };
    },
    close() {
      for (const disconnect of [...disconnects]) disconnect();
      db.close();
    },
  };
}

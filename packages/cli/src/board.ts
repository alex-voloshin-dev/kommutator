import { defineCommand } from "citty";
import { Methods, Results } from "@kommutator/protocol";
import { IpcClient, cliHello } from "./ipc-client.js";

const selection = {
  session: { type: "string", required: true, description: "exact live local session ID from kom status; never inferred" },
  topic: { type: "string", required: true, description: "topic already joined by the selected session" },
} as const;

async function readBoard(args: { session: string; topic: string; key?: string }): Promise<void> {
  const params = Methods["board.get"].parse({ session_id: args.session, topic: args.topic,
    ...(args.key === undefined ? {} : { key: args.key }) });
  const client = new IpcClient({ hello: cliHello, lazyStart: false, retries: 0, timeoutMs: 5000 });
  try {
    const result = Results["board.get"].parse(await client.call("board.get", params));
    console.log(JSON.stringify(result, null, 2));
  } finally { client.close(); }
}

export const boardCommand = defineCommand({
  meta: { name: "board", description: "read topic boards as an explicitly selected local session (JSON output)" },
  subCommands: {
    get: defineCommand({
      meta: { name: "get", description: "read one board entry; a missing key returns an empty entries array" },
      args: { ...selection, key: { type: "string", required: true, description: "exact board key, for example decisions" } } as const,
      run: async ({ args }) => readBoard({ session: args.session, topic: args.topic, key: args.key }),
    }),
    list: defineCommand({
      meta: { name: "list", description: "list current entries with bodies, ordered by key; no history or receipts" },
      args: selection,
      run: async ({ args }) => readBoard({ session: args.session, topic: args.topic }),
    }),
    revert: defineCommand({
      meta: { name: "revert", description: "deferred board mutation" },
      run: () => { throw new Error("kom board revert: deferred; see docs/MVP_PLAN.md"); },
    }),
  },
});

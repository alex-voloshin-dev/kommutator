# MCP argument reproduction evidence

Observed 2026-11-13 against source baseline `87edea4` (released version 0.13.1).
This is isolated technical evidence, not a release qualification or a live vendor result.

## Environment and method

- Runtime: Node 26.13.0, executable
  `/home/avav25/.local/share/kommutator-toolchains/node-26.13.0/bin/node`.
- Installed MCP SDK: 1.32.2; temporary source bundle compiled with esbuild 0.28.2.
  pnpm reported 12.18.0; no dependency installation was necessary.
- `createMcpServer` was imported from a temporary bundle of current source. A real SDK
  `Client` and `InMemoryTransport.createLinkedPair()` exercised discovery and tool calls.
- The injected `RpcClient` only appended `{ method, params }` to an array and returned
  `{ ok: true }`. No real IPC socket, daemon, hub, registration, vendor identity, or
  Kommutator tool was used. Probe bodies were never delivered.
- Artifacts are local, disposable files under `/tmp/kom-mcp-evidence-1DEPws/`:
  `mcp.mjs`, `probe.mjs`, `candidate.mjs`, and `candidate-probe.mjs`.
  No repository source was modified for either probe.

Run the existing artifacts with Node 26.13.0:

```sh
node /tmp/kom-mcp-evidence-1DEPws/probe.mjs
node /tmp/kom-mcp-evidence-1DEPws/candidate-probe.mjs
```

To recreate after temporary files expire: bundle `packages/cli/src/mcp.ts` with
esbuild (`bundle: true`, `platform: "node"`, `format: "esm"`, `packages: "external"`),
alias workspace imports `@kommutator/protocol`, `@kommutator/agentd`, and
`@kommutator/hub` to their `src/index.ts`, and explicitly alias
`@kommutator/protocol/hello`, `@kommutator/agentd/paths`, and
`@kommutator/agentd/process` to their corresponding source modules. Link the temporary
bundle's `node_modules` to `packages/cli/node_modules`. Instantiate the server with the
fake RPC client described above, connect the linked SDK transports, call `listTools`,
and then call each row below through `client.callTool`. Record the newly appended RPC
calls for each row and close both transports. This isolates MCP preprocessing from
identity and service behavior.

Preliminary attempts were **invalid execution evidence**: an external-workspace-import
bundle could not load the missing `packages/protocol/dist/hello.js`; inspected CLI
`dist` also contained older lifecycle code than source. An initial source-alias retry
failed because aliasing the agentd package root also incorrectly remapped its subpaths.
Explicit source aliases for all relevant subpaths resolved these failures. The successful
probes used Node 26.13.0 and current workspace source. Initial shell/default compiler
invocations used Node 24.22.3 and establish no supported-runtime result.

## Actual transport results

| Tool arguments | Result | Fake RPC observation |
| --- | --- | --- |
| `set_status({status:"x"})` | Success | `session.upsert({op:"update",session:{}})` |
| `set_status({status_line:"x",status:"y"})` | Success | `status_line` forwarded; unknown `status` discarded |
| `set_status({})` | Success | Empty session update |
| `join_topic({topic:"x"})` | Error: required `name` missing | No call |
| `join_topic({name:"x",topic:"y"})` | Success | `topic.join({name:"x"})` |
| `send({to:"x",body:"probe"})` | Error with explicit address syntax guidance | No call |
| `send({to:"topic:x",body:"probe",reply_to:"abc123"})` | Success from fake backend | `operation.submit` with unchanged `reply_to` |

Success in this table only describes the MCP/fake-backend exchange. In particular, the
last row does not show that a real hub accepts a shortened message ID.

## Cause and isolated candidate

At baseline, `packages/cli/src/mcp.ts:69` registers `inputSchema: schema.shape`.
SDK `server/mcp.js` converts that raw shape using `getZodSchemaObject`/`objectFromShape`
and parses it in `validateToolInput` before calling the handler. The reconstructed
object strips unknown fields. Consequently the handler's later strict parse cannot see
them. The existing test at `packages/cli/test/mcp.test.ts:65` explicitly expects an
unknown caller-supplied `session_id` to be stripped.

A temporary esbuild input transformation changed only registration to
`inputSchema: schema`. Through the same real SDK transport, unknown-only and mixed
unknown arguments were then rejected with no fake RPC calls; discovery advertised
`additionalProperties: false`. Empty status updates remained accepted. This verifies
the minimal mechanism, not a complete implementation: default SDK strict errors echo
unknown key names, so bounded/redacted guidance needs separate implementation and tests.

Address rejection already exists. `MessageId` is an opaque 1–64 character string
(`packages/protocol/src/schemas.ts:44`), so short IDs cannot be rejected safely by a new
length heuristic. The hub performs exact authorized parent lookup and gives identical
full-ID guidance for missing and inaccessible parents
(`packages/hub/src/routing.ts:169`, tests at `packages/hub/test/messages.test.ts:317`).
Those hub statements are source inspection, not additional runtime observations here.

## Existing automatic worker candidate

Read-only inspection of
`/home/avav25/.local/state/kommutator-maintainer/jobs/7c21416c-a4c2-4d30-8e71-df610c337bd1/1/repo`
found an uncommitted patch on the same `87edea4` baseline. It modifies `mcp.ts`, MCP
tests, DESIGN and PROTOCOL, and adds `docs/sdlc/tool-argument-guidance/` artifacts.
The patch registers a complete cloned schema with a custom `unrecognized_keys` error
listing valid parameter names, makes setup-tool schemas strict, clarifies canonical
argument names/full reply IDs, changes the stripping expectation to rejection, and adds
a 300,000-character unknown-key diagnostic-bound test. It preserves empty status updates
and omitted-wake behavior.

This is a reuse candidate for the argument-validation slice. No worker code was copied
or executed in this investigation; no review verdict, approval, test claim, or release
qualification transfers from that worker directory to this design or a future change.
Its candidate should be reviewed and independently validated in the authorized
implementation worktree, including setup-tool paths and SDK error formatting.

## Limits

No workspace build/typecheck/test suite or packaging qualification was run. No production
state changed. This evidence does not close day-long operability, subnet, reboot,
installed-vendor, delivery, or availability acceptance gates.

import { IpcError, type RpcClient, type Hello } from "./ipc-client.js";
import type { ActiveClaudeRegistration } from "./plugin-context.js";

/** A long-lived MCP process follows observed hook generations, never its stale launch ID. */
export class ClaudePluginClient implements RpcClient {
  private pinned: { generation: string; client: RpcClient } | undefined;
  constructor(private readonly options: {
    resolve: () => Promise<ActiveClaudeRegistration>;
    prepare: (hello: Hello, method: string) => Promise<void>;
    shim: (hello: Hello) => RpcClient;
    hook: (hello: Hello) => RpcClient;
  }) {}
  private async unchanged(generation: string): Promise<void> {
    if ((await this.options.resolve()).generation !== generation) throw new IpcError("Claude conversation changed during this call; inspect its outcome before retrying mutations", -32020);
  }
  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const observed = await this.options.resolve();
    await this.options.prepare(observed.hello, method);
    await this.unchanged(observed.generation);
    if (this.pinned?.generation !== observed.generation) {
      this.pinned?.client.close();
      this.pinned = { generation: observed.generation, client: this.options.shim(observed.hello) };
    }
    let client = this.pinned.client;
    if (method === "operation.status") {
      const result = await client.call(method, params);
      await this.unchanged(observed.generation);
      return result;
    }
    try { await client.call("whoami"); }
    catch (error) {
      if (!(error instanceof IpcError) || error.code !== -32020) throw error;
      await this.unchanged(observed.generation);
      const registration = this.options.hook(observed.hello);
      try { await registration.call("whoami"); } finally { registration.close(); }
      await this.unchanged(observed.generation);
      // Retirement fences existing peers. Successful hook recovery needs a new shim,
      // even when the current conversation generation itself did not change.
      if (this.pinned?.client === client) {
        client.close();
        this.pinned = { generation: observed.generation, client: this.options.shim(observed.hello) };
      }
      if (this.pinned?.generation !== observed.generation) throw new IpcError("Claude conversation changed during recovery; call again for the current conversation", -32020);
      client = this.pinned.client;
    }
    await this.unchanged(observed.generation);
    const result = await client.call(method, params);
    await this.unchanged(observed.generation);
    return result;
  }
  close(): void { this.pinned?.client.close(); this.pinned = undefined; }
}

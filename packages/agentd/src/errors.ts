export class RpcError extends Error {
  constructor(public readonly code: number, message: string) { super(message); this.name = "RpcError"; }
}
export class OfflineError extends Error {
  constructor(message = "hub is unavailable") { super(message); this.name = "OfflineError"; }
}

export class DaemonStoppingError extends RpcError {
  constructor() { super(-32031, "Daemon is stopping; reconnect after it restarts."); }
}

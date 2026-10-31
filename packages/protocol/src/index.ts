// kommutator protocol — shared between the shim, agentd and the hub.
// See docs/PROTOCOL.md for the human-readable index.

export const PROTOCOL_VERSION = 1;

export * from "./ident.js";
export * from "./address.js";
export * from "./schemas.js";
export * from "./headers.js";
export * from "./results.js";
export { RELEASE_VERSION } from "./release.js";

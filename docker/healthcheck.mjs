import { readKey } from "./secret.mjs";

try {
  const response = await fetch(`http://127.0.0.1:${process.env.KOM_HUB_PORT ?? 8787}/api/snapshot`, {
    headers: { authorization: `Bearer ${readKey()}` },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("Unhealthy hub");
  await response.body?.cancel();
} catch {
  // Never put credentials or request headers into Docker health logs.
  process.exitCode = 1;
}

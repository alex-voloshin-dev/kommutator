/** Own asynchronous startup before the test can fail or its cleanup can begin. */
export function ownedStartup<T extends { close: () => Promise<void> }>(
  start: () => Promise<T>,
  cleanups: Array<() => Promise<void>>,
): Promise<T> {
  let cleanupStarted = false;
  let closing: Promise<void> | undefined;
  const pending = Promise.resolve().then(start);
  const close = (resource: T) => closing ??= Promise.resolve().then(() => resource.close());
  cleanups.push(async () => {
    cleanupStarted = true;
    let resource: T;
    try { resource = await pending; }
    catch { return; } // The startup caller retains the original rejection.
    await close(resource);
  });
  return pending.then(async (resource) => {
    if (cleanupStarted) {
      await close(resource);
      throw new Error("fixture cleanup began before startup completed");
    }
    return resource;
  });
}

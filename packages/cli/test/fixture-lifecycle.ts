/** Preserve the original assertion/operation failure even when teardown also fails. */
export async function withCleanup(body: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
  const failures: unknown[] = [];
  try { await body(); } catch (error) { failures.push(error); }
  try { await cleanup(); } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Fixture body failed; cleanup also failed (body error first)");
}

export async function phase<T>(label: string, run: () => Promise<T>, timeoutMs?: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await (timeoutMs === undefined ? run() : Promise.race([run(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("fixture phase deadline exceeded")), timeoutMs);
    })]));
  } catch (cause) { throw new Error(`Fixture phase: ${label}`, { cause }); }
  finally { clearTimeout(timer); }
}

export function matchesFixtureDaemon(command: string, environment: string, executable: string, entry: string, home: string): boolean {
  return command === [executable, entry, "daemon", "run", ""].join("\0") &&
    environment.split("\0").includes(`KOM_HOME=${home}`);
}

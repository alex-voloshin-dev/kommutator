// Synthetic process fixture only: leave the diagnostic slot truncated until the real hook deadline.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const home = process.env.KOM_HOME;
if (!home || dirname(home) !== tmpdir() || !basename(home).startsWith('kom-hook-ipc-') ||
    process.argv.slice(2).join(' ') !== 'hook Stop --vendor codex') throw new Error('fixture home required');
const original = fs.promises.open;
fs.promises.open = async function(path, flags, ...args) {
  const file = await original.call(this, path, flags, ...args);
  if (typeof path === 'string' && dirname(path) === join(home, 'hook-observations') && /^\d+\.json$/.test(basename(path)) && typeof flags === 'number' && (flags & fs.constants.O_TRUNC)) {
    file.writeFile = async () => {
      process.stderr.write('[fixture-observation-write-stalled]\n');
      await new Promise(() => {});
    };
  }
  return file;
};
syncBuiltinESMExports();

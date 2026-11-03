#!/usr/bin/env node
// Manual maintenance only; never loaded by the hub, daemon or client plugin.
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cleanupTestData } from './lib/test-data-cleanup.mjs';

try {
  process.umask(0o077);
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') { if (options.apply) throw new Error('duplicate flag'); options.apply = true; }
    else if (flag === '--hub-stopped') { if (options.hubStopped) throw new Error('duplicate flag'); options.hubStopped = true; }
    else {
      const key = { '--db': 'database', '--manifest': 'manifestPath', '--backup': 'backupPath' }[flag];
      if (!key || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('invalid arguments');
      options[key] = resolve(args[++i]);
    }
  }
  if (!options.database || !options.manifestPath) throw new Error('provide --db and --manifest');
  const info = await lstat(options.manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 2_000_000) throw new Error('private bounded manifest required');
  options.manifest = JSON.parse(await readFile(options.manifestPath, 'utf8'));
  console.log(JSON.stringify(await cleanupTestData(options), null, 2));
} catch (error) {
  // JSON parsing errors may contain private manifest text. Expose only our bounded messages.
  console.error(error instanceof SyntaxError ? 'Invalid cleanup manifest JSON.' : `Cleanup refused: ${error.message}`);
  process.exitCode = 1;
}

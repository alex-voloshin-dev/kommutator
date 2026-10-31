import { openSync, closeSync, fstatSync, readFileSync, constants } from "node:fs";

export function readKey() {
  const path = process.env.KOM_KEY_FILE ?? "/run/secrets/hub_key";
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > 4096) throw new Error("Invalid hub key file");
    const key = readFileSync(fd, "utf8").trim();
    if (key.length < 16 || /[\r\n\0]/.test(key)) throw new Error("Invalid hub key file");
    return key;
  } finally {
    closeSync(fd);
  }
}

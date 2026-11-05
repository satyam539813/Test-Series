import { cp, mkdir, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const out = join(root, "dist");

if (!existsSync(src)) {
  console.error("Missing src directory");
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true });

async function count(dir) {
  let n = 0;
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) n += await count(full);
    else n += 1;
  }
  return n;
}

console.log(`Built ${await count(out)} static files into dist/`);

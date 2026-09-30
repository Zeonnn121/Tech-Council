import { mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Placeholder build step.
 *
 * The real frontend (a React app built by the teammate) will replace this with
 * Vite/`npm run build`. For now we only need to produce a valid `dist/` so that
 * deploy/build-and-upload.ps1 can tar it and Express can serve it in production.
 *
 * Copies:
 *   index.html      -> dist/index.html
 *   public/**       -> dist/**   (static assets, referenced by absolute path)
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) {
      copyDir(from, to);
    } else {
      copyFileSync(from, to);
    }
  }
}

mkdirSync(dist, { recursive: true });
copyFileSync(join(root, "index.html"), join(dist, "index.html"));
copyDir(join(root, "public"), dist);

console.log(`[build] placeholder frontend written to ${dist}`);

#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const output = path.join(root, "dist");
const rootFiles = fs
  .readdirSync(root)
  .filter((file) => file.endsWith(".html") || ["robots.txt", "sitemap.xml", "_headers", "_redirects"].includes(file));

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of rootFiles) {
  fs.copyFileSync(path.join(root, file), path.join(output, file));
}

fs.cpSync(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });

console.log(`Built ${rootFiles.length} root assets plus /assets into ${output}`);

#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith(".html"));
const failures = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function hasTarget(anchor, currentFile) {
  if (!anchor || !anchor.includes("#")) return true;
  const [file, id] = anchor.split("#");
  const targetFile = file || currentFile;
  if (!targetFile.endsWith(".html") || !fs.existsSync(path.join(root, targetFile))) return true;
  const html = read(targetFile);
  return new RegExp(`id=["']${id}["']`, "i").test(html);
}

htmlFiles.forEach((file) => {
  const html = read(file);

  if (!/<a class="skip-link" href="#main-content">/i.test(html)) {
    failures.push(`${file}: missing skip link`);
  }

  if (!/<main[^>]+id="main-content"/i.test(html)) {
    failures.push(`${file}: missing main-content landmark`);
  }

  if (!/rel="canonical"/i.test(html)) {
    failures.push(`${file}: missing canonical link`);
  }

  if (!/<meta\s+[^>]*name=["']description["']/i.test(html)) {
    failures.push(`${file}: missing meta description`);
  }

  if (/contact\.html#audit-form/i.test(html)) {
    failures.push(`${file}: stale #audit-form link`);
  }

  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => match[1]);
  links.forEach((href) => {
    if (!href.startsWith("http") && !href.startsWith("mailto:") && !href.startsWith("tel:") && !hasTarget(href, file)) {
      failures.push(`${file}: broken same-site anchor ${href}`);
    }
  });
});

["robots.txt", "sitemap.xml", "netlify.toml"].forEach((file) => {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`${file}: missing required deploy asset`);
  }
});

if (failures.length) {
  console.error("Site check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Site check passed.");

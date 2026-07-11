#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith(".html")).sort();
const failures = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function localTarget(href, currentFile) {
  const [rawPath, fragment = ""] = href.split("#", 2);
  const cleanPath = rawPath.split("?")[0];
  if (!cleanPath) return { file: currentFile, fragment };

  let target = cleanPath;
  if (target === "/") target = "index.html";
  if (target.startsWith("/")) target = target.slice(1);
  if (!path.extname(target) && !target.endsWith("/")) target = `${target}.html`;
  return { file: target, fragment };
}

function validateLocalReference(href, currentFile, kind) {
  if (!href || /^(https?:|mailto:|tel:|data:)/i.test(href)) return;
  const target = localTarget(href, currentFile);
  const absolute = path.join(root, target.file);
  if (!fs.existsSync(absolute)) {
    failures.push(`${currentFile}: missing ${kind} target ${href}`);
    return;
  }
  if (target.fragment && target.file.endsWith(".html")) {
    const targetHtml = read(target.file);
    if (!new RegExp(`\\bid=["']${escapeRegExp(target.fragment)}["']`, "i").test(targetHtml)) {
      failures.push(`${currentFile}: missing fragment target ${href}`);
    }
  }
}

for (const file of htmlFiles) {
  const html = read(file);
  if (!/<a class="skip-link" href="#main-content">/i.test(html)) failures.push(`${file}: missing skip link`);
  if (!/<main[^>]+id="main-content"/i.test(html)) failures.push(`${file}: missing main-content landmark`);
  if (!/rel="canonical"/i.test(html)) failures.push(`${file}: missing canonical link`);
  if (!/<meta\s+[^>]*name=["']description["']/i.test(html)) failures.push(`${file}: missing meta description`);
  if ((html.match(/<h1\b/gi) || []).length !== 1) failures.push(`${file}: expected exactly one h1`);

  const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1].trim() || "";
  const description = /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i.exec(html)?.[1].trim() || "";
  if (!title || title.length > 60) failures.push(`${file}: title must be present and no longer than 60 characters`);
  if (!description || description.length > 160) failures.push(`${file}: meta description must be present and no longer than 160 characters`);

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const id of new Set(ids)) {
    if (ids.filter((candidate) => candidate === id).length > 1) failures.push(`${file}: duplicate id ${id}`);
  }

  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    validateLocalReference(match[1], file, "link");
  }

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    const src = /\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1] || "";
    const alt = /\balt=["']([^"']*)["']/i.exec(attrs)?.[1];
    if (alt == null || !alt.trim()) failures.push(`${file}: image missing meaningful alt text (${src || "unknown src"})`);
    validateLocalReference(src, file, "image");
  }

  for (const match of html.matchAll(/<a\b([^>]*)target=["']_blank["']([^>]*)>/gi)) {
    const attrs = `${match[1]} ${match[2]}`;
    const rel = /\brel=["']([^"']+)["']/i.exec(attrs)?.[1] || "";
    if (!/\bnoopener\b/.test(rel) || !/\bnoreferrer\b/.test(rel)) failures.push(`${file}: target=_blank link missing noopener noreferrer`);
  }

  if (/hello@arroyomarketing\.co\b/i.test(html)) failures.push(`${file}: stale .co contact address`);
  if (/calendly\.com\/carson-elevatemarketing/i.test(html)) failures.push(`${file}: stale Elevate Marketing Calendly URL`);
  if (/Client quote slot/i.test(html)) failures.push(`${file}: placeholder testimonial copy remains`);
}

const contact = read("contact.html");
if (!/data-lead-endpoint="\/api\/lead"/.test(contact)) failures.push("contact.html: lead endpoint must be /api/lead");
if (/<input[^>]+name="website-url"[^>]+required/i.test(contact)) failures.push("contact.html: website URL must remain optional");
if (!/href="privacy\.html"/.test(contact) || !/href="terms\.html"/.test(contact)) failures.push("contact.html: form must link privacy and terms");
if (/book a time/i.test(contact)) failures.push("contact.html: stale booking CTA remains");
if (/instant snapshot/i.test(contact)) failures.push("contact.html: social metadata must not promise an instant audit");
if (/submitted=1/i.test(contact)) failures.push("contact.html: query-string success state can bypass durable-delivery confirmation");

for (const [field, maximum] of Object.entries({ name: 100, "business-name": 150, email: 254, phone: 40, "website-url": 2048, "help-needed": 4000 })) {
  const fieldPattern = new RegExp(`<(?:input|textarea)[^>]+name=["']${escapeRegExp(field)}["'][^>]+maxlength=["']${maximum}["']`, "i");
  if (!fieldPattern.test(contact)) failures.push(`contact.html: ${field} must declare maxlength=${maximum}`);
}

const styles = read("assets/css/styles.css");
if (!/\.audit-results-shell\[hidden\]\s*\{\s*display:\s*none;/i.test(styles)) failures.push("styles.css: hidden audit results must stay hidden");

const clientScript = read("assets/js/script.js");
if (!/result\.ok\s*!==\s*true/.test(clientScript) || !/isCloudflare\s*=\s*result\.platform\s*===\s*["']cloudflare["']/.test(clientScript)) {
  failures.push("script.js: lead success must require an explicit API success flag and Cloudflare response");
}
if (!/durablePrimary\s*=\s*result\.delivery\?\.owner\s*===\s*["']sent["']\s*\|\|\s*result\.storage\?\.sheet\s*===\s*["']saved["']/.test(clientScript)) {
  failures.push("script.js: lead success must verify a durable owner-facing sink");
}
if (!/event\.preventDefault\(\);\s*resetPreviousResult\(\);/.test(clientScript)) failures.push("script.js: every submission must clear stale success state first");
if (/params\.get\(["']submitted["']\)/.test(clientScript)) failures.push("script.js: query-string success state must not bypass persistence");
if (!/function\s+safeSubmissionError\(error\)/.test(clientScript) || !/Number\.isInteger\(error\?\.statusCode\)/.test(clientScript) || !/=\s*safeSubmissionError\(error\)/.test(clientScript)) {
  failures.push("script.js: network failures must use a public-safe fallback instead of exposing raw browser errors");
}
if (/error\.message\s*\|\|\s*["']Submission failed/.test(clientScript) || !/We couldn't send your request right now\./.test(clientScript)) {
  failures.push("script.js: form error copy must stay actionable and must not expose raw fetch errors");
}

const notFound = read("404.html");
if (!/<meta\s+name="robots"\s+content="noindex,follow"/i.test(notFound)) failures.push("404.html: missing noindex directive");

const requiredAssets = [
  "robots.txt",
  "sitemap.xml",
  "wrangler.jsonc",
  "_headers",
  "_redirects",
  ".env.example",
  "functions/api/lead.js",
  "lib/lead-handler.mjs"
];
for (const file of requiredAssets) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`${file}: missing required launch asset`);
}

const sitemap = read("sitemap.xml");
for (const route of ["privacy.html", "terms.html"]) {
  if (!sitemap.includes(`https://arroyomarketing.com/${route}`)) failures.push(`sitemap.xml: missing ${route}`);
}

const redirects = read("_redirects");
if (/^\S+\s+\S+\.html\s+200\s*$/m.test(redirects)) {
  failures.push("_redirects: HTML rewrites conflict with Cloudflare Pages clean-URL handling");
}

try {
  const wranglerConfig = JSON.parse(read("wrangler.jsonc"));
  if (wranglerConfig.name !== "arroyo-marketing") failures.push("wrangler.jsonc: project name must remain arroyo-marketing");
  if (wranglerConfig.pages_build_output_dir !== "./dist") failures.push("wrangler.jsonc: Pages output directory must be ./dist");
  if (wranglerConfig.compatibility_date !== "2026-07-11") failures.push("wrangler.jsonc: compatibility date must be 2026-07-11");
  if (!wranglerConfig.compatibility_flags?.includes("nodejs_compat")) failures.push("wrangler.jsonc: nodejs_compat must be enabled");
} catch {
  failures.push("wrangler.jsonc: configuration must be valid JSONC without syntax errors");
}

const envExample = read(".env.example");
if (/carson\.elevatemarketing@gmail\.com/i.test(envExample)) failures.push(".env.example: personal email fallback is not allowed");

if (failures.length) {
  console.error("Site check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Site check passed across ${htmlFiles.length} HTML routes.`);

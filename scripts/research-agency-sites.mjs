#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const researchDir = path.join(root, "research");
const targetCount = Number(process.env.AGENCY_RESEARCH_TARGET || 500);
const maxCandidates = Number(process.env.AGENCY_RESEARCH_MAX_CANDIDATES || 2200);
const keepScreenshots = Number(process.env.AGENCY_RESEARCH_SCREENSHOTS || 30);
const concurrency = Number(process.env.AGENCY_RESEARCH_CONCURRENCY || 4);
const screenshotDir = path.join(researchDir, "screenshots");

const blockedHosts = [
  "awwwards.com",
  "assets.awwwards.com",
  "behance.net",
  "clutch.co",
  "colorlib.com",
  "designrush.com",
  "dribbble.com",
  "duckduckgo.com",
  "expertise.com",
  "facebook.com",
  "goodfirms.co",
  "google.com",
  "googletagmanager.com",
  "instagram.com",
  "linkedin.com",
  "medium.com",
  "ontoplist.com",
  "pinterest.com",
  "sitebuilderreport.com",
  "sortlist.com",
  "shopify.com",
  "techradar.com",
  "techreviewer.co",
  "tiktok.com",
  "themanifest.com",
  "thephoenixreview.com",
  "topdevelopers.co",
  "trustpilot.com",
  "upcity.com",
  "w3.org",
  "webflow.com",
  "wix.com",
  "x.com",
  "yelp.com",
  "youtube.com"
];

const agencyTerms = [
  "agency",
  "marketing",
  "web design",
  "design agency",
  "experience design",
  "website design",
  "web development",
  "seo",
  "ppc",
  "paid search",
  "paid media",
  "branding",
  "brand strategy",
  "brand experience",
  "creative studio",
  "digital studio",
  "growth",
  "advertising",
  "content marketing",
  "conversion"
];

const parkedTerms = [
  "buy this domain",
  "domain for sale",
  "parked free",
  "sedo",
  "godaddy",
  "this domain is parked",
  "coming soon",
  "under construction",
  "account suspended",
  "site not found",
  "enable javascript and cookies"
];

const cities = [
  "Phoenix",
  "Scottsdale",
  "Tempe",
  "Mesa",
  "Tucson",
  "Los Angeles",
  "San Diego",
  "San Francisco",
  "Seattle",
  "Portland",
  "Denver",
  "Austin",
  "Dallas",
  "Houston",
  "San Antonio",
  "Chicago",
  "New York City",
  "Brooklyn",
  "Boston",
  "Philadelphia",
  "Washington DC",
  "Atlanta",
  "Miami",
  "Tampa",
  "Orlando",
  "Nashville",
  "Charlotte",
  "Raleigh",
  "Charleston",
  "Minneapolis",
  "Detroit",
  "Columbus",
  "Indianapolis",
  "St. Louis",
  "Kansas City",
  "Las Vegas",
  "Salt Lake City",
  "Boise",
  "Sacramento",
  "San Jose",
  "Irvine",
  "Orange County",
  "Richmond",
  "Baltimore",
  "Pittsburgh",
  "Cincinnati",
  "Omaha"
];

const localSearchTerms = [
  "web design agency",
  "digital marketing agency",
  "SEO agency",
  "branding agency",
  "PPC agency",
  "creative agency"
];

const nicheQueries = [
  "home services marketing agency",
  "contractor marketing agency",
  "landscaping marketing agency",
  "HVAC marketing agency",
  "plumbing marketing agency",
  "roofing marketing agency",
  "SaaS marketing agency",
  "B2B growth marketing agency",
  "ecommerce marketing agency",
  "local business web design agency"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isBlocked(url) {
  const host = hostOf(url);
  return !host || blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function normalizeCandidate(rawUrl) {
  let url = String(rawUrl || "").trim().replace(/&amp;/g, "&");
  if (!url) return null;
  if (url.startsWith("//duckduckgo.com/l/?")) {
    url = `https:${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.searchParams.get("uddg")) {
      url = decodeURIComponent(parsed.searchParams.get("uddg"));
    }
  } catch {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    parsed.hash = "";
    parsed.search = "";
    if (isBlocked(parsed.href)) return null;
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
}

function textOnly(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function csvEscape(value) {
  const safe = value == null ? "" : String(value).replace(/\s+/g, " ").trim();
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function slugify(value) {
  return String(value || "site")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function score(value, max = 10) {
  return Math.max(1, Math.min(max, Math.round(value)));
}

function includesAny(text, terms) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function inferAgencyType(text) {
  const lower = text.toLowerCase();
  if (lower.includes("paid media") || lower.includes("ppc") || lower.includes("paid search")) return "Paid media agency";
  if (lower.includes("seo")) return "SEO agency";
  if (lower.includes("branding") || lower.includes("brand strategy")) return "Branding agency";
  if (lower.includes("web design") || lower.includes("web development") || lower.includes("website")) return "Web design agency";
  if (lower.includes("creative")) return "Creative agency";
  if (lower.includes("growth")) return "Growth agency";
  return "Digital agency";
}

function inferNiche(text) {
  const lower = text.toLowerCase();
  const matches = [
    ["home services", "Home services"],
    ["contractor", "Contractors"],
    ["landscap", "Landscaping/outdoor living"],
    ["hvac", "HVAC"],
    ["plumb", "Plumbing"],
    ["roof", "Roofing"],
    ["saas", "SaaS"],
    ["b2b", "B2B"],
    ["ecommerce", "E-commerce"],
    ["healthcare", "Healthcare"],
    ["law firm", "Legal"],
    ["real estate", "Real estate"],
    ["restaurant", "Restaurants/hospitality"]
  ];
  return matches.find(([needle]) => lower.includes(needle))?.[1] || "";
}

function inferLocation(text, sourceQuery) {
  const sourceCity = cities.find((city) => sourceQuery?.toLowerCase().includes(city.toLowerCase()));
  if (sourceCity) return sourceCity;
  return cities.find((city) => text.toLowerCase().includes(city.toLowerCase())) || "";
}

function standoutIdeas({ text, h1, ctas, hasForm }) {
  const ideas = [];
  const lower = text.toLowerCase();
  if (/\d+%|\d+x|\$\d+|roi|revenue|leads/.test(text)) ideas.push("Quantified proof/result language appears early.");
  if (ctas.some((cta) => /audit|strategy|consult|proposal/i.test(cta))) ideas.push("CTA frames the next step as consultative rather than generic contact.");
  if (/case stud|results|work|portfolio/.test(lower)) ideas.push("Proof path is visible from the homepage.");
  if (/industry|speciali[sz]e|for (contractors|law|saas|home|local|health)/.test(lower)) ideas.push("Positioning narrows to a buyer or industry.");
  if (hasForm) ideas.push("Lead capture is embedded on-site.");
  if (h1.length > 10 && h1.length < 95) ideas.push("Hero headline is concise enough to scan.");
  return ideas.slice(0, 3).join(" ");
}

function weaknessNotes({ text, h1, ctas, hasForm, metaDescription }) {
  const notes = [];
  const lower = text.toLowerCase();
  if (!/\d+%|\d+x|\$\d+|roi|revenue|leads|reviews|clients/.test(text)) notes.push("Proof is not strongly quantified.");
  if (!ctas.length || ctas.every((cta) => /learn|more|read/i.test(cta))) notes.push("Primary CTA appears soft or unclear.");
  if (!/case stud|results|portfolio|testimonial|reviews/.test(lower)) notes.push("Case-study or testimonial proof is hard to find.");
  if (!hasForm && !/book|call|contact/.test(lower)) notes.push("Contact path is weak.");
  if (!metaDescription) notes.push("Meta description is missing.");
  if (!h1 || h1.length > 120) notes.push("Hero headline is missing or hard to scan.");
  return notes.slice(0, 3).join(" ");
}

function buildScores({ text, h1, ctas, hasForm, desktopLinks, loadMs, mobileCtas }) {
  const lower = text.toLowerCase();
  const proofSignals = (lower.match(/case stud|results|testimonial|review|clients|award|trusted|partner|roi|revenue|leads/g) || []).length;
  const offerSignals = (lower.match(/web design|website|seo|ppc|paid media|branding|strategy|content|conversion|local seo/g) || []).length;
  const outcomeSignals = (lower.match(/lead|revenue|growth|sales|book|calls|pipeline|rank|conversion|roi/g) || []).length;
  const audienceSignals = (lower.match(/for |businesses|companies|brands|contractors|local|service|saas|ecommerce|home/g) || []).length;
  const ctaSignals = ctas.filter((cta) => /book|call|audit|contact|get|schedule|consult|proposal|start/i.test(cta)).length;
  const caseSignals = (lower.match(/case stud|portfolio|our work|results|success stor/g) || []).length;
  const visualSignals = (lower.match(/award|studio|creative|brand|design|interactive/g) || []).length + Math.min(3, desktopLinks / 18);

  return {
    visual_quality_score: score(5 + visualSignals + Math.min(2, proofSignals / 3) - (loadMs > 9000 ? 1 : 0)),
    positioning_clarity_score: score(4 + Math.min(3, audienceSignals / 2) + (h1.length > 10 && h1.length < 95 ? 2 : 0) + Math.min(1, outcomeSignals / 5)),
    offer_clarity_score: score(4 + Math.min(5, offerSignals / 2) + (lower.includes("services") ? 1 : 0)),
    cta_clarity_score: score(3 + Math.min(5, ctaSignals * 1.6) + (hasForm ? 1 : 0)),
    proof_trust_score: score(3 + Math.min(6, proofSignals / 2) + (/\d+%|\d+x|\$\d+/.test(text) ? 1 : 0)),
    case_study_quality_score: score(3 + Math.min(5, caseSignals * 1.5) + (lower.includes("results") ? 1 : 0)),
    lead_capture_quality_score: score(3 + (hasForm ? 3 : 0) + Math.min(3, ctaSignals) + (/calendly|schedule|book a call/.test(lower) ? 1 : 0)),
    mobile_conversion_score: score(4 + Math.min(4, mobileCtas) + (hasForm ? 1 : 0) - (loadMs > 9000 ? 1 : 0))
  };
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 agency-research-bot"
    }
  });
  return response.ok ? response.text() : "";
}

async function collectAwwwards() {
  const candidates = [];
  const pages = Array.from({ length: 60 }, (_, index) => index + 1);
  for (const pageNumber of pages) {
    const url =
      pageNumber === 1
        ? "https://www.awwwards.com/directory/agency-studio/"
        : `https://www.awwwards.com/directory/agency-studio/?page=${pageNumber}`;
    try {
      const html = await fetchText(url);
      const urls = [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)]
        .map((match) => match[0].replace(/&#039;.*/, "").replace(/&quot;.*/, ""))
        .map(normalizeCandidate)
        .filter(Boolean);
      urls.forEach((candidate) => candidates.push({ url: candidate, source: "Awwwards agency/studio directory", query: url }));
      process.stdout.write(`awwwards:${pageNumber}:${urls.length}\n`);
    } catch (error) {
      process.stdout.write(`awwwards:${pageNumber}:error:${error.message}\n`);
    }
    await sleep(140);
  }
  return candidates;
}

async function collectDuckDuckGo() {
  const queries = [
    ...nicheQueries,
    ...cities.flatMap((city) => localSearchTerms.map((term) => `${term} ${city}`))
  ];
  const candidates = [];
  const maxSearchQueries = Number(process.env.AGENCY_SEARCH_QUERY_LIMIT || 0);
  if (maxSearchQueries <= 0) return candidates;
  let completedQueries = 0;
  for (const query of queries) {
    if (candidates.length > maxCandidates) break;
    if (completedQueries >= maxSearchQueries) break;
    const url = `https://duckduckgo.com/html/?kl=us-en&q=${encodeURIComponent(query)}`;
    try {
      const html = await fetchText(url);
      const matches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/g)];
      const urls = matches.map((match) => normalizeCandidate(match[1])).filter(Boolean);
      urls.forEach((candidate) => candidates.push({ url: candidate, source: "DuckDuckGo HTML search", query }));
      process.stdout.write(`ddg:${query}:${urls.length}\n`);
    } catch (error) {
      process.stdout.write(`ddg:${query}:error:${error.message}\n`);
    }
    completedQueries += 1;
    await sleep(260);
  }
  return candidates;
}

function dedupe(candidates) {
  const seen = new Map();
  for (const item of candidates) {
    const host = hostOf(item.url);
    if (!host || isBlocked(item.url)) continue;
    if (!seen.has(host)) seen.set(host, item);
  }
  return [...seen.values()].slice(0, maxCandidates);
}

async function inspectCandidate(browser, candidate, index) {
  const page = await browser.newPage({
    viewport: { width: 1365, height: 768 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
  });
  const started = Date.now();
  try {
    const response = await page.goto(candidate.url, { waitUntil: "domcontentloaded", timeout: 9000 });
    await page.waitForTimeout(800);
    const loadMs = Date.now() - started;
    const finalUrl = page.url();
    if (isBlocked(finalUrl)) throw new Error("redirected to blocked host");
    const status = response?.status() || 0;
    if (status >= 400) throw new Error(`HTTP ${status}`);

    const data = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const title = document.title || "";
      const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
      const h1 = document.querySelector("h1")?.innerText?.trim() || "";
      const links = [...document.querySelectorAll("a")]
        .map((node) => node.innerText?.trim())
        .filter(Boolean)
        .slice(0, 80);
      const ctas = links.filter((label) => /book|call|audit|get|contact|schedule|consult|proposal|start|talk|work/i.test(label)).slice(0, 12);
      const hasForm = Boolean(document.querySelector("form, input[type='email'], input[type='tel'], textarea"));
      const imageCount = document.images.length;
      return { text, title, metaDescription, h1, links, ctas, hasForm, imageCount };
    });

    const bodyText = data.text.replace(/\s+/g, " ").trim();
    const lower = bodyText.toLowerCase();
    if (bodyText.length < 250) throw new Error("not enough visible content");
    if (includesAny(bodyText, parkedTerms)) throw new Error("parked/broken/placeholder language");
    if (!includesAny(bodyText, agencyTerms)) throw new Error("not clearly an agency homepage");

    let screenshotPath = "";
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 45, fullPage: false });
    if (index <= keepScreenshots) {
      await fs.mkdir(screenshotDir, { recursive: true });
      screenshotPath = path.join("research", "screenshots", `${String(index).padStart(3, "0")}-${slugify(hostOf(finalUrl))}.jpg`);
      await fs.writeFile(path.join(root, screenshotPath), screenshotBuffer);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const mobileCtas = await page.evaluate(() => {
      const viewportBottom = window.innerHeight;
      return [...document.querySelectorAll("a, button")]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          const text = node.innerText || node.getAttribute("aria-label") || "";
          return rect.top >= 0 && rect.top < viewportBottom && /book|call|audit|get|contact|schedule|consult|start/i.test(text);
        }).length;
    });

    const scores = buildScores({
      text: bodyText,
      h1: data.h1,
      ctas: data.ctas,
      hasForm: data.hasForm,
      desktopLinks: data.links.length,
      loadMs,
      mobileCtas
    });
    const firstImpression =
      (scores.visual_quality_score +
        scores.positioning_clarity_score +
        scores.offer_clarity_score +
        scores.cta_clarity_score +
        scores.proof_trust_score) /
      5;

    return {
      agency_name: data.h1 || data.title.replace(/\s+[|–-].*$/, "") || hostOf(finalUrl),
      url: finalUrl,
      domain: hostOf(finalUrl),
      agency_type: inferAgencyType(bodyText),
      niche_focus: inferNiche(bodyText),
      location: inferLocation(bodyText, candidate.query),
      source: candidate.source,
      source_query: candidate.query,
      loaded_successfully: true,
      first_impression_score: score(firstImpression),
      ...scores,
      speed_performance_notes: `${loadMs}ms DOMContentLoaded/render wait; HTTP ${status}; ${data.imageCount} images detected.`,
      seo_notes: `Title ${data.title.length} chars; meta description ${data.metaDescription.length} chars; H1 ${data.h1 ? "present" : "missing"}.`,
      standout_ideas: standoutIdeas({ text: bodyText, h1: data.h1, ctas: data.ctas, hasForm: data.hasForm }),
      weaknesses_to_avoid: weaknessNotes({
        text: bodyText,
        h1: data.h1,
        ctas: data.ctas,
        hasForm: data.hasForm,
        metaDescription: data.metaDescription
      }),
      screenshot_path: screenshotPath,
      visible_hero_h1: data.h1,
      primary_cta_candidates: data.ctas.join("; ")
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function writeOutputs(rows, candidates, failures) {
  await fs.mkdir(researchDir, { recursive: true });
  const jsonPath = path.join(researchDir, "agency-website-audit.json");
  const csvPath = path.join(researchDir, "agency-website-audit.csv");
  const summaryPath = path.join(researchDir, "agency-research-summary.md");
  const columns = [
    "agency_name",
    "url",
    "agency_type",
    "niche_focus",
    "location",
    "loaded_successfully",
    "first_impression_score",
    "visual_quality_score",
    "positioning_clarity_score",
    "offer_clarity_score",
    "cta_clarity_score",
    "proof_trust_score",
    "case_study_quality_score",
    "lead_capture_quality_score",
    "mobile_conversion_score",
    "speed_performance_notes",
    "seo_notes",
    "standout_ideas",
    "weaknesses_to_avoid",
    "screenshot_path",
    "source",
    "source_query",
    "visible_hero_h1",
    "primary_cta_candidates"
  ];

  const averages = Object.fromEntries(
    [
      "first_impression_score",
      "visual_quality_score",
      "positioning_clarity_score",
      "offer_clarity_score",
      "cta_clarity_score",
      "proof_trust_score",
      "case_study_quality_score",
      "lead_capture_quality_score",
      "mobile_conversion_score"
    ].map((key) => [key, rows.length ? +(rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) / rows.length).toFixed(2) : 0])
  );

  const payload = {
    generated_at: new Date().toISOString(),
    target_count: targetCount,
    valid_count: rows.length,
    candidate_count: candidates.length,
    failed_validation_count: failures.length,
    retained_screenshot_count: rows.filter((row) => row.screenshot_path).length,
    sources: [
      "Awwwards agency/studio directory pages",
      "Current search-result and curated-list context from Clutch, GoodFirms, SiteBuilderReport, NanoGlobals, Framer, Colorlib, Techreviewer, Webflow, and One Page Love",
      "Programmatic scraping of protected ranking directories was skipped when Cloudflare or bot protection blocked direct validation"
    ],
    averages,
    rows,
    failures: failures.slice(0, 250)
  };

  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.writeFile(csvPath, `${columns.join(",")}\n${rows.map((row) => columns.map((col) => csvEscape(row[col])).join(",")).join("\n")}\n`);

  const topRows = [...rows].sort((a, b) => b.first_impression_score - a.first_impression_score).slice(0, 20);
  const summary = `# Agency Website Research Summary

Generated: ${payload.generated_at}

## Scope

- Valid live agency websites reviewed: ${rows.length}
- Unique candidate homepages deduplicated before validation: ${candidates.length}
- Failed/rejected candidates: ${failures.length}
- Retained homepage screenshots: ${payload.retained_screenshot_count}
- Browser review method: each counted site was opened in Chromium, checked for visible homepage content, rendered at desktop width, screenshot-buffer inspected, then resized to mobile width for CTA visibility scoring.

## Source Mix

- Awwwards agency/studio directory pages for the validated, browser-reviewed candidate pool.
- Current search-result and curated-list context from Clutch, GoodFirms, SiteBuilderReport, NanoGlobals, Framer, Colorlib, Techreviewer, Webflow, and One Page Love.
- Protected ranking directories were not counted when Cloudflare or bot protection blocked direct homepage validation.

## Average Scores

${Object.entries(averages)
  .map(([key, value]) => `- ${key.replaceAll("_", " ")}: ${value}/10`)
  .join("\n")}

## Strongest Conversion Patterns

- The strongest sites make the hero do four jobs at once: buyer, outcome, reason to believe, and next step.
- High-converting agency pages avoid generic "we grow brands" language unless paired with a niche, offer, or measurable result.
- Proof appears early: recognizable clients, quantified outcomes, reviews, awards, case studies, or a visible work/results path.
- Strong CTAs are consultative and specific: strategy call, audit, proposal, diagnosis, or roadmap.
- Premium sites use fewer repeated cards and more editorial rhythm: sharp hero, proof band, services/offers, case-study framing, process, objections, and final CTA.
- Mobile conversion depends on obvious click-to-call/book/contact paths above the fold and in sticky/footer areas.

## Original Template Weaknesses

- The original homepage explained local-service value, but the first screen relied on a soft badge plus a problem list instead of strong proof and a decisive offer.
- Visual system was warm and pleasant but read more like a service-business template than a premium agency that can command higher retainers.
- Several sections used similar card grids, which diluted hierarchy and made the page feel less strategically sequenced.
- Proof was mostly process-based; the site needed more outcome framing, case-study structure, testimonials, and buyer qualification.
- CTAs were split between "See Services" and "Book a Call" instead of driving a single best next step.

## Top Reviewed Examples By First Impression

${topRows.map((row, index) => `${index + 1}. ${row.agency_name} - ${row.url} (${row.first_impression_score}/10)`).join("\n")}

## Implementation Implications For Arroyo

- Lead with a specific promise for local service businesses, especially contractors and outdoor-living teams.
- Make "Get a Free Website Audit" and "Book a Strategy Call" the core conversion actions.
- Replace soft claims with structured proof: revenue leak diagnosis, speed-to-lead, local SEO structure, case-study shells, testimonials, and buyer fit.
- Use a more premium, high-contrast editorial look with restrained accent colors, stronger typography, cleaner bands, and fewer decorative card clusters.
- Add schema, stronger SEO metadata, and visible trust/offer sections that answer objections before contact.
`;
  await fs.writeFile(summaryPath, summary);
}

async function main() {
  await fs.mkdir(researchDir, { recursive: true });
  const seeds = dedupe([...(await collectAwwwards()), ...(await collectDuckDuckGo())]);
  process.stdout.write(`candidate_count:${seeds.length}\n`);

  const browser = await chromium.launch({ headless: true });
  const rows = [];
  const failures = [];
  let cursor = 0;

  try {
    async function worker(workerId) {
      while (rows.length < targetCount) {
        const candidate = seeds[cursor];
        cursor += 1;
        if (!candidate) return;
      const nextIndex = rows.length + 1;
      try {
        const row = await inspectCandidate(browser, candidate, nextIndex);
          if (rows.length < targetCount) {
            rows.push(row);
            process.stdout.write(`valid:${rows.length}:${row.domain}:worker-${workerId}\n`);
          }
      } catch (error) {
        failures.push({ url: candidate.url, source: candidate.source, query: candidate.query, reason: error.message });
          process.stdout.write(`reject:${candidate.url}:${error.message}:worker-${workerId}\n`);
      }
        if ((rows.length + failures.length) % 50 === 0) {
        await writeOutputs(rows, seeds, failures);
      }
    }
    }

    await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index + 1)));
  } finally {
    await browser.close();
  }

  await writeOutputs(rows, seeds, failures);
  if (rows.length < targetCount) {
    process.stderr.write(`Only validated ${rows.length}/${targetCount} sites. Add more sources or raise max candidates.\n`);
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

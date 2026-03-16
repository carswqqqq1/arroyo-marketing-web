const SHEET_RANGE = "Leads!A:V";
const AUDIT_TIMEOUT_MS = 9000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeWebsiteUrl(input) {
  const trimmed = clean(input);
  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  return url.toString();
}

function extractFirst(text, pattern) {
  const match = text.match(pattern);
  return match ? clean(match[1].replace(/\s+/g, " ")) : "";
}

function stripHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text) {
  return stripHtml(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

function summarizeFlags(flags) {
  return flags.filter(Boolean).slice(0, 4).join(" | ");
}

async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || "",
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error("Failed to refresh Google access token");
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Google access token missing");
  }

  return payload.access_token;
}

async function fetchSiteHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "ArroyoMarketingAuditBot/1.0 (+https://arroyomarketing.com)"
      }
    });

    const html = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
      html
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildAuditFromHtml(url, html, status) {
  const title = extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription =
    extractFirst(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ||
    extractFirst(html, /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const imagesWithAlt = imgTags.filter((tag) => /\balt\s*=\s*(["']).*?\1/i.test(tag)).length;
  const altCoverage = imgTags.length ? imagesWithAlt / imgTags.length : 1;
  const ctaMatches = html.match(/(call now|book a call|get started|request a quote|free audit|contact us|schedule|book now|request estimate|learn more)/gi) || [];
  const buttonCount = (html.match(/<button\b/gi) || []).length + ctaMatches.length;
  const contactPath = /(href\s*=\s*["'][^"']*(contact|quote|estimate|book|schedule|tel:|mailto:)[^"']*["'])/i.test(html);
  const textWordCount = wordCount(html);
  const usesHttps = /^https:/i.test(url);

  let score = 0;
  const strengths = [];
  const quickWins = [];
  const positives = [];
  const negatives = [];

  score += status >= 200 && status < 400 ? 6 : 0;
  if (title) {
    score += title.length >= 20 && title.length <= 70 ? 14 : 8;
    positives.push("page title is present");
    if (title.length < 20 || title.length > 70) {
      quickWins.push("Tighten the page title so it reads clearly in search results.");
    } else {
      strengths.push("The page title is present and roughly search-result friendly.");
    }
  } else {
    negatives.push("missing page title");
    quickWins.push("Add a clear page title focused on the service and location.");
  }

  if (metaDescription) {
    score += metaDescription.length >= 70 && metaDescription.length <= 165 ? 14 : 8;
    positives.push("meta description exists");
    if (metaDescription.length < 70 || metaDescription.length > 165) {
      quickWins.push("Rewrite the meta description so the offer is clearer and fits search snippets.");
    } else {
      strengths.push("A meta description is already in place for search previews.");
    }
  } else {
    negatives.push("missing meta description");
    quickWins.push("Add a meta description so search visitors see a stronger reason to click.");
  }

  if (viewport) {
    score += 10;
    strengths.push("The page includes a mobile viewport tag.");
  } else {
    negatives.push("no mobile viewport");
    quickWins.push("Add a viewport meta tag so the site renders properly on phones.");
  }

  if (h1Count === 1) {
    score += 12;
    strengths.push("The page uses a single H1, which is usually the right content structure.");
  } else if (h1Count > 1) {
    score += 6;
    negatives.push("multiple H1 tags");
    quickWins.push("Reduce the page to one primary H1 so the message hierarchy is clearer.");
  } else {
    negatives.push("missing H1");
    quickWins.push("Add one strong H1 that explains what the business does and who it helps.");
  }

  if (buttonCount >= 2) {
    score += 15;
    strengths.push("There are visible CTA signals on the page already.");
  } else if (buttonCount === 1) {
    score += 8;
    negatives.push("light CTA presence");
    quickWins.push("Add a clearer primary CTA near the top of the page and repeat it lower down.");
  } else {
    negatives.push("weak CTA structure");
    quickWins.push("Give visitors a clear next action like call, quote request, or booking.");
  }

  if (contactPath) {
    score += 10;
    strengths.push("Visitors appear to have a visible contact path.");
  } else {
    negatives.push("contact path is hard to spot");
    quickWins.push("Make the contact path more obvious with a persistent button, phone link, or form.");
  }

  if (imgTags.length === 0 || altCoverage >= 0.8) {
    score += 12;
    strengths.push("Image accessibility basics look solid from the homepage scan.");
  } else if (altCoverage >= 0.5) {
    score += 6;
    negatives.push("partial alt text coverage");
    quickWins.push("Add alt text to the remaining images so the site is easier to parse and more accessible.");
  } else {
    negatives.push("weak alt text coverage");
    quickWins.push("Most images are missing alt text. Add descriptive alt copy where images matter.");
  }

  if (textWordCount >= 250) {
    score += 9;
    strengths.push("The page has enough text to explain the offer, which helps trust and search context.");
  } else if (textWordCount >= 120) {
    score += 4;
    negatives.push("content depth is light");
    quickWins.push("Add more specific copy about services, proof, and what happens next.");
  } else {
    negatives.push("very thin content");
    quickWins.push("The page needs more useful copy so visitors understand the offer quickly.");
  }

  if (usesHttps) {
    score += 10;
    strengths.push("The site is loading over HTTPS.");
  } else {
    negatives.push("not using HTTPS");
    quickWins.push("Serve the site over HTTPS so visitors and browsers trust it.");
  }

  score = Math.max(12, Math.min(100, Math.round(score)));

  let headline = "The site needs stronger conversion fundamentals.";
  if (score >= 82) {
    headline = "Strong base. A few smart changes could lift lead flow quickly.";
  } else if (score >= 65) {
    headline = "Solid starting point, but there are clear conversion gaps to tighten.";
  } else if (score >= 45) {
    headline = "The site is usable, but trust and conversion signals are uneven.";
  }

  const summaryParts = [];
  if (positives.length) {
    summaryParts.push(`We found a workable base: ${summarizeFlags(positives)}.`);
  }
  if (negatives.length) {
    summaryParts.push(`The main gaps are ${summarizeFlags(negatives)}.`);
  }
  if (textWordCount) {
    summaryParts.push(`The scanned page had about ${textWordCount} visible words.`);
  }

  return {
    siteUrl: url,
    score,
    headline,
    summary: summaryParts.join(" "),
    strengths: strengths.slice(0, 4),
    quickWins: quickWins.slice(0, 4)
  };
}

async function generateAudit(websiteUrl) {
  const normalizedUrl = normalizeWebsiteUrl(websiteUrl);
  const snapshot = await fetchSiteHtml(normalizedUrl);
  const audit = buildAuditFromHtml(snapshot.finalUrl, snapshot.html, snapshot.status);
  return audit;
}

function buildFallbackAudit(websiteUrl) {
  const safeUrl = clean(websiteUrl);
  return {
    siteUrl: safeUrl,
    score: 18,
    headline: "We saved the inquiry, but the automated scan could not fully read the site.",
    summary:
      "That usually means the site blocked the request, timed out, or the URL needs a quick review. We still captured the lead and can audit it manually.",
    strengths: ["The inquiry and website URL were captured successfully."],
    quickWins: [
      "Double-check that the website URL is correct and publicly reachable.",
      "Make sure the site homepage loads without redirects or access restrictions.",
      "We can still do a manual review if the automated scan is blocked."
    ]
  };
}

function buildOwnerEmail(payload, audit) {
  return {
    subject: `New website audit lead: ${payload.businessName}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#101828;line-height:1.5;max-width:640px;margin:0 auto;padding:24px;">
        <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#8a6b42;margin:0 0 12px;">Arroyo Marketing Lead Alert</p>
        <h1 style="font-size:28px;line-height:1.15;margin:0 0 16px;">${escapeHtml(payload.businessName)} requested a free website audit.</h1>
        <p style="margin:0 0 18px;">Lead came in from ${escapeHtml(payload.sourcePage || "/contact.html")}.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px;">
          <tr><td style="padding:8px 0;font-weight:700;">Name</td><td style="padding:8px 0;">${escapeHtml(payload.name)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Business</td><td style="padding:8px 0;">${escapeHtml(payload.businessName)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Email</td><td style="padding:8px 0;">${escapeHtml(payload.email)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Phone</td><td style="padding:8px 0;">${escapeHtml(payload.phone)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Website</td><td style="padding:8px 0;">${escapeHtml(payload.websiteUrl)}</td></tr>
        </table>
        <p style="font-weight:700;margin:0 0 6px;">Need described</p>
        <p style="margin:0 0 18px;">${escapeHtml(payload.helpNeeded)}</p>
        <div style="border:1px solid #d9d9e3;border-radius:18px;padding:18px;background:#f8f9fc;margin:0 0 18px;">
          <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#8a6b42;margin:0 0 8px;">Instant Audit</p>
          <p style="font-size:36px;font-weight:800;margin:0 0 6px;">${escapeHtml(audit.score)} / 100</p>
          <p style="font-weight:700;margin:0 0 8px;">${escapeHtml(audit.headline)}</p>
          <p style="margin:0 0 10px;">${escapeHtml(audit.summary)}</p>
          <p style="font-weight:700;margin:0 0 6px;">Quick wins</p>
          <ul style="margin:0;padding-left:20px;">
            ${audit.quickWins.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
      </div>
    `,
    text: [
      `New website audit lead: ${payload.businessName}`,
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Phone: ${payload.phone}`,
      `Website: ${payload.websiteUrl}`,
      `Need: ${payload.helpNeeded}`,
      `Audit score: ${audit.score}/100`,
      `Headline: ${audit.headline}`,
      `Summary: ${audit.summary}`,
      `Quick wins: ${audit.quickWins.join(" | ")}`
    ].join("\n")
  };
}

function buildClientEmail(payload, audit) {
  return {
    subject: `Your Arroyo Marketing website audit snapshot`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#101828;line-height:1.5;max-width:640px;margin:0 auto;padding:24px;">
        <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#8a6b42;margin:0 0 12px;">Arroyo Marketing</p>
        <h1 style="font-size:28px;line-height:1.15;margin:0 0 16px;">Your audit request is in.</h1>
        <p style="margin:0 0 16px;">We generated a quick automated snapshot for ${escapeHtml(payload.websiteUrl)} so you have something useful right away.</p>
        <div style="border-radius:20px;padding:20px;background:linear-gradient(135deg,#121826,#1d2740);color:#f8fbff;margin:0 0 18px;">
          <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#d1b48b;margin:0 0 8px;">Instant Snapshot</p>
          <p style="font-size:42px;font-weight:800;margin:0 0 6px;">${escapeHtml(audit.score)} / 100</p>
          <p style="font-weight:700;margin:0 0 8px;color:#f8fbff;">${escapeHtml(audit.headline)}</p>
          <p style="margin:0;color:#d7def0;">${escapeHtml(audit.summary)}</p>
        </div>
        <p style="font-weight:700;margin:0 0 6px;">What looked solid</p>
        <ul style="margin:0 0 16px;padding-left:20px;">
          ${audit.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        <p style="font-weight:700;margin:0 0 6px;">Fastest next improvements</p>
        <ul style="margin:0 0 20px;padding-left:20px;">
          ${audit.quickWins.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        <p style="margin:0 0 16px;">If you want to walk through it live, reply to this email or book here:</p>
        <p style="margin:0;"><a href="https://calendly.com/carson-elevatemarketing/new-meeting">https://calendly.com/carson-elevatemarketing/new-meeting</a></p>
      </div>
    `,
    text: [
      "Your audit request is in.",
      `Website: ${payload.websiteUrl}`,
      `Audit score: ${audit.score}/100`,
      `Headline: ${audit.headline}`,
      `Summary: ${audit.summary}`,
      `What looked solid: ${audit.strengths.join(" | ")}`,
      `Fastest next improvements: ${audit.quickWins.join(" | ")}`,
      "Book a call: https://calendly.com/carson-elevatemarketing/new-meeting"
    ].join("\n")
  };
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const from = clean(process.env.FROM_EMAIL);

  if (!apiKey || !from || !clean(to)) {
    return "not_configured";
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      reply_to: clean(process.env.OWNER_EMAIL) || "carson.elevatemarketing@gmail.com"
    })
  });

  if (!response.ok) {
    return "failed";
  }

  return "sent";
}

async function appendLeadRow(accessToken, sheetId, row) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(SHEET_RANGE)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        values: [row]
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets append failed: ${text}`);
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const requiredFields = ["name", "business-name", "email", "phone", "help-needed", "website-url"];
    const missing = requiredFields.filter((field) => !clean(body[field]));
    if (missing.length) {
      return json(400, { ok: false, error: "missing_required_fields", fields: missing });
    }

    if (clean(body["company-website"])) {
      return json(200, { ok: true, skipped: true });
    }

    const payload = {
      name: clean(body.name),
      businessName: clean(body["business-name"]),
      email: clean(body.email),
      phone: clean(body.phone),
      websiteUrl: clean(body["website-url"]),
      helpNeeded: clean(body["help-needed"]),
      sourcePage: clean(body.source_page),
      currentPath: clean(body.current_path),
      utmSource: clean(body.utm_source),
      utmMedium: clean(body.utm_medium),
      utmCampaign: clean(body.utm_campaign),
      utmTerm: clean(body.utm_term),
      utmContent: clean(body.utm_content)
    };

    let audit;
    try {
      audit = await generateAudit(payload.websiteUrl);
    } catch (error) {
      console.error("audit_generation_failed", {
        websiteUrl: payload.websiteUrl,
        message: error && error.message ? error.message : "unknown_error"
      });
      audit = buildFallbackAudit(payload.websiteUrl);
    }

    const ownerEmail = clean(process.env.OWNER_EMAIL) || "carson.elevatemarketing@gmail.com";
    const ownerStatus = await sendEmail({
      to: ownerEmail,
      ...buildOwnerEmail(payload, audit)
    });
    const clientStatus = await sendEmail({
      to: payload.email,
      ...buildClientEmail(payload, audit)
    });

    const row = [
      new Date().toISOString(),
      payload.name,
      payload.businessName,
      payload.email,
      payload.phone,
      payload.websiteUrl,
      payload.helpNeeded,
      payload.sourcePage,
      payload.currentPath,
      payload.utmSource,
      payload.utmMedium,
      payload.utmCampaign,
      payload.utmTerm,
      payload.utmContent,
      audit.score,
      audit.headline,
      audit.summary,
      audit.strengths.join(" | "),
      audit.quickWins.join(" | "),
      ownerStatus,
      clientStatus,
      "New"
    ];

    let sheetStatus = "not_configured";
    const sheetId = clean(process.env.GOOGLE_SHEET_ID);
    if (sheetId) {
      try {
        const accessToken = await getAccessToken();
        await appendLeadRow(accessToken, sheetId, row);
        sheetStatus = "saved";
      } catch (error) {
        console.error("sheet_sync_failed", {
          message: error && error.message ? error.message : "unknown_error"
        });
        sheetStatus = "failed";
      }
    }

    return json(200, {
      ok: true,
      audit,
      delivery: {
        owner: ownerStatus,
        client: clientStatus
      },
      storage: {
        sheet: sheetStatus
      }
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: "submission_failed"
    });
  }
};

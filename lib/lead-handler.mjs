export const MAX_BODY_BYTES = 32 * 1024;
const EXTERNAL_TIMEOUT_MS = 8000;
const SHEET_TIMEOUT_MS = 15000;
const TURNSTILE_ACTION = "arroyo-contact";
const AGENCY_LOGO_URL = "https://arroyomarketing.com/assets/images/logos/arroyo-logo-light-bg.png";

const disposableDomains = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "10minutemail.com",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com"
]);

const fieldLimits = {
  name: 100,
  "business-name": 150,
  email: 254,
  phone: 40,
  "website-url": 2048,
  "help-needed": 4000,
  source_page: 500,
  current_path: 800,
  utm_source: 200,
  utm_medium: 200,
  utm_campaign: 200,
  utm_term: 200,
  utm_content: 200,
  submission_id: 100,
  "cf-turnstile-response": 2048,
  "company-website": 200
};

function clean(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function requestId(uuid) {
  return `lead_${uuid}`;
}

async function readJsonBody(request) {
  const contentType = request.headers.get("content-type") || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  const isJson = mediaType === "application/json" || (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
  if (!isJson) {
    return { error: jsonResponse(415, { ok: false, error: "unsupported_media_type", message: "Send the request as JSON." }) };
  }

  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { error: jsonResponse(413, { ok: false, error: "payload_too_large", message: "The request is too large." }) };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return { error: jsonResponse(400, { ok: false, error: "invalid_json", message: "The request body is not valid JSON." }) };
  }

  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { error: jsonResponse(413, { ok: false, error: "payload_too_large", message: "The request is too large." }) };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    const body = JSON.parse(text || "{}");
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("invalid_body");
    return { body };
  } catch {
    return { error: jsonResponse(400, { ok: false, error: "invalid_json", message: "The request body is not valid JSON." }) };
  }
}

function validateEmailAddress(email) {
  const normalized = clean(email).toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailPattern.test(normalized) || normalized.includes("..")) {
    return { ok: false, reason: "Enter a valid email address." };
  }
  if (disposableDomains.has(normalized.split("@")[1] || "")) {
    return { ok: false, reason: "Use an inbox you actually check." };
  }
  return { ok: true };
}

function validatePhoneNumber(phone) {
  return clean(phone).replace(/\D/g, "").length >= 10;
}

function normalizeWebsiteUrl(value) {
  const input = clean(value);
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid_url");
    return url.toString();
  } catch {
    throw new Error("Enter a valid public website URL or leave the field blank.");
  }
}

export function normalizePayload(body) {
  const values = {};
  for (const [field, limit] of Object.entries(fieldLimits)) {
    values[field] = clean(body[field]);
    if (values[field].length > limit) {
      return { error: { status: 400, body: { ok: false, error: "field_too_long", field, message: `${field} is too long.` } } };
    }
  }

  if (values["company-website"]) return { skipped: true };

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(values.submission_id)) {
    return { error: { status: 400, body: { ok: false, error: "invalid_submission_id", message: "Refresh the page and try the form again." } } };
  }

  const requiredFields = ["name", "business-name", "email", "phone", "help-needed"];
  const missing = requiredFields.filter((field) => !values[field]);
  if (missing.length) {
    return { error: { status: 400, body: { ok: false, error: "missing_required_fields", fields: missing, message: "Fill in the required fields so Arroyo can respond." } } };
  }

  const emailValidation = validateEmailAddress(values.email);
  if (!emailValidation.ok) {
    return { error: { status: 400, body: { ok: false, error: "invalid_email", message: emailValidation.reason } } };
  }

  if (!validatePhoneNumber(values.phone)) {
    return { error: { status: 400, body: { ok: false, error: "invalid_phone", message: "Enter a valid phone number." } } };
  }

  try {
    values["website-url"] = normalizeWebsiteUrl(values["website-url"]);
  } catch (error) {
    return { error: { status: 400, body: { ok: false, error: "invalid_website", message: error.message } } };
  }

  return {
    payload: {
      name: values.name,
      businessName: values["business-name"],
      email: values.email.toLowerCase(),
      phone: values.phone,
      websiteUrl: values["website-url"],
      helpNeeded: values["help-needed"],
      sourcePage: values.source_page,
      currentPath: values.current_path,
      utmSource: values.utm_source,
      utmMedium: values.utm_medium,
      utmCampaign: values.utm_campaign,
      utmTerm: values.utm_term,
      utmContent: values.utm_content,
      submissionId: values.submission_id.toLowerCase(),
      turnstileToken: values["cf-turnstile-response"]
    }
  };
}

export function sheetSafeCell(value) {
  const text = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function buildOwnerEmail(payload) {
  const websiteRow = payload.websiteUrl
    ? `<tr><td style="padding:8px 0;font-weight:700;">Website</td><td style="padding:8px 0;"><a href="${escapeHtml(payload.websiteUrl)}">${escapeHtml(payload.websiteUrl)}</a></td></tr>`
    : "";
  const phoneHref = clean(payload.phone).replace(/[^\d+]/g, "");
  return {
    subject: `New Arroyo inquiry: ${payload.businessName}`,
    replyTo: payload.email,
    html: `
      <div style="font-family:Arial,sans-serif;color:#101828;line-height:1.5;max-width:640px;margin:0 auto;padding:24px;">
        <img src="${AGENCY_LOGO_URL}" alt="Arroyo Marketing" width="150" height="66" style="display:block;width:150px;height:auto;max-width:100%;margin:0 0 18px;" />
        <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#7a4b20;margin:0 0 12px;">Arroyo Marketing Lead Alert</p>
        <h1 style="font-size:28px;line-height:1.15;margin:0 0 16px;">${escapeHtml(payload.businessName)} sent a project inquiry.</h1>
        <p style="margin:0 0 18px;">Source: ${escapeHtml(payload.sourcePage || "/contact.html")}</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px;">
          <tr><td style="padding:8px 0;font-weight:700;">Name</td><td style="padding:8px 0;">${escapeHtml(payload.name)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Business</td><td style="padding:8px 0;">${escapeHtml(payload.businessName)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Email</td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(payload.email)}">${escapeHtml(payload.email)}</a></td></tr>
          <tr><td style="padding:8px 0;font-weight:700;">Phone</td><td style="padding:8px 0;"><a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(payload.phone)}</a></td></tr>
          ${websiteRow}
        </table>
        <p style="font-weight:700;margin:0 0 6px;">What they need</p>
        <p style="margin:0;">${escapeHtml(payload.helpNeeded)}</p>
      </div>`,
    text: [
      `New Arroyo inquiry: ${payload.businessName}`,
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Phone: ${payload.phone}`,
      payload.websiteUrl ? `Website: ${payload.websiteUrl}` : "Website: not provided",
      `Need: ${payload.helpNeeded}`
    ].join("\n")
  };
}

function buildClientEmail(payload) {
  return {
    subject: "Arroyo Marketing received your request",
    replyTo: "contact@arroyomarketing.com",
    html: `
      <div style="font-family:Arial,sans-serif;color:#101828;line-height:1.5;max-width:640px;margin:0 auto;padding:24px;">
        <img src="${AGENCY_LOGO_URL}" alt="Arroyo Marketing" width="150" height="66" style="display:block;width:150px;height:auto;max-width:100%;margin:0 0 18px;" />
        <p style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#7a4b20;margin:0 0 12px;">Arroyo Marketing</p>
        <h1 style="font-size:28px;line-height:1.15;margin:0 0 16px;">Your request is safely received.</h1>
        <div style="border-radius:20px;padding:20px;background-color:#11151c;background:linear-gradient(135deg,#11151c,#233047);color:#f8fbff;margin:0 0 18px;">
          <p style="font-weight:700;margin:0 0 8px;color:#f8fbff;">What happens next</p>
          <p style="margin:0;color:#d7def0;">We will review the details you shared and reply with the clearest next step. No automated score or result is a promise of future performance.</p>
        </div>
        <p style="margin:0 0 16px;">You can add context or ask a question by replying directly to this email.</p>
        <p style="margin:0;"><a href="https://arroyomarketing.com/contact.html#contact-form">Contact Arroyo Marketing</a></p>
      </div>`,
    text: [
      "Your Arroyo Marketing request is safely received.",
      "We will review what you shared and reply with the clearest next step.",
      "No automated score or result is a promise of future performance.",
      "Contact: https://arroyomarketing.com/contact.html#contact-form"
    ].join("\n")
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs = EXTERNAL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout(fetchImpl, url, options, timeoutMs = EXTERNAL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const body = response.ok ? await response.json() : null;
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyTurnstile({ env, fetchImpl, request, token, verificationKey, logger }) {
  const secret = clean(env.TURNSTILE_SECRET_KEY);
  if (!secret) {
    return { ok: false, status: 503, error: "turnstile_not_configured", message: "Lead protection is temporarily unavailable. Please call or email Arroyo instead." };
  }
  if (!clean(token)) {
    return { ok: false, status: 403, error: "turnstile_required", message: "Complete the security check and try again." };
  }

  try {
    const { response, body } = await fetchJsonWithTimeout(fetchImpl, "https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: clean(token),
        remoteip: clean(request.headers.get("CF-Connecting-IP")),
        idempotency_key: verificationKey
      })
    });
    const expectedHostname = new URL(request.url).hostname.toLowerCase();
    const verifiedHostname = clean(body?.hostname).toLowerCase();
    if (response.ok && body?.success === true && body?.action === TURNSTILE_ACTION && verifiedHostname === expectedHostname) {
      return { ok: true };
    }
    logger.warn({ code: "turnstile_failed", status: response.status, errors: Array.isArray(body?.["error-codes"]) ? body["error-codes"].slice(0, 4) : [] });
    return { ok: false, status: 403, error: "turnstile_failed", message: "The security check expired or could not be verified. Please try again." };
  } catch (error) {
    logger.error({ code: "turnstile_failed", message: error?.name === "AbortError" ? "timeout" : "request_failed" });
    return { ok: false, status: 503, error: "turnstile_unavailable", message: "The security check is temporarily unavailable. Please try again shortly." };
  }
}

async function sendEmail({ env, fetchImpl, to, email, logger, kind, submissionId }) {
  const apiKey = clean(env.RESEND_API_KEY);
  const from = clean(env.FROM_EMAIL);
  if (!apiKey || !from || !clean(to)) return "not_configured";

  try {
    const response = await fetchWithTimeout(fetchImpl, "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `arroyo-${kind}/${submissionId}`
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        reply_to: email.replyTo
      })
    });
    if (response.ok) return "sent";
    logger.error({ code: `${kind}_email_failed`, status: response.status });
    return "failed";
  } catch (error) {
    logger.error({ code: `${kind}_email_failed`, message: error?.name === "AbortError" ? "timeout" : "request_failed" });
    return "failed";
  }
}

function buildLeadRow(payload, timestamp) {
  const notes = [
    `Business: ${payload.businessName}`,
    `Website: ${payload.websiteUrl || "Not provided"}`,
    `Need: ${payload.helpNeeded}`
  ].join("\n");
  const row = {
    timestamp,
    status: "New",
    ticket_id: payload.submissionId,
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    service: "Marketing inquiry",
    next_action: "Review inquiry",
    notes,
    lead_tags: "arroyo-marketing",
    lead_source: "website",
    page_url: payload.sourcePage,
    landing_path: payload.currentPath,
    utm_source: payload.utmSource,
    utm_medium: payload.utmMedium,
    utm_campaign: payload.utmCampaign,
    utm_content: payload.utmContent,
    business_name: payload.businessName,
    website_url: payload.websiteUrl,
    help_needed: payload.helpNeeded,
    utm_term: payload.utmTerm
  };
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sheetSafeCell(value)]));
}

async function appendLeadRow({ env, fetchImpl, row, logger }) {
  const endpoint = clean(env.GOOGLE_SHEETS_WEBHOOK_URL);
  const secret = clean(env.GOOGLE_SHEETS_WEBHOOK_SECRET);
  if (!endpoint || !secret) return "not_configured";

  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
    if (parsedEndpoint.protocol !== "https:") throw new Error("invalid_protocol");
  } catch {
    logger.error({ code: "sheet_sync_failed", message: "invalid_webhook_url" });
    return "failed";
  }

  try {
    const { response, body } = await fetchJsonWithTimeout(fetchImpl, parsedEndpoint.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": secret
      },
      body: JSON.stringify({
        source: "arroyo-marketing-lead",
        secret,
        row
      })
    }, SHEET_TIMEOUT_MS);
    if (response.ok && body?.ok === true) return "saved";
    logger.error({ code: "sheet_sync_failed", status: response.status });
    return "failed";
  } catch (error) {
    logger.error({ code: "sheet_sync_failed", message: error?.name === "AbortError" ? "timeout" : "request_failed" });
    return "failed";
  }
}

export async function handleLeadRequest({
  request,
  env = {},
  platform = "unknown",
  fetchImpl = fetch,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  logger = console
}) {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
  }

  const verificationKey = randomUUID();
  const id = requestId(verificationKey);
  const parsed = await readJsonBody(request);
  if (parsed.error) return parsed.error;

  const normalized = normalizePayload(parsed.body);
  if (normalized.skipped) return jsonResponse(200, { ok: true, skipped: true, requestId: id, platform });
  if (normalized.error) return jsonResponse(normalized.error.status, { ...normalized.error.body, requestId: id });

  const payload = normalized.payload;
  const turnstile = await verifyTurnstile({
    env,
    fetchImpl,
    request,
    token: payload.turnstileToken,
    verificationKey,
    logger
  });
  if (!turnstile.ok) {
    return jsonResponse(turnstile.status, {
      ok: false,
      error: turnstile.error,
      message: turnstile.message,
      requestId: id,
      platform
    });
  }
  const ownerEmail = clean(env.OWNER_EMAIL) || "contact@arroyomarketing.com";
  const ownerStatusPromise = sendEmail({
    env,
    fetchImpl,
    to: ownerEmail,
    email: buildOwnerEmail(payload),
    logger,
    kind: "owner",
    submissionId: payload.submissionId
  });

  const timestamp = new Date(now()).toISOString();
  const sheetStatusPromise = appendLeadRow({
    env,
    fetchImpl,
    row: buildLeadRow(payload, timestamp),
    logger
  });
  const [ownerStatus, sheetStatus] = await Promise.all([ownerStatusPromise, sheetStatusPromise]);

  if (ownerStatus !== "sent" && sheetStatus !== "saved") {
    return jsonResponse(503, {
      ok: false,
      error: "lead_not_persisted",
      message: "We could not safely save your request. Please call or email contact@arroyomarketing.com instead.",
      requestId: id,
      platform
    });
  }

  const clientStatus = await sendEmail({
    env,
    fetchImpl,
    to: payload.email,
    email: buildClientEmail(payload),
    logger,
    kind: "client",
    submissionId: payload.submissionId
  });

  return jsonResponse(200, {
    ok: true,
    requestId: id,
    platform,
    message: "Your request was safely received. Arroyo will review it and reply with the clearest next step.",
    delivery: { owner: ownerStatus, client: clientStatus },
    storage: { sheet: sheetStatus },
    review: { status: "queued", websiteProvided: Boolean(payload.websiteUrl) }
  });
}

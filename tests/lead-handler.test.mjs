import test from "node:test";
import assert from "node:assert/strict";
import { handleLeadRequest, MAX_BODY_BYTES, sheetSafeCell } from "../lib/lead-handler.mjs";
import { onRequest, onRequestPost } from "../functions/api/lead.js";

function validBody(overrides = {}) {
  return {
    name: "Jamie Rivera",
    "business-name": "Desert Stoneworks",
    email: "jamie@example.com",
    phone: "480-555-0100",
    "website-url": "",
    "help-needed": "We need a clearer service path.",
    source_page: "/contact.html",
    current_path: "/contact.html",
    submission_id: "11111111-1111-4111-8111-111111111111",
    "cf-turnstile-response": "test-turnstile-token",
    "company-website": "",
    ...overrides
  };
}

function request(body, headers = {}) {
  return new Request("https://arroyomarketing.com/api/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function response(ok, status = ok ? 200 : 500, json = {}) {
  return {
    ok,
    status,
    async json() {
      return json;
    }
  };
}

const quietLogger = { error() {}, warn() {}, log() {} };
const turnstileEnv = { TURNSTILE_SECRET_KEY: "test-turnstile-secret" };

function turnstileSuccess() {
  return response(true, 200, {
    success: true,
    action: "arroyo-contact",
    hostname: "arroyomarketing.com"
  });
}

test("fails closed when no durable owner sink succeeds", async () => {
  const result = await handleLeadRequest({
    request: request(validBody()),
    env: turnstileEnv,
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      return turnstileSuccess();
    },
    randomUUID: () => "no-sink",
    logger: quietLogger
  });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "lead_not_persisted");
});

test("does not acknowledge the client when the configured owner sink fails", async () => {
  const calls = [];
  const result = await handleLeadRequest({
    request: request(validBody()),
    env: {
      ...turnstileEnv,
      OWNER_EMAIL: "contact@arroyomarketing.com",
      FROM_EMAIL: "Arroyo Marketing <leads@arroyomarketing.com>",
      RESEND_API_KEY: "test-key"
    },
    fetchImpl: async (url, options) => {
      if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return turnstileSuccess();
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return response(false, 503);
    },
    randomUUID: () => "failed-owner",
    logger: quietLogger
  });

  assert.equal(result.status, 503);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.to, ["contact@arroyomarketing.com"]);
});

test("accepts an optional website and never fetches the submitted URL", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return turnstileSuccess();
    calls.push({ url: String(url), body: JSON.parse(options.body), headers: options.headers });
    return response(true);
  };
  const result = await handleLeadRequest({
    request: request(validBody({ "website-url": "https://example.com" })),
    env: {
      ...turnstileEnv,
      OWNER_EMAIL: "contact@arroyomarketing.com",
      FROM_EMAIL: "Arroyo Marketing <leads@arroyomarketing.com>",
      RESEND_API_KEY: "test-key"
    },
    fetchImpl,
    randomUUID: () => "email-sink",
    logger: quietLogger
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url === "https://api.resend.com/emails"));
  assert.equal(calls[0].body.reply_to, "jamie@example.com");
  assert.equal(calls[1].body.reply_to, "contact@arroyomarketing.com");
  assert.equal(calls[0].headers["Idempotency-Key"], "arroyo-owner/11111111-1111-4111-8111-111111111111");
  assert.equal(calls[1].headers["Idempotency-Key"], "arroyo-client/11111111-1111-4111-8111-111111111111");
  assert.match(calls[1].body.html, /background-color:#11151c/);
  assert.ok(calls.every((call) => call.body.html.includes('https://arroyomarketing.com/assets/images/logos/arroyo-logo-light-bg.png')));
  assert.ok(calls.every((call) => call.body.html.includes('alt="Arroyo Marketing"')));
});

test("uses a saved Google Sheet row as a durable sink and neutralizes formulas", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return turnstileSuccess();
    calls.push({ url: String(url), options });
    if (String(url) === "https://script.google.com/macros/s/test/exec") return response(true, 200, { ok: true });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await handleLeadRequest({
    request: request(validBody({ name: "=IMPORTXML(\"https://example.com\")", "website-url": "" })),
    env: {
      ...turnstileEnv,
      GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec",
      GOOGLE_SHEETS_WEBHOOK_SECRET: "sheet-secret"
    },
    fetchImpl,
    randomUUID: () => "sheet-sink",
    logger: quietLogger
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  const sheetCall = calls[0];
  const envelope = JSON.parse(sheetCall.options.body);
  assert.equal(sheetCall.options.headers["x-webhook-secret"], "sheet-secret");
  assert.equal(envelope.source, "arroyo-marketing-lead");
  assert.equal(envelope.secret, "sheet-secret");
  assert.equal(envelope.row.ticket_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(envelope.row.name, "'=IMPORTXML(\"https://example.com\")");
  assert.match(envelope.row.notes, /Business: Desert Stoneworks/);
});

test("starts owner delivery and the signed Sheets webhook concurrently", async () => {
  const calls = [];
  let releaseOwner;
  let resendCalls = 0;
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return turnstileSuccess();
    if (target === "https://api.resend.com/emails") {
      resendCalls += 1;
      if (resendCalls === 1) {
        return new Promise((resolve) => {
          releaseOwner = () => resolve(response(true));
        });
      }
      return response(true);
    }
    if (target === "https://script.google.com/macros/s/test/exec") return response(true, 200, { ok: true });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const pending = handleLeadRequest({
    request: request(validBody()),
    env: {
      ...turnstileEnv,
      OWNER_EMAIL: "contact@arroyomarketing.com",
      FROM_EMAIL: "Arroyo Marketing <leads@arroyomarketing.com>",
      RESEND_API_KEY: "test-key",
      GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec",
      GOOGLE_SHEETS_WEBHOOK_SECRET: "sheet-secret"
    },
    fetchImpl,
    randomUUID: () => "concurrent-sinks",
    logger: quietLogger
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 3), [
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "https://api.resend.com/emails",
    "https://script.google.com/macros/s/test/exec"
  ]);
  releaseOwner();
  assert.equal((await pending).status, 200);
});

test("fails closed when a Sheets webhook returns HTTP 200 with ok false", async () => {
  const calls = [];
  const result = await handleLeadRequest({
    request: request(validBody()),
    env: {
      ...turnstileEnv,
      GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/test/exec",
      GOOGLE_SHEETS_WEBHOOK_SECRET: "sheet-secret"
    },
    fetchImpl: async (url) => {
      if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return turnstileSuccess();
      calls.push(String(url));
      return response(true, 200, { ok: false, error: "unauthorized" });
    },
    randomUUID: () => "semantic-failure",
    logger: quietLogger
  });
  assert.equal(result.status, 503);
  assert.equal(calls.length, 1);
});

test("never sends a Sheets secret to a non-HTTPS webhook", async () => {
  let called = false;
  const result = await handleLeadRequest({
    request: request(validBody()),
    env: {
      ...turnstileEnv,
      GOOGLE_SHEETS_WEBHOOK_URL: "http://script.example.test/lead",
      GOOGLE_SHEETS_WEBHOOK_SECRET: "sheet-secret"
    },
    fetchImpl: async (url) => {
      if (String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify") return turnstileSuccess();
      called = true;
      return response(true, 200, { ok: true });
    },
    randomUUID: () => "unsafe-webhook",
    logger: quietLogger
  });
  assert.equal(result.status, 503);
  assert.equal(called, false);
});

test("rejects oversized bodies and overlong fields", async () => {
  const declaredTooLarge = await handleLeadRequest({
    request: request("x".repeat(MAX_BODY_BYTES + 1), { "Content-Length": String(MAX_BODY_BYTES + 1) }),
    env: {},
    randomUUID: () => "declared-large",
    logger: quietLogger
  });
  assert.equal(declaredTooLarge.status, 413);

  const streamedTooLarge = await handleLeadRequest({
    request: request("x".repeat(MAX_BODY_BYTES + 1)),
    env: {},
    randomUUID: () => "streamed-large",
    logger: quietLogger
  });
  assert.equal(streamedTooLarge.status, 413);

  const tooLong = await handleLeadRequest({
    request: request(validBody({ name: "x".repeat(101) })),
    env: {},
    randomUUID: () => "long",
    logger: quietLogger
  });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error, "field_too_long");
});

test("requires a real JSON media type", async () => {
  const jsonp = await handleLeadRequest({
    request: request(validBody(), { "Content-Type": "application/jsonp" }),
    env: {},
    randomUUID: () => "jsonp",
    logger: quietLogger
  });
  assert.equal(jsonp.status, 415);

  const structuredJson = await handleLeadRequest({
    request: request(validBody(), { "Content-Type": "application/merge-patch+json" }),
    env: {},
    randomUUID: () => "structured-json",
    logger: quietLogger
  });
  assert.equal(structuredJson.status, 503);
});

test("sheetSafeCell covers common spreadsheet formula prefixes", () => {
  for (const value of ["=1+1", "+SUM(A1:A2)", "-2+3", "@IMPORTDATA(A1)", "  =cmd"]) {
    assert.ok(sheetSafeCell(value).startsWith("'"));
  }
  assert.equal(sheetSafeCell("ordinary text"), "ordinary text");
});

test("Cloudflare adapter preserves method handling and fail-closed semantics", async () => {
  const method = onRequest();
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("Allow"), "POST");

  const missingContentType = await onRequestPost({
    request: new Request("https://arroyomarketing.com/api/lead", {
      method: "POST",
      body: JSON.stringify(validBody())
    }),
    env: {}
  });
  assert.equal(missingContentType.status, 415);

  const result = await onRequestPost({ request: request(validBody()), env: {} });
  const body = await result.json();
  assert.equal(result.status, 503);
  assert.equal(body.error, "turnstile_not_configured");
  assert.equal(body.platform, "cloudflare");
});

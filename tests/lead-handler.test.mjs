import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { handleLeadRequest, MAX_BODY_BYTES, sheetSafeCell } from "../lib/lead-handler.mjs";

const require = createRequire(import.meta.url);
const { handler: netlifyHandler } = require("../netlify/functions/submit-lead.js");

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

test("fails closed when no durable owner sink succeeds", async () => {
  const result = await handleLeadRequest({
    request: request(validBody()),
    env: {},
    clientIp: "203.0.113.10",
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
      OWNER_EMAIL: "contact@arroyomarketing.com",
      FROM_EMAIL: "Arroyo Marketing <leads@arroyomarketing.com>",
      RESEND_API_KEY: "test-key"
    },
    clientIp: "203.0.113.16",
    fetchImpl: async (url, options) => {
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
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return response(true);
  };
  const result = await handleLeadRequest({
    request: request(validBody({ "website-url": "https://example.com" })),
    env: {
      OWNER_EMAIL: "contact@arroyomarketing.com",
      FROM_EMAIL: "Arroyo Marketing <leads@arroyomarketing.com>",
      RESEND_API_KEY: "test-key"
    },
    clientIp: "203.0.113.11",
    fetchImpl,
    randomUUID: () => "email-sink",
    logger: quietLogger
  });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url === "https://api.resend.com/emails"));
  assert.equal(calls[0].body.reply_to, "jamie@example.com");
  assert.equal(calls[1].body.reply_to, "contact@arroyomarketing.com");
  assert.match(calls[1].body.html, /background-color:#11151c/);
});

test("uses a saved Google Sheet row as a durable sink and neutralizes formulas", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com")) return response(true, 200, { access_token: "token" });
    if (String(url).includes("sheets.googleapis.com")) return response(true);
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await handleLeadRequest({
    request: request(validBody({ name: "=IMPORTXML(\"https://example.com\")", "website-url": "" })),
    env: {
      GOOGLE_SHEET_ID: "sheet-id",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REFRESH_TOKEN: "refresh-token"
    },
    clientIp: "203.0.113.12",
    fetchImpl,
    randomUUID: () => "sheet-sink",
    logger: quietLogger
  });
  assert.equal(result.status, 200);
  const sheetCall = calls.find((call) => call.url.includes("sheets.googleapis.com"));
  const values = JSON.parse(sheetCall.options.body).values[0];
  assert.equal(values[1], "'=IMPORTXML(\"https://example.com\")");
  assert.match(sheetCall.url, /valueInputOption=USER_ENTERED/);
});

test("starts owner delivery and Google authorization concurrently", async () => {
  const calls = [];
  let releaseOwner;
  let resendCalls = 0;
  const fetchImpl = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target === "https://api.resend.com/emails") {
      resendCalls += 1;
      if (resendCalls === 1) {
        return new Promise((resolve) => {
          releaseOwner = () => resolve(response(true));
        });
      }
      return response(true);
    }
    if (target.includes("oauth2.googleapis.com")) return response(true, 200, { access_token: "token" });
    if (target.includes("sheets.googleapis.com")) return response(true);
    throw new Error(`Unexpected URL: ${url}`);
  };

  const pending = handleLeadRequest({
    request: request(validBody()),
    env: {
      OWNER_EMAIL: "contact@arroyomarketing.com",
      FROM_EMAIL: "Arroyo Marketing <leads@arroyomarketing.com>",
      RESEND_API_KEY: "test-key",
      GOOGLE_SHEET_ID: "sheet-id",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REFRESH_TOKEN: "refresh-token"
    },
    clientIp: "203.0.113.19",
    fetchImpl,
    randomUUID: () => "concurrent-sinks",
    logger: quietLogger
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 2), ["https://api.resend.com/emails", "https://oauth2.googleapis.com/token"]);
  releaseOwner();
  assert.equal((await pending).status, 200);
});

test("rejects oversized bodies and overlong fields", async () => {
  const declaredTooLarge = await handleLeadRequest({
    request: request("x".repeat(MAX_BODY_BYTES + 1), { "Content-Length": String(MAX_BODY_BYTES + 1) }),
    env: {},
    clientIp: "203.0.113.13",
    randomUUID: () => "declared-large",
    logger: quietLogger
  });
  assert.equal(declaredTooLarge.status, 413);

  const streamedTooLarge = await handleLeadRequest({
    request: request("x".repeat(MAX_BODY_BYTES + 1)),
    env: {},
    clientIp: "203.0.113.15",
    randomUUID: () => "streamed-large",
    logger: quietLogger
  });
  assert.equal(streamedTooLarge.status, 413);

  const tooLong = await handleLeadRequest({
    request: request(validBody({ name: "x".repeat(101) })),
    env: {},
    clientIp: "203.0.113.14",
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
    clientIp: "203.0.113.17",
    randomUUID: () => "jsonp",
    logger: quietLogger
  });
  assert.equal(jsonp.status, 415);

  const structuredJson = await handleLeadRequest({
    request: request(validBody(), { "Content-Type": "application/merge-patch+json" }),
    env: {},
    clientIp: "203.0.113.18",
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

test("Netlify adapter preserves method handling and fail-closed semantics", async () => {
  const method = await netlifyHandler({ httpMethod: "GET", headers: {} });
  assert.equal(method.statusCode, 405);

  const keys = [
    "OWNER_EMAIL",
    "FROM_EMAIL",
    "RESEND_API_KEY",
    "GOOGLE_SHEET_ID",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN"
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  keys.forEach((key) => delete process.env[key]);
  try {
    const missingContentType = await netlifyHandler({
      httpMethod: "POST",
      rawUrl: "https://arroyomarketing.com/api/lead",
      headers: { "x-nf-client-connection-ip": "203.0.113.49" },
      body: JSON.stringify(validBody())
    });
    assert.equal(missingContentType.statusCode, 415);

    const result = await netlifyHandler({
      httpMethod: "POST",
      rawUrl: "https://arroyomarketing.com/api/lead",
      headers: { "content-type": "application/json", "x-nf-client-connection-ip": "203.0.113.50" },
      body: JSON.stringify(validBody())
    });
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.parse(result.body).error, "lead_not_persisted");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

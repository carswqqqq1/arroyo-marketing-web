function getHeader(headers, name) {
  const target = name.toLowerCase();
  const key = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === target);
  return key ? headers[key] : "";
}

function getClientIp(event) {
  const headers = event.headers || {};
  const raw =
    getHeader(headers, "x-nf-client-connection-ip") ||
    getHeader(headers, "client-ip") ||
    getHeader(headers, "x-forwarded-for") ||
    "unknown";
  return String(raw).split(",")[0].trim();
}

exports.handler = async function handler(event) {
  const { handleLeadRequest, jsonResponse } = await import("../../lib/lead-handler.mjs");

  if (event.httpMethod !== "POST") {
    const response = jsonResponse(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text()
    };
  }

  const headers = new Headers(event.headers || {});

  const request = new Request(event.rawUrl || "https://arroyomarketing.com/api/lead", {
    method: "POST",
    headers,
    body: event.body || "{}"
  });

  const response = await handleLeadRequest({
    request,
    env: process.env,
    platform: "netlify",
    clientIp: getClientIp(event)
  });

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text()
  };
};

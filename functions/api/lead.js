import { handleLeadRequest, jsonResponse } from "../../lib/lead-handler.mjs";

export async function onRequestPost(context) {
  return handleLeadRequest({
    request: context.request,
    env: context.env,
    platform: "cloudflare",
    clientIp: context.request.headers.get("CF-Connecting-IP") || "unknown"
  });
}

export function onRequest() {
  return jsonResponse(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
}

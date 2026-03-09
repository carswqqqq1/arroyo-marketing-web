const SHEET_RANGE = "Leads!A:O";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
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

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) {
      throw new Error("Missing GOOGLE_SHEET_ID");
    }

    const body = JSON.parse(event.body || "{}");
    const requiredFields = ["name", "business-name", "email", "phone", "help-needed"];
    const missing = requiredFields.filter((field) => !String(body[field] || "").trim());
    if (missing.length) {
      return json(400, { ok: false, error: "missing_required_fields", fields: missing });
    }

    if (String(body["company-website"] || "").trim()) {
      return json(200, { ok: true, skipped: true });
    }

    const accessToken = await getAccessToken();
    const row = [
      new Date().toISOString(),
      String(body.name || "").trim(),
      String(body["business-name"] || "").trim(),
      String(body.email || "").trim(),
      String(body.phone || "").trim(),
      String(body["website-url"] || "").trim(),
      String(body["help-needed"] || "").trim(),
      String(body.source_page || "").trim(),
      String(body.current_path || "").trim(),
      String(body.utm_source || "").trim(),
      String(body.utm_medium || "").trim(),
      String(body.utm_campaign || "").trim(),
      String(body.utm_term || "").trim(),
      String(body.utm_content || "").trim(),
      "New"
    ];

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

    return json(200, { ok: true });
  } catch (error) {
    return json(500, {
      ok: false,
      error: "submission_failed"
    });
  }
};

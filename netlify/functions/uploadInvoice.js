// netlify/functions/uploadInvoice.js
// Purpose: receive a PDF (base64) from the browser, upload to Dropbox, return a public URL.
// No HTML rendering. No Puppeteer. Just storage.
//
// Env vars required in Netlify -> Project -> Environment variables:
//   DROPBOX_ACCESS_TOKEN      (App access token)
// Optional:
//   DROPBOX_INVOICE_PATH      (e.g. "/invoices"; defaults to "/invoices")
//
// Request (POST JSON):
//   {
//     "filename": "YourCompany_Quote_INV-20251024-0001.pdf",
//     "content_base64": "<BASE64-PDF>",
//     "content_type": "application/pdf"
//   }
//
// Response (200 JSON):
//   { "url": "https://www.dropbox.com/s/....?raw=1" }

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method !== "POST") {
    return json(405, { error: "POST only" });
  }

  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const clientId = '8hyi00z3tgw4419';
  const clientSecret = 'fii9xrqzj0nghtv';

  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const tokenData = await tokenRes.json();
  const token = tokenData.access_token;
  const basePath = process.env.DROPBOX_INVOICE_PATH || '/invoices';
  if (!token) return json(500, { error: 'Missing access token from refresh' });


  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const original = String(body.filename || "invoice").replace(/[/\\]+/g, "_").replace(/\.pdf$/i, "");
const customer = String(body.customer_name || "customer")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, ""); // YYYYMMDDTHHMMSS
const filename = `${original}__${customer}__${stamp}.pdf`;

  const b64 = body.content_base64;
  const contentType = String(body.content_type || "").toLowerCase();

  if (!b64 || !/^application\/pdf\b/.test(contentType)) {
    return json(400, { error: "content_base64 (PDF) required" });
  }

  // Decode base64 to bytes
  let bytes;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return json(400, { error: "content_base64 is not valid base64" });
  }

  const dropboxUploadUrl = "https://content.dropboxapi.com/2/files/upload";
  const targetPath = `${basePath}/${filename}`;

  try {
    // 1) Upload file bytes
    const upRes = await fetch(dropboxUploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: targetPath,
          mode: "overwrite",      // overwrite same filename
          autorename: false,
          mute: true,
          strict_conflict: false,
        }),
      },
      body: bytes,
    });

    if (!upRes.ok) {
      const t = await upRes.text().catch(() => "");
      return json(502, { error: "upload_failed", detail: t });
    }

    const uploaded = await upRes.json();
    const pathLower = uploaded.path_lower || targetPath.toLowerCase();

    // 2) Create/get a shared link
    const createLinkRes = await fetch(
      "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: pathLower,
          settings: { requested_visibility: "public" },
        }),
      }
    );

    let url = "";
    if (createLinkRes.ok) {
      const data = await createLinkRes.json();
      url = data.url || "";
    } else {
      // If link already exists, list and reuse it
      const txt = await createLinkRes.text().catch(() => "");
      if (txt.includes("shared_link_already_exists")) {
        const listRes = await fetch(
          "https://api.dropboxapi.com/2/sharing/list_shared_links",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: pathLower, direct_only: true }),
          }
        );
        if (!listRes.ok) {
          const t2 = await listRes.text().catch(() => "");
          return json(502, { error: "link_list_failed", detail: t2 });
        }
        const listData = await listRes.json();
        url = (listData.links && listData.links[0] && listData.links[0].url) || "";
        if (!url) return json(502, { error: "no_shared_link_found" });
      } else {
        return json(502, { error: "link_create_failed", detail: txt });
      }
    }

    // Make it render directly in browser
    const direct = url.replace("?dl=0", "?raw=1");

    return json(200, { url: direct });
  } catch (e) {
    return json(500, { error: "unexpected", detail: String(e?.message || e) });
  }
}

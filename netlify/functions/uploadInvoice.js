// /netlify/functions/uploadInvoice.js
export default async (req) => {
  // ---------- CORS ----------
  const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  const j = (status, obj) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json", ...CORS },
    });

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return j(405, { error: "POST only" });
  }

  // ---------- Env ----------
  const token = process.env.DROPBOX_ACCESS_TOKEN;
  const basePath = (process.env.DROPBOX_INVOICE_PATH || "/invoices").trim();
  if (!token) return j(500, { error: "Missing DROPBOX_ACCESS_TOKEN" });

  // ---------- Parse body ----------
  let filename, content_base64, content_type;
  try {
    ({ filename, content_base64, content_type = "text/html" } = await req.json());
  } catch {
    return j(400, { error: "Invalid JSON body" });
  }
  if (!filename || !content_base64) {
    return j(400, { error: "filename and content_base64 required" });
  }

  // Normalize Dropbox path
  const safeBase = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const path = `${safeBase}/${filename}`.replace(/\/{2,}/g, "/");

  try {
    // ---------- 1) Upload ----------
    const bytes = Buffer.from(content_base64, "base64");
    const up = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path,
          mode: "overwrite",
          autorename: false,
          mute: true,
          strict_conflict: false,
        }),
      },
      body: bytes,
    });

    if (!up.ok) {
      const txt = await up.text().catch(() => "");
      return j(502, { error: "upload_failed", detail: txt || up.statusText });
    }

    // ---------- 2) Create (or fetch) shared link ----------
    async function makeShared() {
      const res = await fetch(
        "https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path,
            settings: {
              requested_visibility: "public",
              audience: "public",
              access: "viewer",
            },
          }),
        }
      );
      return res;
    }

    let shared = await makeShared();
    if (!shared.ok) {
      // If link already exists, list it
      if (shared.status === 409) {
        const list = await fetch(
          "https://api.dropboxapi.com/2/sharing/list_shared_links",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ path, direct_only: true }),
          }
        );
        if (!list.ok) {
          const txt = await list.text().catch(() => "");
          return j(502, { error: "list_link_failed", detail: txt || list.statusText });
        }
        const data = await list.json();
        const link = (data.links && data.links[0] && data.links[0].url) || "";
        if (!link) return j(502, { error: "no_shared_link_found" });
        const url = link.includes("?") ? link.replace(/\?dl=\d/, "?raw=1") : link + "?raw=1";
        return j(200, { url });
      } else {
        const txt = await shared.text().catch(() => "");
        return j(502, { error: "create_link_failed", detail: txt || shared.statusText });
      }
    }

    const data = await shared.json();
    const link = (data && data.url) || "";
    const url = link.includes("?") ? link.replace(/\?dl=\d/, "?raw=1") : link + "?raw=1";
    return j(200, { url });
  } catch (e) {
    return j(500, { error: "exception", detail: e?.message || String(e) });
  }
};


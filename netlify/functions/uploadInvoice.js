// netlify/functions/uploadInvoice.js
export default async (req) => {
  // --- CORS ---
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  const basePath = process.env.DROPBOX_INVOICE_PATH || "/invoices";
  if (!token) return json({ error: "Missing DROPBOX_ACCESS_TOKEN" }, 500);

  try {
    const { filename, content_base64, content_type = "text/html" } = await req.json();

    if (!filename || !content_base64) {
      return json({ error: "filename and content_base64 required" }, 400);
    }

    const bytes = Buffer.from(content_base64, "base64");
    const path = `${basePath}/${filename}`;

    // 1) Upload
    {
      const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": JSON.stringify({
            path,
            mode: "overwrite",
            mute: true,
            strict_conflict: false,
          }),
        },
        body: bytes,
      });
      if (!uploadRes.ok) {
        const t = await uploadRes.text();
        return json({ error: "Upload failed", details: t }, 502);
      }
    }

    // 2) Create (or fetch) shared link
    let shared;
    const create = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path,
        settings: { requested_visibility: "public" },
      }),
    });

    if (create.ok) {
      shared = await create.json();
    } else {
      // If already exists, list it
      const list = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path }),
      });
      if (!list.ok) {
        const t = await list.text();
        return json({ error: "Link fetch failed", details: t }, 502);
      }
      const data = await list.json();
      shared = (data && data.links && data.links[0]) || null;
      if (!shared) return json({ error: "No shared link found" }, 500);
    }

    // 3) Convert to direct URL
    const rawUrl = (shared.url || "").replace("?dl=0", "?raw=1");

    return json({ url: rawUrl }, 200);
  } catch (e) {
    return json({ error: "Server error", details: String(e) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

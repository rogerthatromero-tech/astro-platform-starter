// /netlify/functions/uploadInvoice.js  (DIAGNOSTIC MODE)
export default async (req) => {
  const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  const j = (s, o) =>
    new Response(JSON.stringify(o, null, 2), {
      status: s,
      headers: { "content-type": "application/json", ...CORS },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")  return j(405, { error: "POST only" });

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  const basePath = (process.env.DROPBOX_INVOICE_PATH || "/invoices").trim();
  const diag = { step: "start", haveToken: !!token, basePath };

  if (!token) return j(500, { ...diag, error: "Missing DROPBOX_ACCESS_TOKEN" });

  let body;
  try { body = await req.json(); }
  catch { return j(400, { ...diag, error: "Invalid JSON body" }); }

  const filename = body?.filename;
  const content_base64 = body?.content_base64;
  const content_type = body?.content_type || "text/html";
  if (!filename || !content_base64)
    return j(400, { ...diag, error: "filename and content_base64 required" });

  const safeBase = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const path = `${safeBase}/${filename}`.replace(/\/{2,}/g, "/");

  try {
    diag.step = "upload";
    const upload = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path, mode: "overwrite", autorename: false, mute: true, strict_conflict: false
        }),
      },
      body: Buffer.from(content_base64, "base64"),
    });

    if (!upload.ok) {
      const txt = await upload.text().catch(()=> "");
      console.error("UPLOAD_FAIL", upload.status, txt);
      return j(502, { ...diag, substep: "upload", status: upload.status, detail: txt || upload.statusText });
    }

    diag.step = "create_link";
    let shared = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path, settings: { requested_visibility: "public", audience: "public", access: "viewer" } }),
    });

    if (!shared.ok) {
      const txt = await shared.text().catch(()=> "");
      if (shared.status === 409) {
        diag.step = "list_links";
        const list = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ path, direct_only: true }),
        });
        const ltxt = await list.text().catch(()=> "");
        if (!list.ok) {
          console.error("LIST_FAIL", list.status, ltxt);
          return j(502, { ...diag, substep: "list_links", status: list.status, detail: ltxt || list.statusText });
        }
        const data = JSON.parse(ltxt || "{}");
        const link = data?.links?.[0]?.url || "";
        if (!link) return j(502, { ...diag, substep: "list_links", error: "no_shared_link_found" });
        const url = link.includes("?") ? link.replace(/\?dl=\d/, "?raw=1") : link + "?raw=1";
        return j(200, { url, diag });
      }
      console.error("CREATE_LINK_FAIL", shared.status, txt);
      return j(502, { ...diag, substep: "create_link", status: shared.status, detail: txt || shared.statusText });
    }

    const data = await shared.json();
    const link = data?.url || "";
    const url = link.includes("?") ? link.replace(/\?dl=\d/, "?raw=1") : link + "?raw=1";
    return j(200, { url, diag });
  } catch (e) {
    console.error("EXCEPTION", e);
    return j(500, { ...diag, error: "exception", detail: e?.message || String(e) });
  }
};

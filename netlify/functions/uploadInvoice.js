// /netlify/functions/uploadInvoice.js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const ok = (data, init={}) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "content-type":"application/json", "access-control-allow-origin":"*", "access-control-allow-headers":"content-type" }, ...init });

const bad = (code, msg) =>
  new Response(JSON.stringify({ error: msg }), { status: code, headers: { "content-type":"application/json", "access-control-allow-origin":"*" } });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "access-control-allow-origin":"*",
      "access-control-allow-methods":"POST, OPTIONS",
      "access-control-allow-headers":"content-type"
    }});
  }
  if (req.method !== "POST") return bad(405, "POST only");

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  const basePath = process.env.DROPBOX_INVOICE_PATH || "/invoices";
  if (!token) return bad(500, "Missing DROPBOX_ACCESS_TOKEN");

  let body;
  try { body = await req.json(); } catch { return bad(400, "Invalid JSON"); }

  const {
    filename = `Invoice_${Date.now()}.pdf`,
    html,                 // raw HTML to render (preferred)
    title = "Invoice",
    // Optional fallbacks if caller only has base64 html
    html_base64
  } = body || {};

  const rawHTML = html || (html_base64 ? Buffer.from(html_base64, "base64").toString("utf8") : "");
  if (!rawHTML) return bad(400, "html or html_base64 required");

  // --- Render A4 PDF with headless Chrome (no clipping) ---
  let browser, pdfBytes;
  try {
    const execPath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 2 }, // A4 @ 96dpi, crisp
      executablePath: execPath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Inject A4 CSS to avoid overflow/cropping
    const htmlForPdf = /* html */`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            @page { size: A4; margin: 16mm; }
            html, body { width: 210mm; height: 297mm; margin: 0; }
            /* prevent accidental clipping */
            body { overflow: visible !important; }
            *, *::before, *::after { box-sizing: border-box; }
          </style>
        </head>
        <body>${rawHTML}</body>
      </html>
    `;

    await page.setContent(htmlForPdf, { waitUntil: ["domcontentloaded","networkidle0"] });
    await page.emulateMediaType("screen");

    pdfBytes = await page.pdf({
      format: "A4",
      margin: { top: "16mm", right: "16mm", bottom: "16mm", left: "16mm" },
      printBackground: true,
      preferCSSPageSize: true,
    });

    await page.close();
    await browser.close();
  } catch (e) {
    try { if (browser) await browser.close(); } catch {}
    return bad(500, "PDF render failed: " + (e?.message || e));
  }

  // --- Upload to Dropbox as PDF ---
  const dropboxPath = `${basePath}/${filename.endsWith(".pdf") ? filename : (filename + ".pdf")}`;

  try {
    const uploadRes = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: dropboxPath,
          mode: { ".tag": "overwrite" },
          mute: true,
          autorename: false
        }),
      },
      body: pdfBytes
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      return bad(502, `Dropbox upload_failed: ${t}`);
    }

    const shareRes = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: dropboxPath, settings: { requested_visibility: "public" } })
    });

    let url;
    if (shareRes.ok) {
      const j = await shareRes.json();
      url = String(j?.url || "").replace("?dl=0","?dl=1"); // direct download
    } else {
      // Link already exists? fetch it
      const list = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ path: dropboxPath, direct_only: true })
      });
      const j = await list.json();
      url = String(j?.links?.[0]?.url || "").replace("?dl=0","?dl=1");
    }

    if (!url) return bad(502, "Could not obtain shared link");

    return ok({ url, path: dropboxPath });
  } catch (e) {
    return bad(502, "Dropbox error: " + (e?.message || e));
  }
};

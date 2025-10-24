// netlify/functions/uploadInvoice.mjs
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const config = {
  path: '/.netlify/functions/uploadInvoice'
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*'
  }
});

export default async (req) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_json' });
  }

  const {
    filename = `invoice_${Date.now()}.pdf`,
    content_base64,
    content_type,
    html,
    html_base64,
    title = 'Invoice'
  } = payload || {};

  const token = process.env.DROPBOX_TOKEN;
  if (!token) return json(500, { error: 'missing_dropbox_token' });

  // ---- 1) Get a PDF Buffer (either provided or render from HTML) ----
  let pdfBuffer;

  try {
    if (content_base64 && content_type === 'application/pdf') {
      // Already a PDF from the browser (html2pdf). Decode it.
      pdfBuffer = Buffer.from(content_base64, 'base64');
    } else {
      // Need HTML to render
      const htmlString = html
        || (html_base64 ? Buffer.from(html_base64, 'base64').toString('utf8') : null);

      if (!htmlString) {
        return json(400, { error: 'html or html_base64 required' });
      }

      // Launch headless Chrome (server-safe build)
      const executablePath = await chromium.executablePath();

      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 794, height: 1123, deviceScaleFactor: 1 },
        executablePath,
        headless: chromium.headless,
        ignoreHTTPSErrors: true
      });

      try {
        const page = await browser.newPage();
        // Ensure print-like CSS is respected; wait for network to settle
        await page.setContent(htmlString, { waitUntil: 'networkidle0' });

        // Title helps some PDF viewers
        await page.evaluate(t => { try { document.title = t || document.title; } catch(_){}; }, title);

        pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '16mm', right: '16mm', bottom: '16mm', left: '16mm' },
          preferCSSPageSize: false,
          displayHeaderFooter: false
        });
      } finally {
        try { await browser.close(); } catch {}
      }
    }
  } catch (e) {
    return json(500, { error: 'PDF render failed', detail: String(e?.stack || e) });
  }

  // ---- 2) Upload to Dropbox ----
  // Ensure .pdf extension
  const cleanName = String(filename || `invoice_${Date.now()}.pdf`).replace(/[^\w.\-]+/g, '_');
  const finalName = cleanName.toLowerCase().endsWith('.pdf') ? cleanName : (cleanName + '.pdf');
  const dropboxPath = `/${finalName}`;

  try {
    // Upload the file
    const upRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({
          path: dropboxPath,
          mode: 'add',
          autorename: true,
          mute: false,
          strict_conflict: false
        }),
        'Content-Type': 'application/octet-stream'
      },
      body: pdfBuffer
    });

    if (!upRes.ok) {
      const txt = await upRes.text().catch(() => '');
      return json(502, { error: 'upload_failed', detail: txt });
    }

    const fileMeta = await upRes.json();
    const filePath = fileMeta?.path_lower || dropboxPath;

    // Create (or fetch) a shared link
    let sharedUrl = '';
    const mkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        path: filePath,
        settings: { access: 'viewer', audience: 'public', requested_visibility: 'public' }
      })
    });

    if (mkRes.ok) {
      const j = await mkRes.json();
      sharedUrl = j?.url || '';
    } else {
      // If already exists, list it
      const lsRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: filePath, direct_only: true })
      });
      const lj = await lsRes.json().catch(() => ({}));
      sharedUrl = (lj?.links && lj.links[0]?.url) || '';
      if (!sharedUrl) {
        const txt = await mkRes.text().catch(() => '');
        return json(502, { error: 'share_link_failed', detail: txt || lj });
      }
    }

    // Turn Dropbox share link into an inline viewer URL
    // Typical: https://www.dropbox.com/scl/fi/.../file.pdf?rlkey=...&dl=0
    // Use raw=1 to open inline in most browsers.
    const publicUrl = sharedUrl.replace(/(\?dl=\d|\?rlkey=[^&]+&dl=\d|$)/, (m) => {
      if (!m) return '?raw=1';
      return m.replace(/dl=\d/, 'raw=1');
    });

    return json(200, { url: publicUrl });
  } catch (e) {
    return json(500, { error: 'dropbox_error', detail: String(e?.stack || e) });
  }
};

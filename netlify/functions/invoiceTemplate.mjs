// netlify/functions/invoiceTemplate.mjs
export default async (req) => {
  // CORS
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400, headers: cors });
  }

  const {
    q = {},
    info = null,
    invoiceLabel = '',
    // ignore dynamic company fields for now per your request
  } = payload || {};

  /* ---------- helpers ---------- */
  const money = (n) =>
    (isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  // Accept cents or dollars and normalize to dollars
  const toDollars = (val) => {
    let n = Number(val) || 0;
    // Heuristic: most grid values are integer cents (e.g., 2400), treat large integers as cents
    if (Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) >= 1000) return n / 100;
    return n;
  };

  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');

  // Build “recipient” multi-line block
  const recipientLines = [];
  if (info) {
    const name = [info.first, info.last].filter(Boolean).join(' ').trim() || info.name || '';
    if (name) recipientLines.push(String(name));
    if (info.company && info.company !== name) recipientLines.push(String(info.company));
    if (info.phone) recipientLines.push(`Phone: ${info.phone}`);
    if (info.email) recipientLines.push(`Email: ${info.email}`);
    if (info.ship)  recipientLines.push(`Ship to: ${info.ship}`);
    if (info.bill && info.bill !== info.ship && info.bill.trim()) recipientLines.push(`Bill to: ${info.bill}`);
    if (info.address && !info.ship && !info.bill) recipientLines.push(String(info.address));
  }
  const recipientHTML = recipientLines.join('\n') || 'Customer';

  /* ---------- normalize items (q.items first, then q.groups fallback) ---------- */
  let rawItems = Array.isArray(q?.items) ? q.items.slice() : [];

  if ((!rawItems || rawItems.length === 0) && q && q.groups && typeof q.groups === 'object') {
    // Flatten groups from the preview builder shape
    Object.keys(q.groups).forEach((title) => {
      (q.groups[title] || []).forEach((it) => rawItems.push(it));
    });
  }

  const normItems = (rawItems || [])
    .map((it) => {
      const kind  = it.kind || it.name || it.pg ? `${it.pg ? (it.pg + ' — ') : ''}${it.kind || it.name || ''}` : '';
      const model = it.model || '';
      const size  = it.size  || '';
      const pcs   = (it.pieces ?? it.pcs ?? '-') || '-';
      const mat   = it.material || '';
      const col   = it.color || '';
      const qty   = Number(it.qty ?? it.quantity ?? 0) || 0;

      // Prefer provided unit/line; accept cents or dollars
      let unit = it.price != null ? Number(it.price) : (it.unit != null ? Number(it.unit) : 0);
      let line = it.line != null ? Number(it.line)  : (it.total != null ? Number(it.total) : 0);

      // If only line exists (or only unit), compute the other
      if (unit && !line && qty) line = unit * qty;
      if (!unit && line && qty) unit = line / qty;

      // Normalize both to dollars (accept cents)
      const unit$ = toDollars(unit);
      const line$ = toDollars(line) || (qty * unit$);

      return { kind, model, size, pcs, mat, col, qty, unit: unit$, total: qty * unit$ || line$ };
    })
    .filter((r) => r.qty > 0);

  // Totals (support q.grand/q.msrpSubtotal either in cents or dollars)
  const msrpSubtotal$ =
    normItems.reduce((s, r) => s + (Number(r.total) || 0), 0);

  let discountedSubtotal$ = msrpSubtotal$;
  if (q && (q.grand != null)) {
    discountedSubtotal$ = toDollars(q.grand);
  }

  const saved$ =
    (q && (q.saved != null)) ? toDollars(q.saved) : (msrpSubtotal$ - discountedSubtotal$);

  const tierPct = Number(q?.discountPct || 0) || 0;
  const modeLabel =
    q && q.mode
      ? (q.mode === 'individual' ? 'Individual'
        : q.mode === 'solid'     ? '60pc master case (solid color)'
        : q.mode === 'mixed'     ? '60pc master case (mixed color)'
        : String(q.mode))
      : 'Individual';

  /* ---------- static company block (per your request) ---------- */
  const companyBlock = `
    <p><strong>Sensorite</strong><br>
    Block 39, Zhongji Zhicheng Industry Park,<br>
    Yingguang, Lilin Town, Huizhou, China 516035<br>
    sales@foxdanch.com · +86 (755) 8947-1769</p>
  `.trim();

  /* ---------- rows ---------- */
  const rowsHTML = normItems.map((r) => {
    return `<tr>
      <td>${esc(r.kind)}</td>
      <td>${esc(r.model)}</td>
      <td>${esc(r.size)}</td>
      <td>${esc(r.pcs)}</td>
      <td>${esc(r.mat)}</td>
      <td>${esc(r.col)}</td>
      <td style="text-align:right">${r.qty}</td>
      <td style="text-align:right">${money(r.unit)}</td>
      <td style="text-align:right">${money(r.total)}</td>
    </tr>`;
  }).join('');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Quote</title>
<style>
body{font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;color:#111;padding:28px;background:#fff}
header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;gap:16px}
.brand{max-width:48%}
.brand h1{margin:0 0 6px;font-size:20px}
.company{max-width:48%;text-align:right;font-size:12px;color:#333}
.recipient{background:#f8f8f8;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:6px;white-space:pre-line}
hr{border:0;border-top:1px solid #ddd;margin:12px 0}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #ddd;padding:6px 8px;white-space:nowrap}
th{text-align:left;background:#f5f5f5}
tfoot td{font-weight:700}
.muted{color:#666}
.cta-row{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap}
.cta-row a{display:inline-block;padding:10px 14px;border-radius:999px;border:1px solid #111;text-decoration:none;font-weight:800}
.cta-primary{background:#111;color:#fff;border-color:#111}
.cta-secondary{background:#fff;color:#111;border-color:#111}
@page { size: A4; margin: 16mm; }
</style>
</head>
<body>

<header>
  <div class="brand">
    <h1>${esc((q && q.companyName) || 'Sensorite')} — Quote</h1>
    <div class="muted">${esc(invoiceLabel || '')} · Mode: ${esc(modeLabel)} · Tier: ${tierPct}% · Currency: USD</div>
    <div class="recipient">${esc(recipientHTML)}</div>
  </div>
  <div class="company">
    ${companyBlock}
  </div>
</header>

<hr>

<table>
  <thead>
    <tr>
      <th>Product / Kind</th>
      <th>Model #</th>
      <th>Size</th>
      <th>Pieces</th>
      <th>Material</th>
      <th>Color</th>
      <th>Qty</th>
      <th>Unit</th>
      <th>Total</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHTML}
  </tbody>
  <tfoot>
    <tr><td colspan="7">MSRP subtotal</td><td colspan="2" style="text-align:right">${money(msrpSubtotal$)}</td></tr>
    <tr><td colspan="7">Discounted subtotal</td><td colspan="2" style="text-align:right">${money(discountedSubtotal$)}</td></tr>
    <tr><td colspan="7">You save</td><td colspan="2" style="text-align:right">${money(saved$)}</td></tr>
  </tfoot>
</table>

</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    }
  });
};

/* ---- (no dynamic company used now) ---- */

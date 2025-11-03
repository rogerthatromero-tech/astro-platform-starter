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
    companyName = '',
    companyAddress = '',
    companyCity = '',
    companyEmail = '',
    companyPhone = '',
  } = payload || {};

  const items = Array.isArray(q?.items) ? q.items : [];

  // Normalize each item to expected fields
  const normItems = items.map((it) => {
    const kind  = it.kind || it.name || '';
    const model = it.model || '';
    const size  = it.size  || '';
    const pcs   = (it.pieces ?? it.pcs ?? '-') || '-';
    const mat   = it.material || '';
    const col   = it.color || '';
    const qty   = Number(it.qty ?? it.quantity ?? 0) || 0;
    let unit    = Number(it.price ?? it.unit ?? 0) || 0;

    // If no unit but a total is present, back-compute
    const total = Number(it.total ?? 0) || (qty && unit ? qty * unit : 0);
    if (!unit && qty && total) unit = +(total / qty).toFixed(2);

    return { kind, model, size, pcs, mat, col, qty, unit, total: qty * unit };
  }).filter((r) => r.qty > 0);

  // Money helpers
  const money = (n) =>
    (isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const msrpSubtotal = normItems.reduce((s, r) => s + r.qty * r.unit, 0);
  const discountedSubtotal = msrpSubtotal; // no discount math here (can wire later)
  const saved = msrpSubtotal - discountedSubtotal;

  // Customer block (info)
  let recipientLines = [];
  if (info) {
    if (info.name) recipientLines.push(String(info.name));
    if (info.company && info.company !== info.name) recipientLines.push(String(info.company));
    if (info.phone) recipientLines.push(`Phone: ${info.phone}`);
    if (info.email) recipientLines.push(`Email: ${info.email}`);
    if (info.address) recipientLines.push(String(info.address));
  }
  const recipientHTML = recipientLines.join('\n') || 'Customer';

  // Company block
  const companyHTMLParts = [];
  if (companyName) companyHTMLParts.push(`<strong>${escapeHtml(companyName)}</strong>`);
  if (companyAddress) companyHTMLParts.push(escapeHtml(companyAddress));
  if (companyCity) companyHTMLParts.push(escapeHtml(companyCity));
  const contactLine = [companyEmail, companyPhone].filter(Boolean).join(' · ');
  if (contactLine) companyHTMLParts.push(escapeHtml(contactLine));
  const companyBlock = companyHTMLParts.length
    ? `<p>${companyHTMLParts.join('<br/>')}</p>`
    : '<p><strong>Company</strong></p>';

  // Build table rows
  const rowsHTML = normItems.map((r) => {
    return `<tr>
      <td>${escapeHtml(r.kind)}</td>
      <td>${escapeHtml(r.model)}</td>
      <td>${escapeHtml(r.size)}</td>
      <td>${escapeHtml(r.pcs)}</td>
      <td>${escapeHtml(r.mat)}</td>
      <td>${escapeHtml(r.col)}</td>
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
    <h1>${escapeHtml(companyName || 'Quote')} — Quote</h1>
    <div class="muted">${escapeHtml(invoiceLabel || '')} · Mode: ${escapeHtml(q?.mode || 'Individual')} · Tier: ${Number(q?.discountPct||0)}% · Currency: USD</div>
    <div class="recipient">${escapeHtml(recipientHTML)}</div>
  </div>
  <div class="company"><p><strong>Sensorite</strong></p></div>
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
    <tr><td colspan="7">MSRP subtotal</td><td colspan="2" style="text-align:right">${money(msrpSubtotal)}</td></tr>
    <tr><td colspan="7">Discounted subtotal</td><td colspan="2" style="text-align:right">${money(discountedSubtotal)}</td></tr>
    <tr><td colspan="7">You save</td><td colspan="2" style="text-align:right">${money(saved)}</td></tr>
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

// ---- utils ----
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

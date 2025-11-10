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
    const totalGiven = Number(it.total ?? 0) || 0;
    if (!unit && qty && totalGiven) unit = +(totalGiven / qty).toFixed(2);

    const total = qty * unit;
    return { kind, model, size, pcs, mat, col, qty, unit, total };
  }).filter((r) => r.qty > 0);

  // Money helpers
  const money = (n) =>
    (isFinite(n) ? n : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const msrpSubtotal = normItems.reduce((s, r) => s + r.total, 0);
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

  // Company block (DYNAMIC)
  const companyHTMLParts = [];
  if (companyName)  companyHTMLParts.push(`<strong>${escapeHtml(companyName)}</strong>`);
  if (companyAddress) companyHTMLParts.push(escapeHtml(companyAddress));
  if (companyCity)  companyHTMLParts.push(escapeHtml(companyCity));
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
/* Densify cells and allow wrapping without changing table width */
table { table-layout: fixed; }                /* keep column widths stable */
th, td {
  padding: 4px 6px;                           /* a bit tighter than current 6–8px */
  white-space: normal;                        /* allow line breaks */
  overflow-wrap: anywhere;                    /* break long tokens like model #s */
  word-break: break-word;
  hyphens: auto;                              /* nicer breaks when possible */
  vertical-align: middle;
  font-size: 12px;                            /* was 13px; small, legible shrink */
  line-height: 1.35;
}

/* Keep numbers tidy and on one line (Qty / Unit / Total) */
td:nth-child(7), td:nth-child(8), td:nth-child(9),
th:nth-child(7), th:nth-child(8), th:nth-child(9) {
  white-space: nowrap;
  text-align: right;
}

/* Make model #s slightly smaller, but still readable */
td:nth-child(2) { font-size: 11.5px; }

/* Optional: give the first column a touch more room; trade from Material/Color */
th:nth-child(1), td:nth-child(1) { width: 22%; }  /* Product / Kind */
th:nth-child(2), td:nth-child(2) { width: 14%; }  /* Model # */
th:nth-child(3), td:nth-child(3) { width: 9%; }   /* Size */
th:nth-child(4), td:nth-child(4) { width: 7%; }   /* Pieces */
th:nth-child(5), td:nth-child(5) { width: 16%; }  /* Material */
th:nth-child(6), td:nth-child(6) { width: 10%; }  /* Color */
th:nth-child(7), td:nth-child(7) { width: 6%; }   /* Qty */
th:nth-child(8), td:nth-child(8) { width: 8%; }   /* Unit */
th:nth-child(9), td:nth-child(9) { width: 8%; }   /* Total */

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
    <tr><td colspan="7">MSRP subtotal</td><td colspan="2" style="text-align:right">${money(msrpSubtotal)}</td></tr>
    <tr><td colspan="7">Discounted subtotal</td><td colspan="2" style="text-align:right">${money(discountedSubtotal)}</td></tr>
    <tr><td colspan="7">You save</td><td colspan="2" style="text-align:right">${money(saved)}</td></tr>
  </tfoot>
</table>

<!-- Payment Information -->
<section style="margin-top:20px;padding:12px 14px;border:1px solid #ddd;border-radius:8px;background:#f9f9f9;font-size:12.5px;line-height:1.5">
  <h3 style="margin:0 0 6px;font-size:14px;">Payment Options</h3>
  <ul style="list-style-type:none;padding:0;margin:0">
    <li><strong>Wire Transfer:</strong> Bank of America — Account No. 123456789 · SWIFT: BOFAUS3N</li>
    <li><strong>PayPal:</strong> payments@sensorite.com</li>
    <li><strong>Credit Card:</strong> Visa, MasterCard, and AmEx accepted</li>
  </ul>
  <p style="margin-top:8px;color:#666;font-size:11.5px">
    Please reference your invoice number when sending payment.
  </p>
</section>

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

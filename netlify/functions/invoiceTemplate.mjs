// netlify/functions/invoiceTemplate.mjs
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async (req, context) => {
  try {
    // 1) Answer the preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST required' }), {
        status: 405,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    }

    const { q, info, invoiceLabel, companyName } = await req.json().catch(() => ({}));
    const items = Array.isArray(q?.items) ? q.items : [];

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
    const money = (n) => {
      const num = typeof n === 'number' ? n : parseFloat(n || 0) || 0;
      return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    };
    const pick = (o, keys, def='') => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return def; };

    let msrpSubtotal = 0, discountedSubtotal = 0;
    const rows = items.map((it) => {
      const productKind = pick(it, ['name','title','product','label','kind'], '');
      const model       = pick(it, ['model','sku','handle','code'], '');
      const size        = pick(it, ['size'], '');
      const pieces      = pick(it, ['pieces','pcs'], '-');
      const material    = pick(it, ['material'], '');
      const color       = pick(it, ['color','colour'], '');
      const qty         = Number(pick(it, ['qty','quantity'], 0)) || 0;

      const unitRaw     = pick(it, ['unit','unitPrice','price','msrp','unit_price'], 0);
      const unit        = Number(unitRaw) || 0;

      const lineTotal   = qty * unit;
      const msrpUnit    = Number(pick(it, ['msrp','msrp_unit','unit_msrp'], unit)) || unit;
      const msrpTotal   = qty * msrpUnit;

      msrpSubtotal      += msrpTotal;
      discountedSubtotal+= lineTotal;

      return `
        <tr>
          <td>${esc(productKind)}</td>
          <td>${esc(model)}</td>
          <td>${esc(size)}</td>
          <td>${esc(pieces)}</td>
          <td>${esc(material)}</td>
          <td>${esc(color)}</td>
          <td style="text-align:right">${qty}</td>
          <td style="text-align:right">${money(unit)}</td>
          <td style="text-align:right">${money(lineTotal)}</td>
        </tr>`;
    }).join('');

    const youSave = Math.max(0, msrpSubtotal - discountedSubtotal);

    const customerBlock = (() => {
      const nm   = pick(info, ['name','fullName','customer_name','firstName'], '');
      const org  = pick(info, ['company','organization'], '');
      const ph   = pick(info, ['phone','tel','mobile'], '');
      const em   = pick(info, ['email','mail'], '');
      const lines = [
        nm && esc(nm),
        org && esc(org),
        ph && `Phone: ${esc(ph)}`,
        em && `Email: ${esc(em)}`
      ].filter(Boolean).join('\n');
      return esc(lines);
    })();

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
    <h1>${esc(companyName || 'Your Company')} — Quote</h1>
    <div class="muted">${esc(invoiceLabel || '')} · Mode: ${esc(q?.mode || 'Individual')} · Tier: ${esc(q?.discountPct ?? 0)}% · Currency: USD</div>
    <div class="recipient">${customerBlock}</div>
  </div>
  <div class="company"><p><strong>${esc(companyName || 'Your Company')}</strong></p></div>
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
    ${rows}
  </tbody>
  <tfoot>
    <tr><td colspan="7">MSRP subtotal</td><td colspan="2" style="text-align:right">${money(msrpSubtotal)}</td></tr>
    <tr><td colspan="7">Discounted subtotal</td><td colspan="2" style="text-align:right">${money(discountedSubtotal)}</td></tr>
    <tr><td colspan="7">You save</td><td colspan="2" style="text-align:right">${money(youSave)}</td></tr>
  </tfoot>
</table>

<div class="cta-row"></div>

</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { ...CORS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: 'template_failed', detail: String(e?.message || e) }), {
      status: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
};

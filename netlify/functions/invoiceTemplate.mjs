// netlify/functions/invoiceTemplate.mjs
export default async (req) => {
  // --- CORS / preflight ---
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
      },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const {
    invoice = {},
    company = {},
    recipient = {},
    items = [],
    totals = {},
    links = {},
    branding = {},
  } = data || {};

  // Minimal validation
  if (!company.name || !Array.isArray(items)) {
    return json({ error: "company.name and items[] required" }, 400);
  }

  // Helpers
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const num = (n, d = 2) =>
    isFinite(+n) ? (+n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : esc(n);

  const h1 = branding.headline || `${company.name} — Quote`;

  const metaLine = [
    invoice.label || "Invoice:",
    invoice.number || "",
    "· Mode:",
    invoice.mode || "Individual",
    "· Tier:",
    (invoice.tierPct ?? 0) + "%",
    "· Currency:",
    invoice.currency || "USD",
  ]
    .filter(Boolean)
    .join(" ");

  const recLines = [recipient.name, ...(recipient.lines || [])]
    .filter(Boolean)
    .map((l) => esc(l))
    .join("\n");

  const companyBlock = [
    `<p><strong>${esc(company.name)}</strong></p>`,
    ...(company.lines || []).map((l) => `<p>${esc(l)}</p>`),
    company.contact ? `<p>${esc(company.contact)}</p>` : "",
  ].join("");

  const rows = items
    .map((it) => {
      const qty = it.qty ?? it.quantity ?? it.q ?? 0;
      const unit = it.unit ?? it.price ?? it.unitPrice ?? 0;
      const total = it.total ?? qty * unit;
      return `
        <tr>
          <td>${esc(it.label ?? it.name ?? "")}</td>
          <td>${esc(it.model ?? it.sku ?? "")}</td>
          <td>${esc(it.size ?? "")}</td>
          <td>${esc(it.pieces ?? "-")}</td>
          <td>${esc(it.material ?? "")}</td>
          <td>${esc(it.color ?? "")}</td>
          <td style="text-align:right">${num(qty, 0)}</td>
          <td style="text-align:right">$${num(unit)}</td>
          <td style="text-align:right">$${num(total)}</td>
        </tr>`;
    })
    .join("");

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
    <h1>${esc(h1)}</h1>
    <div class="muted">${esc(metaLine)}</div>
    <div class="recipient">${recLines}</div>
  </div>
  <div class="company">${companyBlock}</div>
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
    <tr><td colspan="7">MSRP subtotal</td><td colspan="2" style="text-align:right">$${num(totals.msrpSubtotal ?? 0)}</td></tr>
    <tr><td colspan="7">Discounted subtotal</td><td colspan="2" style="text-align:right">$${num(totals.discountedSubtotal ?? totals.subtotal ?? 0)}</td></tr>
    <tr><td colspan="7">You save</td><td colspan="2" style="text-align:right">$${num(totals.youSave ?? 0)}</td></tr>
  </tfoot>
</table>

<div class="cta-row">
  ${links.payNow ? `<a class="cta-primary" href="${esc(links.payNow)}">Pay now</a>` : ""}
  ${links.viewDownload ? `<a class="cta-secondary" href="${esc(links.viewDownload)}">View &amp; download invoice</a>` : ""}
  ${links.editOrder ? `<a class="cta-secondary" href="${esc(links.editOrder)}">Edit order</a>` : ""}
</div>

</body>
</html>`;

  return json({ html }, 200);
};

// Small JSON helper
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

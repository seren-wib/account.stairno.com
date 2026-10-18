// Plain HTML with no styling: the rehearsal reads answers, it does not show a product.

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// JSON inside <script type="application/json">: `<` is escaped so no value can close the tag.
export function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function page(title, body, status = 200, headers = {}) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Stairno payment rehearsal</title>
</head>
<body>
<p><a href="/">Payment rehearsal</a></p>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  });
}

export function form(action, fields, label) {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
  return `<form method="post" action="${escapeHtml(action)}">${inputs}<button>${escapeHtml(label)}</button></form>`;
}

export function textForm(action, name, value, label) {
  return `<form method="post" action="${escapeHtml(action)}"><label>${escapeHtml(name)} <input name="${escapeHtml(name)}" value="${escapeHtml(value)}" size="40"></label> <button>${escapeHtml(label)}</button></form>`;
}

// What the API answered, as it answered it.
export function answer(what, result) {
  return `<h2>${escapeHtml(what)}</h2>
<p>HTTP ${escapeHtml(result.status)}</p>
<pre>${escapeHtml(JSON.stringify(result.body, null, 2))}</pre>`;
}

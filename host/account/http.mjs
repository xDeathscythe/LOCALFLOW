export function serviceUrl(value, allowLoopback = false) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use the HTTPS origin of the LocalFlow account service.');
  return url.origin;
}
export async function jsonRequest(url, { body, token, fetchImpl = fetch, method = body === undefined ? 'GET' : 'POST', ...options } = {}) {
  const response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...options });
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error || 'Account request failed.'); error.status = response.status; throw error; }
  return value;
}
export async function readBody(request, limit = 2_500_000) {
  let size = 0, body = '';
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 }); body += chunk; }
  try { return body ? JSON.parse(body) : {}; } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
export function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }); response.end(JSON.stringify(value));
}

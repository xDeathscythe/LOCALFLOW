// Native redirect URIs are registered by the operator, never supplied as a new allowlist by a client.
export function nativeRedirects(values = []) {
  return new Set(values.map(value => {
    const url = new URL(value);
    const privateScheme = /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/.test(url.protocol) && !url.host && url.pathname.startsWith('/');
    if ((!privateScheme && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname === '/') throw new Error('Register an exact HTTPS app link or reverse-domain native callback URI.');
    return url.href;
  }));
}

export function loginCallback(value, registered) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Invalid sign-in callback.'), { status: 400 }); }
  const loopback = url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.pathname === '/callback';
  if (url.username || url.password || url.search || url.hash || (!loopback && !registered.has(url.href))) throw Object.assign(new Error('This app callback is not registered with LocalFlow.'), { status: 400 });
  return url;
}

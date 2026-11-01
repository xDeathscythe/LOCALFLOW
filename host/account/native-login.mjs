import { jsonRequest, serviceUrl } from './http.mjs';

const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

// Shared by the desktop host and native mobile clients. Keep the attempt in OS secure storage.
export async function startNativeLogin({ origin, redirectUri, name, fetchImpl = fetch, allowLoopback = false }) {
  origin = serviceUrl(origin, allowLoopback);
  const verifier = random(), state = random();
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const started = await jsonRequest(origin + '/v1/login/start', { fetchImpl, body: { challenge, state, redirectUri, name } });
  const destination = new URL(started.authorizationUrl);
  if (destination.origin !== origin || destination.pathname !== '/connect' || destination.username || destination.password || destination.hash || destination.searchParams.get('request') !== started.requestId) throw new Error('The account service returned an invalid sign-in destination.');
  return { origin, verifier, state, redirectUri, requestId: started.requestId, authorizationUrl: destination.href, expiresAt: Date.now() + 10 * 60_000 };
}

export async function completeNativeLogin(attempt, callbackUrl, { fetchImpl = fetch } = {}) {
  if (!attempt || attempt.expiresAt <= Date.now()) throw new Error('Sign-in expired. Start again in LocalFlow.');
  const callback = new URL(callbackUrl), target = new URL(attempt.redirectUri);
  if (callback.protocol !== target.protocol || callback.host !== target.host || callback.pathname !== target.pathname || callback.username || callback.password || callback.hash || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.get('state') !== attempt.state || callback.searchParams.getAll('code').length !== 1) throw new Error('Invalid sign-in callback.');
  return jsonRequest(attempt.origin + '/v1/login/exchange', { fetchImpl, body: { requestId: attempt.requestId, code: callback.searchParams.get('code'), verifier: attempt.verifier } });
}

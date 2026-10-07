import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { openRemote, sealRemote } from './envelope.mjs';

// Executable protocol client for desktop QA and a later mobile implementation.
export async function connectRemoteNotes({ endpoint, ticket, clientKey, hostKey, fetchImpl = fetch }) {
  const post = async (path, value) => {
    const response = await fetchImpl(endpoint + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), redirect: 'error', signal: AbortSignal.timeout(30_000) });
    const body = await response.json();
    if (!body.envelope) throw Object.assign(new Error(body.error || 'Encrypted response is required.'), { status: response.status });
    return openRemote(body.envelope, clientKey);
  };
  const nonce = randomUUID();
  const opened = await post('/v1/session', { ticket, envelope: await sealRemote({ nonce, ticketId: decodeJwt(ticket).jti }, hostKey) });
  if (opened.requestId !== nonce) throw new Error('The host did not confirm its encryption key.');
  if (opened.status !== 200) throw Object.assign(new Error(opened.value.error), { status: opened.status });
  const session = opened.value;
  return { session, async request(operation, value = {}) {
    const id = randomUUID(), message = { id, token: session.token, operation, value, expiresAt: Date.now() + 60_000 };
    const result = await post('/v1/notes/request', { envelope: await sealRemote(message, hostKey) });
    if (result.requestId !== id) throw new Error('Encrypted response does not match its request.');
    return result;
  } };
}

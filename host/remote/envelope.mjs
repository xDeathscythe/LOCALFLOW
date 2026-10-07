import { promisify } from 'node:util';
import { generateKeyPair } from 'node:crypto';
import { CompactEncrypt, compactDecrypt, importJWK } from 'jose';
import { publicEncryptionKey } from '../account/protocol.mjs';
export { publicEncryptionKey } from '../account/protocol.mjs';
export async function createRemoteKey() {
  const pair = await promisify(generateKeyPair)('rsa', { modulusLength: 2048 });
  return { publicKey: pair.publicKey.export({ format: 'jwk' }), privateKey: pair.privateKey.export({ format: 'jwk' }) };
}
export async function sealRemote(value, publicKey) {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(value))).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM', typ: 'localflow+json' }).encrypt(await importJWK(publicEncryptionKey(publicKey), 'RSA-OAEP-256'));
}
export async function openRemote(envelope, privateKey) {
  if (typeof envelope !== 'string' || envelope.length > 16_000_000) throw new Error('Invalid encrypted Notes envelope.');
  const result = await compactDecrypt(envelope, await importJWK(privateKey, 'RSA-OAEP-256'), { keyManagementAlgorithms: ['RSA-OAEP-256'], contentEncryptionAlgorithms: ['A256GCM'] });
  if (result.protectedHeader.typ !== 'localflow+json') throw new Error('Invalid Notes envelope type.');
  return JSON.parse(new TextDecoder().decode(result.plaintext));
}

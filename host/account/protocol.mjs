export function publicEncryptionKey(value) {
  if (value?.kty !== 'RSA' || !/^[A-Za-z0-9_-]{342,684}$/.test(value.n || '') || value.e !== 'AQAB') throw new Error('A 2048–4096 bit RSA encryption key is required.');
  return { kty: 'RSA', n: value.n, e: value.e };
}

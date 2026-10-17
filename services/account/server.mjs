import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serviceUrl } from '../../host/account/http.mjs';
import { createTunnelProvisioner } from './cloudflare.mjs';
import { createBrokerServer } from './broker.mjs';

export async function createAccountBroker(options) {
  const { directory } = options;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyFile = join(directory, 'ticket-key.pem');
  if (!existsSync(keyFile)) { const { privateKey } = generateKeyPairSync('ed25519'); writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' }); }
  const db = new DatabaseSync(join(directory, 'accounts.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
  db.transaction = callback => { db.exec('BEGIN IMMEDIATE'); try { const result = callback(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const server = await createBrokerServer({ ...options, db, pem: readFileSync(keyFile, 'utf8') });
  return { server, close: () => new Promise(resolve => { server.close(() => { db.close(); resolve(); }); server.closeIdleConnections(); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { createClerkProvider } = await import('./clerk.mjs');
  const allowLoopback = process.argv.includes('--development');
  const origin = serviceUrl(process.env.LOCALFLOW_ACCOUNT_ORIGIN || '', allowLoopback), publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  const provider = createClerkProvider({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey, origin, calendarEnabled: process.env.LOCALFLOW_GOOGLE_CALENDAR_ENABLED === 'true' });
  const provisionTunnel = createTunnelProvisioner({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, zoneId: process.env.CLOUDFLARE_ZONE_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN, domain: process.env.LOCALFLOW_REMOTE_DOMAIN });
  const broker = await createAccountBroker({ directory: process.env.LOCALFLOW_ACCOUNT_DATA || './data', origin, provider, publishableKey, provisionTunnel, allowLoopback, mobileRedirectUris: JSON.parse(process.env.LOCALFLOW_MOBILE_REDIRECT_URIS || '[]') });
  broker.server.listen(Number(process.env.PORT || 8788), process.env.LOCALFLOW_ACCOUNT_BIND || '127.0.0.1', () => process.stdout.write('LocalFlow account service is listening.\n'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void broker.close().then(() => process.exit(0)));
}

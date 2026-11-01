import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { exportPKCS8, generateKeyPair } from 'jose';
import { createBrokerServer } from './broker.mjs';
import { createClerkProvider } from './clerk.mjs';

export class LocalFlowAccounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      let pem = await ctx.storage.get('ticket-key');
      if (!pem) {
        pem = await exportPKCS8((await generateKeyPair('EdDSA', { extractable: true })).privateKey);
        await ctx.storage.put('ticket-key', pem);
      }
      this.pem = pem;
    });
  }

  async fetch(request) {
    await this.ready;
    this.handler ||= this.createHandler(request);
    return (await this.handler).fetch(request);
  }

  async createHandler(request) {
    const origin = this.env.LOCALFLOW_ACCOUNT_ORIGIN || new URL(request.url).origin;
    const sql = this.ctx.storage.sql;
    const db = {
      exec: statement => sql.exec(statement),
      prepare: statement => ({
        get: (...args) => sql.exec(statement, ...args).toArray()[0],
        all: (...args) => sql.exec(statement, ...args).toArray(),
        run: (...args) => ({ changes: sql.exec(statement, ...args).rowsWritten }),
      }),
      transaction: callback => this.ctx.storage.transactionSync(callback),
    };
    const provider = createClerkProvider({ secretKey: this.env.CLERK_SECRET_KEY, publishableKey: this.env.CLERK_PUBLISHABLE_KEY, origin, calendarEnabled: this.env.LOCALFLOW_GOOGLE_CALENDAR_ENABLED === 'true' });
    // ponytail: one transactional registry fits the current service; shard by account when measured traffic requires it.
    const server = await createBrokerServer({ db, pem: this.pem, origin, provider, publishableKey: this.env.CLERK_PUBLISHABLE_KEY, mobileRedirectUris: JSON.parse(this.env.LOCALFLOW_MOBILE_REDIRECT_URIS || '[]'), clientAddress: req => req.headers['cf-connecting-ip'] || 'unknown' });
    return httpServerHandler(server);
  }
}

export default {
  fetch(request, env) {
    return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('localflow-accounts-v1')).fetch(request);
  },
};

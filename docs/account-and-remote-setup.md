# LocalFlow account, Calendar and remote Notes

Release 0.3.7 includes a dedicated account page, a profile entry, the Meetings calendar, registered mobile callbacks and a portable native client. The packaged account service is https://localflow-accounts.alnen96.workers.dev. LocalFlow owns its device registry, workspace access and encrypted Notes transport. A Clerk instance can be shared when the operator chooses; LocalFlow does not call the Niwa Code application. The mobile application itself is a later deliverable.

## Desktop setup

Open the profile menu and choose **Account & connections**. The same page opens from **Meetings → Connect Google**. A release can include an `account-service.json` containing only `{"serviceUrl":"https://accounts.example.com"}`; `scripts/package-windows.cjs` creates it from `LOCALFLOW_ACCOUNT_SERVICE_URL` or the repository's public configuration file. This lets installed apps open sign-in without asking each user to configure a server. Existing workspace ownership and operator overrides take precedence. Use **Connection setup → Check connection** to verify the service, and **Continue with Google** to open the system browser. A one-use code returns to a temporary loopback listener; its S256 PKCE verifier stays in the desktop host. An interrupted browser can be reopened from the account page.

Google profile and Calendar permissions share one account connection. Enable these scopes in the LocalFlow Clerk Google connection using your own production Google OAuth credentials:

- `openid`, `email`, `profile`
- `https://www.googleapis.com/auth/calendar.events.readonly`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

Enable Calendar API in the same Google project. The browser checks approved scopes and can reauthorize an existing Google connection. Users may continue without Calendar by clearing its checkbox. Missing/revoked permission is displayed separately from local Notes. Calendar selection and disabling sync do not require another identity. There is no Gmail mailbox permission.

Clerk's shared development Google client covers identity only. Its presence does not mean Calendar is configured. Calendar requires a Google OAuth client owned by the operator, Calendar API enabled, and incremental authorization of the Calendar scopes. Keep the shared Clerk connection's default scopes limited to identity. Reusing an existing Clerk instance also reuses that instance's user identity and Google grant; LocalFlow's Notes/workspaces remain independently owned and authorized.

The host stores its device credential and RSA private key through Windows DPAPI for the current Windows account. Its public config contains only service URL, owner ID, stable host/workspace IDs and preferences. A workspace keeps its original owner across sign-outs and refuses a different account. Local Notes remain usable without sign-in. Offline sign-out stops local remote access and clears credentials/cache; if server revocation cannot complete, the UI instructs the user to revoke that device from another connected device.

## Hosted account service

The LocalFlow service runs independently on Cloudflare Workers at `https://localflow-accounts.alnen96.workers.dev`. A SQLite-backed Durable Object persists the account/device registry and the ticket signing key across deployments. `broker.mjs` contains the same authorization and protocol implementation used by the Node service; `worker.mjs` only adapts persistent storage and HTTP. Clerk keys are Cloudflare secrets, never desktop resources. The registered native mobile callback is `app.localflow.mobile:/oauth/callback`.

Deploy with `npx wrangler deploy --config services/account/wrangler.jsonc` using the authorized Cloudflare account. Store Clerk credentials with `wrangler secret bulk` from a private ignored file. Never put secret values in command arguments or source control. The current Google OAuth application is in Testing and the Clerk instance is a shared development instance. The owner accounts can use the complete connection; unrestricted public onboarding requires Google verification and production Clerk configuration.

## Optional Node account service deployment

Use Node 24 or newer and a dedicated directory/OS account. From the repository root:

```sh
npm ci --prefix services/account
npm start --prefix services/account
```

The server also imports the dependency-free `host/account/http.mjs` and `host/account/protocol.mjs`. Deploy those paths along with `services/account`; do not copy desktop credentials or data. Production server variables:

| Variable | Purpose |
| --- | --- |
| `LOCALFLOW_ACCOUNT_ORIGIN` | Exact HTTPS service origin; also the allowed Clerk authorized party |
| `LOCALFLOW_ACCOUNT_DATA` | Private writable directory for accounts SQLite and signing key |
| `CLERK_PUBLISHABLE_KEY` | The LocalFlow Clerk application's public key |
| `CLERK_SECRET_KEY` | Server-only Clerk secret |
| `LOCALFLOW_GOOGLE_CALENDAR_ENABLED` | Set `true` only after configuring your own Google OAuth client, Calendar API and Calendar scopes in Clerk. Defaults to `false` so shared development credentials do not send users to a blocked consent flow. |
| `PORT` | Loopback HTTP listener, defaults to 8788 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for managed tunnels |
| `CLOUDFLARE_ZONE_ID` | DNS zone for the dedicated remote subdomain |
| `CLOUDFLARE_API_TOKEN` | Server-only token allowed to manage those tunnels and DNS records |
| `LOCALFLOW_REMOTE_DOMAIN` | Dedicated remote domain, without protocol; hostnames are `<host UUID>.<domain>` |
| `LOCALFLOW_MOBILE_REDIRECT_URIS` | JSON array of exact mobile callback URIs, such as `["com.example.localflow:/oauth/callback"]` or verified HTTPS app links |
| `LOCALFLOW_ACCOUNT_BIND` | Defaults to `127.0.0.1`; the container uses `0.0.0.0` behind the deployment's HTTPS proxy |

Terminate HTTPS at the deployment's reverse proxy and forward only to the loopback service. Keep its directory private, back up the SQLite database and `ticket-key.pem`, and exclude credentials from access/application logs. The service does not log request bodies or credentials. Configure the Clerk instance to allow its exact HTTPS origin and its `/connect` return route, with Google enabled. Clerk's Google callback belongs in the Google OAuth client configuration. No Google client secret is distributed in LocalFlow.

Alternatively build `docker build -f services/account/Dockerfile -t localflow-account .` from the repository root. Mount a private writable volume at `/data`, supply the environment variables at runtime, and expose it only behind your HTTPS proxy. The image copies named source files, never desktop data or `.env.local`.

For a local development check, create the ignored `services/account/.env.local` from `.env.example`, set `LOCALFLOW_ACCOUNT_ORIGIN=http://127.0.0.1:8788`, and run `npm run dev --prefix services/account`. Launch the source desktop with `LOCALFLOW_ACCOUNT_SERVICE_URL` set to that origin and `LOCALFLOW_ACCOUNT_DEVELOPMENT=1`. HTTP is accepted only with this explicit development flag. Development keys are server-only and must never be bundled in a desktop or mobile release.

On this Windows checkout, `powershell -File scripts/start-account-development.ps1` checks/starts the configured development service and opens the current Windows package with an isolated profile at `local-data/account-development`. This avoids permanently binding the everyday Notes workspace to a temporary development service. Add `-ServiceOnly` to start/check just the service. The local environment has already been configured with the owner-authorized Clerk development keys; they are ignored by Git and excluded from packages. Configure the stable HTTPS service in the everyday profile when deployment is ready.

The account service stores profile identity, registered device hashes, host ownership/endpoints and one-use ticket records. Google access tokens are retrieved through Clerk's Backend API and used only for the Calendar API. They never return to the desktop/UI. A daily bounded full snapshot (previous 30 days, next 180 days), paginated incremental sync, cancellations and expired sync-token recovery are supported. The host caches events per owner; sign-out clears them.

## Remote access

Enable **Remote Notes** after sign-in. With the hosted service, the computer opens an outbound Cloudflare Quick Tunnel and publishes its current HTTPS endpoint to its authenticated LocalFlow host record. This matches the direct PC transport used by Niwa Code. An operator can instead configure the managed tunnel provisioner for a stable host-specific DNS record. The desktop starts the installed `cloudflared` binary with a hidden console and loopback readiness checks. The Quick Tunnel address comes from cloudflared's structured `/quicktunnel` JSON endpoint. No translated log text is interpreted. Managed tunnel tokens are passed only in the process environment. It reconnects with bounded backoff; heartbeat determines online/offline status. An optional executable path is available in Connection setup or `LOCALFLOW_CLOUDFLARED_EXE`.

The current package expects `cloudflared` to be installed by the operator/distributor; it does not silently download executables. If the binary is absent, the UI reports it and local Notes continue working. Quick Tunnels have temporary addresses and no uptime guarantee; the registry updates after reconnecting. Managed tunnels remain available for production deployments needing controlled DNS. The computer must remain awake and online.

Cloudflare terminates outer HTTPS. Notes, session credentials and attachment chunks therefore also use standard **JWE RSA-OAEP-256 / A256GCM** between the client and desktop via `jose`. The broker registry binds the host's public encryption key to its owner. Its signed 60-second ticket binds owner, device, host, workspace, permissions, client public key and host key thumbprint. An encrypted challenge confirms host key possession when opening a session; each encrypted response matches its encrypted request ID. No plaintext Notes endpoint exists. The broker sees connection/calendar metadata, not Notes text or audio. A compromised trusted account broker could substitute registry keys; deployment must protect that service and its signing key.

An access ticket is consumed once in durable broker storage. Remote sessions last five minutes. Every operation rechecks device revocation and host enablement; loss of the broker connection fails closed. Each encrypted request also carries a unique ID and short expiry. Device revocation invalidates its next request, including an existing session. Disable Remote Notes closes the local listener/tunnel immediately. Server-side permissions are an explicit Notes allowlist, never an arbitrary host method or filesystem proxy.

The public listener accepts at most two concurrent requests, 60 requests per ten-second window and 16 connections. It rejects oversized declared bodies before reading them and closes overloaded connections. These limits also cover unauthenticated encryption work. Clients receiving 429 should honor `Retry-After`. Failures while encrypting error responses close the connection without escaping the HTTP handler.

## Protocol and Notes synchronization

The shared native authentication client is `host/account/native-login.mjs`, used by the desktop host as well as future mobile integrations. `startNativeLogin` creates a PKCE attempt; save it in the platform keychain until the system browser returns to the registered callback. `completeNativeLogin` verifies the exact callback, state and expiry before exchanging the one-use code. Register the app's real reverse-domain URI scheme or verified HTTPS app link in `LOCALFLOW_MOBILE_REDIRECT_URIS`; unregistered destinations and callback query/fragment overrides are rejected. Use the returned credential with `accountClient` in `host/account/connected-notes.mjs`. `profile`, `computers`, `devices`, `renew` and `revoke` operate on that device's authenticated account. `connect()` automatically selects the only online enabled computer; multiple computers require an explicit `hostId`. It obtains a short-lived ticket and returns the encrypted Notes client. The default permission is read-only.

These modules use Web Crypto and `jose`, with no Node-only imports in their client dependency graph. A native mobile app supplies its native HTTP implementation as `fetchImpl` and saves credentials in Keychain/Keystore. The service rejects arbitrary browser origins; this is a native client contract, not a public browser CORS API. The protocol client is executable and tested, but it does not create an Android/iOS application or an offline mobile cache.

Call `connectRemoteNotes({ endpoint, ticket, clientKey: privateJwk, hostKey: registryPublicJwk })`. Its `request(operation,value)` returns an encrypted, checked `{status,value}` response. Supported operations:

| Operation | Request / behavior |
| --- | --- |
| `snapshot` | Tree, tree revision and atomic change cursor; content is loaded per note |
| `changes` | `{cursor,limit}`; durable changes including tombstones, with pagination |
| `read` | `{id}`; rich document, Markdown and revision; local filesystem paths removed |
| `apply` | `{operationId,operation,value,treeRevision}` for create/save/rename/move/remove/restore |
| `asset` | `{noteId,url,offset?,etag?}`; encrypted chunks of at most 1 MiB, resumable with etag checking |

`save` requires the note's revision in `value`. Structural operations require the snapshot's `treeRevision`. HTTP/envelope status 409 preserves the server revision and returns conflict information; a mobile client should keep its draft and offer resolution. It must never silently overwrite. Repeating an operation ID with the same intent returns the original committed result; a different intent is rejected. The operation ledger and changes commit inside the same canonical Notes SQLite transaction, including a restart between commit and response. No separate SQLite file is synchronized. The current contract covers note/folder operations; database-specific editing remains local until the mobile client implements that separate model.

Attachment URLs must be referenced by the requested note and resolve inside an approved import directory after realpath verification. Clients cannot request arbitrary paths. Each chunk and response is encrypted. Existing audio meeting files are not exposed as arbitrary attachments. A mobile cache and queued edits must be scoped to the account/workspace and are future mobile implementation work; no mobile cache is claimed here.

## Verification and remaining deployment checks

Run `node tests/account-remote.test.mjs` after installing repository dependencies. It starts isolated real HTTP listeners with fixture identity/calendar providers and verifies PKCE interception/replay, wrong-owner isolation, forged tickets, one-use redemption, JWE request replay/downgrade protection, immediate revocation, Notes conflicts/idempotent retries/restart/tombstones, encrypted attachment resume, Calendar 410 recovery, account cache isolation and actual Windows DPAPI. Clerk's backend SDK is loaded only by the production broker entry point.

`npm run test:account` also verifies mobile callbacks/state/expiry, profile restoration, automatic computer selection, authenticated computer rename and the Calendar configuration gate. `node tests/native-desktop.test.cjs <executable> --account --packaged` covers the native account page and navigation from Meetings in the packaged app. Version 0.3.7 passed this check. These fixtures do not establish a Google Calendar grant, a deployed managed tunnel, or a real phone connection.

On 8 October 2026 the existing owner-authorized Niwa Code Clerk development instance was configured with the separate LocalFlow Google client in project `localflow-510922`. Calendar API is enabled, the consent screen declares only identity and read-only Calendar scopes, and the two owner test accounts are registered. The custom Google client was saved through the authenticated official Clerk CLI, while default Google sign-in scopes remain limited to identity. Real incremental Calendar consent succeeded for the owner's account: LocalFlow retrieved three calendars and completed synchronization.

The account service is deployed at the public HTTPS address above and its configuration reports Calendar and Quick Tunnel support. Tests use isolated Notes workspaces and never publish the everyday Notes workspace without its Remote Notes setting. Desktop credentials and encryption keys remain protected by Windows DPAPI. The Android/iOS user interface itself is future work; the native sign-in, account discovery and encrypted read/write client are implemented now.

Live verification used two separately authenticated device credentials against the deployed service and a real Quick Tunnel. Encrypted creation and reading of a multilingual note, retry without duplication, and immediate revocation all passed. The primary Windows LocalFlow profile is connected to the public service and completed synchronization of its selected calendar from the three returned calendars. Remote Notes remains disabled on the everyday workspace until enabled in the app. The 0.3.7 packaged native account-page check passed, including its preconfigured HTTPS address. Existing Notes and the running older application were preserved.

Provider references: [Clerk social scopes](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/overview), [Clerk provider tokens](https://clerk.com/docs/reference/backend/user/get-user-oauth-access-token), [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), [Cloudflare tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

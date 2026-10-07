# LocalFlow account, Calendar and remote Notes

This module is implemented in desktop release 0.3.0. The mobile app is a later deliverable. Google/Clerk production credentials, a deployed account service and a managed remote domain are operator prerequisites; no Niwa production account or server was changed while implementing it.

## Desktop setup

Open **Settings → Account & connections → Connection setup** and enter the HTTPS origin of your LocalFlow account service. A distributor can set `LOCALFLOW_ACCOUNT_SERVICE_URL` instead. Select **Continue with Google**. The system browser completes Clerk/Google authorization, then returns a one-use code to a temporary `127.0.0.1` listener. An S256 PKCE verifier remains inside the desktop host. The browser never receives a desktop credential or private Notes key.

Google profile and Calendar permissions share one account connection. Enable these scopes in the LocalFlow Clerk Google connection using your own production Google OAuth credentials:

- `openid`, `email`, `profile`
- `https://www.googleapis.com/auth/calendar.events.readonly`
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

Enable Calendar API in the same Google project. The browser checks approved scopes and can reauthorize an existing Google connection. Users may continue without Calendar by clearing its checkbox. Missing/revoked permission is displayed separately from local Notes. Calendar selection and disabling sync do not require another identity. There is no Gmail mailbox permission.

The host stores its device credential and RSA private key through Windows DPAPI for the current Windows account. Its public config contains only service URL, owner ID, stable host/workspace IDs and preferences. A workspace keeps its original owner across sign-outs and refuses a different account. Local Notes remain usable without sign-in. Offline sign-out stops local remote access and clears credentials/cache; if server revocation cannot complete, the UI instructs the user to revoke that device from another connected device.

## Account service deployment

Use Node 24 or newer and a dedicated directory/OS account. From the repository root:

```sh
npm ci --prefix services/account
node services/account/server.mjs
```

The server also imports the dependency-free `host/account/http.mjs` and `host/account/protocol.mjs`. Deploy those paths along with `services/account`; do not copy desktop credentials or data. Production server variables:

| Variable | Purpose |
| --- | --- |
| `LOCALFLOW_ACCOUNT_ORIGIN` | Exact HTTPS service origin; also the allowed Clerk authorized party |
| `LOCALFLOW_ACCOUNT_DATA` | Private writable directory for accounts SQLite and signing key |
| `CLERK_PUBLISHABLE_KEY` | The LocalFlow Clerk application's public key |
| `CLERK_SECRET_KEY` | Server-only Clerk secret |
| `PORT` | Loopback HTTP listener, defaults to 8788 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for managed tunnels |
| `CLOUDFLARE_ZONE_ID` | DNS zone for the dedicated remote subdomain |
| `CLOUDFLARE_API_TOKEN` | Server-only token allowed to manage those tunnels and DNS records |
| `LOCALFLOW_REMOTE_DOMAIN` | Dedicated remote domain, without protocol; hostnames are `<host UUID>.<domain>` |

Terminate HTTPS at the deployment's reverse proxy and forward only to the loopback service. Keep its directory private, back up the SQLite database and `ticket-key.pem`, and exclude credentials from access/application logs. The service does not log request bodies or credentials. Configure the Clerk instance to allow its exact HTTPS origin and its `/connect` return route, with Google enabled. Clerk's Google callback belongs in the Google OAuth client configuration. No Google client secret is distributed in LocalFlow.

The account service stores profile identity, registered device hashes, host ownership/endpoints and one-use ticket records. Google access tokens are retrieved through Clerk's Backend API and used only for the Calendar API. They never return to the desktop/UI. A daily bounded full snapshot (previous 30 days, next 180 days), paginated incremental sync, cancellations and expired sync-token recovery are supported. The host caches events per owner; sign-out clears them.

## Managed remote access

Enable **Remote Notes** after sign-in. The service provisions a Cloudflare tunnel and a host-specific DNS record. The desktop starts the installed `cloudflared` binary with a token in its process environment, hidden console and loopback readiness checks. The token is not placed in command arguments or UI state. It reconnects with bounded backoff; heartbeat determines online/offline status. An optional executable path is available in Connection setup or `LOCALFLOW_CLOUDFLARED_EXE`.

The current package expects `cloudflared` to be installed by the operator/distributor; it does not silently download executables. If the service's managed tunnel configuration or binary is absent, the UI reports the missing setup and local Notes continue working. Quick Tunnels are not used. The computer must remain awake and online.

Cloudflare terminates outer HTTPS. Notes, session credentials and attachment chunks therefore also use standard **JWE RSA-OAEP-256 / A256GCM** between the client and desktop via `jose`. The broker registry binds the host's public encryption key to its owner. Its signed 60-second ticket binds owner, device, host, workspace, permissions, client public key and host key thumbprint. An encrypted challenge confirms host key possession when opening a session; each encrypted response matches its encrypted request ID. No plaintext Notes endpoint exists. The broker sees connection/calendar metadata, not Notes text or audio. A compromised trusted account broker could substitute registry keys; deployment must protect that service and its signing key.

An access ticket is consumed once in durable broker storage. Remote sessions last five minutes. Every operation rechecks device revocation and host enablement; loss of the broker connection fails closed. Each encrypted request also carries a unique ID and short expiry. Device revocation invalidates its next request, including an existing session. Disable Remote Notes closes the local listener/tunnel immediately. Server-side permissions are an explicit Notes allowlist, never an arbitrary host method or filesystem proxy.

The public listener accepts at most two concurrent requests, 60 requests per ten-second window and 16 connections. It rejects oversized declared bodies before reading them and closes overloaded connections. These limits also cover unauthenticated encryption work. Clients receiving 429 should honor `Retry-After`. Failures while encrypting error responses close the connection without escaping the HTTP handler.

## Protocol and Notes synchronization

The executable reference client is `host/remote/client.mjs`; it does not create a mobile app. A registered client gets the owner's computers from `GET /v1/hosts`, creates a temporary RSA key and requests `POST /v1/tickets` with `hostId`, `workspaceId`, `permission: "read" | "write"` and `clientKey`. Select the only online permitted computer automatically, or preserve an explicit selection when multiple computers exist. The client must authenticate before requesting a ticket.

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

`npx tsc --noEmit` and `node tests/notes-editing-store.test.mjs` also passed during implementation. These fixtures do not establish a live Google OAuth grant, deployed managed Cloudflare tunnel or cross-network mobile connection. Finish those checks using the dedicated LocalFlow credentials/domain before claiming production connectivity. No production secrets were present in the checked LocalFlow configuration, and none were invented or copied from Niwa.

Provider references: [Clerk social scopes](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/overview), [Clerk provider tokens](https://clerk.com/docs/reference/backend/user/get-user-oauth-access-token), [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync), [Cloudflare tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

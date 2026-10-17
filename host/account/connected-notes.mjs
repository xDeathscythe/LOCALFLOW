import { jsonRequest, serviceUrl } from './http.mjs';
import { createRemoteKey } from '../remote/envelope.mjs';
import { connectRemoteNotes } from '../remote/client.mjs';

// The caller stores its device credential in the platform keychain and supplies native HTTP on mobile.
export function accountClient({ origin, token, fetchImpl = fetch }) {
  origin = serviceUrl(origin);
  const request = (path, body) => jsonRequest(origin + path, { token, body, fetchImpl });
  return {
    profile: () => request('/v1/me'),
    computers: async () => (await request('/v1/hosts')).hosts,
    devices: async () => (await request('/v1/devices')).devices,
    renew: () => request('/v1/device/renew', {}),
    revoke: deviceId => request('/v1/devices/revoke', { deviceId }),
    async connect({ hostId, permission = 'read' } = {}) {
      const computers = (await request('/v1/hosts')).hosts;
      const available = computers.filter(host => host.online && host.enabled);
      const host = hostId ? available.find(host => host.id === hostId) : available.length === 1 ? available[0] : null;
      if (!host) throw Object.assign(new Error(available.length > 1 ? 'Choose a computer to open its Notes.' : 'Open LocalFlow on your computer and enable Remote Notes.'), { code: available.length > 1 ? 'choose-computer' : 'computer-offline', computers });
      const endpoint = serviceUrl(host.endpoint), keys = await createRemoteKey();
      const access = await request('/v1/tickets', { hostId: host.id, workspaceId: host.workspaceId, permission, clientKey: keys.publicKey });
      if (access.endpoint !== endpoint) throw new Error('The computer address changed. Refresh your computers and reconnect.');
      const connection = await connectRemoteNotes({ endpoint, ticket: access.ticket, clientKey: keys.privateKey, hostKey: host.encryptionKey, fetchImpl });
      return { ...connection, computer: host };
    },
  };
}

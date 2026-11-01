export function createTunnelProvisioner({ accountId, zoneId, apiToken, domain, fetchImpl = fetch }) {
  if (![accountId, zoneId, apiToken, domain].every(Boolean)) return null;
  if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error('Invalid remote domain.');
  const api = async (path, method = 'GET', body) => {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/${path}`, { method, headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    const value = await response.json();
    if (!response.ok || !value.success) throw Object.assign(new Error('Managed tunnel provisioning failed. Contact the LocalFlow service operator.'), { status: 502 });
    return value.result;
  };
  return async ({ hostId, port, existingTunnelId }) => {
    const hostname = `${hostId}.${domain}`;
    const tunnelId = existingTunnelId || (await api(`accounts/${accountId}/cfd_tunnel`, 'POST', { name: `localflow-${hostId}`, config_src: 'cloudflare' })).id;
    try {
      await api(`accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, 'PUT', { config: { ingress: [{ hostname, service: `http://127.0.0.1:${port}` }, { service: 'http_status:404' }] } });
      const records = await api(`zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`);
      const record = { type: 'CNAME', name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true };
      if (!records.length) await api(`zones/${zoneId}/dns_records`, 'POST', record);
      else if (records[0].content !== record.content) await api(`zones/${zoneId}/dns_records/${records[0].id}`, 'PUT', record);
      const token = await api(`accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
      return { tunnelId, endpoint: `https://${hostname}`, token };
    } catch (error) { if (!existingTunnelId) await api(`accounts/${accountId}/cfd_tunnel/${tunnelId}`, 'DELETE').catch(() => {}); throw error; }
  };
}

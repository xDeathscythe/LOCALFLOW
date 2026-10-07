// Pinned Codex 0.159 supports these feature flags and thread-specific MCP inventory.
// Read configuration before supplying any transcript. Never inherit executable integrations.
export async function summaryIsolation(client, cwd) {
  const { config } = await client.request('config/read', { cwd, includeLayers: false });
  if (!config || typeof config !== 'object') throw new Error('Cannot verify the meeting summary runtime configuration.');
  const features = Object.fromEntries([
    'shell_tool', 'unified_exec', 'view_image', 'multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'remote_plugin', 'hooks',
    'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'computer_use', 'memories', 'skill_search',
    'skill_mcp_dependency_install', 'code_mode', 'code_mode_host', 'code_mode_only', 'artifact', 'image_generation',
    'sleep_tool', 'workspace_dependencies', 'goals', 'worktrees', 'in_app_browser',
  ].map(name => [name, false]));
  features.skip_host_skill_discovery = true;
  return { web_search: 'disabled', project_doc_max_bytes: 0, features,
    mcp_servers: Object.fromEntries(Object.keys(config.mcp_servers || {}).map(name => [name, { enabled: false }])),
  };
}

export async function assertSummaryIsolation(client, threadId) {
  const inventory = await client.request('mcpServerStatus/list', { threadId, limit: 100 });
  // Fail closed, including an unreadable/partial inventory or an unexpected future integration.
  if (!Array.isArray(inventory.data) || inventory.nextCursor || inventory.data.some(server => server.runtimeStatus !== 'disabled' || !server.tools || Object.keys(server.tools).length || server.resources?.length || server.resourceTemplates?.length || server.toolsError)) throw new Error('The summary runtime still exposes an integration. The transcript was not sent.');
}

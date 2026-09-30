const { protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
protocol.registerSchemesAsPrivileged([{ scheme: 'localflow-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
module.exports = async root => {
  const { resolveAsset } = await import('./notion-import.mjs');
  const allowed = new Set(['.png','.jpg','.jpeg','.gif','.webp','.avif','.svg','.mp4','.mov','.webm','.mp3','.wav','.ogg','.pdf','.csv','.txt']);
  protocol.handle('localflow-asset', request => {
    try { const file = resolveAsset(root,request.url); if (!allowed.has(path.extname(file).toLowerCase())) return new Response('Unsupported file type',{status:415}); return net.fetch(pathToFileURL(file).href); }
    catch { return new Response('Asset not found',{status:404}); }
  });
  return url => { const file=resolveAsset(root,url); shell.showItemInFolder(file); };
};

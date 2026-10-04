export function assetUrl(value?: string) {
  if (!value?.startsWith('localflow-asset://')) return value;
  return 'http://localflow-asset.localhost/' + value.slice('localflow-asset://'.length);
}

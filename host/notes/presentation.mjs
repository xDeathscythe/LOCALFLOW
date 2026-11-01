export function validatePresentation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid page appearance.');
  const result = {};
  for (const key of ['wide', 'small', 'locked', 'wiki']) if (key in value) {
    if (typeof value[key] !== 'boolean') throw new Error('Invalid page width.');
    result[key] = value[key];
  }
  if ('font' in value) { if (!['default','serif','mono'].includes(value.font)) throw new Error('Invalid page font.'); result.font = value.font; }
  for (const key of ['cover', 'icon']) if (key in value) {
    if (typeof value[key] !== 'string' || value[key].length > 4096 || (value[key] && !['localflow-asset:', 'https:', 'http:'].includes(new URL(value[key]).protocol))) throw new Error('Invalid page image.');
    result[key] = value[key];
  }
  if ('iconText' in value) {
    if (typeof value.iconText !== 'string' || value.iconText.length > 32) throw new Error('Use a short page icon.');
    result.iconText = value.iconText;
  }
  if ('coverPosition' in value) {
    if (!Number.isFinite(value.coverPosition) || value.coverPosition < 0 || value.coverPosition > 100) throw new Error('Invalid cover position.');
    result.coverPosition = value.coverPosition;
  }
  return result;
}

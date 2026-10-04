const { build } = require('../package.json');

// The full, optional voice-cloning distribution has its own staging profile.
module.exports = {
  ...build,
  files: build.files.filter(file => file !== 'dist/**/*').concat({ from: 'runtime/release-ui', to: 'dist', filter: ['**/*'] }),
  extraResources: build.extraResources.map(item => item.from === 'runtime/distribution'
    ? { ...item, from: 'runtime/distribution-full' } : item),
};

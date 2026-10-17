const fs = require('node:fs');
const path = require('node:path');
module.exports = profile => {
  const idea = { title: 'A different narrator', body: 'Revisit a scene through someone who witnessed it from the outside.', sources: [] };
  fs.writeFileSync(path.join(profile, 'niwa/brainstorm.json'), JSON.stringify({ version: 1, revision: 1,
    home: { present: idea, ideas: [idea, { ...idea, title: 'The unfinished letter' }, { ...idea, title: 'A place to return to' }], thoughts: [idea, { ...idea, title: 'What a small choice changes' }, { ...idea, title: 'Leave room for a surprise' }], generatedAt: Date.now() }, feedback: [],
    sessions: [{ id: 'fixture-path', mode: 'paths', title: idea.title, seed: idea.body, messages: [], nodes: [{ id: 'root', parentId: '', ...idea }, ...Array.from({ length: 5 }, (_, i) => ({ id: `path-${i}`, parentId: 'root', title: ['A witness speaks', 'Follow the letter', 'A different ending', 'The story before', 'Two accounts'][i], body: 'A narrative direction to explore.', suggested: true }))], selectedId: 'root', pins: [], edges: [], updatedAt: Date.now(), reminder: false, nextCheckIn: 0 }],
  }));
};

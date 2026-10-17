const fs = require('node:fs');
const path = require('node:path');
// Prepared modules let the native check open every space without a model connection.
module.exports = profile => {
  const at = Date.now(), idea = (title, body) => ({ title, body, sources: ['fixture-note'] });
  const sources = { 'fixture-note': { kind: 'note', label: 'A scene from the old house' } };
  const directions = ['A witness speaks', 'Follow the letter', 'A different ending', 'The story before', 'Two accounts'].map(title => ({ title, body: 'A narrative direction to explore.' }));
  const prepared = {
    present: { idea: idea('A different narrator', 'Revisit a scene through someone who witnessed it from the outside.'), origin: 'You described this scene in a note.', whyNow: 'You returned to it twice this week.', opening: 'Who saw that day from the outside?' },
    paths: { seeds: [idea('A different narrator', 'Revisit a scene from outside.'), idea('The unfinished letter', 'A letter never sent.'), idea('A place to return to', 'The house as a character.')].map(seed => ({ ...seed, branches: directions })) },
    story: { chapters: ['Before the move', 'The first year', 'This spring'].map((title, i) => ({ ...idea(title, 'What happened in this part of the story.'), when: ['Earlier', 'Last year', 'This spring'][i] })), patterns: [{ title: 'Returning to places', body: 'Places carry the turning points.' }, { title: 'Writing as repair', body: 'Writing follows difficult weeks.' }], continuations: ['Go back', 'Write it down', 'Let it rest'].map(title => ({ title, body: 'A way the story could continue.', question: 'What fits today?' })) },
    challenges: { wins: [idea('Finished a chapter', 'You completed the first draft.')], struggles: [idea('Starting again', 'Returning after a break was hard.')], suggestions: ['One paragraph a day', 'Read it aloud', 'Ask one reader'].map(title => ({ title, why: 'It keeps momentum gentle.', firstStep: 'Write one paragraph today.', opening: 'How does this sound?' })) },
    board: { title: 'What connects the house', question: 'Which detail links these memories?', pins: [idea('The key', 'Still in the drawer.'), idea('The letter', 'Never sent.'), idea('The garden', 'Planted in spring.')], links: [{ from: 0, to: 1, label: 'kept together' }] },
    thoughts: { thoughts: ['A different narrator', 'What a small choice changes', 'Leave room for a surprise'].map(title => ({ ...idea(title, 'A thought to sit with.'), opening: 'What comes to mind?' })) },
  };
  fs.writeFileSync(path.join(profile, 'niwa/brainstorm.json'), JSON.stringify({ version: 2, revision: 1, feedback: [], sessions: [],
    prepared: Object.fromEntries(Object.entries(prepared).map(([mode, data]) => [mode, { generatedAt: at, stamp: 'fixture', data, sources }])) }));
};

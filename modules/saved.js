// saved.js — the "Saved" collection: all highlights grouped by topic, each
// linking back to its lesson.

import * as store from './store.js';
import { el, clear, toast, navigate, shareText, SHARE_ICON } from './ui.js';

export async function renderSaved(root) {
  clear(root);
  const [highlights, lessons, topics] = await Promise.all([
    store.getAll('highlights'),
    store.getAll('lessons'),
    store.getAll('topics'),
  ]);

  root.append(
    el('header', { class: 'view-head' }, [
      el('button', { class: 'link', onclick: () => navigate('#/dashboard') }, '← Home'),
      el('h1', {}, 'Saved'),
      el('p', { class: 'muted' }, 'Passages you highlighted or bookmarked.'),
    ])
  );

  if (!highlights.length) {
    root.append(
      el('div', { class: 'empty' }, [
        el('p', {}, 'Nothing saved yet.'),
        el('p', { class: 'muted' }, 'In any lesson: select text to highlight it, or tap the ⚐ on a passage to save it.'),
      ])
    );
    return;
  }

  const lessonById = Object.fromEntries(lessons.map((l) => [l.id, l]));
  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));

  // Group by topic, newest first within each.
  const byTopic = {};
  for (const h of highlights) {
    (byTopic[h.topicId] = byTopic[h.topicId] || []).push(h);
  }

  for (const [topicId, items] of Object.entries(byTopic)) {
    const section = el('section', { class: 'panel' }, [
      el('h4', {}, topicById[topicId]?.name || 'Other'),
    ]);
    items
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .forEach((h) => {
        const lesson = lessonById[h.lessonId];
        section.append(
          el('div', { class: 'saved-item' }, [
            el('blockquote', { class: 'saved-quote' }, h.text),
            el('div', { class: 'saved-meta' }, [
              lesson
                ? el('button', { class: 'link saved-src', onclick: () => navigate(`#/lesson/${lesson.id}`) }, lesson.title)
                : el('span', { class: 'muted' }, 'Lesson removed'),
              el('div', { class: 'saved-actions' }, [
                el('button', {
                  class: 'saved-share',
                  title: 'Share',
                  html: SHARE_ICON,
                  onclick: () => shareText({
                    title: lesson?.title || 'Ortiz Learning OS',
                    text: `“${h.text}”\n\n— ${lesson?.title || 'a lesson'} · Ortiz Learning OS`,
                  }),
                }),
                el('button', {
                  class: 'saved-del',
                  title: 'Remove',
                  onclick: async (e) => {
                    await store.remove('highlights', h.id);
                    toast('Removed');
                    renderSaved(root);
                  },
                }, '✕'),
              ]),
            ]),
          ])
        );
      });
    root.append(section);
  }
}

// Compact dashboard teaser: up to `limit` recent saves.
export async function recentHighlights(limit = 2) {
  const highlights = await store.getAll('highlights');
  return highlights
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, limit);
}

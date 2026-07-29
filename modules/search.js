// search.js — instant, fully local search across every lesson: titles,
// section text, glossaries, insights, examples. No index, no API — 200+
// lessons is nothing for a linear scan on-device.

import * as store from './store.js';
import { el, clear, navigate } from './ui.js';

// A short window of text around the first match, ellipsed on both sides.
function snippet(hay, idx, qLen) {
  const start = Math.max(0, idx - 60);
  const end = Math.min(hay.length, idx + qLen + 90);
  return (
    (start > 0 ? '…' : '') +
    hay.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < hay.length ? '…' : '')
  );
}

export async function renderSearch(root) {
  clear(root);
  const [topics, lessons] = await Promise.all([
    store.getAll('topics'),
    store.getAll('lessons'),
  ]);
  const topicById = new Map(topics.map((t) => [t.id, t]));

  // Precompute each lesson's searchable text once per view load.
  const haystacks = lessons.map((l) => ({
    l,
    title: (l.title || '').toLowerCase(),
    hay: [
      l.title,
      ...(l.sections || []).flatMap((s) => [s.heading, s.text]),
      ...(l.glossary || []).flatMap((g) => [g.term, g.definition]),
      ...(l.insights || []),
      l.example?.text,
      l.action,
    ].filter(Boolean).join('\n'),
  }));

  root.append(el('header', { class: 'view-head' }, [el('h1', {}, 'Search')]));

  const input = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search lessons, glossaries, examples…',
  });
  const results = el('div', { class: 'card-list search-results' });

  const run = () => {
    const q = input.value.trim().toLowerCase();
    clear(results);
    if (q.length < 2) return;

    const hits = [];
    for (const h of haystacks) {
      const idx = h.hay.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      hits.push({ ...h, idx, inTitle: h.title.includes(q) });
    }
    // Title matches first, then everything else in stored order.
    hits.sort((a, b) => b.inTitle - a.inTitle);

    if (!hits.length) {
      results.append(el('p', { class: 'empty' }, 'No matches.'));
      return;
    }
    for (const h of hits.slice(0, 30)) {
      const topic = topicById.get(h.l.topicId);
      results.append(
        el('button', { class: 'card', onclick: () => navigate(`#/lesson/${h.l.id}`) }, [
          el('div', { class: 'card-main' }, [
            el('h3', {}, h.l.title),
            el('p', { class: 'muted' }, snippet(h.hay, h.idx, q.length)),
            topic ? el('span', { class: 'pill' }, topic.name) : null,
          ]),
        ])
      );
    }
    if (hits.length > 30) {
      results.append(el('p', { class: 'muted small center' }, `Showing 30 of ${hits.length} matches — narrow the search.`));
    }
  };

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  });

  root.append(input, results);
  input.focus();
}

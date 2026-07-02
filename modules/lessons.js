// lessons.js — topics + lessons: list, detail, creation, and the lesson reader.

import * as store from './store.js';
import { generateLesson, hasApiKey } from './ai.js';
import { award } from './gamification.js';
import { SUGGESTED_TOPICS } from './suggestedTopics.js';
import { el, clear, paragraphs, rich, toast, loading, navigate } from './ui.js';

// Average mastery across a topic's concepts (0-100), for the progress bar.
async function topicMastery(topicId) {
  const concepts = (await store.getAll('concepts')).filter(
    (c) => c.topicId === topicId
  );
  if (!concepts.length) return null;
  const avg =
    concepts.reduce((a, c) => a + (c.masteryScore || 0), 0) / concepts.length;
  return Math.round(avg);
}

function masteryBar(pct) {
  return el('div', { class: 'bar' }, [
    el('div', { class: 'bar-fill', style: `width:${pct ?? 0}%` }),
  ]);
}

// ---------- Topics list ----------

export async function renderTopics(root) {
  clear(root);
  const topics = await store.getAll('topics');

  root.append(
    el('header', { class: 'view-head' }, [
      el('h1', {}, 'Topics'),
      el('button', { class: 'btn btn-primary', onclick: () => newTopicDialog(root) }, '+ New Topic'),
    ])
  );

  if (!topics.length) {
    // Empty state: surface suggestions front and center as the first action.
    root.append(
      el('div', { class: 'empty compact' }, [
        el('p', {}, 'No topics yet.'),
        el('p', { class: 'muted' }, 'Add a suggested topic below, or create your own.'),
      ])
    );
    renderSuggestions(root, topics, { expanded: true });
    return;
  }

  const list = el('div', { class: 'card-list' });
  for (const t of topics.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))) {
    const pct = await topicMastery(t.id);
    list.append(
      el('button', { class: 'card topic-card', onclick: () => navigate(`#/topic/${t.id}`) }, [
        el('div', { class: 'card-main' }, [
          el('h3', {}, t.name),
          t.description ? el('p', { class: 'muted' }, t.description) : null,
        ]),
        el('div', { class: 'card-meta' }, [
          el('span', { class: 'pill' }, `${(t.lessonIds || []).length} lessons`),
          pct != null ? masteryBar(pct) : null,
        ]),
      ])
    );
  }
  root.append(list);

  // When topics exist, keep suggestions available but tucked away.
  renderSuggestions(root, topics, { expanded: false });
}

// Curated one-tap suggestions. Dedupes against existing topics by name.
function renderSuggestions(root, existingTopics, { expanded }) {
  const existingNames = new Set(
    existingTopics.map((t) => (t.name || '').trim().toLowerCase())
  );

  const body = el('div', { class: 'suggest-body' + (expanded ? '' : ' collapsed') });

  const buildCard = (topic) => {
    const already = existingNames.has(topic.name.trim().toLowerCase());
    const card = el('button', {
      class: 'suggest-card' + (already ? ' added' : ''),
      disabled: already ? 'disabled' : null,
      onclick: already ? null : async () => {
        card.setAttribute('disabled', 'disabled');
        await store.put('topics', {
          name: topic.name,
          description: topic.description,
          lessonIds: [],
        });
        await award('topicCreated');
        toast(`Added “${topic.name}”`, 'success');
        renderTopics(root); // re-render so it flips to “Added” and joins the list
      },
    }, [
      el('div', { class: 'suggest-main' }, [
        el('span', { class: 'suggest-name' }, topic.name),
        el('span', { class: 'suggest-desc' }, topic.description),
      ]),
      el('span', { class: 'suggest-add' }, already ? '✓ Added' : '+ Add'),
    ]);
    return card;
  };

  for (const group of SUGGESTED_TOPICS) {
    body.append(el('h5', { class: 'suggest-cat' }, group.category));
    const grid = el('div', { class: 'suggest-grid' });
    group.topics.forEach((t) => grid.append(buildCard(t)));
    body.append(grid);
  }

  const header = el('button', { class: 'suggest-toggle' }, [
    el('span', {}, expanded ? 'Suggested topics' : 'Browse suggested topics'),
    el('span', { class: 'suggest-chevron' }, expanded ? '▾' : '▸'),
  ]);
  header.addEventListener('click', () => {
    body.classList.toggle('collapsed');
    const open = !body.classList.contains('collapsed');
    header.querySelector('.suggest-chevron').textContent = open ? '▾' : '▸';
  });

  root.append(el('section', { class: 'suggest' }, [header, body]));
}

function newTopicDialog(root) {
  const name = el('input', { class: 'input', placeholder: 'Topic name (e.g. Executive Communication)', autofocus: true });
  const desc = el('textarea', { class: 'input', rows: '2', placeholder: 'Optional description / focus' });

  const save = async () => {
    if (!name.value.trim()) return toast('Give the topic a name', 'warn');
    const topic = await store.put('topics', {
      name: name.value.trim(),
      description: desc.value.trim(),
      lessonIds: [],
    });
    await award('topicCreated');
    navigate(`#/topic/${topic.id}`);
  };

  showModal('New Topic', [name, desc], save);
}

// ---------- Topic detail ----------

export async function renderTopic(root, { id }) {
  clear(root);
  const topic = await store.get('topics', id);
  if (!topic) {
    root.append(el('p', { class: 'empty' }, 'Topic not found.'));
    return;
  }
  const lessons = (await store.getAll('lessons')).filter((l) => l.topicId === id);
  const pct = await topicMastery(id);

  root.append(
    el('header', { class: 'view-head' }, [
      el('button', { class: 'link', onclick: () => navigate('#/topics') }, '← Topics'),
      el('h1', {}, topic.name),
      topic.description ? el('p', { class: 'muted' }, topic.description) : null,
      pct != null ? el('div', { class: 'topic-mastery' }, [el('span', { class: 'muted' }, `Mastery ${pct}%`), masteryBar(pct)]) : null,
    ])
  );

  root.append(
    el('button', { class: 'btn btn-primary full', onclick: () => generateLessonFor(topic, root) }, '✨ Generate a lesson')
  );

  if (!lessons.length) {
    root.append(el('p', { class: 'muted center' }, 'No lessons yet — generate your first.'));
    return;
  }

  const list = el('div', { class: 'card-list' });
  for (const l of lessons.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))) {
    list.append(
      el('button', { class: 'card lesson-card', onclick: () => navigate(`#/lesson/${l.id}`) }, [
        el('div', { class: 'card-main' }, [
          el('h3', {}, l.title),
          el('p', { class: 'muted' }, (l.objectives || []).slice(0, 1).join('')),
        ]),
        el('span', { class: l.completedAt ? 'pill pill-done' : 'pill' }, l.completedAt ? 'Completed' : 'New'),
      ])
    );
  }
  root.append(list);
}

async function generateLessonFor(topic, root) {
  if (!hasApiKey()) {
    toast('Add your Claude API key in Settings first', 'warn');
    return navigate('#/settings');
  }
  loading(root, 'Generating your lesson…');
  try {
    const priorTitles = (await store.getAll('lessons'))
      .filter((l) => l.topicId === topic.id)
      .map((l) => l.title);
    const data = await generateLesson({
      topicName: topic.name,
      topicDescription: topic.description,
      priorTitles,
    });

    const lesson = await store.put('lessons', {
      topicId: topic.id,
      title: data.title,
      objectives: data.objectives || [],
      concepts: data.concepts || [],
      body: data.body || '',
      insights: data.insights || [],
      action: data.action || '',
      leadershipTakeaway: data.leadershipTakeaway || '',
      productivityTip: data.productivityTip || '',
      discussionQ: data.discussionQ || '',
      completedAt: null,
    });

    // Register concepts (mastery accumulation — v2 foundation).
    for (const name of lesson.concepts) {
      const existing = (await store.getAll('concepts')).find(
        (c) => c.topicId === topic.id && c.name === name
      );
      if (!existing) {
        await store.put('concepts', {
          name,
          topicId: topic.id,
          masteryScore: 0,
          lastReviewed: null,
          timesReviewed: 0,
        });
      }
    }

    topic.lessonIds = [...(topic.lessonIds || []), lesson.id];
    await store.put('topics', topic);

    navigate(`#/lesson/${lesson.id}`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Lesson generation failed', 'error');
    renderTopic(root, { id: topic.id });
  }
}

// ---------- Lesson reader ----------

export async function renderLesson(root, { id }) {
  clear(root);
  const lesson = await store.get('lessons', id);
  if (!lesson) {
    root.append(el('p', { class: 'empty' }, 'Lesson not found.'));
    return;
  }

  root.append(
    el('header', { class: 'view-head' }, [
      el('button', { class: 'link', onclick: () => navigate(`#/topic/${lesson.topicId}`) }, '← Topic'),
      el('h1', {}, lesson.title),
    ])
  );

  const article = el('article', { class: 'lesson' });

  if (lesson.objectives?.length) {
    article.append(
      el('section', { class: 'lesson-block' }, [
        el('h4', {}, 'Objectives'),
        el('ul', {}, lesson.objectives.map((o) => el('li', {}, o))),
      ])
    );
  }

  article.append(el('section', { class: 'lesson-body' }, paragraphs(lesson.body)));

  const closer = (label, value, cls = '') =>
    value ? el('div', { class: `closer ${cls}` }, [el('span', { class: 'closer-label' }, label), rich('p', {}, value)]) : null;

  article.append(
    el('section', { class: 'lesson-block' }, [
      el('h4', {}, 'Key insights'),
      el('ul', {}, (lesson.insights || []).map((i) => rich('li', {}, i))),
    ]),
    el('div', { class: 'closers' }, [
      closer('Do this today', lesson.action, 'closer-action'),
      closer('Leadership takeaway', lesson.leadershipTakeaway),
      closer('Productivity tip', lesson.productivityTip),
      closer('Discussion question', lesson.discussionQ, 'closer-q'),
    ])
  );

  article.append(
    el('button', { class: 'btn btn-primary full', onclick: () => navigate(`#/quiz/${lesson.id}`) },
      lesson.completedAt ? 'Retake quiz' : 'Start quiz →')
  );

  root.append(article);
}

// ---------- shared modal ----------

export function showModal(title, fields, onSave, saveLabel = 'Save') {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  const modal = el('div', { class: 'modal' }, [
    el('h3', {}, title),
    el('div', { class: 'modal-fields' }, fields),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn', onclick: close }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: async () => { await onSave(); close(); } }, saveLabel),
    ]),
  ]);
  overlay.append(modal);
  document.body.append(overlay);
  fields[0]?.focus?.();
}

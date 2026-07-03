// lessons.js — topics + lessons: list, detail, creation, and the lesson reader.

import * as store from './store.js';
import { generateLesson, generateSyllabus, hasApiKey } from './ai.js';
import { touchActivity } from './gamification.js';
import { SUGGESTED_TOPICS } from './suggestedTopics.js';
import { el, clear, paragraphs, rich, toast, loading, navigate, shareText, SHARE_ICON } from './ui.js';

// Formatted share text for a passage from a lesson.
function passageShare(text, lessonTitle) {
  return `“${text}”\n\n— ${lessonTitle} · Ortiz Learning OS`;
}

// Where a lesson sits in its topic's curriculum: { index, total } or null.
export function syllabusPosition(topic, lessonId) {
  const syl = topic?.syllabus || [];
  const i = syl.findIndex((e) => e.lessonId === lessonId);
  return i === -1 ? null : { index: i + 1, total: syl.length };
}

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
  const allLessons = await store.getAll('lessons');
  const readyCount = (t) =>
    allLessons.filter((l) => l.topicId === t.id && !l.completedAt).length;

  // Sort by what's actionable: ready-to-read lessons first, then planned
  // topics (syllabus exists), then the rest by recency.
  topics.sort((a, b) => {
    const ra = readyCount(a);
    const rb = readyCount(b);
    if (ra !== rb) return rb - ra;
    const sa = a.syllabus?.length ? 1 : 0;
    const sb = b.syllabus?.length ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  for (const t of topics) {
    const pct = await topicMastery(t.id);
    const ready = readyCount(t);
    const done = allLessons.filter((l) => l.topicId === t.id && l.completedAt).length;
    const progress = t.syllabus?.length
      ? `${done} of ${t.syllabus.length} done`
      : `${(t.lessonIds || []).length} lessons`;
    list.append(
      el('button', { class: 'card topic-card', onclick: () => navigate(`#/topic/${t.id}`) }, [
        el('div', { class: 'card-main' }, [
          el('h3', {}, t.name),
          t.description ? el('p', { class: 'muted' }, t.description) : null,
        ]),
        el('div', { class: 'card-meta' }, [
          ready ? el('span', { class: 'pill pill-pos' }, `${ready} ready`) : null,
          el('span', { class: done ? 'pill pill-done' : 'pill' }, progress),
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
        await touchActivity();
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
    await touchActivity();
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
    el('button', { class: 'btn btn-primary full', onclick: () => generateLessonFor(topic, root) },
      topic.syllabus?.length ? '✨ Generate next lesson' : '✨ Plan this topic & write lesson 1')
  );

  // Course plan: the syllabus with per-entry state.
  if (topic.syllabus?.length) {
    const byId = Object.fromEntries(lessons.map((l) => [l.id, l]));
    const plan = el('section', { class: 'plan panel' }, [el('h4', {}, 'Course plan')]);
    topic.syllabus.forEach((e, i) => {
      const lesson = e.lessonId ? byId[e.lessonId] : null;
      const state = lesson?.completedAt ? 'done' : lesson?.startedAt ? 'started' : lesson ? 'ready' : 'upcoming';
      const row = el(lesson ? 'button' : 'div', {
        class: `plan-row ${state}`,
        onclick: lesson ? () => navigate(`#/lesson/${lesson.id}`) : null,
      }, [
        el('span', { class: 'plan-num' }, state === 'done' ? '✓' : String(i + 1)),
        el('div', { class: 'plan-main' }, [
          el('span', { class: 'plan-title' }, e.title),
          e.focus ? el('span', { class: 'plan-focus' }, e.focus) : null,
        ]),
        el('span', { class: `pill ${state === 'done' ? 'pill-done' : state === 'started' ? 'pill-pos' : ''}` },
          state === 'done' ? 'Done' : state === 'started' ? 'Continue' : state === 'ready' ? 'Read' : 'Planned'),
      ]);
      plan.append(row);
    });
    root.append(plan);
  }

  if (!lessons.length) {
    if (!topic.syllabus?.length) {
      root.append(el('p', { class: 'muted center' }, 'No lessons yet — generating the first one also plans a course for this topic.'));
    }
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
        el('span', { class: l.completedAt ? 'pill pill-done' : l.startedAt ? 'pill pill-pos' : 'pill' },
          l.completedAt ? 'Completed' : l.startedAt ? 'Started' : 'New'),
      ])
    );
  }
  root.append(list);
}

// Ensure the topic has a syllabus with at least one un-generated entry;
// extends the plan when the current one is exhausted.
async function ensureSyllabus(topic) {
  if (topic.syllabus?.some((e) => !e.lessonId)) return topic;
  const plan = await generateSyllabus({
    topicName: topic.name,
    topicDescription: topic.description,
    priorTitles: (topic.syllabus || []).map((e) => e.title),
    count: 6,
  });
  topic.syllabus = [
    ...(topic.syllabus || []),
    ...(plan.lessons || []).map((l) => ({ title: l.title, focus: l.focus, lessonId: null })),
  ];
  return store.put('topics', topic);
}

// Persist a generated lesson + register its concepts + link the syllabus entry.
async function saveGeneratedLesson(topic, data, entry) {
  const lesson = await store.put('lessons', {
    topicId: topic.id,
    title: data.title || entry?.title || 'Untitled lesson',
    objectives: data.objectives || [],
    concepts: data.concepts || [],
    body: data.body || '',
    sections: data.sections || [],
    example: data.example || null,
    pauseAndThink: data.pauseAndThink || null,
    glossary: data.glossary || [],
    insights: data.insights || [],
    action: data.action || '',
    leadershipTakeaway: data.leadershipTakeaway || '',
    productivityTip: data.productivityTip || '',
    discussionQ: data.discussionQ || '',
    completedAt: null,
  });

  // Register concepts (mastery accumulation — v2 foundation).
  const allConcepts = await store.getAll('concepts');
  for (const name of lesson.concepts) {
    const existing = allConcepts.find((c) => c.topicId === topic.id && c.name === name);
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

  if (entry) entry.lessonId = lesson.id;
  topic.lessonIds = [...(topic.lessonIds || []), lesson.id];
  await store.put('topics', topic);
  return lesson;
}

async function generateLessonFor(topic, root) {
  if (!hasApiKey()) {
    toast('Add your Claude API key in Settings first', 'warn');
    return navigate('#/settings');
  }
  try {
    if (!topic.syllabus?.some((e) => !e.lessonId)) {
      loading(root, 'Planning this topic…');
    }
    topic = await ensureSyllabus(topic);
    const entry = topic.syllabus.find((e) => !e.lessonId);
    loading(root, `Writing “${entry.title}”…`);

    const priorTitles = (await store.getAll('lessons'))
      .filter((l) => l.topicId === topic.id)
      .map((l) => l.title);
    const data = await generateLesson({
      topicName: topic.name,
      topicDescription: topic.description,
      priorTitles,
      plannedTitle: entry.title,
      plannedFocus: entry.focus,
    });

    const lesson = await saveGeneratedLesson(topic, data, entry);
    navigate(`#/lesson/${lesson.id}`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Lesson generation failed', 'error');
    renderTopic(root, { id: topic.id });
  }
}

// Background pre-generation: after a quiz, quietly write the next planned
// lesson so it's waiting. Skips if one is already unread or in flight.
const preparing = new Set();

export async function prepareNextLesson(topicId) {
  if (!hasApiKey() || preparing.has(topicId)) return;
  const topic = await store.get('topics', topicId);
  if (!topic) return;
  const topicLessons = (await store.getAll('lessons')).filter((l) => l.topicId === topicId);
  if (topicLessons.some((l) => !l.completedAt)) return; // one already queued

  preparing.add(topicId);
  try {
    const t = await ensureSyllabus(topic);
    const entry = t.syllabus.find((e) => !e.lessonId);
    if (!entry) return;
    const data = await generateLesson({
      topicName: t.name,
      topicDescription: t.description,
      priorTitles: topicLessons.map((l) => l.title),
      plannedTitle: entry.title,
      plannedFocus: entry.focus,
    });
    const lesson = await saveGeneratedLesson(t, data, entry);
    toast(`Next lesson ready: ${lesson.title}`, 'success');
  } catch (err) {
    console.warn('prepareNextLesson failed', err);
  } finally {
    preparing.delete(topicId);
  }
}

// ---------- Lesson reader ----------

// Reading-minutes tracker: accumulate time actually spent in the reader into
// profile.learningMinutes. Flushed when the user leaves the lesson.
let readStart = null;

async function flushReadingTime() {
  if (!readStart) return;
  const secs = (Date.now() - readStart) / 1000;
  readStart = null;
  if (secs < 30) return; // ignore drive-by visits
  const mins = Math.min(30, Math.max(1, Math.round(secs / 60))); // cap 30/visit
  const profile = await store.getProfile();
  profile.learningMinutes = (profile.learningMinutes || 0) + mins;
  await store.saveProfile(profile);
}

window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#/lesson/')) flushReadingTime();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushReadingTime();
});

// ---------- highlights ----------

// Wrap saved selection-highlights in the rendered article. Matches within a
// single text node; if the quote spans markup (e.g. a keyword pill), falls
// back to tinting the whole containing block.
function applyHighlights(article, highlights) {
  for (const h of highlights) {
    if (!h.text) continue;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let done = false;
    let node;
    while (!done && (node = walker.nextNode())) {
      const i = node.textContent.indexOf(h.text);
      if (i === -1) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + h.text.length);
      const span = document.createElement('span');
      span.className = 'hl';
      span.title = 'Tap to remove highlight';
      span.addEventListener('click', async () => {
        if (!confirm('Remove this highlight?')) return;
        await store.remove('highlights', h.id);
        span.replaceWith(...span.childNodes);
        toast('Highlight removed');
      });
      range.surroundContents(span);
      done = true;
    }
    if (!done) {
      // Cross-markup quote: tint the closest block that contains it.
      const block = [...article.querySelectorAll('p, li, .closer, .example-box')]
        .find((b) => b.textContent.includes(h.text));
      block?.classList.add('hl-block');
    }
  }
}

// One-tap block bookmarks on saveable elements.
function markSavedBlocks(article, lesson, highlights) {
  const saved = new Map(highlights.map((h) => [h.text, h]));
  const blocks = article.querySelectorAll('.lesson-body p, .lesson-block li, .closer, .example-box');
  for (const block of blocks) {
    if (block.closest('.pause-answer')) continue;
    const text = block.textContent.trim();
    if (!text) continue;
    const existing = saved.get(text);
    const btn = el('button', {
      class: 'save-mark' + (existing ? ' saved' : ''),
      title: existing ? 'Remove from saved' : 'Save for later',
    }, existing ? '⚑' : '⚐');
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const isSaved = btn.classList.contains('saved');
      if (isSaved) {
        const h = (await store.getAll('highlights')).find(
          (x) => x.lessonId === lesson.id && x.text === text
        );
        if (h) await store.remove('highlights', h.id);
        btn.classList.remove('saved');
        btn.textContent = '⚐';
        toast('Removed from saved');
      } else {
        await store.put('highlights', {
          lessonId: lesson.id,
          topicId: lesson.topicId,
          text,
          source: 'block',
        });
        btn.classList.add('saved');
        btn.textContent = '⚑';
        toast('Saved for later', 'success');
      }
    });
    const shareBtn = el('button', {
      class: 'share-mark',
      title: 'Share this passage',
      html: SHARE_ICON,
    });
    shareBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await shareText({ title: lesson.title, text: passageShare(text, lesson.title) });
    });

    block.classList.add('saveable');
    block.append(btn, shareBtn);
  }
}

// Bottom "Highlight" action bar shown while text is selected in the article.
// Bottom placement keeps it clear of the browser's native selection menu,
// which owns the space next to the selected text (especially on Android).
function setupSelectionCapture(article, lesson) {
  let bar = null;
  const removeBar = () => { bar?.remove(); bar = null; };

  const onSelection = () => {
    const sel = document.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length < 3 || sel.isCollapsed ||
        !article.contains(sel.anchorNode) || !article.contains(sel.focusNode)) {
      removeBar();
      return;
    }
    if (bar) return;
    bar = el('div', { class: 'hl-bar' }, [
      el('button', { class: 'hl-bar-btn' }, '🖍 Highlight selection'),
    ]);
    bar.firstChild.addEventListener('click', async () => {
      const quote = document.getSelection()?.toString().trim();
      if (quote) {
        const h = await store.put('highlights', {
          lessonId: lesson.id,
          topicId: lesson.topicId,
          text: quote,
          source: 'selection',
        });
        applyHighlights(article, [h]);
        toast('Highlighted', 'success');
      }
      document.getSelection()?.removeAllRanges();
      removeBar();
    });
    document.body.append(bar);
  };

  document.addEventListener('selectionchange', onSelection);
  window.addEventListener('hashchange', () => {
    removeBar();
    document.removeEventListener('selectionchange', onSelection);
  }, { once: true });
}

// Tap-to-reveal "check your understanding" box.
function pauseBox({ question, answer }) {
  const revealed = el('div', { class: 'pause-answer hidden' });
  paragraphs(answer).forEach((p) => revealed.append(p));
  const btn = el('button', { class: 'pause-reveal' }, 'Reveal answer');
  btn.addEventListener('click', () => {
    revealed.classList.remove('hidden');
    btn.remove();
  });
  return el('aside', { class: 'pause-box' }, [
    el('span', { class: 'pause-label' }, 'Pause & think'),
    rich('p', { class: 'pause-q' }, question),
    btn,
    revealed,
  ]);
}

function lessonWordCount(lesson) {
  const parts = [
    ...(lesson.sections || []).map((s) => `${s.heading} ${s.text}`),
    lesson.body || '',
    lesson.example?.text || '',
  ];
  return parts.join(' ').split(/\s+/).filter(Boolean).length;
}

export async function renderLesson(root, { id }) {
  clear(root);
  const lesson = await store.get('lessons', id);
  if (!lesson) {
    root.append(el('p', { class: 'empty' }, 'Lesson not found.'));
    return;
  }

  readStart = Date.now();

  // Mark the lesson as started (the "book taken off the shelf" signal).
  if (!lesson.completedAt && !lesson.startedAt) {
    lesson.startedAt = store.now();
    await store.put('lessons', lesson);
  }

  const topic = await store.get('topics', lesson.topicId);
  const pos = syllabusPosition(topic, lesson.id);
  const words = lessonWordCount(lesson);
  const readMins = Math.max(1, Math.round(words / 200));

  root.append(
    el('header', { class: 'view-head' }, [
      el('button', { class: 'link', onclick: () => navigate(`#/topic/${lesson.topicId}`) }, `← ${topic?.name || 'Topic'}`),
      el('h1', {}, lesson.title),
      el('div', { class: 'lesson-meta' }, [
        pos ? el('span', { class: 'pill pill-pos' }, `Lesson ${pos.index} of ${pos.total}`) : null,
        el('span', { class: 'pill' }, `~${readMins} min read`),
        el('button', {
          class: 'pill share-pill',
          html: SHARE_ICON + ' Share',
          onclick: () => {
            const insights = (lesson.insights || []).map((i) => `• ${i.replace(/\*\*/g, '')}`).join('\n');
            shareText({
              title: lesson.title,
              text: `${lesson.title}\n\nKey insights:\n${insights}\n\n— Ortiz Learning OS`,
            });
          },
        }),
      ]),
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

  // Table of contents: tap a section to jump to it.
  if (lesson.sections?.length > 1) {
    article.append(
      el('nav', { class: 'toc' }, [
        el('h4', {}, 'In this lesson'),
        el('ol', {}, lesson.sections.map((s, i) =>
          el('li', {}, el('button', {
            class: 'toc-link',
            onclick: () => document.getElementById(`sec-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          }, s.heading))
        )),
      ])
    );
  }

  // Textbook sections (new lessons) or plain body (older lessons).
  if (lesson.sections?.length) {
    const bodyWrap = el('section', { class: 'lesson-body' });
    lesson.sections.forEach((s, i) => {
      bodyWrap.append(el('h3', { class: 'lesson-subtitle', id: `sec-${i}` }, s.heading));
      paragraphs(s.text).forEach((p) => bodyWrap.append(p));
      // Drop the pause-and-think box roughly mid-lesson.
      if (lesson.pauseAndThink && i === Math.floor((lesson.sections.length - 1) / 2)) {
        bodyWrap.append(pauseBox(lesson.pauseAndThink));
      }
    });
    article.append(bodyWrap);
  } else {
    article.append(el('section', { class: 'lesson-body' }, paragraphs(lesson.body)));
  }

  if (lesson.example?.text) {
    article.append(
      el('aside', { class: 'example-box' }, [
        el('span', { class: 'example-label' }, 'In practice'),
        lesson.example.title ? el('h3', { class: 'example-title' }, lesson.example.title) : null,
        ...paragraphs(lesson.example.text),
      ])
    );
  }

  if (lesson.glossary?.length) {
    article.append(
      el('section', { class: 'lesson-block glossary' }, [
        el('h4', {}, 'Key terms'),
        el('dl', {}, lesson.glossary.flatMap((g) => [
          el('dt', {}, g.term),
          el('dd', {}, g.definition),
        ])),
      ])
    );
  }

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

  // Highlights: render saved ones, enable block bookmarks + selection capture.
  const highlights = (await store.getAll('highlights')).filter((h) => h.lessonId === lesson.id);
  applyHighlights(article, highlights.filter((h) => h.source === 'selection'));
  markSavedBlocks(article, lesson, highlights);
  setupSelectionCapture(article, lesson);
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

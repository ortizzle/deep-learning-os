// dashboard.js — Home: the command center. Streak + counts, the Today
// checklist, the Continue-reading shelf, and what to start next.

import * as store from './store.js';
import { masteredTopicCount } from './gamification.js';
import { recentHighlights } from './saved.js';
import { renderTodayPanel } from './today.js';
import { syllabusPosition } from './lessons.js';
import { el, clear, navigate } from './ui.js';

function statCard(value, label, icon) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-value' }, [icon ? el('span', { class: 'stat-icon' }, icon) : null, String(value)]),
    el('div', { class: 'stat-label' }, label),
  ]);
}

// Compute per-topic average mastery for strongest/weakest.
async function topicRankings() {
  const [topics, concepts] = await Promise.all([
    store.getAll('topics'),
    store.getAll('concepts'),
  ]);
  return topics
    .map((t) => {
      const cs = concepts.filter((c) => c.topicId === t.id && c.timesReviewed > 0);
      if (!cs.length) return null;
      const avg = Math.round(cs.reduce((a, c) => a + (c.masteryScore || 0), 0) / cs.length);
      return { topic: t, avg };
    })
    .filter(Boolean)
    .sort((a, b) => b.avg - a.avg);
}

// Recommend the next unread, unstarted lesson in curriculum order.
async function recommendation() {
  const [lessons, topics] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('topics'),
  ]);
  // Only recommend fresh starts — started lessons live on the Continue shelf.
  const pending = lessons.filter((l) => !l.completedAt && !l.startedAt);
  if (!pending.length) return { lesson: null };

  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));
  const syllabusIndex = (l) => {
    const syl = topicById[l.topicId]?.syllabus || [];
    const i = syl.findIndex((e) => e.lessonId === l.id);
    return i === -1 ? 999 : i;
  };
  const lastActivity = {};
  for (const l of lessons) {
    const t = l.completedAt || l.updatedAt || l.createdAt || '';
    if (t > (lastActivity[l.topicId] || '')) lastActivity[l.topicId] = t;
  }
  pending.sort((a, b) => {
    const ta = lastActivity[a.topicId] || '';
    const tb = lastActivity[b.topicId] || '';
    if (a.topicId !== b.topicId && ta !== tb) return tb.localeCompare(ta);
    return syllabusIndex(a) - syllabusIndex(b);
  });
  const lesson = pending[0];
  const topic = topicById[lesson.topicId];
  return { lesson, topic, pos: syllabusPosition(topic, lesson.id) };
}

export async function renderDashboard(root) {
  clear(root);
  const [profile, lessons, topics, concepts] = await Promise.all([
    store.getProfile(),
    store.getAll('lessons'),
    store.getAll('topics'),
    store.getAll('concepts'),
  ]);
  const completed = lessons.filter((l) => l.completedAt).length;
  const mastered = masteredTopicCount(topics, concepts);

  // The three signals that matter: consistency, volume, depth.
  root.append(
    el('div', { class: 'stat-row' }, [
      statCard(profile.streak || 0, 'day streak', '🔥'),
      statCard(completed, 'lessons done'),
      statCard(mastered, 'topics mastered'),
    ])
  );

  // Today: the daily accountability checklist.
  const todayPanel = el('section', { class: 'panel today' });
  root.append(todayPanel);
  await renderTodayPanel(todayPanel);

  // Continue reading: started-but-unfinished lessons, like books off the shelf.
  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));
  const started = lessons
    .filter((l) => l.startedAt && !l.completedAt)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  if (started.length) {
    root.append(
      el('section', { class: 'panel' }, [
        el('h4', {}, 'Continue reading'),
        ...started.slice(0, 3).map((l) => {
          const t = topicById[l.topicId];
          const pos = syllabusPosition(t, l.id);
          return el('button', { class: 'card', onclick: () => navigate(`#/lesson/${l.id}`) }, [
            el('div', { class: 'card-main' }, [
              el('h3', {}, l.title),
              el('p', { class: 'muted' }, pos ? `Lesson ${pos.index} of ${pos.total} · ${t?.name || ''}` : t?.name || ''),
            ]),
            el('span', { class: 'pill pill-pos' }, 'Resume'),
          ]);
        }),
      ])
    );
  }

  // Recommendation (fresh starts only; hidden if the shelf covers it).
  const rec = await recommendation();
  if (rec.lesson || !started.length) root.append(
    el('section', { class: 'panel' }, [
      el('h4', {}, 'Recommended next'),
      rec.lesson
        ? el('button', { class: 'card rec-card', onclick: () => navigate(`#/lesson/${rec.lesson.id}`) }, [
            el('div', { class: 'card-main' }, [
              el('h3', {}, rec.lesson.title),
              el('p', { class: 'muted' },
                rec.pos
                  ? `Lesson ${rec.pos.index} of ${rec.pos.total} · ${rec.topic?.name || ''}`
                  : rec.topic?.name || 'Continue where you left off'),
            ]),
            el('span', { class: 'pill' }, 'Read'),
          ])
        : el('button', { class: 'card rec-card', onclick: () => navigate('#/topics') }, [
            el('div', { class: 'card-main' }, [el('h3', {}, 'Generate a lesson'), el('p', { class: 'muted' }, 'Pick a topic to keep learning')]),
            el('span', { class: 'pill' }, 'Go'),
          ]),
    ])
  );

  // Strong / weak topics.
  const ranked = await topicRankings();
  if (ranked.length) {
    const strongest = ranked[0];
    const weakest = ranked[ranked.length - 1];
    root.append(
      el('section', { class: 'panel' }, [
        el('h4', {}, 'Where you stand'),
        el('div', { class: 'standings' }, [
          el('div', { class: 'standing strong' }, [
            el('span', { class: 'muted' }, 'Strongest'),
            el('strong', {}, strongest.topic.name),
            el('span', { class: 'pill pill-done' }, `${strongest.avg}%`),
          ]),
          ranked.length > 1
            ? el('div', { class: 'standing weak' }, [
                el('span', { class: 'muted' }, 'Needs work'),
                el('strong', {}, weakest.topic.name),
                el('span', { class: 'pill' }, `${weakest.avg}%`),
              ])
            : null,
        ]),
        el('button', { class: 'link', onclick: () => navigate('#/review') }, 'Review your weak spots →'),
      ])
    );
  }

  // Saved highlights teaser.
  const saves = await recentHighlights(2);
  if (saves.length) {
    root.append(
      el('section', { class: 'panel' }, [
        el('h4', {}, 'Saved'),
        ...saves.map((h) =>
          el('blockquote', { class: 'saved-quote dash-quote' },
            h.text.length > 140 ? h.text.slice(0, 140) + '…' : h.text)
        ),
        el('button', { class: 'link', onclick: () => navigate('#/saved') }, 'View all saved →'),
      ])
    );
  }
}

// dashboard.js — home screen: streak, XP/level, stats, strong/weak topics,
// recommended next lesson, recent achievements.

import * as store from './store.js';
import { levelProgress, ACHIEVEMENTS } from './gamification.js';
import { el, clear, navigate } from './ui.js';

function statCard(value, label) {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-value' }, String(value)),
    el('div', { class: 'stat-label' }, label),
  ]);
}

// Compute per-topic average mastery for strongest/weakest.
async function topicRankings() {
  const [topics, concepts] = await Promise.all([
    store.getAll('topics'),
    store.getAll('concepts'),
  ]);
  const ranked = topics
    .map((t) => {
      const cs = concepts.filter((c) => c.topicId === t.id && c.timesReviewed > 0);
      if (!cs.length) return null;
      const avg = Math.round(cs.reduce((a, c) => a + (c.masteryScore || 0), 0) / cs.length);
      return { topic: t, avg };
    })
    .filter(Boolean)
    .sort((a, b) => b.avg - a.avg);
  return ranked;
}

// Recommend: an incomplete lesson, else nudge to generate one.
async function recommendation() {
  const lessons = await store.getAll('lessons');
  const pending = lessons.filter((l) => !l.completedAt);
  if (pending.length) {
    return { lesson: pending.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] };
  }
  return { lesson: null };
}

export async function renderDashboard(root) {
  clear(root);
  const profile = await store.getProfile();
  const lessons = await store.getAll('lessons');
  const completed = lessons.filter((l) => l.completedAt).length;
  const prog = levelProgress(profile.xp || 0);

  // Hero: streak + level.
  root.append(
    el('header', { class: 'hero' }, [
      el('div', { class: 'hero-top' }, [
        el('div', { class: 'streak' }, [
          el('span', { class: 'streak-flame' }, '🔥'),
          el('span', { class: 'streak-num' }, String(profile.streak || 0)),
          el('span', { class: 'streak-label' }, 'day streak'),
        ]),
        el('div', { class: 'level-badge' }, [
          el('span', { class: 'level-num' }, `Lv ${prog.level}`),
          el('span', { class: 'level-xp' }, `${profile.xp || 0} XP`),
        ]),
      ]),
      el('div', { class: 'level-bar' }, [
        el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${prog.pct}%` })]),
        el('div', { class: 'level-bar-label muted' }, `${prog.into} / ${prog.span} XP to Lv ${prog.level + 1}`),
      ]),
    ])
  );

  // Stat row.
  root.append(
    el('div', { class: 'stat-row' }, [
      statCard(completed, 'Lessons'),
      statCard(profile.learningMinutes || 0, 'Minutes'),
      statCard(prog.level, 'Level'),
    ])
  );

  // Recommendation.
  const rec = await recommendation();
  root.append(
    el('section', { class: 'panel' }, [
      el('h4', {}, 'Recommended next'),
      rec.lesson
        ? el('button', { class: 'card rec-card', onclick: () => navigate(`#/lesson/${rec.lesson.id}`) }, [
            el('div', { class: 'card-main' }, [el('h3', {}, rec.lesson.title), el('p', { class: 'muted' }, 'Continue where you left off')]),
            el('span', { class: 'pill' }, 'Resume'),
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
      ])
    );
  }

  // Recent achievements.
  const earned = (profile.achievements || [])
    .map((id) => ACHIEVEMENTS.find((a) => a.id === id))
    .filter(Boolean);
  root.append(
    el('section', { class: 'panel' }, [
      el('h4', {}, 'Achievements'),
      earned.length
        ? el('div', { class: 'badge-strip' }, earned.map((a) =>
            el('div', { class: 'badge', title: a.desc }, [el('span', { class: 'badge-icon' }, '🏆'), el('span', {}, a.name)])
          ))
        : el('p', { class: 'muted' }, 'Complete a lesson to earn your first badge.'),
    ])
  );
}

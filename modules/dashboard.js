// dashboard.js — Home: the command center. Streak + counts, the Today
// checklist, the Continue-reading shelf, and what to start next.

import * as store from './store.js';
import { masteredTopicCount, dayString } from './gamification.js';
import { recentHighlights } from './saved.js';
import { renderTodayPanel } from './today.js';
import { syllabusPosition } from './lessons.js';
import { questionOfTheDay } from './review.js';
import { backupBanner } from './backup.js';
import { el, clear, navigate } from './ui.js';

function statCard(value, label, icon, onClick) {
  return el(onClick ? 'button' : 'div', { class: 'stat' + (onClick ? ' stat-btn' : ''), onclick: onClick }, [
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

  // Personal greeting, on Arizona time.
  const hour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix', hour: 'numeric', hourCycle: 'h23',
  }).format(new Date()), 10);
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  root.append(el('h2', { class: 'greeting' }, `${greet}, Chris`));

  // Gentle weekly nudge to grab a local backup; re-render on action to clear it.
  const banner = backupBanner(() => renderDashboard(root));
  if (banner) root.append(banner);

  // The three signals that matter: consistency, volume, depth.
  root.append(
    el('div', { class: 'stat-row' }, [
      statCard(profile.streak || 0, 'day streak', '🔥', () => navigate('#/activity')),
      statCard(completed, 'lessons done', null, () => navigate('#/completed')),
      statCard(mastered, 'topics mastered'),
    ])
  );

  // Today: the daily accountability checklist.
  const todayPanel = el('section', { class: 'panel today' });
  root.append(todayPanel);
  await renderTodayPanel(todayPanel);

  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));

  // Continue: started-but-unfinished lessons — the primary action. Top 3, with
  // "View all" to the full reading list when there are more.
  const started = lessons
    .filter((l) => l.startedAt && !l.completedAt)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  if (started.length) {
    const head = el('div', { class: 'panel-head' }, [el('h4', {}, 'Continue')]);
    if (started.length > 3) {
      head.append(el('button', { class: 'link small', onclick: () => navigate('#/reading') }, 'View all →'));
    }
    root.append(
      el('section', { class: 'panel' }, [
        head,
        ...started.slice(0, 3).map((l) => lessonCard(l, topicById[l.topicId], 'Resume', 'pill-pos')),
      ])
    );
  }

  // Start something new: fresh-start recommendation, secondary.
  const rec = await recommendation();
  if (rec.lesson) {
    root.append(
      el('section', { class: 'panel panel-tight' }, [
        el('h4', {}, 'Start something new'),
        lessonCard(rec.lesson, rec.topic, 'Read', 'pill'),
      ])
    );
  } else if (!started.length) {
    root.append(
      el('section', { class: 'panel panel-tight' }, [
        el('h4', {}, 'Start something new'),
        el('button', { class: 'card rec-card', onclick: () => navigate('#/topics') }, [
          el('div', { class: 'card-main' }, [el('h3', {}, 'Generate a lesson'), el('p', { class: 'muted' }, 'Pick a topic to keep learning')]),
          el('span', { class: 'pill' }, 'Go'),
        ]),
      ])
    );
  }

  // Review: a question of the day + collapsible standings.
  const qotd = await questionOfTheDay();
  const ranked = await topicRankings();
  if (qotd || ranked.length) {
    const panel = el('section', { class: 'panel' }, [el('h4', {}, 'Review')]);

    if (qotd) {
      const answer = el('div', { class: 'qotd-answer hidden' }, [
        el('span', { class: 'muted small' }, 'Answer'),
        el('p', {}, qotd.correctText || '—'),
        el('button', { class: 'link small', onclick: () => navigate(`#/lesson/${qotd.lesson.id}`) }, `From “${qotd.lesson.title}” →`),
      ]);
      const reveal = el('button', { class: 'btn qotd-reveal', onclick: () => { answer.classList.remove('hidden'); reveal.remove(); } }, 'Reveal answer');
      panel.append(
        el('div', { class: 'qotd' }, [
          el('span', { class: 'qotd-label' }, 'Question of the day'),
          el('p', { class: 'qotd-q' }, qotd.question),
          reveal,
          answer,
        ]),
        el('button', { class: 'btn btn-primary full', onclick: () => navigate('#/review') }, 'Start full review →')
      );
    }

    if (ranked.length) {
      const strongest = ranked[0];
      const weakest = ranked[ranked.length - 1];
      const standings = el('div', { class: 'standings-wrap hidden' }, [
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
      ]);
      const toggle = el('button', { class: 'link small standings-toggle' }, 'Where you stand ▸');
      toggle.addEventListener('click', () => {
        standings.classList.toggle('hidden');
        toggle.textContent = standings.classList.contains('hidden') ? 'Where you stand ▸' : 'Where you stand ▾';
      });
      panel.append(toggle, standings);
    }

    root.append(panel);
  }

  // Saved: the whole panel is clickable → Saved view.
  const saves = await recentHighlights(2);
  if (saves.length) {
    const panel = el('button', { class: 'panel panel-btn', onclick: () => navigate('#/saved') }, [
      el('div', { class: 'panel-head' }, [el('h4', {}, 'Saved'), el('span', { class: 'link small' }, 'View all →')]),
      ...saves.map((h) =>
        el('blockquote', { class: 'saved-quote dash-quote' },
          h.text.length > 140 ? h.text.slice(0, 140) + '…' : h.text)
      ),
    ]);
    root.append(panel);
  }
}

// A tappable lesson card with topic + curriculum position.
function lessonCard(lesson, topic, pillLabel, pillClass) {
  const pos = syllabusPosition(topic, lesson.id);
  return el('button', { class: 'card', onclick: () => navigate(`#/lesson/${lesson.id}`) }, [
    el('div', { class: 'card-main' }, [
      el('h3', {}, lesson.title),
      el('p', { class: 'muted' }, pos ? `Lesson ${pos.index} of ${pos.total} · ${topic?.name || ''}` : topic?.name || ''),
    ]),
    el('span', { class: `pill ${pillClass}` }, pillLabel),
  ]);
}

// Full "Continue" list: every started-unfinished lesson.
export async function renderContinue(root) {
  clear(root);
  const [lessons, topics] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('topics'),
  ]);
  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));
  const started = lessons
    .filter((l) => l.startedAt && !l.completedAt)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));

  root.append(
    el('header', { class: 'view-head' }, [
      el('button', { class: 'link', onclick: () => navigate('#/dashboard') }, '← Home'),
      el('h1', {}, 'Continue'),
      el('p', { class: 'muted' }, 'Lessons you\'ve started but not finished.'),
    ])
  );
  if (!started.length) {
    root.append(el('div', { class: 'empty' }, [el('p', {}, 'Nothing in progress.'), el('button', { class: 'btn btn-primary', onclick: () => navigate('#/topics') }, 'Browse topics')]));
    return;
  }
  const list = el('div', { class: 'card-list' });
  for (const l of started) list.append(lessonCard(l, topicById[l.topicId], 'Resume', 'pill-pos'));
  root.append(list);
}

// All completed lessons, grouped by topic — topics ordered by their most
// recently completed lesson, and lessons within each topic newest first.
export async function renderCompletedLessons(root) {
  clear(root);
  const [lessons, topics] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('topics'),
  ]);
  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));
  const done = lessons.filter((l) => l.completedAt);

  root.append(
    el('header', { class: 'view-head' }, [
      el('button', { class: 'link', onclick: () => navigate('#/dashboard') }, '← Home'),
      el('h1', {}, 'Completed'),
      el('p', { class: 'muted' }, `${done.length} lesson${done.length === 1 ? '' : 's'} finished.`),
    ])
  );
  if (!done.length) {
    root.append(el('div', { class: 'empty' }, [el('p', {}, 'No completed lessons yet.'), el('button', { class: 'btn btn-primary', onclick: () => navigate('#/topics') }, 'Browse topics')]));
    return;
  }

  // Group by topic, each group's lessons newest-first.
  const groups = new Map();
  for (const l of done) {
    if (!groups.has(l.topicId)) groups.set(l.topicId, []);
    groups.get(l.topicId).push(l);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  }

  // Order topic groups by their own most recent completion.
  const orderedTopicIds = [...groups.keys()].sort(
    (a, b) => (groups.get(b)[0].completedAt || '').localeCompare(groups.get(a)[0].completedAt || '')
  );

  for (const topicId of orderedTopicIds) {
    root.append(el('h4', { class: 'topic-cat-heading' }, topicById[topicId]?.name || 'Other'));
    const list = el('div', { class: 'card-list' });
    for (const l of groups.get(topicId)) list.append(lessonCard(l, topicById[topicId], 'Review', 'pill-done'));
    root.append(list);
  }
}

// "Today", "Yesterday", or e.g. "Friday, July 3" — all on Arizona time.
function dayHeading(dateKey) {
  const today = dayString();
  const yesterday = dayString(new Date(Date.now() - 86400000));
  if (dateKey === today) return 'Today';
  if (dateKey === yesterday) return 'Yesterday';
  const d = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix', weekday: 'long', month: 'long', day: 'numeric',
  }).format(d);
}

// What was done, day by day: lessons completed and Today-list tasks
// resolved (done or skipped), newest day first. Tapping the streak stat
// on Home opens this — the streak's receipts.
export async function renderDailyActivity(root) {
  clear(root);
  const [lessons, tasks, topics] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('tasks'),
    store.getAll('topics'),
  ]);
  const topicById = Object.fromEntries(topics.map((t) => [t.id, t]));

  const byDay = new Map();
  const bump = (dateKey) => {
    if (!byDay.has(dateKey)) byDay.set(dateKey, { lessons: [], tasks: [] });
    return byDay.get(dateKey);
  };

  for (const l of lessons) {
    if (!l.completedAt) continue;
    bump(dayString(new Date(l.completedAt))).lessons.push(l);
  }
  for (const t of tasks) {
    if (t.status !== 'done' && t.status !== 'skipped') continue;
    bump(t.date).tasks.push(t);
  }

  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a));

  root.append(
    el('header', { class: 'view-head' }, [
      el('button', { class: 'link', onclick: () => navigate('#/dashboard') }, '← Home'),
      el('h1', {}, 'Activity'),
      el('p', { class: 'muted' }, 'What you\'ve done, day by day.'),
    ])
  );
  if (!days.length) {
    root.append(el('div', { class: 'empty' }, [el('p', {}, 'Nothing logged yet.'), el('button', { class: 'btn btn-primary', onclick: () => navigate('#/topics') }, 'Browse topics')]));
    return;
  }

  for (const dateKey of days) {
    const entry = byDay.get(dateKey);
    root.append(el('h4', { class: 'topic-cat-heading' }, dayHeading(dateKey)));

    if (entry.lessons.length) {
      const list = el('div', { class: 'card-list' });
      for (const l of entry.lessons) list.append(lessonCard(l, topicById[l.topicId], 'Review', 'pill-done'));
      root.append(list);
    }
    if (entry.tasks.length) {
      const panel = el('div', { class: 'panel panel-tight' });
      for (const t of entry.tasks) {
        panel.append(
          el('div', { class: `task-row ${t.status}` }, [
            el('span', { class: 'task-check' }, t.status === 'done' ? '✓' : '⊘'),
            el('div', { class: 'task-main' }, [el('span', { class: 'task-name' }, t.name)]),
          ])
        );
      }
      root.append(panel);
    }
  }
}

// refresher.js — the Daily Refresher card on Home: one completed lesson,
// resurfaced. Pick logic lives in refresherCore.mjs (shared with the daily
// email builder, so the morning email and this card always show the same
// lesson). Content is assembled from the lesson's stored summary fields —
// zero tokens.

import * as store from './store.js';
import { pickRefresher } from './refresherCore.mjs';
import { dayString } from './gamification.js';
import { el, rich, navigate } from './ui.js';

// Builds the panel element, or returns null when nothing is completed yet.
export async function refresherPanel() {
  const [lessons, concepts, topics] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('concepts'),
    store.getAll('topics'),
  ]);
  const pick = pickRefresher(lessons, concepts, dayString());
  if (!pick) return null;

  const { lesson, avgMastery, staleDays, weakest } = pick;
  const topic = topics.find((t) => t.id === lesson.topicId);

  const why = weakest
    ? `${weakest.name} at ${weakest.masteryScore || 0}%` +
      (staleDays > 1 ? ` · untouched ${staleDays} days` : '')
    : staleDays > 1
      ? `Completed ${staleDays} days ago — time to resurface it`
      : 'Fresh in — lock it in early';

  const panel = el('section', { class: 'panel refresher' }, [
    el('div', { class: 'panel-head' }, [
      el('h4', {}, 'Daily refresher'),
      el('span', { class: 'pill' + (avgMastery >= 80 ? ' pill-done' : '') }, `${avgMastery}%`),
    ]),
    el('p', { class: 'refresher-why' }, why),
    el('button', { class: 'card', onclick: () => navigate(`#/lesson/${lesson.id}`) }, [
      el('div', { class: 'card-main' }, [
        el('h3', {}, lesson.title),
        el('p', { class: 'muted' }, topic?.name || ''),
      ]),
      el('span', { class: 'pill pill-pos' }, 'Reread'),
    ]),
  ]);

  // Collapsible summarized review from the lesson's stored closers.
  const body = el('div', { class: 'refresher-body hidden' }, [
    lesson.insights?.length
      ? el('div', {}, [
          el('h5', { class: 'refresher-sub' }, 'Key insights'),
          el('ul', { class: 'refresher-list' }, lesson.insights.map((i) => rich('li', {}, i))),
        ])
      : null,
    lesson.leadershipTakeaway
      ? el('div', {}, [
          el('h5', { class: 'refresher-sub' }, 'Leadership takeaway'),
          rich('p', {}, lesson.leadershipTakeaway),
        ])
      : null,
    lesson.action
      ? el('div', {}, [
          el('h5', { class: 'refresher-sub' }, 'Action'),
          rich('p', {}, lesson.action),
        ])
      : null,
    el('button', { class: 'btn btn-primary full', onclick: () => navigate('#/review') }, 'Review these concepts →'),
  ]);
  const toggle = el('button', { class: 'link small standings-toggle' }, 'Summarized review ▸');
  toggle.addEventListener('click', () => {
    body.classList.toggle('hidden');
    toggle.textContent = body.classList.contains('hidden')
      ? 'Summarized review ▸'
      : 'Summarized review ▾';
  });
  panel.append(toggle, body);
  return panel;
}

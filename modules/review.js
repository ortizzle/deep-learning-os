// review.js — spaced-repetition-lite. Pulls stored quiz questions from
// COMPLETED lessons, weighted toward weak and stale concepts, runs a short
// session, and feeds results back into mastery. Zero tokens for MC; short
// answers use the API for grading when a key exists.

import * as store from './store.js';
import { gradeShortAnswers, hasApiKey } from './ai.js';
import { touchActivity, nextMastery, dayString } from './gamification.js';
import { el, clear, toast, loading, navigate } from './ui.js';

const SESSION_SIZE = 8;

// Question of the day for Home: one question from completed lessons, chosen
// deterministically by Arizona date so it's stable all day. Returns
// { question, lesson, correctText } or null when nothing's completed yet.
export async function questionOfTheDay() {
  const lessons = await store.getAll('lessons');
  const pool = [];
  for (const lesson of lessons) {
    if (!lesson.completedAt || !lesson.quiz?.questions?.length) continue;
    for (const q of lesson.quiz.questions) pool.push({ q, lesson });
  }
  if (!pool.length) return null;
  const day = dayString();
  let hash = 0;
  for (let i = 0; i < day.length; i++) hash = (hash * 31 + day.charCodeAt(i)) >>> 0;
  const { q, lesson } = pool[hash % pool.length];
  const correctText = q.type === 'mc' ? q.options?.[q.correctIndex] : q.modelAnswer;
  return { question: q.question, lesson, correctText };
}

// Build the weighted question pool from completed lessons' stored quizzes.
async function buildPool() {
  const [lessons, concepts] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('concepts'),
  ]);
  const conceptKey = (topicId, name) =>
    concepts.find((c) => c.topicId === topicId && c.name === name);

  const pool = [];
  for (const lesson of lessons) {
    if (!lesson.completedAt || !lesson.quiz?.questions?.length) continue;
    for (const q of lesson.quiz.questions) {
      if (!hasApiKey() && q.type === 'short') continue; // MC-only without a key
      const c = conceptKey(lesson.topicId, q.concept);
      pool.push({
        q,
        lesson,
        mastery: c?.masteryScore ?? 0,
        lastReviewed: c?.lastReviewed || '',
      });
    }
  }
  // Weakest first, then stalest. Cap two questions per concept for variety.
  pool.sort((a, b) => (a.mastery - b.mastery) || a.lastReviewed.localeCompare(b.lastReviewed));
  const perConcept = {};
  return pool.filter((p) => {
    const k = `${p.lesson.topicId}:${p.q.concept}`;
    perConcept[k] = (perConcept[k] || 0) + 1;
    return perConcept[k] <= 2;
  }).slice(0, SESSION_SIZE);
}

export async function renderReview(root) {
  clear(root);
  const [lessons, concepts] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('concepts'),
  ]);
  const eligible = lessons.filter((l) => l.completedAt && l.quiz?.questions?.length);

  root.append(
    el('header', { class: 'view-head' }, [
      el('h1', {}, 'Review'),
      el('p', { class: 'muted' }, 'Short sessions on what you\'ve already learned — weakest concepts first.'),
    ])
  );

  if (!eligible.length) {
    root.append(
      el('div', { class: 'empty' }, [
        el('p', {}, 'Nothing to review yet.'),
        el('p', { class: 'muted' }, 'Complete a lesson and its quiz, and its concepts start showing up here for reinforcement.'),
        el('button', { class: 'btn btn-primary', onclick: () => navigate('#/topics') }, 'Go to Topics'),
      ])
    );
    return;
  }

  const reviewed = concepts.filter((c) => c.timesReviewed > 0);
  const avg = reviewed.length
    ? Math.round(reviewed.reduce((a, c) => a + (c.masteryScore || 0), 0) / reviewed.length)
    : 0;
  const weakest = [...reviewed].sort((a, b) => (a.masteryScore || 0) - (b.masteryScore || 0)).slice(0, 3);

  root.append(
    el('section', { class: 'panel' }, [
      el('h4', {}, 'Where your memory stands'),
      el('div', { class: 'stat-row review-stats' }, [
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, String(reviewed.length)), el('div', { class: 'stat-label' }, 'concepts tracked')]),
        el('div', { class: 'stat' }, [el('div', { class: 'stat-value' }, `${avg}%`), el('div', { class: 'stat-label' }, 'avg mastery')]),
      ]),
      weakest.length
        ? el('div', { class: 'weak-list' }, [
            el('span', { class: 'muted small' }, 'Due for attention: '),
            ...weakest.map((c) => el('span', { class: 'pill' }, `${c.name} ${c.masteryScore || 0}%`)),
          ])
        : null,
    ])
  );

  root.append(
    el('button', { class: 'btn btn-primary full', onclick: () => startSession(root) }, '▶ Start review session')
  );
}

async function startSession(root) {
  loading(root, 'Picking your questions…');
  const pool = await buildPool();
  if (!pool.length) {
    toast('No reviewable questions found', 'warn');
    return renderReview(root);
  }

  const questions = pool.map((p) => p.q);
  const meta = pool; // parallel array: lesson + concept context per question
  const answers = new Array(questions.length).fill(null);
  let idx = 0;

  const step = () => {
    clear(root);
    const q = questions[idx];
    root.append(
      el('header', { class: 'view-head' }, [
        el('div', { class: 'quiz-progress' }, `Review ${idx + 1} of ${questions.length} · from “${meta[idx].lesson.title}”`),
        el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${(idx / questions.length) * 100}%` })]),
      ])
    );
    const card = el('div', { class: 'quiz-card' }, [el('h2', {}, q.question)]);

    const canProceed = () =>
      q.type === 'mc' ? answers[idx] != null : (answers[idx] || '').trim().length > 0;
    const nextBtn = el('button', {
      class: 'btn btn-primary',
      onclick: () => {
        if (!canProceed()) return;
        if (idx < questions.length - 1) { idx++; step(); }
        else finish();
      },
    }, idx < questions.length - 1 ? 'Next →' : 'Finish');
    const syncNext = () => {
      if (canProceed()) nextBtn.removeAttribute('disabled');
      else nextBtn.setAttribute('disabled', 'disabled');
    };

    if (q.type === 'mc') {
      const opts = el('div', { class: 'options' });
      (q.options || []).forEach((opt, i) => {
        opts.append(el('button', {
          class: 'option' + (answers[idx] === i ? ' selected' : ''),
          onclick: () => { answers[idx] = i; step(); },
        }, opt));
      });
      card.append(opts);
    } else {
      const ta = el('textarea', { class: 'input', rows: '4', placeholder: 'Your answer…' });
      ta.value = answers[idx] || '';
      ta.addEventListener('input', () => { answers[idx] = ta.value; syncNext(); });
      card.append(ta);
    }

    syncNext();
    card.append(el('div', { class: 'quiz-nav' }, [
      idx > 0 ? el('button', { class: 'btn', onclick: () => { idx--; step(); } }, '← Back') : el('span', {}),
      nextBtn,
    ]));
    root.append(card);
  };

  const finish = async () => {
    loading(root, 'Scoring…');
    const results = questions.map((q, i) => {
      if (q.type === 'mc') {
        const correct = answers[i] === q.correctIndex;
        return { correct, score: correct ? 100 : 0 };
      }
      return null;
    });

    const shortIdx = [];
    const shortItems = [];
    questions.forEach((q, i) => {
      if (q.type === 'short') {
        shortIdx.push(i);
        shortItems.push({ question: q.question, modelAnswer: q.modelAnswer, studentAnswer: answers[i] || '' });
      }
    });
    if (shortItems.length) {
      try {
        const graded = await gradeShortAnswers(shortItems);
        shortIdx.forEach((qi, k) => {
          const g = graded[k] || { score: 0, correct: false };
          results[qi] = { correct: g.correct, score: g.score, feedback: g.feedback };
        });
      } catch (err) {
        console.warn('review grading failed', err);
        shortIdx.forEach((qi) => { results[qi] = { correct: false, score: 0, feedback: 'Could not grade.' }; });
      }
    }

    // Feed mastery.
    const allConcepts = await store.getAll('concepts');
    for (let i = 0; i < questions.length; i++) {
      const c = allConcepts.find(
        (x) => x.topicId === meta[i].lesson.topicId && x.name === questions[i].concept
      );
      if (c) {
        c.masteryScore = nextMastery(c.masteryScore || 0, results[i].score || 0, 0.3);
        c.timesReviewed = (c.timesReviewed || 0) + 1;
        c.lastReviewed = store.now();
        await store.put('concepts', c);
      }
    }
    await touchActivity();

    // Results.
    clear(root);
    const score = Math.round(results.reduce((a, r) => a + (r.score || 0), 0) / results.length);
    root.append(
      el('header', { class: 'view-head center' }, [
        el('div', { class: 'score-ring', style: `--p:${score}` }, [el('span', { class: 'score-num' }, `${score}`), el('span', { class: 'score-pct' }, '%')]),
        el('h1', {}, 'Review complete'),
        el('p', { class: 'muted' }, 'Mastery updated on every concept you touched.'),
      ])
    );
    const list = el('div', { class: 'results' });
    results.forEach((r, i) => {
      const q = questions[i];
      const yourAnswer = q.type === 'mc' ? (q.options?.[answers[i]] ?? '—') : (answers[i] || '—');
      const rightAnswer = q.type === 'mc' ? q.options?.[q.correctIndex] : q.modelAnswer;
      const tier = q.type === 'mc' ? (r.correct ? 'ok' : 'bad') : r.score >= 80 ? 'ok' : r.score >= 40 ? 'partial' : 'bad';
      list.append(
        el('div', { class: 'result ' + tier }, [
          el('div', { class: 'result-head' }, [
            el('span', { class: 'result-icon' }, tier === 'ok' ? '✓' : tier === 'partial' ? '◐' : '✕'),
            el('span', { class: 'result-q' }, q.question),
          ]),
          el('p', { class: 'result-ans' }, [el('strong', {}, 'You: '), yourAnswer]),
          (!r.correct || q.type === 'short') && rightAnswer
            ? el('p', { class: 'result-model' }, [el('strong', {}, q.type === 'mc' ? 'Correct: ' : 'Model answer: '), rightAnswer])
            : null,
          r.feedback ? el('p', { class: 'result-fb' }, r.feedback) : null,
        ])
      );
    });
    root.append(list);
    root.append(
      el('div', { class: 'quiz-nav' }, [
        el('button', { class: 'btn', onclick: () => renderReview(root) }, 'Back to Review'),
        el('button', { class: 'btn btn-primary', onclick: () => startSession(root) }, 'Another round →'),
      ])
    );
  };

  step();
}

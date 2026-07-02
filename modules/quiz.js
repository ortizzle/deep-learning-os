// quiz.js — quiz flow: render questions, grade (MC local, short via Claude),
// update mastery + XP/streak, show results.

import * as store from './store.js';
import { generateQuiz, gradeShortAnswers, hasApiKey } from './ai.js';
import { award, nextMastery, XP } from './gamification.js';
import { el, clear, toast, loading, navigate } from './ui.js';

export async function renderQuiz(root, { id }) {
  clear(root);
  const lesson = await store.get('lessons', id);
  if (!lesson) {
    root.append(el('p', { class: 'empty' }, 'Lesson not found.'));
    return;
  }
  if (!hasApiKey()) {
    toast('Add your Claude API key in Settings first', 'warn');
    return navigate('#/settings');
  }

  loading(root, 'Building your quiz…');
  let quizData;
  try {
    quizData = await generateQuiz({
      lessonTitle: lesson.title,
      concepts: lesson.concepts,
      body: lesson.sections?.length
        ? lesson.sections.map((s) => `${s.heading}: ${s.text}`).join('\n\n')
        : lesson.body,
    });
  } catch (err) {
    console.error(err);
    toast(err.message || 'Quiz generation failed', 'error');
    return navigate(`#/lesson/${lesson.id}`);
  }

  const questions = quizData.questions || [];
  const answers = new Array(questions.length).fill(null);
  let idx = 0;

  const step = () => {
    clear(root);
    const q = questions[idx];
    root.append(
      el('header', { class: 'view-head' }, [
        el('div', { class: 'quiz-progress' }, `Question ${idx + 1} of ${questions.length}`),
        el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${((idx) / questions.length) * 100}%` })]),
      ])
    );

    const card = el('div', { class: 'quiz-card' }, [el('h2', {}, q.question)]);

    if (q.type === 'mc') {
      const opts = el('div', { class: 'options' });
      (q.options || []).forEach((opt, i) => {
        const btn = el('button', {
          class: 'option' + (answers[idx] === i ? ' selected' : ''),
          onclick: () => {
            answers[idx] = i;
            step();
          },
        }, opt);
        opts.append(btn);
      });
      card.append(opts);
    } else {
      const ta = el('textarea', {
        class: 'input',
        rows: '4',
        placeholder: 'Your answer…',
      });
      ta.value = answers[idx] || '';
      ta.addEventListener('input', () => (answers[idx] = ta.value));
      card.append(ta);
    }

    const canProceed = q.type === 'mc' ? answers[idx] != null : (answers[idx] || '').trim().length > 0;
    card.append(
      el('div', { class: 'quiz-nav' }, [
        idx > 0 ? el('button', { class: 'btn', onclick: () => { idx--; step(); } }, '← Back') : el('span', {}),
        el('button', {
          class: 'btn btn-primary',
          disabled: !canProceed ? 'disabled' : null,
          onclick: () => {
            if (!canProceed) return;
            if (idx < questions.length - 1) { idx++; step(); }
            else finish();
          },
        }, idx < questions.length - 1 ? 'Next →' : 'Submit'),
      ])
    );

    root.append(card);
  };

  const finish = async () => {
    loading(root, 'Grading…');

    // Grade MC locally.
    const results = questions.map((q, i) => {
      if (q.type === 'mc') {
        const correct = answers[i] === q.correctIndex;
        return { concept: q.concept, correct, score: correct ? 100 : 0 };
      }
      return null; // filled by Claude below
    });

    // Grade short answers via Claude.
    const shortItems = [];
    const shortMap = [];
    questions.forEach((q, i) => {
      if (q.type === 'short') {
        shortMap.push(i);
        shortItems.push({ question: q.question, modelAnswer: q.modelAnswer, studentAnswer: answers[i] || '' });
      }
    });

    let graded = [];
    try {
      graded = await gradeShortAnswers(shortItems);
    } catch (err) {
      console.warn('short grading failed', err);
    }
    shortMap.forEach((qi, k) => {
      const g = graded[k] || { score: 0, correct: false, feedback: 'Could not grade.' };
      results[qi] = { concept: questions[qi].concept, correct: g.correct, score: g.score, feedback: g.feedback };
    });

    const score = Math.round(results.reduce((a, r) => a + (r.score || 0), 0) / results.length);

    // Persist quiz + per-concept results.
    const conceptResults = results.map((r) => ({ concept: r.concept, correct: r.correct, score: r.score }));
    await store.put('quizzes', {
      lessonId: lesson.id,
      questions,
      answers,
      score,
      conceptResults,
    });

    // Update mastery per concept (weighted average) — v2 foundation.
    for (const r of conceptResults) {
      const concept = (await store.getAll('concepts')).find(
        (c) => c.topicId === lesson.topicId && c.name === r.concept
      );
      if (concept) {
        concept.masteryScore = nextMastery(concept.masteryScore || 0, r.score || 0);
        concept.timesReviewed = (concept.timesReviewed || 0) + 1;
        concept.lastReviewed = store.now();
        await store.put('concepts', concept);
      }
    }

    // Mark lesson complete + award XP/streak.
    const firstCompletion = !lesson.completedAt;
    lesson.completedAt = lesson.completedAt || store.now();
    await store.put('lessons', lesson);

    const bonus = score === 100 ? XP.quizPerfect : 0;
    if (firstCompletion) await award('lessonCompleted');
    const { unlocked, leveledUp } = await award('quizCompleted', { xp: bonus });

    showResults(results, score, leveledUp, unlocked);
  };

  const showResults = (results, score, leveledUp, unlocked) => {
    clear(root);
    root.append(
      el('header', { class: 'view-head center' }, [
        el('div', { class: 'score-ring', style: `--p:${score}` }, [el('span', { class: 'score-num' }, `${score}`), el('span', { class: 'score-pct' }, '%')]),
        el('h1', {}, score >= 80 ? 'Strong work.' : score >= 60 ? 'Solid.' : 'Room to grow.'),
        leveledUp ? el('p', { class: 'level-up' }, '⬆ Level up!') : null,
      ])
    );

    const list = el('div', { class: 'results' });
    results.forEach((r, i) => {
      list.append(
        el('div', { class: 'result ' + (r.correct ? 'ok' : 'bad') }, [
          el('div', { class: 'result-head' }, [
            el('span', { class: 'result-icon' }, r.correct ? '✓' : '✕'),
            el('span', { class: 'result-q' }, questions[i].question),
          ]),
          r.feedback ? el('p', { class: 'result-fb' }, r.feedback) : null,
        ])
      );
    });
    root.append(list);

    for (const a of unlocked || []) {
      toast(`🏆 ${a.name} unlocked`, 'success');
    }

    root.append(
      el('div', { class: 'quiz-nav' }, [
        el('button', { class: 'btn', onclick: () => navigate(`#/topic/${lesson.topicId}`) }, 'Back to topic'),
        el('button', { class: 'btn btn-primary', onclick: () => navigate('#/dashboard') }, 'Dashboard →'),
      ])
    );
  };

  step();
}

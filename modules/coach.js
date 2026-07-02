// coach.js — executive coach chat. Injects a summary of recent lessons + quiz
// performance + weak areas as context, then streams-free turns to Claude.

import * as store from './store.js';
import { coachReply, hasApiKey } from './ai.js';
import { award } from './gamification.js';
import { el, clear, escapeHtml, toast, navigate } from './ui.js';

// Build a compact context summary from recent activity + weak concepts.
async function buildContextSummary() {
  const [lessons, quizzes, concepts, highlights] = await Promise.all([
    store.getAll('lessons'),
    store.getAll('quizzes'),
    store.getAll('concepts'),
    store.getAll('highlights'),
  ]);

  const recentLessons = lessons
    .filter((l) => l.completedAt)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .slice(0, 5)
    .map((l) => l.title);

  const avgQuiz = quizzes.length
    ? Math.round(quizzes.reduce((a, q) => a + (q.score || 0), 0) / quizzes.length)
    : null;

  const weak = concepts
    .filter((c) => c.timesReviewed > 0)
    .sort((a, b) => (a.masteryScore || 0) - (b.masteryScore || 0))
    .slice(0, 5)
    .map((c) => `${c.name} (${c.masteryScore || 0}%)`);

  const recentSaves = highlights
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 5)
    .map((h) => `"${h.text.length > 120 ? h.text.slice(0, 120) + '…' : h.text}"`);

  return [
    recentLessons.length ? `Recent lessons: ${recentLessons.join('; ')}.` : '',
    avgQuiz != null ? `Average quiz score: ${avgQuiz}%.` : '',
    weak.length ? `Weakest concepts: ${weak.join(', ')}.` : '',
    recentSaves.length ? `Passages he chose to highlight recently (strong signal of what resonates): ${recentSaves.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// One active session per view load (kept in the coachSessions store).
async function getOrCreateSession() {
  const sessions = await store.getAll('coachSessions');
  if (sessions.length) {
    return sessions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  }
  return store.put('coachSessions', { messages: [], summary: '' });
}

export async function renderCoach(root) {
  clear(root);

  root.append(
    el('header', { class: 'view-head' }, [
      el('h1', {}, 'Executive Coach'),
      el('p', { class: 'muted' }, 'Direct, challenging, no flattery. Aware of your recent learning.'),
    ])
  );

  if (!hasApiKey()) {
    root.append(
      el('div', { class: 'empty' }, [
        el('p', {}, 'Add your Claude API key to talk to your coach.'),
        el('button', { class: 'btn btn-primary', onclick: () => navigate('#/settings') }, 'Open Settings'),
      ])
    );
    return;
  }

  const session = await getOrCreateSession();
  const thread = el('div', { class: 'chat-thread' });
  const renderThread = () => {
    clear(thread);
    if (!session.messages.length) {
      thread.append(el('p', { class: 'muted center' }, 'Ask a question, or share what you\'re wrestling with.'));
    }
    for (const m of session.messages) {
      thread.append(el('div', { class: `bubble ${m.role}`, html: escapeHtml(m.content).replace(/\n/g, '<br>') }));
    }
    thread.scrollTop = thread.scrollHeight;
  };
  renderThread();

  const input = el('textarea', { class: 'input chat-input', rows: '2', placeholder: 'Message your coach…' });
  const sendBtn = el('button', { class: 'btn btn-primary', onclick: send }, 'Send');

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    session.messages.push({ role: 'user', content: text });
    renderThread();

    const typing = el('div', { class: 'bubble assistant typing' }, '…');
    thread.append(typing);
    thread.scrollTop = thread.scrollHeight;
    sendBtn.setAttribute('disabled', 'disabled');

    try {
      const contextSummary = await buildContextSummary();
      const reply = await coachReply({
        contextSummary,
        history: session.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      session.messages.push({ role: 'assistant', content: reply });
      const firstReply = session.messages.filter((m) => m.role === 'assistant').length === 1;
      await store.put('coachSessions', session);
      if (firstReply) await award('coachSession');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Coach unavailable', 'error');
      session.messages.pop(); // remove the unanswered user turn from view state
    } finally {
      typing.remove();
      sendBtn.removeAttribute('disabled');
      renderThread();
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  });

  root.append(
    thread,
    el('div', { class: 'chat-composer' }, [input, sendBtn])
  );
}

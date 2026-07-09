// today.js — the daily accountability loop. A "Today" checklist on the
// dashboard built from recurring habits + actions from completed lessons.
// States: pending / done / skipped ("doesn't apply" — honest, chain-safe).

import * as store from './store.js';
import { touchActivity, dayString, isWeekend } from './gamification.js';
import { el, toast, navigate } from './ui.js';

// Day boundaries pinned to Arizona time (see gamification.js).
const dayStr = dayString;

// Seed default habits exactly once.
async function ensureDefaultHabits() {
  if (store.getSettings().habitsSeeded) return;
  const habits = await store.getAll('habits');
  if (!habits.length) {
    await store.put('habits', { name: 'Complete a lesson' });
    await store.put('habits', { name: 'Review one saved highlight' });
  }
  store.saveSettings({ habitsSeeded: true });
}

// Create today's task rows for active habits; carry the previous working day's
// unfinished actions forward once, then let them expire. Weekends are off:
// no habit rows materialize on Sat/Sun (and Friday's actions carry to Monday,
// not expire over the weekend).
async function materializeToday() {
  const today = dayStr();
  const [habits, tasks] = await Promise.all([
    store.getAll('habits'),
    store.getAll('tasks'),
  ]);

  if (!isWeekend(today)) {
    for (const h of habits.filter((h) => !h.archived)) {
      if (!tasks.some((t) => t.habitId === h.id && t.date === today)) {
        await store.put('tasks', {
          type: 'habit', habitId: h.id, name: h.name, date: today, status: 'pending',
        });
      }
    }
  }

  // Carry forward unfinished actions/manual tasks every working day until
  // they're actually done or skipped — they represent real commitments and
  // shouldn't quietly expire just because a day was missed.
  if (!isWeekend(today)) {
    for (const t of tasks) {
      const actionable = t.type === 'action' || t.type === 'manual';
      if (!actionable || t.status !== 'pending' || t.date >= today) continue;
      await store.put('tasks', { ...t, date: today, carried: true });
    }
  }
}

// Called when a lesson is completed: its "action for today" joins the list.
export async function addLessonAction(lesson) {
  if (!lesson.action) return;
  const tasks = await store.getAll('tasks');
  if (tasks.some((t) => t.type === 'action' && t.lessonId === lesson.id)) return;
  await store.put('tasks', {
    type: 'action',
    lessonId: lesson.id,
    name: lesson.action,
    date: dayStr(),
    status: 'pending',
  });
}

// Manually add a one-off task for today (from a lesson closer's "+"). Deduped
// by name among today's rows.
export async function addManualTask({ name, sourceLessonId }) {
  if (!name?.trim()) return;
  const today = dayStr();
  const tasks = await store.getAll('tasks');
  if (tasks.some((t) => t.date === today && t.name === name && t.status !== 'expired')) {
    toast('Already on today’s list');
    return;
  }
  await store.put('tasks', {
    type: 'manual', lessonId: sourceLessonId || null, name: name.trim(),
    date: today, status: 'pending',
  });
  toast('Added to today', 'success');
}

// Add a recurring daily habit (from a lesson closer's "+"). Deduped by name.
export async function addHabitFromText({ name, sourceLessonId }) {
  if (!name?.trim()) return;
  const habits = await store.getAll('habits');
  if (habits.some((h) => !h.archived && h.name === name.trim())) {
    toast('Already a daily habit');
    return;
  }
  await store.put('habits', { name: name.trim(), sourceLessonId: sourceLessonId || null });
  toast('Added as a daily habit', 'success');
}

// All of today's items resolved (at least one done): a quiet nod, once a day.
async function checkDayClosed() {
  const today = dayStr();
  const todays = (await store.getAll('tasks')).filter(
    (t) => t.date === today && t.status !== 'expired'
  );
  if (!todays.length) return;
  const resolved = todays.every((t) => t.status === 'done' || t.status === 'skipped');
  const anyDone = todays.some((t) => t.status === 'done');
  if (!resolved || !anyDone) return;

  const profile = await store.getProfile();
  if (profile.lastPerfectDay === today) return;
  profile.lastPerfectDay = today;
  await store.saveProfile(profile);
  toast('✨ Everything closed out for today', 'success');
}

// 7-day dot chain for a habit (oldest → today).
function chainDots(allTasks, habitId) {
  const dots = [];
  for (let i = 6; i >= 0; i--) {
    const d = dayStr(new Date(Date.now() - i * 86400000));
    const t = allTasks.find((x) => x.habitId === habitId && x.date === d);
    const cls =
      t?.status === 'done' ? 'dot done'
      : t?.status === 'skipped' ? 'dot skip'
      : d === dayStr() ? 'dot today'
      : 'dot';
    dots.push(el('span', { class: cls, title: d }));
  }
  return el('span', { class: 'chain' }, dots);
}

// Render the Today panel into `container` (idempotent; re-renders in place).
export async function renderTodayPanel(container) {
  await ensureDefaultHabits();
  await materializeToday();

  const [allTasks, lessons] = await Promise.all([
    store.getAll('tasks'),
    store.getAll('lessons'),
  ]);
  const lessonById = Object.fromEntries(lessons.map((l) => [l.id, l]));
  const today = dayStr();
  const weekend = isWeekend(today);
  const todays = allTasks
    .filter((t) => t.date === today && t.status !== 'expired')
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'habit' ? 1 : -1));

  container.replaceChildren();
  container.className = 'panel today';

  let editing = container.dataset.editing === '1';

  const head = el('div', { class: 'today-head' }, [
    el('h4', {}, weekend ? 'Weekend' : 'Today'),
    el('button', {
      class: 'link small',
      onclick: () => {
        container.dataset.editing = editing ? '' : '1';
        renderTodayPanel(container);
      },
    }, editing ? 'Done editing' : 'Edit'),
  ]);
  container.append(head);

  const setStatus = async (task, status) => {
    task.status = status;
    await store.put('tasks', task);
    if (status === 'done') await touchActivity();
    await checkDayClosed();
    renderTodayPanel(container);
  };

  // Weekends are off days — no expected work. Show a rest message (habits
  // don't materialize; carried actions wait for Monday).
  if (weekend && !editing) {
    container.append(
      el('p', { class: 'muted small' }, 'Weekend — no tasks today. Rest, or get ahead if you like.')
    );
    return;
  }

  if (!todays.length) {
    container.append(el('p', { class: 'muted small' }, 'Nothing on the list. Complete a lesson to get an action, or add a habit.'));
  }

  for (const t of todays) {
    const srcLesson = t.lessonId ? lessonById[t.lessonId] : null;
    let sourceEl = null;
    if (t.type === 'habit') {
      sourceEl = chainDots(allTasks, t.habitId);
    } else if (srcLesson) {
      sourceEl = el('button', {
        class: 'task-src link',
        onclick: (e) => { e.stopPropagation(); navigate(`#/lesson/${srcLesson.id}`); },
      }, `from “${srcLesson.title}”`);
    } else if (t.type === 'manual') {
      sourceEl = el('span', { class: 'task-src' }, 'added by you');
    }

    const row = el('div', { class: `task-row ${t.status}` }, [
      el('button', {
        class: 'task-check',
        title: t.status === 'done' ? 'Undo' : 'Mark done',
        onclick: () => setStatus(t, t.status === 'done' ? 'pending' : 'done'),
      }, t.status === 'done' ? '✓' : ''),
      el('div', { class: 'task-main' }, [
        el('span', { class: 'task-name' }, [
          t.carried ? el('span', { class: 'task-carried', title: 'Carried over' }, '↩ ') : null,
          t.name,
        ]),
        sourceEl,
      ]),
      el('button', {
        class: 'task-skip' + (t.status === 'skipped' ? ' active' : ''),
        title: "Doesn't apply today",
        onclick: () => setStatus(t, t.status === 'skipped' ? 'pending' : 'skipped'),
      }, '⊘'),
    ]);
    container.append(row);
  }

  if (editing) {
    const habits = (await store.getAll('habits')).filter((h) => !h.archived);
    const editBox = el('div', { class: 'today-edit' });
    for (const h of habits) {
      editBox.append(
        el('div', { class: 'today-edit-row' }, [
          el('span', {}, h.name),
          el('button', {
            class: 'saved-del',
            onclick: async () => {
              h.archived = true;
              await store.put('habits', h);
              const t = (await store.getAll('tasks')).find(
                (x) => x.habitId === h.id && x.date === today && x.status === 'pending'
              );
              if (t) await store.put('tasks', { ...t, status: 'expired' });
              renderTodayPanel(container);
            },
          }, '✕'),
        ])
      );
    }
    const input = el('input', { class: 'input', placeholder: 'New daily habit…' });
    const add = async () => {
      const name = input.value.trim();
      if (!name) return;
      await store.put('habits', { name });
      input.value = '';
      renderTodayPanel(container);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    editBox.append(
      el('div', { class: 'today-edit-add' }, [input, el('button', { class: 'btn', onclick: add }, 'Add')])
    );
    container.append(editBox);
  }
}

// Follow-through summary for the coach (last 14 days of lesson actions).
// Weekend-dated items are excluded from the "undone" count — Sat/Sun are off
// days, not missed work — and the coach is told so it won't nag about them.
export async function followThroughSummary() {
  const cutoff = dayStr(new Date(Date.now() - 14 * 86400000));
  const actions = (await store.getAll('tasks')).filter(
    (t) => (t.type === 'action' || t.type === 'manual') && t.date >= cutoff
  );
  if (!actions.length) return '';
  const done = actions.filter((t) => t.status === 'done').length;
  const skipped = actions.filter((t) => t.status === 'skipped').length;
  const dropped = actions.filter(
    (t) => (t.status === 'expired' || t.status === 'pending') && !isWeekend(t.date)
  ).length;
  return `Follow-through on action items (last 14 days): ${done} done, ${skipped} marked not applicable, ${dropped} left undone on working days. Note: weekends (Sat/Sun) are off days and do not count as missed — don't treat weekend gaps as a lapse.`;
}

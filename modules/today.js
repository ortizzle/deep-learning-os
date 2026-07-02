// today.js — the daily accountability loop. A "Today" checklist on the
// dashboard built from recurring habits + actions from completed lessons.
// States: pending / done / skipped ("doesn't apply" — honest, chain-safe).

import * as store from './store.js';
import { award } from './gamification.js';
import { el, toast } from './ui.js';

const dayStr = (d = new Date()) => d.toISOString().slice(0, 10);

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

// Create today's task rows for active habits; carry yesterday's unfinished
// lesson actions forward once, then let them expire.
async function materializeToday() {
  const today = dayStr();
  const yesterday = dayStr(new Date(Date.now() - 86400000));
  const [habits, tasks] = await Promise.all([
    store.getAll('habits'),
    store.getAll('tasks'),
  ]);

  for (const h of habits.filter((h) => !h.archived)) {
    if (!tasks.some((t) => t.habitId === h.id && t.date === today)) {
      await store.put('tasks', {
        type: 'habit', habitId: h.id, name: h.name, date: today, status: 'pending',
      });
    }
  }

  for (const t of tasks) {
    if (t.type !== 'action' || t.status !== 'pending' || t.date >= today) continue;
    if (t.date === yesterday && !t.carried) {
      await store.put('tasks', { ...t, id: undefined, date: today, carried: true });
    }
    await store.put('tasks', { ...t, status: 'expired' });
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

// Perfect day: every item resolved, at least one actually done. Once per day.
async function checkPerfectDay() {
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
  profile.perfectDays = (profile.perfectDays || 0) + 1;
  await store.saveProfile(profile);
  const { unlocked } = await award('perfectDay');
  toast('✨ Perfect day — everything closed out', 'success');
  for (const a of unlocked || []) toast(`🏆 ${a.name} unlocked`, 'success');
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

  const allTasks = await store.getAll('tasks');
  const today = dayStr();
  const todays = allTasks
    .filter((t) => t.date === today && t.status !== 'expired')
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'action' ? -1 : 1));

  container.replaceChildren();
  container.className = 'panel today';

  let editing = container.dataset.editing === '1';

  const head = el('div', { class: 'today-head' }, [
    el('h4', {}, 'Today'),
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
    const firstDone = status === 'done' && !task.rewarded;
    task.status = status;
    if (firstDone) task.rewarded = true;
    await store.put('tasks', task);
    if (firstDone) await award('taskDone');
    await checkPerfectDay();
    renderTodayPanel(container);
  };

  if (!todays.length) {
    container.append(el('p', { class: 'muted small' }, 'Nothing on the list. Complete a lesson to get an action, or add a habit.'));
  }

  for (const t of todays) {
    const row = el('div', { class: `task-row ${t.status}` }, [
      el('button', {
        class: 'task-check',
        title: t.status === 'done' ? 'Undo' : 'Mark done',
        onclick: () => setStatus(t, t.status === 'done' ? 'pending' : 'done'),
      }, t.status === 'done' ? '✓' : ''),
      el('div', { class: 'task-main' }, [
        el('span', { class: 'task-name' }, [
          t.carried ? el('span', { class: 'task-carried', title: 'Carried over from yesterday' }, '↩ ') : null,
          t.name,
        ]),
        t.type === 'habit' ? chainDots(allTasks, t.habitId) : el('span', { class: 'task-src' }, 'from lesson'),
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
export async function followThroughSummary() {
  const cutoff = dayStr(new Date(Date.now() - 14 * 86400000));
  const actions = (await store.getAll('tasks')).filter(
    (t) => t.type === 'action' && t.date >= cutoff
  );
  if (!actions.length) return '';
  const done = actions.filter((t) => t.status === 'done').length;
  const skipped = actions.filter((t) => t.status === 'skipped').length;
  const dropped = actions.filter((t) => t.status === 'expired' || t.status === 'pending').length;
  return `Follow-through on lesson actions (last 14 days): ${done} done, ${skipped} marked not applicable, ${dropped} left undone.`;
}

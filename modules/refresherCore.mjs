// refresherCore.mjs — pure daily-refresher logic, shared by the app
// (modules/refresher.js, review.js) and the email builder
// (scripts/daily-refresher.mjs). No imports, no storage, no DOM: everything is
// (data, day) → result, so the morning email and the Home card compute the
// exact same pick for the same Arizona day.

// Arizona day string (YYYY-MM-DD). America/Phoenix has no DST.
export function azDayString(d = new Date()) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(date);
}

// Deterministic seed hash — same algorithm the question of the day has always
// used, so the daily pick is stable all day on every surface.
export function hashSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

// Whole days from dayA to dayB ('YYYY-MM-DD' strings). Noon-UTC anchors keep
// the math stable regardless of host timezone.
export function daysBetween(dayA, dayB) {
  return Math.round(
    (Date.parse(`${dayB}T12:00:00Z`) - Date.parse(`${dayA}T12:00:00Z`)) / 86400000
  );
}

// Lesson text stores **key term** highlight markers; plain-text contexts
// (email subjects, coach prompts) want them gone.
export function stripMarkers(text = '') {
  return String(text).replace(/\*\*/g, '');
}

// Stable lesson order matching IndexedDB's getAll (sorted by id key), so the
// email — reading the Gist snapshot — indexes the same pool as the app.
function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// One question from completed lessons, chosen deterministically by day.
// Returns { question, lesson, correctText } or null.
export function questionOfTheDayCore(lessons, day) {
  const pool = [];
  for (const lesson of [...lessons].sort(byId)) {
    if (!lesson.completedAt || !lesson.quiz?.questions?.length) continue;
    for (const q of lesson.quiz.questions) pool.push({ q, lesson });
  }
  if (!pool.length) return null;
  const { q, lesson } = pool[hashSeed(day) % pool.length];
  const correctText = q.type === 'mc' ? q.options?.[q.correctIndex] : q.modelAnswer;
  return { question: q.question, lesson, correctText };
}

// Today's refresher: the completed lesson most worth resurfacing — weakest
// average concept mastery first, boosted by staleness. Rotates among the top
// three candidates by day so consecutive days don't repeat one lesson.
// Returns { lesson, avgMastery, staleDays, weakest } or null.
export function pickRefresher(lessons, concepts, day) {
  const done = lessons.filter((l) => l.completedAt).sort(byId);
  if (!done.length) return null;

  const scored = done.map((lesson) => {
    const recs = (lesson.concepts || [])
      .map((name) => concepts.find((c) => c.topicId === lesson.topicId && c.name === name))
      .filter(Boolean);
    const avgMastery = recs.length
      ? Math.round(recs.reduce((a, c) => a + (c.masteryScore || 0), 0) / recs.length)
      : 30; // completed but never quizzed/reviewed: assume shaky
    const lastTouch = recs.reduce(
      (max, c) => ((c.lastReviewed || '') > max ? c.lastReviewed : max),
      lesson.completedAt
    );
    const staleDays = Math.max(0, daysBetween(azDayString(lastTouch), day));
    const weakest = recs.length
      ? [...recs].sort((a, b) => (a.masteryScore || 0) - (b.masteryScore || 0))[0]
      : null;
    return {
      lesson,
      avgMastery,
      staleDays,
      weakest,
      score: 100 - avgMastery + Math.min(staleDays, 30) * 2,
    };
  });

  scored.sort((a, b) => b.score - a.score || byId(a.lesson, b.lesson));
  const top = scored.slice(0, Math.min(3, scored.length));
  return top[hashSeed(day + '#refresher') % top.length];
}

// Concepts slipping away: reviewed before, but weak or untouched. Sorted by
// how urgently they need attention. Returns [{ name, mastery, staleDays }].
export function masteryDecay(concepts, day, limit = 3) {
  return concepts
    .filter((c) => c.timesReviewed > 0)
    .map((c) => {
      const last = c.lastReviewed || c.updatedAt || c.createdAt;
      const staleDays = last ? Math.max(0, daysBetween(azDayString(last), day)) : 0;
      const mastery = c.masteryScore || 0;
      return { name: c.name, mastery, staleDays, score: 100 - mastery + staleDays * 3 };
    })
    .filter((c) => c.staleDays >= 2 || c.mastery < 85)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Monday of the week containing `day`.
export function weekStart(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10);
}

// The Friday week-in-review numbers: lessons completed this week (Arizona
// days) and follow-through on the Today list's action items.
export function weekRecap(lessons, tasks, day) {
  const start = weekStart(day);
  const inWeek = (iso) => {
    const d = azDayString(iso);
    return d >= start && d <= day;
  };
  const lessonsDone = lessons
    .filter((l) => l.completedAt && inWeek(l.completedAt))
    .sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
  const actions = tasks.filter(
    (t) => (t.type === 'action' || t.type === 'manual') && t.date >= start && t.date <= day
  );
  const done = actions.filter((t) => t.status === 'done').length;
  const skipped = actions.filter((t) => t.status === 'skipped').length;
  return {
    start,
    lessonsDone,
    actions: { total: actions.length, done, skipped, open: actions.length - done - skipped },
  };
}

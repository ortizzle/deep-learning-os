// gamification.js — XP rules, levels, streaks, achievements. Pure-ish helpers
// that take a profile, mutate a copy, and return { profile, unlocked }.

import { getProfile, saveProfile, getAll } from './store.js';

// XP awarded per action.
export const XP = {
  lessonCompleted: 50,
  quizCompleted: 30,
  quizPerfect: 40, // bonus on top of quizCompleted
  coachSession: 20,
  topicCreated: 10,
  taskDone: 5,
  perfectDay: 25, // every Today item resolved, at least one done
};

// Level curve: level N requires 100 * N * (N-1) / 2 cumulative XP (gentle ramp).
export function levelForXp(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function xpForLevel(level) {
  return (100 * level * (level - 1)) / 2;
}

// Progress toward next level as { level, into, span, pct }.
export function levelProgress(xp) {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - base;
  const into = xp - base;
  return { level, into, span, next, pct: span ? Math.round((into / span) * 100) : 0 };
}

// ---------- Achievements ----------

export const ACHIEVEMENTS = [
  { id: 'first-lesson', name: 'First Lesson', desc: 'Completed your first lesson.' },
  { id: 'streak-7', name: 'Consistent', desc: '7-day learning streak.' },
  { id: 'ten-quizzes', name: 'Quiz Master', desc: 'Completed 10 quizzes.' },
  { id: 'first-coach', name: 'Coached', desc: 'Held your first coach session.' },
  { id: 'topic-mastered', name: 'Topic Mastered', desc: 'Reached 90+ mastery across a topic.' },
  { id: 'level-5', name: 'Level 5', desc: 'Reached level 5.' },
  { id: 'perfect-7', name: 'Consistent Closer', desc: '7 perfect days.' },
  { id: 'actions-30', name: 'Action Taker', desc: 'Completed 30 lesson actions.' },
];

// Local-time day string (streaks follow the user's clock, not UTC).
function dayString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Update streak based on lastActiveDate vs today. Returns mutated profile.
function bumpStreak(profile) {
  const today = dayString();
  if (profile.lastActiveDate === today) return profile;
  const yesterday = dayString(new Date(Date.now() - 86400000));
  profile.streak =
    profile.lastActiveDate === yesterday ? (profile.streak || 0) + 1 : 1;
  profile.lastActiveDate = today;
  return profile;
}

// Evaluate which achievements should now be unlocked given current data.
async function evaluateAchievements(profile) {
  const have = new Set(profile.achievements || []);
  const unlocked = [];
  const grant = (id) => {
    if (!have.has(id)) {
      have.add(id);
      unlocked.push(ACHIEVEMENTS.find((a) => a.id === id));
    }
  };

  const [lessons, quizzes, coachSessions, concepts, tasks] = await Promise.all([
    getAll('lessons'),
    getAll('quizzes'),
    getAll('coachSessions'),
    getAll('concepts'),
    getAll('tasks'),
  ]);

  if (lessons.some((l) => l.completedAt)) grant('first-lesson');
  if ((profile.streak || 0) >= 7) grant('streak-7');
  if (quizzes.length >= 10) grant('ten-quizzes');
  if (coachSessions.length >= 1) grant('first-coach');
  if (profile.level >= 5) grant('level-5');
  if ((profile.perfectDays || 0) >= 7) grant('perfect-7');
  if (tasks.filter((t) => t.type === 'action' && t.status === 'done').length >= 30) grant('actions-30');

  // Topic mastered: any topic whose concepts average >= 90.
  const byTopic = {};
  for (const c of concepts) {
    (byTopic[c.topicId] = byTopic[c.topicId] || []).push(c.masteryScore || 0);
  }
  for (const scores of Object.values(byTopic)) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (scores.length && avg >= 90) grant('topic-mastered');
  }

  profile.achievements = [...have];
  return unlocked;
}

// Core entry point: award XP for an event, bump streak, recompute level +
// achievements, persist. Returns { profile, unlocked, leveledUp }.
export async function award(event, { xp = 0 } = {}) {
  const profile = await getProfile();
  const prevLevel = profile.level;

  profile.xp = (profile.xp || 0) + (XP[event] || 0) + xp;
  bumpStreak(profile);
  profile.level = levelForXp(profile.xp);

  const unlocked = await evaluateAchievements(profile);
  await saveProfile(profile);

  return { profile, unlocked, leveledUp: profile.level > prevLevel };
}

// ---------- Mastery (v2 foundation) ----------

// Simple weighted moving average toward the latest result.
export function nextMastery(prev = 0, resultPct, weight = 0.4) {
  return Math.round(prev * (1 - weight) + resultPct * weight);
}

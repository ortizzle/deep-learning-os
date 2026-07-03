// gamification.js — streaks + mastery only. De-gamified 2026-07-03 by
// request: XP, levels, and achievements removed. What remains is the daily
// streak (consistency signal) and per-concept mastery (the learning engine).

import { getProfile, saveProfile } from './store.js';

// Day boundaries are pinned to Arizona time (America/Phoenix, no DST) —
// Chris's home timezone — so streaks and daily lists don't wobble with
// travel or UTC rollover.
export function dayString(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(d);
}

// Is a YYYY-MM-DD date a Saturday or Sunday (in Arizona)? Parsed as noon UTC to
// avoid any tz edge; weekday math on a date-only string is stable regardless.
export function isWeekend(dateStr) {
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// The most recent working day (Mon–Fri) on or before `dateStr`.
export function prevWorkingDay(dateStr) {
  let d = new Date(`${dateStr}T12:00:00Z`);
  do {
    d = new Date(d.getTime() - 86400000);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// Was a working day (Mon–Fri) skipped strictly between `lastActive` and
// `today`? If yes, the streak is broken; weekends in the gap don't count.
export function workingDaySkipped(lastActive, today) {
  if (!lastActive || lastActive >= today) return false;
  let d = new Date(`${today}T12:00:00Z`);
  d = new Date(d.getTime() - 86400000); // day before today
  while (d.toISOString().slice(0, 10) > lastActive) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) return true; // a working day was missed
    d = new Date(d.getTime() - 86400000);
  }
  return false;
}

// Update streak based on lastActiveDate vs today. Mutates the profile.
// Weekends are off days: an idle Sat/Sun never breaks the streak.
function bumpStreak(profile) {
  const today = dayString();
  if (profile.lastActiveDate === today) return profile;
  profile.streak = workingDaySkipped(profile.lastActiveDate, today)
    ? 1
    : (profile.streak || 0) + 1;
  profile.lastActiveDate = today;
  return profile;
}

// Record that learning activity happened today (keeps the streak honest).
// The single entry point that used to be award(); XP no longer exists.
export async function touchActivity() {
  const profile = await getProfile();
  bumpStreak(profile);
  await saveProfile(profile);
  return profile;
}

// ---------- Mastery (spaced-repetition foundation) ----------

// Simple weighted moving average toward the latest result.
export function nextMastery(prev = 0, resultPct, weight = 0.4) {
  return Math.round(prev * (1 - weight) + resultPct * weight);
}

// A topic counts as "mastered" when its reviewed concepts average 90+.
export function masteredTopicCount(topics, concepts) {
  let count = 0;
  for (const t of topics) {
    const cs = concepts.filter((c) => c.topicId === t.id && c.timesReviewed > 0);
    if (!cs.length) continue;
    const avg = cs.reduce((a, c) => a + (c.masteryScore || 0), 0) / cs.length;
    if (avg >= 90) count++;
  }
  return count;
}

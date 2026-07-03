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

// Update streak based on lastActiveDate vs today. Mutates the profile.
function bumpStreak(profile) {
  const today = dayString();
  if (profile.lastActiveDate === today) return profile;
  const yesterday = dayString(new Date(Date.now() - 86400000));
  profile.streak =
    profile.lastActiveDate === yesterday ? (profile.streak || 0) + 1 : 1;
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

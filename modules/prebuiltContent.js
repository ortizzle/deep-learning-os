// prebuiltContent.js — ships fully-authored courses so topics arrive with real
// lessons already written, no Claude API call required. seedPrebuiltCourses()
// runs once on boot and inserts anything missing directly into the store.
//
// Design notes:
// - IDs are DETERMINISTIC (`pb-<topicKey>` / `pb-<topicKey>-<lessonKey>`) so
//   re-running boot is idempotent — an existing record is left untouched.
// - Topics are matched by NAME first, so a prebuilt course unifies with the
//   same-named suggested-topic card (and with any topic the user already added
//   by tapping that suggestion) instead of creating a duplicate.
// - TOMBSTONES are respected: if you delete a seeded lesson or topic, its
//   tombstone blocks re-seeding, so deletions stick across reloads.

import * as store from './store.js';
import { PREBUILT_COURSES } from './prebuiltCourses.js';

const norm = (s) => (s || '').trim().toLowerCase();

// Turn an authored lesson object into a stored lesson record shape (mirrors
// saveGeneratedLesson in lessons.js, minus the AI call).
function lessonRecord(id, topicId, L) {
  return {
    id,
    topicId,
    title: L.title || 'Untitled lesson',
    objectives: L.objectives || [],
    concepts: L.concepts || [],
    body: L.body || '',
    sections: L.sections || [],
    example: L.example || null,
    pauseAndThink: L.pauseAndThink || null,
    glossary: L.glossary || [],
    insights: L.insights || [],
    action: L.action || '',
    leadershipTakeaway: L.leadershipTakeaway || '',
    productivityTip: L.productivityTip || '',
    discussionQ: L.discussionQ || '',
    completedAt: null,
  };
}

// Insert every prebuilt course's topic + lessons + concepts that aren't
// already present (and aren't tombstoned). Safe to call on every boot.
export async function seedPrebuiltCourses() {
  if (!PREBUILT_COURSES.length) return;

  const [topics, tombstones] = await Promise.all([
    store.getAll('topics'),
    store.getAll('tombstones'),
  ]);
  const tomb = new Set(tombstones.map((t) => t.id)); // `${store}:${recordId}`
  const topicByName = new Map(topics.map((t) => [norm(t.name), t]));

  for (const course of PREBUILT_COURSES) {
    const topicId = `pb-${course.topicKey}`;
    if (tomb.has(`topics:${topicId}`)) continue; // user deleted it — respect that

    // Reuse a same-named topic if one already exists (suggested-topic tap,
    // manual add, or a prior seed); otherwise create the prebuilt topic.
    let topic = topicByName.get(norm(course.name));
    if (!topic) {
      topic = await store.put('topics', {
        id: topicId,
        name: course.name,
        description: course.description,
        category: course.category,
        lessonIds: [],
        syllabus: [],
      });
      topicByName.set(norm(course.name), topic);
    }
    topic.syllabus = topic.syllabus || [];
    topic.lessonIds = topic.lessonIds || [];

    const allConcepts = (await store.getAll('concepts')).filter((c) => c.topicId === topic.id);
    const conceptNames = new Set(allConcepts.map((c) => c.name));
    let topicDirty = false;

    for (const L of course.lessons) {
      const lessonId = `pb-${course.topicKey}-${L.key}`;
      if (tomb.has(`lessons:${lessonId}`)) continue; // deleted lesson stays gone

      // Ensure a syllabus entry points at this lesson (match by id or title so
      // we don't double-list a lesson the user already has).
      let entry = topic.syllabus.find((e) => e.lessonId === lessonId || norm(e.title) === norm(L.title));
      if (!entry) {
        topic.syllabus.push({ title: L.title, focus: L.focus || '', lessonId });
        topicDirty = true;
      } else if (entry.lessonId !== lessonId) {
        entry.lessonId = lessonId;
        topicDirty = true;
      }

      // Create the lesson only if it isn't already there.
      const existing = await store.get('lessons', lessonId);
      if (!existing) {
        await store.put('lessons', lessonRecord(lessonId, topic.id, L));
        if (!topic.lessonIds.includes(lessonId)) topic.lessonIds.push(lessonId);
        topicDirty = true;

        for (const name of L.concepts || []) {
          if (conceptNames.has(name)) continue;
          conceptNames.add(name);
          await store.put('concepts', {
            name,
            topicId: topic.id,
            masteryScore: 0,
            lastReviewed: null,
            timesReviewed: 0,
          });
        }
      }
    }

    if (topicDirty) await store.put('topics', topic);
  }
}

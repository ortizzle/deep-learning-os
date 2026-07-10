// prebuiltContent.js — ships fully-authored courses so topics arrive with real
// lessons already written, no Claude API call required. seedPrebuiltCourses()
// runs once on boot and inserts anything missing directly into the store.
//
// Design notes:
// - IDs are DETERMINISTIC (`pb-<topicKey>` / `pb-<topicKey>-<lessonKey>`) so
//   re-running boot is idempotent — an existing record is left untouched.
// - Topics are matched by NAME first, so a prebuilt course unifies with the
//   same-named suggested-topic card (and with an EMPTY topic the user added by
//   tapping that suggestion) instead of creating a duplicate.
// - A topic that ALREADY HAS the user's own lessons is left completely alone —
//   we never stack prebuilt lessons on top of generated ones (that doubled the
//   list). If a prior version did that, cleanup below removes the duplicates.
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
    // Pre-authored quiz travels with the lesson; renderQuiz serves it with
    // zero API calls (MC grades locally). Null lessons fall back to live gen.
    quiz: L.quiz && L.quiz.questions?.length ? L.quiz : null,
    completedAt: null,
  };
}

// Undo a prior buggy seed that appended prebuilt lessons onto a topic that
// already had the user's own lessons (doubling the list). Removes only the
// prebuilt copies — the user's lessons are untouched.
async function removePrebuiltDuplicates(topic, existingLessons, pbIds) {
  const dupes = existingLessons.filter((l) => pbIds.has(l.id));
  if (!dupes.length) return;

  for (const l of dupes) await store.remove('lessons', l.id); // tombstoned, won't re-seed

  topic.syllabus = (topic.syllabus || []).filter((e) => !pbIds.has(e.lessonId));
  topic.lessonIds = (topic.lessonIds || []).filter((id) => !pbIds.has(id));
  await store.put('topics', topic);

  // Drop concepts that no surviving lesson in this topic references — those are
  // the prebuilt-only ones. A shared name stays (a user lesson still cites it).
  const keptNames = new Set(
    existingLessons.filter((l) => !pbIds.has(l.id)).flatMap((l) => l.concepts || [])
  );
  const orphans = (await store.getAll('concepts')).filter(
    (c) => c.topicId === topic.id && !keptNames.has(c.name)
  );
  for (const c of orphans) await store.remove('concepts', c.id);
}

// Insert every prebuilt course's topic + lessons + concepts into EMPTY topics
// (and topics that don't exist yet), then adopt them with a `prebuilt: true`
// marker. That marker is what tells a prebuilt topic (which the user may later
// extend with a generated lesson — perfectly fine) apart from one of the user's
// own topics that an earlier buggy seed wrongly stacked prebuilt lessons onto
// (which we scrub). Idempotent and tombstone-aware — safe to call every boot.
export async function seedPrebuiltCourses() {
  if (!PREBUILT_COURSES.length) return;

  const [topics, tombstones, allLessons] = await Promise.all([
    store.getAll('topics'),
    store.getAll('tombstones'),
    store.getAll('lessons'),
  ]);
  const tomb = new Set(tombstones.map((t) => t.id)); // `${store}:${recordId}`
  const topicByName = new Map(topics.map((t) => [norm(t.name), t]));

  for (const course of PREBUILT_COURSES) {
    const topicId = `pb-${course.topicKey}`;
    if (tomb.has(`topics:${topicId}`)) continue; // user deleted it — respect that

    const pbIds = new Set(course.lessons.map((L) => `pb-${course.topicKey}-${L.key}`));
    let topic = topicByName.get(norm(course.name));
    const existingLessons = topic ? allLessons.filter((l) => l.topicId === topic.id) : [];
    const hasPrebuilt = existingLessons.some((l) => pbIds.has(l.id));
    const hasUser = existingLessons.some((l) => !pbIds.has(l.id));
    // A topic the seeder itself created has a deterministic `pb-` id — treat
    // it as prebuilt even if the `prebuilt` flag got dropped (e.g. by a stale
    // whole-topic write elsewhere). The flag alone must never be the only
    // thing standing between the scrub below and a user's lessons + mastery.
    const isPrebuilt = Boolean(topic?.prebuilt) || topic?.id?.startsWith('pb-');

    // The user's OWN topic that an earlier seed doubled: it holds the user's
    // lessons AND prebuilt copies, and was never adopted (no marker). Scrub the
    // prebuilt copies, leave the user's lessons, and don't reseed.
    if (hasUser && hasPrebuilt && !isPrebuilt) {
      await removePrebuiltDuplicates(topic, existingLessons, pbIds);
      continue;
    }

    // The user's own topic (their lessons, never adopted) → leave it entirely
    // alone. (A prebuilt topic the user extended has topic.prebuilt set, so it
    // falls through to idempotent seeding below and keeps both.)
    if (hasUser && !isPrebuilt) continue;

    // Empty topic, an already-prebuilt topic, or a not-yet-existing one → seed.
    if (!topic) {
      topic = await store.put('topics', {
        id: topicId,
        name: course.name,
        description: course.description,
        category: course.category,
        lessonIds: [],
        syllabus: [],
        prebuilt: true,
      });
      topicByName.set(norm(course.name), topic);
    }
    topic.syllabus = topic.syllabus || [];
    topic.lessonIds = topic.lessonIds || [];

    const conceptNames = new Set(
      (await store.getAll('concepts')).filter((c) => c.topicId === topic.id).map((c) => c.name)
    );
    // Adopt this topic as prebuilt so future boots know it's ours (and never
    // mistake a later user-generated lesson here for a duplicate to scrub).
    let topicDirty = false;
    if (!topic.prebuilt) {
      topic.prebuilt = true;
      topicDirty = true;
    }

    for (const L of course.lessons) {
      const lessonId = `pb-${course.topicKey}-${L.key}`;
      if (tomb.has(`lessons:${lessonId}`)) continue; // deleted lesson stays gone

      let entry = topic.syllabus.find((e) => e.lessonId === lessonId || norm(e.title) === norm(L.title));
      if (!entry) {
        topic.syllabus.push({ title: L.title, focus: L.focus || '', lessonId });
        topicDirty = true;
      } else if (entry.lessonId !== lessonId) {
        entry.lessonId = lessonId;
        topicDirty = true;
      }

      // Create the lesson only if it isn't already there. If it exists but
      // predates the pre-authored quiz (e.g. seeded by an earlier version),
      // backfill the quiz so returning users get it without a reseed.
      const existing = await store.get('lessons', lessonId);
      if (existing) {
        if (L.quiz?.questions?.length && !existing.quiz?.questions?.length) {
          existing.quiz = L.quiz;
          await store.put('lessons', existing);
        }
      } else {
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

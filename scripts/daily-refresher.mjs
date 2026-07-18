// daily-refresher.mjs — builds the morning refresher email from the app's
// synced Gist snapshot. Runs in GitHub Actions (.github/workflows/
// daily-refresher.yml); the workflow sends the resulting email.html via Gmail
// SMTP. Selection logic is shared with the app (modules/refresherCore.mjs) so
// the email and the Home card always feature the same lesson and question.
//
// Env:
//   GIST_TOKEN, GIST_ID    required — the same Gist the app syncs to
//   ANTHROPIC_API_KEY      optional — adds the coach one-liner; skipped if absent
//   SNAPSHOT_FILE          optional — local dry runs against a snapshot JSON file
//   FORCE_DAY              optional — YYYY-MM-DD override for testing
//
// Outputs (via $GITHUB_OUTPUT): send=true|false, subject=...
// Writes: email.html in the working directory.

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import {
  azDayString,
  questionOfTheDayCore,
  pickRefresher,
  masteryDecay,
  weekRecap,
  stripMarkers,
} from '../modules/refresherCore.mjs';

const APP_URL = 'https://ortizzle.github.io/deep-learning-os/';
const GIST_FILENAME = 'deep-learning-os.json';
const MODEL = 'claude-sonnet-4-6';

// ---------- palette (mirrors styles.css light theme) ----------
const C = {
  bg: '#f7f9f8',
  surface: '#ffffff',
  surface2: '#edf2f0',
  border: '#e2e8e5',
  text: '#1c2622',
  text2: '#5f6e68',
  text3: '#93a29b',
  accent: '#1f6fbd',
  accentSoft: '#e6f1fb',
  good: '#0f8a5f',
  bad: '#d84a4a',
};

// ---------- outputs ----------
function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value).replace(/\n/g, ' ')}\n`);
  } else {
    console.log(`[output] ${key}=${value}`);
  }
}

// ---------- snapshot ----------
async function loadSnapshot() {
  if (process.env.SNAPSHOT_FILE) {
    return JSON.parse(readFileSync(process.env.SNAPSHOT_FILE, 'utf8'));
  }
  const token = process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;
  if (!token || !gistId) {
    throw new Error('GIST_TOKEN and GIST_ID are required (repo secrets).');
  }
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`Gist fetch failed: ${res.status} ${await res.text()}`);
  const gist = await res.json();
  const file = gist.files?.[GIST_FILENAME];
  if (!file) throw new Error(`Gist has no ${GIST_FILENAME} file.`);
  // Same truncation trap the app hit: past ~1 MB the API truncates inline
  // content and points at raw_url for the full body.
  let content = file.content;
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url);
    if (!raw.ok) throw new Error(`Raw gist fetch failed: ${raw.status}`);
    content = await raw.text();
  }
  return JSON.parse(content);
}

// ---------- coach one-liner (optional, degrades silently) ----------
async function coachLine(context) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const prompt = `You are a direct, challenging executive coach for a Director of Customer Success. His learning stats this morning:
${context}

Write ONE sentence for the top of his morning refresher email — sharp, specific to the stats, pushes him to act today. Max 30 words. Address him as "you". No greeting, no emoji, no quotation marks, no preamble.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 120,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const json = await res.json();
    const text = (json.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text || null;
  } catch (err) {
    console.warn(`Coach line skipped: ${err.message}`);
    return null;
  }
}

// ---------- HTML helpers (inline styles only — email clients) ----------
const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// **key term** markers → bold accent text.
const rich = (s = '') =>
  esc(s).replace(/\*\*([^*\n]+)\*\*/g, `<strong style="color:${C.accent};font-weight:600">$1</strong>`);

const card = (inner) =>
  `<div style="background:${C.surface};border:1px solid ${C.border};border-radius:14px;padding:18px 20px;margin:0 0 14px">${inner}</div>`;

const label = (t) =>
  `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:${C.accent};margin:0 0 8px">${esc(t)}</div>`;

const subhead = (t) =>
  `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:${C.text3};margin:14px 0 4px">${esc(t)}</div>`;

const button = (href, text) =>
  `<a href="${href}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px;margin-top:12px">${esc(text)}</a>`;

const para = (html) => `<p style="margin:0 0 6px;line-height:1.55;font-size:15px">${html}</p>`;

function shell({ title, dateLine, statLine, body, footer }) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${C.bg}">
<div style="max-width:560px;margin:0 auto;padding:28px 16px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${C.text}">
  <div style="margin:0 0 18px">
    <div style="font-size:12px;font-weight:600;color:${C.text3};letter-spacing:0.04em;text-transform:uppercase">Ortiz Learning OS</div>
    <h1 style="font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:6px 0 2px">${title}</h1>
    <div style="font-size:13px;color:${C.text2}">${dateLine}${statLine ? ` &nbsp;·&nbsp; ${statLine}` : ''}</div>
  </div>
  ${body}
  <div style="text-align:center;color:${C.text3};font-size:12px;margin-top:22px;line-height:1.6">
    ${footer || ''}
    <div style="margin-top:8px"><a href="${APP_URL}" style="color:${C.text3}">Open Deep Learning OS</a> · sent by your daily-refresher workflow</div>
  </div>
</div>
</body></html>`;
}

// ---------- editions ----------
function refresherBody({ pick, qotd, decay, coach, data }) {
  const { lesson, avgMastery, staleDays, weakest } = pick;
  const topic = (data.topics || []).find((t) => t.id === lesson.topicId);
  const why = weakest
    ? `${esc(weakest.name)} is at <strong>${weakest.masteryScore || 0}%</strong>${staleDays > 1 ? ` and untouched for ${staleDays} days` : ''}.`
    : `Completed ${staleDays} days ago — time to resurface it.`;

  let html = '';
  if (coach) {
    html += `<div style="border-left:3px solid ${C.accent};padding:2px 0 2px 14px;margin:0 0 16px;color:${C.text2};font-size:15px;line-height:1.5;font-style:italic">${esc(coach)}</div>`;
  }

  html += card(
    label("Today's refresher") +
      `<div style="font-size:18px;font-weight:700;letter-spacing:-0.01em">${esc(lesson.title)}</div>` +
      `<div style="font-size:13px;color:${C.text2};margin:2px 0 10px">${esc(topic?.name || '')} · avg mastery ${avgMastery}%</div>` +
      para(`<span style="color:${C.text2}">Why now: ${why}</span>`) +
      (lesson.insights?.length
        ? subhead('Key insights') +
          `<ul style="margin:0;padding-left:18px">${lesson.insights
            .map((i) => `<li style="margin:0 0 6px;line-height:1.55;font-size:15px">${rich(i)}</li>`)
            .join('')}</ul>`
        : '') +
      (lesson.leadershipTakeaway ? subhead('Leadership takeaway') + para(rich(lesson.leadershipTakeaway)) : '') +
      (lesson.action ? subhead('Try again today') + para(rich(lesson.action)) : '') +
      button(`${APP_URL}#/lesson/${lesson.id}`, 'Reread this lesson →')
  );

  if (qotd) {
    html += card(
      label('Question of the day') +
        `<div style="font-size:16px;font-weight:500;line-height:1.5">${esc(qotd.question)}</div>` +
        `<div style="font-size:13px;color:${C.text3};margin-top:8px">Answer it in your head — it's at the bottom of this email.</div>` +
        button(`${APP_URL}#/review`, 'Start a review round →')
    );
  }

  if (decay.length) {
    html += card(
      label('Slipping away') +
        decay
          .map(
            (d) =>
              `<div style="display:block;font-size:14px;line-height:1.7">` +
              `<span style="font-weight:600">${esc(d.name)}</span>` +
              ` <span style="color:${d.mastery < 60 ? C.bad : C.text2}">${d.mastery}%</span>` +
              `<span style="color:${C.text3}"> · untouched ${d.staleDays} day${d.staleDays === 1 ? '' : 's'}</span></div>`
          )
          .join('') +
        `<div style="font-size:13px;color:${C.text3};margin-top:6px">Mastery only counts if it survives time. A 2-minute review resets the clock.</div>`
    );
  }

  const footer = qotd
    ? `<div style="background:${C.surface2};border-radius:10px;padding:10px 14px;text-align:left;color:${C.text2};font-size:13px;line-height:1.5"><strong>Answer:</strong> ${esc(qotd.correctText || '—')} <span style="color:${C.text3}">(from “${esc(qotd.lesson.title)}”)</span></div>`
    : '';
  return { html, footer };
}

function weeklyBody({ recap, decay, coach, streak, data }) {
  const topicById = Object.fromEntries((data.topics || []).map((t) => [t.id, t]));
  let html = '';
  if (coach) {
    html += `<div style="border-left:3px solid ${C.accent};padding:2px 0 2px 14px;margin:0 0 16px;color:${C.text2};font-size:15px;line-height:1.5;font-style:italic">${esc(coach)}</div>`;
  }

  const { lessonsDone, actions } = recap;
  html += card(
    label('This week') +
      `<div style="font-size:15px;line-height:1.7">` +
      `<div><strong>${lessonsDone.length}</strong> lesson${lessonsDone.length === 1 ? '' : 's'} completed</div>` +
      `<div><strong>${streak}</strong>-day streak</div>` +
      (actions.total
        ? `<div>Follow-through: <strong>${actions.done}/${actions.total}</strong> action items done${actions.skipped ? `, ${actions.skipped} n/a` : ''}${actions.open ? `, <span style="color:${C.bad}">${actions.open} still open</span>` : ''}</div>`
        : '') +
      `</div>`
  );

  if (lessonsDone.length) {
    html += card(
      label('Completed') +
        lessonsDone
          .map(
            (l) =>
              `<div style="font-size:14px;line-height:1.7"><a href="${APP_URL}#/lesson/${l.id}" style="color:${C.text};text-decoration:none;font-weight:600">${esc(l.title)}</a> <span style="color:${C.text3}">· ${esc(topicById[l.topicId]?.name || '')}</span></div>`
          )
          .join('')
    );
  }

  if (decay.length) {
    html += card(
      label('Weekend review targets') +
        decay
          .map(
            (d) =>
              `<div style="font-size:14px;line-height:1.7"><span style="font-weight:600">${esc(d.name)}</span> <span style="color:${d.mastery < 60 ? C.bad : C.text2}">${d.mastery}%</span><span style="color:${C.text3}"> · untouched ${d.staleDays} day${d.staleDays === 1 ? '' : 's'}</span></div>`
          )
          .join('') +
        button(`${APP_URL}#/review`, 'Close the gaps →')
    );
  }
  return { html, footer: '' };
}

// ---------- main ----------
const snapshot = await loadSnapshot();
const data = snapshot?.data || {};
const lessons = data.lessons || [];
const concepts = data.concepts || [];
const tasks = data.tasks || [];
const profile = (data.profile || []).find((p) => p.id === 'me') || {};
const streak = profile.streak || 0;
const completedCount = lessons.filter((l) => l.completedAt).length;

const day = process.env.FORCE_DAY || azDayString();
const weekday = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Phoenix',
  weekday: 'long',
}).format(new Date(`${day}T12:00:00Z`));
const dateLine = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Phoenix',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
}).format(new Date(`${day}T12:00:00Z`));

if (!completedCount) {
  console.log('No completed lessons yet — skipping email.');
  setOutput('send', 'false');
  process.exit(0);
}

const decay = masteryDecay(concepts, day);
const decayLine = decay
  .map((d) => `${d.name} at ${d.mastery}% (untouched ${d.staleDays} days)`)
  .join('; ');

let subject;
let body;
let title;

if (weekday === 'Friday') {
  const recap = weekRecap(lessons, tasks, day);
  const coach = await coachLine(
    `Weekly recap. Streak: ${streak} days. Lessons completed this week: ${recap.lessonsDone.length} (${recap.lessonsDone.map((l) => stripMarkers(l.title)).join('; ') || 'none'}). Action-item follow-through: ${recap.actions.done}/${recap.actions.total} done, ${recap.actions.open} left open. Weak concepts: ${decayLine || 'none flagged'}.`
  );
  subject = `Week in review: ${recap.lessonsDone.length} lesson${recap.lessonsDone.length === 1 ? '' : 's'} · ${streak}-day streak`;
  body = weeklyBody({ recap, decay, coach, streak, data });
  title = 'Your week in learning';
} else {
  const pick = pickRefresher(lessons, concepts, day);
  const qotd = questionOfTheDayCore(lessons, day);
  const coach = await coachLine(
    `Streak: ${streak} days. Lessons completed: ${completedCount}. Today's refresher lesson: "${stripMarkers(pick.lesson.title)}" (avg mastery ${pick.avgMastery}%, untouched ${pick.staleDays} days). Weak concepts: ${decayLine || 'none flagged'}.`
  );
  subject =
    pick.weakest && (pick.weakest.masteryScore || 0) < 80
      ? `Refresher: ${stripMarkers(pick.lesson.title)} — ${pick.weakest.name} at ${pick.weakest.masteryScore || 0}%`
      : `Refresher: ${stripMarkers(pick.lesson.title)}`;
  body = refresherBody({ pick, qotd, decay, coach, data });
  title = 'Daily refresher';
}

const html = shell({
  title,
  dateLine,
  statLine: `🔥 ${streak}-day streak · ${completedCount} lessons done`,
  body: body.html,
  footer: body.footer,
});

writeFileSync('email.html', html);
setOutput('send', 'true');
setOutput('subject', subject);
console.log(`Built email.html — subject: ${subject}`);

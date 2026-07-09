// ai.js — Claude API wrapper. Everything funnels through callClaude() so the
// transport (direct browser call today) can be swapped for a proxy later with
// zero changes to lessons/quiz/coach.

import { getSettings } from './store.js';

const MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Shared context injected into every generation prompt.
export const CHRIS_CONTEXT = `You are assisting Chris, Director of Customer Success at Lofty (lofty.com, formerly Chime).
His responsibilities span Technical Support, Onboarding, Customer Success Management, Billing, Customer Operations, AI initiatives, KPIs, and executive reporting.

About Lofty and its customers:
- Lofty is an AI-powered platform ("agentic AI operating system") for residential real estate: AI CRM with autonomous lead engagement and appointment booking, IDX agent websites, lead generation (PPC, social ads, direct mail), marketing automation (Social Studio), power dialer, and transaction management.
- Customers are realtors — from individual agents to teams to brokerages (SMB through MidMarket/enterprise) — paying premium prices (roughly $449/month core up to ~$1,500/month enterprise, plus onboarding fees).
- Premium pricing means high expectations: customers judge value by lead ROI and closings. Churn risk spikes when lead quality disappoints, onboarding stalls, or agents don't adopt the tools. Customers are commission-based small-business owners — cost-sensitive, seasonal, and quick to escalate when ad spend or billing feels off.
- Lofty's public help center is help.lofty.com. For product-specific topics, suggest relevant help-center areas by name as further reading — never invent specific article URLs.

VOICE: All generated content speaks directly to Chris as "you" — like a textbook author or coach addressing the reader. Never refer to him as "Chris" or in the third person inside lesson text, examples, insights, quiz questions, or feedback. ("Your Manila billing team…", not "Chris's Manila billing team…")

His org, specifically:
- Support: leads the support team in Manila and directly manages a US-based global support lead.
- Website services: manages a US website project manager and partners with the Manila website team.
- Billing: manages a Sr. Billing Specialist (US) and partners with a small billing & collections team in Manila.
- Client Success: indirectly oversees a US MidMarket Client Success team and a Manila SMB CSM team.
- China: frequently partners with China teams on operations and leadership.

Schedule reality: the Manila team works US-aligned hours (a night shift in Manila local time), not Manila daytime hours — they overlap with Chris's US business hours, not the other way around. Never write examples assuming a Manila-daytime/US-evening timezone gap (e.g. "6am for your Manila team" or "waiting for US hours to hand off") — that framing is backwards. If a timezone tension is relevant, it's the toll a night shift takes on Manila staff, not a same-day handoff delay.

Cross-cultural and remote leadership (US/Manila/China), managing through indirect influence, and partnering across org lines are recurring themes. When relevant, ground concepts in this actual structure — e.g. escalations flowing between Manila support and US leads, billing recovery via the Manila collections team, or influencing the CSM teams he doesn't directly own.`;

export class AIError extends Error {}

export function hasApiKey() {
  return Boolean(getSettings().apiKey);
}

// The single transport seam. To move to a proxy later, change only this fn.
async function callClaude({ system, messages, maxTokens = 2048, temperature }) {
  const { apiKey } = getSettings();
  if (!apiKey) {
    throw new AIError('No Claude API key set. Add one in Settings.');
  }

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages,
  };
  if (system) body.system = system;
  if (temperature != null) body.temperature = temperature;

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for direct browser access. Remove when moving to a proxy.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AIError(`Network error reaching Claude: ${err.message}`);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {
      /* ignore */
    }
    throw new AIError(`Claude API ${res.status}: ${detail || res.statusText}`);
  }

  const json = await res.json();
  return (json.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Strip accidental markdown fences before JSON.parse.
function stripFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

// Generate JSON with one defensive retry if parsing fails.
async function generateJSON({ system, prompt, maxTokens }) {
  const attempt = async (extra) => {
    const raw = await callClaude({
      system,
      maxTokens,
      messages: [{ role: 'user', content: prompt + (extra || '') }],
    });
    return JSON.parse(stripFences(raw));
  };
  try {
    return await attempt('');
  } catch (err) {
    if (err instanceof AIError) throw err;
    // Parse failure — retry once, reminding it to return raw JSON only.
    return attempt(
      '\n\nIMPORTANT: Respond with valid JSON only. No prose, no markdown fences.'
    );
  }
}

// ---------- Lessons ----------

// Design a progressive curriculum for a topic. Each lesson generation then
// targets the next planned entry, so lessons build instead of repeating.
export async function generateSyllabus({ topicName, topicDescription, priorTitles = [], count = 6 }) {
  const system = `${CHRIS_CONTEXT}\n\nYou design progressive learning curricula. Respond with JSON only — no markdown, no fences.`;
  const prompt = `Design a ${count}-lesson curriculum for the topic "${topicName}"${
    topicDescription ? ` (${topicDescription})` : ''
  }.
${priorTitles.length ? `Already covered — do not repeat: ${priorTitles.join('; ')}.` : ''}
Lessons must build progressively from foundations to advanced application, each covering clearly distinct ground.

Return JSON: { "lessons": [ { "title": "short lesson title", "focus": "one sentence: what this lesson covers and why it comes at this point" } ] }`;
  return generateJSON({ system, prompt, maxTokens: 1200 });
}

export async function generateLesson({ topicName, topicDescription, priorTitles = [], plannedTitle, plannedFocus }) {
  const system = `${CHRIS_CONTEXT}\n\nYou are an expert educator writing a focused, practical textbook-style micro-lesson. Respond with JSON only — no markdown, no fences.`;
  const prompt = `Create a lesson for the topic "${topicName}"${
    topicDescription ? ` (${topicDescription})` : ''
  }.
${plannedTitle ? `This lesson is a planned curriculum entry. Title it "${plannedTitle}" and keep its scope to: ${plannedFocus || 'the planned title'}.` : ''}
${priorTitles.length ? `Avoid repeating these existing lessons: ${priorTitles.join('; ')}.` : ''}

Return JSON with exactly this shape:
{
  "title": "short lesson title",
  "objectives": ["2-4 learning objectives"],
  "concepts": ["3-6 key concept names, each a short noun phrase"],
  "sections": [
    { "heading": "short subtitle naming one core idea", "text": "1-2 short paragraphs teaching that idea, plain text" }
  ],
  "example": { "title": "short scenario name", "text": "one concrete worked example applying the lesson to the reader's actual role and teams, addressed to 'you'" },
  "pauseAndThink": { "question": "one check-your-understanding question a reader should pause on", "answer": "a concise model answer" },
  "glossary": [ { "term": "key term", "definition": "one-sentence plain-English definition" } ],
  "insights": ["exactly 3 key insights"],
  "action": "one concrete action you can take today, addressed to 'you'",
  "leadershipTakeaway": "one leadership takeaway",
  "productivityTip": "one productivity improvement",
  "discussionQ": "one thought-provoking discussion question"
}

Write 3-5 sections, each a single core idea a textbook would give its own subheading. Glossary covers the lesson's key terms (3-6 entries).

In section text, "example.text", "insights", "action", "leadershipTakeaway", and "productivityTip", wrap the most important key terms in double asterisks like **this** — the app renders them as highlights. Highlight sparingly: 1-3 terms per paragraph or item, only genuinely load-bearing vocabulary. No other markdown.`;
  return generateJSON({ system, prompt, maxTokens: 3500 });
}

// ---------- Quizzes ----------

export async function generateQuiz({ lessonTitle, concepts = [], content = '', focusConcepts = [] }) {
  const system = `${CHRIS_CONTEXT}\n\nYou write rigorous but fair comprehension quizzes, strictly grounded in the provided lesson content. Respond with JSON only — no markdown, no fences.`;
  const prompt = `Write a quiz for the lesson "${lessonTitle}".
Key concepts: ${concepts.join(', ')}.
${focusConcepts.length ? `RETEST: the learner missed these concepts last attempt — concentrate most questions on them: ${focusConcepts.join(', ')}.` : ''}

LESSON CONTENT — the only source of truth:
---
${content.slice(0, 7000)}
---

Rules:
- Every question must be answerable solely from the lesson content above. Never test facts the lesson does not state, even if you know them.
- 4-6 questions, all multiple choice. No short-answer questions — every question must have exactly four options and one correct answer, so the quiz can be graded entirely on-device.
- Tie every question to one of the key concepts via the "concept" field.
- This app is for quick study sessions — keep everything terse.
- All four options must be roughly the SAME length and level of detail as each other (within a few words). Never let the correct option be noticeably longer, more qualified, or more complete than the distractors — that's a giveaway, not a real test. If the correct fact needs more words to state accurately, add comparable qualifying detail to the distractors too, don't just pad them with filler.

Return JSON:
{
  "questions": [
    { "type": "mc", "concept": "concept name", "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 }
  ]
}`;
  return generateJSON({ system, prompt, maxTokens: 2000 });
}

// Grade a batch of short-answer responses. Returns [{ correct, score, feedback }].
// Generous partial credit: correct elements earn points even in imperfect answers.
export async function gradeShortAnswers(items) {
  if (!items.length) return [];
  const system = `You are a fair, generous grader who rewards partial understanding. Respond with JSON only — no markdown, no fences.`;
  const prompt = `Grade these short-answer responses against their model answers.

Rubric:
- Break each model answer into its key elements. Award proportional credit for every element the answer captures, in ANY wording — synonyms and plain language count fully.
- Reward correct reasoning explicitly. Never require the model answer's phrasing, completeness, or polish.
- Do not punish brevity when the core idea is right.
- Scale: 100 = essentially all key elements; 80 = solid grasp, minor gaps; 60 = right core idea, real gaps; 40 = some correct elements present; 20 = mostly off; 0 = nothing correct.
- "correct" is true when score >= 60.
- Feedback (1-2 sentences): FIRST name what was right, THEN the single most important missing element.

${JSON.stringify(items, null, 2)}

Return JSON: { "results": [ { "score": 0-100, "correct": true/false, "feedback": "..." } ] } in the same order.`;
  const out = await generateJSON({ system, prompt, maxTokens: 1500 });
  return out.results || [];
}

// ---------- Executive Coach ----------

export function coachSystemPrompt(contextSummary) {
  return `${CHRIS_CONTEXT}

You are Chris's executive coach: direct, challenging, and sharp. You push back, question assumptions, and identify blind spots. You connect ideas across his lessons and role. You do NOT simply agree or flatter — if his thinking is weak, say so and show the better path. Be concise and provocative, like a top-tier executive coach who respects his time.

Recent learning context:
${contextSummary || '(no learning history yet)'}`;
}

// Streaming-free coach turn. `history` is [{role, content}] of prior turns.
export async function coachReply({ contextSummary, history }) {
  return callClaude({
    system: coachSystemPrompt(contextSummary),
    messages: history,
    maxTokens: 1024,
    temperature: 0.8,
  });
}

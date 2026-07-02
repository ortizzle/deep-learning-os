// ai.js — Claude API wrapper. Everything funnels through callClaude() so the
// transport (direct browser call today) can be swapped for a proxy later with
// zero changes to lessons/quiz/coach.

import { getSettings } from './store.js';

const MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Shared context injected into every generation prompt.
export const CHRIS_CONTEXT = `You are assisting Chris, Director of Customer Success at Lofty (an AI-powered real estate platform).
His responsibilities span Technical Support, Onboarding, Customer Success Management, Billing, Customer Operations, AI initiatives, KPIs, and executive reporting.
He leads teams across the US, Manila (Philippines), and China, so cross-cultural and remote leadership are recurring themes.
When relevant, relate concepts back to these responsibilities and to leading distributed, cross-cultural teams.`;

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

export async function generateLesson({ topicName, topicDescription, priorTitles = [] }) {
  const system = `${CHRIS_CONTEXT}\n\nYou are an expert instructional designer creating a focused, practical micro-lesson. Respond with JSON only — no markdown, no fences.`;
  const prompt = `Create a lesson for the topic "${topicName}"${
    topicDescription ? ` (${topicDescription})` : ''
  }.
${priorTitles.length ? `Avoid repeating these existing lessons: ${priorTitles.join('; ')}.` : ''}

Return JSON with exactly this shape:
{
  "title": "short lesson title",
  "objectives": ["2-4 learning objectives"],
  "concepts": ["3-6 key concept names, each a short noun phrase"],
  "body": "the main teaching content as 3-6 short paragraphs of markdown-free plain text",
  "insights": ["exactly 3 key insights"],
  "action": "one concrete action Chris can take today",
  "leadershipTakeaway": "one leadership takeaway",
  "productivityTip": "one productivity improvement",
  "discussionQ": "one thought-provoking discussion question"
}`;
  return generateJSON({ system, prompt, maxTokens: 2500 });
}

// ---------- Quizzes ----------

export async function generateQuiz({ lessonTitle, concepts = [], body = '' }) {
  const system = `${CHRIS_CONTEXT}\n\nYou write rigorous but fair comprehension quizzes. Respond with JSON only — no markdown, no fences.`;
  const prompt = `Write a quiz for the lesson "${lessonTitle}".
Key concepts: ${concepts.join(', ')}.
Lesson content: ${body.slice(0, 2000)}

Return 5-8 questions mixing multiple choice and short answer as JSON:
{
  "questions": [
    { "type": "mc", "concept": "concept name", "question": "...", "options": ["A","B","C","D"], "correctIndex": 0 },
    { "type": "short", "concept": "concept name", "question": "...", "modelAnswer": "a concise ideal answer" }
  ]
}
Tie every question to one of the key concepts via the "concept" field.`;
  return generateJSON({ system, prompt, maxTokens: 2500 });
}

// Grade a batch of short-answer responses. Returns [{ correct, score, feedback }].
export async function gradeShortAnswers(items) {
  if (!items.length) return [];
  const system = `You are a fair grader. Respond with JSON only — no markdown, no fences.`;
  const prompt = `Grade these short-answer responses. For each, give a score 0-100, whether it counts as correct (>=60), and one sentence of constructive feedback.

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

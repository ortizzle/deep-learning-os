
## Project

Build **Deep Learning OS**, a personal AI-powered learning platform for Chris, Director of Customer Success at Lofty. It is a static multi-file web app (PWA) deployed to GitHub Pages at `ortizzle.github.io/deep-learning-os/`. No server, no build step, no frameworks — vanilla HTML/CSS/JS with ES modules loaded via `<script type="module">`.

This is v1 of a phased build. Ship a tight core loop, but design the data layer so v2 (full spaced repetition) and v3 (knowledge graph, monthly themes) drop in without migrations.

## v1 Scope (build these)

1. **Topics & Lessons** — User creates topics (e.g. "Customer Success", "Executive Communication", "SQL"). For each topic the Claude API generates structured lessons: learning objectives, key concepts, practical application, summary. Every lesson ends with: three key insights, one action for today, one leadership takeaway, one productivity improvement, one discussion question.
2. **Quizzes** — After each lesson, Claude generates a quiz (mix of multiple choice + short answer, 5–8 questions). Grade MC locally; send short answers to Claude for evaluation with feedback. Store score, timestamp, and per-concept results.
3. **Executive Coach** — A dedicated chat view. System prompt: a direct, challenging executive coach who pushes back, questions assumptions, identifies blind spots, and connects ideas across topics. It has access to a summary of recent lessons, quiz performance, and weak areas (inject as context). It must not simply agree.
4. **Dashboard + Gamification** — Home screen showing: current streak, XP, level, lessons completed, learning minutes (timer-based like the Summer Reading app), weakest/strongest topics, recommended next lesson, recent achievements. Achievements: first lesson, 7-day streak, 10 quizzes, first coach session, topic mastered, etc.
5. **Hidden mastery tracking (v2 foundation)** — Every quiz result updates a per-concept mastery score (0–100, simple weighted average for now). Store `lastReviewed`, `timesReviewed`, `masteryScore` per concept. Do NOT build the review scheduler yet — just accumulate the data.

## Out of scope for v1 (do not build)

Spaced repetition scheduler, knowledge graph visualization, semantic search, monthly themes, integrations (Notion/Gmail/etc.), role-playing scenarios, case study simulations. Leave clean extension points.

## Architecture

```
deep-learning-os/
├── index.html          # shell + view containers
├── styles.css          # single stylesheet, CSS custom properties for theming
├── app.js              # router, view switching, init
├── modules/
│   ├── store.js        # data layer: IndexedDB local-first + Gist sync
│   ├── ai.js           # Claude API wrapper (lessons, quizzes, coach, grading)
│   ├── lessons.js      # topic/lesson CRUD + rendering
│   ├── quiz.js         # quiz flow, grading, mastery updates
│   ├── coach.js        # executive coach chat
│   ├── dashboard.js    # dashboard rendering, streaks, XP
│   └── gamification.js # XP rules, levels, achievements
├── manifest.json       # PWA manifest
└── sw.js               # service worker, cache-first shell
```

## Data layer (store.js) — important

- **Local-first**: all reads/writes go to IndexedDB (not localStorage — quota matters here).
- **Gist sync**: mirror the same pattern as Chris's other apps. A single private GitHub Gist holds a JSON snapshot. On app load, pull and merge (newest `updatedAt` wins per record); after writes, debounce-push (~5s). Gist token + gist ID stored in a settings view (localStorage is fine for the token only). If no token configured, app runs local-only — everything must work without sync.
- Schema (all records carry `id`, `createdAt`, `updatedAt`):
  - `topics`: { name, description, lessonIds[] }
  - `lessons`: { topicId, title, objectives[], concepts[], body, insights, action, leadershipTakeaway, productivityTip, discussionQ, completedAt }
  - `quizzes`: { lessonId, questions[], answers[], score, conceptResults[] }
  - `concepts`: { name, topicId, masteryScore, lastReviewed, timesReviewed }
  - `coachSessions`: { messages[], summary }
  - `profile`: { xp, level, streak, lastActiveDate, achievements[], learningMinutes, goals }
- Version the snapshot: `{ schemaVersion: 1, data: {...} }` so v2 can migrate.

## Claude API (ai.js)

- Endpoint `https://api.anthropic.com/v1/messages`, model `claude-sonnet-4-6`, key entered by user in settings and stored locally (same pattern as The Reading Room).
- All generation prompts must demand **JSON-only responses** (no markdown fences); strip fences defensively before `JSON.parse`, wrap in try/catch with a retry.
- Shared context block injected into every prompt: Chris is Director of Customer Success at Lofty (AI-powered real estate platform); responsibilities include Technical Support, Onboarding, CSM, Billing, Customer Operations, AI initiatives, KPIs, executive reporting; teams in the US, Manila, and China. Lessons should relate concepts back to these responsibilities and to cross-cultural/remote leadership when relevant.

## Design

Modern, calm, premium. Inspirations: Notion, Linear, Raycast. Minimalist, generous whitespace, beautiful typography (system font stack or a single Google Font like Inter). Light theme default with CSS custom properties so a dark theme is trivial later. Mobile-first — primary device is an iPhone; must feel great as an installed PWA. Subtle, tasteful gamification (no cartoon confetti; think Linear-style polish).

## Workflow rules

- Work in small commits with clear messages; I'll push via `gh`/GitHub Desktop.
- Before large UI work, show me a brief plan of the view layout for approval.
- Never destructive: don't rewrite whole files for small changes; make surgical edits.
- After the initial scaffold, give me a checklist to test locally (`python3 -m http.server` or just opening index.html) before deploy.

## First deliverable

Scaffold the full file structure with a working shell: navigation between Dashboard / Topics / Coach / Settings views, IndexedDB store initialized with the schema above, settings view for API key + Gist config, and one end-to-end happy path: create a topic → generate one lesson → take its quiz → see XP and streak update on the dashboard. Then stop and let me test.

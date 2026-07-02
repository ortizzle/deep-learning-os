# Deep Learning OS

A personal, AI-powered learning platform. Static PWA — no server, no build step,
vanilla HTML/CSS/JS with ES modules. Deploys to GitHub Pages at
`ortizzle.github.io/deep-learning-os/`.

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(A server is needed rather than opening `index.html` directly, because ES
modules and the service worker require an http origin.)

## Setup

1. Open **Settings**, paste a Claude API key (`sk-ant-...`). It is stored only
   on this device and used for direct browser calls to the Anthropic API.
2. (Optional) Add a GitHub token with `gist` scope + a Gist ID to sync across
   devices. Leave blank to run fully local.

## Architecture

| File | Role |
|------|------|
| `index.html` | shell + view containers + tab bar |
| `styles.css` | single stylesheet, theming via CSS custom properties |
| `app.js` | hash router, view switching, settings view, boot |
| `modules/store.js` | IndexedDB data layer + optional Gist sync |
| `modules/ai.js` | Claude API wrapper (single `callClaude()` seam) |
| `modules/lessons.js` | topics + lessons + reader |
| `modules/quiz.js` | quiz flow, grading, mastery updates |
| `modules/coach.js` | executive coach chat |
| `modules/dashboard.js` | dashboard, streaks, XP |
| `modules/gamification.js` | XP rules, levels, achievements, mastery |
| `modules/ui.js` | small shared DOM helpers |
| `manifest.json`, `sw.js` | PWA manifest + cache-first service worker |

Data is versioned (`{ schemaVersion: 1, data }`) so v2 (spaced repetition) and
v3 (knowledge graph, monthly themes) can migrate cleanly. Mastery scores already
accumulate per concept; the review scheduler is intentionally not built yet.

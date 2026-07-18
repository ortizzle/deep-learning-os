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

Also: `modules/refresherCore.mjs` holds the pure daily-refresher selection
logic (weakest/stalest completed lesson, question of the day, mastery decay),
shared between the app's Home card (`modules/refresher.js`) and the email
builder (`scripts/daily-refresher.mjs`) so both surfaces agree every day.

## Daily refresher email

A scheduled GitHub Action (`.github/workflows/daily-refresher.yml`) emails a
summarized review of one completed lesson every morning at 6:00 AM Arizona,
picked weakest-mastery/stalest-first. It includes the question of the day
(answer at the bottom of the email), "slipping away" mastery callouts, and a
one-line note from the executive coach. On Fridays it sends a week-in-review
edition instead (lessons completed, follow-through on action items, weekend
review targets).

It reads the same Gist the app syncs to, so **Gist sync must be configured in
the app** for the email to have data. One-time setup — add these repository
secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `GIST_TOKEN` | GitHub token with `gist` scope (same one used in the app) |
| `GIST_ID` | The sync Gist's ID (same as in app Settings) |
| `MAIL_USERNAME` | The Gmail address to send from |
| `MAIL_APP_PASSWORD` | A Gmail [app password](https://myaccount.google.com/apppasswords) (requires 2FA) |
| `ANTHROPIC_API_KEY` | *(optional)* enables the coach one-liner; everything else works without it |

Test it any time from the Actions tab via **Run workflow**. If no lessons are
completed yet, the run exits quietly without sending. Local dry run:

```bash
SNAPSHOT_FILE=path/to/snapshot.json node scripts/daily-refresher.mjs
open email.html
```

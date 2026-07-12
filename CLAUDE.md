# Context for Claude

## Chris's devices — important

- **Primary phone: Google Pixel (Android), NOT an iPhone.** The kickoff doc
  (`deep-learning-os-kickoff.md`) says iPhone — that's outdated; keep the
  mobile-first PWA discipline, just aim it at Android Chrome.
- Android Chrome shares same-origin storage between the browser and installed
  PWAs, which is what makes the Ortiz OS suite's cross-app IndexedDB reads
  work on his phone.

## The suite

This is the first app of the Ortiz OS family — with Focus OS
(`ortiz-focus-os`), Home OS (`ortiz-home-os`), and the read-only hub app
(`ortiz-os-hub`) — all static vanilla-JS PWAs on the `ortizzle.github.io`
origin, one repo and Pages path each. Suite plan: the ROADMAP in the
ortiz-focus-os repo. Standing rules: local-first IndexedDB + optional private
Gist sync with tombstones, no build step, no frameworks, no servers, and each
app is the sole writer of its own database.

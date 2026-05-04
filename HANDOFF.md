# ShelfCycle MVP — Session Handoff

Date: 2026-05-04
Author: prior session (Cowork)
For: continuing work in Claude Code

## Project at a glance

Two connected programs in one repo:

1. **Local ShelfCycle Operator** — review-first assistance for ShelfCycle intake/matching/drafting (Node web app at `server.mjs` → http://localhost:4318).
2. **Hosted Daily Email Intelligence** — scheduled Gmail triage, deployed at `https://clearedge-daily-brief.netlify.app` (linked Netlify site id `6f72e02a-7673-4ff5-852d-e416af3aada5`).

Both share a "knowledge bundle" exported from local ShelfCycle reference data plus an optional Notebook intelligence layer (`data/clearedge-brain-notebook-intelligence.json`).

## What changed this session

Focus area: continuing the **Notebook Intelligence** integration. Two slices landed.

### 1. Local web UI now surfaces Notebook context as a first-class panel

Previously the analyzer computed `notebookContext` (status, primary chemical entity, matched entry, contradictions, brief) but only the brief got prepended into `draftNote.summary`, and only for `call_report` / `email_thread` workflows. Everything else was buried in Raw JSON.

Added a "Notebook Intelligence" section between Draft and Matches:

- Status chip: "Matched against Notebook" / "No historical context yet" / "Primary chemical entity unresolved".
- Pill cards for primary chemical entity, the matched Notebook entry (price, master specs, suppliers).
- Contradictions card (warn-colored) when CAS / purity / flash point / price deltas are detected.
- Learning prompt card (accent-colored) when no Notebook history exists.
- The full `🧠 NotebookLM Intelligence Brief` text block.

Files touched:

- `public/index.html` — added the new `result-section` for Notebook Intelligence.
- `public/app.js` — added `renderNotebookContext` plus DOM refs and the `escapeHtml` / card-builder helpers; called from `analyze()` after `setOutput(draftEl, …)`.
- `public/styles.css` — added `.notebook-summary`, `.notebook-card`, `.notebook-warn`, `.notebook-learn`, `.notebook-list` classes (all additive — no existing rules touched).

### 2. Daily brief now closes the Notebook learning loop

`buildDailyBrief` in `src/lib/daily-brief.mjs` now appends a "Notebook Coverage" section listing:

- **Add to Notebook** — unique `learningPrompt` strings from threads where `notebookContext.status === "no_historical_context"`. (Dedupe across threads.)
- **Reconcile with Notebook** — unique cross-thread contradictions from `notebookContext.contradictions` on matched threads.

The whole appendix is omitted when there's nothing to surface, so routine days stay clean.

Files touched:

- `src/lib/daily-brief.mjs` — added `gatherNotebookCoverage(items)`; threaded its output into the `sections` array conditionally on `hasNotebookCoverage`.
- `test/brief.test.mjs` — added two tests:
  - `buildDailyBrief surfaces unique Notebook learning prompts and contradictions in a coverage appendix` (also asserts dedup of repeated prompts).
  - `buildDailyBrief omits the Notebook Coverage section when there is nothing to surface`.

## Test status

Run from project root:

```bash
node --test
```

Last run: **30 of 31 pass**. The single failure is `export-knowledge auto-merges the project Notebook intelligence file` in `test/export-knowledge.test.mjs`. It hardcodes the host path `/Users/seanwagner/Documents/Playground/shelfcycle-mvp` and `execFile`s a node subprocess with that as `cwd`. The failure was a sandbox artifact in the prior session — on your Mac that path exists, so the test should pass locally. **Verify by running `node --test` once before deploying**; if it actually fails on your machine, that's a real regression and worth investigating before the deploy.

## What still needs to happen

### Immediate: deploy

Not yet pushed to Netlify. From your Mac:

```bash
cd /Users/seanwagner/Documents/Playground/shelfcycle-mvp
netlify deploy           # draft preview — eyeball the new "Notebook Intelligence" panel
netlify deploy --prod    # publish to clearedge-daily-brief.netlify.app
```

The site is already linked. `netlify.toml` has no build command (`publish = "public"`, functions in `netlify/functions`), so the CLI just uploads `public/` and bundles functions with esbuild.

Smoke test before promoting:

1. Open the draft URL.
2. Click "Load Sample Data".
3. Paste any of the analyze-test transcripts (e.g. the RUCOLAC B-321 quote text from `data/clearedge-brain-notebook-intelligence.json`).
4. Confirm the Notebook Intelligence section populates and the brief renders.

Note: the local web UI runs on localhost via `server.mjs`. The deployed Netlify site is the **hosted daily brief service** (functions + the `review-action.html` page), not the local operator UI. So technically the UI changes don't strictly need a Netlify push to be useful locally — but the public/ folder is what Netlify publishes, so any other static page additions would also ship. Decide whether deploying a UI that's primarily local-only is worth it; it's harmless either way.

### Next sensible work items

In rough priority order:

1. **Add a "Mark as Notebook entry" affordance to the UI.** The learning-prompt card just states the question. A single button that copies a draft Notebook entry JSON skeleton (or appends to a working list) would make the loop one click instead of "open the file, paste a stub, restart". The skeleton shape is already encoded in `normalizeNotebookEntry` in `src/lib/notebook-intelligence.mjs`.
2. **Surface Notebook context in `review-action.html`.** The hosted brief links each thread to a manual review packet. That packet currently doesn't show the Notebook brief or contradictions. The data is already on the analyzed thread (`item.analysis.notebookContext`); it's just a render addition in `public/review-action.js` / `.html` and likely a small tweak to `netlify/functions/review-action.mjs` to pass it through.
3. **Aggregate analytics on Notebook hit rate.** With dedupe in place, it's easy to count: "of N analyzed threads, M had notebookContext.status === 'matched', K emitted learning prompts". This could go at the top of the Coverage Summary in the daily brief.
4. **Real PDF parsing.** Still in the README's "what it does not do yet" list. SDS/TDS PDFs currently must be pasted as text. Pulling something like `pdf-parse` (or fetching attachments via Gmail's binary download in `gmail-client.mjs`) would let the daily brief enrich threads with attachment contents.
5. **End-to-end Netlify cold path.** Worth a one-shot manual exercise before relying on it: push knowledge → push settings → curl `/api/run-brief` with `send: false` → read `latest-brief` output. Documented in README "Hosted Sync Flow"; the orchestrator is `src/lib/auto-brief.mjs` and the function is `netlify/functions/run-brief.mjs`.

## Key files for re-orientation

When picking this back up in Claude Code, these are the files that hold most of the relevant context:

- `src/lib/notebook-intelligence.mjs` — the Notebook layer itself (normalize, primary-entity detection, enrichment, brief assembly, contradiction detection).
- `src/lib/analyze.mjs` — orchestrates parsers + matchers + Notebook enrichment + advisory + follow-up.
- `src/lib/daily-brief.mjs` — Notebook surfacing in compact lines (`notebookSuffix`) + the new `gatherNotebookCoverage` appendix.
- `src/lib/email-triage.mjs` — calls `analyzeInput` per thread and preserves `notebookContext` / `learningPrompt` on `analysis`.
- `public/app.js`, `public/index.html`, `public/styles.css` — local operator UI; new Notebook Intelligence panel.
- `data/clearedge-brain-notebook-intelligence.json` — current Notebook seed data (~12 entries).
- `test/analyze.test.mjs`, `test/brief.test.mjs` — coverage for both layers.
- `README.md` — single source of truth for run/deploy commands.

## Things to know that aren't obvious

- The repo is **not a git repository** (no `.git` anywhere). If you want git history, `git init` first; otherwise the deploy path is purely Netlify CLI.
- `node --test` runs everything under `test/` automatically — no test runner config to worry about.
- The Notebook brief is prepended to `draftNote.summary` only when one exists. The new UI panel renders the brief regardless of workflow, so users now see it on `new_product` / `new_customer` etc. too. Don't accidentally remove the prepend logic in `enrichWithNotebookContext` — both paths are intentional.
- Notebook entries support several alias key shapes (`aliases`, `productAliases`, etc.); see `normalizeNotebookEntry` if you're hand-editing the JSON.
- Match thresholds for the Notebook layer are 0.48 (entity detection from text) and 0.48 (matched entry lookup). Bump these if you see false positives or pull them down if you see misses on close paraphrases.

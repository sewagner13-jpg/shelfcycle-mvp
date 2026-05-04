# ShelfCycle MVP

Working codebase for two connected ClearEdge programs:

1. `Local ShelfCycle Operator`
   Review-first assistance for ShelfCycle intake, matching, drafting, and eventually local browser write-back.

2. `Hosted Daily Email Intelligence`
   A scheduled Gmail triage service that uses a shared ClearEdge knowledge bundle so the daily brief understands customers, contacts, products, and supplier context.

What it does:
- Classifies pasted input as a `call report`, `new product`, `new customer`, `new contact`, or `new location`
- Supports pasted `email threads` as a first-class workflow
- Matches pasted content against exported ShelfCycle reference data
- Drafts:
  - customer notes / call reports
  - email-thread notes
  - product intake from SDS/TDS text
  - customer/contact/location create payloads
  - follow-up email drafts
- Builds role-based worklists for:
  - owner
  - sales
  - procurement
- Produces a `write plan` showing where the data belongs in ShelfCycle
- Exports a shared `knowledge bundle` from local ShelfCycle reference data
- Includes a hosted-ready Gmail brief runner that can:
  - fetch recent Gmail threads
  - inspect Gmail attachments and Google Drive links
  - classify threads as customer, supplier, employee/internal, or solicitation
  - determine `needs attention` vs `waiting on others`
  - produce a daily triage brief
  - optionally send the brief back by email
- Includes a local Messages memory source so iMessage/SMS threads on this Mac can produce a separate `Message Memory` section in the daily brief

What it does not do yet:
- Log into ShelfCycle on its own
- Submit changes back into ShelfCycle automatically
- Parse binary PDFs directly
- Deploy the hosted brief service for you automatically without either:
  - a working local Netlify CLI auth token, or
  - Git-connected auto deploys on the Netlify site
- Read Apple Messages unless Codex has macOS permission to access `~/Library/Messages`

What it can now do locally:
- open a review packet in a local approval screen
- open a dedicated ShelfCycle browser session for login/bootstrap
- submit an approved `New Note` into ShelfCycle through local browser automation

Important safety rule:
- hosted review packets remain read-only
- actual ShelfCycle write-back only runs from the local app after explicit approval

## Strategy Docs

- Brand concept: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/docs/clearedge-brand-concept.md`
- Assistant operating model: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/docs/clearedge-assistant-operating-model.md`

## Run

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/server.mjs
```

Then open:

```text
http://localhost:4318
```

Local approval page:

```text
http://localhost:4318/review-submit.html
```

## Local Netlify CLI

This repo now includes a project-local Netlify CLI wrapper so this machine does not depend on a globally installed `npm` or `netlify` binary.

First run:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/scripts/netlify-cli.mjs --version
```

That command bootstraps a local npm CLI under `.tooling/` and installs `netlify-cli` there.

Helpful commands:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/scripts/netlify-cli.mjs login
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/scripts/netlify-cli.mjs status
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/scripts/netlify-cli.mjs deploy --prod
```

Equivalent package scripts:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/scripts/netlify-cli.mjs --version
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/scripts/netlify-cli.mjs deploy --prod
```

For non-interactive deploys, set `NETLIFY_AUTH_TOKEN` in the shell environment before running deploy commands.

If the Netlify site is connected to GitHub for continuous deployment, pushing to the production branch should be the preferred deploy path. Netlify’s docs describe:
- local or global CLI installation with npm
- token-based CLI authentication
- Git-connected deploys that publish on `git push`

Sources:
- [Get started with Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/)
- [Create deploys](https://docs.netlify.com/site-deploys/create-deploys/)
- [Repository permissions and linking](https://docs.netlify.com/git/repo-permissions-linking/)

## Inputs

The app works best when you paste:
- transcript text
- email threads
- SDS/TDS text copied from a PDF or document
- contact block
- customer website/about text
- location/address block

## Reference Data

You can load:
- a JSON bundle shaped like `data/examples/reference-data.json`
- ShelfCycle CSV exports for products, customers, contacts, or locations

The importer is intentionally permissive about column names and keeps unmapped fields in `raw`.

## Shared Knowledge Layer

The local and hosted programs connect through a `knowledge bundle`.

It contains:
- customers
- contacts
- products
- locations
- optional ClearEdge intelligence entries
- internal users/domains
- supplier overrides
- lookup maps for domains, emails, supplier names, product aliases, and ClearEdge intelligence aliases

ClearEdge intelligence schema example:
- `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/examples/notebook-intelligence.json`
- Native project intelligence file:
  - `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/clearedge-intelligence.json`
- Legacy Notebook export kept for compatibility:
  - `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/clearedge-brain-notebook-intelligence.json`

When `clearedgeIntelligence` is present, the analyzer will:
- identify a primary chemical entity before historical enrichment
- match against ClearEdge historical notes and master specs
- prepend a `ClearEdge Intelligence Brief` to call and email drafts when context is found
- flag contradictions such as CAS, purity, flash point, or price deltas
- emit a learning prompt when a chemical has no ClearEdge intelligence history yet
- surface matched pricing, logistics, or compliance context inside the daily email brief
- accept legacy `notebookIntelligence` payloads for backward compatibility

You can create it in two ways:

1. In the local web app:
   - load ShelfCycle exports
   - the app auto-loads `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/clearedge-intelligence.json` when present
   - click `Export Knowledge Bundle`

2. From the command line:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/local-sync/export-knowledge.mjs \
  --input /path/to/products.csv \
  --input /path/to/customers.csv \
  --input /path/to/contacts.csv \
  --out /path/to/clearedge-knowledge.json \
  --overrides /Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/examples/knowledge-overrides.json
```

If `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/clearedge-intelligence.json` exists, `export-knowledge.mjs` automatically merges it into the bundle so hosted daily briefs and local note drafts stay intelligence-aware by default. If only the legacy notebook export exists, the CLI will fall back to that file automatically.

Sample overrides file:
- `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/examples/knowledge-overrides.json`

## API

### `POST /api/analyze`

Request:

```json
{
  "text": "pasted content",
  "workflow": "auto",
  "referenceData": {
    "products": [],
    "customers": [],
    "contacts": [],
    "locations": [],
    "clearedgeIntelligence": []
  }
}
```

### `POST /api/import-csv`

Request:

```json
{
  "csvText": "header1,header2\nvalue1,value2",
  "entityType": "products",
  "fileName": "products.csv"
}
```

### `POST /api/export-knowledge`

Request:

```json
{
  "referenceData": {
    "products": [],
    "customers": [],
    "contacts": [],
    "locations": [],
    "clearedgeIntelligence": []
  },
  "internalDomains": ["clear-edge.net"],
  "internalUsers": [],
  "suppliers": [],
  "metadata": {
    "organization": "ClearEdge Solutions"
  }
}
```

## Hosted Daily Brief

The hosted brief is designed to run as a scheduled command in a cloud environment, not as a browser session.

Entry point:
- `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/daily-brief/run.mjs`

Local Gmail brief with Message Memory enabled:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/daily-brief/run.mjs \
  --bundle /path/to/clearedge-knowledge.json \
  --settings /path/to/hosted-settings.json \
  --messages-memory-config /Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/examples/messages-memory-config.json \
  --hours 24
```

Shortcut flag for default local Messages settings:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/daily-brief/run.mjs \
  --bundle /path/to/clearedge-knowledge.json \
  --include-messages \
  --hours 24
```

Optional flags for local text-message ingestion:
- `--settings /path/to/hosted-settings.json`
- `--max-message-threads 120`
- `--messages-db /Users/seanwagner/Library/Messages/chat.db`
- `--messages-memory-config /path/to/messages-memory-config.json`

Messages modules:
- low-level read-only adapter: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/messages-client.mjs`
- memory summarizer: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/messages-memory.mjs`
- config loader/defaults: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/messages-memory-config.mjs`
- local summarized store: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/messages-memory-store.mjs`
- sample config: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/examples/messages-memory-config.json`

Important local requirement for Messages:
- Codex must have permission to read `~/Library/Messages`
- if the run says access was denied, grant Full Disk Access or Files access for the Messages folder and retry
- the app only copies `chat.db`, `chat.db-wal`, and `chat.db-shm` into a temporary folder before querying
- the app never writes to Apple Messages and stores only summarized memory metadata in its own store by default

Deployed Netlify site:
- `https://clearedge-daily-brief.netlify.app`

Core modules:
- Gmail client: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/gmail-client.mjs`
- Thread triage: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/email-triage.mjs`
- Brief generation: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/daily-brief.mjs`
- Orchestrator: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/src/lib/auto-brief.mjs`

Netlify functions:
- knowledge sync: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/netlify/functions/knowledge-sync.mjs`
- settings sync: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/netlify/functions/settings-sync.mjs`
- manual run: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/netlify/functions/run-brief.mjs`
- latest brief: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/netlify/functions/latest-brief.mjs`
- scheduled run: `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/netlify/functions/daily-brief-scheduled.mjs`

Run a dry-run brief:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/daily-brief/run.mjs \
  --bundle /path/to/clearedge-knowledge.json \
  --settings /path/to/hosted-settings.json \
  --out /path/to/brief.txt
```

Run and send the brief:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/daily-brief/run.mjs \
  --bundle /path/to/clearedge-knowledge.json \
  --send \
  --recipient you@example.com
```

Supported Gmail auth sources:
- env vars:
  - `GMAIL_CLIENT_ID`
  - `GMAIL_CLIENT_SECRET`
  - `GMAIL_REFRESH_TOKEN`
  - `GMAIL_USER`
- or file-based JSON:
  - `GMAIL_CREDENTIALS_PATH`
  - `GMAIL_TOKEN_PATH`

To enrich the brief with Google Drive file metadata from linked docs, mint the OAuth token with Drive scope too:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/local-sync/get-refresh-token.mjs \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET \
  --out /path/to/token.json \
  --include-drive
```

Without `drive.readonly`, the brief still uses Gmail attachments and can detect Drive links, but it cannot resolve linked Google file names/owners.

## Hosted Sync Flow

1. Export or generate a knowledge bundle locally.
2. Push it to the hosted service:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/local-sync/push-knowledge.mjs \
  --bundle /path/to/clearedge-knowledge.json \
  --endpoint https://clearedge-daily-brief.netlify.app/api/knowledge-sync \
  --token YOUR_SYNC_TOKEN
```

3. Build a hosted Gmail settings file from local OAuth files if you have them:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/local-sync/make-hosted-settings.mjs \
  --credentials /path/to/credentials.json \
  --token /path/to/token.json \
  --out /path/to/hosted-settings.json
```

4. Push hosted Gmail settings:

```bash
node /Users/seanwagner/Documents/Playground/shelfcycle-mvp/apps/local-sync/push-settings.mjs \
  --settings /path/to/hosted-settings.json \
  --endpoint https://clearedge-daily-brief.netlify.app/api/settings-sync \
  --token YOUR_SYNC_TOKEN
```

5. Trigger a dry-run hosted brief:

```bash
curl -X POST https://clearedge-daily-brief.netlify.app/api/run-brief \
  -H "content-type: application/json" \
  -H "authorization: Bearer YOUR_SYNC_TOKEN" \
  --data '{"send":false}'
```

Template:
- `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/examples/hosted-brief-settings.template.json`

## Suggested MVP usage

1. Export products, customers, and contacts from ShelfCycle.
2. Load those files into the app.
3. Paste a transcript or SDS/TDS text.
4. Review the generated draft and match suggestions.
5. Review the owner, sales, and procurement worklists.
6. Export the knowledge bundle for the hosted brief service.
7. Use the `write plan` to enter or review the changes in ShelfCycle.

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

What it does not do yet:
- Log into ShelfCycle on its own
- Submit changes back into ShelfCycle automatically
- Parse binary PDFs directly
- Deploy the hosted brief service for you automatically

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
- optional Notebook intelligence entries
- internal users/domains
- supplier overrides
- lookup maps for domains, emails, supplier names, product aliases, and Notebook entity aliases

Notebook intelligence schema example:
- `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/examples/notebook-intelligence.json`
- Current project Notebook export:
  - `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/clearedge-brain-notebook-intelligence.json`

When `notebookIntelligence` is present, the analyzer will:
- identify a primary chemical entity before historical enrichment
- match against Notebook-style historical notes and master specs
- prepend a `NotebookLM Intelligence Brief` to call and email drafts when context is found
- flag contradictions such as CAS, purity, flash point, or price deltas
- emit a learning prompt when a chemical has no Notebook history yet
- surface matched Notebook price, logistics, or compliance context inside the daily email brief

You can create it in two ways:

1. In the local web app:
   - load ShelfCycle exports
   - the app auto-loads `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/clearedge-brain-notebook-intelligence.json` when present
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

If `/Users/seanwagner/Documents/Playground/shelfcycle-mvp/data/clearedge-brain-notebook-intelligence.json` exists, `export-knowledge.mjs` automatically merges it into the bundle so hosted daily briefs and local note drafts stay Notebook-aware by default.

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
    "notebookIntelligence": []
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
    "notebookIntelligence": []
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

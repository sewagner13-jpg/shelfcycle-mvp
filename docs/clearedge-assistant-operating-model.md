# ClearEdge Assistant Operating Model

## Short Answer

Yes. The automation path is figured out.

The right system is not one giant bot. It is a **stack of smaller assistants and automations** that sit around ShelfCycle, Gmail, and your document flow.

The build should follow this order:

1. Intake and drafting
2. Entity matching against ShelfCycle
3. Human review
4. Browser or API write-back
5. Background monitoring and daily digests

That is the safest and most useful path for ClearEdge.

## The Core Problem

Your job is really four jobs at once:

- owner
- sales lead
- procurement lead
- systems operator

Most of the friction is not in any one app. It is in the handoff between:

- calls and notes
- Gmail and follow-up
- documents and product records
- supplier pricing and customer pricing
- opportunities and supply reality

The assistant should exist to reduce those handoff losses.

## What The Assistant Should Be

ClearEdge needs an **operating assistant** that can:

- read pasted input
- search and normalize against ShelfCycle
- search Gmail for missing context
- draft the right note, record, or follow-up
- separate action items into owner, sales, and procurement queues
- write back only after review

## What It Can Do Right Now

Using the current MVP plus live ShelfCycle/Gmail assistance, the system can already support:

### ShelfCycle Intake

- transcript to call report draft
- SDS or TDS to product intake draft
- contact block to new contact draft
- website text to new customer draft
- address block to new location draft

### Matching And Normalization

- product matching against your catalog
- customer matching
- contact matching
- location matching
- duplicate warnings
- spelling normalization from real records

### Gmail Support

- find pricing threads
- find SDS, TDS, and COA emails
- summarize supplier and customer threads
- extract contact details
- build ShelfCycle-ready follow-up notes

### Role-Based Worklists

The MVP now produces:

- owner worklist
- sales worklist
- procurement worklist
- automation ideas tied to the current item

## The Best Automation Structure

## Layer 1: Draft-First Assistant

This is the current foundation.

Input:

- transcript
- email thread
- SDS
- TDS
- contact block
- website
- location

Output:

- ShelfCycle write plan
- role-based worklists
- duplicate flags
- suggested next actions

This layer should always exist, even after deeper automation is built.

## Layer 2: ShelfCycle Write-Back

This layer should use the live ShelfCycle UI unless API access appears later.

Actions:

- create note
- create contact
- create customer
- create location
- create product
- upload TDS to Documents
- attach SDS in product setup flow

Rule:

Anything that creates or changes records should stay **review-first** until enough trust is built.

## Layer 3: Gmail-Driven Follow-Up

This is one of the highest-value additions.

After a note or product draft is created, the assistant should be able to:

- draft the follow-up email
- pull the last related thread
- attach the right pricing, SDS, TDS, or COA context
- suggest who should receive the reply

This is especially strong for:

- sample follow-up
- pricing follow-up
- documentation requests
- supplier quote chase
- customer visit recap

## Layer 4: Daily Work Queues

This is where the assistant becomes materially useful as an owner.

Each day, it should produce:

### Owner Brief

- largest opportunities needing decision
- stocking bets and inventory risk
- price increase exposure
- supplier concentration risk
- overdue strategic follow-ups
- documentation gaps blocking revenue

### Sales Queue

- call reports not yet logged
- quotes not yet followed up
- samples sent with no next step
- contacts discovered in Gmail but not in ShelfCycle
- accounts with active threads but stale notes

### Procurement Queue

- supplier quotes to normalize
- missing SDS, TDS, COA
- lead-time or freight risks
- MOQ or pack-size conflicts
- products discussed in sales threads but not fully built in ShelfCycle

## Where I Can Help You By Job Function

## Owner

I can help with:

- daily executive brief from ShelfCycle and Gmail
- top opportunities by urgency and value
- accounts worth inventory commitment
- supplier concentration and dependency review
- price increase impact summaries
- account coverage gaps
- candidate hires or territory structure notes from workflow patterns

High-value recurring automation:

- `Morning Owner Brief`
- `Weekly Strategic Risk Digest`

## Sales

I can help with:

- call report drafting
- pre-meeting briefs from Gmail and ShelfCycle history
- post-meeting next-step extraction
- quote follow-up drafting
- account research and product-match suggestions
- contact discovery and record cleanup
- sample chase sequences

High-value recurring automation:

- `End-of-Day Sales Action Queue`
- `Sample Follow-Up Monitor`

## Procurement

I can help with:

- supplier quote normalization
- landed-cost comparison
- DDP, FOB, and EXW comparison summaries
- document chase workflow for SDS, TDS, COA
- lead-time and freight risk tracking
- new product build-out from SDS, TDS, or website
- supplier onboarding summary pages

High-value recurring automation:

- `Procurement Risk Watch`
- `Missing Docs Queue`

## The Highest-Leverage Workflows To Build Next

1. **Transcript or email thread to ShelfCycle note plus Gmail follow-up draft**
   This shortens the biggest loop in your sales process.

2. **SDS or TDS to product draft plus procurement checklist**
   This speeds supplier onboarding and product readiness.

3. **Gmail contact discovery to ShelfCycle contact create**
   This keeps accounts current with less manual digging.

4. **Daily owner, sales, and procurement digest**
   This turns the assistant from a tool into an operating rhythm.

5. **ShelfCycle browser write-back**
   This removes repetitive form entry after review.

## What Should Stay Human

Do not fully automate these at first:

- final price commitments
- credit terms
- stocking decisions
- supplier switching
- creation of duplicate-sensitive master data without review
- broad outbound customer communication

These should be assistant-supported, not assistant-owned.

## What I Need To Become More Useful

The system gets materially stronger with:

- periodic ShelfCycle CSV exports
- more real transcripts
- more supplier pricing emails
- sample and quote examples
- a defined set of your top 25 accounts
- a defined set of your top supplier lines

If connected later, these would also help:

- Google Calendar for meeting prep
- Google Drive for shared technical files
- Teams or Slack for internal coordination

## Recommended 30-Day Build Sequence

### Week 1

- stabilize transcript, product, contact, customer, and location intake
- keep improving entity matching
- standardize the output format

### Week 2

- add Gmail-to-follow-up drafting
- add missing-contact discovery flow
- add product-document chase workflow

### Week 3

- add ShelfCycle write-back for notes, contacts, and locations
- keep product writes review-first

### Week 4

- add daily digests for owner, sales, and procurement
- tune the brief format around what you actually use

## Recommended Operating Principle

The assistant should not try to replace your judgment.

It should make sure that:

- nothing important gets lost
- names and products are matched correctly
- the next step is obvious
- the paperwork and follow-up are faster
- your attention goes to decisions, not data entry

## Bottom Line

The automation path is clear:

- use ShelfCycle as the system of record
- use Gmail as the communication memory
- use the assistant as the matching, drafting, follow-up, and prioritization layer

That is the build that will actually help you run ClearEdge faster.

---
name: write-product-docs
description: Write and rewrite public product documentation. Use when adding, editing, reviewing, or restructuring user-facing docs pages, a docs site, getting-started copy, or a docs index.
---

# Write product docs

v1. Write as-built docs for people who use the product and for agents that
read markdown. Code wins disagreements. Do not document internals, operator
runbooks, unshipped design, or a second API contract.

This skill is portable. Talk the way the audience talks. Use glossary nouns
when a page is a contract.

## Principles

1. **Welcome is a product page, then a hub.** Say what the product is and
   who it is for, in the [Voice](#voice) register. Then job cards, one
   working request, and next links. Do not open with a slogan.
2. **Quickstart is the first-success path.** Account or credential, one
   install or open, one working request, What's next.
3. **Name pages after nouns.** Search Marks, CLI, Status, Class 025. A
   question is an H2 on the noun page, not its own URL.
4. **Split pages by an independently findable job.** Knobs stay as H2s until
   a second audience or URL is justified.
5. **Never write a "which client to use" page.** Path selection is job cards
   plus URL namespaces. Multiple clients are tabs on the same heading, same
   example. CLI and MCP belong in the Welcome pitch, not in a chooser.
6. **Guides open with the page's answer.** Definition, recommendation, or
   outcome. Do not open a guide with "this guide covers."
7. **Present tense. You is the reader. We / our is the product.** Steps use
   bare imperatives. Marketing voice lives on Welcome. Guides are procedure.
8. **Page shape:** definition → contract → one working example → tables for
   more than three discrete values → the one sharp edge → 3–7 What's next
   links.
9. **Publish numbers.** Identifiers in backticks. One page owns each fact.
   Prefer "what happens if" over "don't."
10. **Document the contract, not the machinery.** Inputs, outputs, auth,
    limits, errors, responsibility. Not parsers, schemas, ingestion, deploy,
    or repair.
11. **Callouts are landmines.** NOTE, TIP, WARNING. One or two lines.
12. **Repeat one fixture** across Welcome, Quickstart, and every client tab.
13. **Docs chrome matches the product site.** Logo and color scheme. Do not
    invent a second brand or a card dashboard.

## Voice

These rules apply on every page. Welcome is allowed to sell. A flag
reference may be dry. Same person, different jobs.

- **Write like the person who ships the product.** If you would not say it
  to a customer, do not publish it. Docs-template cadence is a defect.
- **Say what it is and who it is for** before how it works. Category and
  audience first. Company when it orients. No metaphor, no warning opener,
  no "this guide covers."
- **Everyday language until the page is a contract.** People type phrases
  for t-shirts and look up serial numbers. Glossary nouns (Search Query,
  Data Version) appear when the exact term is the product.
- **Spoken cadence.** Compound sentences with `or` and `and` are fine. Do
  not chop a living sentence into telegrams so it sounds like docs.
- **Concrete objects.** A t-shirt, a serial, the USPTO, a CLI, MCP. Not
  catalog, surfaces, jobs, fixtures, or "the offering."
- **You is the reader. We / our is the product.** Repeat the clear word.
  Do not cycle service / platform / offering for variety.
- **Say what someone does, then what they get.** Imperatives for action.
  If programs and agents can call it, say so on the page that introduces
  the product. Do not quarantine automation behind a chooser.
- **Fix typos. Do not rewrite a human sentence into a tidier paraphrase
  of itself.**

Worked example, Welcome on this site (not a sentence template):

> Trademark Terminal is a trademark search and compliance tool for
> print-on-demand sellers from MerchBase. Type a prospective phrase for a
> t-shirt, or investigate a trademark via its serial number. Every trademark
> in the database is kept up to date from USPTO's database, and all of our
> results are accessible for programmatic and agentic use with a CLI and MCP.

## Process

1. Inventory shipped surfaces and recurring jobs. Assign URL namespaces.
2. Earn every page. Retire chooser pages.
3. Pick one hero example from shipped behavior. Reuse it.
4. Write the runnable example before the prose.
5. Draft capability pages first. Write Welcome last, in the Voice
   register.
6. Open guides with the answer. Tables for auth, limits, errors. What's next.
7. Legal is a thin link-out. Operator repair is not a seller surface.
8. **Deslop.** Run `no-ai-slop` (`.agents/skills/no-ai-slop`) as
   detect-then-edit. If it is not loaded, apply [Deslop](#deslop).
9. Run the happy path. Fix a wrong command before you commit.
10. Grep for chooser pages, pep, slogan contrasts, and duplicated numbers.

## Deslop

`no-ai-slop` loads from `.agents/` in Cursor sessions. `.agents/` is
gitignored, so this section ships with the repo.

- **Slogan contrasts.** "Counts are evidence, not a verdict." "A row is a
  record, not a decision." State the fact instead.
- **Binary contrasts and negative lists.** Say the thing. Don't announce
  what it isn't.
- **Fake-profound kickers.** End on a next action or the last fact.
- **Robotic rhythm.** Do not stack three identical fragments on Welcome.
- **Legal disclaimers** may keep required "not legal advice" wording. Do
  not reuse that shape as product copy.

Welcome may sound like a product page. Guides may not sound like a slogan.

## Coverage

**First-class:** sign-in, one working request, each job, each client
interface, status, the hard product boundary.

**Link out or omit:** legal terms, billing, community, operator repair,
schema, ingestion, deploy, unshipped design.

**FAQ** only for policy that does not belong on a noun page.

## After a page

Confirm the command, URL, auth rule, glossary where the page is a
contract, Voice on every page, and that deslop ran.

## This repository

Public docs: `apps/docs` at `/docs`. Maintainer docs: `docs/`. Glossary:
`CONTEXT.md`. V1 materializes International Class 025. Serial numbers are
eight digits; registration numbers are seven. Hosted MCP is Clerk OAuth
only. Chrome: TRADEMARK pill, cream `#f5f2ea`, near-black `#0d0e0e`,
chartreuse `#d7f52a`.

---
name: write-product-docs
description: Write and rewrite public product documentation. Use when adding, editing, reviewing, or restructuring user-facing docs pages, a docs site, getting-started copy, or a docs index.
---

# Write product docs

Write as-built docs for people who use the product and for agents that read
markdown. Code wins disagreements. Do not document internals, operator
runbooks, unshipped design, or a second API contract.

This skill is portable. Product nouns come from the repository glossary. Do
not invent synonyms.

## Principles

1. **Welcome is a hub with a real product description.** Open with what the
   product is and who it is for. A short paragraph of marketing voice is
   welcome here: what you can do, what the catalog covers, which surfaces
   share the same jobs. Then job cards, one working request, and next links.
   Do not open Welcome with a slogan or a single clipped sentence.
2. **Quickstart is the first-success path.** A numbered sequence: account or
   credential, one install or open, one working request, then What's next.
   Depth lives on other pages.
3. **Name pages after nouns.** Search Marks, CLI, Status, Class 025. A
   question is an H2 on the noun page (`Which model should I choose?`), not
   its own URL. Reserve question titles for a real FAQ.
4. **Split pages by an independently findable job.** Knobs stay as H2s until
   a second audience or a second URL is justified. Do not add a page because
   a file type exists.
5. **Never write a "which client to use" page.** Path selection is job cards
   plus URL namespaces. Multiple clients are tabs on the same heading, same
   example. A new URL prefix only when the interface changes (website, CLI,
   package, MCP).
6. **Guides open with the page's answer.** Definition, recommendation, or
   outcome in the first sentence. Do not open a guide with "this guide
   covers." Welcome may use Welcome as the title.
7. **Present tense. You is the reader. We is the product.** Steps use bare
   imperatives. Marketing voice lives on Welcome. Guides are procedure.
8. **Page shape:** definition → contract or ownership → one working example →
   tables for more than three discrete values → the one sharp edge → 3–7
   What's next links.
9. **Publish numbers.** Identifiers in backticks. Limits, units, status
   codes, and defaults as facts. One page owns each fact; every other page
   links. Prefer "what happens if" over "don't."
10. **Document the contract, not the machinery.** Inputs, outputs, auth,
    limits, errors, and responsibility. Not parsers, schemas, ingestion,
    deploy, or repair.
11. **Callouts are landmines.** NOTE, TIP, WARNING. One or two lines. If a
    page wants a fourth callout, the content belongs in prose or a table.
12. **Repeat one fixture.** The same query, mark, or request across the hub,
    Quickstart, and every client tab. Do not invent a new demo per page.

## Process

1. Inventory shipped surfaces (website, CLI, package, MCP, status) and the
   recurring jobs each one performs. Assign a URL namespace before writing.
2. Earn every page: name the recurring question it answers. If you cannot, do
   not write it. Retire pages that only choose between other pages.
3. Pick one hero example from real product behavior. Reuse it.
4. Write the runnable example before the prose. If you cannot paste a working
   command or request, the feature is not specified enough to document.
5. Draft capability pages first. Write Welcome last, as a router with a real
   product description. If a job cannot compress to a title, one sentence,
   and three bullets, it is not yet one job.
6. Open guides with the answer. Assign `you` and `we`. Put exact identifiers,
   auth, limits, and errors in tables. End with a hand-picked What's next
   list.
7. Route account, billing, legal, and operator work out of the docs IA.
   Legal is a thin page that links out. Operator repair is not a seller
   surface.
8. **Deslop.** Run the `no-ai-slop` skill (`.agents/skills/no-ai-slop`) as a
   detect-then-edit pass on every new or rewritten page. If that skill is
   not loaded, apply [Deslop](#deslop) below. Fix findings before you
   commit.
9. Run the happy path you documented. If a command, URL, or auth rule is
   wrong, fix the page before you commit.
10. Grep the draft for chooser pages, hedge words you cannot defend, pep
    ("empower," "journey," "let's dive in"), slogan contrasts, and a second
    copy of a number that already has an owner.

## Deslop

`no-ai-slop` is the Cursor-session editor (Peter Yang's skill, loaded under
`.agents/skills/no-ai-slop`). It is gitignored with the rest of `.agents/`,
so treat this section as the fallback that always ships with the repo.

Docs-specific failures, in addition to that skill:

- **Slogan contrasts.** "X is evidence, not a verdict." "A row is a record,
  not a decision." "Navigation, not a verdict." State the fact. "A live
  exact count of 0 means this catalog has no live match for that query."
- **Binary contrasts and negative lists.** "This is not X. It's Y." "Not a
  X. Not a Y. A Z." Say Y.
- **Fake-profound kickers.** Do not end a page on an aphorism. End on a
  concrete next action or the last fact.
- **Robotic rhythm.** Do not stack three clipped fragments that all share
  the same shape. Vary the sentence when the page is Welcome or a guide
  lead.
- **Legal pages may keep required disclaimers** ("informational, not legal
  advice") when that wording is the contract. Do not reuse that shape as
  product copy elsewhere.

Welcome may sound like a product page. Guides may not sound like a slogan.

## Coverage

**First-class pages:** account or sign-in, one working request, each
independently findable job, each client interface, catalog freshness or
status, the hard product boundary.

**Link out or omit:** legal terms, billing consoles, community, operator
repair, schema, ingestion, deploy, unshipped design.

**FAQ** only for policy and exceptions that do not belong on a noun page.
Decision content ("which X") stays inline on the noun page, with one default
and a small exception matrix.

## Language

- Short sentences. Concrete nouns. Active verbs.
- Identifiers, commands, status codes, and field names in backticks.
- Tables for comparisons, auth matrices, and limits.
- Numbered steps for procedures. Named destinations for What's next.
- Counts, statuses, and identities mean what the product means. Do not
  upgrade them into advice.
- Banned in guides: empower, journey, robust, seamless, simply, just, let's
  dive in, "this guide will walk you through," "evidence, not a verdict."

## After a page

Read the running surface. Confirm the command, URL, and auth rule. Confirm
the glossary nouns. Confirm the page still earns its URL. Confirm the deslop
pass ran.

## This repository

Public docs live in `apps/docs` and ship at `/docs`. Maintainer docs stay in
`docs/` and are not published. Shared nouns live in `CONTEXT.md`. V1
materializes International Class 025. Serial numbers are eight digits;
registration numbers are seven; neither is a search term. Hosted MCP accepts
Clerk OAuth only.

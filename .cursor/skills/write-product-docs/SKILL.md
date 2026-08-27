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

1. **The homepage is a hub, not a tutorial.** One sentence of what the product
   is. Job cards. One working request. A short list of next links. No
   congratulations, testimonials, or "why us."
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
6. **Open with the page's answer.** Definition, recommendation, or outcome in
   the first sentence. Do not open with "this guide covers" or "welcome."
7. **Present tense. You is the reader. We is the product.** Steps use bare
   imperatives. Marketing is one adjective clause on the hub. Guides are
   procedure.
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
5. Draft capability pages first. Write the homepage last, as a router. If a
   job cannot compress to a title, one sentence, and three bullets, it is not
   yet one job.
6. Open with the answer. Assign `you` and `we`. Put exact identifiers, auth,
   limits, and errors in tables. End with a hand-picked What's next list.
7. Route account, billing, legal, and operator work out of the docs IA.
   Legal is a thin page that links out. Operator repair is not a seller
   surface.
8. Run the happy path you documented. If a command, URL, or auth rule is
   wrong, fix the page before you commit.
9. Grep the draft for chooser pages, hedge words you cannot defend, pep
   ("empower," "journey," "let's dive in"), and a second copy of a number
   that already has an owner.

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
  dive in, "this guide will walk you through."

## After a page

Read the running surface. Confirm the command, URL, and auth rule. Confirm
the glossary nouns. Confirm the page still earns its URL.

## This repository

Public docs live in `apps/docs` and ship at `/docs`. Maintainer docs stay in
`docs/` and are not published. Shared nouns live in `CONTEXT.md`. V1
materializes International Class 025. Serial numbers are eight digits;
registration numbers are seven; neither is a search term. Hosted MCP accepts
Clerk OAuth only.

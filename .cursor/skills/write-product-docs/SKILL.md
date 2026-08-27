---
name: write-product-docs
description: Write public product documentation from shipped behavior. Use when adding, editing, or reviewing user-facing docs pages, a docs index, or install and getting-started copy.
---

# Write product docs

Write as-built docs for people who use the product and for agents that read
markdown. Do not document internals, operator runbooks, or unshipped design.

## Before a page

1. Name the recurring question the page answers. If you cannot, do not write it.
2. Read the running surface (website, CLI, client, or router). Code wins.
3. Use the repository glossary nouns. Do not invent synonyms.

## Page shape

- Title is the job or the question.
- Two sentences of promise, then do this, then one example, then the one sharp
  edge, then related links.
- Install pages: exact commands from the package that exists today. One happy
  path. One failure.
- Counts, statuses, and identities mean what the product means. Do not upgrade
  them into advice.

## Do not

- Document operator, ingestion, schema, or deploy machinery on the public site.
- Duplicate a package README as a second API contract. Teach, then link.
- Add a page for a feature that is not callable today.
- Write marketing. Write the next action.

## After a page

Run the happy path you documented. If a command or URL is wrong, fix the page
before you commit.

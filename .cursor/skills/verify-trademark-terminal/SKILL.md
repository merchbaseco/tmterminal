---
name: verify-trademark-terminal
description: Drive Trademark Terminal the way a seller does — signed-in website search, check text, bulk check, mark detail, and public Status — and capture proof. Use when verifying website or search-surface changes, or when a task asks for app-feature-verification / browser acceptance.
---

# Verify Trademark Terminal

Read this cold. Drive the real website. Do not treat a Happy-DOM component test as browser proof.

Primary surface: the authenticated Vite website. Secondary surfaces: public Status and Help (no session), JSON CLI `tt` (API key; skip unless a key is already present), HTTP `/api`. There is no Playwright suite.

## Launch

Two venues. Do not mix them.

**Cloud Agent (this VM).** `.cursor/start.sh` already started local PostgreSQL, migrated, and seeded a fabricated week. Terminals `api` (`http://127.0.0.1:3000`) and `web` (`http://127.0.0.1:5173`, proxies `/api`) are the instance. Do not start a second pair. Ready when:

```bash
.cursor/skills/verify-trademark-terminal/scripts/doctor.sh
```

prints `venue=cloud` and every check is `ok`. The website auto-signs in as the shared Merchbase Dev Sign-In user that owns the seed. Open `http://127.0.0.1:5173/` — not `localhost` (Clerk authorized parties are the loopback origin).

**Workstation.** `bun run dev` talks to production PostgreSQL over Tailscale. It does not seed. Sign in by hand. Treat every write as live account state. Search, Check Text, Bulk Check, and Status are reads. Do not change Account search preferences unless the recipe restores them. Never run `bun run db:seed:dev` here — the seed refuses non-loopback hosts, and that refusal is the safety rail.

Teardown: leave Cloud `api`/`web` terminals running. On a workstation, stop only the `bun run dev` pair this run started (by those PIDs). Never `pkill` by name.

## Doctor

Run the helper first whenever the page looks unsigned-in, empty, or unreachable:

```bash
.cursor/skills/verify-trademark-terminal/scripts/doctor.sh
```

It is read-only. It checks API `GET /api/health` (`{"status":"ready"}`), website HTTP 200 on the loopback origin, anonymous `GET /api/status`, and (cloud only) that `POST /api/dev/clerk-sign-in-token` mints a ticket from this machine. Fail the run if health is not ready, the website is not 200, or a cloud session is signed out after a reload.

## Drive

Use the Cloud Agent `computerUse` subagent (or an equivalent browser) against `http://127.0.0.1:5173`. Prefer accessible names over coordinates.

| Handle | What it is |
| --- | --- |
| `Trademark Terminal home` | Home / Search Marks |
| Primary nav `Search`, `Status`, `Help`, `Account` | Signed-in top bar (desktop ≥ 48rem) |
| `Menu` | Mobile nav |
| `Search mode` nav: `Search marks`, `Check text`, `Bulk check` | Tool switcher on the empty composer |
| `#query-field` label `Search trademarks` | Search Marks field; placeholder `Search a word mark` |
| Submit `Search` | Search Marks action; empty submit becomes `Give me a word` |
| `#text-field` label `Text to check` | Check Text field; empty submit becomes `Paste some text` |
| Submit `Check text` | Check Text action |
| `#queries-field` label `Phrases to check` | Bulk Check textarea; empty submit becomes `Add a phrase` |
| Submit `Bulk check` | Bulk Check action |
| `Search options` | Filters/sort; hidden until a query is active |
| `Search results` / `Trademark results` | Result summary + rows |
| Result link `{word mark}, {Live\|Dead\|Status unavailable}, serial number {8 digits}` | Opens `/marks/{serial}` |
| `Back to results` | Returns from detail and restores scroll |
| `Start a new search` / `Check different text` / `Check different phrases` | Clears the current tool |

Cloud seed showcase queries (default seed): `GNOME`, `HARVEST`, `TIDEPOOL`, `WILDFLOWER`, `MOONLIT`, `SASQUATCH`, `PAWSITIVE`, `BOOKWORM`, `CAMPFIRE`, `SOURDOUGH`. Each has more than one live exact hit and at least one partial neighbor. Use `GNOME` unless a recipe says otherwise.

Workstation / live data: use a real Class 025 word the change cares about. Exact serials and registration numbers are identities — never type them into the search field as fuzzy terms.

Signed-out visitors may compose a query; submit opens Clerk and preserves `q`. Cloud sessions should already be signed in; if the Sign in button is visible, doctor first.

Read the feature map before driving. A proof that hits one convenient entry point is incomplete when the map lists others for that feature.

## Evidence

Proof directory: `/tmp/tmterminal-verify/<run-id>/`. Create it at the start of the run. Cloud walkthrough copies that must reach the user also go in `/opt/cursor/artifacts/` (do not delete those on cleanup).

Standards:

- Exercise the real user path (composer → request → visible results). Do not call tRPC from the agent as a substitute for clicking Search.
- Capture the action and the resulting state: composer + URL, then the result summary (`N results`, `Live exact`, `Live partial`) or the empty-state `No marks match “…”`.
- For mark detail, capture the word-mark heading, status chip, eight-digit serial, and goods/services table — not only the first paint skeleton.
- Side effects: Account preference saves write the signed-in account. On Cloud, `bun run db:seed:dev` restores the seed account. On a workstation, restore the previous values or do not touch preferences.
- Public Status is anonymous; operator Source Files / Needs Attention appear only for an operator session (Cloud seed grants operator).
- Do not open the USPTO TSDR link as proof of this app.

Name artifacts `<feature-id>-<entry>-<before|after>.png` (and a short recording when the path is multi-step). Record the feature ID and entry point with every file.

## Cleanup

- Close tabs this run opened. Do not kill Cloud `api`/`web`.
- Remove `/tmp/tmterminal-verify/<run-id>/` scratch copies if you duplicated artifacts elsewhere. Never delete `/opt/cursor/artifacts/` or the named proof directory until the handoff is done.
- If you saved Account preferences on Cloud, re-seed (`TMTERMINAL_DATABASE_HOST=127.0.0.1 bun run db:seed:dev`) so the next agent gets the documented defaults.
- Do not leave a Clerk sign-in modal open.

## Helpers

```bash
.cursor/skills/verify-trademark-terminal/scripts/doctor.sh
```

Optional: `TMTERMINAL_WEB_ORIGIN=http://127.0.0.1:5173 TMTERMINAL_API_ORIGIN=http://127.0.0.1:3000` override the defaults. Exit `0` only when every required check passes.

## Feature map

`.cursor/skills/verify-trademark-terminal/features/README.md`

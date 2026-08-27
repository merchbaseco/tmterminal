# Status

The public Status page says how current the catalog is. Operator-only Needs Attention and Source Files explain what needs a human. Neither gates search. The accessible heading is `Status`.

## Sub-features

- `status-public` — catalog metrics, Live badge, 30-day activity chart
- `status-anonymous` — signed-out visitors see the public summary only
- `status-operator` — signed-in operators also see Needs Attention and the Source Files ledger
- `status-failure` — API failure shows `Status could not be loaded.`

## How to get to it (user POV)

- Click primary nav `Status` or open `/status`
- Mobile: `Menu` → `Status`
- Direct `GET /api/status` is the same public payload; it is not the page

## Driving it with the browser

Preconditions:

- Doctor is green (`anonymous /api/status` is ok). Cloud seed includes a current week of activity and grants the Dev Sign-In user operator. Workstation live data has real catalog counts; operator sections require an operator account.

- Public: Open `/status`. Observable: `Service status: Live`; `Trademark catalog` with `Total trademarks`, `New applications`, and `Application updates`; a chart region (`Trademark applications and updates`). Total trademarks on the Cloud seed is on the order of 600, not zero. The heading `Status` is present for assistive tech even if the display is the chart.
- Adjacent anonymous: If you can load `/status` without a session (workstation signed out, or a private window against the same origin), Observable: catalog + chart still render; `Needs Attention` and `Source files` do not.
- Operator (Cloud): Stay signed in. Observable: `#needs-attention` / `Needs Attention` when the seed has issues — the seed's worker heartbeat goes stale after five minutes and Status then reports the worker as failed; that is true, not a broken page. `Source files` table with All / Errors filters and rows for discovered files.
- Failure: Only if doctor already showed `/api/status` failing. Observable: alert `Status could not be loaded.` Do not invent an outage.

## Gotchas

- Latest Processed is not a standalone summary row. Do not hunt for that label.
- Public Status is aggregate. No mark records, source errors, or repair details in the anonymous view.
- A failed or stale worker on a seeded Cloud database does not mean search is empty.
- `Not downloaded · Covered by newer source data` is a covered file, not an active issue.
- Do not run Repair from this recipe. Repair is an operator action with its own operations doc.

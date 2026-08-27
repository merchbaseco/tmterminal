---
title: How current the data is
---

# How current the data is

[Status](https://tmterminal.merchbase.co/status) shows catalog totals and recent activity. Latest Processed is the newest source coverage date that applied safely.

Search stays available while newer files are processed. A pending file is not a reason the catalog is empty. Ingestion never gates reads.

Public status does not list individual source errors. Operator Needs Attention is a different page, for operators.

If you page through a long result set, keep the `dataVersion` from the first page. A `CONFLICT` means live data changed; start again at offset zero.

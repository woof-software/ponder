---
"ponder": patch
---

Fixed a bug that caused the RPC cache migration from `ponder_sync` to fail with a statement timeout on large databases. The migration can now run for up to 10 hours.

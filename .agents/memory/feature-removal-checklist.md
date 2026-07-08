---
name: Feature removal checklist
description: What to check when fully removing an optional integration/feature from this codebase (routes, UI, background jobs, DB columns).
---

When a user asks to fully remove an integration, check all of these layers, not just the feature's own files:

1. Server routes (grep the route file for the feature's route prefix/name).
2. Background jobs / boot-time checks in the server entrypoint (interval timers, one-shot startup checks).
3. Standalone server modules dedicated to the feature (delete the files).
4. DB schema: columns the feature added to its "home" table, via a migration-drop function guarded by `columnExists` checks (safe to re-run).
5. **Columns added to *other* shared tables solely to feed the feature** — e.g. a `users` table can accumulate columns (like handle/verification fields) that only exist to support one integration. These are easy to miss because they're not colocated with the feature's other code. Grep the column name across the whole codebase to confirm it truly has no other consumer before dropping it.
6. Frontend: query hooks, mutation hooks, response-shape types, and the JSX card/section — usually all clustered together in one page file, but check multiple pages (e.g. a settings page AND an admin page AND a public dashboard page can each have their own view of the same feature).
7. Unused icon/component imports left behind after deleting JSX blocks (`Wallet`, `AlertDialog`, etc.) — grep each import name after deleting to confirm it isn't still used elsewhere in the file before removing the import.
8. Docs: project README (e.g. replit.md) feature paragraph, and any ops/launch checklist env-var rows.

**Why:** partial removal leaves dead imports (compile errors), dangling API calls (500s), or orphaned DB columns that make schema drift confusing later.

**How to apply:** after edits, run a repo-wide case-insensitive grep for the feature name; only the migration file itself (which documents the drop) should still match.

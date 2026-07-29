# Rules

Process rules for how to work in this repo.

## Dev server / visual verification

Never launch `npm run dev` (or any dev server) in the background for the purpose of visually verifying a change — that's the user's call to make, not mine. Ask them to check it themselves instead of spinning one up on my own.

The one exception: when what's being checked is objective and hard to verify by hand — a textual value, a loading/error status, a numeric measurement (bounding boxes, computed styles, timing, whether an element exists/loaded) — rather than how something *looks* or *feels*. In that case, launching a dev server myself (e.g. with a headless browser) to check that specific metric is fine.

## Keep the documentation index in sync with the code structure

Doc updates don't need to happen in the same pass as the code change — they mostly happen at git-push time instead (see below). It's fine for a rename/move/create/delete, or a behavior change, to leave `CLAUDE.md` or a `dev-guidelines/*.md` file momentarily stale across one or more commits while the work is still in flight; don't stop mid-task just to fix a doc.

## Sync the docs at git push time

Before/after pushing, map the diff's changed paths to the doc(s) that cover them (see the table in `CLAUDE.md`) and review the diff against just those — a `css/style.css`-only change only needs `styling.md` checked, not the full set. This is the main sync point, and it covers two kinds of drift:

- **Structural drift**: a renamed/moved/created/deleted file or folder that isn't reflected leaves docs pointing at a path that no longer exists, which is worse than no docs at all — an agent that trusts it will fail immediately, and one that doesn't trust it has to re-derive the whole map from scratch anyway, defeating the point of having an index. Also grep for the old name/path across `dev-guidelines/` and `CLAUDE.md` to catch cross-references *other* docs make to the changed file, not just the doc that most directly covers it.
- **Behavioral/content drift**: changes that don't touch file structure at all (a config default changing, a new npm script, a section added to a page) but still make some doc's description inaccurate.

Do a full sweep — every `dev-guidelines/*.md` file plus `README.md` and `CLAUDE.md` — only periodically (e.g. before a release, or roughly every 10 pushes) rather than after each one. That's what catches drift the targeted check would miss; running it every push makes the doc-sync cost fixed and full-repo-sized regardless of how small the change was, which isn't worth paying that often.

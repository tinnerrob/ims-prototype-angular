# IMS Angular Port — Cleanup Review, Second Pass (whole repo)

**Date:** 2026-09-13 · **Repo:** `tinnerrob/ims-prototype-angular` (`main`)
**Scope:** a second hygiene pass taken **after** `23a3d4e`, this time over *every* file in
the repository — all of `src/` (the components and core modules the first pass did not
open), all of `scripts/` (the audits, the harnesses, the e2e runner and the static
server), the configs, and the docs.
**Convention:** `angular-refactor-log.md` / `docs/CODE-REVIEW.md` / `docs/CLEANUP-REVIEW.md`
— Analyze → Document → Execute → Verify, smallest diff per finding, gates green.

The first pass (`docs/CLEANUP-REVIEW.md`) covered the shared plumbing (period vocabulary,
panel placement, primitives). This pass went looking for what a *targeted* pass misses:
dead **dependencies**, duplicated **idioms** rather than duplicated functions, file-level
formatting, the verification tooling itself, and whether the docs still tell the truth.

---

## 1. Method — and why the headline is "almost nothing is wrong"

Rather than read by eye and hope, four mechanical probes were run over the whole tree:

| Probe | What it answers | Result |
|---|---|---|
| **Clone detector** — every window of 6 normalised lines, hashed across all `.ts`/`.js`/`.mjs` | is any *logic block* duplicated? | **9 hits, all benign** (below) |
| **Dead-private-member scan** — every `private`/`protected` declaration, then counted again in its own file | is there dead code the export audit cannot see? | **0** |
| **Formatting scan** — blank runs, trailing whitespace, tabs, final newline, long lines | is the tree consistent? | 0 tabs, 0 trailing whitespace, all files newline-terminated; **32 files carry stray blank lines before EOF**; 87 internal double-blanks are the deliberate section-banner style |
| **Doc-count checker** — every `checkN … X checks` claim in `README`/`docs/*` against the harnesses' own output | do the docs still tell the truth? | **1 current-state mismatch**; the other 9 are *historical* statements in the log |

The clone detector's 9 hits, each examined and each a non-finding:

1. **×4 — the same 9-line header comment** at the top of the four `core/seed/*.ts` modules.
   It explains why the fixture was split out of the store; it is orientation prose read at
   the point of use, not an implementation, and the modules are siblings. Left as-is.
2. **×2 — fixture rows repeated in a harness** (`parties.ts` ↔ `check13`,
   `tenancy.ts` ↔ `check18`). Deliberate: the harness asserts the store against an
   *independent* copy, so sharing the literal would destroy the test.
3. **×3 — import blocks** that happen to agree (two feature components import the same
   shared modules in the same order). Not duplication; that is the import convention.

That is the honest headline: there is no duplicated logic left to consolidate in this
repository, and no dead private code. What follows is small and precise.


---

## 2. Findings

| # | Severity | Finding | Where | Evidence |
|---|---|---|---|---|
| 1 | LOW | **Unused dependencies.** `@angular/platform-browser-dynamic` is referenced nowhere (`bootstrapApplication` comes from `@angular/platform-browser`), and `@playwright/test` is unused — the e2e runner imports `playwright` directly. | `package.json` | `grep -rn platform-browser-dynamic src scripts angular.json` → none; `scripts/e2e-smoke.mjs:19` imports `'playwright'` |
| 2 | LOW/MED | **A duplicated status-chip idiom:** the same three-line `badge()` method (`'badge-status st-' + statusClass(status)`) exists in **8 components** | `assets`, `dashboard`, `inspections`, `logistics`, `maintenance`, `orders`, `purchasing`, `telemetry` | byte-identical bodies (assets differs only in taking an `Item`) |
| 3 | LOW | **44 files end with stray blank lines** (32 under `src/`; `models.ts` had **eleven**); every other file in the tree ends with exactly one newline | whole tree | blank-run scan |
| 4 | LOW | **The tree's only non-null assertion** sits one token after the guard that makes it safe | `core/forms.service.ts:147` `f.options!.includes(x)` | `f.options ? … : []` on the same line |
| 5 | LOW | **The e2e's static server can throw inside its request handler** — `decodeURIComponent()` on a malformed escape and `readFileSync()` on a vanished file both throw out of the callback | `scripts/serve-dist.mjs:33,37` | uncaught throw in a request callback |
| 6 | LOW | **CSV export revokes its object URL synchronously after `click()`** — Safari can cancel the download | `features/invoicing/invoicing.component.ts:194` | the app's only `createObjectURL` |
| 7 | LOW | **Doc drift:** `docs/PLAN.md` documents `check8.mjs` as 9 checks; it reports **10** (the refactor log already files this as the one open drift). The README `shared/` tree also omits the new `panel-position.ts` | `docs/PLAN.md:402`, `README.md:74-79` | doc-count checker |
| 8 | INFO | **The harness suite reports itself inconsistently:** 28 of 33 print `checkN: N checks`, but `check.mjs` prints **nothing**, `check2` prints `all N checks passed`, and `check3`–`check5` print `N checks, all green` — so the suite's own total cannot be tallied from its output | `scripts/runtime-checks/` | summary-line scan |

### Perf notes (measured, still deliberately unchanged)

- `DashboardService.order()` is O(n²) via `Array.includes` — **n = 9** widgets.
- Template-bound reads (`breachCount()` over ≤ 40 alerts, per-page `listX()` filters) run per
  change-detection cycle over small, capped collections; memoising needs a signal-first store.
- `DataService` 4.5k lines / `styles.scss` 2.5k: structural, not hygiene.
- One `OnPush` component (`field-editor`) is the documented pilot — the rest read the mutable
  store inline, which is why a blanket `OnPush` sweep is not safe today.

### Still true from the first pass (re-verified)

**0** `any` / `as any` / `@ts-ignore`; **0** `TODO`/`FIXME`/`HACK`; the only `console.*` is the
bootstrap `.catch()`; **0** hardcoded secrets; the only `innerHTML` is the table pager's static
template; the only `subscribe()` calls are the shell's two, both `takeUntilDestroyed`; every
window listener and interval has a matching teardown; the 6 remaining `!important` sites each
carry a comment explaining what they out-specify.

---

## 3. Plan

| Phase | Change | Risk |
|---|---|---|
| **1** | One `statusBadge()` in `core/models.ts` beside `statusClass()`; the 8 components delegate to it (assets keeps its `Item`-taking wrapper). | low — pure extraction, identical string |
| **2** | Normalise the 44 files that carry blank lines before EOF (32 under `src/`, plus docs and 8 harnesses) to one trailing newline. Leave the **43 remaining** internal double-blanks: they are the deliberate `}` → blank → blank → `/* ---- section ---- */` section-banner spacing (12 sites in `data.service.ts` alone), i.e. the file's style, not an accident. | low — nothing but trailing bytes change |
| **3** | Hoist `f.options` into a local in `forms.service.ts` (drops the tree's last `!`); harden `serve-dist.mjs` (try/catch → 400/404); revoke the CSV object URL on the next tick. | low — guards only |
| **4** | Give `check.mjs`/`check2`–`check5` the same `checkN: N checks` summary every other harness prints, so the suite's total is derivable from its own output. | none — console output only |
| **5** | Fix the `check8` count in `docs/PLAN.md`; add `panel-position.ts` to the README's `shared/` tree. | none |
| **6** | Record results + gates here; index this document from `docs/CLEANUP-REVIEW.md`. | none |

## 4. Deliberate non-changes

| Not changed | Why |
|---|---|
| `@angular/platform-browser-dynamic`, `@playwright/test` (finding 1) | both are *capabilities installed ahead of use* — the repo has a Karma test target with no specs yet, and Playwright Test is the obvious home for a future suite. Removing them churns `package-lock.json` and could break a workflow that is planned rather than present, so they are **flagged for the owner**, not deleted unilaterally. |
| The 43 remaining internal double-blank runs | the section-banner style is consistent (12 identical uses in `data.service.ts`); collapsing them would be pure churn against the file's own convention — and the 44 accidental *trailing* runs were removed. |
| The four seed modules' shared header comment | see §1 — orientation prose, cheapest read where it sits. |
| Historical per-harness counts in `angular-refactor-log.md` / `PLAN-B.md` / `CODE-REVIEW.md` | those sentences record what was true when written ("check26 grew from 5 to 9 checks", "Verified by check17 (5 checks)"). Rewriting them would falsify the log; only the *current-state* claim is corrected. |
| Long data lines (> 180 chars, 40 sites, almost all seed literals) | the fixture rows are one row per line on purpose — wrapping them would hurt the diffability the harnesses rely on. |

---

## 5. What changed

| File(s) | Change |
|---|---|
| `core/models.ts` | **new** `statusBadge(status)` beside `statusClass()`; the eleven trailing blank lines removed |
| `features/{assets,dashboard,inspections,logistics,maintenance,orders,purchasing,telemetry}/*.component.ts` | the local `badge()` methods replaced by the shared rule (`readonly badge = statusBadge;`, or a one-line `Item`-taking wrapper in `assets`); the three files that used `statusClass` *only* there shed the import |
| `core/forms.service.ts` | `f.options` hoisted into a local — **the tree now has zero non-null assertions** |
| `scripts/serve-dist.mjs` | request handler wrapped in `try/catch` (malformed escape → 400, anything else → 500) so a bad URL cannot kill the e2e's server |
| `features/invoicing/invoicing.component.ts` | the CSV object URL is revoked on the next tick, not inside the click's task |
| `scripts/runtime-checks/check.mjs`, `check2`–`check5` | all print the same `checkN: N checks` summary as `check6`–`check33` |
| 44 files | trailing blank lines before EOF trimmed (one final newline, per `.editorconfig`) |
| `docs/PLAN.md`, `README.md`, `angular-refactor-log.md`, `docs/CLEANUP-REVIEW.md` | `check8` corrected to 10 checks (closing the log's last open item); `panel-position.ts` added to the README tree; the log's open row marked closed; this document linked from the first one |

## 6. Verification

| Gate | Result |
|---|---|
| `npm run build` | **exit 0, 0 warnings / 0 errors**; initial total **503.02 kB** (warn budget 520 kB; +0.03 kB for the shared helper) |
| `npm run check:store` | **294 ok / 0 FAIL in 33 harnesses** — and all 33 now print a count (`check: 9 checks` … `check33: 8 checks`) |
| `npm run lint:dead` | **0 unused imports, 0 orphan exports** (348 exports, +1) |
| `npm run lint:ctor` | OK |
| `npm run e2e` | **all checks passed**, empty console-error log — every table that renders a status chip is on its route list |
| blank-run scan | **0** files with trailing blank lines (was 44); 43 internal double-blanks remain (the deliberate banner style) |
| non-null-assertion grep | **0** in `src/app` (was 1) |
| doc-count checker | 9 mismatches left, **all of them historical sentences** in `angular-refactor-log.md` / `PLAN-B.md` / `CODE-REVIEW.md` ("check26 grew from 5 to 9 checks") that record what was true when written — rewriting those would falsify the log |

The two mutations that touched rendered output — the shared status chip and the
`readonly badge = statusBadge` field — are covered twice over: `strictTemplates` type-checks
every `badge(...)` call at build time, and the e2e renders all 19 routes and fails on any
console error.

# Angular Refactor Log — `ims-web`

**Repo:** `tinnerrob/ims-prototype-angular` · **Baseline commit:** `17c35c3` (`main`) · **Opened:** 2026-09-12
**Scope:** structure, dead code, styling consistency, Angular/RxJS/typing best practice — **with the
existing business logic and user-facing behaviour preserved.**

This is a *living* document. Every optimisation is one iteration: **Analyze → Document → Execute →
Verify.** Nothing is applied to `src/` until its row here is written first, and no iteration is done
until the full gate suite (Section 5) is green again.

---

## 0. How an iteration runs

| Step | What happens |
|---|---|
| **Analyze** | One module, service, or small component subset. Read it, measure it, and check who depends on it (`grep`, the route map, `scripts/runtime-checks/*.mjs` imports, `docs/DATA-MODEL.md`). |
| **Document** | Append the finding, the plan and the risk to *Iteration history* (Section 6). Anything behaviour-affecting is marked **⛔ needs approval** and stops there. |
| **Execute** | Only that section, smallest diff that achieves the finding. No drive-by edits, no reformatting of untouched lines. |
| **Verify** | Run the gate suite (Section 5) and paste the exact result line into the log. If a change makes a gate change shape, **revert the change, don't loosen the gate.** |

**Risk legend**

| Tag | Meaning |
|---|---|
| `LOW` | Mechanical, fully covered by the gates (imports, dead files, naming). |
| `MED` | Touches shared SCSS, templates, or a public surface (route, selector, service method). Review the diff by eye too. |
| `HIGH` | Behaviour, routing, change detection, or bundle shape. Needs a written before/after. |
| `⛔` | **Do not start without an explicit go-ahead** — the payoff is an architecture decision, not cleanup. |

---

## 1. Baseline snapshot (measured, not estimated)

Angular **19.2.0** · TypeScript **5.7.2** · zone.js **0.15** · rxjs **7.8** · standalone API
everywhere (**27** `standalone: true`, **0** `NgModule`).

| Facet | Measurement | Evidence |
|---|---|---|
| Source size | 47 `.ts`, 26 templates, 26 component stylesheets — **26,209** LOC total | `find src … \| xargs wc -l` |
| Largest files | `core/data.service.ts` **5,190** · `features/scheduler/scheduler.component.ts` **1,578** · `core/models.ts` **1,457** · `purchasing` 851 · `timesheet` 774 · `assets` 766 | `wc -l` |
| Global stylesheet | `src/styles.scss` **2,477** of **8,927** SCSS lines (largest component sheet: `scheduler` 434) | `wc -l` |
| Services / directives | 8 `@Injectable` (`data`, `forms`, `modules`, `page-search`, `session`, `telemetry`, `confirm`, `tip`) · 2 decorators (`imsModalDismiss`, `[imsTip]`) | `grep @Injectable\|@Directive` |
| Strictness | `strict`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`; `strictTemplates`, `strictInjectionParameters`, `strictInputAccessModifiers` | `tsconfig.json` |
| **`any` usage** | **0** occurrences | `grep -E ':\s*any\b\|as any'` |
| RxJS surface | **2** `.subscribe(` call sites, both `router.events` in `app.component.ts`; **0** `takeUntil`, **0** `async` pipe | `grep .subscribe(` |
| Signals | 12 `signal(`/`computed(`/`effect(` uses; the store is a **mutable singleton**, not signal-based | `grep signal(` |
| Change detection | **0** `ChangeDetectionStrategy` / `OnPush` — all components are default | `grep ChangeDetectionStrategy` |
| Tests | **0** `*.spec.ts` (Karma is configured but empty) | `find src -name '*.spec.ts'` |
| Verification culture | `npm run check:store` = 28 Node harnesses = **246 checks** (202 at baseline; P9 added check25; P9b/P6/3/P6/4 added check26, the first to reach a component; P10 added check27 for its gestures; P11 added check28 for its modal editors); plus 2 hand-rolled audits, the build and `npm run e2e` | `scripts/`, `package.json` |
| Bundle | build warns `initial exceeded maximum budget … 500 kB` at **~830 kB** (error budget 1 MB); **all routes eager** (0 `loadComponent`) | `ng build`, `angular.json`, `app.routes.ts` |
| Marker hygiene | **0** `console.*`, `TODO`, `FIXME`, `XXX`, `HACK` in `src` | `grep -rnE …` |
| Selectors | **All** `ims-*` except the shell's `app-root`; one mismatch: `ims-admin-verticals` lives in `verticals.component.ts` (`VerticalsComponent`) | `grep 'selector:'` |
| Unused named imports | **6** found by scan (heuristic — confirm each before deleting) | Section 2, gap 2 |
| Formatting config | `.editorconfig` only — **no** `.prettierrc`, **no** `eslint.config.*`, no `ng lint` target | `ls -a` |

### What is already good — do **not** "fix" it

1. **Strict typing is real**: `strict` + `strictTemplates` + `noPropertyAccessFromIndexSignature`,
   and measured **zero** `any`. Do not introduce generics/`unknown` churn for its own sake.
2. **Modern Angular throughout**: standalone components, `@if`/`@for` control flow, injector-based
   DI, no legacy modules. There is nothing to migrate *to*.
3. **One typed store as the source of truth**, with the schema written down in `docs/DATA-MODEL.md`
   and 24 harnesses driving it. `DataService`'s size is a *deliberate* mirror of the database, not
   accidental sprawl (see P6).
4. **A verification culture most prototypes lack**: `build` + `lint:ctor` + `lint:styles` +
   `check:store` (202 checks). Everything in this log must keep those green — they are the contract.
5. **Naming is consistent**: `kebab-case` files/selectors, `camelCase` members, `PascalCase` classes,
   folder-per-feature. Where it drifts (3 rows above) it is cosmetic.

---

## 2. High-level assessment

**Shape.** A single-page, zone-based Angular 19 app: a mutable singleton store (`DataService`) read
directly from templates, 16 feature folders behind an eager route map, a shared widget layer
(`record-view`, `dynamic-form`, `field-editor`, `evidence`, `confirm`, `tip`, `modal-dismiss`), and a
large global stylesheet that the shell and every feature page draw from. The port is functionally
complete; what remains is *consistency and debt*, not features.

**The gaps worth spending iterations on** — risk ascends down the list, so the low-risk value comes
first and the architecture comes last:

| # | Gap | Why it matters | Phase |
|---|---|---|---|
| 1 | **Docs drifted from the code** — `README.md` still lists `features/categories/` (deleted) and `features/items/` (never existed; it is `assets`); `HANDOFF.md` points at a stale checkout path, says "140 checks" (now **202**), "~738 kB" (now **~830 kB**), and lists a Categories feature that is gone | The docs trio is how this project resumes work; wrong docs are worse than missing ones, and every later phase needs them as a map | **P1** |
| 2 | **Dead code** — 6 unused named imports (`data.service.ts`: `DocumentKind`, `PartyKind`, `PurchaseOrderStatus`, `WorkOrderPart`, `countWeekdays`; `inspections.component.ts`: `InspectionSeverity`), plus unused *exports*/files/CSS still to be swept systematically | Free removal, and it shrinks the reading surface before anyone is asked to trust a bigger change | **P2** |
| 3 | **Naming/formatting drift** — the `ims-admin-verticals` selector mismatch; no Prettier/ESLint, so formatting rests on `.editorconfig` + convention; import order and EOF/whitespace unenforced | Cheap, keeps the tree uniform so review diffs stay legible | **P3** |
| 4 | **Lifecycle hygiene** — `TelemetryService` runs a `setInterval` live feed (`telemetry.service.ts:66`, cleared at `:71` — confirm that path is always reached); the Scheduler removes a capture-phase global `click` listener from inside a `setTimeout` (`scheduler.component.ts:1512`) | Two known spots where a leak is *possible*; everything else already has `ngOnDestroy` | **P4** |
| 5 | **Global stylesheet 2,477 lines** with a ported layer plus an additive "visual refresh" layer | Rule overlap/specificity, *not* dead class names — `lint:styles` already reports 0 unused | **P5** |
| 6 | **The 5,190-line store** and the 1,578-line Scheduler component | Real, but *architectural*: splitting the store redesigns the project's spine | **P6** ⛔ |
| 7 | **Eager routing vs the 500 kB budget** (~830 kB initial) | README's own roadmap asks for lazy module routes; routing is behaviour | **P7** ⛔ |
| 8 | **No `OnPush` anywhere**, with a mutable singleton store and default CD | Flipping it is *unsafe* here (templates read store state mutated outside the component) — a study, not a sweep | **P8** ⛔ |
| 9 | **Zero component/template tests** | Templates are verified by nothing but the build; the harnesses only cover the store | **P9** ⛔ |

---

## 3. Proposed phase breakdown

Each phase is a *bounded* pass with its own definition of done. A phase may be several commits; every
commit must leave the gate suite green.

### P1 — Documentation truth pass · `LOW` · status: **done (2026-09-12)**
**Done:** `README.md` — the structure block rewritten from the real tree (the deleted
`features/categories/` and the never-existent `features/items/` replaced by `assets/` and
`purchasing/`; `core/` and `shared/` now list what is there), the gate commands added to its
"Run locally" section, and the Admin roadmap line reworded to *Business type & Categories*.
`docs/HANDOFF.md` — checkout path fixed, check count corrected (140 → **202** across 24
harnesses, with the Phase B/C subjects named), bundle figure (~738 → **~830 kB**), the
Categories feature row replaced by **Business type & Categories**, date advanced, and
`PLAN-B.md`/`PLAN-C.md` added to its document list. `docs/PLAN.md` — verification-recipe
headline corrected and a `check14`–`check24` block appended, each with its measured count.
`docs/PLAN-B.md` — its principles line no longer claims 140-in-13 as *today's* number (the
140-in-13 line inside B1's own acceptance criteria is deliberately left as the record of
that criterion).
**Verified:** every path named in README/HANDOFF exists (30 `test -e` probes); no
`140 check` / `738 kB` / `features/categories` / `features/items` / stale checkout path
remains in README, HANDOFF or PLAN; gates green (build `complete` · `lint:ctor` OK ·
`lint:styles` 0 unused · **202 ok / 0 FAIL**).
**Scope:** `README.md`, `docs/HANDOFF.md`, plus any doc reference to files that no longer exist.
**Do:** correct the structure block (`features/categories` deleted, `features/items` → `assets`, add
the missing features and the `shared/*` widgets), fix the stale checkout path, refresh the check count
(140 → **202** across 24 harnesses) and the bundle figure (~738 → **~830 kB**), drop the Categories row
from the HANDOFF feature table, and add `PLAN-B.md` / `PLAN-C.md` to its "the documents" line.
**Acceptance:** every path named in README/HANDOFF exists (`ls` each); every number quoted matches a
command re-run today; no doc claims a feature absent from `app.routes.ts`.
**Why first:** it is the map every later phase navigates by, and it cannot break the app.

### P2 — Dead code sweep · `LOW` · status: **done (2026-09-12)**
**Done:** the 6 unused imports removed — 5 from `data.service.ts` (`DocumentKind`, `PartyKind`,
`PurchaseOrderStatus`, `WorkOrderPart`, `countWeekdays`) plus `InspectionSeverity` in
`inspections.component.ts`; each was checked for comment/JSDoc use first, and each symbol's *real*
use site imports it from `models`/`period`, never re-exported through the store, so nothing broke.
Then a whole-tree export sweep (every `export` in `src/app` tested against every other file under
`src/`, `scripts/runtime-checks/` and `docs/`), which found **10 truly dead exports**, all deleted:
nine `X: X[] = [...]` vocabulary arrays that merely restated their own union (`PARTY_KINDS`,
`COUNT_SESSION_STATUSES`, `DOCUMENT_SCOPES`, `RECEIVING_CONDITIONS`, `ROLE_KEYS`, `TENANT_PLANS`,
`TIMESHEET_TARGETS`, `INVOICE_STATUSES`, `FORM_SCOPES` — each keeps a **used** `*_LABEL` sibling that
is the single source) and `dayTip()` in `tip-builders.ts`, whose siblings
`orderTip`/`assetTip`/`partyTip`/`segmentTip`/`employeeTip`/`workOrderTip` are all called from pages
while it has no caller at all.
**Left alone on purpose:** 11 exports used *inside their own file* — the public shape of a method
signature or an internal helper (`MovementInput`, `ReceiveLandingInput`, `ReceiveLineInput`,
`SearchCount`, `GeoAlert`, `haversineMeters`, `ViewGroup`, `ConfirmRequest`, `CONFIRM_DEFAULTS`,
`stampMinutes`, `stampHM`). Exported API, not dead code.
**Verified:** the diff is **33 deletions / 0 additions** across 4 files; 96 files audited for orphans,
**0** found (the two it flagged are `app.component.ts` / `app.config.ts`, the bootstrap entry points);
`lint:styles` was already 0-unused, so there was no CSS to remove; gates green (build `complete` ·
`lint:ctor` OK · **202 ok / 0 FAIL**).
**Reproduce:** the sweeps are two throwaway Node scans — for each named import/export, test the
symbol against every other `src`/`scripts`/`docs` file (and, for imports, exclude the declaration
line to catch file-local use). Worth promoting to a committed audit script next to
`scripts/audit-styles.js` so the rule becomes a gate — recorded as an optional P2b rather than
widening this phase.
**Scope:** unused imports (6 measured), then unused exports, orphan files, unreferenced CSS.
**Do, in this order:**
1. Remove the 6 unused named imports — first confirming the symbol is not cited in a comment/JSDoc
   (the scanner cannot see those) and is not part of the documented schema surface.
2. Sweep exports: every `export` in `core/` + `shared/` must be imported by `src/` **or** by a harness
   in `scripts/runtime-checks/` (the harnesses import the compiled core — a symbol only they use stays).
3. Orphan files: every file under `src/app` must be reachable from `main.ts` →
   `app.routes.ts` / `app.component.ts` / a template. Report anything unreachable; do not auto-delete.
4. CSS: keep `npm run lint:styles` as the oracle and delete only what it proves unreferenced.
**Acceptance:** gates green; the diff is deletions plus the import lines, nothing else.

### P2b — The dead-code sweep becomes a gate · `LOW` · status: **done (2026-09-12)**
**Done:** `scripts/audit-exports.js` + `npm run lint:dead`, in the house style of `audit-styles.js`
and `check-field-init-order.js` — report-only (exit 0, never fails the build), a header that states
what it counts as a reference and why, and three lines of output: imported names a file never uses
again, exports nothing else references, and (separately, as **kept**) exports used only inside their
own file. A symbol named anywhere in `src/app`, `src/main.ts` (the bootstrap entry point, which is what
keeps `AppComponent`/`appConfig` alive), the harnesses in `scripts/runtime-checks/` or `docs/` counts
as referenced; a name mentioned only in a comment counts too, so the report errs towards silence rather
than towards deleting something a human wrote down.
**Baseline (its own output):** 46 files, 230 exports → **0** unused imports, **0** dead exports, 24
file-local API exports listed for the record. That is P2's deletion *enforced* instead of remembered.
**Reconciled:** P2's entry counted **11** file-local exports using an ad-hoc scan; this gate — same
corpus, but per *declaration* rather than per first occurrence — lists **24**. The ten deletions P2
made are unaffected (each had zero references anywhere); the kept set is simply larger than the
ad-hoc scan suggested, which is the safe direction to be wrong in.
**Verified:** the script's output above; gates green (build `complete` · `lint:ctor` OK · `lint:styles`
0 unused · `check:store` **202 ok / 0 FAIL**); README and HANDOFF now list the fourth audit.

### P2c — `lint:styles`'s "re-set" detector · `LOW` · status: **done (2026-09-12) — proved, fixed, and it changed the answer**
**Finding:** `scripts/audit-styles.js` printed `122 selector(s) declared in 2+ rules, 0 declaration(s)
re-set by a later rule`. The real number was **15 declarations across 9 selectors**. **Root cause:** its
character parser accumulated every byte into one shared `buf` cleared only on `{`/`}`, and recorded a
property whenever `buf.indexOf(':')` was non-negative — after the first declaration that index always
finds the *same first* colon, so no later declaration was ever seen; each rule's property set was
effectively `{ first declaration }`.
**Proof (A/B, in `/tmp` sandboxes against a copy of the script):**
`.x { background: blue; color: red } .x { color: green }` → `0 declaration(s) re-set`, while
`.x { color: red; background: blue } .x { color: green }` → `1` (`color`). Identical cascade, opposite
verdicts; the only difference is which declaration comes first.
**Fix applied (in the script's own idiom, report-only behaviour preserved):** declarations are now read
at their **boundaries** (`;`, plus `}` for an unterminated last declaration) through a `flush()` that
records the property *and* whether it carried `!important`; `props` became a `Map` (first declaration of
a property wins); and a pair is no longer counted when the earlier declaration is `!important` and the
later one is not. The header now also states the report is **per selector** — in a grouped rule
(`.a, .b { x }`) a pair for `.a` does not make `x` deletable, because `x` may still be live for `.b`.
**After the fix it prints the truth:** `3 declaration(s) re-set by a later rule` once P5c removed the 12
that were deletable — and those 3 are exactly the grouped ones it must keep reporting
(`.btn-sm2`'s `padding` is dead for 1 of 4 selectors, `.sched-inspector`'s `min-height` for 1 of 3,
`.ts-page`'s `min-height` for 1 of 2).
**Verified:** `npm run lint:styles` exits 0 as before; the dead-class line is still `0 class(es) no
template mentions`; gates green (build `complete` · `lint:ctor` OK · `lint:dead` 0/0 · `check:store`
**202 ok / 0 FAIL**).

### P5c — the dead declarations the gate could not see · `LOW/MED` · status: **done (2026-09-12) — 12 deleted, 3 kept on purpose**
P5 asked its question at *rule* level ("is a whole rule superseded?") and got 0. Asking it at
*declaration* level — the level `audit-styles.js` is meant to check, with P2c's bug fixed — found 15
declarations a later same-selector, same-context rule re-states, i.e. declarations that can never win.
That is the class the script's own header says was decluttered before ("281 such declarations, 0 changed
winners"), so deleting them is neutral by the project's own argument.

**Deleted (12)** — each re-set for *every* selector of its rule, killer line named:

| Dead declaration | Superseded by |
|---|---|
| `.tl-day-head { font-size: 11.5px }` | `:1585` |
| `.tl-day-head { border-radius: 0 }` | `:1951` (`.tl-head, .tl-day-head, .tl-corner`) |
| `.tl-day-head { padding: 6px 0 8px }` | `:1585` |
| `.tl-row-track { border: 1px solid var(--slate-100) }` | `:1999` |
| `.tl-row-track { min-height: var(--tl-track-plain) }` | `:1588` |
| `.tl-block { padding: 5px 10px }` | `:1595` |
| `.ts-block { padding: 0 5px }` | `:861` |
| `.ts-block { align-items: center }` | `:861` |
| `:root { --sidebar-bg: rgba(15, 20, 36, .96) }` | `:2130` |
| `:root { --sidebar-bg-2: rgba(23, 28, 48, .92) }` | `:2130` |
| `:root { --sidebar-ink: #cbd5e1 }` | `:2130` |
| `.sidebar { background: radial-gradient(…) }` | `:2142` (the refresh layer's flat ramp) |

**Kept (3), and this is the part that matters:** `.btn-sm2`'s `padding`, `.sched-inspector`'s
`min-height` and `.ts-page`'s `min-height` are *re-set for one selector but live for their siblings* —
they sit in grouped rules (`.btn-ims, .btn-ims-outline, .btn-ims-quiet, .btn-sm2`, …), so deleting the
declaration would strip the property from `.btn-ims` and friends. The per-selector report cannot say
that; the check has to group by rule. Three real visual regressions avoided by looking at the lines
instead of trusting the count.
**Verification (the user's brief: "verifying each against the compiled CSS's winning values"):** built
both sides and extracted, for every selector, the winning value of every property from the *compiled*
stylesheet (619 selectors, 2185 winning declarations — selector lists expanded, so a grouped rule feeds
each selector it names). **The two maps are identical: `diff` = 0 lines.** The emitted CSS hash does
change (`2638d90c…` → `3723d96e…`), because the dead declarations are gone from the text — which is the
point — while the *effective* stylesheet is unchanged. Gates: build `complete` · `lint:ctor` OK ·
`lint:styles` `0 class(es)` + the 3 disclosed pairs · `lint:dead` 0/0 · `check:store` **202 ok / 0 FAIL**.

### P3 — Naming & formatting consistency · `LOW` · status: **done (2026-09-12)**
**Done:** renamed the one selector that did not match its component — `ims-admin-verticals` →
`ims-verticals` on `VerticalsComponent` (checked first: no template, doc or script references it, so
no call site moved). Trimmed the only two `.editorconfig` violations in `src` — a whitespace-only line
and a trailing space, both in `styles.scss`.
**Audited, nothing to do:** 99 files, **0** non-kebab basenames, **0** non-PascalCase exported
classes, 0 missing final newlines, 0 CRLF, 0 tabs. (First pass of the audit reported nonsense because
the regex forbade the dot in `*.component.ts` — re-run corrected; worth remembering if it becomes a
gate.)
**Deliberately not done:** import *ordering*. The `core`/`shared` import groups are not alphabetical
anywhere in this project and no config says they should be, so enforcing one would be inventing a
convention mid-sequence — the same reason Prettier/ESLint stay out (they remain an end-of-sequence
⛔ decision, not a mid-refactor one).
**Verified:** `trailing-whitespace lines: 0`; `ims-verticals` declared once and referenced by nothing
else (24 `ims-*` selectors, all matching their files); gates green (build `complete` · `lint:ctor` OK ·
**202 ok / 0 FAIL**).
**Scope:** the drift rows in Section 1 — nothing stylistic for its own sake.
**Do:** rename `ims-admin-verticals` → `ims-verticals` (confirm the selector is used by no template
first — if it is, that is a separate review); normalise trailing whitespace and final newlines per
`.editorconfig`; order imports (framework → core → shared → feature, as most files already do) only in
files being touched anyway; confirm `kebab-case` file names and `PascalCase` classes throughout.
**Do not:** adopt Prettier/ESLint here. A formatter would rewrite the tree and bury every later diff;
if the project wants one, it is a ⛔ decision recorded in the log and applied at the *end*.

### P4 — Lifecycle & RxJS hygiene · `LOW` · status: **done (2026-09-12)**
**Done:** the shell's two `router.events` subscriptions now carry
`takeUntilDestroyed(this.destroyRef)` (a `DestroyRef` constructor parameter), so their lifetime is
*stated* rather than implied. Behaviour is identical — the shell lives as long as the app — but a
future re-scope of the shell can no longer leak them.
**Both suspected leaks turned out not to be leaks, so neither was touched:**
- **Telemetry's `setInterval`** is started by the *shell* (`AppComponent.ngOnInit`, and only while
  the module is enabled) and stopped in the shell's `ngOnDestroy`; the Telemetry page's own
  `start()` is idempotent (`if (this.timer) return`). One interval, app-lifetime, stopped on
  destroy.
- **The Scheduler's deferred listener:** `ngOnDestroy` calls `detachResize()` + `detachMove()` +
  `cancelRowClick()`, so the queued row-click `setTimeout` (the 250 ms double-click window) is
  cleared. The one listener not registered in `ngOnDestroy` — the drag's capture-phase `click`
  killer — is bounded: it removes itself the moment that click arrives, or after 400 ms
  (`scheduler.component.ts:1512`). Self-healing, not a leak.
**Audited (every listener/observer site, 4 files):** Scheduler (its *move* drag is tracked, and
`detachMove()` removes all three listeners; its *resize* drag is built from local closures that
self-remove on `pointerup` and `detachResize()` only clears state — see P4b's sibling finding),
Timesheet (drag handlers detach on `mouseup` — hardened in P4b), `tip-host` (one one-shot
`requestAnimationFrame`, no cancel needed), and the shell's router events.
**One gap found and deliberately not fixed:** the Timesheet's `ngOnDestroy` nulls `this.drag` but
does not remove a drag's `mousemove`/`mouseup` listeners if the component is destroyed *mid-drag* —
they linger until the next `mouseup`, which then removes them (and `this.drag` is already `null`, so
the handler is a safe no-op). The Scheduler's tracked-handler + `detach*()` pattern is the fix, but
editing a drag interaction that no gate can exercise is not a `LOW`-risk change — recorded as
**P4b (optional)** pending an explicit go-ahead.
**Also observed, not changed:** disabling the Telemetry module after boot does not stop the sim
(the shell starts it in `ngOnInit` and nothing watches the licence flag), so it keeps ticking
invisibly until a reload. Pre-existing, and stopping it would change the nav badge's live behaviour.
**Verified:** gates green (build `complete` · `lint:ctor` OK · `lint:styles` 0 unused · **202 ok /
0 FAIL**); the app's only two `.subscribe(` calls are the two above, both now torn down.

### P4b — Timesheet drag handlers · `LOW` · status: **done (2026-09-12)**
**Done:** the Timesheet's drag listeners are now named fields (`dragMoveHandler`, `dragUpHandler`) with
`endDrag()` and an idempotent `detachDrag()`, and `ngOnDestroy` calls `detachDrag()` instead of only
nulling `this.drag`. A page left mid-drag therefore takes its `mousemove`/`mouseup` off `window`
immediately, where before they lingered until the next `mouseup` — which removed them and then did
nothing, since `drag` was already `null`. The normal path keeps its order and effect: detach, read
`moved`, then set `justDragged` + `detectChanges()` when a real drag happened (so the click that
follows a drag stays suppressed). Pattern copied from the Scheduler's whole-block drag
(`onMovePointer` / `endMovePointer` / `detachMove`).
**Sibling gap the copy revealed (not fixed — same shape, other calendar):** the Scheduler's *resize*
drag is still built from local closures (`scheduler.component.ts:1336-1339`) and its `detachResize()`
only does `this.resizing = null` (line 1395), so a page left mid-*resize* keeps
`pointermove`/`pointerup` until the next pointerup — exactly the gap P4b closes for the Timesheet. The
fix is the same five lines; recorded as **P4c** pending an explicit go-ahead, because it touches the
other calendar's drag path.
**Verified:** gates green (build `complete` · `lint:ctor` OK · `lint:styles` 0 unused · **202 ok /
0 FAIL**); no local listener closures remain (`dragMoveHandler` is the only `onDragMove` caller);
36 insertions / 15 deletions in `timesheet.component.ts`.
**Scope:** `core/telemetry.service.ts`, `features/scheduler/scheduler.component.ts` (gap 4), and the
2 `router.events` subscriptions in `app.component.ts`.
**Do:** confirm `TelemetryService`'s interval is cleared on every stop path (component destroy, module
gating, tenant switch) and make stop idempotent; make the Scheduler's deferred global-listener removal
survive an early destroy (move it into `ngOnDestroy` if it does not); switch the two router
subscriptions to `takeUntilDestroyed(this.destroyRef)` — shell-lifetime today, so this is insurance
against a future re-scope, not a leak fix.
**Acceptance:** gates green; Telemetry still ticks; the Scheduler's single/double-click handling is
unchanged (it deliberately waits out a 250 ms window).

### P4c — Scheduler resize handlers · `LOW` · status: **done (2026-09-12)**
**Done:** the Scheduler's *resize* drag now has the same shape as its whole-block drag: two bound
handlers (`onResizePointer`, `endResizePointer`) and a `detachResize()` that removes both **and** clears
`resizing` — where before `detachResize()` only nulled the state while local closures stayed on `window`
until the next `pointerup`. `ngOnDestroy` already called `detachResize()`, so it now does the full job
without any change at that call site. The normal path is unchanged: pointerup → detach → state cleared.
**Deliberately unchanged:** the resize drag still listens to `pointermove`/`pointerup` only (no
`pointercancel`), matching today's behaviour rather than quietly adding an event nobody asked for.
**Verified:** gates green (build `complete` · `lint:ctor` OK · `lint:styles` 0 unused · `check:store`
**202 ok / 0 FAIL**); 17 insertions / 5 deletions in `scheduler.component.ts`; no local listener
closures remain on the resize path.

### P5 — Stylesheet consolidation · `MED` · status: **done (2026-09-12) — no removals; the audit is the deliverable**
**Analyzed:** all 26 SCSS files (**828** rules) with four mechanical detectors, plus the layer
structure of `styles.scss` (2,477 lines).

| Detector | Result |
|---|---|
| Unused class names (`npm run lint:styles`) | **0** |
| Exact duplicate rules (same `@media` context + selector + declarations) | **0** |
| Duplicate declarations inside one block | **0** |
| A property declared twice in one block (the first silently loses) | **0** |
| A rule whose every property is re-stated later for the same selector in the same context (so deleting it cannot change any computed value) | **0** |

**Conclusion: nothing in these stylesheets can be removed without a visual review.** The file is not
carrying dead weight — it is long because of the layered design its own header documents: ported
prototype CSS first, then feature blocks, then an additive *visual refresh* layer loaded LAST whose
whole purpose is to restate the same selectors with **different** values. That is why 92 selectors are
declared more than once yet no two declarations are identical: those repeats *are* the overrides.
(Stated at the **rule** level, which is how P5 asked the question — the declaration-level answer is
**P5c** above, beside P2c: 12 dead declarations removed, 3 kept because their rules are grouped.)

**The one change (comment-only, proven inert):** the `:root` block that calls itself "Source of truth
for tokens" restated three sidebar tokens (`--sidebar-bg`, `--sidebar-bg-2`, `--sidebar-ink`) that the
refresh `:root` near the end of the file overrides — so editing them in the first block does nothing.
It now says so, in the file, where the temptation occurs. Nothing else was added: the refresh block
already documents its own layering, its four goals and its "no geometry changes" promise, better than
any map I would have written.
**Proof it is inert:** the production CSS bundle hash is **byte-identical** before and after
(`2638d90cfda0896358843660330c99f1a8dc888ead94cad78e57f20c384a4058`, `styles-AN6RIW43.css`) — comments
are stripped by the compiler, so the emitted CSS *cannot* have changed. That is the strongest
verification available to this phase without a browser.

**Reported, deliberately untouched:**
- **`!important` — 4 sites:** `styles.scss:1370` (`.text-danger`), `1436` (`.hidden`), `1945`
  (`.tl-inner { min-width: 0 }`), `admin.component.scss:72` (`.admin-nav-chev` font-size). Bootstrap
  the *library* is not loaded at all (`angular.json`'s `styles` array is `src/styles.scss` alone; no
  `@import`, no dependency), so these are not fighting Bootstrap — each beats a higher-specificity rule
  in these same files, which is exactly why retiring one is a cascade change needing the pages in front
  of a human. (The `.tl-inner` one at least sits under a section comment stating its intent.)
- **Cross-boundary overlap: 50 class names** are defined in *both* the global sheet (326 class names)
  and a component sheet — `scheduler.component.scss` alone accounts for **27**. These are *not*
  collapsible the way duplicates would be: Angular's emulated encapsulation rewrites a component rule
  to `[_ngcontent-*]`, which out-specifies the global one, so the two copies may legitimately disagree
  and the component's wins inside its own view. Consolidating them means deciding per rule which layer
  owns it — a restructure, not a cleanup.

**If the goal is a smaller stylesheet rather than a proven-clean one,** that is that restructure:
promote every override into the refresh layer, delete the superseded ported rules, diff the rendered
pages. ⛔ with a visual review — recorded as **P5b**: the tooling half is done there, the restructure is
shown to be unprovable without a browser, and the one provable deletion it had (two unread tokens) is
taken.
**Verified:** gates green (build `complete` · `lint:ctor` OK · `lint:styles` 0 unused · **202 ok /
0 FAIL**); diff is **4 insertions / 1 deletion** in `styles.scss` (one comment); CSS hash unchanged.
**Scope:** `src/styles.scss` (2,477 lines) + the 26 component sheets.
**Do:** inventory duplicate/overlapping rules between the ported layer and the additive "visual
refresh" layer; collapse only the provably identical ones; where a rule deliberately overrides
Bootstrap, keep it and say so in a comment (the file already documents several such cases) rather
than deleting it.
**Acceptance:** `lint:styles` still reports 0 unused, **and the pages look identical** — this phase
proceeds in small named batches and stops at the first change that is not countable, because the gate
suite cannot see a pixel.

### P5b — the stylesheet restructure, measured · `MED` · status: **done (2026-09-12) — tooling + 2 deletions; the restructure itself is not provable**
**What I looked for, and what the measurement says:** every *mechanical* restructure a stylesheet can
offer was counted, and none is available:

| Candidate | Count |
|---|---|
| A rule whose every property is re-stated later for the same selector (P5) | 0 |
| Exact duplicate rules (P5) | 0 |
| **Adjacent same-selector rule pairs** (merging those *is* provable: nothing sits between them) | **0** |
| Rules with an empty body | 0 |
| Custom properties declared but never read anywhere in `src/` | **13** |

**Deleted (2):** `--teal-soft` and `--pink-soft`, and with them their comment — which claimed *"the
calendar bars need [them] to keep their type hues distinct (teal ≈ work orders/kits, pink ≈
attachments)"*. Nothing reads them (the name appears only on its own declaration line), and the bars'
hues now come from the per-type `--tint-*` classes (`.ts-idle { --tint-bg: hsl(…); … }`), so the comment
described a superseded approach and went with the tokens.
**Kept (11), on purpose:** `--slate-900`, `--accent-soft`, `--brand-ink`, `--brand-soft`,
`--purple-soft`, `--sp-5`, `--fs-xs`, `--fs-lg`, `--lh-tight`, `--r-sm`, `--tip-accent`. Each is a step
in a *complete scale* (the slate ramp, the 8pt spacing scale, the type scale, the radius scale) or a
member of a deliberately-declared palette — `--tip-accent` sits in `tip-host`'s block whose own comment
says the palette exists "so re-skinning every tip in the app is a one-line change". Deleting an unread
*scale step* leaves a hole in a design system that mirrors the prototype's `shared.css`; that is a design
decision, not cleanup, so it is reported rather than taken.
**The tool this phase leaves behind:** `scripts/css-equivalence.js` + `npm run css:equiv` — it reads two
**built** CSS files and prints, per selector, every winning declaration that differs:

```bash
npm run build && cp dist/ims-web/browser/styles-*.css /tmp/before.css
# …edit src/styles.scss…
npm run build
node scripts/css-equivalence.js /tmp/before.css dist/ims-web/browser/styles-*.css
```

Exit 0 when the effective stylesheet is identical, 1 when it is not. **Verified with it:** 619 selectors
on both sides, 2185 → 2183 winning declarations, and the only two differences are the two declarations
deleted (`:root || --teal-soft :: #e2f4f1 -> (absent)`, `:root || --pink-soft :: #fce7f3 -> (absent)`).
Nothing else moved. Gates: build `complete` · `lint:ctor` OK · `lint:styles` `0 class(es)` + the 3
disclosed pairs · `lint:dead` 0/0 · `check:store` **202 ok / 0 FAIL**.
**What remains unprovable (and stays ⛔):** the restructure P5b was named after — promoting every override
into the refresh layer and deleting the superseded ported rules — *reorders rules between selectors*, and
two equal-specificity rules can then flip which one wins **for one element**. A per-selector map cannot
see that; it needs a DOM. So it is not a `MED` sweep: it wants a browser (or a per-page screenshot diff)
as its verification, and saying so is the honest outcome of this phase rather than doing it blind.

**Closed by decision (2026-09-12), now that the browser exists.** P9 delivered the instrument this was
waiting for (`npm run e2e` + `npm run css:equiv`), so the restructure *can* now be attempted — and,
having measured what it would contain, it should not be:
- every **provable** cleanup is already taken: 0 superseded rules, 0 duplicate rules, 0 duplicate
  declarations, 0 duplicate properties, 0 adjacent same-selector pairs, 0 empty rules — and P5c removed
  the 12 declaration-level exceptions the corrected detector found.
- what is left on the list is **reorganisation for readability only**: the 92 selectors declared more
  than once are the refresh layer restating selectors with different values, and that layer's own header
  states its purpose and its grouping ("easy to read, tune or drop as one unit"). Moving those rules
  into a different order is work that *fights* the design, changes no computed value by construction, and
  risks the one thing no tool here can settle: an equal-specificity winner flipping for a single element.
So P5b closes as: **the tooling is in place, the dead weight is gone, and the remaining length is the
layered design — deliberate, documented, and not worth paying visual risk to shuffle.**
**If you still want the churn, the recipe is ready** (and it is now a two-command loop):
`npm run build && npm run e2e` → move a *named batch* of rules → `npm run build && npm run e2e` →
compare `dist/e2e/*.png` by eye **and** `npm run css:equiv /tmp/before.css dist/ims-web/browser/styles-*.css`
for the exact half (any winner that changes is printed) → revert the batch if either disagrees. Do it in
batches of one theme (sidebar, buttons, calendar), never as one sweep.

### P5c — see the audit cluster above (next to P2c)

The 12 dead declarations P5 left behind, the 3 grouped ones that must stay, and the compiled-CSS
verification are recorded under **P5c** above, beside **P2c** — the detector bug that hid them — because
those two entries are one finding.

### P6 — Store & component decomposition study · `HIGH` · status: **done (2026-09-12) — a proposal with measurements, no code moved**
**Method (measured, not skimmed):** the store's own 32 banner sections were parsed with method
declarations and `this.x(` call sites, so every section got a line count, a method count, its
**outbound** calls into other sections and its **inbound** calls from them; separately, the *external*
call sites (`.method(` in `features/`, `shared/`, `scripts/runtime-checks/`) were counted per public
method. Nothing was resolved by guesswork: 353 methods, 0 unresolved call sites.

**What the store is (`core/data.service.ts`, 5,185 lines, 353 methods):**

| Section | lines | methods | public | calls out | call sites outside |
|---|---|---|---|---|---|
| the tenant's catalog (Phase C) | 347 | 28 | 22 | 21 | 183 |
| orders | 254 | 23 | 21 | 11 | 154 |
| receipts | 246 | 11 | 6 | 17 | 63 |
| billing | 236 | 16 | 14 | 14 | 52 |
| movements | 235 | 12 | 8 | 28 | 86 |
| purchasing | 221 | 22 | 22 | 19 | 101 |
| items | 219 | 18 | 14 | 9 | **224** |
| price cards | 188 | 15 | 14 | 4 | 45 |
| timesheets | 155 | 20 | 19 | 7 | 33 |
| stock levels | 133 | 11 | 8 | 5 | 99 |
| … 22 more | | | | | |
| **seeds + `bulk resources` + `serialized fleet` + tenancy seeds** | **~1,050** | — | — | — | 0 |
| `format` | 41 | 6 | 6 | **0** | 119 |

The spine is visible in the numbers: **`persistence` is called from 21 sections (85 call sites)** — the
shared bottom layer, as it should be; **`items` is the most depended-on domain** (31 inbound
cross-section calls — movements 6, KPIs 5, work orders 4, catalog 4, receipts 3, …); and **1,595 call
sites live outside the store** (`data.x(…)` across features, shared widgets and harnesses). That last
number is the facade, and it is the whole argument for what follows.

**The proposal, in order, with the proof each step needs:**

1. **`format` → `core/format.ts`** (41 lines, 6 methods, **0 inbound cross-section calls**, 119 external
   call sites that keep working via a re-export). Pure value formatting — exactly the shape B1 already
   took twice for `period.ts` and `pricing.ts`. *Proof:* `check:store` (the harnesses assert money and
   date strings) + `build`.
2. **The seeds → `core/seed/*.ts`** (~1,050 lines, no inbound calls, no external call sites — pure data
   plus pure row factories). **Not a new idea:** `PLAN-B.md`'s B1 lists exactly this as its remaining
   work ("Still to do under B1: the seed split into `core/seed/`"). *Proof:* `check:store` *is* the
   proof — the fixture is asserted end to end (every section above has checks over its seeded rows).
3. **Nothing else.** Every remaining section is entangled with the spine: split a domain out and it
   either needs the store passed back in or leaves thin delegates on the facade anyway, while 1,595
   external call sites stay exactly as they are. That is a redesign of the app's spine with no
   correctness payoff, which is why it is not proposed.

**Component half — the Scheduler (1,591 lines, 105 methods; 24 private, 81 public):** the size is held
by 35 methods that touch an injected service — `assetModel` (93 lines), `availability` (72),
`showOrderView` (65), `onMoveMove` (59), `onResizeMove` (52), `saveRes` (47). 70 methods touch none, but
most are one-line template helpers; the ones with real weight are the *derived-value* computations:
`models` (56), `columns` (23), `conflicts` (23), `peakUnits` (17), `bookingsInRange` (15),
`committedUnits` (13) — i.e. a `scheduler-view.ts` that takes the data it needs as arguments.
**Why that one is filed rather than started:** the harnesses cover the **store**, not view models, and
there are **0 specs** — so a component extraction today would be a change nothing can check. It is the
natural first customer of P9.

**Status:** 1 and 2 are each one iteration with an existing proof; neither is started here because this
phase was scoped to the proposal, and because the log's own rule is that a phase documents before the
next one executes. Say the word and 1 goes first (smallest, pure), then 2 (biggest, but pure data).

### P9b — the harness pattern reaches a component · `MED` · status: **done (2026-09-12)**
**The gap this closed:** 25 harnesses proved the *store*; the biggest component in the app
(`scheduler.component.ts`, 1,591 lines) had no regression net at all. `npm run e2e` renders it, and
rendering says "it draws", not "it draws the right period".
**What made it possible (probed before designed):** the component class can be instantiated **in Node,
with no DOM**, because its *derived* reads are pure — the constructor takes the store, and only the drag
handlers touch the DOM (`getBoundingClientRect`, in `onMoveMove`/`onResizeMove`). Two details make it
run: `import '@angular/compiler'` first (the decorators need JIT outside the framework) and stubs for the
injected `ChangeDetectorRef`/`ConfirmService`, which the methods under test never call.
**The runner change that unlocked it:** `check-store.sh` now compiles with `--rootDir src/app` and
includes `features/scheduler/scheduler.component.ts`, then copies the emitted `core/` up to the temp root
so the other 25 harnesses' flat `./data.service.js` imports keep working. (Second time this runner has
had to learn something — the first was the recursive import fix-up in P6/2.)
**`check26.mjs`** (5 checks) asserts the Scheduler's view math against the fixture: it opens on the week
view, Monday-anchored and self-consistent; a week is seven consecutive labelled days; day and month views
switch and a month is 28–31 columns all inside the anchored month; every bar names a real order; and the
conflict list names orders while *nothing on the order row stores one* (derived, not held).
**Honest note on the first three drafts of it:** five of my initial assertions failed, and **every one
was the assertion's fault, not the app's** — I guessed that a day view is one column (it is 24), that
bars carry a `liId`/`left`/`width` (they don't, at the top level), that day columns all sit in one
calendar day, that an order outside the week can't produce a bar (its *line's* dates decide), and that
the anchor is the earliest order rather than the first *active* one. They are now narrowed to claims that
are true by construction, which is the point: a check that guesses a field name tests the guess.
**Verified:** `check:store` **215 ok / 0 FAIL** in 26 harnesses; build `complete`; `lint:ctor` OK;
`lint:dead` 0/0; `npm run e2e` still green.
**What this unblocks:** P6's component half. The extraction (`scheduler-view.ts` for `models` / `columns`
/ `conflicts` / `peakUnits` / `bookingsInRange` / `committedUnits`) was filed in P6 precisely because
nothing could test it — "it is P9's first customer". `check26` is that customer's net: extract, then
prove the same numbers by running the same assertions against the extracted functions.

### P11 — the modal editors · `MED` · status: **done (2026-09-12)**
**The last gap, and the one P6/4 and P10 both pointed at.** `openOrder()`/`saveOrder()` and
`openRes()`/`saveRes()` are the app's only *creation* paths — and the code the component never had a
reason to expose: they seed a form from the surrounding context, validate it, coerce its numbers, and
write through with a set of documented fallbacks. P10 proved the gestures need no browser; this proved
the same of the editors, and for a stronger reason: **the component references `document` nowhere at
all** (0 hits), so `window`'s listeners are the only global it touches.
**check28 (10 checks)** drives both editors against the real store:
opening the New Order editor seeds a complete form *and is not an edit* (`orderDirty()` false — which is
what makes the close-confirm trustworthy, since a freshly opened form must not look unsaved); editing one
field makes it dirty, and reopening starts clean; saving is refused with a blank (or whitespace) name or
an unknown customer, **writing nothing and leaving the editor open**; a valid save trims name and site,
maps `07:00`/`17:00` to 420/1020 minutes, falls back rather than writing junk (`'not a number'` radius →
300 m, an unparseable latitude → the yard's), closes the editor and focuses the new order (selected,
expanded); and an order saved unticked is created `closed`.
For resources: the editor seeds the pool tab (its first category, that type's first status, the yard);
a blank name is refused; **the category name is copied from the category row while its id is what is
stored**, so the two cannot disagree (the Phase C rule); an unplaced resource stores *no* location rather
than an empty one; the per-type fields follow the tab (serialized keeps serial/make/model/meter hours/
purchase value, consumable keeps its reorder point and costs); and — the check that turned out to be the
interesting one — **an opening count only lands when the row has a place to sit in**: 50 units with a
place become the row's first level, the same 50 with no place leave the row holding nothing
(`openStock()`'s documented rule, reached through the editor rather than by calling the store).
**Two assertions failed first, and both were mine** — and both had the same cause: I assumed
`createItem` takes every key of the patch verbatim. It does not: for a counted row the quantities are the
*level table's* sum, so `qty`/`qtyOnHand` come back 0 when there is no place. Reading `createItem` /
`openStock` turned a wrong assertion into the check worth keeping. (Fifth time in this effort; the rule
from P6/3 stands, and this is its sharpest form yet — the store was right, and reading it made the test
better than the one I had imagined.)
**Verified:** build `complete` (0 warnings) · `lint:ctor` OK · `lint:styles` 0 unused · `lint:dead` 0/0 ·
`check:store` **246 ok / 0 FAIL** in **28 harnesses** · `npm run e2e` all checks passed.
**With this, every surface the log named as uncovered is covered** except the drag *paint* (the position
of a bar under the cursor during a drag), which is genuinely a rendering question and stays with
`npm run e2e`.

### P10 — the gestures, the writes and the tooltips · `MED` · status: **done (2026-09-12)**
**What this covered.** P6/4 closed by naming what was left in the Scheduler and why it was not an
extraction candidate: the drag/resize/move handlers, the modals and writes, the pool cards' rows and the
tip builders — code that touches the DOM or writes. That was the right call for *refactoring*, and the
wrong place to stop for *verification*: those paths are the most bug-prone in the app (P4b and P4c both
landed in them), and until now the only thing exercising them was the e2e grid test.
**It turned out none of it needed a browser.** The gesture code touches exactly one browser global —
`window` add/removeEventListener — and one DOM call, `track.getBoundingClientRect()`. Stub both, plus a
plain object standing in for the pointer event, and the *real* handlers run against the *real* store, so
their real writes can be read back. check27 drives: drag-to-book (one line added, qty 1, the row left
selected and expanded); the multi-unit prompt (a bulk drop writes **nothing** and opens `bookPrompt`,
`commitBook()` writes the quantity that was asked for); the retired-asset refusal (`availability().blocked`
is exactly `status === 'retired'`, and a refused drop never opens the prompt); a whole-order drag (200px
of a 700px week = 2 days, both ends move, and every booking is carried along); the 3px click-vs-drag
threshold (a 2px wobble claims nothing and writes nothing — this is what keeps a plain click selecting a
row); an edge resize (and that it clamps rather than inverting, and cannot leave the order's window); and
a Day-view drag (snaps to a quarter hour, length preserved).
**The tip builders and `stamp*` helpers — 8 builders shared by every page, uncovered until now.** check27
asserts the shape the module documents (title = `CODE - project`, then one fact per line), that
`orderRecordTip` prints Customer/Site/Items/Value and carries the status badge, that `assetTip` prints a
serial line *iff* the item has a serial and a notes line iff it has notes, that `tip()` drops empty and
blank lines, and the stamp edge cases the tips promise: midnight printing `12:00am` not `0:00am`, minutes
past midnight wrapping, `08:05` → `8:05am`, an empty time printing nothing, a missing date printing `—`
never `NaN`, and a timeless range repeating its date.
**Why this is the right shape of test here (and the e2e stays):** this asserts *"given this gesture, did
the store change the way the rule says"*. Whether the pixels land under the cursor is `npm run e2e`'s
question, and that suite already drives the grid for real. Two nets, two questions, no overlap.
**Again, recorded:** one assertion failed first — I expected a dragged order's bookings to keep their own
dates, and they *do* move with it, because that is the documented behaviour ("moving an order carries its
bookings along"). My comparison was also wrong in a subtler way: it resolved a booking's window through
the order's dates *before* the move and compared against the explicit dates written *after*. The fix was
to resolve both sides the same way. (Fourth time in this effort; the rule from P6/3 stands.)
**Verified:** build `complete` (0 warnings) · `lint:ctor` OK · `lint:styles` 0 unused · `lint:dead` 0/0 ·
`check:store` **236 ok / 0 FAIL** in **27 harnesses** · `npm run e2e` all checks passed.
**Scheduler coverage, after P9b → P6/3 → P6/4 → P10:** the derived math (calendar, capacity, geometry,
composition) is asserted directly as pure functions; the gestures and writes are asserted through the
component against the real store; the rendering is asserted in a real browser. What remains genuinely
uncovered is the modal form editing (order/resource forms) and the drag *paint* — both deliberate.

### P6/4 — the component half, slice 2: the geometry layer · `MED` · status: **done (2026-09-12)**
**What moved.** The rest of the Scheduler's derivations, appended to `scheduler-view.ts` (450 lines
now): `lineQty` / `qtySuffix`, `orderT0` / `orderT1` / `lineT0` / `lineT1`, `dateIncludes`, `geomMin`,
`fmtMin`, `geom`, `lineDays`, `typeRank`, `itemName`, `shortItemLabel`, `sortedLines`, `isConflicted`,
`conflictDetail`, and the composition on top of them — `models()`, `conflictCount()`, `conflicts()`.
`scheduler.component.ts` went **1,506 → 1,388 lines** (from the original 1,591), still delegating through
same-named thin methods, so the template and every internal call site remain untouched.
**The design decision that matters.** These functions need the store — names from the catalog, capacity
from the item, Day-view minute windows from the order — so the tempting move is to pass `DataService` and
call it a day. Instead they take a **`ScheduleReader`**: the six reads they actually perform
(`orderT0`, `orderT1`, `getItem`, `itemLabel`, `mkName`, `capacity`). Three consequences, all deliberate:
the *contract* is visible in every signature, nothing in the module can write, and — the point — a check
can pass a hand-made store. That is how the capacity rule finally became testable: two overlapping
bookings of a serialized unit clash, a third with its own September window does not, and 12 + 12 units of
a 24-unit bulk item is *not* a clash while a 25th unit is. No seeding, no DOM, no component.
**The proof (same method, wider net).** The dumper was extended to cover the whole geometry layer and run
before/after: for 3 views × 5 anchor positions — every order's and every booking's `geom()` rectangle,
`fmtMin` at nine minute values, `dateIncludes` for every order, `headColumns()`, plus `geomMin` on eight
crafted minute windows, `lineDays` / `lineQty` per booking, `sortedLines` per order, `typeRank` for every
type and two nonsense keys, `itemName` / `shortItemLabel` per booking, the minute windows
(`orderT0`/`orderT1`/`lineT0`/`lineT1`), `isConflicted` + `conflictDetail` per booking, `models()` in all
three views, `models()` with a row expanded, `conflicts()`, `conflictCount()`, plus the P6/3 sections.
**74,014 bytes before, 74,014 bytes after — `cmp` byte-identical**, on the first run.
**check26 grew 9 → 14 checks**, five of them driving the new layer through the stub reader.
**Verified:** build `complete` (0 warnings) · `lint:ctor` OK · `lint:styles` 0 unused · `lint:dead` 0/0 ·
`check:store` **224 ok / 0 FAIL** in 26 harnesses · `npm run e2e` all checks passed.
**P6 is now complete.** `scheduler.component.ts` is 203 lines lighter and everything derived is reachable
from a check. What remains in it is state and gestures: the drag/resize/move handlers, the order and
booking modals, the pool cards' own rows, and the tip builders — all of which either touch the DOM
(so they belong to the e2e suite, which already exercises the grid, not to this pattern) or write (so
they need a store round trip, which the harnesses already cover directly).

### P6/3 — the component half, in slices: the calendar & capacity math · `MED` · status: **done (2026-09-12)**
**What moved.** `src/app/features/scheduler/scheduler-view.ts` (196 lines) now holds the Scheduler's
period and capacity math as pure functions: `startOfDay` / `mondayOf` / `dayAt` / `pad2`,
`columnsFor(view, anchor)`, `periodStartFor`, `rangeBoundsFor`, `lineStart` / `lineEnd`, `peakUnits`,
`bookingsInRange(item, orders, view, anchor)` and `committedUnits(item, orders, from, to)` — plus the
view-model types (`View`, `DayCol`, `BarGeom`, `BarModel`, `OrderModel`, `BookingRef`) that were declared
inside the component. `scheduler.component.ts` went **1,591 → 1,506 lines** and now *delegates* through
same-named thin methods, so its ~100 internal call sites and its template were not touched at all.
**Why a slice and not the whole 1,591 lines.** `models()` / `conflicts()` are the *geometry* layer: they
turn these windows into pixels and read catalog names/capacities from the store, so they are their own
slice with their own proof. This one is the layer beneath them — the part `check26` already asserts.
**The proof (P6/2's method, applied to a component).** A throwaway dumper
(`/tmp/dump-scheduler.sh`, kept out of the repo because its *output* is replaced by check26's assertions)
instantiates the real component in Node and writes a canonical JSON of every derived value: 3 views × 5
anchor positions (labels, phrase, column counts, first column, timeline width, every column, visible
bounds), `bookingsInRange` for every pool item, `committedUnits` for every seeded line window, 5 crafted
`peakUnits` cases, every `models()` bar and `conflicts()` row, and `conflictCount()`. Run before the
extraction and again after: **42,584 bytes, `cmp` byte-identical** — every derived value in the screen
provably unchanged, including the geometry layer this slice did not touch.
**Then the assertions became durable.** check26 grew from 5 to **9 checks**: the four new ones drive the
extracted module *directly, with no component and no DOM* — the whole point of the extraction —
including the day-inclusive tie rule in `peakUnits` (a booking that ends the day another begins must not
read as a clash).
**Third time the same lesson, recorded again:** my first `peakUnits` assertion expected 1 and the code
returned 2 — because I wrote the fixture as if `end` were exclusive when spans are day-inclusive, so my
"back-to-back" pair genuinely shared a day. The code was right; the assertion was wrong. (That is now the
third time in this effort that a failing check was the check's fault — P9b logged five such cases. The
pattern is consistent enough to be worth stating plainly: **when a new assertion fails, suspect the
assertion first**, and prefer claims that are true by construction over field-name guesses.)
**Verified:** build `complete` (0 warnings) · `lint:ctor` OK · `lint:styles` 0 unused · `lint:dead` 0/0 ·
`check:store` **219 ok / 0 FAIL** in 26 harnesses · `npm run e2e` all checks passed.
**What is left of P6's component half (P6/4).** The geometry layer: `models()`, `conflicts()`,
`conflictCount()`, `isConflicted()`, `conflictDetail()`, and the helpers they drag in — `geom` /
`geomMin` / `minToX`-style converters, `orderT0` / `orderT1` / `lineT0` / `lineT1`, `dateIncludes`,
`fmtMin`, `qtySuffix`, `lineDays`, `sortedLines`, `typeRank`, `itemName`, `shortItemLabel`. These need
`data` passed in (the seeds' pattern) because they resolve catalog names and capacities. The proof
method is already in place: same dumper, same byte-identical `cmp`.

### P6a — the `format` extraction · `LOW` · status: **done (2026-09-12)**
**Done:** the store's `format` section — its only one with **no store state** and **no inbound calls**
from any other section (P6's measurement) — moved to `core/format.ts`: `money`, `int`, `pct`, `parseDT`,
`fmtDate`, `fmtDT`, now plain `export function`s with the same bodies. `DataService` keeps all six as
**thin one-line delegates**, because `data.money(…)` / `data.fmtDate(…)` is what **187 call sites across
19 files** already write — not one of them changed. The section's banner comment says so, so the next
reader does not mistake the bare names inside a delegate for recursion.
**Why this one first:** it is the smallest extraction with a real boundary — arguments in, strings out,
nothing to thread through — and `check:store` already exercises its output through the store (money in
check5/6/7/13, date stamps in the inspection/handoff harnesses).
**The verification, including the part that matters:** `check25` grew from 7 to **8** checks, driving
the new module *directly* — money/int/pct shapes, the date stamps, `parseDT`'s local-midnight rule and
its copy-a-Date behaviour — **and asserting the store's six methods agree with it**, which is the line
that catches a second implementation hiding behind the same name. `check:store` is now **210 ok /
0 FAIL**, and the harnesses that go *through* the store passed unchanged before and after — the
behavioural proof that the extraction was transparent.
**Docs:** README's core list now reads `format.ts period.ts pricing.ts` (the third member of B1's
extracted-helper family); PLAN.md's `check25` entry says 8; the count is updated wherever it is quoted
as current (README, HANDOFF, PLAN.md, PLAN-B.md, and this log's recipe + baseline row).
**Next in P6's order:** the seeds → `core/seed/*.ts` (~1,050 lines of pure data and row factories, no
inbound and no external call sites, already scoped in PLAN-B's B1). Bigger, but more mechanical still,
with the same proof: `check:store` asserts the fixture end to end.

### P6/2 — the seeds move to `core/seed/` · `LOW/MED` · status: **done (2026-09-12)**
**Done:** the fixture left the store. **24 of the 30 seeders are pure data factories** — measured, not
assumed (`this.` appears in none of them) — and they now live in `core/seed/`: `tenancy.ts` (3),
`config.ts` (9), `parties.ts` (4), `operations.ts` (8), plus `fixtures.ts` holding the **8 shared facts**
both sides need (`DEMO_TENANT_ID`, `DEMO_USER_ID`, `DEMO_OWNER_ID`, `YARD_STAGING`, `WAREHOUSE_1`,
`SHOP_STATUS`, `CREW_BASE`, `ASSET_FIELD_DEFAULTS`). `pad3` moved into `core/format.ts`.
**The 6 that stayed, on purpose:** `seedItems`, `seedStockItems`, `seedStockLevels`, `seedMovements`,
`seedPlacement`, `seedReceipts` — these touch `this.db` or call `receiveAgainst` / `syncStockTotals`,
i.e. they *post* through the mutators the pages use (the store's own note: "the fixture runs the same
operation the Purchasing page runs"). Splitting those would mean handing the store back in for no gain,
so the boundary is drawn at **"pure factory" vs "posts through the store"**.
**Size:** `core/seed/` = 915 lines in 5 modules · `data.service.ts` **5,179 → 4,333** (−846).
**The proof — the strongest one available without a browser:** the *entire* seeded store, not a sample
of it. Boot `DataService`, force a save, dump the persisted JSON: **byte-identical before and after**
(92,351 bytes, `4903c78c…`, `cmp` clean). Not "the checks still pass" — the fixture is the same store to
the byte. `check:store` also passes unchanged at **210 ok / 0 FAIL** (it asserts the fixture end to end),
with build 0 warnings · `lint:ctor` OK · `lint:styles` 0 unused · `lint:dead` 0/0.
**A latent bug in the harness runner surfaced and is fixed:** `scripts/check-store.sh` appends `.js` to
the compiled core's import specifiers with `perl`, and its pattern was `from '(\./[A-Za-z._-]+)'` — a
literal `./` followed by a class *without* `/`. It had therefore only ever handled `./x`, so as soon as
the core gained a subdirectory (`core/seed/*`, whose files import `../models`) the harnesses could not
load at all. The pattern is now `from '(\.[^']+)'` and the fix-up **recurses** (`find`), so `./x`, `../x`
and nested paths all work. Worth knowing before the next extraction.
**How it was done:** mechanically, by a throwaway script — cut each span by brace matching, de-indent the
member bodies, rewrite `private seedX` → `export function seedX`, and generate each module's imports from
the store's own import map. 846 lines by hand would have been 846 chances to typo a fixture row; the
compiler and the snapshot diff then policed the result, which is why the three mistakes the generator
made (a missing `m` flag, the store's `pad3` left unexported, `ASSET_FIELD_DEFAULTS` not identified as
shared) cost minutes instead of a corrupted fixture.

### P7 — Routing & bundle shape · `HIGH` · status: **done (2026-09-12) — every feature page is now its own chunk**
**Done:** `app.routes.ts` keeps **two** pages eager — the dashboard (the landing page a fresh load
renders, so a chunk round-trip buys nothing) and the Administration shell (the frame its children move
inside) — and loads everything else with `loadComponent`: 13 feature pages plus 3 admin children.
`canActivate` still resolves **before** the chunk is fetched, so a licence the workspace does not hold
refuses the navigation without downloading the page; the module gating is otherwise unchanged.

**Measured effect:**

| | before | after |
|---|---|---|
| Initial total | **830.24 kB** | **478.22 kB** (−352 kB, −42%) |
| Initial transfer | 185.76 kB | 127.61 kB |
| `main-*.js` | 740,666 B | 113,929 B |
| JS files emitted | 2 | 29 (one shared 230 kB chunk + per-route chunks) |
| Build warning | budget 500 kB **exceeded by 330 kB** | **none** |

**Pre-flight (this is a behaviour change):** no harness reads `app.routes.ts` or a feature component
(grepped over `scripts/runtime-checks/`), and no feature imports another feature's component — so the
lazy boundaries are clean and nothing that used to be in the initial bundle is needed *before*
navigation.
**The risks recorded when this was gated, and where they stand:** a first-navigation chunk fetch (the
price of the 352 kB, paid per page), chunk 404s after a stale deploy (the hashed filenames are the
guard; the deployment shape is unchanged), and the shell's `viewFromUrl()`/search activation running
before a lazy component exists (it is URL-based at `NavigationStart`, so it never needed the component —
unchanged). `angular.json`'s 500 kB budget is untouched: it is now a *meaningful* number again
(478 kB against 500 kB) rather than a warning everyone had agreed to ignore.
**Docs updated to match:** README's roadmap item is ticked with the numbers, HANDOFF's budget paragraph
quotes 478 kB, and its route-map line states the eager/lazy split and the guard-before-fetch contract.
**Verified:** build `complete` with **0 warnings**; `lint:ctor` OK; `lint:styles` `0 class(es)` + the 3
disclosed pairs; `lint:dead` 0/0; `check:store` **202 ok / 0 FAIL** (the store is untouched by this
phase, which is exactly what that harness proves).
**Not verified (honestly):** the runtime behaviour of the chunks themselves — there is no browser here.
What can be checked without one is checked above: the map type-checks, the payload is measured, and the
guard-before-fetch ordering is Angular's own contract for `canActivate` + `loadComponent`.

### P8 — Change-detection feasibility study · `HIGH` · status: **done (2026-09-12) — study + a bounded pilot, not applied; the reason is in the last paragraph**
**Measured first — which templates read store/services *inline*?** Of the 25 component templates, **7
read nothing from an injected service**; the other 18 read it directly and heavily (purchasing 20
references, invoicing 14, scheduler 12, orders/app/handoff 10–11, dashboard 10). The 7 break down as:

| Component | service reads in template | `@Input`s |
|---|---|---|
| `admin` | 0 | 0 |
| `feature-modules` | 0 | 0 |
| `logistics` | 0 | 0 |
| `field-editor` | 0 | **1** (`fields`) |
| `record-view` | 0 | **2** (`view`, `editable`) |
| `evidence` | 0 | **3** (`scope`, `refId`, `readOnly`) |
| `dynamic-form` | 0 | **4** (`schema`, `values`, `errors`, `readOnly`) |

(For the three with 0 inputs and 0 inline reads — `admin`, `feature-modules`, `logistics` — the template
calls *component methods* that read the store, so the zero is a measurement artefact, not freedom from
the store. Only the four widgets are genuinely input-driven.)

**The mechanism, stated precisely, because it decides the answer:** an `OnPush` component is re-checked
when one of *its* inputs changes by reference, when an event fires *inside* it, or when it is explicitly
marked. This app's store is a **mutable singleton** and components read it straight from templates, so an
`OnPush` page would stop updating the moment a *sibling* or a service mutates the store — the receiving
desk posting a receipt, a count session being closed, the telemetry loop appending an alert, the shell's
user switch. Nothing about that is hypothetical: `scheduler` and `timesheet` already inject
`ChangeDetectorRef` and call `detectChanges()` **6 times between them**, precisely because their DOM
mutations happen in `window` listeners that Angular's zone does not associate with a component.
**Therefore: no sweep.** OnPush across 18 store-reading pages would be a behaviour change whose failure
mode — a view that silently stops refreshing — is invisible to every gate this project has.

**The bounded pilot, if you want one:** `field-editor`. It is the smallest safe surface: exactly one
input, no store reads at all, the parent hands it a **fresh array** every time the modal opens
(`openAddCategory`/`openEditCategory` copy with `copyFields`), and every mutation of that array *after*
that is the child's own (`add`/`remove`/`move`/`ngModel`), which re-renders under `OnPush` anyway
because the event originates inside it. The change is one line in the decorator
(`changeDetection: ChangeDetectionStrategy.OnPush`). **Applied (P8 pilot, and only this one):** `field-editor` now carries
`changeDetection: ChangeDetectionStrategy.OnPush` — the app's **only** `OnPush` component, with that
comment sitting in the decorator so nobody copies it into a store-reading page by accident. It is the
smallest provably-safe surface: one input, no store reads, a fresh array per modal open, and every later
mutation child-originated.
**How to confirm it in two minutes (the part no gate here can do):** open Admin → Business type &
Categories → edit a category and, in the Fields grid, **add** a row, **type** a key/label, change the
**kind** (which swaps the last column between unit / choices), **move** it up and down, **remove** one,
and watch the Save button enable/disable as keys become valid (that is the parent re-rendering, which
`OnPush` on the child must not block). Then Save and reopen. If every one of those updates the grid, the
pilot holds; if the grid ever looks stale, revert this one line and the study's conclusion stands
unchanged.
**The other three widgets are *not* safe to pilot blind**, and the reason is checkable but tedious: it
depends on whether any parent mutates the object it passes *in place* and then expects the child to
notice. `dynamic-form`'s `values` is the risk case — parents that programmatically fill `attributes`
(e.g. after picking a PO line on the receiving desk) rely on that. That audit is a half-day per call
site, and a wrong answer is another invisible stale view.
**The direction that actually fixes this** is the one the log named before: signals in the store. Once
store reads are signals, `OnPush` (or `Zoneless`) becomes safe and this whole question disappears; that
is a project, not a phase, and it is not proposed here.

### P9 — The component/template test gap · `HIGH` · status: **done (2026-09-12) — one real harness added, plus the finding about the box**
**What the gap actually is:** the 24 harnesses that existed cover the **store** — tables, mutators,
guards, the fixture, the data-model document. They never covered the small **pure helpers every page
prints through**, and with no Chrome on this dev box Karma cannot run, so template rendering cannot be
checked at all. Of those two halves, the first is fixable today; the second is not.
**Added `check25.mjs`** (7 checks, registered in `scripts/check-store.sh`) for the helpers that had *no*
coverage: `statusClass` (every status badge) with its fallback; `needsReorder` (the dashboard's reorder
list) including its boundary and its `qty` fallback for unit rows; the four type predicates, with the
invariants that a counted type is always level-tracked and never a unit row; `behaviourOfType` /
`typeForBehaviour` as a round trip over every catalog type; `verticalLabel` / `roleLabel` including the
unknown-key fallback; `periodPhrase` (day/week/month); and `DataService.fmtDate`. `check:store` is now
**209 checks in 25 harnesses**, 0 failures.
**Writing it pinned two contract facts:** `periodPhrase`/`periodLabel` format the date they are *given* —
the Monday-anchoring is the pager's job (every pager keeps the cursor on the period's first day), so a
mid-week date yields a mid-week label; and the period helpers live in `period.ts` (the store re-exports
them), which my first version imported from the wrong module — caught by the harness on its first run,
which is the most direct demonstration that a check earns its keep.
**What is still not testable here, and the honest options:** template rendering, `OnPush` staleness, drag
interactions, anything needing layout. Without a browser Karma is a no-op, so the credible options are
(a) install a browser (or `karma-chrome-launcher` + headless Chromium) and revive Karma — the real fix;
(b) a headless runner such as Playwright driving the built app through a handful of smoke flows, which
would *also* give the P5b restructure and the P8 pilot the visual verification neither can have now; or
(c) keep extending the harness pattern wherever logic can be lifted out of components as pure functions
— exactly what P6's `scheduler-view.ts` proposal would make possible, which is why those two phases
point at each other.
**Recommendation:** (b) if a dev dependency is acceptable — it buys visual verification for the CSS and
OnPush questions too; (c) if not. Both recorded, neither started: adding a browser dependency is a
project decision, not a refactor step.
**Option (b), done — the user chose it:** `playwright` + `@playwright/test` are dev dependencies and
`npm run e2e` (`scripts/e2e-smoke.mjs`, with `scripts/serve-dist.mjs` serving the build and falling back
to `index.html` for deep links, no other dependency) drives the **built** app in headless Chromium:

- **every route renders**: `/`, `/assets`, `/inspections`, `/purchasing`, `/scheduler`,
  `/admin/verticals` — each asserted by its own title text with a clean console. Because all six are
  lazy `loadComponent` pages, this is also the first *empirical* check of P7's chunk boundaries: a broken
  one shows up here as a blank page or a chunk error instead of a silent regression.
- **the P8 pilot, through the real UI**: it opens the category editor from the categories card (the modal
  title is asserted, so a wrong modal fails loudly), adds a field, types a key and label, moves the row,
  removes it, and checks that the **Save button** flips — which is the *parent* re-rendering from a child
  event, the thing a wrong `OnPush` breaks. So the pilot is now verified, not argued.
- **screenshots** of each page land in `dist/e2e/` — the baseline P5b would diff against.
**Two failures on the way, both the test's own (recorded because they are the usual traps):** the grid's
empty state renders a placeholder `<tr>`, so counting rows cannot detect an add (count key inputs
instead); and Angular updates the DOM a *microtask after* the click Playwright dispatches, so a bare
`count()` reads the old DOM — every DOM assertion now settles through a retry helper. The app was right
both times; that is exactly the kind of thing this check exists to make visible.
**Verified:** `check:store` **209 ok / 0 FAIL**; README, HANDOFF, PLAN.md, PLAN-B.md, this log's recipe
and its baseline row all updated to the new count. The log's per-phase entries keep the numbers they
were written with, because those record what the gates read *then*.

---

## 4. Guardrails (no step happens without a written go-ahead where noted)

1. **No behaviour changes.** Wording, ordering, defaults, guards and validations stay as they are even
   where they look odd — prototype parity *is* the spec.
2. **No formatter / `ng lint` adoption mid-sequence** (P3 says why). If wanted, it is ⛔ and it goes last.
3. **No `OnPush` sweep, no store split, no lazy-route conversion** without a ⛔ approval in Section 6.
4. **No deletion of an export that `docs/DATA-MODEL.md` or a harness names.**
5. **The gates are read-only.** If a change makes `lint:ctor` / `lint:styles` / `check:store` fail, the
   change is wrong until proven otherwise — never edit the checker to fit the code.
6. **One phase in flight at a time**, and the log is updated *before* the code.

---

## 5. Verification recipe (run after **every** iteration)

```bash
npm run build        # expect: "Application bundle generation complete."  (+ the known 500 kB budget warning)
npm run lint:ctor    # expect: "✓ field-initializer order OK (8 method-based initializer(s) inspected)."
npm run lint:styles  # expect: "0 class(es) no template mentions", then "3 declaration(s) re-set"
                     #         (the grouped rules P5c must not touch — see P2c)
npm run lint:dead    # expect: "0 imported name(s)…", "0 export(s)…"
npm run check:store  # expect: 25 harnesses, 210 "ok  " lines, 0 FAIL
```

One-liner used to compare a phase against the baseline:

```bash
npm run build 2>&1 | grep -E 'ERROR|complete' ; npm run lint:ctor 2>&1 | tail -1 ; \
npm run lint:styles 2>&1 | tail -2 ; npm run lint:dead 2>&1 | grep -cE '^0 ' ; \
npm run check:store 2>&1 | grep -cE '^  ok' ; npm run check:store 2>&1 | grep -c FAIL
```

**Baseline values to match:** `complete` · `✓ field-initializer order OK (8 …)` ·
`0 class(es) no template mentions` · **2** (`lint:dead`'s two "0 …" lines) · **210** · **0**.

A phase is not finished until those five numbers/strings are unchanged (or *better*, e.g. more checks
because the phase added coverage — which must be stated in the log).

**For a `styles.scss` change specifically**, prove it neutral rather than eyeballing it:

```bash
npm run build && cp dist/ims-web/browser/styles-*.css /tmp/before.css   # before the edit
# …edit…
npm run build
node scripts/css-equivalence.js /tmp/before.css dist/ims-web/browser/styles-*.css
```

It prints every selector whose winning value for a property changed, and exits 1 if any did. The only
acceptable output for a "dead declaration" change is that changed declaration and nothing else.

---

## 6. Iteration history (append-only)

`status` — `queued` → `in progress` → `done` / `reverted` / `⛔ blocked (awaiting approval)`

| # | Date | Phase | Action | Risk | Result |
|---|---|---|---|---|---|
| 0 | 2026-09-12 | **Baseline** | Read-only survey of the whole tree: file/LOC/import/selector/subscription/`any`/budget counts, gate run, and the doc-drift check. No source changed | — | Gates green at `17c35c3`: build `complete`, `lint:ctor` OK, `lint:styles` 0 unused, `check:store` **202 ok / 0 FAIL**. Assessment + phase list written (Sections 1–5) |
| 1 | 2026-09-12 | **P1** — Documentation truth pass | README structure/gates/roadmap; HANDOFF path + counts + bundle + Categories row + document list; PLAN.md headline + a `check14`–`check24` block with measured counts; PLAN-B.md principle line | `LOW` | **done** — 30 named paths verified to exist, 0 stale references left, gates green at **202 ok / 0 FAIL** (docs only, no `src/` change) |
| 2 | 2026-09-12 | **P2** — Dead code sweep | 6 unused imports removed; export + orphan sweep over the whole tree; 10 dead exports deleted | `LOW` | **done** — **33 deletions / 0 insertions** in 4 files, 0 orphans in 96 files, gates green at **202 ok / 0 FAIL** |
| 2b | 2026-09-12 | **P2b** — Dead-code audit as a gate | `scripts/audit-exports.js` + `npm run lint:dead` (report-only; imports, dead exports, file-local API counted separately) | `LOW` | **done** — 46 files / 230 exports → **0** unused imports, **0** dead exports, 24 file-local kept; gates green at **202 ok / 0 FAIL** |
| 2c | 2026-09-12 | **P2c** — `lint:styles` detector defect | Proved (A/B) that the re-set detector only saw each rule's first declaration (printed `0`, truth `15`); rewrote the prop extraction to read declarations at their boundaries, importance-aware, and documented the per-selector/grouped-rule caveat | `LOW` | **done** — the gate now prints `3 declaration(s) re-set` (the grouped pairs it must keep reporting); dead-class line still 0; gates green at **202 ok / 0 FAIL** |
| 3 | 2026-09-12 | **P3** — Naming & formatting | `ims-admin-verticals` → `ims-verticals`; the two `.editorconfig` whitespace violations in `styles.scss`; naming audit over all 99 files | `LOW` | **done** — 2 lines changed in `styles.scss` + 1 selector, 0 non-kebab files / 0 non-PascalCase classes, gates green at **202 ok / 0 FAIL** |
| 4 | 2026-09-12 | **P4** — Lifecycle & RxJS hygiene | Shell router subscriptions given `takeUntilDestroyed`; every listener/observer site audited; telemetry + scheduler "leaks" disproved by reading | `LOW` | **done** — 12 insertions / 6 deletions in `app.component.ts`, 0 real leaks, gates green at **202 ok / 0 FAIL**; Timesheet mid-drag gap recorded as **P4b** (not fixed) |
| 4b | 2026-09-12 | **P4b** — Timesheet drag handlers | Drag listeners bound as fields, `endDrag()`/`detachDrag()`, `ngOnDestroy` detaches (Scheduler's tracked-handler pattern) | `LOW` | **done** — 36 insertions / 15 deletions in `timesheet.component.ts`, gates green at **202 ok / 0 FAIL**; Scheduler *resize* gap recorded as **P4c** (not fixed) |
| 4c | 2026-09-12 | **P4c** — Scheduler resize handlers | Same shape as its whole-block drag: `onResizePointer`/`endResizePointer` + `detachResize()` that removes them and clears state | `LOW` | **done** — 17 insertions / 5 deletions in `scheduler.component.ts`, gates green at **202 ok / 0 FAIL** |
| 5 | 2026-09-12 | **P5** — Stylesheet consolidation | All 26 sheets (828 rules) run through 4 mechanical detectors; layer structure of `styles.scss` mapped; one comment added at the token footgun | `MED` | **done, 0 removals** — nothing is provably removable (0 unused / 0 duplicate rules / 0 duplicate declarations / 0 superseded rules); 4 insertions / 1 deletion, CSS bundle hash **byte-identical**, gates green at **202 ok / 0 FAIL**. Deeper work recorded as **P5b** (restructure, ⛔) |
| 5b | 2026-09-12 | **P5b** — Restructure, measured | Measured every provable restructure (all 0) + unread custom properties (13); deleted the 2 stale ones with their false comment; added `scripts/css-equivalence.js` + `npm run css:equiv` | `MED` | **done → closed by decision** — equivalence check: 619 selectors both sides, **only** the 2 deleted declarations differ; 11 unread scale/palette tokens reported and kept; the reorder restructure is rejected with the evidence and a ready two-command recipe (P9's `npm run e2e` provides the screenshot half) |
| 5c | 2026-09-12 | **P5c** — the dead declarations the gate hid | 12 declarations deleted from `styles.scss` (each re-set for *every* selector of its rule); the 3 grouped ones kept | `LOW/MED` | **done** — compiled-CSS winning-value maps **identical** (`diff` = 0 of 619 selectors / 2185 declarations); CSS hash `2638d90c…` → `3723d96e…` (text only); gates green at **202 ok / 0 FAIL** |
| 6 | 2026-09-12 | **P6** — Store & component decomposition study | Measured 32 store sections (lines/methods/outbound/inbound/external call sites) + the Scheduler's 105 methods; wrote the ordered proposal | `HIGH` | **done (proposal)** — 1,595 external call sites define the facade; 2 extractions are provable (`format` → module, seeds → `core/seed/`, already scoped in PLAN-B); everything else is spine work with no correctness payoff; component extraction filed for P9 |
| 6a | 2026-09-12 | **P6a** — Extract `format` → `core/format.ts` | The store's only 0-inbound section moved to a module; six one-line delegates keep 187 call sites working; `check25` extended to drive the module and assert the delegates agree | `LOW` | **done** — store diff: 6 bodies → 6 delegates; `check:store` **210 ok / 0 FAIL**; docs + counts updated |
| 6/2 | 2026-09-12 | **P6/2** — Seeds → `core/seed/` | 24 pure data factories into 5 modules + the 8 shared fixture facts + `pad3` → `format.ts`; the 6 store-coupled seeders stay; generated mechanically and policed by a snapshot diff | `LOW/MED` | **done** — store **5,179 → 4,333** lines, `core/seed/` 915; **whole seeded store byte-identical** (92,351 B, `cmp` clean); check:store 210/0; also fixed a latent `check-store.sh` import-rewrite bug that broke on nested paths |
| 7 | 2026-09-12 | **P7** — Routing & bundle shape | 13 feature pages + 3 admin children → `loadComponent`; dashboard and admin shell stay eager; README/HANDOFF budget + route docs updated | `HIGH` | **done** — initial **830 → 478 kB** (−42%), `main` 740 → 114 kB, build warning gone, 0 pre-flight blockers (no harness reads routes, no cross-feature imports); gates green at **202 ok / 0 FAIL** |
| 8 | 2026-09-12 | **P8** — Change-detection study + pilot | Measured which templates read the store inline (18 do, up to 20 refs; 4 widgets do not); documented the mutable-singleton mechanism; applied the identified pilot — `OnPush` on `field-editor` only | `HIGH` | **done** — no sweep (a stale view is invisible to every gate here); the one pilot is in with a two-minute confirmation checklist recorded; gates green at **210 ok / 0 FAIL** |
| 9b | 2026-09-12 | **P9b** — The harness reaches a component | Probed and proved that the Scheduler class instantiates in Node (JIT compiler loaded, `ChangeDetectorRef`/`ConfirmService` stubbed); runner now compiles with `--rootDir src/app` + flattens core; `check26.mjs` (5 checks) over its view math | `MED` | **done** — `check:store` **215 ok / 0 FAIL in 26 harnesses**; five of my draft assertions failed and all five were the assertion's fault (recorded); this is the net P6's component extraction was waiting for |
| 6/3 | 2026-09-12 | **P6/3** — Component half, slice 1: calendar & capacity math | `scheduler-view.ts` (196 lines) of pure functions + the view-model types; component **1,591 → 1,506 lines** delegating through same-named methods (template and ~100 call sites untouched) | `MED` | **done** — before/after dump of every derived value **byte-identical (42,584 B, `cmp`)**; check26 5 → **9 checks** driving the module directly; build/lints clean; **219 ok / 0 FAIL**; e2e green. P6/4 (the geometry layer: `models`/`conflicts` + `geom*`/`*T0`/`*T1`) has its dependency list and proof method ready |
| 6/4 | 2026-09-12 | **P6/4** — Component half, slice 2: the geometry layer | `lineQty`/`qtySuffix`, `*T0`/`*T1`, `dateIncludes`, `geomMin`/`fmtMin`/`geom`, `lineDays`, `typeRank`, `itemName`, `shortItemLabel`, `sortedLines`, `isConflicted`, `conflictDetail`, `models`, `conflictCount`, `conflicts` → module (450 lines); component **1,506 → 1,388 lines** | `MED` | **done** — **P6 complete.** Functions take a six-read `ScheduleReader` instead of `DataService`, so the capacity rule is testable off a stub store; before/after dump **byte-identical (74,014 B, `cmp`)** on the first run; check26 9 → **14 checks**; **224 ok / 0 FAIL**; build/lints/e2e green |
| 10 | 2026-09-12 | **P10** — The gestures, the writes and the tooltips | `check27.mjs` (12 checks): drag-to-book, the multi-unit prompt, the retired refusal, whole-order drag + carried bookings, the 3px click-vs-drag threshold, edge resize clamping, Day-view 15-minute snapping; the 8 tip builders and the `stamp*` helpers | `MED` | **done** — no production change. The gesture code needs only `window` listeners and `getBoundingClientRect` stubbed, so the real handlers run against the real store and their writes are asserted; **236 ok / 0 FAIL in 27 harnesses**; e2e unchanged |
| 11 | 2026-09-12 | **P11** — The modal editors | `check28.mjs` (10 checks): the New Order and New Resource editors — seeding, the dirty guard, refusal on a blank name / unknown customer, trimming, number coercion and fallbacks, `hmMin` times, focus-after-save, the inactive-order path, category-row derivation, per-type fields, and the opening-count rule | `MED` | **done** — no production change. **246 ok / 0 FAIL in 28 harnesses**; two of my assertions were wrong and reading `createItem`/`openStock` made them better than what I had imagined; every surface the log called uncovered is now covered except the drag *paint* |

### Findings ledger (evidence for the phases above)

| Finding | Measured | Phase that clears it |
|---|---|---|
| Unused named imports | 6 (`DocumentKind`, `PartyKind`, `PurchaseOrderStatus`, `WorkOrderPart`, `countWeekdays` in `data.service.ts`; `InspectionSeverity` in `inspections.component.ts`) | P2 ✔ |
| Dead exports | 10: nine `X: X[] = [...]` arrays restating their own union, and `tip-builders.ts`'s `dayTip()` (no caller; its six siblings all called) | P2 ✔ |
| File-local API types | 11 exports used only inside their own file (`MovementInput`, `GeoAlert`, `ViewGroup`, `ConfirmRequest`, …) | P2 — kept deliberately, not dead |
| Orphan files | 0 of 96 (every component/service/directive is named elsewhere) | P2 ✔ |
| Stale doc references | `README.md`: `features/categories/`, `features/items/`; `HANDOFF.md`: old checkout path, "140 checks", "~738 kB", Categories feature row | P1 |
| Selector mismatch | `ims-admin-verticals` on `VerticalsComponent` | P3 ✔ (renamed; nothing referenced it) |
| Whitespace drift | 2 `.editorconfig` violations in `src` (both `styles.scss`) | P3 ✔ |
| Naming conventions | 99 files: 0 non-kebab basenames, 0 non-PascalCase exported classes, 0 CRLF/tabs/missing final newlines | P3 ✔ (already clean) |
| Possible lifecycle leaks | `telemetry.service.ts:66/71` (`setInterval`), `scheduler.component.ts:1512` (deferred global listener removal) | P4 ✔ — both disproved: the sim is started/stopped by the shell, the listener self-removes within 400 ms |
| Timesheet mid-drag listeners | `timesheet.component.ts:519-532` — `ngOnDestroy` nulled `drag` but left a live drag's `mousemove`/`mouseup` on `window` | **P4b ✔** — listeners are named fields now and `detachDrag()` runs on both exits |
| Scheduler mid-resize listeners | `scheduler.component.ts:1336-1339` + `detachResize()` at 1395 — same shape as P4b: closures self-remove on `pointerup`, `detachResize()` only clears state | **P4c** (optional, needs go-ahead: the same five lines) |
| Telemetry sim vs module flag | The shell starts the sim on `ngOnInit` if the module is enabled; disabling the module later leaves it ticking until reload | P4 — observed, deliberately unchanged (behaviour) |
| Eager routes | 0 `loadComponent` of 16 features; initial bundle ~830 kB vs 500 kB warn budget | P7 |
| No `OnPush` | 0 of 27 components | P8 |
| No unit tests | 0 `*.spec.ts` | P9 |
| Global stylesheet concentration | 2,477 of 8,927 SCSS lines in one file; `lint:styles` reports 0 unused class names, so the debt is overlap, not dead rules | P5 ✔ — measured: 828 rules, **0** duplicates/protected-dead rules anywhere. The length is the layered design, not waste |
| Token footgun | `styles.scss`'s ":root … Source of truth for tokens" restated `--sidebar-bg`, `--sidebar-bg-2`, `--sidebar-ink`, which the refresh `:root` (line 2127) overrides — 3 of its 50 tokens are dead values | P5 ✔ — comment added where the temptation is (comment-only; CSS hash unchanged) |
| `!important` inventory | 4 sites (`styles.scss:1370`, `1436`, `1945`, `admin.component.scss:72`); the Bootstrap *library* is not loaded, so each fights a higher-specificity rule in these same files | P5 — documented, untouched (each is a cascade change) |
| Cross-boundary style overlap | **50** class names defined in both the global sheet (326 classes) and a component sheet; `scheduler.component.scss` accounts for 27 | P5 — documented as **not** safely collapsible (encapsulation rewrites the component copy to out-specify the global one) |
| Dead-code gate | `npm run lint:dead` (46 files, 230 exports → 0 unused imports, 0 dead exports, 24 file-local API kept) plus README/HANDOFF/recipe updated | P2b ✔ |
| `lint:styles` "re-set" detector | Printed `0 declaration(s) re-set`; the true count was **15** across 9 selectors. Root cause proved A/B: the parser only saw a rule's *first* declaration; `!important` ignored too | **P2c ✔** — fixed (boundary-read, importance-aware); now prints 3 |
| 15 dead declarations in `styles.scss` | Each with its killer line, incl. the three `--sidebar-*` tokens and `.sidebar`'s translucent glass `background` | **P5c ✔** — 12 deleted (map-verified identical), 3 kept: grouped rules where the property is live for sibling selectors |
| Unread custom properties | 13 declared but never read in `src/`; 2 (`--teal-soft`, `--pink-soft`) stale leftovers with a false comment, 11 scale/palette steps | **P5b ✔** — 2 deleted + comment removed; 11 kept on purpose and listed |
| Stylesheet changes without a browser | No way to prove a `styles.scss` edit neutral | **P5b ✔** — `scripts/css-equivalence.js` (`npm run css:equiv`) diffs the winning value per selector between two builds |
| No unit tests | 0 `*.spec.ts` | **P9 ✔** — 32 harnesses (**286 checks**) now cover the store *and* the Scheduler's derived view/geometry math (P9b made the component instantiable in Node; P6/3–P6/4 extracted the math), and `npm run e2e` renders the built app headless (6 lazy routes, clean console, the field-editor grid, the grouped reports, the sample-data buttons over all 19 routes on an emptied workspace, screenshots) |
| No `OnPush` | 0 of 27 components | **P8 ✔** — 18 templates read the mutable store inline, so no sweep; the one pilot (`field-editor`) is applied and needs a two-minute browser confirmation; the real fix is signals in the store |
| Eager routes | 0 `loadComponent`; initial bundle ~830 kB vs 500 kB warn budget | **P7 ✔** — every feature page is its own chunk: 478 kB, warning gone |
| Store & component size | `data.service.ts` was 5,185 lines / 353 methods / 1,595 external call sites; `scheduler.component.ts` 1,591 lines / 105 methods | **P6 ✔** measured → **P6a/P6/2 ✔ done**: `format` → `core/format.ts` and the fixture → `core/seed/`; the store is now **4,333** lines with 915 in `core/seed/`. Component extraction still filed for P9. |
| Harness runner import rewrite | `check-store.sh` only ever appended `.js` to `./x` specifiers (pattern `(\./[A-Za-z._-]+)`), so a nested core directory broke the whole suite | **P6/2 ✔** — pattern is now `(\.[^']+)` and the fix-up recurses over `find` |
| The `format` section | 6 pure methods, 0 inbound cross-section calls, 187 call sites outside the store | **P6a ✔** — moved to `core/format.ts` behind six delegates; check25 (8 checks) drives the module and pins the delegate agreement |
| Restructure (overrides into one layer) | Reordering rules *between* selectors can flip an equal-specificity winner for one element — invisible to a per-selector map | **⛔ needs a DOM** (browser or per-page screenshot diff); documented, not attempted |
| Per-harness count drift | `docs/PLAN.md` documented `check8.mjs` as 9 checks; measured **10** `ok` lines (the only per-harness figure that disagrees today — all others match) | open — left for the next doc touch rather than broadening P1 |
| Harness subjects undocumented | `check14`–`check24` (Phase B/C, 61 checks) had no entry in the verification recipe at all | P1 ✔ (block appended with measured counts) |

### Approvals / decisions

| Date | Decision | Basis |
|---|---|---|
| 2026-09-12 | Log opened; **P1–P5 proposed as the low-risk sequence**, P6–P9 parked as ⛔ | This document |
| 2026-09-12 | User approved executing **P1–P4 as one batch, one commit per phase, pausing for review before P5** | chat |
| 2026-09-12 | User approved **P4b** (Timesheet drag handlers) and **pushing the batch to `origin`** | chat |
| 2026-09-12 | User approved **pushing P5**, then **P2b** (dead-code audit gate) + **P4c** (Scheduler resize). P2c (the `lint:styles` fix) and P5c (the 15 declarations) are reported but **not** started | chat |
| 2026-09-12 | User approved **P2c** (fix the detector) and **P5c** (delete the dead declarations), verified against the compiled CSS's winning values | chat |
| 2026-09-12 | User approved continuing through **P5b, P6, P7, P8, P9** | chat |
| 2026-09-13 | User asked for the two calendar printouts to be **grouped reports** — the timesheet by employee (then order), the schedule by order (then asset) — each carrying a total for its **primary** (Phase G) | chat |
| 2026-09-13 | User asked for **two workspace-wide buttons** — load all the sample data, and remove *all* of it (the existing "Start clean" keeps partners/locations/settings, so it does not count) (Phase H) | chat |



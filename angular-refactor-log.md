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
| Verification culture | `npm run check:store` = 24 Node harnesses = **202 checks**; plus 2 hand-rolled audits and the build | `scripts/`, `package.json` |
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

### P5c — see the audit cluster above (next to P2c)

The 12 dead declarations P5 left behind, the 3 grouped ones that must stay, and the compiled-CSS
verification are recorded under **P5c** above, beside **P2c** — the detector bug that hid them — because
those two entries are one finding.

### P6 — Store & component decomposition study · `HIGH` · ⛔ **approval required**
**Scope:** `core/data.service.ts` (5,190), `core/models.ts` (1,457), `scheduler.component.ts` (1,578 +
676 template).
**Do:** not a split — a *proposal*. Use the store's own section comments to list the cohesive
sub-domains, mark which have no cross-talk, and state the harness parity proof each extraction would
need. Then propose an order, one domain per iteration, each proven by a full `check:store` run.
**Why gated:** 24 harnesses and `DATA-MODEL.md` treat `DataService` as the schema's facade; moving it
moves the spine of the app. The payoff is readability, not correctness.

### P7 — Routing & bundle shape · `HIGH` · ⛔ **approval required**
**Scope:** `app.routes.ts` (16 eager features), `angular.json` budgets.
**Do:** convert module-gated features to `loadComponent`, measure initial bundle before/after, and
re-baseline the budgets to the truth (or keep the warning as the honest signal it is).
**State before starting:** first-navigation delay, chunk 404s after a stale deploy, and the shell's
`viewFromUrl()`/search activation running before a lazy component exists. README's roadmap already
asks for this — it is still a behaviour change, hence ⛔.

### P8 — Change-detection feasibility study · `HIGH` · ⛔ **approval required**
**Scope:** all 27 components (0 `OnPush` today).
**Do:** assess, and probably **recommend against a sweep**: with a mutable singleton store and
zone-based CD, an `OnPush` component whose template reads store state mutated by a sibling or a service
(the receiving desk, count sessions, the live timeline) would simply stop updating unless every
mutation arrives via an input or an event. The credible options are (a) `OnPush` only for leaf/shared
widgets driven purely by inputs — `record-view`, `dynamic-form`, `field-editor`, `evidence`, `confirm`
— or (b) adopt signals in the store first. Write the finding, propose (a) as a bounded pilot, stop.

### P9 — Component/template test gap · `HIGH` · ⛔ **approval required**
**Scope:** the 0-spec Karma setup.
**Do:** propose the smallest useful investment — a handful of specs for the shared widgets, or extend
the Node harness pattern with a template-render check — and record that today's real safety net is
build-time type-checking plus the store harnesses.

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
npm run check:store  # expect: 24 harnesses, 202 "ok  " lines, 0 FAIL
```

One-liner used to compare a phase against the baseline:

```bash
npm run build 2>&1 | grep -E 'ERROR|complete' ; npm run lint:ctor 2>&1 | tail -1 ; \
npm run lint:styles 2>&1 | tail -2 ; npm run lint:dead 2>&1 | grep -cE '^0 ' ; \
npm run check:store 2>&1 | grep -cE '^  ok' ; npm run check:store 2>&1 | grep -c FAIL
```

**Baseline values to match:** `complete` · `✓ field-initializer order OK (8 …)` ·
`0 class(es) no template mentions` · **2** (`lint:dead`'s two "0 …" lines) · **202** · **0**.

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
| 5b | 2026-09-12 | **P5b** — Restructure, measured | Measured every provable restructure (all 0) + unread custom properties (13); deleted the 2 stale ones with their false comment; added `scripts/css-equivalence.js` + `npm run css:equiv` | `MED` | **done** — equivalence check: 619 selectors both sides, **only** the 2 deleted declarations differ; 11 unread scale/palette tokens reported and kept; the reorder restructure shown unprovable without a browser |
| 5c | 2026-09-12 | **P5c** — the dead declarations the gate hid | 12 declarations deleted from `styles.scss` (each re-set for *every* selector of its rule); the 3 grouped ones kept | `LOW/MED` | **done** — compiled-CSS winning-value maps **identical** (`diff` = 0 of 619 selectors / 2185 declarations); CSS hash `2638d90c…` → `3723d96e…` (text only); gates green at **202 ok / 0 FAIL** |
| 6 | 2026-09-12 | **P6** — Store decomposition study | | `HIGH` | ⛔ awaiting approval |
| 7 | 2026-09-12 | **P7** — Routing & bundle shape | | `HIGH` | ⛔ awaiting approval |
| 8 | 2026-09-12 | **P8** — Change-detection study | | `HIGH` | ⛔ awaiting approval |
| 9 | 2026-09-12 | **P9** — Component/template tests | | `HIGH` | ⛔ awaiting approval |

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



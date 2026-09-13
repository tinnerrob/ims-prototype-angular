# IMS Angular Port — Cleanup, Memory & Consolidation Review

**Date:** 2026-09-13 · **Repo:** `tinnerrob/ims-prototype-angular` (`main`)
**Scope:** a hygiene pass over the existing port — dead code, duplication, resource
handling, and type/safety nits. **No new features, no behavior changes, no store
changes.** The `DataService` seam stays untouched.
**Convention:** follows `angular-refactor-log.md` / `docs/CODE-REVIEW.md` — Analyze →
Document → Execute → Verify, the smallest diff that resolves each finding, gate suite
green at the end.

---

## 0. How this was audited

The codebase has been through many deliberate passes, so this review is **additive**.
Everything below is evidence-backed, not impressionistic:

| Probe | Result |
|---|---|
| `grep -rnw any / as any / @ts-ignore` over `src` | **0** real hits (only the word "any" in prose comments) |
| `grep -rniE 'apikey\|secret\|password\|bearer\|credential'` over `src public scripts docs` | **0** hits (the only matches are "tokens" in the CSS design-token sense) |
| `grep -rn 'addEventListener' src` vs `removeEventListener` | every window listener is bound once as a class field and taken off by name |
| `grep -rn 'setInterval\|setTimeout' src` | timer owned by `TelemetryService`, cleared in `stop()`; scheduler drag + click timers cleared in `ngOnDestroy` |
| `npm run lint:dead` | 2 dead imports, 1 dead export |
| `npm run lint:ctor` | OK |
| `npm run lint:styles` / `lint:contrast` | clean (pre-existing layering only) |
| `npm run check:store` | 32 harnesses green (baseline) |

**No memory leaks were found.** `TablePagerDirective` disconnects its `MutationObserver`
and removes the footer it built; `TipDirective.ngOnDestroy` closes the tip it opened; the
scheduler/timesheet drags detach their window listeners on both the normal and the
interrupted path (`ngOnDestroy`); `TelemetryService.stop()` clears its interval and
`AppComponent.ngOnDestroy` calls it. This is reported rather than "fixed" because there is
nothing to fix — the one improvement worth making is item 5 below.
---

## 1. Findings

| # | Finding | Where | Evidence | Phase |
|---|---|---|---|---|
| 1 | **Dead code:** two imports the file never uses again, and one exported helper nothing references. | `core/dashboard.service.ts` (`computed`, `DashboardLayout`), `core/dashboard.ts` (`dashboardWidget`) | `npm run lint:dead`; `rg dashboardWidget` finds only its own declaration | **1** |
| 2 | **Duplicated period vocabulary:** the `'all' \| 'day' \| 'week' \| 'month'` type, its chip array, its label map, and the *byte-identical* `setX()`/`shiftX()` cursor methods are copy-pasted three times. | `features/inspections`, `features/maintenance`, `features/purchasing` | identical method bodies; `LOG_RANGES`/`LIST_RANGES` and `LOG_RANGE_LABEL`/`LIST_RANGE_LABEL` are the same data under two names | **2** |
| 3 | **Reinvented primitives:** a `pad2` closure is re-declared in four places, and two local ISO-day builders reimplement `dISO()`, all of which already exist in `core/period.ts`. | `core/format.ts` ×2, `core/telemetry.service.ts`, `features/scheduler/scheduler.component.ts` (`dateAt`, `scheduleOrders`) | `rg "padStart\(2, '0'\)"`; `dISO` is byte-equivalent to the scheduler's closure | **3** |
| 4 | **Duplicated panel geometry:** the "hang the floating panel under its anchor, clamp to the viewport, flip above when there is no room" algorithm is written out twice. | `shared/tip/tip-host.component.ts`, `shared/print/print-menu-host.component.ts` | the two `place()` methods differ only in `gap`/`pad`/anchor edge | **4** |
| 5 | **Non-idempotent guard:** `document.title` is restored *after* `window.print()` with no `finally`, so a throw from the dialog leaves the app title as `"PURCHASE ORDER PO-2026-001"` for the rest of the session. | `shared/print/print.service.ts` | code read | **5** |
| 6 | **UTC vs local day (flagged, not changed):** several "today" defaults use `new Date().toISOString().slice(0, 10)` (UTC) while the store's own convention is `dISO(new Date())` (local). | `features/handoff` ×3, `features/inspections`, `features/purchasing`, `core/data.service.ts` (rental defaults) | `rg toISOString` | — |

### Perf notes (measured, deliberately left alone)

- `DashboardService.widgets()` is O(n²) in the widget count via `Array.includes` — **n = 9**.
  A `Set` would be theatre at this size; noted for the day the registry grows.
- Template-bound methods (`TelemetryService.breachCount()`, page `listX()` filters) run per
  change-detection cycle over capped, small collections (alerts ≤ 40). A signal/memo pass
  would need the store to expose a signal-first read model — a store redesign, not a cleanup.
- `DataService` is 4.5k lines and `styles.scss` 2.5k. Splitting either is a *structural*
  change with a large blast radius; out of scope for a no-behavior-change pass.

---

## 2. Plan

| Phase | Change | Risk |
|---|---|---|
| **1** | Delete the dead import/export trio. | none — nothing references them |
| **2** | Move the period-filter vocabulary + cursor paging into `core/period.ts` (`RangeFilter`, `RANGE_FILTERS`, `RANGE_FILTER_LABEL`, `rangeView()`, `alignPeriod()`, `shiftPeriod()`), re-export it from `core/data.service.ts` (the existing façade for period helpers) and use it in the three pages. | low — pure extraction, same arithmetic |
| **3** | Point `format.ts`, `telemetry.service.ts` and the scheduler at the existing `pad2` / `dISO`. | low — byte-equivalent output |
| **4** | New `shared/panel-position.ts` with one `placePanel()`; both root hosts call it. | low — same geometry, one call site each |
| **5** | Wrap the print-dialog title swap in `try/finally`. | none on the success path |
| **6** | Record the outcome + gate results in this file; cross-link from `README.md`. | none |

---

## 3. Destructive changes, and why they are safe

| Deleted | Why it is safe |
|---|---|
| `computed` and `DashboardLayout` imports in `core/dashboard.service.ts` | `npm run lint:dead` reports both as imported-and-never-used; the service reads the layout through `DataService.dashboardLayout()` and builds its own `Map`, so neither name appears outside the import line |
| `dashboardWidget()` in `core/dashboard.ts` | one-line `DASHBOARD_WIDGETS.find(...)` helper; `DashboardService` builds the same lookup once in its constructor (`byKey`), and no file, harness or doc mentions the export |
| The three per-page copies of the range vocabulary | replaced by one shared definition **before** the copies are removed, so every call site keeps a definition — the type/array/label set is identical in all three, so no page loses a case |
| The two `place()` bodies | replaced by `placePanel()` with the same `gap`/`pad`/align parameters each host already used |

Nothing is deleted without a replacement existing first; phases 2–4 are refactors, not removals.

---

## 4. What changed

| File | Change |
|---|---|
| `core/dashboard.service.ts` | dropped the two unused imports |
| `core/dashboard.ts` | deleted the unreferenced `dashboardWidget()` |
| `core/period.ts` | **new:** `RangeFilter`, `RANGE_FILTERS`, `RANGE_FILTER_LABEL`, `rangeView()`, `alignPeriod()`, `shiftPeriod()` — the vocabulary and the two cursor moves the three pages used to duplicate |
| `core/data.service.ts` | the new names join the existing `./period` re-export (its façade for period helpers), so the pages keep one import site |
| `features/inspections/inspections.component.ts` | local `LogRange`/`LOG_RANGES`/`LOG_RANGE_LABEL` deleted; `setLogRange()`/`shiftLog()`/`logWindow()`/`logBounds()` now call the shared helpers |
| `features/maintenance/maintenance.component.ts` | local `LogRange`/`LOG_RANGE_LABEL` deleted; same four members rewired |
| `features/purchasing/purchasing.component.ts` | local `ListRange`/`LIST_RANGES`/`LIST_RANGE_LABEL` deleted; `setRange()`/`shiftRange()`/`rangeLabel()`/`inRange()` rewired |
| `core/format.ts` | `fmtDate()` / `fmtDT()` use the shared `pad2` |
| `core/telemetry.service.ts` | its private `pad2` deleted; imports the shared one |
| `features/scheduler/scheduler.component.ts` | `dateAt()` and `scheduleOrders()` use `dISO()` instead of local ISO builders |
| `shared/panel-position.ts` | **new:** `placePanel()` + `PanelPlacement` — the anchored-panel geometry in one place |
| `shared/tip/tip-host.component.ts` | `place()` delegates to `placePanel()`; local `TipPos` deleted |
| `shared/print/print-menu-host.component.ts` | `place()` delegates to `placePanel()` (right-aligned, its own gap/pad) |
| `shared/print/print.service.ts` | `try/finally` around `window.print()` for the title restore |
| `scripts/runtime-checks/check33.mjs` | **new** — 8 checks on the shared vocabulary and cursor paging |
| `scripts/check-store.sh`, `README.md`, `docs/HANDOFF.md` | harness count/step updated (33 harnesses · 294 checks) |

---

## 5. Verification

| Gate | Result |
|---|---|
| `npm run build` | **exit 0, 0 warnings / 0 errors**; initial total **502.99 kB** (warn budget 520 kB) |
| `npm run check:store` | **294 ok / 0 FAIL in 33 harnesses** (was 286 in 32; `check33` adds 8) |
| `npm run lint:dead` | **0 unused imports, 0 orphan exports** (was 2 and 1) |
| `npm run lint:ctor` | OK (8 method-based initializers) |
| `npm run e2e` | **all checks passed** — 6 routes + applied stylesheet + field editor + 5 printable documents + dashboard layout + sample-data over all 19 routes, empty console-error log |

### The new harness is the proof of neutrality, not decoration

`check33` re-implements the **exact branch logic that was deleted** and compares it
against the shared helpers across a date sweep that breaks naive date arithmetic —
December→January, the 29th of February, a month opening on a Tuesday, and all four
filter states including `all`:

```js
const legacyAlign = (range, anchor) => {
  if (range === 'month') return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  if (range === 'week') return mondayOf(anchor);
  return anchor;
};
```

Every combination of `{anchor × filter × dir (-2,-1,1,2)}` must be `getTime()`-identical
to the helper, so "the refactor changed the pager" is a failing test rather than a review
opinion. It also pins the concrete windows (`Week of Sep 7, 2026` → `2026-09-07..09-13`)
the labels are worded from, and that aligning an already-aligned cursor is idempotent.

---

## 6. Deliberate non-changes (with reasons)

| Not changed | Why |
|---|---|
| `PrintService` does not clear `doc` after the dialog | the e2e asserts `ims-print-document .print-doc` still carries the document after printing, and keeping the last document on screen is what makes that assertable; clearing it would be a behaviour change with no user-visible benefit |
| UTC "today" defaults (finding 6) | they are *behaviour*, not hygiene: `dISO(new Date())` (local) and `toISOString().slice(0, 10)` (UTC) differ for users west of UTC after ~19:00. Correcting it is a deliberate, coverable change of its own — it wants a harness that pins the intent first, so it is logged here rather than smuggled into a cleanup pass |
| `DataService` / `styles.scss` size | structural, high-blast-radius; a cleanup pass is the wrong vehicle |
| `tip-format.ts`'s `String(m).padStart(2, '0')` | a two-digit minutes field inside the am/pm formatter — not the same primitive as `pad2`, and reaching into `core/` from the tip formatter for it would be coupling for its own sake |
| Template-bound filters/lookups | see the perf notes in §1 — at the current collection sizes a memo layer would add state to save microseconds |



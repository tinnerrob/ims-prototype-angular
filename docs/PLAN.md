# ims-web — Tenant-Aware SaaS Foundation: Plan & Progress

**Why this exists.** `ims-web` is a working single-workspace IMS port. It is also
the **specification** for a multi-tenant SaaS backend that does not exist yet.
So work on it is not "add features": it is *deciding the shape of the data* by
making the client exercise it — a column nobody reads never gets written, and a
column nobody writes never gets designed. Every increment below ends with the
front end able to produce, display and (where it matters) reason about the fact
the backend will have to store.

This file is the plan. `HANDOFF.md` is the current state. When they disagree,
`HANDOFF.md` is right.

## Working agreement

- **One gated commit per step.** No step is left half-applied; each commit
  message states the problem, the shape of the fix and the verification run.
- **Green before commit:** `npm run build` (AOT, strict templates),
  `npm run lint:ctor`, `npm run lint:styles`.
- **Runtime checks:** there is no Chrome on the dev box, so Karma specs can't
  run. Store/service logic is verified by compiling the core services to JS and
  running a Node harness against the *real* store (see "Verification recipe").
- **Class-field initializers must not read injected services** (`lint:ctor`).
- **List pages** register in `VIEWS` + `app.routes.ts` and report their row
  counts to `PageSearchService` via `search.report(thunk)`.
- **Writes go through `DataService.save()`** — that is the single writer, and
  where tenant scoping and attribution happen.

## Phase A — identity, audit, and the physical spine (the foundation)

| # | Increment | Status |
|---|---|---|
| A1 | Identity & tenancy: `Tenant`/`User`/`Role`/`Permission` + `can()`, session as signals, modules become tenant licence flags, `vertical` moves to the tenant, reseed banner | ✅ `0e547ae` |
| A2 | Audit trail: `AuditFields` on every table, `Movement.byUserId` FK, attribution in `save()`, seeded rows backfilled, audit block in record views | ✅ `592bc37` |
| A3 | Item ↔ location spine: seed `locationId`, picker in both item editors, Location column + search, `itemsAtLocation()`, `bin` duplicate resolved, location removal guarded by contents | ✅ `d13bafa` |
| A4 | Movements write real locations: `Movement.location` string → `locationId` FK, hand-off picks a location, custody log shows the path | ✅ `6fd10ad` |
| A5 | Purchasing as core: supplier → PO → receipt → stock (absent entirely today) | ✅ `fc643e1` |
| A5.1 | Close the holes A5 exposed: the `transfer` / `adjust` write paths (Move, Count), a reorder that raises a document instead of a count, sub-rental vendors as supplier FKs | ✅ `1a8bf96` |
| A5.2 | Purchasing lists page by period: the PO and Receipts lists take the inspection log's `All/Day/Week/Month` chips + `‹ range ›` pager, on one shared `periodBounds()` window that the log now reads too | ✅ `e043478` |
| A6 | One SKU, many places: `stock_levels(item_id, location_id, qty)` as the truth for counted stock, with `qtyOnHand` as its sum and a move / count that act on a place | ✅ `1ede7b5` |
| A7 | Vertical metadata registry: the per-vertical field/tab/label sets become data `core/vertical-metadata.ts` carries, read by the store, not conditionals in components | ✅ `522f885` |
| A8 | `docs/DATA-MODEL.md` — tables, columns, FKs and enums derived from `models.ts`, as the schema the API implements | ✅ `5560a98` |
| A9 | Every table is a tenant's: the configuration rows (`location_types`, `categories`, `tax_schedules`, `overheads`, `pricing`, `yard`) join `auditedRows()`, and a rename keeps the row's history | ✅ `c1812bf` |
| A10 | The last hole A8 named: `orders.party` (a stored copy of the counterparty's name) leaves the model — the screens read the join — and `partyRemovalBlockers()` keeps the FK from dangling | ✅ `99653e1` |
| A11 | Negotiated rates per party: `price_cards` + `price_card_lines` hang off `parties`, an order bills at the card in force on the day its booking starts (`cardRateFor()`), a supplier's card is the PO editor's cost default (one rule, re-applied when the supplier changes), and the Pricing page edits them | ✅ `13f8f5b` + `3d21cdd` |
| A11.2 | The invoice bills what the Gross prints: whole weeks/months per period (`wholeUnitsBilled()`), on the line's own days, at the party's own cadence (`partyCycleDays()` — the only reader `parties.billing_cycle` ever had), with "Run Next Cycle" (`runNextCycle()`) advancing every active order, so a booking's cycles tile it and add up to its `lineTotal()` | ✅ `a8f1736` |

### Acceptance criteria per increment

**A1 — identity & tenancy.** A user belongs to a tenant; a role is a set of
permissions; a screen asks for a capability, never for a role name. Module
enablement is tenant configuration (a licence), not a browser preference.
Switching the acting user changes what the app allows without a reload, and a
store-version bump tells the user their saved data was replaced.

**A2 — audit trail.** Every row carries `tenantId`, `createdAt/By`,
`updatedAt/By`, and no write can avoid it: attribution lives in the one writer,
not in 59 mutators. A movement's author is a user id, not a name, so a rename
can't rewrite history. Seeded rows are backfilled as a migration would. Two
screens can read the stamps they produce.

**A3 — item ↔ location spine.** An item's *place* is a row in `locations` (an
FK), not free text, so stock can be counted per location and a bin is a node in
the hierarchy rather than a string beside it. Both item editors (Assets,
Scheduler pool) write the same field; the column, the search and the record
viewer read it; `itemsAtLocation()` answers "what is here?" for one node and for
its whole subtree; a location holding stock can't be deleted out from under it.

**A4 — movements.** A movement records where it happened as an FK, so the ledger
can be read back per location ("what left Yard A this month?") and the immutable
log stops carrying a display string. A4 also settled the FK's other end: the
place is *resolved* rather than asked for (an issue leaves from where the unit
sits), only a **return** re-homes a unit — the other kinds log a place and leave
the shelf alone — and a place the ledger mentions can no longer be deleted,
because an append-only log can't be re-pointed at another location.

**A5 — purchasing.** A receipt is how stock *arrives*; without it, `qtyOnHand`
is a number someone typed. A5 answered it in core: suppliers are parties
carrying a role, a purchase order holds what was ordered and **no copy of what
arrived** (received quantity is summed from receipts, and delivery progress is
derived), and `receiveAgainst()` is the one operation that creates stock — it
lands real rows at a location FK, logs a `receive` movement per landed row, and
updates a moving-average cost. A posted receipt is append-only, like the
custody ledger it feeds.

**A5.1 — the holes A5 exposed.** A5 left four things visible but unusable, and
this increment closes them because each is the *same* kind of hole: a fact the
store could represent but nothing could produce. `transfer` and `adjust` had no
write path (an item's place and its count were silent edits), the dashboard's
one-click **Restock** still set `qtyOnHand` with no document behind it, and
`RentalSub.vendor` was still free text where a supplier FK now belonged. So:
`moveStock()` logs a transfer at the destination and `adjustStock()` logs the
signed difference of a physical count (with stock status following the count, in
both directions); `raiseReorder()` raises a **draft purchase order** and moves no
quantity, so a reorder cannot become stock without a supplier and a receipt; and
a sub-rental names a partner carrying the supplier role. The Items page gained the
**Move** and **Count** actions and a **Ledger** section in the record viewer, so
the screen that writes a movement is where it is read back.

**A5.2 — the buying lists read by date.** A5's two document lists were long: a
purchase order carries the day it was raised and a receipt the instant it was
posted, so neither list could answer "what came in last week?" without reading the
whole table. Both now take the inspection log's period filter — `All / Day / Week /
Month` chips with the `‹ range ›` pager — reading orders by `orderedAt` and
receipts by the day their posting instant falls on. The window itself is **one
definition for the app**: `periodBounds(view, anchor)` beside `periodLabel()` in
`core/data.service.ts`, Monday-based weeks and months ending on their last day,
with the cursor kept on the period's *first* day so that the label names the window
the rows were filtered by — which is exactly why the chip that switches the view
snaps the cursor (a week to its Monday, a month to its 1st). Each list keeps its
own window, because "what did we order?" and "what arrived?" are asked of two
different dates and one shared cursor would put a different week under one label.
The empty state names the period when the period is the reason it is empty, the
record count and the topbar search pill count what the list actually shows, and
the inspection log reads the same helper instead of keeping private copies of the
week/month maths — so the two logs cannot drift apart.

**A6 — one SKU, many places.** A3 gave an item a *place* (one FK) and A5.1 made a
change of place a logged movement, but a part could still only be in one bin with
one count — while a receipt *re-placed* the row it topped up. Real stock is spread
out, so the quantities move into a table the schema needs anyway:
`stock_levels(item_id, location_id, qty)`, one row per pair **only while it holds
something**, with the row's `qtyOnHand` (and a bulk row's `qtyAvailable` /
`totalOwned`) as its **sum** and its `locationId` as the place holding the most —
both recomputed by the one writer that moves a level, so the shelves and the
totals cannot drift. `moveStock()` becomes "take *n* out of this place and put it
in that one" (an emptied place loses its row, a place that already holds the SKU
is topped up rather than duplicated), `adjustStock()` counts **one place** and
logs the difference there, a receipt lands as a level (delivering into a new bin
*adds a place*, which is how one part ends up in two), and `itemsAtLocation()` /
the locations grid / the removal guard read the shelves instead of a column. A
unit (serialized, kit, attachment) keeps its single FK — one machine is one thing
in one place — and labour still has no place at all. Two things the increment
deliberately leaves out: no bulk / cycle-count *screen* (one place at a time
through the row's Count action), and a placement edited straight on a counted row
is silently refused rather than logged, because stock moves through movements.

**A7 — vertical metadata.** A vertical used to re-shape the catalog through
conditionals inside the page: a `VERTICAL_TABS` map, a `COLUMNS` map and a handful
of label strings in `assets.component.ts`, plus a second copy of those labels on
the Categories page. It is now a registry — `core/vertical-metadata.ts`, one entry
per `VerticalKey`, read through `DataService.verticalMeta()` — carrying the tab set
*in its own order*, each tab's label / icon / "add" wording, its grid columns and
what a new record of that type starts as. Two limits keep it a registry rather
than a second app: a column may only name a field the model already has (the page
*selects* and *orders* facts, never invents them — a harness check fails the build
if it tries), and nothing in it decides what is *allowed* (the module licence is
`Tenant.disabledModules`; a tab list is what a catalog *is*). The store reads the
tenant's vertical on every call, so Admin → Feature Modules re-shapes the Assets
tab strip, its columns, its wording and its opening tab with no reload and no
component-level map in step — and that panel now *shows* the consequence, tab by
tab, instead of just flipping a switch.

**A8 — data model.** The front end has been the spec all along; this increment
writes the spec down as tables/columns/FKs/types, so the API is built against a
document rather than inferred from TypeScript. `docs/DATA-MODEL.md` is 30-odd
tables (identity, configuration, the catalog, `stock_levels`, the ledger, the
buying side, the module tables) with keys, nullable/required flags, collisions
resolved and enums written out, plus three sections a schema designer needs and
the types cannot say: what is **derived at read time and must never be a column**
(the totals, a PO's received quantity, an order's amount), **what the server must
enforce** (the refusals the store makes today, as constraints), and **what is
deliberately not modelled yet** (reservations, level-tracked kits, count
sessions, documents). The document is guarded like the code: `check9.mjs` reads
`models.ts`, `data.service.ts` and the doc as text and fails the harness if a
model has no table, a table invents a name, a column is not a field, a `NOT NULL`
contradicts the type's optionality, an enum drifts, a foreign key dangles, the
five derived stock columns are not the ones the store derives, or the per-type
status table stops matching `ITEM_STATUSES`. A column the model does not have is
a bug in the doc, not a wish — so a new field is proposed in TypeScript first.

**A9 — every table is a tenant's.** A8 closed by naming a hole out loud: the
settings tables were the one place a screen writes rows that `auditedRows()` did
not cover, so Admin could add a category, retire a location type or change a tax
rate and nothing recorded who. They are now rows like any other — the six
configuration types carry `AuditFields`, the writer stamps them (seeded rows
backfilled by the same pass that backfills everything else, a new one attributed
to the acting user, an edit re-stamping `updatedBy` without touching the create
stamps). Two things about *settings* rows are special and are handled rather than
hidden: they have no surrogate id, so the writer keys them by their natural key
(`location_types.name`, `categories.type` + `name`, `tax_schedules.code`, and one
`settings` row each for `pricing` / `yard`), and because the rename mutators move
that key *in place*, the writer follows the row — a rename takes the edit stamps
instead of reading as a delete plus a fresh create that would lose the original
author. The other direction is now guarded too: `check9` fails if a mapped table
names a store key `auditedRows()` never writes, so the hole cannot be reopened by
a new settings table — and the two tables that genuinely cannot take a stamp from
a request context (`tenants` — the workspace is its own boundary; `users` — a
person is created by a sign-up, and `users.tenant_id` already scopes the row) are
**declared exceptions** in the document, with the reason, rather than left silent.

**A10 — the customer is a join, not a copy.** A9's close-out left one hole A8 had
named still open, and the follow-up list carried it: `orders.party` was a stored
copy of the counterparty's name — the single column in the model that duplicated a
join, and one the API would have had to keep in step with `parties` by hand. The
fix is subtraction: the column is gone from `models.ts`, from the fixture and from
both order-creation paths, and every screen that printed it now resolves the name
through the FK (`partyName(order.partyId)`) — the same rule `userName()` and
`locationPath()` already follow, and the reason a partner renamed on the Parties
grid renames every contract at once. Removing a stored copy is only safe if the
join cannot fail, so the increment adds the other half: `partyRemovalBlockers()`
names what points at a party (orders, purchase orders, their receipts, the
sub-rentals it hires to us) and `removeParty()` refuses while that list is
non-empty. That is the API's `ON DELETE RESTRICT` — and it is enforced now, not
claimed: before A10 the document asserted the refusal and `removeParty()` deleted
the row anyway, which is exactly the kind of promise a derived name would have
turned into a screen printing a raw `PTY-00x` where a customer belongs. The
Customers grid's Remove button reads the same list the guard does (the
`locationRemovalBlockers` pattern: one source, two readers). What is left of a
party with history is `active = false`, which the document already said.

**A11 — a negotiated rate is read, never copied.** The gap the document named last
("Pricing per party and per contract… a customer-specific rate card is not
modelled") is the other half of the same idea as A10: money that belongs to a
counterparty, resolved through the FK rather than written down twice. So
`price_cards` (with `price_card_lines`) hangs off `parties`, and the order screens
**read** it — `lineTotal()` and `rateBasis()` both go through one reader,
`cardRateFor(partyId, item, onDate)` — which means a repriced card moves every
order it covers at once and the order row is never written. The catalog keeps its
own list prices (`items.rate_daily` is the fallback, not the override), so the
"printed rate" and the "Gross above it" cannot drift: they are the same call. The
line's own risk premium is the one factor the *amount* applies and the printed rate
does not (A11.2, and the prototype's own split), so the figure a row shows stays the
figure a counterparty agreed.

The card carries a **window**, and that is what makes the join safe rather than
retroactive: an order prices at the card in force on the day its *booking* starts
(`lineStart()`), so a renewal is a new card with a later `effectiveFrom` and last
year's contracts keep last year's prices. Deleting a card cannot dangle an FK —
nothing holds a `price_card_id` — so the consequence of a removal is visible on
the order screens instead, and `active = false` is how a card is retired while it
still has to read back.

The buying side is deliberately **not symmetric**, and the document says why: an
order line has no price column (its price is derived), while a purchase order line
stores the `unit_cost` it was raised at — a supplier's quote is the document's own
fact. So a supplier's card seeds the PO editor's cost and the raised PO keeps
stating its own price. The default is **one rule** (`poLineCostFor()`: the card,
else the row's cost), read both when a line is picked (`syncLine()`) and when the
supplier changes (`onSupplierChange()`): a price agreed with the previous
counterparty is not the next one's starting point, so those lines move — which is
what makes the dashboard's reorder draft (lines, no supplier) end up at the
negotiated price the moment the buyer picks who it is going to. The form only ever
replaces a figure *it* supplied; a cost a person typed is the document's. One
table, two readers, each reading its own half. The counterparty is a row in
`parties` because
A5 made a customer and a supplier the same row, so a partner that is both has one
card, not two that drift. That FK joins the party guard, so a party whose only row
is a card cannot be removed either — the card has to go first.

**A11.2 — the invoice bills what the Gross prints.** A11 made the *rate* a join;
auditing the money it produces found the invoicing engine disagreeing with it, and
disagreeing worse than the gap list admitted: `lineAmountForPeriod()` multiplied the
rate `rateBasis()` returns — which can be the *weekly* or *monthly* one — by the day
count of the cycle, so a 21-day boom lift invoiced `2325 x 21` where Order Details
prints three weeks, and a rental on an expired card could not agree with itself
either (the printed rate came from one day count, the amount from another). The
prototype's rule is the one the increment rests on: a rental on the weekly or monthly
basis bills in **whole units** (`wholeUnitsBilled()`), each unit going to the cycle
that holds the majority of its days, so every unit lands in exactly one cycle and a
booking's cycles add up to its `lineTotal()`. The cuts that make that true are one
reader each: the basis steps on the **line's own days** (`lineDays()` — a three-day
line inside a 21-day order is a daily booking, and the invoice bills the same three
days), the basis *prints* the agreed rate while the *amount* applies the line's risk
premium once (the prototype's split, and the only way `rate x units x (1 + premium)`
reconciles), and the period length is the **party's cadence** (`partyCycleDays()`
reads `parties.billing_cycle` — a stored column with no reader until now; the
fixture's three customers bill weekly, bi-weekly and monthly, and their three cycle
shapes are what proves the read).

"Run Next Cycle" is part of the same repair: it was wired to a store method that only
raised cycle 1 for orders that had none, so no second cycle could exist and the rest
of every booking was unreachable — the button's own comment described the behaviour
the store did not have. `runNextCycle()` now raises the period that follows each
active order's last one, at that party's cadence, and raises **nothing** when the
period bills no base: the prototype rolls every unpaid invoice forever, which
collects `$0` cycles still carrying a fuel charge, and stops the clock entirely the
moment a customer settles one. `check13` holds the invariant directly — the
fixture's cycles tile the booking and their bases sum to the Gross, to the cent —
and the same reconciliation caught the fee chain's one wrong constant: the damage
waiver is 3% of the base (the prototype's `invoiceCompute`), not the 5% the port had
carried unremarked since its first commit.


## Phase B — authentication: the session stops being a stand-in

Phase A made the app *act as* someone: `SessionService` derives the person from the
store, every control asks a capability (`can('stock.adjust')`), and the ledger
attributes its writes to a user id. What it never did is *prove* the person is who
the row says. `db.session.userId` is a value the client sets (`setSessionUser()`),
`users` has no credential, and there is no moment where a password is asked for,
checked or refused — the shell's switcher is a demo affordance and its own comment
says so ("the stand-in for authentication until the API owns it"). B gives the
session an *origin*, because nothing later in this plan can be honest without one:
the audit trail (A2) attributes to whoever the client *claims*, a workspace's data
is readable by anyone who can reach the client, and the API seam (C) has no
principal to carry in a request context.

**In scope.** A credential (a table of its own, `user_credentials`) and the one place that checks it; sign-in and
sign-out; a session with an end; a guard that makes every route require one; the
demo's entry path, so the fixture stays enterable while the mechanism becomes real.

**Deliberately not B.** Creating people, roles, invitations, resets and
deactivation are **E**'s — a workspace's admin writes them. A token's transport, its
refresh and the server's key derivation are **C**'s; B stores a salted digest so the
*shape* is exercised, and states plainly that the client's digest is not the KDF the
server will ship. SSO, 2FA, magic links and email verification are not modelled by
any phase yet, and this section says so rather than implying them.

| # | Increment | Status |
|---|---|---|
| B1 | A credential in a table of its own (`user_credentials` — a per-person salt and a digest, never a password) and the store's one sign-in path: `signIn(email, password)` proves it, `signOut()` drops the session, and an empty session acts as nobody | ✅ `90ff25d` |
| B2 | Sign-in as a screen: the fixture **ships signed out**, every screen is a child of a route parent carrying `requireAuth`, the shell chip names who is signed in and offers **Sign out** (the switcher is gone), and the seeded demo accounts are listed so the workspace is still enterable | ✅ `68cafe0` |
| B3 | The session has an *end*: an idle expiry the store stamps and rolls on activity, enforced where identity is read and cleared where the guard notices it, so an unattended tab stops acting as someone without a reload | ✅ `97bb2c5` |

**B1 — a credential, and the one place that checks it.** The password never enters
the model, and it does not enter the `users` row either: the credential is **a table
of its own** (`user_credentials`, model `Credential` — one row per person, a per-person
`salt` and the digest of `salt + ':' + password`). A `users` row is read by every list,
join and audit block in the app, so a digest must not travel with the row a screen
prints — and the check that proves it is the one that stringifies a `users` list and
looks for any salt or digest in it. `signIn()` is the only reader: it finds the person
by address (case-insensitively, trimmed), compares digests through one call
(`credentialMatches()` → the module-level `credentialDigest()`), and answers in data —
a `SignInResult`, either the person or one `SignInFailure` a screen may print. An
unknown address and a wrong password answer the same `'invalid'`, so the form cannot
be used to find out who works here; `'inactive'` is told only *after* the credential
proves, because that person already knew the account existed (a wrong password on a
deactivated account still learns nothing).

Two consequences follow from "a session has an origin", and both are asserted. A
session names a person **or nobody**: `activeUser` no longer falls back to the first
person in the tenant, so signing out leaves an app with nobody in it and `can()`
already answers no rights for that. And the state round-trips: signing out is
persisted, so a reload cannot sign the person back in behind their back — which meant
`hydrate()` had to stop treating an empty `userId` as "no session to restore", the
one line where a falsy check would have quietly undone the increment.

The fixture's digests are literals because a seed cannot `await` (`crypto.subtle` is
asynchronous) and a credential table holding a *digest* rather than a hash function is
the honest shape anyway; `check14` re-derives every one of them from `DEMO_PASSWORDS`
with an independent implementation, so a literal that drifts from the documented rule
fails loudly instead of locking the demo out. `DEMO_PASSWORDS` is the single place a
password is written down, deliberately: this prototype's permissions *are* the
demonstration, so the sign-in screen prints the list and the fixture stays enterable.
The client's digest is explicitly **not** the KDF a server ships — the column, the
function and the document all say so, and the server's job is `POST /api/sessions`
with argon2id and a digest it never sends.

**B2 — sign-in as a screen, and a session that is required.** Two halves, and the
first is the fixture's: a fresh seed now **ships signed out**. It is set up *as* the
seeded manager — every seeded row keeps the author it always had, because the fixture
posting runs before the session is emptied — and then the app hands the browser an
empty session, so what a visitor meets is the form. `hydrate()` keeps a restored
session either way, which is what makes "signed out" survive a reload.

The second half is the guard. `requireAuth` is registered **once**, on a pathless
route parent that every screen is a child of, rather than repeated per route: a guard
a new route can forget is a guard that eventually gets forgotten, and the claim is
that no screen is reachable without a credential. It asks `session.signedIn()` and
sends a stranger to `/signin` with `?next=` naming where they were going, so a deep
link survives the sign-in (the form honours a path on this app and nothing else, so a
crafted value cannot become an open redirect). `requireModule` stays where it was —
a licence and an identity are different questions.

The shell's switcher is **gone**, and that is the increment's point: "become someone
else" is precisely what authentication replaces. The chip keeps the person's name and
title, and its panel is now a **Sign out**; `setSessionUser()` and `setSessionTenant()`
have left the store, so nothing in the client can assert who it is — the harnesses that
used them now sign in with a fixture credential, which is the same change a client
made. `signOut()` also navigates explicitly rather than trusting the guard: a guard
runs on *navigation*, so a signed-out shell sitting on an already-active route would
otherwise keep rendering it.

The sign-in screen (`features/sign-in/`) decides nothing: it posts the pair, prints
whatever `SignInResult` comes back (one sentence per `SignInFailure`), and clears the
password field on every attempt — refusal or not. Below it sits the fixture's
pick-list (`DataService.demoAccounts()`), the six seeded people with the passwords
this build publishes: this prototype's permissions *are* the demonstration, so a
credential requirement must not lock the demo out of itself. One click fills the form
and tries it, which is also what makes the list honest — `check15` signs in as every
published pair and asserts each one lands as that person with the role its row names.
A real deployment renders no such list and stores no such password.

**B3 — a session that ends.** A credential only matters if the session it creates
can lapse, so the session gained an `expiresAt`, stamped by `signIn()` and rolled by
`touchSession()` — and the guard now asks *that* instead of asking whether anybody is
signed in, which makes every navigation the app's activity (a person navigating is
what "in use" means, and the guard already runs for each one). The answer is not a
boolean: `SessionTouch` separates a session that is still live (`'active'`) from one
that *ended* (`'lapsed'`) and one that never existed (`'none'`), because those are two
different things to say to somebody standing at a form — only a lapse carries
`?expired=1`, and only a lapse gets the sentence "your session ended after a period of
inactivity".

A lapse is enforced **where identity is read**, not only where routes are checked: a
server refuses a request carrying a dead token, and the store's readers are that
request, so `activeUser` answers nobody and `sessionUserId()` answers `''` the moment
the stamp passes — which means a lapsed session authors nothing (`actor()` is the
store's request context) and holds nothing, whatever is rendered. The guard is then
the write half and the *UX* half: it rolls the stamp while it is live, and **clears** a
lapsed one by the same shape `signOut()` leaves, so the end is persisted and the person
lands on the form with a reason. A session that lapsed while the tab was *closed* is
handled by the same split — `hydrate()` restores the stamp with the session and does
not judge it, which is the honest division of labour: restoring is the store's job,
honouring is the reader's.

What is left, and stated rather than implied: a tab sitting idle *on a screen* keeps
its rendered DOM until the next navigation, because this app has no timer, no polling
and no socket to notice with — but the data underneath it has already stopped acting as
that person, and D (one store, two clients) is where two tabs agreeing about one
session belongs.

The window itself is **the server's term**, and this is the one place the increment
departs from how it was scoped: the plan said `settings.sessionMinutes` (a workspace
setting the client reads), and that would have been the wrong shape. How long a token
lives is decided by whoever issues it — the API stamps `expires_at` on the session (or
the token) it hands back and the client honours the stamp — so a client-side lifetime
is not a security boundary at all, it is a preference that *looks* like one. There is
therefore no `settings.sessionMinutes` and no call that takes one: `touchSession()` is
told nothing, `signIn()` is handed a credential, and the window exists as a single
constant (`SESSION_MINUTES`) only because this build plays both parts. It is stated
that way in the code, the model and the data-model document, so the seam C has one
rule to move: the server stamps, the client reads.

What follows from the same reasoning is what an unreadable stamp means. An expiry
missing, empty or unparseable is treated as a **lapse**, not as "no expiry, therefore
for ever" — the case a `!expiresAt → still valid` shortcut gets exactly backwards, and
the one a hand-edited snapshot would otherwise exploit to mint itself an unlimited
session. B deliberately stops there: proving two tabs agree about one session is D's
(one store, two clients), and revocation (cutting a session short before it is given
up) is the API's.

**Acceptance criteria (B).** A password is never stored, printed, logged or read
back — the credential columns hold a salt and a digest, and no screen or result
carries either. Signing in as a seeded person makes every screen, ledger write and
`can()` answer what A1 already proved, so the *only* difference is that the client
can no longer assert who it is without a credential. Signing out — or a lapsed
session — leaves every route unreachable, and the demo's accounts are enterable from
a fresh browser profile with nothing but what the sign-in screen prints.

**Phase B is complete**: B1 `90ff25d`, B2 `68cafe0`, B3 `97bb2c5`, each with its own
harness and its own note here. Its known remainder is stated rather than implied —
revocation belongs to the API (Phase C's seam is where a session becomes a token the
server can cancel), and it is named in `docs/DATA-MODEL.md` → "not in the model yet".

## Phase C — the API seam: one contract, two implementations

`DataService` is not a client of anything: it *is* the database. It holds the
snapshot in memory, persists it to `localStorage`, mints its own ids and answers
every screen synchronously — which is why the port reads the way it does (one
writer, `save()`) and why it cannot talk to a server as it stands. The document has
called the shape it needs "the `apiAdapter` seam" since the port began, and one
prose note in `data.service.ts` is the only trace of it: a future `HttpClient`
adapter. C makes the store an *implementation* of a contract the API will also
implement — the same method surface, the same refusals — so the client cannot tell
which side it is on.

**In scope.** Naming the contract (which methods are queries, which are commands,
and what a command answers when it refuses); making a refusal a result a screen can
act on instead of two sentinels (`null` and `false`); the request context becoming an
argument the seam carries (B's principal, the tenant) rather than a `db.session`
read; a load/error state where a screen currently assumes the rows are already
there; and paging for the tables already long enough to need it (movements,
telemetry, receipts).

**Deliberately not C.** The server — its routes, schemas, migrations and auth
middleware — belongs to the project this repo specifies; C is the half the client
can prove. Conflict resolution between a local edit and the server's truth is **D**'s.
Tenant administration is **E**'s.

| # | Increment | Status |
|---|---|---|
| C1a | The contract as a file of *names* (`api.ts`): the store's whole public surface split into queries and commands, taken from the implementation (`Pick<DataService, …>`) and held by two compile-time assertions plus a harness that re-derives the split from the store | ✅ `2ffca74` |
| C1b | The screens depend on the contract: every component, service and helper takes `IMS_API` (typed `ApiAdapter`) instead of the `DataService` class, so which implementation answers is a provider change and nothing else | ✅ `3439270` |
| C2 | Commands answer in one shape: a typed result (value or `reason`) replacing the `null`/`false` sentinels, so a screen renders a refusal instead of guessing what `null` meant | ⏳ |
| C3 | The request context is a parameter: `sessionUserId()` / `sessionTenantId()` become what the seam's caller supplies (an HTTP client derives them from a token), and the store stops reading `db.session` for who is writing | ⏳ |
| C4 | Reads may be remote: a loading/error state beside each list's signals, so a screen that is waiting cannot look like a screen that is empty | ⏳ |

**C1 — the contract, before the transport.** The interface is written from the call
sites that exist rather than imagined from an API design: every public `DataService`
method, grouped into queries (pure reads: `listItems`, `partyName`, `invoiceTotals`)
and commands (things `save()` persists: `createItem`, `moveStock`, `runNextCycle`).
Naming it forces the two questions this repo has been answering increment by
increment — is this fact stored or derived, and is this method a read or a write —
to be answered once, in one file, instead of being inferred from a method body.

What the file holds is **membership and direction, not signatures**: the surface is
`Pick<DataService, ApiQueryName | ApiCommandName>`, so a signature is the store's own
and a method that moves is a compile error rather than a stale copy. The split is one
rule — *a command persists, directly or through another command it calls; a query never
does* — and that rule is the part a second implementation has to agree with. It is held
twice, because membership and semantics fail differently: two compile-time assertions in
`api.ts` fail the **build** if a public member sits outside both unions (a type is
something no harness can see), and `check17` re-derives the split from
`data.service.ts` with its own implementation of the rule and fails if a name is on the
wrong side. Both were earned rather than decorative: `punchIn()` reaches `save()` only
through `createTimesheet()`, so a "does this body mention `save()`" reading files a
command as a query — and `reseeded`, a public *field*, was missing from the surface
entirely until the type assertion refused to compile.

`IMS_API` is the token a screen injects, and `provideImsApi()` is the one place that
decides who answers it (`useExisting`, so the store is never copied — a seam that minted
a second workspace would be worse than no seam). C1a lands the contract and the wiring;
C1b moves the features onto the token, the half that makes "a screen depends on the
interface" true of screens rather than of a file.

**C1b — the sweep, and the rule that makes it hold.** Twenty-three files: every
component and core service that was constructed with `private readonly data:
DataService` now takes `@Inject(IMS_API) …: ApiAdapter`, and the tooltip builders —
which take the store as an *argument* rather than injecting it — take `ApiAdapter`
too. Nothing about behaviour changed, which is the point: the app still talks to the
store, but it can only reach a member the contract declares, and which class answers is
decided in one provider.

What is worth stating is what does *not* catch a regression here. Injecting the class
again **compiles** (it is still `@Injectable({ providedIn: 'root' })`), and it runs —
the app would quietly go back to depending on the implementation and nobody would see
it. So the sweep needs a harness, and `check18` is it: it walks every `.ts` under
`src/app` and asserts the class is named in exactly two files (its own and `api.ts`),
that every injection site names `IMS_API` and types it as the contract, that no call
site asks Angular for the class as a token, and that nothing constructs a second store.
The new rule for the next screen is the same one, and it is in the conventions below.

**C2 — one shape for "no".** Today a refusal is `null` (no such row, refused edit) or
`false` (refused removal) and a screen decides what to say — which is how a guard and
its button can print different reasons for one rule (`partyRemovalBlockers()` is the
pattern that fixed that by hand). A command result carrying a reason makes the seam's
refusal speakable, serialisable and testable, and it is the shape an HTTP adapter
returns anyway.

**C3 — the context, not the session.** A server derives the tenant and the user from
the request; the client currently derives them from `db.session`, which is also *in*
the persisted blob. C moves the read behind the seam so the two implementations
differ by where the value comes from, and the store keeps its single writer for the
audit stamps it writes.

**C4 — a read that may not be there yet.** `check9`'s reverse rule (a mapped table
with no writer) has a mirror on the screen side: a list that renders an empty state
while a fetch is in flight is claiming the table is empty. A load state makes that
distinguishable, and it is the one change the components cannot avoid when the data
stops being local — so it is scoped here deliberately, with the screens it touches
named by the increment.

**Acceptance criteria (C).** The screens depend on the interface, not on the class:
swapping the implementation (store now, HTTP later) compiles without touching a
feature, and the runtime checks can drive the store *through the seam* — which is the
proof, since a seam only one implementation ever crosses is a rename. A refusal
reaches the screen as a reason it prints. Nothing in the client reads `db.session` to
decide who is writing or which workspace a row is in.

**C1 is complete** (C1a `2ffca74`, C1b `3439270`): the contract exists, the store is its
first implementation, every screen goes through `IMS_API`, and two harnesses plus two
compile-time assertions hold the line. **C2 is next** — a command's refusal becoming one
typed result instead of `null`/`false` — and it is the increment that makes "a refusal
reaches the screen as a reason it prints" true; the paging and load-state halves (C3,
C4) come after it.

## Phase D — persistence and offline: what a client keeps when nobody answers

The store's persistence is one blob: `localStorage[KEY]` holding `_v` plus every
table, written by `save()` on every mutation, read at boot, with a version bump
triggering a reseed (A1's banner). That is enough for a demo and honest about its
limits — but it is also the only client-side copy of the truth this app has ever had,
so D works out what such a copy is *for*: a cache with a version, a queue of writes
nobody has acknowledged, and two tabs that are one client, not two workspaces.

**In scope.** The snapshot's role (a cache, never the record); the version rule
becoming a *migration* where rows can be kept instead of a wipe; an outbox of
commands with per-record order and an operation id, so a replayed command is
idempotent (the API's `Idempotency-Key`); what "pending" says on screen; quota and
failure handling (a write that cannot be persisted must not be silently lost);
cross-tab agreement (one client, one store); and the app's behaviour with no network
at all — today it works because there is no network, after C it must *degrade*
rather than break.

**Deliberately not D.** Arbitrating a conflict between two *people* is the server's
(a client can only say what it sent and what it has not heard back); CRDTs and
eventual-merge machinery are refused by name; and file/blob storage is not in the
model at all (nothing stores a binary — see DATA-MODEL's "not in the model yet").

| # | Increment | Status |
|---|---|---|
| D1 | `localStorage` named as the cache it is: a boot that can render without it, an explicit "not persisted" outcome where a write fails (quota, disabled storage), and the reseed reduced to a migration that keeps rows it can | ⏳ |
| D2 | An outbox: a command is queued with an operation id and per-record order, replayed when the seam can answer, and never applied twice | ⏳ |
| D3 | Pending state on screen: a person can see that a write is not yet acknowledged, and what it touched | ⏳ |
| D4 | One client, many tabs: a second tab reflects a write made in the first instead of holding its own copy of the workspace | ⏳ |

**D1 — the client's copy is a cache.** The store currently reseeds on a version
mismatch, which is the right *policy* for a fixture (a shape change invalidates the
snapshot) and the wrong one for a workspace's own data. Splitting the two — a shape
change that must reseed versus a schema change that can migrate — is what makes D2
possible at all, because a queue is precisely the data that must survive a reload.

**D2 — a write that has not landed.** A command's operation id is what makes a
retry safe: the phone in a basement sends the same `moveStock` twice and the shelf
moves once. Per-record ordering (two edits to the same row replay in order; two rows
do not wait for each other) is the local half of the rule, and the id is the shape
the API needs (`Idempotency-Key`, or a client-minted id on the row itself).

**D3 — saying "pending" out loud.** Optimistic screens are already this port's habit
(the scheduler's pane flags an overbooking and lets it through). D3 extends the same
honesty to persistence: a row that is written locally and not acknowledged says so,
and a failure keeps the row rather than discarding the person's work.

**D4 — two tabs, one client.** Today a second tab loads its own copy and last-write
wins on the blob, which is silently the multi-user problem with one user. Either the
tabs share one store through events, or one is designated the writer; either way the
increment states which, because the alternative (two tabs, two truths) is exactly the
failure mode the API exists to prevent.

**Acceptance criteria (D).** Pulling the plug mid-write loses nothing a person typed:
the command is still queued, still visible, and lands once when the seam answers.
A reload with a queue in flight does not double-post. A second tab shows the first
tab's write. A store that cannot be written says so rather than appearing to save —
and every one of these is asserted by a harness, since a browser is not available.

## Phase E — tenant administration: the workspace manages itself

The workspace's own rows are the last ones with no screen. Administration holds
Locations, Categories and the module switches; the people who may sign in are seeded
constants, `ROLES` is a code constant (with a `desc` per role), and a licence is an
array on the tenant (`disabledModules`). E is where this project has to answer the
questions the earlier phases deliberately left standing:

- **Is a role a row, or a constant?** Today `ROLES` in `models.ts` *is* the
  definition and a `user.role` carries a key — six bundles, one per job. A workspace
  that wants its own bundle needs `role_permissions(role_id, permission)`; a
  workspace content with the six needs nothing. The increment states which it builds
  and why, rather than appearing to support both.
- **Who granted a licence, when does it expire, what does it cost?** DATA-MODEL
  already says the flags should be rows for exactly this reason — the licence grows
  columns a `boolean` on a tenant cannot hold.
- **Are `tenants` and `users` stamped after all?** They are the two declared
  exceptions to `auditedRows()` (a workspace is created by the platform, a person by
  a sign-up). An *admin* action is somebody's write, so E either stamps them — and the
  exception shrinks to the platform's own path — or puts that audit line elsewhere
  and says where.

**In scope.** Workspace settings (name, plan, vertical, licence flags) with the audit
of who changed them; people (invite, role, deactivate — never delete, because the
audit columns and `movements.by_user_id` point at them); the role question above; and
the invitation path that makes B's sign-in reachable for a person a workspace
actually creates, not only for a seeded row.

**Deliberately not E.** Creating a *tenant* at sign-up is a platform path and the two
consoles are not the same screen (state the split; build the tenant admin). Billing,
subscription lifecycle and plan enforcement are not modelled. Per-vertical view
gating and titles stay where open decision 2 leaves them.

| # | Increment | Status |
|---|---|---|
| E1 | The workspace screen: name, plan, vertical and licence flags as rows a person edits, each write attributed | ⏳ |
| E2 | People: invite/list/edit/role/deactivate for the signed-in tenant, with the refusal a role cannot be granted by someone who lacks it | ⏳ |
| E3 | The role question answered: roles as rows with permissions, or code bundles plus explicit per-user grants — stated, built and checked | ⏳ |
| E4 | The exception resolved: `users` (and the licence rows) carry who made them, or the doc records where an admin write is audited instead | ⏳ |

**E1 — the workspace as a row a person edits.** A tenant's plan and vertical are
already read by the app (the plan by nothing yet, the vertical by A7's registry), so
the screen is what makes them *writable* — and the licence flags become rows with an
actor and a date, which is the change DATA-MODEL predicted.

**E2 — people.** A user row is created by an invitation, and the invitation is where
B's sign-in stops being a demo: the invitee holds a credential, a role and an
`active` flag, and a person who leaves is deactivated rather than deleted. The
permission question is asked here too: may a manager invite, or only an owner? —
`users.manage` already exists as a capability, so the answer is data, not a condition
in the component.

**E3 — the role question.** Whichever way it is answered, the answer has to keep A1's
thesis intact: a screen asks a capability, never a role name. Rows for roles change
*where* the bundle is stored; they must not change *what* the screens ask.

**E4 — the exception.** The declared exceptions in DATA-MODEL's map are honest today
because nothing in a workspace creates a tenant or a person. E does, so the doc's
exception list is either narrowed (an admin's create *is* stamped) or replaced by a
named audit path, and the reverse check in `check9` is updated to hold whichever
answer ships.

**Acceptance criteria (E).** An administrator can create a person in their own
workspace, give them a role, and that person can sign in (B) and see exactly what the
role allows (A1) — with a stranger unable to do any of it. Turning a module licence
off hides its nav entry and blocks its routes for that workspace (the mechanism A1
already proved), and the write that did it names the person who did it. No screen
compares a role name to decide what to show.

## Open decisions (need the owner's call)

1. **"One SKU, one place" — settled: a SKU lives in as many places as it holds
   stock in.** The owner called it, and A6 is in. The shape delivered is exactly
   the one this doc described: `stock_levels(item_id, location_id, qty)` with
   `qtyOnHand` as its sum, one row per pair *while it holds something*, and the
   row's `locationId` kept as the place holding the most (a derived home, written
   by the same call that sums the levels). The increment did not decide whether a
   *kit* or an *attachment* (an owned count, not a shelf quantity) should also be
   held in levels; **A8's schema states it rather than implying it** — they keep
   one place and a `qty`, and the doc says so and says why. The other half is
   still open: how a stock *transfer between tenants' sites* would read (the same
   table with both sites' locations, which is why the FK is a location and not a
   tenant).
2. **What a vertical does *not* yet carry (A7's leftovers).** The registry holds the
   catalog's shape, not everything industry-shaped in the app. Still decided
   elsewhere, and each wants an owner's call before it moves:
   **per-vertical category seeds** (a clinic's supplies are grouped nothing like a
   yard's), **per-vertical search wording and view titles** (the shell's `VIEWS`
   titles are static — "Assets" is every vertical's page name even where the
   registry calls the rows "Supplies"), and **per-vertical view gating** (a
   warehouse has no scheduling). All three are deliberately outside the registry so
   far: two are permissions or shell concerns, and the third needs a seed-shape
   decision first.
3. **`bin` vs location.** Resolved in A3 by *deleting* `bin` and putting the bin
   into the hierarchy (Aisle → Rack → Bin), because the seeded location types
   already included `Bin` — i.e. two models of one fact. If the real yards keep a
   printed shelf label that is not a hierarchy node, say so: A3's commit is the
   thing to revert, and the alternative is `bin` becoming the label *within* a
   location (a composite key the hierarchy alone can't express).
4. **Phases B–E — settled: they are recorded above.** The owner stated the titles
   and their order (authentication, the API seam, persistence/offline, tenant
   administration), so each now has a section with its scope, what it deliberately
   excludes and its acceptance criteria, and Phase B has its increments (B1–B3)
   written out. The order is not arbitrary: B gives the request a principal, C gives
   the principal a transport, D makes the client honest about the server's authority
   and E administers the things B–D establish. Each phase's increments are still
   scoped in full before that phase's own work starts — the way A11.2 was — and each
   phase adds its own harness (`check14` onward) while leaving every earlier check
   green.

## Verification recipe

```bash
npm run build          # AOT + strict templates
npm run check:store    # 182 runtime checks against the real store, no browser
npm run lint:ctor      # class-field initializer order
npm run lint:styles    # duplicate/unused stylesheet rules
```

There is no Chrome on the dev box, so Karma can't run. Instead
`npm run check:store` (`scripts/check-store.sh`) compiles the core services with
`tsc` into a temp dir and runs the harnesses in `scripts/runtime-checks/`, which
hand-roll `localStorage` and assert on the store's own output:

- `check.mjs` — **A1, 9 checks:** tenancy, roles/`can()`, tenant licence flags,
  session switching, the schema-bump reseed.
- `check2.mjs` — **A2, 8 checks:** seeded rows backfilled, new rows stamped,
  edits stamped without smearing untouched rows, movement authorship, deletion.
- `check3.mjs` — **A3, 12 checks:** the seeded hierarchy, `locationPath()` /
  `locationLabel()`, the depth-first option walk and its cycle guard, every stock
  row placed (and labour deliberately not), the `bin` string gone, the same
  warehouse rule for shop units, `itemsAtLocation()` direct vs. subtree, the
  block-on-contents removal guard, and an edit re-pointing the FK.
- `check4.mjs` — **A4, 11 checks:** the seeded ledger carries FKs and no display
  string, each seeded movement left from where its own unit sits, the path reads
  back, `movementsAtLocation()` at a node vs. its subtree, the store-resolved
  issue place, a return that re-homes the unit, the earlier issue keeping its old
  place, a caller-chosen place on a non-return, both removal blockers (stock and
  history) and that an unreferenced node still removes.
- `check5.mjs` — **A5, 16 checks:** supplier roles partition the partner table,
  the three PO states with progress derived from receipts (no stored received
  column), units created / SKUs topped up at the ordered cost, a moving-average
  cost, every receipt line placed at the receipt's location, one movement per
  landed row carrying the receipt id, a second receipt completing a partial
  line, the refusals that write nothing (over-receipt, draft, cancelled,
  unknown, mis-located), edits that contradict arrivals, the removal guard,
  attribution + receipt immutability, store-assigned line ids, a reload that
  restores the receipts instead of posting them twice, and the partner-creation
  path.

- `check6.mjs` — **A5.1, 14 checks:** the fixture ledger carries only the kinds
  the fixture can produce (no hand-written transfer/adjust), a move re-placing the
  *stock* and logging one transfer at its destination (readable per row and per
  location, old place as the default note, the emptied source losing its row), a
  unit row moved whole, a count logging one signed adjustment at the place it was
  taken, counting one bin leaving the other bin's stock alone, a bulk count keeping
  owned = available + out (so `capacity()` is untouched), status following the
  count both ways, seventeen refusals that write nothing (matching/negative/
  no-such-place/unknown-row/uncountable counts, same-place/no-such-place/
  no-such-source/unknown-row/zero/over-quantity/empty-source/partial-unit
  refusals, labour, a unit that is out), a reorder raising a draft with the
  shortfall line **without moving on-hand**, a draft being unreceivable until a
  supplier is named (then the receipt moves it), every sub-rental naming a
  supplier party, and a vendor-less sub-rental being refused.

- `check7.mjs` — **A6, 14 checks:** the fixture's levels (a row only while it
  holds stock, the composite key written out, only counted types in the table) and
  the invariant underneath the increment (every counted row's total equals its
  levels' sum), the part the fixture keeps in two bins with a count in each, the
  unit/labour answers from `placements()`, a move taking *part* of a place away
  (source keeps the rest, destination gains it, one movement, an emptied place
  losing its row, the total unmoved and the home following the biggest holding), a
  move into a place that already holds the row adding to it, a receipt landing as
  a level (a *new* place for the same SKU, then the same composite key topped up),
  the place readers (`itemsAtLocation`, `locationStockQty`) following the shelves,
  the removal guard blocked by stock and released when the place empties, that
  guard still blocked by the *history* a count leaves, a counted row refusing an
  edit that would move stock (while a unit row obeys one), a new row's opening
  balance at its opening place (and no movement for it), a removed row taking its
  levels with it, the shelves surviving a reload, and the table read directly as
  a report.

- `check8.mjs` — **A7, 9 checks:** every vertical has an entry (each with a label,
  a noun, tabs and a default tab it actually carries) and an unknown key falling
  back to the default catalog; every tab naming a real `CatalogType` once, with a
  label, an icon, an "add" wording, columns and a default status/count the type's
  editor offers; **every column naming a field the model actually has** (the guard
  that caught a warehouse bulk line reading a `qtyOnHand` a bulk row doesn't
  store); the store reading the *tenant's* vertical and following a switch live;
  flipping the vertical changing tabs, order, labels and the opening tab (yard →
  clinic → warehouse); the columns following the vertical rather than the type
  (the same part, priced in one industry and not the other); a new record starting
  as the vertical's default rather than a constant; the terminology being data (a
  lumberyard's "New Bulk Material", no rental rate column); and the verticals
  being distinct entries with more than one tab shape.

- `check9.mjs` — **A8, 10 checks:** `docs/DATA-MODEL.md` against `models.ts` —
  every model named in the doc and every table heading naming a real model; every
  documented column a field of that table's type (with only the audit columns, a
  declared rename and a declared parent/map key allowed to differ); **`NOT NULL`
  agreeing with the type's optionality**, so a nullable field is never documented
  as required; every table `auditedRows()` writes appearing in the map, with a
  section — **and the other direction: every mapped table that names a store key
  being one `auditedRows()` writes, unless the doc declares it an exception** (so
  a settings table written without stamps fails the harness); every enum matching
  its union member for member, and every column type being a documented enum or a
  scalar; every `REFERENCES` naming a real table; the five derived stock columns
  the doc marks derived being exactly `DERIVED_STOCK_KEYS`; and the per-type status
  table matching `ITEM_STATUSES`.

- `check10.mjs` — **A9, 10 checks:** every configuration row (location types,
  categories, tax schedules, overheads, the `pricing` and `yard` singletons)
  carrying all five stamps after the seed backfill, each naming a user the store
  resolves; a category added in-session attributed to the acting user; an edit
  (`updateTaxSchedule`, `updatePricing`) re-stamping `updatedBy` while the create
  stamps stand; **a rename keeping the row it renamed** — the natural key moves, so
  the stamps must follow the row (checked for a location type *and* a category,
  which is what fails if the writer keys rows by name alone); a settings write not
  smearing its neighbours; and the whole settings surface still stamped after an
  unrelated write.

- `check11.mjs` — **7 checks:** the day/week/month window the two Purchasing &
  Receiving lists filter by (`periodBounds()`, shared with the inspection log) —
  a day is its own day, a week is Monday→Sunday *wherever* the cursor sits in it
  (Sunday's `getDay()` of 0 is the case a naive offset gets wrong), a month is the
  1st to its last day including a leap February, and the pager's label names the
  window the filter selects (the cursor has to be the period's first day, which is
  why `setRange()` snaps it). Then the fixture's own dates: a purchase order is
  dated by the *day* it was raised and a receipt by the instant it was posted, so
  the day/week/month windows select exactly the documents the seed intends — a
  month, a week that straddles a month end, and a single day.

- `check12.mjs` — **A10, 6 checks:** the order's customer is a join — no order row
  carries a name (`'party' in o` is false), the store resolves one for every
  seeded order from `parties`, and a **rename reaches every contract without
  writing an order row** (the test a stored copy cannot pass: the order's own
  `updatedAt`/`updatedBy` stand while the name it prints changes). Then the FK
  that makes the derivation safe: a party named by an order is refused removal for
  every order in the fixture, the buying side and the sub-rentals are in the same
  list (a PO's supplier, every receipt's supplier, a sub-rental vendor), and a
  party nothing points at still removes — the guard is a guard, not a freeze.

- `check13.mjs` — **A11 + A11.2, 14 checks:** a negotiated rate is a join like the name
  is, and the invoice bills it whole.
  Every card in the fixture names a real party and carries its stamps; one order
  bills at its customer's card (the weekly basis prints the *card's* `baseWeekly`,
  the one-time types its `unitPrice`, and the Gross is the sum of them); and the
  **catalog keeps its own list prices** while a party with no card bills exactly
  what it billed before cards existed. Then the window: an expired card prices
  nothing (Meridian's 2025 rates leave CT-2024-002 at the catalog's 1325 x 3, and a
  card created for them moves the same line to 995 x 3, then removing it puts the
  catalog back — the test a fixture-only coincidence cannot pass). Repricing a card
  moves the Gross **without writing the order row** (A10's test, in money), a card
  for one customer does not touch another's order, the buying side takes a
  supplier's card as the editor's *default* while the raised PO keeps the price it
  was ordered at, the dashboard's reorder draft (a line and no supplier) lands on
  the agreed price the moment a supplier is picked — one rule, `poLineCostFor()`,
  behind both fills — and removing a card — a row nothing references, so it needs no
  guard — sends the booking back to the catalog rates. Finally the FK A11 added
  joins the party guard: a party whose only row is a rate card cannot be removed
  either (the card has to go first), which is what keeps `price_cards.party_id`
  from dangling the way a removed `orders.party_id` would have.

  A11.2's five checks take that rate through the invoice. A fixture cycle bills **whole
  weeks** (2325 for the boom lift's week — explicitly not `2325 x 8`, the day-multiplied
  figure it replaced) and a monthly party's 28 days one monthly unit, premium applied
  once; the fee chain is asserted against the *period's* base rather than the order's
  Gross (env fee from the invoice's snapshot, the waiver 3% as the prototype computes it,
  tax on the lot); the cycle length is the **party's** (7, 14 and 28 days, each matching
  its fixture cycle, with a cadence the store doesn't know falling back to
  `pricing.cycleDays`); a booking's cycles **tile it and sum to the Gross** — asserted
  per line and on the bases, with a settled cycle still rolling and no `$0` cycle raised
  once the days run out; and the basis steps on the **line's own days** (a three-day
  line inside a 24-day order bills the daily rate, and the invoice agrees), which is the
  second day-source bug the same audit found.

- `check14.mjs` — **B1, 14 checks:** a credential is a table, not a field — the store
  keeps one row per person beside `users`, its digest is the **documented rule**
  recomputed with an independent implementation (`sha256(salt + ':' + password)`, so a
  literal that drifts fails loudly), the salt is per person (no two rows share a salt
  or a digest), and a `users` row carries none of it (no salt, digest or password
  travels with the row every list and audit block prints). Then the sign-in path:
  a seeded credential signs that person in and their role and tenant travel with them;
  the address matches case-insensitively and trimmed; a wrong password is refused
  `'invalid'` without moving an existing session; an unknown address answers
  **exactly** the same, so the form cannot enumerate accounts; a deactivated person is
  told `'inactive'` — but only after the credential proves (with a wrong password they
  learn nothing); and no answer, nor the persisted session, carries the credential.
  Finally the session's honesty (the bug this increment fixes): signing out leaves
  `activeUser` **undefined** rather than falling back to the first user, the
  `SessionService` signal follows, an empty session holds no capabilities — and the
  state is persisted both ways (a reload stays signed out; a reload of a signed-in
  session is still that person).

- `check15.mjs` — **B2, 7 checks:** the session is *required*, and the demo stays
  enterable. The store can no longer assert an identity — `setSessionUser()` and
  `setSessionTenant()` are gone and `signIn()` / `signOut()` are the only ends of a
  session; the fixture's pick-list names every seeded person (nobody invented) and
  carries no salt or digest, only the password this build publishes; **every published
  pair really signs in as that person, with the role its row names** (the test a stale
  hand-written list cannot pass); and the pick-list's labels are true — the viewer
  signs in and holds read, not count or people. Then the wiring no component would
  prove without a browser, read as source text the way check9 reads the model: every
  screen route is a child of the parent carrying `requireAuth` and `/signin` is the
  one route outside it (bracket-matched, so a route added later is *checked* rather
  than assumed), the guard asks the session to continue (`session.touch()`, B3) and
  carries `?next=` so a deep link survives, and the shell offers Sign out — with no
  `switchUser`, no `session.users()` and no "Switch user" left in it.

- `check16.mjs` — **B3, 10 checks:** a session has an *end*, and the client does not own
  it. Signing in stamps a readable expiry that is ahead of now and is a window rather
  than for ever; a session with time left is **rolled** (handed a stamp a minute out,
  the touch moves it further out — and by the same window sign-in writes, so there is
  no second number); a session whose stamp has passed is refused `'lapsed'` **and
  cleared**, and — the stronger half — it has already stopped *acting as* that person
  before anything clears it: `activeUser` is `undefined`, `sessionUserId()` is `''`,
  `can()` answers no rights and an attributed write lands with no author; and a stamp
  that is empty or unparseable is a lapse too, never an unlimited session. Then the
  shape that makes the window the server's: `touchSession()` takes no argument and
  `signIn()` takes a credential, so there is nowhere to pass a lifetime; a session is
  stamped in exactly two places (where it starts and where it is rolled); and — read as
  source text — the guard treats the touch as activity and marks **only** a lapse
  (`?expired=1`, which the form renders as an explanation), while a first visit is not
  told it timed out. The harness never sleeps: an expiry it would have to *live
  through* is an expiry no check can hold, so it hands the store snapshots instead.

- `check17.mjs` — **C1a, 7 checks:** the API seam says *which* calls read and which
  persist, and the check re-derives that from the store rather than trusting the file.
  A command is a method that runs `save()`, or one that calls a method which does — the
  five composites (`punchIn`, `punchOut`, `raiseReorder`, `closeInspection`,
  `setWorkOrderStatus`) are asserted to *not* mention `save()` themselves and still be
  commands, which is the misclassification a hand-written list makes. Then the halves are
  exhaustive and disjoint (every public member, and the two public fields `revision` /
  `reseeded`, on exactly one side); the contract is `Pick`s over the store with no
  hand-copied signature in the file; the two compile-time assertions exist (membership is
  a build failure, not a runtime one); and the app is wired through `IMS_API` with
  `useExisting: DataService` — the store answers the contract, as the same instance, and
  no `useClass` anywhere.

- `check18.mjs` — **C1b, 4 checks:** the sweep that makes the contract binding for the
  *screens*, checked by walking every `.ts` under `src/app`. The store class must be
  named in exactly two files — its own and `api.ts`; every one of the 22 injection sites
  must name `IMS_API` and type the parameter as `ApiAdapter` (the tooltip builders, which
  take the store as an argument, take it the same way); nothing outside the seam may ask
  Angular for the class as a token; and nothing may construct a second store. This check
  exists because the compiler does *not* catch the regression it guards: injecting the
  class again compiles and runs, so a view would quietly go back to depending on the
  implementation.

Add a check with each increment — the seed is the fixture, so a harness check is
the cheapest way to prove an invariant still holds.

## Conventions worth restating

- A new table must be added to `DataService.auditedRows()` or it is written
  without tenant/author stamps — and `check9` fails if the document's map names a
  store key the writer never covers (unless the doc declares the table an
  exception, which only `tenants`, `users` and `user_credentials` are).
- A new seed shape must bump `VERSION`, and the shell must keep telling the user
  their data was replaced.
- A new screen is a child of the guarded route parent, never a sibling of it
  (B2): `check15` reads the route map and fails if a `component:` route sits outside
  the parent that carries `requireAuth`. The same harness fails if the store grows a
  way to set the acting person without a credential.
- A session's *lifetime* belongs to whoever issues it (B3), so nothing in the client
  takes one: `signIn()` is handed a credential, `touchSession()` is handed nothing,
  and the stamp (`session.expiresAt`) is read rather than chosen. An expiry that
  cannot be read is a lapse, not an unlimited session — `check16` fails if a stamp
  appears anywhere but the two places that write one.
- A new public member of the store must be classified in `api.ts` (C1a). Naming it in
  neither union is a **compile error** (`NothingOutsideTheContract`), and putting it on
  the wrong side fails `check17`: a command is a method that persists, directly or
  through another command it calls.
- A new view injects `IMS_API` and types it `ApiAdapter`, never `DataService` (C1b).
  The compiler will not stop you — the class is still injectable — so `check18` walks
  `src/app` and fails, which is the only reason the seam stays a seam.
- Display strings are resolved at read time (`userName`, `locationPath`,
  `partyName`), never stored — an order names its customer by FK and nothing else,
  so a rename on the Parties grid reaches every contract without touching a single
  order row (A10).
- Rates are resolved the same way (A11): one reader (`cardRateFor()`) feeds both
  the printed rate and the line total, and the catalog keeps its own list prices
  underneath. Anything a counterparty *agreed* is read through the FK; anything a
  document *states* (a PO line's `unitCost`) is the document's own fact. A default
  is one rule too (`poLineCostFor()`), never an inline `??` chain in a form —
  anywhere the same figure is filled twice, the two copies will drift.
- A rental bills in **whole units** of its basis (A11.2), never `rate x days`: a week
  is a week and a month is a month, and each unit belongs to exactly one billing
  period, so a booking's cycles add up to its Gross and none of them double-bills.
  The *period* length is a counterparty term as well (`partyCycleDays()` reads
  `parties.billing_cycle`) — when a figure is per-party, the schedule that repeats it
  is read from the same party, not copied onto the document.
- A movement's place is *derived*, not asked for: the store resolves it from the
  unit (`logMovement`), so a hand-off can't be logged somewhere the machine never
  was. Only a `return` re-homes a unit — the shelf follows the ledger, and the
  ledger never follows the unit.
- A stored FK must stay resolvable, so a place can only be removed while nothing
  points at it (stock *and* log rows) — `locationRemovalBlockers()` is the single
  list both the guard and the grid's disabled button read.
- A document that moved stock is append-only: a posted receipt has no edit and no
  delete, and a PO that delivered can't be cancelled or shrunk. Correct a mistake
  with a new movement, never by rewriting the document that caused it.
- Stock arrives through `receiveAgainst()` and nowhere else. A counter that no
  document backs (`qtyOnHand`, a PO's "received" total) is a bug waiting to
  happen — sum the receipts instead.
- A reorder is a document too: `raiseReorder()` raises a **draft purchase order**
  and names no supplier, because "what should we buy" and "who from" are two
  decisions and only the first belongs to a button.
- Placement and count are *movements*, not fields: `moveStock()` and
  `adjustStock()` write the ledger as they write the row, so `transfer` / `adjust`
  are never logged by hand and a difference always has an author, a place and an
  instant. Editing an item's location directly is a data fix, not a stock
  movement.
- **A counted row's quantity is a table, not a number.** `stock_levels` (one row
  per item + place, only while it holds something) is the truth; `qtyOnHand` /
  `qtyAvailable` / `totalOwned` are its sum and `locationId` is its busiest
  holding, recomputed by `syncStockTotals()` after every level write and never
  written by a mutator — a patch carrying them is stripped, because a field edit
  that moved stock would leave a number nothing accounts for.
- A *place* is emptied by the movement that empties it, not by a delete: an
  emptied level row leaves the table, and a count to zero still logs its movement
  at that place — so history keeps the place alive after the shelf is clear (the
  same rule A4 set for the ledger).
- Opening balances are levels without movements: stock a workspace already owns
  arrived by no operation the app can name, so `createItem` writes one level row
  and logs nothing — exactly how the fixture places its own stock.
- **A vertical is metadata, not a conditional.** Which tabs a catalog exposes, in
  what order, what each is called, what its "add" button says, which columns its
  grid prints and what a new record starts as live in `core/vertical-metadata.ts`
  and are read from the tenant (`DataService.verticalMeta()`). A page may ask the
  store for them; it may not keep a vertical map of its own, and a column may only
  name a field the model already has (check8 fails if it doesn't).
- A vertical shapes the *catalog*, not permissions: what a workspace may use is the
  module licence (`Tenant.disabledModules`), and the two must not be conflated —
  hiding a tab is not denying a right.
- **The schema is a document, not an inference.** `docs/DATA-MODEL.md` is the
  spec the API is built from, and it is kept in step with the code by `check9`:
  add a model and it needs a table, add a field and the table needs the column,
  write a `NOT NULL` the type does not promise and the harness fails. A column the
  model does not have is a bug in the doc — so a new field is proposed in
  `models.ts` (and used) first, then written down.
- **Configuration is a tenant's data, so it is stamped (A9).** A settings row
  (`location_types`, `categories`, `tax_schedules`, `overheads`, `pricing`,
  `yard`) is written by a person in Admin, so it is in `auditedRows()` like any
  other table. Two consequences worth knowing before editing one: it has no
  surrogate id, so the writer keys it by its **natural** key
  (`location_types.name`, `categories.type` + `name`, `tax_schedules.code`), and
  because a rename mutates that key in place the writer **follows the row** — a
  rename is an edit, never a delete plus a create. Only `tenants` and `users` are
  outside the writer, and `docs/DATA-MODEL.md` declares both as exceptions with
  the reason; a new table needs a `store key` in the doc's map *and* an
  `auditedRows()` entry, or `check9` fails.

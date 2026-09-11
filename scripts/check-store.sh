#!/usr/bin/env bash
#
# Runtime checks for the store + core services, with no browser.
#
# There is no Chrome on the dev box, so Karma can't run: instead the services the
# checks exercise are compiled with tsc and the harnesses in
# `scripts/runtime-checks/` drive the *real* DataService against a hand-rolled
# localStorage. That keeps A1 (tenancy), A2 (attribution), A3 (the item↔location
# spine), A4 (the ledger's place) and A5 (purchasing → receipt → stock) honest
# without a UI, and it fails loudly if a seed edit or a new mutator breaks an
# invariant.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

cd "$ROOT"
npx tsc src/app/core/data.service.ts src/app/core/session.service.ts src/app/core/modules.service.ts \
  src/app/core/vertical-metadata.ts \
  --outDir "$OUT" --module es2022 --target es2022 --moduleResolution bundler \
  --experimentalDecorators --skipLibCheck --strict false

# TypeScript leaves the relative imports extensionless (the Angular bundler
# resolves them); Node's ESM loader needs the real file name.
perl -pi -e "s|from '(\./[A-Za-z._-]+)'|from '\$1.js'|g" "$OUT"/*.js
# The services import @angular/core (signals, @Injectable); point Node at the
# installed packages rather than installing anything for this.
ln -s "$ROOT/node_modules" "$OUT/node_modules"
cp scripts/runtime-checks/*.mjs "$OUT/"
# check9 compares the data-model document with the model source, and TypeScript
# types do not survive tsc — so the two sources it reads are copied as text.
cp src/app/core/models.ts src/app/core/data.service.ts docs/DATA-MODEL.md "$OUT/"
# check15 reads the route map, the auth guard and the shell as text (importing them
# would pull Angular components into Node), so they travel with the sources above.
cp src/app/app.routes.ts src/app/core/auth.guard.ts src/app/app.component.ts src/app/app.component.html "$OUT/"
# check16 reads the sign-in form the same way (its wording, and where it gets the mark).
cp src/app/features/sign-in/sign-in.component.ts src/app/features/sign-in/sign-in.component.html "$OUT/"
# check17 reads the contract (api.ts) and the app's wiring as text: the split is a list
# of names, and the check re-derives it from the store's own source.
cp src/app/core/api.ts src/app/app.config.ts "$OUT/"
# check18 proves the C1b sweep: it walks every source file under src/app, so the tree
# travels too (as text — it asserts on names, not on behaviour).
mkdir -p "$OUT/src" && cp -r src/app "$OUT/src/app"

cd "$OUT"
node check.mjs && node check2.mjs && node check3.mjs && node check4.mjs && node check5.mjs && node check6.mjs && node check7.mjs && node check8.mjs && node check9.mjs && node check10.mjs && node check11.mjs && node check12.mjs && node check13.mjs && node check14.mjs && node check15.mjs && node check16.mjs && node check17.mjs && node check18.mjs

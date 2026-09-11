#!/usr/bin/env bash
#
# Runtime checks for the store + core services, with no browser.
#
# There is no Chrome on the dev box, so Karma can't run: instead the services the
# checks exercise are compiled with tsc and the harnesses in
# `scripts/runtime-checks/` drive the *real* DataService against a hand-rolled
# localStorage. That keeps A1 (tenancy), A2 (attribution) and A3 (the
# item↔location spine) honest without a UI, and it fails loudly if a seed edit or
# a new mutator breaks an invariant.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

cd "$ROOT"
npx tsc src/app/core/data.service.ts src/app/core/session.service.ts src/app/core/modules.service.ts \
  --outDir "$OUT" --module es2022 --target es2022 --moduleResolution bundler \
  --experimentalDecorators --skipLibCheck --strict false

# TypeScript leaves the relative imports extensionless (the Angular bundler
# resolves them); Node's ESM loader needs the real file name.
perl -pi -e "s|from '(\./[A-Za-z._-]+)'|from '\$1.js'|g" "$OUT"/*.js
# The services import @angular/core (signals, @Injectable); point Node at the
# installed packages rather than installing anything for this.
ln -s "$ROOT/node_modules" "$OUT/node_modules"
cp scripts/runtime-checks/*.mjs "$OUT/"

cd "$OUT"
node check.mjs && node check2.mjs && node check3.mjs

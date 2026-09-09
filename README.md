# IMS — Angular Port (ims-web)

**Angular 19.2 (standalone).** This is the migration home for the IMS product
(replacing the vanilla-JS prototype in the sibling `IMSdev` repo and its minimal
.NET static host). The port is **core-first**: an Inventory Management System
core with opt-in industry modules layered on top. It is being written incrementally,
porting one feature at a time from the prototype (source of truth).

## Run locally

```bash
npm install        # once
npm start          # dev server → http://localhost:4200 (hot reload)
npm run build      # production build to dist/ims-web
```

## Structure

```
src/app/
├── core/
│   ├── models.ts        # Typed domain models + catalog type registry
│   └── data.service.ts  # Typed in-memory store + localStorage persistence (the apiAdapter seam)
├── features/
│   ├── dashboard/       # Landing + port roadmap
│   └── categories/      # Categories & Types (first ported core view — the pattern-setter)
├── app.component.*      # Shell: sidebar (Core vs Planned groups) + topbar + router outlet
├── app.routes.ts        # Core-first route map
└── app.config.ts
```

## Port pattern (per feature)

1. Add/extend typed models in `core/models.ts`.
2. Add/extend a table in `core/data.service.ts` (seed + repo accessors + persistence).
3. Create `features/<name>/` components that read/write through the service.
4. Register the route in `app.routes.ts` and the nav group in `app.component.ts`.

The `DataService` mirrors the prototype's `IMS.store`; a future `HttpClient`
adapter replaces its synchronous methods (the `apiAdapter` contract) without
touching feature code.

## Port roadmap

- [x] Foundation: shell, typed data store + persistence, routing, Categories & Types.
- [ ] Parties & Orders (core) — parties list + order headers.
- [ ] Items & Stock (core) — typed catalog + item registry.
- [ ] Item Hand-Off & Custody (core) — movements / issue-return.
- [ ] Industry modules (allocations, dispatch, telemetry, labor, service, rentals,
      billing) as lazy-loaded guarded routes once the module registry is ported.

Design tokens, modal, and column-profile specs live in the prototype repo under
`docs/architecture/` (`modal-design-spec.md`, `app-review-*.md`, `AI-ONBOARDING.md`).

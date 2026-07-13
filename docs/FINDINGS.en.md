# Deep Architecture Review — `daggerok/csv`

Review date: 2026-07-13  
Reviewer role: Solution / Software Architect

## Scope

This review covers the current state of the repository, with focus on:

- runtime architecture
- parsing correctness
- scalability and performance
- privacy and security posture
- maintainability and delivery quality
- developer experience and documentation consistency

## Validation performed

I validated the repository with the following checks:

- source review of `README.md`, `package.json`, `src/main.tsx`, `src/index.css`, `.github/workflows/ci.yaml`
- `npm install --ignore-scripts`
- `npm run build` ✅
- ad-hoc TypeScript compile of `src/main.tsx` with `tsc --noEmit` ✅
- `npm test -- --runInBand` ❌ — fails because no tests exist
- `npm audit --json` ⚠️ — 3 vulnerabilities, all coming from `pm2` in dev dependencies
- `npm audit --omit=dev --json` ✅ — production dependency graph is clean

## Executive summary

This repository is already a useful **local-first CSV utility** and shows strong product intuition for the target use case: messy brokerage exports, quick inspection, filters, sorting, merge mode, sticky headers, and client-only processing.

However, from an architectural perspective, I would classify the codebase as:

- **good prototype / strong personal tool**
- **not yet a safe long-term product foundation**

The biggest architectural concerns are:

1. **too much logic concentrated in one file**
2. **all parsing and rendering happens on the browser main thread**
3. **the custom CSV heuristic can silently alter data**
4. **sensitive financial data is persisted locally by default**
5. **settings are global by column index, which causes cross-file collisions**
6. **quality gates are weak: no tests, no lint/typecheck gate in CI**
7. **documentation/toolchain drift increases maintenance cost**

## Overall rating

| Dimension | Rating | Notes |
|---|---:|---|
| Product usefulness | 8/10 | Very good utility for interactive review of CSV exports |
| Architectural maturity | 5/10 | Works now, but difficult to scale safely |
| Maintainability | 4/10 | Monolithic implementation and weak isolation of concerns |
| Correctness confidence | 5/10 | Build passes, but parser/filter/export logic is under-tested |
| Performance headroom | 4/10 | Fine for small/medium files; risky for large data sets |
| Privacy posture | 5/10 | Client-only is good, but default persistence is risky |

## Key strengths

### 1. Clear product intent
The application is focused and coherent. It solves a real user problem instead of trying to become a generic spreadsheet clone.

### 2. Local-first design
The app keeps data in the browser and avoids backend complexity. That is a strong fit for privacy-sensitive financial CSV exploration.

### 3. Thoughtful UX features
The repository already includes useful user-facing capabilities:

- sticky headers / sticky first column
- natural file sorting
- per-column sorting and filtering
- merged and per-file CSV export
- dark mode
- configuration export/import

### 4. Good awareness of React StrictMode issues
The boot-restore flow and paint-aware loading state show above-average attention to UI lifecycle edge cases.

### 5. Build is currently healthy
The app builds successfully, and an ad-hoc TypeScript compile passed.

---

# Findings

## F-01 — Monolithic architecture with very high change coupling
**Severity:** High

### Evidence

- `src/main.tsx` is ~1,673 lines and contains:
  - parsing logic
  - type detection
  - filtering engine
  - CSV export
  - localStorage persistence
  - loading orchestration
  - UI components
  - app composition / bootstrap
- See especially `src/main.tsx:249-404`, `658-722`, `745-1662`.

### Why it matters

This structure makes the code easy to start, but expensive to evolve.

Current risks:

- one change can break unrelated behavior
- parser logic is hard to test independently
- UI reviews are noisy because domain logic and presentation are interleaved
- onboarding time increases as the file grows
- future features will likely increase merge conflicts and regression risk

### Architectural impact

The codebase is optimized for **speed of initial delivery**, not for **safe iteration**.

### Recommendation

Refactor into a small modular architecture:

- `domain/csv-parser.ts`
- `domain/column-types.ts`
- `domain/filters.ts`
- `domain/export.ts`
- `state/settings-storage.ts`
- `components/LoadingOverlay.tsx`
- `components/ColumnHeader.tsx`
- `components/ColumnFilterInput.tsx`
- `App.tsx`

Keep the UX the same, but move domain logic out of the render file.

---

## F-02 — Performance architecture will struggle on large files
**Severity:** High

### Evidence

- full files are loaded into memory as strings: `src/main.tsx:715-720`
- parsing is performed on the main thread: `src/main.tsx:1260-1279`
- the app stores full datasets in React state: `src/main.tsx:962`, `1279`
- merged mode renders all rows/cells without virtualization: `src/main.tsx:1589-1622`
- non-merged mode also renders every row directly: `src/main.tsx:1639-1645`

### Why it matters

The app is described as “high-performance”, but the current runtime model is still:

- read whole file
- parse whole file
- keep whole data in memory
- render whole table DOM

That model will degrade rapidly when users open large brokerage exports or many files at once.

Typical symptoms:

- long input delay
- browser tab freezes
- large memory pressure
- very slow merge mode
- bad UX on older laptops

### Architectural impact

The spinner improves perceived responsiveness, but it does not change the underlying scaling model.

### Recommendation

Priority improvements:

1. move parsing into a **Web Worker**
2. introduce **row virtualization** for both single-file and merged views
3. consider **streaming / chunked parsing** instead of full-file `readAsText`
4. move persistent large datasets from `localStorage` to **IndexedDB**
5. define performance budgets for rows, columns, and total cells

---

## F-03 — Custom CSV heuristic can silently modify or truncate data
**Severity:** High

### Evidence

- fields are trimmed during parse: `src/main.tsx:376`, `380`
- rows with `targetColLength + 1` columns are accepted and then truncated: `src/main.tsx:398-400`

### Why it matters

For financial data tooling, **silent data mutation** is more dangerous than a visible parsing failure.

Two concrete issues are present:

#### A. Quoted whitespace is lost
Because `currentValue.trim()` is applied to every cell, quoted values such as:

```csv
" ACME ","  keep spaces  "
```

become:

```text
ACME
keep spaces
```

That changes the source data.

#### B. Over-wide rows are silently truncated
A row with one extra column is accepted and cut to the target width.
Example:

```csv
a,b,c
1,2,3,4
5,6,7
```

becomes effectively:

```csv
a,b,c
1,2,3
5,6,7
```

The fourth value is lost without warning.

### Architectural impact

The current parser is optimized for “best effort cleanup”, but it needs a stronger correctness contract.

### Recommendation

1. do not trim quoted field content by default
2. treat schema drift explicitly:
   - reject row
   - quarantine row
   - or surface warning to the user
3. add parser test fixtures for:
   - embedded quotes
   - leading/trailing whitespace
   - multiline quoted values
   - extra/missing columns
   - Fidelity-style preambles/postambles
4. consider using `PapaParse` as the RFC parser layer and keep heuristics as a separate cleanup stage

---

## F-04 — Sensitive data persistence is enabled by default
**Severity:** High

### Evidence

- privacy notice says data remains isolated and secure: `README.md:82-86`
- `rememberData` defaults to `true`: `src/main.tsx:309-320`
- datasets are persisted in `localStorage`: `src/main.tsx:658-669`

### Why it matters

The app is used for brokerage / financial CSVs. Default local persistence creates privacy risk on:

- shared laptops
- family computers
- managed corporate endpoints
- public demo environments

This is not a network leak, but it is still a **data retention risk**.

### Architectural impact

The product message is “client-only and secure”, but the default behavior is actually “client-only and retained locally”. Those are not the same thing.

### Recommendation

1. change default `rememberData` to `false`
2. require explicit opt-in with clear wording:
   - “Store imported data in this browser on this device”
3. add a visible retention notice near the toggle
4. optionally add TTL / auto-expiration
5. document the behavior clearly in README and UI

---

## F-05 — Column settings are global by index, causing cross-file collisions
**Severity:** High

### Evidence

- settings model uses `Record<number, ...>` for custom names, types, filters: `src/main.tsx:255-261`
- headers reuse `settings.columnCustomNames[i]`: `src/main.tsx:1334-1336`
- filters are global and reused across files: `src/main.tsx:1357`, `1404`, `1448`, `1609`, `1634`
- sort state is also global: `src/main.tsx:260-261`, `1345-1348`

### Why it matters

In a multi-file app, “column 0” is not enough identity.

Example:

- file A column 0 = `Ticker`
- file B column 0 = `Date`

If the user renames, filters, or overrides the type for column 0 in one file, the same setting leaks into the other file.

### Architectural impact

This is the main domain-model problem in the repository. The UI supports multi-file workflows, but the settings model is still effectively single-schema.

### Recommendation

Introduce a dataset-aware key:

- `datasetId + columnIndex`
- or `schemaHash + columnIndex`

Suggested model:

```ts
Record<string, Record<number, T>>
```

Where the outer key is stable per imported dataset or per detected schema.

Also decide explicitly which settings should be:

- global
- per dataset
- per schema

---

## F-06 — Documentation and toolchain drift increase maintenance cost
**Severity:** Medium

### Evidence

- README says the app is built with **Bun** and **Vite**: `README.md:2-4`, `34-39`, `45-77`
- actual scripts use **Parcel**: `package.json:10-18`
- CI uses Bun to execute Parcel-based scripts: `.github/workflows/ci.yaml:21-23`, `40-44`
- several direct dependencies appear unused in source review:
  - `clsx`
  - `lucide-react`
  - `recharts`
  - `tailwind-merge`
  - `papaparse`
  - `@types/papaparse`
- `npm audit --json` reports 3 vulnerabilities coming from `pm2` / `ws` / `js-yaml`

### Why it matters

Even when the app builds, drift causes:

- onboarding confusion
- harder upgrades
- unclear ownership of runtime choices
- larger dependency surface than necessary

### Architectural impact

This is a governance issue rather than a runtime bug, but governance issues accumulate and eventually slow the team more than code defects.

### Recommendation

1. choose one documented stack and describe it accurately
2. update README to match reality
3. remove unused dependencies
4. remove or upgrade `pm2` if it is not essential
5. add dependency hygiene checks to CI

---

## F-07 — Quality gates are insufficient for parser-heavy logic
**Severity:** Medium

### Evidence

- `package.json` defines `"test": "jest src"`: `package.json:17`
- running tests fails with “No tests found”
- CI does not run tests, lint, or typecheck; it only builds: `.github/workflows/ci.yaml:21-23`, `40-44`

### Why it matters

The highest-risk parts of the application are exactly the areas that need repeatable checks:

- CSV parsing heuristics
- filter expression grammar
- export correctness
- persistence / restore flows

Without tests, correctness depends on manual usage and memory.

### Recommendation

Minimum test suite:

1. **unit tests** for parser, filter grammar, type detection, export helpers
2. **fixture tests** with real messy brokerage CSV samples
3. **integration tests** for import → filter → export flows
4. **CI gates** for:
   - tests
   - typecheck
   - build

Optional next step: add browser E2E smoke tests.

---

## F-08 — Accessibility and user-facing error handling need improvement
**Severity:** Medium

### Evidence

- empty-state upload target is a clickable `<div>` only: `src/main.tsx:1566-1570`
- file processing errors go to console only: `src/main.tsx:1268-1273`
- invalid JSON import uses `alert(...)`: `src/main.tsx:1252`

### Why it matters

Current issues:

- keyboard users may not be able to activate the empty-state uploader
- failures are not surfaced in a structured way
- `alert()` is disruptive and not ideal UX

### Recommendation

1. replace clickable `<div>` with a semantic `<button>` or labeled control
2. add keyboard and screen-reader friendly affordances
3. introduce non-blocking error toasts / inline notifications
4. collect per-file import warnings and show them in UI

---

# Recommended roadmap

## Phase 1 — Quick wins (1–2 weeks)

- set `rememberData` default to `false`
- update README to match Parcel/Bun reality
- remove unused dependencies
- remove or upgrade `pm2`
- add parser fixtures and basic unit tests
- fix whitespace trimming and row truncation behavior

## Phase 2 — Structural hardening (2–4 weeks)

- split `main.tsx` into domain/state/UI modules
- redesign settings to be dataset-aware
- add CI gates: test + typecheck + build
- improve error reporting in UI

## Phase 3 — Scale readiness (4–8 weeks)

- move parse work into Web Worker
- add row virtualization
- evaluate IndexedDB for large retained datasets
- define load/performance thresholds and regression tests

---

# Final architectural verdict

I would **approve this repository as a strong prototype / internal utility**.

I would **not yet approve it as the long-term baseline for a growing production-grade product** without the following first:

- parser correctness hardening
- privacy default change
- modularization
- dataset-aware settings model
- automated tests in CI
- large-data performance strategy

In short:

> Good product instinct, useful implementation, but the next step should be architecture hardening rather than feature expansion.

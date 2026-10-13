# CSV Viewer [![CI](https://github.com/daggerok/csv/actions/workflows/ci.yaml/badge.svg)](https://github.com/daggerok/csv/actions/workflows/ci.yaml)
A single-file client-side React application that parses, auto-cleans and displays data tables from raw Fidelity CSV
exports. Built with **Bun**, **Parcel**, **TypeScript** and **TailwindCSS v4**

---

## 🚀 Features & Architecture

### 1. Heuristic CSV Parsing Algorithm
Brokerage firms and financial reports typically contain messy headers, account preambles, and legal footers that
break standard SQL or naive CSV parsers. This application uses a custom heuristic processor:
* **Token Isolation:** Parses fields respecting double quotes, escaped quotes (`""`) and newlines inside quotes
* **Density Metrics:** Picks the most common column count across all rows, filtering out metadata lines
* **Contiguous Block Extraction:** Keeps the block of rows that fit that width (Fidelity data rows carry one extra
  trailing comma), discarding preambles, postambles and legal disclaimers

### 2. Tailored UI/UX Enhancements
* **Natural Sort Order:** Loaded files and tabs are sorted via `Intl.Collator` with numeric ordering (`file2.csv`
  comes before `file10.csv`)
* **Import:** Click the empty-state placeholder or the Import CSV Files button to open the file picker
* **Column Types:** Each column is detected as text, number, percent, currency or market cap; the badge in the header
  shows the type and cycles it on click. Sorting and numeric filters follow the type
* **Sticky Layout:** Sticky table headers, plus pinned columns: the anchor button in a column header keeps that column
  at the left edge on horizontal scroll. Pins are per file in tabs and shared in merge view
* **Merge View and Export:** Show all files as stacked blocks, export the active tab, one merged CSV or every file
  separately, with sort and filters applied

### 3. State Persistence & StrictMode Safety
* Features **Synchronous Lazy State Initialization** from `localStorage` to avoid multi-effect race conditions and
  theme flickering often triggered by double-rendering in `React.StrictMode` environments during development
* Dark mode via the TailwindCSS v4 `dark` class kept in sync on the document root
* **Export/Import app configuration** as a JSON file

---

## 🛠️ Tech Stack

* **Runtime:** [Bun](https://bun.sh/)
* **Build Tool:** [Parcel](https://parceljs.org/)
* **Frontend Library:** React (TypeScript)
* **Styling Framework:** TailwindCSS v4, icons are inline SVGs

---

## 📦 Getting Started

### Prerequisites
Ensure you have [Bun](https://bun.sh/) installed locally on your development machine.

### Installation & Local Run

1. Clone the repository and navigate to the root directory:
   ```bash
   git clone https://github.com/daggerok/csv.git && cd $_
   ```

2. Install the necessary development dependencies:
   ```bash
   bun install -E
   ```

3. Launch the local Parcel development server with Hot Module Replacement (HMR):
   ```bash
   bun run serve
   ```

4. Upgrade all ecosystem packages to their latest absolute versions:
   ```bash
   bunx npm-check-updates -u
   ```

## 📖 Production Deployment & Standalone Build

Since the entire system compiles into a self-contained Single Page Application (SPA) without requiring any heavy node
backend or cloud infrastructure, you can generate a static deployment bundle:

```bash
bun run build && bunx serve ./dist
```

The resulting optimized assets will be located inside the `./dist` folder, ready to be served from any static hosting
architecture or local offline workspace.

## 🛡️ Data Privacy Notice

This application executes entirely client-side inside your web browser. No financial data, statements, ledger indices,
or CSV filenames are transmitted to external cloud systems, tracking networks, or third-party servers. With
**Remember Data** on (the default), imported files are kept in this browser's `localStorage` until you turn it off or
click Clear Data

## ⚠️ Known Issues

Open problems, planned to be fixed later

### Large files block the browser
Files are read whole, parsed on the main thread, kept in React state and rendered without virtualization in both
tab and merge views. Big exports or many files at once freeze the tab. Fix: parse in a Web Worker and virtualize rows

### Parser trims quoted values
`parseCSVText` calls `field.trim()` on every field, quoted ones included, so `"  keep spaces  "` loses its spaces.
Fix: trim only unquoted fields and add parser fixtures (embedded quotes, whitespace, multiline values, extra and
missing columns, Fidelity preambles and footers)

### Financial data is remembered by default
`rememberData` defaults to `true`, so imported datasets stay in `localStorage` on shared or managed machines. Fix:
default to `false`, word the toggle as "Store imported data in this browser"

### Column settings are shared by index across files
Custom names, type overrides, filters and sort are keyed by column index only, so renaming or filtering column 0 in
one file applies to column 0 of every file. Fix: key them by file (or schema) plus column index, as pinned columns
already are

### Unused and vulnerable dependencies
`clsx`, `lucide-react`, `recharts`, `tailwind-merge`, `papaparse` and `@types/papaparse` are declared but never
imported. `bun audit` reports 33 vulnerabilities, all in dev tooling (`pm2`, Parcel, Jest), the production graph is
clean. Fix: drop unused packages, drop or upgrade `pm2`

### No tests
`bun run test` only runs the build and CI only builds. Fix: unit tests for the parser, filter grammar, type
detection and export, fixture tests on real Fidelity CSVs, run them in CI

### Accessibility and error reporting
The empty-state upload area is a clickable `<div>` (not reachable by keyboard), per-file import errors only go to
`console.error`, and invalid JSON or oversized data is reported with `alert()`. Fix: a real `<button>` or labeled
control, inline non-blocking notifications with per-file import warnings

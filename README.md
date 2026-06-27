# CSV Viewer [![CI](https://github.com/daggerok/csv/actions/workflows/ci.yaml/badge.svg)](https://github.com/daggerok/csv/actions/workflows/ci.yaml)
A high-performance, single-file client-side React application designed to instantly parse, auto-clean, and visualize
unstructured data tables extracted from raw Fidelity CSV exports. Built with **Bun**, **Vite**, **TypeScript**, and
**TailwindCSS v4**.

---

## 🚀 Features & Architecture

### 1. Heuristic CSV Parsing Algorithm
Brokerage firms and financial reports typically contain messy headers, account preambles, and legal footers that
break standard SQL or naive CSV parsers. This application uses a custom heuristic processor:
* **Token Isolation:** Parses lines respecting double quotes and escaped quotes (`""`).
* **Density Metrics:** Analyzes column count distribution across all rows, filtering out metadata fields.
* **Contiguous Block Extraction:** Detects and extracts the longest sequential block of data sharing identical column
  boundaries, automatically discarding messy postambles and legal disclaimers.

### 2. Tailored UI/UX Enhancements
* **Natural Sort Order:** Loaded file datasets and tabs are natively sorted via `Intl.Collator` using a strict
  numerical sequence (e.g., `file2.csv` appears before `file10.csv`).
* **Global Interactive Dropzone:** Click anywhere inside the empty state placeholder or the master import button to
  trigger native system file explorers seamlessly via shared React `useRef` tokens.
* **Advanced Sticky Layouts:** High-performance CSS containment supporting simultaneous sticky table headers
  (`sticky top-0`) and sticky identifier columns (`sticky left-0`) for cross-browser sheet viewing.

### 3. State Persistence & StrictMode Safety
* Features **Synchronous Lazy State Initialization** from `localStorage` to avoid multi-effect race conditions and
  theme flickering often triggered by double-rendering in `React.StrictMode` environments during development.
* Full integration with TailwindCSS v4 dark mode strategy using explicit DOM root synchronization.
* Dedicated utilities to **Export/Import app configurations** to standalone JSON templates.

---

## 🛠️ Tech Stack

* **Runtime:** [Bun](https://bun.sh/)
* **Build Tool:** [Vite](https://vite.dev/)
* **Frontend Library:** React (TypeScript)
* **Styling Framework:** TailwindCSS v4 (Utility-first, fully embedded optimized SVGs)

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

3. Launch the local Vite development server with Hot Module Replacement (HMR):
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
or CSV filenames are transmitted to external cloud systems, tracking networks, or third-party servers. Your investment
data remains isolated and completely secure.

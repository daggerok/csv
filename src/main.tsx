/**
 * ============================================================================
 * AGENTIC AI ENFORCED SPECIFICATION & GUIDELINES (CRITICAL)
 * ============================================================================
 * 1. PERSIST ALL COMMENTS: Under no circumstances should ANY code comments,
 * system design docs, or type descriptors be removed or truncated.
 * 2. AGENT READ-WRITE RULE: If a future deployment or agent updates the code,
 * this header section and related documentation blocks MUST be kept accurate,
 * expanded, and dynamically synchronized with the feature upgrades.
 * 3. SINGLE-FILE CONTINUITY: Keep the core architecture completely self-contained
 * within this file to maximize maintainability for automated development pipelines.
 * ============================================================================
 *
 * ============================================================================
 * AGENTIC AI DOCUMENTATION & SYSTEM ARCHITECTURE
 * ============================================================================
 *
 * PROJECT: Fidelity CSV Data Viewer & Cleaner
 * ENVIRONMENT: Bun, Vite, React, TypeScript, TailwindCSS v4
 *
 * MODULES & FEATURES:
 * 1. [Types & State Management]
 * - `AppSettings`: Stores UI/UX settings (theme, header configurations,
 * multi-file merge state, custom column name mappings, column type overrides,
 * and structural sticky flags).
 * - `DataSet`: Represents a parsed CSV file with cleaned table rows.
 * - `SortState`: Tracks current sort column index and direction (asc/desc/null).
 * - Settings are initialized SYNCHRONOUSLY from `localStorage` to prevent
 * race conditions and theme flickering during development/strict mode.
 * - Export/Import settings to JSON allows multi-project configurations,
 * including persistence of custom column headers, types, merge, and sticky toggles.
 *
 * 2. [Heuristic CSV Parser (`parseCSVRow` & `extractValidTableData`)]
 * - Fidelity CSVs contain unstructured preamble/postamble.
 * - The heuristic algorithm splits the file by lines, parses them properly
 * respecting double quotes, and counts columns.
 * - It isolates the longest contiguous block of rows that share the same
 * (or majority) column length, effectively stripping out legal text
 * and account summaries.
 *
 * 3. [Dynamic Column Renaming & Custom Headers Registry]
 * - Allows inline editing of table headers using a pencil button.
 * - Tracks the explicitly clicked header via a composite key (`fileIndex-colIndex`) to
 *   prevent focus-stealing, immediate unmount loops, and layout jumps during multi-file Merge View.
 * - Custom names are stored inside `settings.columnCustomNames` mapped by index.
 * - Works universally: if a file has no header row, user-defined names are preserved
 *   and injected seamlessly across file reloads.
 * - Inline edit widget provides three interaction paths:
 *     a) SAVE: Enter key OR click ✓ button → commits `editHeaderValue` to `columnCustomNames`.
 *     b) CANCEL: Escape key OR click ✗ button → discards changes, reverts to previous name.
 *     c) BLUR: When input loses focus (e.g. clicking elsewhere), the system checks a
 *        `cancelledRef` flag. If cancel was explicitly triggered (via Escape or ✗ button),
 *        blur is suppressed (no save). Otherwise blur performs save (desktop convenience).
 *   - The ✓ and ✗ buttons use `onMouseDown` with `e.preventDefault()` to prevent them from
 *     stealing focus from the input and triggering a premature blur event.
 *
 * 4. [Multi-File Merging & Flex/Grid Cross-Axis Sticky Layout Engine]
 * - Toggleable `mergeFiles` strategy inside app settings layout.
 * - Toggleable `stickyHeaders` control switch to explicitly manage layout viewports.
 * - Tab View (Disabled): Standard separate tab selection between isolated sheets.
 * - Merge View (Enabled): Disables tabs and cascades all selected files sequentially.
 * - Multi-Axis Fixed Layout: Replaces native tables in Merge mode with structured
 * CSS Grid row containers. The filename banner utilizes dual-axis stickiness (`sticky top-0 left-0`)
 * alongside an adaptive explicit dynamic content width (`w-max min-w-full`) to freeze on both
 * vertical and horizontal scrolls without subpixel gap separation leaks.
 *
 * 5. [Natural Sort Order Synchronization]
 * - Uses `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`
 * to sort imported datasets by file name natively. This ensures `file2.csv`
 * appears before `file10.csv`.
 *
 * 6. [Two-Phase Async Pipeline with Paint-Aware Spinner Lifecycle]
 * - PHASE 1 — PARSE: Files are read and parsed sequentially via `processFileAsync`.
 *   Each file yields to the main thread between I/O and CPU-bound parsing so the
 *   spinner can repaint with per-file progress. Parsed results are accumulated in
 *   a local staging array, NOT committed to React state yet.
 * - PHASE 2 — RENDER: After all files are parsed, `loadingState.phase` transitions
 *   to `'rendering'` and the staged data is committed to `dataSets` in a single
 *   `setDataSets()` call. The spinner remains visible showing "Rendering…".
 * - PAINT DETECTION: A `useEffect` watches for the `rendering` phase and uses
 *   double-`requestAnimationFrame` gating (`waitForPaint`) — the first rAF fires
 *   after React commits to the DOM, the second fires after the browser has
 *   actually composited and painted those DOM changes to screen. Only then is
 *   `loadingState` reset to dismiss the overlay.
 * - This eliminates the "spinner vanishes but UI is still frozen" gap that occurs
 *   when React needs 500ms–2s to reconcile thousands of table rows.
 *
 * 7. [Layout-Heavy Settings Toggle Protection]
 * - Certain settings changes cause massive DOM restructuring when data is loaded
 *   (e.g. toggling Merge Files rebuilds the entire table from <table> to flex layout
 *   or vice versa; toggling 1st Row = Header recomputes all rows).
 * - These "expensive" toggles are intercepted by `updateSettingWithSpinner`, which:
 *     a) Activates the rendering-phase spinner BEFORE committing the setting change.
 *     b) Yields to main thread so the spinner paints.
 *     c) Commits the setting via `setSettings`.
 *     d) The existing `renderPhaseEffect` detects `phase === 'rendering'` and waits
 *        for double-rAF paint confirmation before dismissing the overlay.
 * - A configurable row threshold (`EXPENSIVE_TOGGLE_ROW_THRESHOLD`) determines when
 *   the spinner protection is needed vs. when the change is fast enough to skip it.
 * - Settings that DON'T cause layout restructuring (theme, stickyHeaders) bypass
 *   this mechanism entirely and apply instantly.
 *
 * 8. [Column Type System & Smart Sort Engine]
 * - Each column can be assigned a `ColumnType` that controls sort comparison behavior.
 * - Supported types:
 *     a) `'string'`   — Default. Natural sort via `Intl.Collator` (numeric-aware).
 *     b) `'number'`   — Parses raw numeric strings, strips commas/whitespace.
 *     c) `'percent'`  — Strips trailing `%` and sorts numerically.
 *     d) `'currency'` — Strips `$`, commas, parens (negative), sorts numerically.
 *     e) `'marketcap'`— Extracts embedded dollar amount with suffix multiplier:
 *                        "Large cap ($309.84B)" → 309.84 × 1e9. Handles K/M/B/T suffixes.
 * - Auto-detection: `detectColumnType` samples the first N non-empty values in a column
 *   and uses regex pattern matching to infer the most likely type. Falls back to `'string'`.
 * - Manual override: Users can right-click or use a dropdown (future) on a column header
 *   to force a specific type, stored in `settings.columnTypeOverrides[colIndex]`.
 * - Sort state (`SortState`) tracks `{ columnIndex, direction }` and is reset when
 *   switching tabs or toggling merge mode.
 * - The comparator function `getComparator` returns a type-aware comparison function
 *   that handles null/empty values consistently (always sorted to the end).
 * - In Merge View, each file block is sorted independently using the same sort state,
 *   maintaining per-block row order while allowing cross-file column sorting.
 *
 * DESIGN PATTERNS:
 * - Single File Application: Everything is self-contained for easy maintenance.
 * - Custom SVGs inline to avoid dependency bloat.
 * ============================================================================
 */

// @ts:ignore
import React, { useState, useEffect, useRef, useMemo, useCallback, ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';

// --- TYPES ---

/**
 * Column data type identifiers for the smart sort engine.
 *
 * Each type has a dedicated value extractor in `extractSortValue` that
 * converts the raw cell string into a comparable numeric or string value.
 *
 * - 'string':    Natural sort via Intl.Collator (numeric-aware). Default fallback.
 * - 'number':    Raw numeric parsing. Strips commas, whitespace. "1,234.56" → 1234.56
 * - 'percent':   Strips trailing '%'. "14.20%" → 14.20
 * - 'currency':  Strips '$', commas, handles parens-as-negative. "($1,234.56)" → -1234.56
 * - 'marketcap': Extracts embedded dollar amount with K/M/B/T suffix multiplier.
 *                "Large cap ($309.84B)" → 309840000000. Also handles standalone "$14.20B".
 */
type ColumnType = 'string' | 'number' | 'percent' | 'currency' | 'marketcap';

/**
 * All available column types for UI display and selection.
 * Order matters — used for cycling through types and for dropdown rendering.
 */
const ALL_COLUMN_TYPES: ColumnType[] = ['string', 'number', 'percent', 'currency', 'marketcap'];

/**
 * Human-readable labels for column types, used in the type badge UI.
 */
const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
    string: 'ABC',
    number: '123',
    percent: '%',
    currency: '$',
    marketcap: 'Cap',
};

/**
 * Color classes for column type badges (Tailwind).
 */
const COLUMN_TYPE_COLORS: Record<ColumnType, string> = {
    string: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    number: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',
    percent: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300',
    currency: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',
    marketcap: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
};

interface AppSettings {
    theme: 'light' | 'dark';
    firstRowIsHeader: boolean;
    firstColIsHeader: boolean;
    mergeFiles: boolean; // Enables infinite layout merging
    stickyHeaders: boolean; // Explicit control switch to force lock headers during scroll
    columnCustomNames: Record<number, string>; // Stores custom column names by index
    columnTypeOverrides: Record<number, ColumnType>; // Manual type overrides by column index
}

interface DataSet {
    fileName: string;
    data: string[][];
}

/**
 * Tracks the current sort state for the table view.
 * - `columnIndex`: Which column is being sorted (null = no sort active).
 * - `direction`: 'asc' for ascending, 'desc' for descending.
 */
interface SortState {
    columnIndex: number | null;
    direction: 'asc' | 'desc';
}

/**
 * Two-phase loading state tracker.
 */
interface LoadingState {
    active: boolean;
    phase: 'idle' | 'parsing' | 'rendering';
    current: number;
    total: number;
    fileName: string;
}

const DEFAULT_SETTINGS: AppSettings = {
    theme: 'light',
    firstRowIsHeader: false, // DISABLED BY DEFAULT
    firstColIsHeader: true,  // ENABLED BY DEFAULT
    mergeFiles: false,       // DISABLED BY DEFAULT
    stickyHeaders: true,     // ENABLED BY DEFAULT (Enforces fixed layout visibility)
    columnCustomNames: {},
    columnTypeOverrides: {},  // No overrides by default — auto-detection used
};

const DEFAULT_LOADING_STATE: LoadingState = {
    active: false,
    phase: 'idle',
    current: 0,
    total: 0,
    fileName: '',
};

const DEFAULT_SORT_STATE: SortState = {
    columnIndex: null,
    direction: 'asc',
};

/**
 * Minimum total row count across all loaded datasets before a setting toggle
 * will trigger the spinner overlay.
 */
const EXPENSIVE_TOGGLE_ROW_THRESHOLD = 500;

/**
 * Number of non-empty cell values to sample per column for auto-type detection.
 */
const TYPE_DETECTION_SAMPLE_SIZE = 20;

/**
 * Set of setting keys that cause structural DOM changes (layout rebuild).
 */
const LAYOUT_RESTRUCTURING_KEYS: Set<keyof AppSettings> = new Set([
    'mergeFiles',
    'firstRowIsHeader',
    'firstColIsHeader',
]);

// Нативный компаратор для натуральной сортировки (например: file1, file2, file10)
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// --- CORE LOGIC: CSV PARSING & HEURISTICS ---

/**
 * Parses a single CSV line respecting double quotes.
 */
function parseCSVRow(row: string): string[] {
    const result: string[] = [];
    let inQuotes = false;
    let currentValue = '';

    for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
            if (inQuotes && row[i + 1] === '"') {
                currentValue += '"'; // Escaped quote
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(currentValue.trim());
            currentValue = '';
        } else {
            currentValue += char;
        }
    }
    result.push(currentValue.trim());
    return result;
}

/**
 * Extracts the actual data table from a messy Fidelity CSV.
 */
function extractValidTableData(rawText: string): string[][] {
    const lines = rawText.split(/\r?\n/).filter(line => line.trim() !== '');
    const parsedLines = lines.map(parseCSVRow);

    if (parsedLines.length === 0) return [];

    const colCounts: Record<number, number> = {};
    parsedLines.forEach(row => {
        if (row.length > 2) {
            colCounts[row.length] = (colCounts[row.length] || 0) + 1;
        }
    });

    let targetColLength = 0;
    let maxOccurrences = 0;
    for (const [lengthStr, count] of Object.entries(colCounts)) {
        if (count > maxOccurrences) {
            maxOccurrences = count;
            targetColLength = parseInt(lengthStr, 10);
        }
    }

    if (targetColLength === 0) {
        targetColLength = Math.max(...parsedLines.map(r => r.length));
    }

    const tableData: string[][] = [];
    let isRecording = false;

    for (const row of parsedLines) {
        if (row.length === targetColLength || row.length === targetColLength + 1) {
            isRecording = true;
            tableData.push(row.slice(0, targetColLength)); // Normalize length
        } else if (isRecording && row.length < targetColLength - 1) {
            break;
        }
    }

    return tableData.length > 0 ? tableData : parsedLines;
}

// --- COLUMN TYPE DETECTION & SMART VALUE EXTRACTION ---

/**
 * Regex patterns for column type auto-detection.
 * Each pattern is tested against sampled cell values to determine the best-fit type.
 */
const TYPE_PATTERNS: { type: ColumnType; pattern: RegExp }[] = [
    // Marketcap: "Large cap ($309.84B)", "Small cap ($6.76B)", "$14.20B", "$500M"
    // Must be checked BEFORE currency to avoid false positive on "$309.84B"
    { type: 'marketcap', pattern: /\$[\d,.]+\s*[KMBT]/i },
    // Percent: "14.20%", "-3.5%", "0.00%"
    { type: 'percent', pattern: /^-?[\d,.]+\s*%$/ },
    // Currency: "$1,234.56", "($1,234.56)", "$0.00", "-$500"
    { type: 'currency', pattern: /^[($-]*\$[\d,.]+\)?$/ },
    // Number: "1234", "1,234.56", "-0.5", "+100"
    { type: 'number', pattern: /^[+-]?[\d,]+\.?\d*$/ },
];

/**
 * Samples up to `TYPE_DETECTION_SAMPLE_SIZE` non-empty values from a column
 * and uses regex matching to detect the most likely column type.
 *
 * Strategy:
 * 1. Collect non-empty, non-header samples from the column.
 * 2. For each type pattern, count how many samples match.
 * 3. If >60% of samples match a pattern, return that type.
 * 4. Patterns are checked in priority order (marketcap > percent > currency > number).
 * 5. Falls back to 'string' if no pattern reaches the threshold.
 */
function detectColumnType(rows: string[][], colIndex: number): ColumnType {
    const samples: string[] = [];
    for (let i = 0; i < rows.length && samples.length < TYPE_DETECTION_SAMPLE_SIZE; i++) {
        const val = (rows[i][colIndex] || '').trim();
        if (val !== '' && val !== '--' && val !== 'N/A' && val !== 'n/a') {
            samples.push(val);
        }
    }

    if (samples.length === 0) return 'string';

    const threshold = samples.length * 0.6; // 60% match required

    for (const { type, pattern } of TYPE_PATTERNS) {
        const matchCount = samples.filter(s => pattern.test(s)).length;
        if (matchCount >= threshold) {
            return type;
        }
    }

    return 'string';
}

/**
 * Suffix multipliers for marketcap parsing.
 * Maps single-character suffixes to their numeric multiplier.
 */
const SUFFIX_MULTIPLIERS: Record<string, number> = {
    'K': 1e3,
    'M': 1e6,
    'B': 1e9,
    'T': 1e12,
};

/**
 * Extracts a numeric sort value from a cell string based on the column type.
 *
 * Returns `null` for empty/unparseable values — these are always sorted to the end
 * regardless of sort direction.
 *
 * Type-specific extraction logic:
 * - string:    Returns the raw string (compared via naturalCollator).
 * - number:    Strips commas, parses as float. "1,234.56" → 1234.56
 * - percent:   Strips '%', parses as float. "-3.5%" → -3.5
 * - currency:  Strips '$', commas. Handles parens-as-negative: "($500)" → -500
 * - marketcap: Finds embedded dollar amount with suffix. "Large cap ($309.84B)" → 3.0984e11
 *              Regex: /\$([\d,.]+)\s*([KMBT])/i — extracts base number and multiplier.
 */
function extractSortValue(cellValue: string, colType: ColumnType): number | string | null {
    const trimmed = cellValue.trim();
    if (trimmed === '' || trimmed === '--' || trimmed === 'N/A' || trimmed === 'n/a') {
        return null;
    }

    switch (colType) {
        case 'number': {
            const cleaned = trimmed.replace(/,/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
        }

        case 'percent': {
            const cleaned = trimmed.replace(/%/g, '').replace(/,/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
        }

        case 'currency': {
            let cleaned = trimmed.replace(/[$,\s]/g, '');
            // Handle parentheses as negative: ($500) → -500
            const isNegative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
            cleaned = cleaned.replace(/[()]/g, '').replace(/^-/, '');
            const num = parseFloat(cleaned);
            if (isNaN(num)) return null;
            return isNegative ? -num : num;
        }

        case 'marketcap': {
            // Try to find "$NUMBER[SUFFIX]" pattern anywhere in the string
            const match = trimmed.match(/\$([\d,.]+)\s*([KMBT])/i);
            if (match) {
                const base = parseFloat(match[1].replace(/,/g, ''));
                const suffix = match[2].toUpperCase();
                const multiplier = SUFFIX_MULTIPLIERS[suffix] || 1;
                return isNaN(base) ? null : base * multiplier;
            }
            // Fallback: try to extract just a dollar amount without suffix
            const fallbackMatch = trimmed.match(/\$([\d,.]+)/);
            if (fallbackMatch) {
                const num = parseFloat(fallbackMatch[1].replace(/,/g, ''));
                return isNaN(num) ? null : num;
            }
            return null;
        }

        case 'string':
        default:
            return trimmed;
    }
}

/**
 * Creates a comparator function for sorting rows by a specific column.
 *
 * Null/empty values are always pushed to the END regardless of sort direction.
 * This prevents blank rows from appearing at the top in descending sorts.
 *
 * For 'string' type, uses `naturalCollator.compare` for locale-aware numeric sorting.
 * For all numeric types, uses standard numeric comparison.
 */
function getComparator(
    colIndex: number,
    direction: 'asc' | 'desc',
    colType: ColumnType
): (a: string[], b: string[]) => number {
    const dirMultiplier = direction === 'asc' ? 1 : -1;

    return (a: string[], b: string[]) => {
        const aVal = extractSortValue(a[colIndex] || '', colType);
        const bVal = extractSortValue(b[colIndex] || '', colType);

        // Nulls always go to the end
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;

        if (colType === 'string') {
            return dirMultiplier * naturalCollator.compare(aVal as string, bVal as string);
        }

        // Numeric comparison for all other types
        return dirMultiplier * ((aVal as number) - (bVal as number));
    };
}

// --- UTILITY FUNCTIONS ---

function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
        reader.readAsText(file);
    });
}

function waitForPaint(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    });
}

function getTotalRowCount(dataSets: DataSet[]): number {
    let total = 0;
    for (const ds of dataSets) {
        total += ds.data.length;
    }
    return total;
}


// --- SPINNER OVERLAY COMPONENT ---

const LoadingOverlay: React.FC<{ state: LoadingState }> = ({ state }) => {
    if (!state.active) return null;

    const isParsing = state.phase === 'parsing';
    const isRendering = state.phase === 'rendering';

    const progressFraction = isRendering
        ? 1
        : state.total > 0
            ? Math.max((state.current / state.total), 0)
            : 0;
    const progressPercent = Math.round(progressFraction * 100);

    return (
        <div
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center
                        bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-sm
                        animate-[fadeIn_0.15s_ease-out]"
            aria-live="polite"
            aria-label="Loading files, please wait"
            role="status"
        >
            <div className="flex flex-col items-center gap-5 bg-white dark:bg-slate-900
                            border border-slate-200 dark:border-slate-700
                            rounded-2xl shadow-2xl px-10 py-8 min-w-[280px] max-w-[380px]">

                <div className="relative flex items-center justify-center w-20 h-20">
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80" fill="none" aria-hidden="true">
                        <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" className="text-slate-200 dark:text-slate-700" />
                    </svg>
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80" fill="none" aria-hidden="true">
                        <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
                                strokeDasharray={`${2 * Math.PI * 34}`}
                                strokeDashoffset={`${2 * Math.PI * 34 * (1 - progressFraction)}`}
                                className="text-blue-500 dark:text-blue-400"
                                style={{ transition: 'stroke-dashoffset 0.35s cubic-bezier(0.4,0,0.2,1)' }}
                        />
                    </svg>
                    <svg className="absolute inset-0 w-full h-full animate-spin" viewBox="0 0 80 80" fill="none" aria-hidden="true" style={{ animationDuration: '1.1s' }}>
                        <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="20 193" className="text-blue-400/60 dark:text-blue-300/50" />
                    </svg>
                    <div className="relative z-10 flex items-center justify-center w-11 h-11 rounded-full bg-blue-50 dark:bg-blue-950/60 animate-pulse" style={{ animationDuration: '1.6s' }}>
                        {isParsing ? (
                            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
                            </svg>
                        )}
                    </div>
                </div>

                <div className="flex flex-col items-center gap-1.5 text-center">
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                        {isParsing ? 'Processing Files…' : 'Rendering Table…'}
                    </p>
                    {isParsing ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-semibold tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                            {state.current} of {state.total} parsed
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-semibold tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
                            Building DOM layout…
                        </span>
                    )}
                </div>

                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-300 ease-out ${isRendering ? 'bg-amber-500 dark:bg-amber-400 animate-pulse' : 'bg-blue-500 dark:bg-blue-400'}`}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                {isParsing && state.fileName && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 max-w-full truncate text-center font-mono tracking-tight" title={state.fileName}>
                        {state.fileName}
                    </p>
                )}
                {isRendering && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center leading-snug">
                        Large tables may take a moment to paint.<br />The spinner will dismiss after the browser finishes.
                    </p>
                )}
            </div>
        </div>
    );
};


// --- INLINE HEADER EDIT WIDGET COMPONENT ---

const InlineHeaderEditor: React.FC<{
    value: string;
    onChange: (val: string) => void;
    onSave: () => void;
    onCancel: () => void;
    isMergeView?: boolean;
}> = ({ value, onChange, onSave, onCancel, isMergeView = false }) => {
    const cancelledRef = useRef(false);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            onSave();
        } else if (e.key === 'Escape') {
            cancelledRef.current = true;
            onCancel();
        }
    };

    const handleBlur = () => {
        if (cancelledRef.current) {
            cancelledRef.current = false;
            return;
        }
        onSave();
    };

    const handleCancelMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        cancelledRef.current = true;
    };

    const handleSaveMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
    };

    return (
        <div className="flex items-center gap-1 w-full">
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className={`bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 
                    px-2 rounded border border-blue-500 focus:outline-none text-xs font-normal 
                    flex-1 min-w-0 ${isMergeView ? 'py-0.5' : 'py-1'}`}
                autoFocus
            />
            <button onMouseDown={handleSaveMouseDown} onClick={onSave}
                    className="shrink-0 p-0.5 rounded text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                    title="Save (Enter)" aria-label="Save column name">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
            </button>
            <button onMouseDown={handleCancelMouseDown} onClick={onCancel}
                    className="shrink-0 p-0.5 rounded text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                    title="Cancel (Esc)" aria-label="Cancel editing">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
};


// --- COLUMN HEADER DISPLAY COMPONENT (with sort + type + edit) ---

/**
 * Renders a single column header cell with:
 * - Column name (editable inline)
 * - Sort direction triangles (▲/▼) — visible on hover, highlighted when active
 * - Column type badge — clickable to cycle through types
 * - Edit (pencil) button — visible on hover
 *
 * The sort triangles are stacked vertically beside the column name.
 * Clicking ▲ sets ascending sort; clicking ▼ sets descending.
 * Clicking the already-active direction clears the sort (resets to natural order).
 *
 * The type badge shows the auto-detected or manually overridden column type
 * as a tiny pill (e.g., "ABC", "123", "%", "$", "Cap"). Clicking cycles to next type.
 */
const ColumnHeader: React.FC<{
    header: string;
    colIndex: number;
    fileIndex: number;
    sortState: SortState;
    colType: ColumnType;
    isEditing: boolean;
    editValue: string;
    onEditChange: (val: string) => void;
    onEditStart: () => void;
    onEditSave: () => void;
    onEditCancel: () => void;
    onSort: (colIndex: number, direction: 'asc' | 'desc') => void;
    onTypeChange: (colIndex: number, newType: ColumnType) => void;
    isMergeView?: boolean;
}> = ({
          header, colIndex, fileIndex, sortState, colType, isEditing,
          editValue, onEditChange, onEditStart, onEditSave, onEditCancel,
          onSort, onTypeChange, isMergeView = false,
      }) => {
    const isActiveSort = sortState.columnIndex === colIndex;
    const isAsc = isActiveSort && sortState.direction === 'asc';
    const isDesc = isActiveSort && sortState.direction === 'desc';

    /**
     * Handles clicking a sort triangle.
     * - If clicking the already-active direction → clears sort (pass colIndex with toggled dir,
     *   but we use a special "clear" signal by passing the same direction to parent which handles toggle).
     * - If clicking inactive direction → activates that direction.
     */
    const handleSortClick = (direction: 'asc' | 'desc') => {
        onSort(colIndex, direction);
    };

    /**
     * Cycles column type to the next in the ALL_COLUMN_TYPES array.
     */
    const handleTypeCycle = (e: React.MouseEvent) => {
        e.stopPropagation(); // Don't trigger any parent click handlers
        const currentIdx = ALL_COLUMN_TYPES.indexOf(colType);
        const nextIdx = (currentIdx + 1) % ALL_COLUMN_TYPES.length;
        onTypeChange(colIndex, ALL_COLUMN_TYPES[nextIdx]);
    };

    if (isEditing) {
        return (
            <InlineHeaderEditor
                value={editValue}
                onChange={onEditChange}
                onSave={onEditSave}
                onCancel={onEditCancel}
                isMergeView={isMergeView}
            />
        );
    }

    return (
        <div className="flex items-center justify-between gap-1 w-full group/header">
            {/* Sort triangles — stacked vertically */}
            <div className="flex flex-col shrink-0 -my-1 opacity-0 group-hover/header:opacity-100 transition-opacity">
                <button
                    onClick={() => handleSortClick('asc')}
                    className={`p-0 leading-none transition-colors ${
                        isAsc
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400'
                    }`}
                    title="Sort Ascending"
                    aria-label={`Sort ${header} ascending`}
                >
                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="M6 2L10 8H2L6 2Z" />
                    </svg>
                </button>
                <button
                    onClick={() => handleSortClick('desc')}
                    className={`p-0 leading-none transition-colors ${
                        isDesc
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400'
                    }`}
                    title="Sort Descending"
                    aria-label={`Sort ${header} descending`}
                >
                    <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="M6 10L2 4H10L6 10Z" />
                    </svg>
                </button>
            </div>

            {/* Column name */}
            <span className={`truncate flex-1 ${isMergeView ? '' : 'font-semibold'}`}>{header}</span>

            {/* Type badge — always visible when sort is active or on hover */}
            <button
                onClick={handleTypeCycle}
                className={`shrink-0 px-1.5 py-0 rounded text-[9px] font-bold leading-4 tracking-wide
                    transition-all cursor-pointer border border-transparent
                    hover:border-slate-400 dark:hover:border-slate-500
                    ${isActiveSort ? 'opacity-100' : 'opacity-0 group-hover/header:opacity-70'}
                    ${COLUMN_TYPE_COLORS[colType]}`}
                title={`Column type: ${colType}. Click to cycle.`}
                aria-label={`Column type: ${colType}`}
            >
                {COLUMN_TYPE_LABELS[colType]}
            </button>

            {/* Edit (pencil) button */}
            <button
                onClick={onEditStart}
                className="opacity-0 group-hover/header:opacity-100 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-all p-0.5 shrink-0"
                title="Rename Column"
            >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
            </button>

            {/* Active sort indicator — persistently visible when this column is sorted */}
            {isActiveSort && (
                <span className="shrink-0 text-blue-500 dark:text-blue-400" aria-hidden="true">
                    {isAsc ? (
                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2L10 8H2L6 2Z" /></svg>
                    ) : (
                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L2 4H10L6 10Z" /></svg>
                    )}
                </span>
            )}
        </div>
    );
};


// --- MAIN APPLICATION COMPONENT ---
const App: React.FC = () => {
    // --- STATE WITH SYNCHRONOUS LOCALSTORAGE INITIALIZATION ---
    const [settings, setSettings] = useState<AppSettings>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelityApp_settings');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    return { ...DEFAULT_SETTINGS, ...parsed };
                } catch (e) {
                    console.error("Failed to parse settings from localStorage", e);
                }
            }
        }
        return DEFAULT_SETTINGS;
    });

    const [dataSets, setDataSets] = useState<DataSet[]>([]);
    const [activeTab, setActiveTab] = useState<number>(0);
    const [loadingState, setLoadingState] = useState<LoadingState>(DEFAULT_LOADING_STATE);
    const [sortState, setSortState] = useState<SortState>(DEFAULT_SORT_STATE);

    // UI Local State for inline renaming
    const [editingHeaderKey, setEditingHeaderKey] = useState<string | null>(null);
    const [editHeaderValue, setEditHeaderValue] = useState<string>('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- THEME & CACHE SYNC ---
    useEffect(() => {
        localStorage.setItem('fidelityApp_settings', JSON.stringify(settings));
        if (settings.theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [settings]);

    // --- PAINT DETECTION EFFECT ---
    useEffect(() => {
        if (loadingState.phase !== 'rendering') return;
        let cancelled = false;
        const detectPaintAndDismiss = async () => {
            await waitForPaint();
            await waitForPaint();
            if (!cancelled) setLoadingState(DEFAULT_LOADING_STATE);
        };
        detectPaintAndDismiss();
        return () => { cancelled = true; };
    }, [loadingState.phase]);

    // --- Reset sort when switching tabs or toggling merge ---
    useEffect(() => {
        setSortState(DEFAULT_SORT_STATE);
    }, [activeTab, settings.mergeFiles]);

    const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const updateSettingWithSpinner = useCallback(async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        const totalRows = getTotalRowCount(dataSets);
        const isExpensive = LAYOUT_RESTRUCTURING_KEYS.has(key) && totalRows >= EXPENSIVE_TOGGLE_ROW_THRESHOLD;

        if (!isExpensive) {
            setSettings(prev => ({ ...prev, [key]: value }));
            return;
        }

        setLoadingState({ active: true, phase: 'rendering', current: 0, total: 0, fileName: '' });
        await yieldToMain();
        setSettings(prev => ({ ...prev, [key]: value }));
    }, [dataSets]);

    const handleResetSettings = useCallback(async () => {
        const totalRows = getTotalRowCount(dataSets);
        if (totalRows >= EXPENSIVE_TOGGLE_ROW_THRESHOLD) {
            setLoadingState({ active: true, phase: 'rendering', current: 0, total: 0, fileName: '' });
            await yieldToMain();
        }
        setSettings(DEFAULT_SETTINGS);
        setSortState(DEFAULT_SORT_STATE);
    }, [dataSets]);

    const handleExportSettings = () => {
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fidelity_settings.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportSettings = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const imported = JSON.parse(event.target?.result as string);
                if (imported && typeof imported === 'object') {
                    const totalRows = getTotalRowCount(dataSets);
                    if (totalRows >= EXPENSIVE_TOGGLE_ROW_THRESHOLD) {
                        setLoadingState({ active: true, phase: 'rendering', current: 0, total: 0, fileName: '' });
                        await yieldToMain();
                    }
                    setSettings({ ...DEFAULT_SETTINGS, ...imported });
                }
            } catch (err) {
                alert("Invalid JSON format");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }, [dataSets]);

    const handleTriggerFileInput = () => fileInputRef.current?.click();

    // --- FILE PROCESSING PIPELINE ---
    const processFilesAsync = useCallback(async (files: File[]) => {
        const total = files.length;
        setLoadingState({ active: true, phase: 'parsing', current: 0, total, fileName: '' });
        await yieldToMain();

        const newResults: DataSet[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            setLoadingState(prev => ({ ...prev, fileName: file.name }));
            await yieldToMain();
            try {
                const rawText = await readFileAsText(file);
                await yieldToMain();
                const cleanedData = extractValidTableData(rawText);
                newResults.push({ fileName: file.name, data: cleanedData });
            } catch (err) {
                console.error(`Error processing ${file.name}:`, err);
            }
            setLoadingState(prev => ({ ...prev, current: i + 1 }));
            await yieldToMain();
        }

        setLoadingState(prev => ({ ...prev, phase: 'rendering', fileName: '' }));
        await yieldToMain();

        setDataSets(prev => {
            const combined = [...prev, ...newResults];
            return combined.sort((a, b) => naturalCollator.compare(a.fileName, b.fileName));
        });
    }, []);

    const handleFileUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const fileArray = Array.from(files);
        e.target.value = '';
        processFilesAsync(fileArray).catch(err => {
            console.error('Unexpected error in file processing pipeline:', err);
            setLoadingState(DEFAULT_LOADING_STATE);
        });
    }, [processFilesAsync]);

    const handleClearData = () => {
        setDataSets([]);
        setActiveTab(0);
        setSortState(DEFAULT_SORT_STATE);
    };

    // --- INLINE EDITING ---
    const startEditingHeader = (fileIndex: number, colIndex: number, currentValue: string) => {
        setEditingHeaderKey(`${fileIndex}-${colIndex}`);
        setEditHeaderValue(currentValue);
    };

    const saveHeaderName = (colIndex: number) => {
        if (editHeaderValue.trim() !== '') {
            setSettings(prev => ({
                ...prev,
                columnCustomNames: { ...prev.columnCustomNames, [colIndex]: editHeaderValue.trim() }
            }));
        }
        setEditingHeaderKey(null);
    };

    const cancelEditingHeader = () => {
        setEditingHeaderKey(null);
        setEditHeaderValue('');
    };

    // --- SORT HANDLER ---
    /**
     * Handles sort toggle logic:
     * - If clicking the same column + same direction → clears sort (back to natural order).
     * - If clicking same column + different direction → switches direction.
     * - If clicking different column → sets new column + requested direction.
     */
    const handleSort = useCallback((colIndex: number, direction: 'asc' | 'desc') => {
        setSortState(prev => {
            if (prev.columnIndex === colIndex && prev.direction === direction) {
                // Clicking active sort direction again → clear sort
                return DEFAULT_SORT_STATE;
            }
            return { columnIndex: colIndex, direction };
        });
    }, []);

    // --- COLUMN TYPE HANDLER ---
    /**
     * Sets the column type override. Persisted to settings for export/import.
     * Also resets sort when type changes since comparison semantics change.
     */
    const handleTypeChange = useCallback((colIndex: number, newType: ColumnType) => {
        setSettings(prev => ({
            ...prev,
            columnTypeOverrides: { ...prev.columnTypeOverrides, [colIndex]: newType }
        }));
        // Reset sort since the comparison function changes with type
        setSortState(DEFAULT_SORT_STATE);
    }, []);

    // --- DATA TRANSFORMATION ---
    const getFileHeadersAndRows = useCallback((fileRawRows: string[][]) => {
        if (fileRawRows.length === 0) return { headers: [], rows: [] };

        const totalColumns = fileRawRows[0].length;
        const fileHeaders = settings.firstRowIsHeader ? fileRawRows[0] : [];

        const headers = Array.from({ length: totalColumns }, (_, i) => {
            if (settings.columnCustomNames[i]) return settings.columnCustomNames[i];
            if (settings.firstRowIsHeader && fileHeaders[i]) return fileHeaders[i];
            return `Col ${i + 1}`;
        });

        const rows = settings.firstRowIsHeader ? fileRawRows.slice(1) : fileRawRows;
        return { headers, rows };
    }, [settings.firstRowIsHeader, settings.columnCustomNames]);

    /**
     * Determines the effective column type for a given column index:
     * 1. If user has a manual override → use that.
     * 2. Otherwise → auto-detect from the data rows.
     */
    const getColumnType = useCallback((colIndex: number, dataRows: string[][]): ColumnType => {
        if (settings.columnTypeOverrides[colIndex]) {
            return settings.columnTypeOverrides[colIndex];
        }
        return detectColumnType(dataRows, colIndex);
    }, [settings.columnTypeOverrides]);

    /**
     * Applies the current sort state to a set of rows.
     * Returns a new sorted array (does not mutate the original).
     * If no sort is active, returns the original reference for performance.
     */
    const applySortToRows = useCallback((rows: string[][], dataRows: string[][]): string[][] => {
        if (sortState.columnIndex === null) return rows;

        const colType = getColumnType(sortState.columnIndex, dataRows);
        const comparator = getComparator(sortState.columnIndex, sortState.direction, colType);

        return [...rows].sort(comparator);
    }, [sortState, getColumnType]);

    const activeData = dataSets[activeTab]?.data || [];

    const isolatedTable = useMemo(() => {
        const { headers, rows } = getFileHeadersAndRows(activeData);
        const sortedRows = applySortToRows(rows, rows);
        return { headers, rows: sortedRows };
    }, [activeData, getFileHeadersAndRows, applySortToRows]);

    /**
     * Computes auto-detected column types for the current view.
     * Used to show the correct type badge on each header.
     * Memoized to avoid re-detecting on every render.
     */
    const activeColumnTypes = useMemo((): ColumnType[] => {
        const dataRows = settings.firstRowIsHeader ? activeData.slice(1) : activeData;
        if (dataRows.length === 0) return [];
        const colCount = dataRows[0]?.length || 0;
        return Array.from({ length: colCount }, (_, i) => getColumnType(i, dataRows));
    }, [activeData, settings.firstRowIsHeader, getColumnType]);

    return (
        <>
            <LoadingOverlay state={loadingState} />

            <div className="h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 transition-colors duration-300 font-sans flex flex-col overflow-hidden">

                {/* HEADER */}
                <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-4 z-40 shadow-xs shrink-0">
                    <div className="flex items-center gap-2">
                        <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <h1 className="text-xl font-bold tracking-tight">Fidelity Data Cleaner</h1>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.stickyHeaders} onChange={(e) => updateSetting('stickyHeaders', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className={`font-semibold ${settings.stickyHeaders ? 'text-green-600 dark:text-green-400' : 'text-slate-500'}`}>Sticky Headers</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.mergeFiles} onChange={(e) => updateSettingWithSpinner('mergeFiles', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-semibold text-blue-600 dark:text-blue-400">Merge Files</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.firstRowIsHeader} onChange={(e) => updateSettingWithSpinner('firstRowIsHeader', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-medium">1st Row = Header</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.firstColIsHeader} onChange={(e) => updateSettingWithSpinner('firstColIsHeader', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-medium">1st Col = Sticky</span>
                        </label>

                        <button onClick={() => updateSetting('theme', settings.theme === 'light' ? 'dark' : 'light')} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Toggle Theme">
                            {settings.theme === 'light' ? '🌙' : '☀️'}
                        </button>
                    </div>
                </header>

                {/* MAIN CONTENT */}
                <main className="flex-1 flex flex-col p-4 gap-4 max-w-full overflow-hidden min-h-0 bg-slate-50 dark:bg-slate-900 transition-colors duration-300">

                    <input type="file" ref={fileInputRef} multiple accept=".csv" className="hidden" onChange={handleFileUpload} />

                    {/* CONTROLS */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                            <button onClick={handleTriggerFileInput} disabled={loadingState.active}
                                    className="cursor-pointer bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center shadow-sm">
                                Import CSV Files
                            </button>
                            {dataSets.length > 0 && (
                                <button onClick={handleClearData} disabled={loadingState.active}
                                        className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-lg font-semibold transition-colors">
                                    Clear Data
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm w-full md:w-auto">
                            <span className="text-slate-500 dark:text-slate-400 mr-2 font-medium">Config:</span>
                            <button onClick={handleResetSettings} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition font-medium">Reset</button>
                            <button onClick={handleExportSettings} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition font-medium">Export JSON</button>
                            <label className="cursor-pointer px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition font-medium">
                                Import JSON
                                <input type="file" accept=".json" className="hidden" onChange={handleImportSettings} />
                            </label>
                        </div>
                    </div>

                    {/* DATA VIEWPORT */}
                    {dataSets.length === 0 && !loadingState.active ? (
                        <div onClick={handleTriggerFileInput}
                             className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-900/50 cursor-pointer group hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/20 dark:hover:bg-blue-950/10 transition-all duration-200">
                            <svg className="w-16 h-16 mb-4 opacity-50 group-hover:opacity-80 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                            <p className="text-lg font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">No CSV files loaded</p>
                            <p className="text-sm opacity-80 group-hover:opacity-100 transition-opacity">Upload raw Fidelity files, the app will auto-clean them.</p>
                        </div>
                    ) : dataSets.length > 0 ? (
                        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">

                            {/* TABS */}
                            {!settings.mergeFiles && (
                                <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-2 py-2 gap-2 hide-scrollbar shrink-0">
                                    {dataSets.map((dataset, idx) => (
                                        <button key={idx} onClick={() => setActiveTab(idx)}
                                                className={`px-4 py-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors ${
                                                    activeTab === idx
                                                        ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200 dark:border-slate-700'
                                                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                                                }`}>
                                            {dataset.fileName}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* SCROLL CONTAINER */}
                            <div className="flex-1 overflow-auto table-container relative min-h-0">

                                {settings.mergeFiles ? (
                                    /* === MERGE VIEW === */
                                    <div className="space-y-12 bg-slate-50/30 dark:bg-slate-900/10 w-max min-w-full">
                                        {dataSets.map((dataset, fileIdx) => {
                                            const { headers, rows } = getFileHeadersAndRows(dataset.data);
                                            const dataRows = settings.firstRowIsHeader ? dataset.data.slice(1) : dataset.data;
                                            const sortedRows = applySortToRows(rows, dataRows);

                                            return (
                                                <div key={fileIdx} className="relative border-b border-slate-200 dark:border-slate-800 last:border-none bg-white dark:bg-slate-950 flex flex-col w-full">

                                                    <div className={`${settings.stickyHeaders ? 'sticky top-0 z-30' : ''} bg-white dark:bg-slate-950 flex flex-col -mb-px`}>
                                                        <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-900/50 select-none py-1.5 h-8 w-max min-w-full relative">
                                                            <span className="sticky left-0 px-4 text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 z-10 py-1">
                                                                FILE [{fileIdx + 1}/{dataSets.length}]: {dataset.fileName}
                                                            </span>
                                                            <span className="absolute right-4 text-[10px] uppercase opacity-50 tracking-wider font-semibold top-2 text-blue-700 dark:text-blue-400">
                                                                Merged Block
                                                            </span>
                                                        </div>

                                                        <div className="flex bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold pt-[9px]">
                                                            {headers.map((header, i) => (
                                                                <div key={i}
                                                                     className={`px-4 py-2 shrink-0 flex items-center justify-between gap-1 w-[180px] bg-slate-100 dark:bg-slate-800
                                                                        ${settings.firstColIsHeader && i === 0 ? 'sticky left-0 z-35 border-r border-slate-300 dark:border-slate-700 font-bold' : ''}`}>
                                                                    <ColumnHeader
                                                                        header={header}
                                                                        colIndex={i}
                                                                        fileIndex={fileIdx}
                                                                        sortState={sortState}
                                                                        colType={getColumnType(i, dataRows)}
                                                                        isEditing={editingHeaderKey === `${fileIdx}-${i}`}
                                                                        editValue={editHeaderValue}
                                                                        onEditChange={setEditHeaderValue}
                                                                        onEditStart={() => startEditingHeader(fileIdx, i, header)}
                                                                        onEditSave={() => saveHeaderName(i)}
                                                                        onEditCancel={cancelEditingHeader}
                                                                        onSort={handleSort}
                                                                        onTypeChange={handleTypeChange}
                                                                        isMergeView={true}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="divide-y divide-slate-200 dark:divide-slate-800 flex flex-col text-sm">
                                                        {sortedRows.map((row, rowIndex) => (
                                                            <div key={rowIndex} className="flex hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                                                                {headers.map((_, colIndex) => {
                                                                    const cellValue = row[colIndex] || '';
                                                                    return (
                                                                        <div key={colIndex}
                                                                             className={`px-4 py-2 shrink-0 w-[180px] text-slate-800 dark:text-slate-300 truncate
                                                                                ${settings.firstColIsHeader && colIndex === 0 ? 'sticky left-0 bg-white dark:bg-slate-950 font-medium z-10 border-r border-slate-200 dark:border-slate-800 shadow-2xs' : ''}`}>
                                                                            {cellValue}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        ))}
                                                        {sortedRows.length === 0 && (
                                                            <div className="px-4 py-8 text-center text-slate-500 w-full">
                                                                No data rows successfully parsed within this file block.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    /* === TAB VIEW === */
                                    <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                                        <thead>
                                        <tr className="text-slate-700 dark:text-slate-300">
                                            {isolatedTable.headers.map((header, i) => (
                                                <th key={i}
                                                    className={`px-4 py-2 border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative
                                                        outline-1 outline-slate-100 dark:outline-slate-800
                                                        ${settings.stickyHeaders ? 'sticky top-0 z-20' : ''}
                                                        ${settings.firstColIsHeader && i === 0 ? 'sticky left-0 border-r border-slate-300 dark:border-slate-700' : ''}
                                                        ${settings.stickyHeaders && settings.firstColIsHeader && i === 0 ? 'z-30' : ''}`}>
                                                    <ColumnHeader
                                                        header={header}
                                                        colIndex={i}
                                                        fileIndex={activeTab}
                                                        sortState={sortState}
                                                        colType={activeColumnTypes[i] || 'string'}
                                                        isEditing={editingHeaderKey === `${activeTab}-${i}`}
                                                        editValue={editHeaderValue}
                                                        onEditChange={setEditHeaderValue}
                                                        onEditStart={() => startEditingHeader(activeTab, i, header)}
                                                        onEditSave={() => saveHeaderName(i)}
                                                        onEditCancel={cancelEditingHeader}
                                                        onSort={handleSort}
                                                        onTypeChange={handleTypeChange}
                                                    />
                                                </th>
                                            ))}
                                        </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                        {isolatedTable.rows.map((row, rowIndex) => (
                                            <tr key={rowIndex} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                                                {isolatedTable.headers.map((_, colIndex) => {
                                                    const cellValue = row[colIndex] || '';
                                                    return (
                                                        <td key={colIndex}
                                                            className={`px-4 py-2 text-slate-800 dark:text-slate-300
                                                                ${settings.firstColIsHeader && colIndex === 0 ? 'sticky left-0 bg-white dark:bg-slate-950 font-medium z-10 border-r border-slate-200 dark:border-slate-800' : ''}`}>
                                                            {cellValue}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                        {isolatedTable.rows.length === 0 && (
                                            <tr>
                                                <td colSpan={isolatedTable.headers.length || 1} className="px-4 py-8 text-center text-slate-500">
                                                    No table data successfully extracted. Check file structure.
                                                </td>
                                            </tr>
                                        )}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950" />
                    )}
                </main>
            </div>
        </>
    );
};

// --- BOOTSTRAP ---
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} else {
    console.error("Failed to find root element.");
}

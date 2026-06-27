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
 *
 * 7. [Layout-Heavy Settings Toggle Protection]
 * - Certain settings changes cause massive DOM restructuring when data is loaded.
 * - These "expensive" toggles are intercepted by `updateSettingWithSpinner`.
 *
 * 8. [Column Type System & Smart Sort Engine]
 * - Each column can be assigned a `ColumnType` that controls sort comparison behavior.
 * - Supported types: 'string', 'number', 'percent', 'currency', 'marketcap'.
 * - Auto-detection via regex sampling. Manual override via type badge click.
 *
 * 9. [Column Filter Engine]
 * - Per-column filter expressions parsed via `parseFilterExpression`.
 * - Expression grammar:
 *
 *   STRING MODE (type = string | marketcap):
 *     Tokens separated by SPACE = AND operation (all must match).
 *     Tokens separated by COMMA = OR operation (any must match).
 *     Quoted tokens: "multi word" or 'multi word' = treated as single token.
 *     Negation: !token or !"multi word" = must NOT contain.
 *     All matching is case-insensitive substring (contains).
 *     Example: `ab "cd e"` → row must contain "ab" AND "cd e"
 *     Example: `ab, cd` → row must contain "ab" OR "cd"
 *     Example: `!ab !"cd e"` → row must NOT contain "ab" AND must NOT contain "cd e"
 *     Example: `ab !cd, ef` → (contains "ab" AND NOT "cd") OR (contains "ef")
 *
 *   NUMERIC MODE (type = number | percent | currency):
 *     Operators: =, !=, >, >=, <, <=
 *     Bare number = equals: `22` means `=22`
 *     Negation shorthand: `!22` means `!=22`
 *     Space = AND, Comma = OR (same as string mode).
 *     Example: `>10 <50` → value > 10 AND value < 50
 *     Example: `!3 !5` → value != 3 AND value != 5
 *     Example: `>100, <-5` → value > 100 OR value < -5
 *     Example: `>=10 <=20, 50` → (10..20 inclusive) OR exactly 50
 *
 *   When a numeric column is overridden to 'string' type, the filter switches
 *   to string mode automatically, so `!3, !5` would filter by substring rules.
 *
 * - Parsed into `FilterExpression` AST: array of OR-groups, each an array of
 *   AND-conditions. Each condition has: { value, operator, negated }.
 * - `matchesFilter` evaluates a cell value against a `FilterExpression`.
 * - `applyFilters` applies all active column filters to a row set.
 *
 * DESIGN PATTERNS:
 * - Single File Application: Everything is self-contained for easy maintenance.
 * - Custom SVGs inline to avoid dependency bloat.
 * ============================================================================
 */

// @ts-ignore
import React, { useState, useEffect, useRef, useMemo, useCallback, ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';

// ============================================================================
// TYPES
// ============================================================================

type ColumnType = 'string' | 'number' | 'percent' | 'currency' | 'marketcap';

const ALL_COLUMN_TYPES: ColumnType[] = ['string', 'number', 'percent', 'currency', 'marketcap'];

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
    string: 'ABC', number: '123', percent: '%', currency: '$', marketcap: 'Cap',
};

const COLUMN_TYPE_COLORS: Record<ColumnType, string> = {
    string: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
    number: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',
    percent: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300',
    currency: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300',
    marketcap: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
};

/** Column types that use numeric filter operators (=, !=, >, <, >=, <=) */
const NUMERIC_FILTER_TYPES: Set<ColumnType> = new Set(['number', 'percent', 'currency']);

interface AppSettings {
    theme: 'light' | 'dark';
    firstRowIsHeader: boolean;
    firstColIsHeader: boolean;
    mergeFiles: boolean;
    stickyHeaders: boolean;
    columnCustomNames: Record<number, string>;
    columnTypeOverrides: Record<number, ColumnType>;
}

interface DataSet { fileName: string; data: string[][]; }

interface SortState { columnIndex: number | null; direction: 'asc' | 'desc'; }

interface LoadingState {
    active: boolean;
    phase: 'idle' | 'parsing' | 'rendering';
    current: number;
    total: number;
    fileName: string;
}

// --- FILTER TYPES ---

interface StringFilterCondition {
    type: 'string';
    value: string;
    negated: boolean;
}

interface NumericFilterCondition {
    type: 'numeric';
    value: number;
    operator: '=' | '!=' | '>' | '>=' | '<' | '<=';
}

type FilterCondition = StringFilterCondition | NumericFilterCondition;

interface FilterExpression {
    orGroups: FilterCondition[][];
}

const DEFAULT_SETTINGS: AppSettings = {
    theme: 'light',
    firstRowIsHeader: false,
    firstColIsHeader: true,
    mergeFiles: false,
    stickyHeaders: true,
    columnCustomNames: {},
    columnTypeOverrides: {},
};

const DEFAULT_LOADING_STATE: LoadingState = { active: false, phase: 'idle', current: 0, total: 0, fileName: '' };
const DEFAULT_SORT_STATE: SortState = { columnIndex: null, direction: 'asc' };
const EXPENSIVE_TOGGLE_ROW_THRESHOLD = 500;
const TYPE_DETECTION_SAMPLE_SIZE = 20;
const LAYOUT_RESTRUCTURING_KEYS: Set<keyof AppSettings> = new Set(['mergeFiles', 'firstRowIsHeader', 'firstColIsHeader']);
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// ============================================================================
// CSV PARSING
// ============================================================================

function parseCSVRow(row: string): string[] {
    const result: string[] = [];
    let inQuotes = false;
    let currentValue = '';
    for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
            if (inQuotes && row[i + 1] === '"') { currentValue += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (char === ',' && !inQuotes) {
            result.push(currentValue.trim());
            currentValue = '';
        } else { currentValue += char; }
    }
    result.push(currentValue.trim());
    return result;
}

function extractValidTableData(rawText: string): string[][] {
    const lines = rawText.split(/\r?\n/).filter(line => line.trim() !== '');
    const parsedLines = lines.map(parseCSVRow);
    if (parsedLines.length === 0) return [];
    const colCounts: Record<number, number> = {};
    parsedLines.forEach(row => { if (row.length > 2) colCounts[row.length] = (colCounts[row.length] || 0) + 1; });
    let targetColLength = 0, maxOccurrences = 0;
    for (const [lengthStr, count] of Object.entries(colCounts)) {
        if (count > maxOccurrences) { maxOccurrences = count; targetColLength = parseInt(lengthStr, 10); }
    }
    if (targetColLength === 0) targetColLength = Math.max(...parsedLines.map(r => r.length));
    const tableData: string[][] = [];
    let isRecording = false;
    for (const row of parsedLines) {
        if (row.length === targetColLength || row.length === targetColLength + 1) {
            isRecording = true;
            tableData.push(row.slice(0, targetColLength));
        } else if (isRecording && row.length < targetColLength - 1) { break; }
    }
    return tableData.length > 0 ? tableData : parsedLines;
}

// ============================================================================
// COLUMN TYPE DETECTION & VALUE EXTRACTION
// ============================================================================

const TYPE_PATTERNS: { type: ColumnType; pattern: RegExp }[] = [
    { type: 'marketcap', pattern: /\$[\d,.]+\s*[KMBT]/i },
    { type: 'percent', pattern: /^-?[\d,.]+\s*%$/ },
    { type: 'currency', pattern: /^[($-]*\$[\d,.]+\)?$/ },
    { type: 'number', pattern: /^[+-]?[\d,]+\.?\d*$/ },
];

function detectColumnType(rows: string[][], colIndex: number): ColumnType {
    const samples: string[] = [];
    for (let i = 0; i < rows.length && samples.length < TYPE_DETECTION_SAMPLE_SIZE; i++) {
        const val = (rows[i][colIndex] || '').trim();
        if (val !== '' && val !== '--' && val !== 'N/A' && val !== 'n/a') samples.push(val);
    }
    if (samples.length === 0) return 'string';
    const threshold = samples.length * 0.6;
    for (const { type, pattern } of TYPE_PATTERNS) {
        if (samples.filter(s => pattern.test(s)).length >= threshold) return type;
    }
    return 'string';
}

const SUFFIX_MULTIPLIERS: Record<string, number> = { 'K': 1e3, 'M': 1e6, 'B': 1e9, 'T': 1e12 };

function extractSortValue(cellValue: string, colType: ColumnType): number | string | null {
    const trimmed = cellValue.trim();
    if (trimmed === '' || trimmed === '--' || trimmed === 'N/A' || trimmed === 'n/a') return null;
    switch (colType) {
        case 'number': { const n = parseFloat(trimmed.replace(/,/g, '')); return isNaN(n) ? null : n; }
        case 'percent': { const n = parseFloat(trimmed.replace(/%/g, '').replace(/,/g, '')); return isNaN(n) ? null : n; }
        case 'currency': {
            let c = trimmed.replace(/[$,\s]/g, '');
            const neg = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
            c = c.replace(/[()]/g, '').replace(/^-/, '');
            const n = parseFloat(c); if (isNaN(n)) return null;
            return neg ? -n : n;
        }
        case 'marketcap': {
            const m = trimmed.match(/\$([\d,.]+)\s*([KMBT])/i);
            if (m) { const b = parseFloat(m[1].replace(/,/g, '')); return isNaN(b) ? null : b * (SUFFIX_MULTIPLIERS[m[2].toUpperCase()] || 1); }
            const f = trimmed.match(/\$([\d,.]+)/);
            if (f) { const n = parseFloat(f[1].replace(/,/g, '')); return isNaN(n) ? null : n; }
            return null;
        }
        default: return trimmed;
    }
}

function extractNumericValue(cellValue: string, colType: ColumnType): number | null {
    const v = extractSortValue(cellValue, colType);
    if (typeof v === 'number') return v;
    return null;
}

function getComparator(colIndex: number, direction: 'asc' | 'desc', colType: ColumnType): (a: string[], b: string[]) => number {
    const m = direction === 'asc' ? 1 : -1;
    return (a, b) => {
        const aV = extractSortValue(a[colIndex] || '', colType);
        const bV = extractSortValue(b[colIndex] || '', colType);
        if (aV === null && bV === null) return 0;
        if (aV === null) return 1;
        if (bV === null) return -1;
        if (colType === 'string') return m * naturalCollator.compare(aV as string, bV as string);
        return m * ((aV as number) - (bV as number));
    };
}

// ============================================================================
// FILTER ENGINE
// ============================================================================

/**
 * Tokenizes a filter input string into raw tokens, respecting quoted strings.
 * Commas are preserved as "," separator tokens. Spaces split unquoted tokens.
 * Negation (!) before quotes is preserved: !"multi word" → "!multi word"
 */
function tokenizeFilterInput(input: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    const len = input.length;

    while (i < len) {
        if (input[i] === ' ' || input[i] === '\t') { i++; continue; }
        if (input[i] === ',') { tokens.push(','); i++; continue; }

        let token = '';

        // Check for negation prefix before a quote
        if (input[i] === '!' && i + 1 < len) {
            if (input[i + 1] === '"' || input[i + 1] === "'") {
                token = '!';
                i++;
                // Fall through to quote handling below
            } else {
                token = '!';
                i++;
                while (i < len && input[i] !== ' ' && input[i] !== '\t' && input[i] !== ',') {
                    token += input[i]; i++;
                }
                tokens.push(token);
                continue;
            }
        }

        // Quoted string
        if (input[i] === '"' || input[i] === "'") {
            const quote = input[i];
            i++; // skip opening quote
            while (i < len && input[i] !== quote) { token += input[i]; i++; }
            if (i < len) i++; // skip closing quote
            tokens.push(token);
            continue;
        }

        // Regular unquoted token
        while (i < len && input[i] !== ' ' && input[i] !== '\t' && input[i] !== ',') {
            token += input[i]; i++;
        }
        if (token) tokens.push(token);
    }

    return tokens;
}

function parseStringToken(token: string): StringFilterCondition {
    const negated = token.startsWith('!');
    const value = negated ? token.slice(1) : token;
    return { type: 'string', value: value.toLowerCase(), negated };
}

const NUMERIC_TOKEN_REGEX = /^(!?)(>=|<=|!=|>|<|=)?(-?[\d,.]+)$/;

function parseNumericToken(token: string): NumericFilterCondition | null {
    const match = token.match(NUMERIC_TOKEN_REGEX);
    if (!match) return null;

    const [, negPrefix, operatorStr, numStr] = match;
    const value = parseFloat(numStr.replace(/,/g, ''));
    if (isNaN(value)) return null;

    let operator: NumericFilterCondition['operator'];

    if (operatorStr) {
        if (negPrefix === '!') {
            const inversions: Record<string, NumericFilterCondition['operator']> = {
                '>': '<=', '>=': '<', '<': '>=', '<=': '>', '=': '!=', '!=': '='
            };
            operator = inversions[operatorStr] || '=';
        } else {
            operator = operatorStr as NumericFilterCondition['operator'];
        }
    } else {
        operator = negPrefix === '!' ? '!=' : '=';
    }

    return { type: 'numeric', value, operator };
}

/**
 * Parses a raw filter input string into a FilterExpression AST.
 * Returns null for empty/whitespace-only input.
 */
function parseFilterExpression(input: string, colType: ColumnType): FilterExpression | null {
    const trimmed = input.trim();
    if (trimmed === '') return null;

    const tokens = tokenizeFilterInput(trimmed);
    if (tokens.length === 0) return null;

    const isNumericMode = NUMERIC_FILTER_TYPES.has(colType);
    const orGroups: FilterCondition[][] = [];
    let currentGroup: FilterCondition[] = [];

    for (const token of tokens) {
        if (token === ',') {
            if (currentGroup.length > 0) {
                orGroups.push(currentGroup);
                currentGroup = [];
            }
            continue;
        }

        if (isNumericMode) {
            const numCondition = parseNumericToken(token);
            if (numCondition) {
                currentGroup.push(numCondition);
            } else {
                currentGroup.push(parseStringToken(token));
            }
        } else {
            currentGroup.push(parseStringToken(token));
        }
    }

    if (currentGroup.length > 0) orGroups.push(currentGroup);
    return orGroups.length > 0 ? { orGroups } : null;
}

/**
 * Evaluates whether a single cell value matches a FilterExpression.
 * OR-groups: at least ONE must fully match. AND within group: ALL must match.
 */
function matchesFilter(cellValue: string, filter: FilterExpression, colType: ColumnType): boolean {
    const cellLower = cellValue.toLowerCase();
    const cellNumeric = NUMERIC_FILTER_TYPES.has(colType) ? extractNumericValue(cellValue, colType) : null;

    return filter.orGroups.some(group => {
        return group.every(condition => {
            if (condition.type === 'string') {
                const contains = cellLower.includes(condition.value);
                return condition.negated ? !contains : contains;
            }

            if (condition.type === 'numeric') {
                if (cellNumeric === null) return condition.operator === '!=';
                switch (condition.operator) {
                    case '=':  return cellNumeric === condition.value;
                    case '!=': return cellNumeric !== condition.value;
                    case '>':  return cellNumeric > condition.value;
                    case '>=': return cellNumeric >= condition.value;
                    case '<':  return cellNumeric < condition.value;
                    case '<=': return cellNumeric <= condition.value;
                    default:   return false;
                }
            }
            return false;
        });
    });
}

/**
 * Applies all active column filters to a set of rows.
 * Pre-parses filter expressions, then filters rows where ALL column filters match.
 */
function applyFilters(
    rows: string[][],
    filters: Record<number, string>,
    getColType: (colIndex: number) => ColumnType,
): string[][] {
    const parsedFilters: { colIndex: number; expression: FilterExpression; colType: ColumnType }[] = [];

    for (const [colIdxStr, filterStr] of Object.entries(filters)) {
        const colIndex = parseInt(colIdxStr, 10);
        const colType = getColType(colIndex);
        const expression = parseFilterExpression(filterStr, colType);
        if (expression) parsedFilters.push({ colIndex, expression, colType });
    }

    if (parsedFilters.length === 0) return rows;

    return rows.filter(row =>
        parsedFilters.every(({ colIndex, expression, colType }) =>
            matchesFilter(row[colIndex] || '', expression, colType)
        )
    );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function yieldToMain(): Promise<void> { return new Promise(r => setTimeout(r, 0)); }

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error(`Failed to read: ${file.name}`));
        reader.readAsText(file);
    });
}

function waitForPaint(): Promise<void> {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

function getTotalRowCount(dataSets: DataSet[]): number {
    return dataSets.reduce((sum, ds) => sum + ds.data.length, 0);
}

// ============================================================================
// LOADING OVERLAY
// ============================================================================

const LoadingOverlay: React.FC<{ state: LoadingState }> = ({ state }) => {
    if (!state.active) return null;
    const isParsing = state.phase === 'parsing';
    const isRendering = state.phase === 'rendering';
    const progressFraction = isRendering ? 1 : state.total > 0 ? Math.max(state.current / state.total, 0) : 0;
    const progressPercent = Math.round(progressFraction * 100);

    return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]" aria-live="polite" role="status">
            <div className="flex flex-col items-center gap-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl px-10 py-8 min-w-[280px] max-w-[380px]">
                <div className="relative flex items-center justify-center w-20 h-20">
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" className="text-slate-200 dark:text-slate-700" /></svg>
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 34}`} strokeDashoffset={`${2 * Math.PI * 34 * (1 - progressFraction)}`} className="text-blue-500 dark:text-blue-400" style={{ transition: 'stroke-dashoffset 0.35s cubic-bezier(0.4,0,0.2,1)' }} /></svg>
                    <svg className="absolute inset-0 w-full h-full animate-spin" viewBox="0 0 80 80" fill="none" style={{ animationDuration: '1.1s' }}><circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="20 193" className="text-blue-400/60 dark:text-blue-300/50" /></svg>
                    <div className="relative z-10 flex items-center justify-center w-11 h-11 rounded-full bg-blue-50 dark:bg-blue-950/60 animate-pulse" style={{ animationDuration: '1.6s' }}>
                        {isParsing ? <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            : <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" /></svg>}
                    </div>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-center">
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100">{isParsing ? 'Processing Files…' : 'Rendering Table…'}</p>
                    {isParsing ? <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />{state.current} of {state.total} parsed</span>
                        : <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />Building DOM layout…</span>}
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden"><div className={`h-full rounded-full transition-all duration-300 ease-out ${isRendering ? 'bg-amber-500 dark:bg-amber-400 animate-pulse' : 'bg-blue-500 dark:bg-blue-400'}`} style={{ width: `${progressPercent}%` }} /></div>
                {isParsing && state.fileName && <p className="text-xs text-slate-400 dark:text-slate-500 max-w-full truncate text-center font-mono" title={state.fileName}>{state.fileName}</p>}
                {isRendering && <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center leading-snug">Large tables may take a moment to paint.<br />The spinner will dismiss after the browser finishes.</p>}
            </div>
        </div>
    );
};

// ============================================================================
// INLINE HEADER EDITOR
// ============================================================================

const InlineHeaderEditor: React.FC<{
    value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; isMergeView?: boolean;
}> = ({ value, onChange, onSave, onCancel, isMergeView = false }) => {
    const cancelledRef = useRef(false);
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') onSave(); else if (e.key === 'Escape') { cancelledRef.current = true; onCancel(); } };
    const handleBlur = () => { if (cancelledRef.current) { cancelledRef.current = false; return; } onSave(); };
    return (
        <div className="flex items-center gap-1 w-full">
            <input type="text" value={value} onChange={e => onChange(e.target.value)} onBlur={handleBlur} onKeyDown={handleKeyDown} className={`bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2 rounded border border-blue-500 focus:outline-none text-xs font-normal flex-1 min-w-0 ${isMergeView ? 'py-0.5' : 'py-1'}`} autoFocus />
            <button onMouseDown={e => e.preventDefault()} onClick={onSave} className="shrink-0 p-0.5 rounded text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors" title="Save (Enter)"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg></button>
            <button onMouseDown={e => { e.preventDefault(); cancelledRef.current = true; }} onClick={onCancel} className="shrink-0 p-0.5 rounded text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors" title="Cancel (Esc)"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
    );
};

// ============================================================================
// FILTER INPUT COMPONENT
// ============================================================================

/**
 * Inline filter input rendered below each column header.
 * Shows a small text input that appears on hover or when a filter is active.
 */
const ColumnFilterInput: React.FC<{
    colIndex: number;
    filterValue: string;
    colType: ColumnType;
    onFilterChange: (colIndex: number, value: string) => void;
}> = ({ colIndex, filterValue, colType, onFilterChange }) => {
    const isActive = filterValue.trim() !== '';
    const isNumeric = NUMERIC_FILTER_TYPES.has(colType);
    const placeholder = isNumeric ? '>10 <50, =22' : 'filter…';

    return (
        <div className={`flex items-center gap-0.5 w-full mt-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover/header:opacity-100'}`}>
            <svg className={`w-3 h-3 shrink-0 ${isActive ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}
                 fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <input
                type="text"
                value={filterValue}
                onChange={(e) => onFilterChange(colIndex, e.target.value)}
                placeholder={placeholder}
                className={`w-full min-w-0 text-[10px] px-1 py-0.5 rounded font-normal bg-white dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500
                    ${isActive ? 'border border-blue-400 dark:border-blue-600 text-slate-800 dark:text-slate-200' : 'border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
                title={isNumeric ? 'Numeric filter: =, !=, >, >=, <, <=. Space=AND, Comma=OR. Example: >10 <50' : 'Text filter: space=AND, comma=OR, !=NOT, "quotes"=phrase. Example: ab "cd e", !xyz'}
            />
            {isActive && (
                <button onClick={() => onFilterChange(colIndex, '')} className="shrink-0 p-0.5 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" title="Clear filter">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            )}
        </div>
    );
};

// ============================================================================
// COLUMN HEADER COMPONENT
// ============================================================================

const ColumnHeader: React.FC<{
    header: string; colIndex: number; fileIndex: number;
    sortState: SortState; colType: ColumnType;
    isEditing: boolean; editValue: string;
    filterValue: string;
    onEditChange: (v: string) => void; onEditStart: () => void;
    onEditSave: () => void; onEditCancel: () => void;
    onSort: (col: number, dir: 'asc' | 'desc') => void;
    onTypeChange: (col: number, t: ColumnType) => void;
    onFilterChange: (col: number, value: string) => void;
    isMergeView?: boolean;
}> = ({
          header, colIndex, sortState, colType, isEditing, editValue, filterValue,
          onEditChange, onEditStart, onEditSave, onEditCancel,
          onSort, onTypeChange, onFilterChange, isMergeView = false,
      }) => {
    const isActiveSort = sortState.columnIndex === colIndex;
    const isAsc = isActiveSort && sortState.direction === 'asc';
    const isDesc = isActiveSort && sortState.direction === 'desc';

    if (isEditing) {
        return <InlineHeaderEditor value={editValue} onChange={onEditChange} onSave={onEditSave} onCancel={onEditCancel} isMergeView={isMergeView} />;
    }

    return (
        <div className="flex flex-col w-full group/header">
            <div className="flex items-center justify-between gap-1 w-full">
                {/* Sort triangles */}
                <div className="flex flex-col shrink-0 -my-1 opacity-0 group-hover/header:opacity-100 transition-opacity">
                    <button onClick={() => onSort(colIndex, 'asc')} className={`p-0 leading-none transition-colors ${isAsc ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400'}`} title="Sort Ascending">
                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2L10 8H2L6 2Z" /></svg>
                    </button>
                    <button onClick={() => onSort(colIndex, 'desc')} className={`p-0 leading-none transition-colors ${isDesc ? 'text-blue-600 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400'}`} title="Sort Descending">
                        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L2 4H10L6 10Z" /></svg>
                    </button>
                </div>

                <span className={`truncate flex-1 ${isMergeView ? '' : 'font-semibold'}`}>{header}</span>

                {/* Type badge */}
                <button onClick={e => { e.stopPropagation(); const i = ALL_COLUMN_TYPES.indexOf(colType); onTypeChange(colIndex, ALL_COLUMN_TYPES[(i + 1) % ALL_COLUMN_TYPES.length]); }}
                        className={`shrink-0 px-1.5 py-0 rounded text-[9px] font-bold leading-4 tracking-wide transition-all cursor-pointer border border-transparent hover:border-slate-400 dark:hover:border-slate-500 ${isActiveSort ? 'opacity-100' : 'opacity-0 group-hover/header:opacity-70'} ${COLUMN_TYPE_COLORS[colType]}`}
                        title={`Column type: ${colType}. Click to cycle.`}>
                    {COLUMN_TYPE_LABELS[colType]}
                </button>

                {/* Edit button */}
                <button onClick={onEditStart} className="opacity-0 group-hover/header:opacity-100 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-all p-0.5 shrink-0" title="Rename Column">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>

                {/* Active sort indicator */}
                {isActiveSort && (
                    <span className="shrink-0 text-blue-500 dark:text-blue-400">
                        {isAsc ? <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2L10 8H2L6 2Z" /></svg>
                            : <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L2 4H10L6 10Z" /></svg>}
                    </span>
                )}
            </div>

            {/* Filter input — below header name */}
            <ColumnFilterInput colIndex={colIndex} filterValue={filterValue} colType={colType} onFilterChange={onFilterChange} />
        </div>
    );
};

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

const App: React.FC = () => {
    const [settings, setSettings] = useState<AppSettings>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('fidelityApp_settings');
            if (saved) { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) }; } catch { /* ignore */ } }
        }
        return DEFAULT_SETTINGS;
    });

    const [dataSets, setDataSets] = useState<DataSet[]>([]);
    const [activeTab, setActiveTab] = useState<number>(0);
    const [loadingState, setLoadingState] = useState<LoadingState>(DEFAULT_LOADING_STATE);
    const [sortState, setSortState] = useState<SortState>(DEFAULT_SORT_STATE);
    const [editingHeaderKey, setEditingHeaderKey] = useState<string | null>(null);
    const [editHeaderValue, setEditHeaderValue] = useState<string>('');
    const [columnFilters, setColumnFilters] = useState<Record<number, string>>({});

    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Theme & cache sync ---
    useEffect(() => {
        localStorage.setItem('fidelityApp_settings', JSON.stringify(settings));
        if (settings.theme === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
    }, [settings]);

    // --- Paint detection for rendering phase ---
    useEffect(() => {
        if (loadingState.phase !== 'rendering') return;
        let cancelled = false;
        const go = async () => { await waitForPaint(); await waitForPaint(); if (!cancelled) setLoadingState(DEFAULT_LOADING_STATE); };
        go();
        return () => { cancelled = true; };
    }, [loadingState.phase]);

    // --- Reset sort and filters on tab/merge change ---
    useEffect(() => {
        setSortState(DEFAULT_SORT_STATE);
        setColumnFilters({});
    }, [activeTab, settings.mergeFiles]);

    const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setSettings(prev => ({ ...prev, [key]: value }));

    const updateSettingWithSpinner = useCallback(async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        const totalRows = getTotalRowCount(dataSets);
        if (LAYOUT_RESTRUCTURING_KEYS.has(key) && totalRows >= EXPENSIVE_TOGGLE_ROW_THRESHOLD) {
            setLoadingState({ active: true, phase: 'rendering', current: 0, total: 0, fileName: '' });
            await yieldToMain();
        }
        setSettings(prev => ({ ...prev, [key]: value }));
    }, [dataSets]);

    const handleResetSettings = useCallback(async () => {
        if (getTotalRowCount(dataSets) >= EXPENSIVE_TOGGLE_ROW_THRESHOLD) {
            setLoadingState({ active: true, phase: 'rendering', current: 0, total: 0, fileName: '' });
            await yieldToMain();
        }
        setSettings(DEFAULT_SETTINGS);
        setSortState(DEFAULT_SORT_STATE);
        setColumnFilters({});
    }, [dataSets]);

    const handleExportSettings = () => {
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = 'fidelity_settings.json'; a.click(); URL.revokeObjectURL(url);
    };

    const handleImportSettings = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const imported = JSON.parse(event.target?.result as string);
                if (imported && typeof imported === 'object') {
                    if (getTotalRowCount(dataSets) >= EXPENSIVE_TOGGLE_ROW_THRESHOLD) {
                        setLoadingState({ active: true, phase: 'rendering', current: 0, total: 0, fileName: '' });
                        await yieldToMain();
                    }
                    setSettings({ ...DEFAULT_SETTINGS, ...imported });
                }
            } catch { alert("Invalid JSON format"); }
        };
        reader.readAsText(file); e.target.value = '';
    }, [dataSets]);

    const handleTriggerFileInput = () => fileInputRef.current?.click();

    // --- File processing pipeline ---
    const processFilesAsync = useCallback(async (files: File[]) => {
        setLoadingState({ active: true, phase: 'parsing', current: 0, total: files.length, fileName: '' });
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
            } catch (err) { console.error(`Error processing ${file.name}:`, err); }
            setLoadingState(prev => ({ ...prev, current: i + 1 }));
            await yieldToMain();
        }
        setLoadingState(prev => ({ ...prev, phase: 'rendering', fileName: '' }));
        await yieldToMain();
        setDataSets(prev => [...prev, ...newResults].sort((a, b) => naturalCollator.compare(a.fileName, b.fileName)));
    }, []);

    const handleFileUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files; if (!files || files.length === 0) return;
        const fileArray = Array.from(files);
        e.target.value = '';
        processFilesAsync(fileArray).catch(err => { console.error('Unexpected error:', err); setLoadingState(DEFAULT_LOADING_STATE); });
    }, [processFilesAsync]);

    const handleClearData = () => { setDataSets([]); setActiveTab(0); setSortState(DEFAULT_SORT_STATE); setColumnFilters({}); };

    // --- Inline editing ---
    const startEditingHeader = (fileIndex: number, colIndex: number, currentValue: string) => { setEditingHeaderKey(`${fileIndex}-${colIndex}`); setEditHeaderValue(currentValue); };
    const saveHeaderName = (colIndex: number) => { if (editHeaderValue.trim() !== '') setSettings(prev => ({ ...prev, columnCustomNames: { ...prev.columnCustomNames, [colIndex]: editHeaderValue.trim() } })); setEditingHeaderKey(null); };
    const cancelEditingHeader = () => { setEditingHeaderKey(null); setEditHeaderValue(''); };

    // --- Sort ---
    const handleSort = useCallback((colIndex: number, direction: 'asc' | 'desc') => {
        setSortState(prev => prev.columnIndex === colIndex && prev.direction === direction ? DEFAULT_SORT_STATE : { columnIndex: colIndex, direction });
    }, []);

    // --- Type change ---
    const handleTypeChange = useCallback((colIndex: number, newType: ColumnType) => {
        setSettings(prev => ({ ...prev, columnTypeOverrides: { ...prev.columnTypeOverrides, [colIndex]: newType } }));
        setSortState(DEFAULT_SORT_STATE);
    }, []);

    // --- Filter change ---
    const handleFilterChange = useCallback((colIndex: number, value: string) => {
        setColumnFilters(prev => {
            const next = { ...prev };
            if (value.trim() === '') { delete next[colIndex]; } else { next[colIndex] = value; }
            return next;
        });
    }, []);

    // --- Data transformation ---
    const getFileHeadersAndRows = useCallback((fileRawRows: string[][]) => {
        if (fileRawRows.length === 0) return { headers: [] as string[], rows: [] as string[][] };
        const totalColumns = fileRawRows[0].length;
        const fileHeaders = settings.firstRowIsHeader ? fileRawRows[0] : [];
        const headers = Array.from({ length: totalColumns }, (_, i) => settings.columnCustomNames[i] || (settings.firstRowIsHeader && fileHeaders[i] ? fileHeaders[i] : `Col ${i + 1}`));
        const rows = settings.firstRowIsHeader ? fileRawRows.slice(1) : fileRawRows;
        return { headers, rows };
    }, [settings.firstRowIsHeader, settings.columnCustomNames]);

    const getColumnType = useCallback((colIndex: number, dataRows: string[][]): ColumnType => {
        return settings.columnTypeOverrides[colIndex] || detectColumnType(dataRows, colIndex);
    }, [settings.columnTypeOverrides]);

    const applySortToRows = useCallback((rows: string[][], dataRows: string[][]): string[][] => {
        if (sortState.columnIndex === null) return rows;
        const colType = getColumnType(sortState.columnIndex, dataRows);
        return [...rows].sort(getComparator(sortState.columnIndex, sortState.direction, colType));
    }, [sortState, getColumnType]);

    const activeData = dataSets[activeTab]?.data || [];

    const isolatedTable = useMemo(() => {
        const { headers, rows } = getFileHeadersAndRows(activeData);
        const dataRows = settings.firstRowIsHeader ? activeData.slice(1) : activeData;
        const getColType = (i: number) => getColumnType(i, dataRows);
        const filtered = applyFilters(rows, columnFilters, getColType);
        const sorted = applySortToRows(filtered, dataRows);
        return { headers, rows: sorted, totalBeforeFilter: rows.length };
    }, [activeData, getFileHeadersAndRows, applySortToRows, columnFilters, getColumnType, settings.firstRowIsHeader]);

    const activeColumnTypes = useMemo((): ColumnType[] => {
        const dataRows = settings.firstRowIsHeader ? activeData.slice(1) : activeData;
        if (dataRows.length === 0) return [];
        return Array.from({ length: dataRows[0]?.length || 0 }, (_, i) => getColumnType(i, dataRows));
    }, [activeData, settings.firstRowIsHeader, getColumnType]);

    const hasActiveFilters = Object.keys(columnFilters).length > 0;

    return (
        <>
            <LoadingOverlay state={loadingState} />
            <div className="h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 transition-colors duration-300 font-sans flex flex-col overflow-hidden">

                {/* HEADER */}
                <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-4 z-40 shadow-xs shrink-0">
                    <div className="flex items-center gap-2">
                        <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <h1 className="text-xl font-bold tracking-tight">Fidelity Data Cleaner</h1>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.stickyHeaders} onChange={e => updateSetting('stickyHeaders', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className={`font-semibold ${settings.stickyHeaders ? 'text-green-600 dark:text-green-400' : 'text-slate-500'}`}>Sticky Headers</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.mergeFiles} onChange={e => updateSettingWithSpinner('mergeFiles', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-semibold text-blue-600 dark:text-blue-400">Merge Files</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.firstRowIsHeader} onChange={e => updateSettingWithSpinner('firstRowIsHeader', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-medium">1st Row = Header</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.firstColIsHeader} onChange={e => updateSettingWithSpinner('firstColIsHeader', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-medium">1st Col = Sticky</span>
                        </label>
                        <button onClick={() => updateSetting('theme', settings.theme === 'light' ? 'dark' : 'light')} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Toggle Theme">
                            {settings.theme === 'light' ? '🌙' : '☀️'}
                        </button>
                    </div>
                </header>

                {/* MAIN */}
                <main className="flex-1 flex flex-col p-4 gap-4 max-w-full overflow-hidden min-h-0 bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
                    <input type="file" ref={fileInputRef} multiple accept=".csv" className="hidden" onChange={handleFileUpload} />

                    {/* CONTROLS */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                            <button onClick={handleTriggerFileInput} disabled={loadingState.active} className="cursor-pointer bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center shadow-sm">Import CSV Files</button>
                            {dataSets.length > 0 && <button onClick={handleClearData} disabled={loadingState.active} className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-lg font-semibold transition-colors">Clear Data</button>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm w-full md:w-auto">
                            <span className="text-slate-500 dark:text-slate-400 mr-2 font-medium">Config:</span>
                            <button onClick={handleResetSettings} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition font-medium">Reset</button>
                            <button onClick={handleExportSettings} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition font-medium">Export JSON</button>
                            <label className="cursor-pointer px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition font-medium">Import JSON<input type="file" accept=".json" className="hidden" onChange={handleImportSettings} /></label>
                            {hasActiveFilters && (
                                <button onClick={() => setColumnFilters({})} className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50 transition font-medium text-xs">
                                    Clear All Filters
                                </button>
                            )}
                        </div>
                    </div>

                    {/* DATA VIEWPORT */}
                    {dataSets.length === 0 && !loadingState.active ? (
                        <div onClick={handleTriggerFileInput} className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-900/50 cursor-pointer group hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/20 dark:hover:bg-blue-950/10 transition-all duration-200">
                            <svg className="w-16 h-16 mb-4 opacity-50 group-hover:opacity-80 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                            <p className="text-lg font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">No CSV files loaded</p>
                            <p className="text-sm opacity-80 group-hover:opacity-100 transition-opacity">Upload raw Fidelity files, the app will auto-clean them.</p>
                        </div>
                    ) : dataSets.length > 0 ? (
                        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">

                            {/* TABS */}
                            {!settings.mergeFiles && (
                                <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-2 py-2 gap-2 hide-scrollbar shrink-0">
                                    {dataSets.map((ds, idx) => (
                                        <button key={idx} onClick={() => setActiveTab(idx)} className={`px-4 py-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === idx ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200 dark:border-slate-700' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'}`}>
                                            {ds.fileName}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Filter status bar */}
                            {hasActiveFilters && !settings.mergeFiles && (
                                <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800/50 text-xs text-blue-700 dark:text-blue-400 shrink-0">
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                                    <span className="font-semibold">Showing {isolatedTable.rows.length} of {isolatedTable.totalBeforeFilter} rows</span>
                                    <span className="text-blue-500 dark:text-blue-500">({isolatedTable.totalBeforeFilter - isolatedTable.rows.length} filtered out)</span>
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
                                            const getColType = (i: number) => getColumnType(i, dataRows);
                                            const filtered = applyFilters(rows, columnFilters, getColType);
                                            const sorted = applySortToRows(filtered, dataRows);

                                            return (
                                                <div key={fileIdx} className="relative border-b border-slate-200 dark:border-slate-800 last:border-none bg-white dark:bg-slate-950 flex flex-col w-full">
                                                    <div className={`${settings.stickyHeaders ? 'sticky top-0 z-30' : ''} bg-white dark:bg-slate-950 flex flex-col -mb-px`}>
                                                        <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-900/50 select-none py-1.5 h-8 w-max min-w-full relative">
                                                            <span className="sticky left-0 px-4 text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 z-10 py-1">
                                                                FILE [{fileIdx + 1}/{dataSets.length}]: {dataset.fileName}
                                                                {hasActiveFilters && <span className="ml-2 text-blue-500">({sorted.length}/{rows.length} rows)</span>}
                                                            </span>
                                                            <span className="absolute right-4 text-[10px] uppercase opacity-50 tracking-wider font-semibold top-2 text-blue-700 dark:text-blue-400">Merged Block</span>
                                                        </div>
                                                        <div className="flex bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold pt-[9px]">
                                                            {headers.map((header, i) => (
                                                                <div key={i} className={`px-4 py-2 shrink-0 flex items-center justify-between gap-1 w-[180px] bg-slate-100 dark:bg-slate-800 ${settings.firstColIsHeader && i === 0 ? 'sticky left-0 z-35 border-r border-slate-300 dark:border-slate-700 font-bold' : ''}`}>
                                                                    <ColumnHeader header={header} colIndex={i} fileIndex={fileIdx} sortState={sortState} colType={getColType(i)} isEditing={editingHeaderKey === `${fileIdx}-${i}`} editValue={editHeaderValue} filterValue={columnFilters[i] || ''} onEditChange={setEditHeaderValue} onEditStart={() => startEditingHeader(fileIdx, i, header)} onEditSave={() => saveHeaderName(i)} onEditCancel={cancelEditingHeader} onSort={handleSort} onTypeChange={handleTypeChange} onFilterChange={handleFilterChange} isMergeView={true} />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="divide-y divide-slate-200 dark:divide-slate-800 flex flex-col text-sm">
                                                        {sorted.map((row, ri) => (
                                                            <div key={ri} className="flex hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                                                                {headers.map((_, ci) => (
                                                                    <div key={ci} className={`px-4 py-2 shrink-0 w-[180px] text-slate-800 dark:text-slate-300 truncate ${settings.firstColIsHeader && ci === 0 ? 'sticky left-0 bg-white dark:bg-slate-950 font-medium z-10 border-r border-slate-200 dark:border-slate-800 shadow-2xs' : ''}`}>
                                                                        {row[ci] || ''}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ))}
                                                        {sorted.length === 0 && <div className="px-4 py-8 text-center text-slate-500 w-full">{hasActiveFilters ? 'No rows match the current filters.' : 'No data rows parsed.'}</div>}
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
                                                <th key={i} className={`px-4 py-2 border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative outline-1 outline-slate-100 dark:outline-slate-800 ${settings.stickyHeaders ? 'sticky top-0 z-20' : ''} ${settings.firstColIsHeader && i === 0 ? 'sticky left-0 border-r border-slate-300 dark:border-slate-700' : ''} ${settings.stickyHeaders && settings.firstColIsHeader && i === 0 ? 'z-30' : ''}`}>
                                                    <ColumnHeader header={header} colIndex={i} fileIndex={activeTab} sortState={sortState} colType={activeColumnTypes[i] || 'string'} isEditing={editingHeaderKey === `${activeTab}-${i}`} editValue={editHeaderValue} filterValue={columnFilters[i] || ''} onEditChange={setEditHeaderValue} onEditStart={() => startEditingHeader(activeTab, i, header)} onEditSave={() => saveHeaderName(i)} onEditCancel={cancelEditingHeader} onSort={handleSort} onTypeChange={handleTypeChange} onFilterChange={handleFilterChange} />
                                                </th>
                                            ))}
                                        </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                        {isolatedTable.rows.map((row, ri) => (
                                            <tr key={ri} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                                                {isolatedTable.headers.map((_, ci) => (
                                                    <td key={ci} className={`px-4 py-2 text-slate-800 dark:text-slate-300 ${settings.firstColIsHeader && ci === 0 ? 'sticky left-0 bg-white dark:bg-slate-950 font-medium z-10 border-r border-slate-200 dark:border-slate-800' : ''}`}>
                                                        {row[ci] || ''}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                        {isolatedTable.rows.length === 0 && (
                                            <tr><td colSpan={isolatedTable.headers.length || 1} className="px-4 py-8 text-center text-slate-500">
                                                {hasActiveFilters ? 'No rows match the current filters.' : 'No table data extracted.'}
                                            </td></tr>
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

// ============================================================================
// BOOTSTRAP
// ============================================================================

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} else {
    console.error("Failed to find root element.");
}

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
 * multi-file merge state, custom column name mappings, and structural sticky flags).
 * - `DataSet`: Represents a parsed CSV file with cleaned table rows.
 * - Settings are initialized SYNCHRONOUSLY from `localStorage` to prevent
 * race conditions and theme flickering during development/strict mode.
 * - Export/Import settings to JSON allows multi-project configurations,
 * including persistence of custom column headers, merge, and sticky toggles.
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
 * DESIGN PATTERNS:
 * - Single File Application: Everything is self-contained for easy maintenance.
 * - Custom SVGs inline to avoid dependency bloat.
 * ============================================================================
 */

// @ts-ignore
import React, { useState, useEffect, useRef, useMemo, useCallback, ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';

// --- TYPES ---
interface AppSettings {
    theme: 'light' | 'dark';
    firstRowIsHeader: boolean;
    firstColIsHeader: boolean;
    mergeFiles: boolean; // Enables infinite layout merging
    stickyHeaders: boolean; // Explicit control switch to force lock headers during scroll
    columnCustomNames: Record<number, string>; // Stores custom column names by index
}

interface DataSet {
    fileName: string;
    data: string[][];
}

/**
 * Two-phase loading state tracker.
 *
 * Phase lifecycle:
 *   idle → 'parsing' (files being read + parsed) → 'rendering' (data committed to
 *   React state, DOM reconciliation in progress) → idle (paint confirmed)
 *
 * - `active`: Whether the loading overlay should be visible.
 * - `phase`: Current pipeline phase — drives spinner messaging.
 * - `current`: How many files have been fully processed so far (parse phase).
 * - `total`: Total files in the current import batch.
 * - `fileName`: The name of the file currently being parsed (for display).
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
};

const DEFAULT_LOADING_STATE: LoadingState = {
    active: false,
    phase: 'idle',
    current: 0,
    total: 0,
    fileName: '',
};

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

/**
 * Yields control back to the browser's main thread event loop for one tick.
 * This allows React to commit pending state updates (e.g. spinner repaint)
 * and prevents the tab from appearing frozen during heavy synchronous CPU work.
 * Implemented as a zero-delay Promise<void> wrapping setTimeout.
 */
function yieldToMain(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Wraps the FileReader API in a Promise so it can be consumed with async/await.
 * Resolves with the raw text content of the file, or rejects on error.
 */
function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
        reader.readAsText(file);
    });
}

/**
 * Double-requestAnimationFrame paint gate.
 *
 * Why double rAF?
 * - The first `requestAnimationFrame` callback fires AFTER React has flushed
 *   its DOM mutations but potentially BEFORE the browser has composited/painted.
 * - The second `requestAnimationFrame` (nested inside the first) fires after
 *   the browser has actually rendered the new frame to screen.
 * - This guarantees that any DOM-heavy reconciliation (thousands of table rows)
 *   has been fully painted before we resolve, so dismissing the spinner won't
 *   reveal a still-frozen or partially-rendered page.
 *
 * Returns a Promise<void> that resolves after the confirmed paint.
 */
function waitForPaint(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    });
}


// --- SPINNER OVERLAY COMPONENT ---

/**
 * Full-viewport loading overlay displayed during async CSV file processing.
 *
 * Visual anatomy:
 * - Semi-transparent backdrop with blur to dim but not fully hide existing content.
 * - Animated conic-gradient spinner ring (CSS @keyframes spin via Tailwind `animate-spin`).
 * - Inner pulsing circle with a document SVG icon.
 * - Dynamic file counter badge: "Processing X of Y" (parse phase) or "Rendering…" (render phase).
 * - Current filename truncated to prevent layout overflow.
 * - Linear progress bar with animated width transitions.
 *
 * Props:
 * - `state`: The current `LoadingState` snapshot driven by the async pipeline.
 */
const LoadingOverlay: React.FC<{ state: LoadingState }> = ({ state }) => {
    if (!state.active) return null;

    const isParsing = state.phase === 'parsing';
    const isRendering = state.phase === 'rendering';

    // Progress fraction 0..1 for the arc — during rendering phase, show full
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
            {/* Card container */}
            <div className="flex flex-col items-center gap-5 bg-white dark:bg-slate-900
                            border border-slate-200 dark:border-slate-700
                            rounded-2xl shadow-2xl px-10 py-8 min-w-[280px] max-w-[380px]">

                {/* Spinner ring + inner icon */}
                <div className="relative flex items-center justify-center w-20 h-20">

                    {/* Outer track ring (static, dim) */}
                    <svg
                        className="absolute inset-0 w-full h-full"
                        viewBox="0 0 80 80"
                        fill="none"
                        aria-hidden="true"
                    >
                        <circle
                            cx="40" cy="40" r="34"
                            stroke="currentColor"
                            strokeWidth="6"
                            className="text-slate-200 dark:text-slate-700"
                        />
                    </svg>

                    {/* Animated progress arc (SVG stroke-dashoffset trick) */}
                    <svg
                        className="absolute inset-0 w-full h-full -rotate-90"
                        viewBox="0 0 80 80"
                        fill="none"
                        aria-hidden="true"
                    >
                        <circle
                            cx="40" cy="40" r="34"
                            stroke="currentColor"
                            strokeWidth="6"
                            strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 34}`}
                            strokeDashoffset={`${2 * Math.PI * 34 * (1 - progressFraction)}`}
                            className="text-blue-500 dark:text-blue-400"
                            style={{ transition: 'stroke-dashoffset 0.35s cubic-bezier(0.4,0,0.2,1)' }}
                        />
                    </svg>

                    {/* Spinning dashed ring (perpetual motion indicator) */}
                    <svg
                        className="absolute inset-0 w-full h-full animate-spin"
                        viewBox="0 0 80 80"
                        fill="none"
                        aria-hidden="true"
                        style={{ animationDuration: '1.1s' }}
                    >
                        <circle
                            cx="40" cy="40" r="34"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray="20 193"
                            strokeDashoffset="0"
                            className="text-blue-400/60 dark:text-blue-300/50"
                        />
                    </svg>

                    {/* Inner icon — document with pulse (parse) or paint-brush (render) */}
                    <div className="relative z-10 flex items-center justify-center
                                    w-11 h-11 rounded-full
                                    bg-blue-50 dark:bg-blue-950/60
                                    animate-pulse"
                         style={{ animationDuration: '1.6s' }}
                    >
                        {isParsing ? (
                            /* Document icon during parse phase */
                            <svg
                                className="w-5 h-5 text-blue-600 dark:text-blue-400"
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                aria-hidden="true"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                                         a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19
                                         a2 2 0 01-2 2z" />
                            </svg>
                        ) : (
                            /* Grid/table icon during render phase */
                            <svg
                                className="w-5 h-5 text-amber-600 dark:text-amber-400"
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                aria-hidden="true"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M3 10h18M3 14h18M10 3v18M14 3v18" />
                            </svg>
                        )}
                    </div>
                </div>

                {/* Title — changes by phase */}
                <div className="flex flex-col items-center gap-1.5 text-center">
                    <p className="text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                        {isParsing ? 'Processing Files…' : 'Rendering Table…'}
                    </p>

                    {/* Phase-aware status badge */}
                    {isParsing ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full
                                         bg-blue-100 dark:bg-blue-900/50
                                         text-blue-700 dark:text-blue-300
                                         text-xs font-semibold tracking-wide">
                            {/* Mini spinner dot */}
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 animate-pulse" />
                            {state.current} of {state.total} parsed
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full
                                         bg-amber-100 dark:bg-amber-900/50
                                         text-amber-700 dark:text-amber-300
                                         text-xs font-semibold tracking-wide">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
                            Building DOM layout…
                        </span>
                    )}
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-300 ease-out ${
                            isRendering
                                ? 'bg-amber-500 dark:bg-amber-400 animate-pulse'
                                : 'bg-blue-500 dark:bg-blue-400'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                {/* Current filename (parse phase only) */}
                {isParsing && state.fileName && (
                    <p className="text-xs text-slate-400 dark:text-slate-500
                                  max-w-full truncate text-center font-mono tracking-tight"
                       title={state.fileName}>
                        {state.fileName}
                    </p>
                )}

                {/* Render phase sub-hint */}
                {isRendering && (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center leading-snug">
                        Large tables may take a moment to paint.
                        <br />The spinner will dismiss after the browser finishes.
                    </p>
                )}
            </div>
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

    // Two-phase async pipeline loading state — drives the overlay spinner
    const [loadingState, setLoadingState] = useState<LoadingState>(DEFAULT_LOADING_STATE);

    // UI Local State for inline renaming
    // Updated to track composite string keys (fileIdx-colIdx) to prevent focus stealing in Merge Mode
    const [editingHeaderKey, setEditingHeaderKey] = useState<string | null>(null);
    const [editHeaderValue, setEditHeaderValue] = useState<string>('');

    // DOM references for unified file triggers
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- SINGLE EFFECT FOR THEME & CACHE SYNCHRONIZATION ---
    useEffect(() => {
        localStorage.setItem('fidelityApp_settings', JSON.stringify(settings));

        if (settings.theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [settings]);

    /**
     * PHASE 2 PAINT DETECTION EFFECT
     *
     * When `loadingState.phase` transitions to `'rendering'`, React has already
     * committed the new `dataSets` to state (triggered synchronously before this
     * phase transition). This effect waits for the browser to fully paint the
     * resulting DOM changes using double-rAF gating, then dismisses the spinner.
     *
     * Why useEffect and not inline in the async function?
     * Because `setDataSets(...)` is asynchronous from React's perspective — the
     * component re-renders with new data, but we need to wait for THAT render's
     * paint, not just the current tick. `useEffect` fires after React has committed
     * the render that includes the new table rows, making it the correct hook point
     * to schedule paint detection from.
     */
    useEffect(() => {
        if (loadingState.phase !== 'rendering') return;

        let cancelled = false;

        const detectPaintAndDismiss = async () => {
            // Wait for React's committed DOM changes to be actually painted
            await waitForPaint();

            // Extra safety yield — for very large DOMs, the browser may need
            // one more frame to finish layout/compositing
            await waitForPaint();

            if (!cancelled) {
                setLoadingState(DEFAULT_LOADING_STATE);
            }
        };

        detectPaintAndDismiss();

        // Cleanup in case the component unmounts during the wait
        return () => { cancelled = true; };
    }, [loadingState.phase]);

    const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleResetSettings = () => setSettings(DEFAULT_SETTINGS);

    const handleExportSettings = () => {
        const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fidelity_settings.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportSettings = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target?.result as string);
                if (imported && typeof imported === 'object') {
                    setSettings({ ...DEFAULT_SETTINGS, ...imported });
                }
            } catch (err) {
                alert("Invalid JSON format");
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // reset input
    };

    const handleTriggerFileInput = () => {
        fileInputRef.current?.click();
    };

    // --- TWO-PHASE ASYNC FILE PROCESSING PIPELINE ---
    /**
     * PHASE 1 — PARSE:
     *   For each file sequentially:
     *     1. Update `loadingState.fileName` → yield → (spinner repaints with filename)
     *     2. Read file via `readFileAsText` → yield → (browser breathes between I/O and CPU)
     *     3. Run `extractValidTableData` (CPU-heavy, synchronous)
     *     4. Increment `loadingState.current` → yield → (progress bar advances)
     *   Results accumulate in a local `newResults[]` staging array.
     *
     * PHASE 2 — RENDER:
     *   1. Transition `loadingState.phase` to `'rendering'` — spinner shows "Rendering Table…"
     *   2. Yield to main thread so React paints the phase-change message
     *   3. Commit staged `newResults` into `dataSets` via `setDataSets`
     *   4. The `useEffect` watching `loadingState.phase === 'rendering'` takes over:
     *      it waits for double-rAF paint confirmation, then dismisses the overlay.
     */
    const processFilesAsync = useCallback(async (files: File[]) => {
        const total = files.length;

        // Activate the overlay immediately — show 0 of N, phase = parsing
        setLoadingState({ active: true, phase: 'parsing', current: 0, total, fileName: '' });

        // Yield so the overlay mounts and paints before any heavy work
        await yieldToMain();

        const newResults: DataSet[] = [];

        // --- PHASE 1: Sequential parse with yield points ---
        for (let i = 0; i < files.length; i++) {
            const file = files[i];

            // Show which file is currently being parsed
            setLoadingState(prev => ({ ...prev, fileName: file.name }));

            // Yield: let React commit the fileName update before blocking CPU
            await yieldToMain();

            try {
                const rawText = await readFileAsText(file);

                // Yield between I/O completion and CPU-heavy parse
                await yieldToMain();

                const cleanedData = extractValidTableData(rawText);
                newResults.push({ fileName: file.name, data: cleanedData });
            } catch (err) {
                console.error(`Error processing ${file.name}:`, err);
                // Continue with remaining files even if one fails
            }

            // Advance the progress counter
            setLoadingState(prev => ({ ...prev, current: i + 1 }));

            // Yield: let the progress arc animate before the next heavy iteration
            await yieldToMain();
        }

        // --- PHASE 2: Transition to rendering phase ---
        // Switch spinner message to "Rendering…" BEFORE committing data
        setLoadingState(prev => ({
            ...prev,
            phase: 'rendering',
            fileName: '',
        }));

        // Yield so the "Rendering…" message paints before the heavy setDataSets commit
        await yieldToMain();

        // Commit all parsed data into React state — triggers expensive reconciliation
        setDataSets(prev => {
            const combined = [...prev, ...newResults];
            return combined.sort((a, b) => naturalCollator.compare(a.fileName, b.fileName));
        });

        // The useEffect watching `phase === 'rendering'` will handle paint detection
        // and dismiss the overlay after the DOM has fully rendered.
    }, []);

    // --- FILE INPUT HANDLER (delegates to async pipeline) ---
    const handleFileUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const fileArray = Array.from(files);
        e.target.value = ''; // Reset input immediately so the same files can be re-selected

        // Fire-and-forget the async pipeline; errors are caught internally
        processFilesAsync(fileArray).catch(err => {
            console.error('Unexpected error in file processing pipeline:', err);
            setLoadingState(DEFAULT_LOADING_STATE); // Always dismiss overlay on catastrophic error
        });
    }, [processFilesAsync]);

    const handleClearData = () => {
        setDataSets([]);
        setActiveTab(0);
    };

    // --- INLINE EDITING FUNCTIONS ---
    const startEditingHeader = (fileIndex: number, colIndex: number, currentValue: string) => {
        setEditingHeaderKey(`${fileIndex}-${colIndex}`);
        setEditHeaderValue(currentValue);
    };

    const saveHeaderName = (colIndex: number) => {
        if (editHeaderValue.trim() !== '') {
            setSettings(prev => ({
                ...prev,
                columnCustomNames: {
                    ...prev.columnCustomNames,
                    [colIndex]: editHeaderValue.trim()
                }
            }));
        }
        setEditingHeaderKey(null);
    };

    // --- DATA TRANSFORMATION SUB-ROUTINE ---
    const getFileHeadersAndRows = (fileRawRows: string[][]) => {
        if (fileRawRows.length === 0) return { headers: [], rows: [] };

        const totalColumns = fileRawRows[0].length;
        const fileHeaders = settings.firstRowIsHeader ? fileRawRows[0] : [];

        const headers = Array.from({ length: totalColumns }, (_, i) => {
            if (settings.columnCustomNames[i]) {
                return settings.columnCustomNames[i];
            }
            if (settings.firstRowIsHeader && fileHeaders[i]) {
                return fileHeaders[i];
            }
            return `Col ${i + 1}`;
        });

        const rows = settings.firstRowIsHeader ? fileRawRows.slice(1) : fileRawRows;
        return { headers, rows };
    };

    const activeData = dataSets[activeTab]?.data || [];
    const isolatedTable = useMemo(() => getFileHeadersAndRows(activeData), [activeData, settings.firstRowIsHeader, settings.columnCustomNames]);

    return (
        <>
            {/* LOADING OVERLAY — rendered outside the main layout flow via fragment
                so it can use fixed positioning without being clipped by overflow:hidden ancestors */}
            <LoadingOverlay state={loadingState} />

            <div className="h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 transition-colors duration-300 font-sans flex flex-col overflow-hidden">

                {/* HEADER */}
                <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-4 z-40 shadow-xs shrink-0">
                    <div className="flex items-center gap-2">
                        <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <h1 className="text-xl font-bold tracking-tight">Fidelity Data Cleaner</h1>
                    </div>

                    {/* SETTINGS BAR */}
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.stickyHeaders} onChange={(e) => updateSetting('stickyHeaders', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className={`font-semibold ${settings.stickyHeaders ? 'text-green-600 dark:text-green-400' : 'text-slate-500'}`}>Sticky Headers</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.mergeFiles} onChange={(e) => updateSetting('mergeFiles', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-semibold text-blue-600 dark:text-blue-400">Merge Files</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.firstRowIsHeader} onChange={(e) => updateSetting('firstRowIsHeader', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-medium">1st Row = Header</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                            <input type="checkbox" checked={settings.firstColIsHeader} onChange={(e) => updateSetting('firstColIsHeader', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 bg-slate-100 border-slate-300" />
                            <span className="font-medium">1st Col = Sticky</span>
                        </label>

                        <button onClick={() => updateSetting('theme', settings.theme === 'light' ? 'dark' : 'light')} className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition" title="Toggle Theme">
                            {settings.theme === 'light' ? '🌙' : '☀️'}
                        </button>
                    </div>
                </header>

                {/* MAIN CONTENT CONTAINER */}
                <main className="flex-1 flex flex-col p-4 gap-4 max-w-full overflow-hidden min-h-0 bg-slate-50 dark:bg-slate-900 transition-colors duration-300">

                    <input
                        type="file"
                        ref={fileInputRef}
                        multiple
                        accept=".csv"
                        className="hidden"
                        onChange={handleFileUpload}
                    />

                    {/* CONTROLS & IMPORT */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
                        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                            <button
                                onClick={handleTriggerFileInput}
                                disabled={loadingState.active}
                                className="cursor-pointer bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center shadow-sm"
                            >
                                Import CSV Files
                            </button>
                            {dataSets.length > 0 && (
                                <button
                                    onClick={handleClearData}
                                    disabled={loadingState.active}
                                    className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 rounded-lg font-semibold transition-colors"
                                >
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

                    {/* DATA VIEWPORT COMPONENT */}
                    {dataSets.length === 0 && !loadingState.active ? (
                        <div
                            onClick={handleTriggerFileInput}
                            className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-900/50 cursor-pointer group hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/20 dark:hover:bg-blue-950/10 transition-all duration-200"
                        >
                            <svg className="w-16 h-16 mb-4 opacity-50 group-hover:opacity-80 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                            </svg>
                            <p className="text-lg font-medium group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">No CSV files loaded</p>
                            <p className="text-sm opacity-80 group-hover:opacity-100 transition-opacity">Upload raw Fidelity files, the app will auto-clean them.</p>
                        </div>
                    ) : dataSets.length > 0 ? (
                        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">

                            {/* TABS (Rendered only if Merge mode is disabled) */}
                            {!settings.mergeFiles && (
                                <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-2 py-2 gap-2 hide-scrollbar shrink-0">
                                    {dataSets.map((dataset, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => setActiveTab(idx)}
                                            className={`px-4 py-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors ${
                                                activeTab === idx
                                                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200 dark:border-slate-700'
                                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                                            }`}
                                        >
                                            {dataset.fileName}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* ISOLATED VIEWPORT SCROLL CONTAINER */}
                            <div className="flex-1 overflow-auto table-container relative min-h-0">

                                {settings.mergeFiles ? (
                                    /* =========================================================================
                                       MERGE WORKSPACE: Multi-file contiguous scrolling layout (Flexbox/Grid hybrid)
                                       ========================================================================= */
                                    <div className="space-y-12 bg-slate-50/30 dark:bg-slate-900/10 w-max min-w-full">
                                        {dataSets.map((dataset, fileIdx) => {
                                            const { headers, rows } = getFileHeadersAndRows(dataset.data);
                                            return (
                                                <div key={fileIdx} className="relative border-b border-slate-200 dark:border-slate-800 last:border-none bg-white dark:bg-slate-950 flex flex-col w-full">

                                                    {/* Sticky Header Wrapper Context - Houses name and tags without physical DOM breaks */}
                                                    <div className={`${settings.stickyHeaders ? 'sticky top-0 z-30' : ''} bg-white dark:bg-slate-950 flex flex-col -mb-px`}>

                                                        {/* File Name Header Block - Dual-axis sticky layout constraint */}
                                                        <div className="bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-900/50 select-none py-1.5 h-8 w-max min-w-full relative">
                                                            <span className="sticky left-0 px-4 text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 z-10 py-1">
                                                                FILE [{fileIdx + 1}/{dataSets.length}]: {dataset.fileName}
                                                            </span>
                                                            <span className="absolute right-4 text-[10px] uppercase opacity-50 tracking-wider font-semibold top-2 text-blue-700 dark:text-blue-400">
                                                                Merged Block
                                                            </span>
                                                        </div>

                                                        {/* Data Column Headers Row Container */}
                                                        <div className="flex bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold pt-[9px]">
                                                            {headers.map((header, i) => (
                                                                <div
                                                                    key={i}
                                                                    className={`px-4 py-2 shrink-0 flex items-center justify-between gap-4 w-[180px] bg-slate-100 dark:bg-slate-800
                                                                        ${settings.firstColIsHeader && i === 0 ? 'sticky left-0 z-35 border-r border-slate-300 dark:border-slate-700 font-bold' : ''}`
                                                                    }
                                                                >
                                                                    {editingHeaderKey === `${fileIdx}-${i}` ? (
                                                                        <div className="flex items-center gap-1 w-full">
                                                                            <input
                                                                                type="text"
                                                                                value={editHeaderValue}
                                                                                onChange={(e) => setEditHeaderValue(e.target.value)}
                                                                                onBlur={() => saveHeaderName(i)}
                                                                                onKeyDown={(e) => e.key === 'Enter' && saveHeaderName(i)}
                                                                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2 py-0.5 rounded border border-blue-500 focus:outline-none text-xs font-normal w-full"
                                                                                autoFocus
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center justify-between gap-2 w-full group/header">
                                                                            <span>{header}</span>
                                                                            <button
                                                                                onClick={() => startEditingHeader(fileIdx, i, header)}
                                                                                className="opacity-0 group-hover/header:opacity-100 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-all p-0.5"
                                                                                title="Rename Column Globally"
                                                                            >
                                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Text Rows Matrix Body Layer */}
                                                    <div className="divide-y divide-slate-200 dark:divide-slate-800 flex flex-col text-sm">
                                                        {rows.map((row, rowIndex) => (
                                                            <div key={rowIndex} className="flex hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                                                                {headers.map((_, colIndex) => {
                                                                    const cellValue = row[colIndex] || '';
                                                                    return (
                                                                        <div
                                                                            key={colIndex}
                                                                            className={`px-4 py-2 shrink-0 w-[180px] text-slate-800 dark:text-slate-300 truncate
                                                                                ${settings.firstColIsHeader && colIndex === 0 ? 'sticky left-0 bg-white dark:bg-slate-950 font-medium z-10 border-r border-slate-200 dark:border-slate-800 shadow-2xs' : ''}`
                                                                            }
                                                                        >
                                                                            {cellValue}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        ))}
                                                        {rows.length === 0 && (
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
                                    /* =========================================================================
                                       TAB VIEW: Classic single sheet isolated structure
                                       ========================================================================= */
                                    <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                                        <thead>
                                        <tr className="text-slate-700 dark:text-slate-300">
                                            {isolatedTable.headers.map((header, i) => (
                                                <th
                                                    key={i}
                                                    className={`px-4 py-2 border-b border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 relative
                                                        outline-1 outline-slate-100 dark:outline-slate-800
                                                        ${settings.stickyHeaders ? 'sticky top-0 z-20' : ''}
                                                        ${settings.firstColIsHeader && i === 0 ? 'sticky left-0 border-r border-slate-300 dark:border-slate-700' : ''}
                                                        ${settings.stickyHeaders && settings.firstColIsHeader && i === 0 ? 'z-30' : ''}`
                                                    }
                                                >
                                                    {editingHeaderKey === `${activeTab}-${i}` ? (
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="text"
                                                                value={editHeaderValue}
                                                                onChange={(e) => setEditHeaderValue(e.target.value)}
                                                                onBlur={() => saveHeaderName(i)}
                                                                onKeyDown={(e) => e.key === 'Enter' && saveHeaderName(i)}
                                                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 px-2 py-1 rounded border border-blue-500 focus:outline-none text-xs font-normal"
                                                                autoFocus
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-between gap-4 group/header">
                                                            <span className="font-semibold">{header}</span>
                                                            <button
                                                                onClick={() => startEditingHeader(activeTab, i, header)}
                                                                className="opacity-0 group-hover/header:opacity-100 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-all p-1"
                                                                title="Rename Column"
                                                            >
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                            </button>
                                                        </div>
                                                    )}
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
                                                        <td
                                                            key={colIndex}
                                                            className={`px-4 py-2 text-slate-800 dark:text-slate-300
                                                                ${settings.firstColIsHeader && colIndex === 0 ? 'sticky left-0 bg-white dark:bg-slate-950 font-medium z-10 border-r border-slate-200 dark:border-slate-800' : ''}`
                                                            }
                                                        >
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
                        /* Loading-but-no-data-yet placeholder — keeps layout stable during first import */
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

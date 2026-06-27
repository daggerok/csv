/**
 * ============================================================================
 * AGENTIC AI DOCUMENTATION & SYSTEM ARCHITECTURE
 * ============================================================================
 *
 * PROJECT: Fidelity CSV Data Viewer & Cleaner
 * ENVIRONMENT: Bun, Vite, React, TypeScript, TailwindCSS v4
 *
 * MODULES & FEATURES:
 * 1. [Types & State Management]
 * - `AppSettings`: Stores UI/UX settings (theme, header configurations).
 * - `DataSet`: Represents a parsed CSV file with cleaned table rows.
 * - Settings are initialized SYNCHRONOUSLY from `localStorage` to prevent
 * race conditions and theme flickering during development/strict mode.
 * - Export/Import settings to JSON allows multi-project configurations.
 *
 * 2. [Heuristic CSV Parser (`parseCSVRow` & `extractValidTableData`)]
 * - Fidelity CSVs contain unstructured preamble/postamble.
 * - The heuristic algorithm splits the file by lines, parses them properly
 * respecting double quotes, and counts columns.
 * - It isolates the longest contiguous block of rows that share the same
 * (or majority) column length, effectively stripping out legal text
 * and account summaries.
 *
 * 3. [Natural Sort Order Synchronization]
 * - Uses `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`
 * to sort imported datasets by file name natively. This ensures `file2.csv`
 * appears before `file10.csv`.
 *
 * 4. [UI Components & UX Fixes]
 * - Mobile-first approach using standard Tailwind utility classes.
 * - Features a dark/light mode toggle integrated with `<html class="dark">`.
 * - Table supports `sticky top-0` (Header row) and `sticky left-0` (First Column)
 * based on user configuration.
 * - Interactive Empty Placeholder Container acts as a global dropzone/button
 * linked to a hidden file input via `useRef`.
 *
 * DESIGN PATTERNS:
 * - Single File Application: Everything is self-contained for easy maintenance.
 * - Custom SVGs inline to avoid dependency bloat.
 * ============================================================================
 */

// @ts-ignore
import React, { useState, useEffect, useRef, useMemo, ChangeEvent } from 'react';
import { createRoot } from 'react-dom/client';

// --- TYPES ---
interface AppSettings {
    theme: 'light' | 'dark';
    firstRowIsHeader: boolean;
    firstColIsHeader: boolean;
}

interface DataSet {
    fileName: string;
    data: string[][];
}

const DEFAULT_SETTINGS: AppSettings = {
    theme: 'light',
    firstRowIsHeader: true,
    firstColIsHeader: false,
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

    // Find the most common column length (usually the main table's column count)
    // Ignoring rows with < 3 columns as they are usually preambles.
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

    // Fallback if the file is extremely small or simple
    if (targetColLength === 0) {
        targetColLength = Math.max(...parsedLines.map(r => r.length));
    }

    // Extract the longest contiguous block of rows matching the target column length
    const tableData: string[][] = [];
    let isRecording = false;

    for (const row of parsedLines) {
        // We allow a slight deviation (e.g., trailing empty commas) but generally expect exact length
        if (row.length === targetColLength || row.length === targetColLength + 1) {
            isRecording = true;
            tableData.push(row.slice(0, targetColLength)); // Normalize length
        } else if (isRecording && row.length < targetColLength - 1) {
            // If we drop off significantly, we probably hit the footer/legal text
            break;
        }
    }

    return tableData.length > 0 ? tableData : parsedLines; // Return raw if heuristic fails
}


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

    // --- FILE HANDLING WITH NATURAL SORT ---
    const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const pendingFiles = Array.from(files);
        let processedCount = 0;
        const newResults: DataSet[] = [];

        pendingFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const text = event.target?.result as string;
                const cleanedData = extractValidTableData(text);

                newResults.push({ fileName: file.name, data: cleanedData });
                processedCount++;

                // Когда все файлы из текущей пачки прочитаны, объединяем и сортируем
                if (processedCount === pendingFiles.length) {
                    setDataSets(prev => {
                        const combined = [...prev, ...newResults];
                        // Применяем натуральную сортировку по имени файла
                        return combined.sort((a, b) => naturalCollator.compare(a.fileName, b.fileName));
                    });
                }
            };
            reader.readAsText(file);
        });

        e.target.value = ''; // reset
    };

    const handleClearData = () => {
        setDataSets([]);
        setActiveTab(0);
    };

    // --- RENDER HELPERS ---
    const activeData = dataSets[activeTab]?.data || [];
    const displayHeaders = settings.firstRowIsHeader && activeData.length > 0
        ? activeData[0]
        : (activeData.length > 0 ? Array.from({length: activeData[0].length}, (_, i) => `Col ${i + 1}`) : []);

    const displayRows = settings.firstRowIsHeader ? activeData.slice(1) : activeData;

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 transition-colors duration-300 font-sans flex flex-col">

            {/* HEADER */}
            <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-4 z-20">
                <div className="flex items-center gap-2">
                    {/* File Icon SVG */}
                    <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <h1 className="text-xl font-bold tracking-tight">Fidelity Data Cleaner</h1>
                </div>

                {/* SETTINGS BAR */}
                <div className="flex flex-wrap items-center gap-3 text-sm">
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

            {/* MAIN CONTENT */}
            <main className="flex-1 flex flex-col p-4 gap-4 max-w-full overflow-hidden animate-fade-in">

                {/* CENTRAL MASTER INPUT REGISTER */}
                <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileUpload}
                />

                {/* CONTROLS & IMPORT */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                        <button
                            onClick={handleTriggerFileInput}
                            className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-center shadow-sm"
                        >
                            Import CSV Files
                        </button>
                        {dataSets.length > 0 && (
                            <button onClick={handleClearData} className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-900/50 px-4 py-2.5 rounded-lg font-semibold transition-colors">
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

                {/* DATA DISPLAY AREA */}
                {dataSets.length === 0 ? (
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
                ) : (
                    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
                        {/* TABS */}
                        <div className="flex overflow-x-auto border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-2 py-2 gap-2 hide-scrollbar">
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

                        {/* TABLE CONTAINER */}
                        <div className="flex-1 overflow-auto table-container relative">
                            <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                                <thead className="sticky top-0 z-10 shadow-sm">
                                <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                    {displayHeaders.map((header, i) => (
                                        <th
                                            key={i}
                                            className={`px-4 py-3 font-semibold border-b border-slate-300 dark:border-slate-700 
                                                ${settings.firstColIsHeader && i === 0 ? 'sticky left-0 bg-slate-100 dark:bg-slate-800 z-20 border-r' : ''}`
                                            }
                                        >
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {displayRows.map((row, rowIndex) => (
                                    <tr key={rowIndex} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                                        {displayHeaders.map((_, colIndex) => {
                                            const cellValue = row[colIndex] || '';
                                            return (
                                                <td
                                                    key={colIndex}
                                                    className={`px-4 py-2 text-slate-800 dark:text-slate-300
                                                        ${settings.firstColIsHeader && colIndex === 0 ? 'sticky left-0 bg-white dark:bg-slate-950 font-medium z-0 border-r border-slate-200 dark:border-slate-800' : ''}`
                                                    }
                                                >
                                                    {cellValue}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                                {displayRows.length === 0 && (
                                    <tr>
                                        <td colSpan={displayHeaders.length || 1} className="px-4 py-8 text-center text-slate-500">
                                            No table data successfully extracted. Check file structure.
                                        </td>
                                    </tr>
                                )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>
        </div>
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

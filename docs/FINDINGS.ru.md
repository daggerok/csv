# Глубокий архитектурный обзор — `daggerok/csv`

Дата обзора: 2026-07-13  
Роль ревьюера: Solution / Software Architect

## Область обзора

В этом ревью я проверил текущее состояние репозитория с упором на:

- runtime-архитектуру
- корректность парсинга
- масштабируемость и производительность
- приватность и безопасность
- сопровождаемость и качество поставки
- DX и консистентность документации

## Что было провалидировано

Я выполнил следующие проверки:

- ревью исходников `README.md`, `package.json`, `src/main.tsx`, `src/index.css`, `.github/workflows/ci.yaml`
- `npm install --ignore-scripts`
- `npm run build` ✅
- ad-hoc TypeScript compile для `src/main.tsx` через `tsc --noEmit` ✅
- `npm test -- --runInBand` ❌ — падает, потому что тестов нет
- `npm audit --json` ⚠️ — найдено 3 уязвимости, все приходят через `pm2` в dev dependencies
- `npm audit --omit=dev --json` ✅ — production dependency graph чистый

## Executive summary

Репозиторий уже представляет собой полезную **local-first утилиту для CSV** и показывает хорошее продуктовое понимание целевого кейса: грязные брокерские выгрузки, быстрый просмотр, фильтры, сортировка, merge mode, sticky headers и полностью client-side обработка.

Но с архитектурной точки зрения я бы классифицировал кодовую базу так:

- **хороший прототип / сильный personal tool**
- **пока не лучшая долгосрочная основа для продукта**

Главные архитектурные проблемы:

1. **слишком много логики сосредоточено в одном файле**
2. **весь парсинг и рендеринг выполняются в main thread браузера**
3. **кастомная CSV-эвристика может тихо менять данные**
4. **чувствительные финансовые данные по умолчанию сохраняются локально**
5. **настройки глобальны по индексу колонки, из-за чего возникают cross-file collisions**
6. **слабые quality gates: нет тестов, нет lint/typecheck gate в CI**
7. **дрейф документации и toolchain повышает стоимость сопровождения**

## Общая оценка

| Направление | Оценка | Комментарий |
|---|---:|---|
| Product usefulness | 8/10 | Очень полезная утилита для интерактивного анализа CSV-выгрузок |
| Architectural maturity | 5/10 | Сейчас работает, но безопасно масштабировать будет трудно |
| Maintainability | 4/10 | Монолитная реализация и слабая изоляция ответственности |
| Correctness confidence | 5/10 | Сборка проходит, но parser/filter/export почти не защищены тестами |
| Performance headroom | 4/10 | Нормально для small/medium файлов, рискованно для больших наборов |
| Privacy posture | 5/10 | Client-only — плюс, но persistence по умолчанию рискованен |

## Сильные стороны

### 1. Понятный product intent
Приложение сфокусировано и последовательно. Оно решает реальную пользовательскую задачу, а не пытается стать очередным spreadsheet clone.

### 2. Local-first design
Приложение держит данные в браузере и не тащит backend-сложность. Для анализа чувствительных финансовых CSV это очень удачное решение.

### 3. Продуманные UX-фичи
В репозитории уже есть полезные возможности:

- sticky headers / sticky first column
- natural sorting файлов
- per-column sorting и filtering
- merged и per-file CSV export
- dark mode
- export/import конфигурации

### 4. Хорошее понимание особенностей React StrictMode
Boot-restore flow и paint-aware loading state сделаны внимательнее среднего, особенно для edge-cases жизненного цикла UI.

### 5. Сборка сейчас здорова
Приложение успешно собирается, и ad-hoc TypeScript compile тоже проходит.

---

# Findings

## F-01 — Монолитная архитектура с очень высокой связностью изменений
**Severity:** High

### Evidence

- `src/main.tsx` содержит ~1,673 строки и внутри него находятся:
  - parsing logic
  - type detection
  - filtering engine
  - CSV export
  - localStorage persistence
  - loading orchestration
  - UI components
  - app composition / bootstrap
- См. особенно `src/main.tsx:249-404`, `658-722`, `745-1662`.

### Почему это важно

Такой подход помогает быстро стартовать, но делает развитие дорогим.

Текущие риски:

- одно изменение может сломать несвязанный функционал
- parser-логику трудно тестировать изолированно
- UI-ревью становятся шумными, потому что доменная логика и presentation переплетены
- onboarding становится длиннее по мере роста файла
- новые фичи будут увеличивать merge conflicts и regression risk

### Архитектурное влияние

Текущая структура оптимизирована под **быструю первую поставку**, а не под **безопасную итерацию**.

### Recommendation

Разбить решение на небольшие модули:

- `domain/csv-parser.ts`
- `domain/column-types.ts`
- `domain/filters.ts`
- `domain/export.ts`
- `state/settings-storage.ts`
- `components/LoadingOverlay.tsx`
- `components/ColumnHeader.tsx`
- `components/ColumnFilterInput.tsx`
- `App.tsx`

UX можно оставить тем же, но доменную логику нужно вынести из render-файла.

---

## F-02 — Текущая performance-архитектура будет плохо масштабироваться на больших файлах
**Severity:** High

### Evidence

- целый файл читается в память как строка: `src/main.tsx:715-720`
- парсинг идет в main thread: `src/main.tsx:1260-1279`
- полные datasets хранятся в React state: `src/main.tsx:962`, `1279`
- в merge mode рендерятся все строки и все ячейки без virtualization: `src/main.tsx:1589-1622`
- в обычном режиме также рендерятся все строки напрямую: `src/main.tsx:1639-1645`

### Почему это важно

Приложение позиционируется как “high-performance”, но его текущая runtime-модель все еще такая:

- прочитать весь файл
- распарсить весь файл
- держать весь dataset в памяти
- отрендерить весь table DOM

На больших брокерских выгрузках или при загрузке многих файлов одновременно эта модель будет деградировать довольно быстро.

Ожидаемые симптомы:

- длинный input delay
- зависания вкладки браузера
- высокий memory pressure
- очень медленный merge mode
- плохой UX на не самых мощных ноутбуках

### Архитектурное влияние

Spinner улучшает воспринимаемую отзывчивость, но не меняет базовую модель масштабирования.

### Recommendation

Приоритетные улучшения:

1. перенести parsing в **Web Worker**
2. добавить **row virtualization** и для single-file, и для merged view
3. рассмотреть **streaming / chunked parsing** вместо полного `readAsText`
4. перенести хранение больших datasets из `localStorage` в **IndexedDB**
5. ввести performance budgets по строкам, колонкам и total cells

---

## F-03 — Кастомная CSV-эвристика может незаметно модифицировать или обрезать данные
**Severity:** High

### Evidence

- поля trim-ятся во время parse: `src/main.tsx:376`, `380`
- строки с `targetColLength + 1` колонками принимаются, а потом обрезаются: `src/main.tsx:398-400`

### Почему это важно

Для финансовых данных **тихая модификация данных** опаснее, чем явная ошибка парсинга.

Сейчас есть минимум две конкретные проблемы.

#### A. Теряются пробелы внутри quoted values
Так как к каждой ячейке применяется `currentValue.trim()`, значения вида:

```csv
" ACME ","  keep spaces  "
```

превращаются в:

```text
ACME
keep spaces
```

То есть исходные данные уже изменены.

#### B. Более широкие строки тихо обрезаются
Строка с одной лишней колонкой принимается и режется до целевой ширины.
Пример:

```csv
a,b,c
1,2,3,4
5,6,7
```

фактически превращается в:

```csv
a,b,c
1,2,3
5,6,7
```

Четвертое значение потеряно без предупреждения.

### Архитектурное влияние

Текущий parser оптимизирован под “best effort cleanup”, но ему не хватает более строгого контракта корректности.

### Recommendation

1. не trim-ить quoted field content по умолчанию
2. обрабатывать schema drift явно:
   - reject row
   - quarantine row
   - или показывать warning пользователю
3. добавить parser test fixtures для:
   - embedded quotes
   - leading/trailing whitespace
   - multiline quoted values
   - extra/missing columns
   - Fidelity-style preambles/postambles
4. рассмотреть `PapaParse` как RFC-compliant parser layer, а эвристику оставить отдельным cleanup stage

---

## F-04 — Сохранение чувствительных данных включено по умолчанию
**Severity:** High

### Evidence

- privacy notice говорит, что данные остаются изолированными и безопасными: `README.md:82-86`
- `rememberData` по умолчанию равен `true`: `src/main.tsx:309-320`
- datasets сохраняются в `localStorage`: `src/main.tsx:658-669`

### Почему это важно

Приложение работает с брокерскими / финансовыми CSV. Локальное сохранение по умолчанию создает privacy risk на:

- shared laptops
- family computers
- managed corporate endpoints
- публичных demo environments

Это не network leak, но это все равно **риск хранения данных**.

### Архитектурное влияние

Сообщение продукта звучит как “client-only and secure”, но фактическое поведение — “client-only and retained locally”. Это не одно и то же.

### Recommendation

1. поменять default `rememberData` на `false`
2. сделать явный opt-in с понятной формулировкой:
   - “Store imported data in this browser on this device”
3. добавить заметное пояснение о retention рядом с toggle
4. при желании добавить TTL / auto-expiration
5. явно описать это поведение в README и UI

---

## F-05 — Настройки колонок глобальны по индексу и конфликтуют между файлами
**Severity:** High

### Evidence

- модель настроек использует `Record<number, ...>` для custom names, types и filters: `src/main.tsx:255-261`
- заголовки берут `settings.columnCustomNames[i]`: `src/main.tsx:1334-1336`
- filters глобальны и переиспользуются между файлами: `src/main.tsx:1357`, `1404`, `1448`, `1609`, `1634`
- sort state тоже глобальный: `src/main.tsx:260-261`, `1345-1348`

### Почему это важно

В multi-file приложении “column 0” — недостаточный идентификатор.

Пример:

- file A column 0 = `Ticker`
- file B column 0 = `Date`

Если пользователь переименует, отфильтрует или задаст type override для column 0 в одном файле, те же настройки утекут и во второй файл.

### Архитектурное влияние

Это, вероятно, главная проблема доменной модели в репозитории. UI уже поддерживает multi-file workflows, а модель настроек фактически остается single-schema.

### Recommendation

Нужно ввести dataset-aware key:

- `datasetId + columnIndex`
- или `schemaHash + columnIndex`

Рекомендуемая модель:

```ts
Record<string, Record<number, T>>
```

Где внешний ключ стабилен для импортированного dataset или для детектированной схемы.

Также стоит явно решить, какие настройки должны быть:

- global
- per dataset
- per schema

---

## F-06 — Дрейф документации и toolchain повышает стоимость сопровождения
**Severity:** Medium

### Evidence

- README говорит, что приложение построено на **Bun** и **Vite**: `README.md:2-4`, `34-39`, `45-77`
- реальные scripts используют **Parcel**: `package.json:10-18`
- CI использует Bun для запуска Parcel-based scripts: `.github/workflows/ci.yaml:21-23`, `40-44`
- несколько direct dependencies по результатам source review выглядят неиспользуемыми:
  - `clsx`
  - `lucide-react`
  - `recharts`
  - `tailwind-merge`
  - `papaparse`
  - `@types/papaparse`
- `npm audit --json` показывает 3 уязвимости через `pm2` / `ws` / `js-yaml`

### Почему это важно

Даже если приложение собирается, такой drift приводит к:

- путанице при onboarding
- более тяжелым upgrade'ам
- неясности, кто и зачем выбрал текущий runtime stack
- избыточной dependency surface

### Архитектурное влияние

Это скорее governance-проблема, чем runtime bug, но такие governance issues со временем начинают тормозить команду сильнее, чем отдельные дефекты кода.

### Recommendation

1. выбрать один явно задокументированный stack и честно его описать
2. обновить README под реальное состояние
3. удалить unused dependencies
4. удалить или обновить `pm2`, если он не критичен
5. добавить dependency hygiene checks в CI

---

## F-07 — Quality gates недостаточны для parser-heavy логики
**Severity:** Medium

### Evidence

- в `package.json` есть `"test": "jest src"`: `package.json:17`
- запуск тестов падает с “No tests found”
- CI не запускает tests, lint или typecheck; он только собирает проект: `.github/workflows/ci.yaml:21-23`, `40-44`

### Почему это важно

Самые рискованные части приложения — именно те, которые требуют повторяемых проверок:

- CSV parsing heuristics
- grammar фильтров
- корректность export
- persistence / restore flows

Без тестов корректность держится на ручном использовании и памяти разработчика.

### Recommendation

Минимальный набор тестов:

1. **unit tests** для parser, filter grammar, type detection, export helpers
2. **fixture tests** на реальных грязных brokerage CSV samples
3. **integration tests** для цепочки import → filter → export
4. **CI gates** на:
   - tests
   - typecheck
   - build

Опционально на следующем шаге можно добавить browser E2E smoke tests.

---

## F-08 — Accessibility и user-facing error handling требуют улучшения
**Severity:** Medium

### Evidence

- empty-state upload target — это только кликабельный `<div>`: `src/main.tsx:1566-1570`
- ошибки обработки файлов отправляются только в console: `src/main.tsx:1268-1273`
- неверный JSON import использует `alert(...)`: `src/main.tsx:1252`

### Почему это важно

Текущие проблемы:

- keyboard users могут не получить доступ к empty-state uploader
- ошибки не показываются пользователю структурировано
- `alert()` — довольно грубый UX

### Recommendation

1. заменить кликабельный `<div>` на семантический `<button>` или корректный labeled control
2. добавить keyboard и screen-reader friendly affordances
3. ввести non-blocking error toasts / inline notifications
4. собирать per-file import warnings и показывать их в UI

---

# Recommended roadmap

## Phase 1 — Quick wins (1–2 недели)

- поставить `rememberData` по умолчанию в `false`
- обновить README под реальность Parcel/Bun
- удалить unused dependencies
- удалить или обновить `pm2`
- добавить parser fixtures и базовые unit tests
- исправить trim whitespace и row truncation behavior

## Phase 2 — Structural hardening (2–4 недели)

- разделить `main.tsx` на domain/state/UI modules
- переделать settings model в dataset-aware
- добавить CI gates: test + typecheck + build
- улучшить error reporting в UI

## Phase 3 — Scale readiness (4–8 недель)

- перенести parse work в Web Worker
- добавить row virtualization
- оценить IndexedDB для больших persisted datasets
- зафиксировать load/performance thresholds и regression tests

---

# Финальный архитектурный вердикт

Я бы **одобрил этот репозиторий как сильный prototype / internal utility**.

Но я бы **пока не утверждал его как долгосрочную основу для production-grade продукта**, пока не сделано следующее:

- усиление корректности parser'а
- смена privacy default
- модульная декомпозиция
- dataset-aware settings model
- automated tests в CI
- стратегия производительности для больших данных

Коротко:

> Хорошая продуктовая интуиция, полезная реализация, но следующий шаг — не расширение фич, а архитектурное усиление.

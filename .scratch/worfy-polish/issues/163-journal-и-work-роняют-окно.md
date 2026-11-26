# 163 — Journal и Work роняют окно: ошибка рендера одной части гасит всё окно

Type: bug
Status: claimed
Branch: worfy-polish/163
Blocked by: —
Source: баг владельца 2026-11-26: «при нажатии на Journal походу крашится рендер». На снимке — всё окно Stable
worfy (main около 23a992a0c) пустое, тёмный фон, сразу после нажатия на вкладку «Journal» раздела Assistant
(вкладки Waits / Summary / Journal). Второй отчёт того же вечера: «опять поймал баг на сломанный рендер, на этот раз
нажал на work, походу баг оказался шире» — кнопка «Work track» вида Runs. Ещё раз за вечер worfy зависло целиком и
понадобился перезапуск; связано ли это — не известно.

Кто: агент; последний пункт — владелец.

## Что происходит

В renderer нет ни одного error boundary (React-компонента, который ловит ошибку рендера потомков). Когда рендер
любой части бросает исключение, React 19 снимает всё дерево с `createRoot` — окно становится пустым, тёмный фон
`body`. Процесс renderer при этом жив: в `<data root>/logs/process-gone.jsonl` записей нет.

Что именно бросило в окне владельца, по данным не воспроизвелось:

- файла журнала действий Assistant (`assistant/journal.json`) у владельца нет, значит `view.journal` пуст, и
  вкладка Journal рисует только строку «Nothing here yet…»;
- main проверяет каждый ответ и каждое событие IPC схемой zod (`src/main/ipc/index.ts`), так что строка журнала
  незнакомой формы в renderer не доходит;
- вкладка Journal с пустым журналом и со строками рендерится без ошибки и отдельно, и внутри всего `App` в jsdom.

Поэтому первым делом — чтобы ошибка одной части не гасила окно и сама говорила, что сломалось.

## Что строить

1. **Общий error boundary** `src/renderer/shell/ErrorBoundary.tsx`: вместо упавшей части — «This section failed to
   render» (или «This tab…», «This view…»), текст ошибки, компонент, из которого она пришла (первая строка
   component stack), и кнопка Reload. Reload монтирует часть заново; у boundary всего окна — «Reload window»,
   перезагрузка страницы. Ошибка и component stack — в console.
2. **Где стоят boundary:**
   - вокруг каждого раздела sidebar (`Sidebar.tsx`, панель раздела) — rail и другие разделы продолжают работать;
   - вокруг каждой вкладки раздела Assistant (`AssistantPanel.tsx`, тело вкладки, свой boundary на вкладку) —
     вкладки, строка usage и поле ввода остаются;
   - вокруг каждого вида основной области (`AppShell.tsx`: Canvas, Session, Pipeline, Runs, Pull requests,
     Acceptance, Code story, Changes) — sidebar и toolbar остаются; Work track живёт в виде Runs;
   - вокруг всего `App` (`main.tsx`) — вместо пустого окна текст ошибки и «Reload window».
3. Причина, если найдётся: test, красный до правки, и правка. Не нашлась — сказать в «Итог», что известно и что
   покажет следующий сбой (текст ошибки теперь на экране).

## Где в коде

- `src/renderer/shell/ErrorBoundary.tsx`, `src/renderer/shell/error-boundary.css` (новые).
- `src/renderer/shell/Sidebar.tsx` — панели разделов.
- `src/renderer/shell/AppShell.tsx` — виды основной области.
- `src/renderer/main.tsx` — корень, `createRoot`.
- `src/renderer/assistant/AssistantPanel.tsx` — тело вкладок (правка минимальная: тот же файл правят polish 161 и
  162).
- `src/renderer/work-track/`, `src/renderer/flight-recorder/RunsView.tsx` — Work track, если причина там.
- `test/unit/error-boundary.test.tsx` (новый), `test/unit/assistant-panel.test.tsx`, `test/unit/shell.test.tsx`.
- `docs/features/app-shell.md` — одна строка о запасном виде упавшей части.

## Решения (Orchestrator, 2026-11-26)

- Boundary обязателен на каждом разделе sidebar, каждой вкладке Assistant и в корне; текст ошибки — на экране.
- PR с boundary — первым, даже если причина ещё не найдена; так и сказать в PR.
- Ни e2e, ни Electron локально не запускать (правило владельца); данные Stable — только читать.

## Test-ы

- Unit: boundary показывает заголовок, текст ошибки, компонент и Reload; Reload монтирует часть заново; у корня —
  «Reload window», перезагрузка страницы; бросок не-Error даёт читаемый текст.
- Unit: раздел sidebar, который бросает, показывает запасной вид в своей панели; rail работает, другой раздел
  открывается и отвечает на щелчок.
- Unit: вид основной области, который бросает, показывает запасной вид; sidebar, toolbar и другой вид остаются.
- Unit: вкладка Assistant, которая бросает, показывает запасной вид; вкладки, строка usage и поле ввода остаются;
  другая вкладка рисуется.

## Готово, когда

- [ ] Ошибка рендера раздела sidebar, вкладки Assistant или вида основной области показывает в этой части «… failed
      to render», текст ошибки и Reload; остальное окно работает.
  - evidence: test-run pass · `pnpm test test/unit/error-boundary.test.tsx` exit 0 · mac - · 4e161b2f1d4395b691424fe2cb08b4121082d71c
- [ ] Ошибка, которую не поймал ни один внутренний boundary, показывает текст ошибки и «Reload window», а не пустое
      окно.
  - evidence: test-run pass · `pnpm test test/unit/error-boundary.test.tsx` exit 0 · mac - · 4e161b2f1d4395b691424fe2cb08b4121082d71c
- [ ] `docs/features/app-shell.md` говорит о запасном виде упавшей части.
  - evidence: commit pass · worfy-polish/163: the boundary's text helpers apart, the fallback in app-shell.md · - - · c3ac9c86f
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · c3ac9c86f
- [ ] (вручную) Сделай: в Stable worfy открой раздел Assistant и нажми вкладку Journal, затем вид Runs → Work track
      → Должно быть: окно не пустеет; если часть всё же падает — в ней «… failed to render» с текстом ошибки и
      Reload, а sidebar и toolbar работают. Текст ошибки, если он есть, — прислать.
  - needs: mac stable

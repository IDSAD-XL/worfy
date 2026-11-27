# Code story — worfy-polish 163: Journal и Work роняют окно: ошибка рендера одной части гасит всё окно

Kind: pr · Epic: worfy-polish · Ticket: 163 · PR: - · Language: ru

## 1. Что было не так

В renderer не было ни одного error boundary. Ошибку рендера, которую не поймал boundary, React 19 обрабатывает так:
снимает всё дерево с `createRoot`. Поэтому бросок в одной вкладке раздела Assistant (Journal) или в Work track вида
Runs оставлял окно владельца пустым, с тёмным фоном. Процесс renderer был жив: записей о его падении нет. Что именно
бросило, по данным владельца не воспроизвелось: журнал действий Assistant у него пуст, а вкладка Journal с пустым
журналом и со строками рендерится без ошибки. Этот PR не даёт ошибке одной части погасить окно, и сама ошибка теперь
видна на экране.

- Требование: [Что происходит](../issues/163-journal-и-work-роняют-окно.md#что-происходит)

## 2. Boundary: что показывает и что делает Reload

Code: `src/renderer/shell/ErrorBoundary.tsx:38-73` · key lines: 41, 42, 46, 47, 50, 55, 59, 63

```tsx
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, error: undefined, where: null }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { failed: true, error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({ where: topComponent(info.componentStack) })
    console.error(`[worfy] ${this.props.name} failed to render:`, error, info.componentStack)
  }

  private readonly reload = (): void => {
    if (this.props.scope === 'window') {
      window.location.reload()
      return
    }
    this.setState({ failed: false, error: undefined, where: null })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const { scope, name, above } = this.props
    return (
      <>
        {above}
        <div role="alert" className={`w-error-boundary w-error-boundary--${scope}`} data-testid="error-boundary" data-boundary={name}>
          <div className="w-error-boundary__title">{TITLES[scope]}</div>
          <div className="w-error-boundary__message">{errorText(this.state.error)}</div>
          {this.state.where === null ? null : <div className="w-error-boundary__where">in {this.state.where}</div>}
          <Button onClick={this.reload}>{scope === 'window' ? 'Reload window' : 'Reload'}</Button>
        </div>
      </>
    )
  }
}
```

- Что делает: ловит бросок потомков и вместо них рисует заголовок по месту («This section / tab / view failed to
  render»), текст ошибки, компонент из первой строки component stack и Reload. Reload раздела, вкладки или вида
  сбрасывает состояние boundary, и часть монтируется заново; у boundary всего окна — перезагрузка страницы. Флаг
  `failed` отдельно от `error`, потому что бросить можно и `undefined`.
- Почему здесь: Ticket называет `src/renderer/shell/ErrorBoundary.tsx` в «Где в коде» и требует текст ошибки на
  экране; почему класс — React ловит ошибки рендера только классовым компонентом.
- Без него: любой бросок при рендере снимает всё дерево, окно пустое, причина видна только в DevTools.
- Требование: [Что строить, п. 1](../issues/163-journal-и-work-роняют-окно.md#что-строить)
- Риски и пробелы test-ов: Reload монтирует часть с теми же данными; если бросок от данных, часть упадёт снова и
  снова покажет запасной вид — это ожидаемо. Ошибки в обработчиках событий и в `setTimeout` boundary не ловит (так
  устроен React), они и раньше не гасили окно.

## 3. Boundary вокруг каждого раздела sidebar

Code: `src/renderer/shell/Sidebar.tsx:286-292` · key lines: 289

```tsx
          {ordered.map(({ id, Component }) => (
            <div key={id} className="w-sidebar__section" data-section={id} role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={id !== active}>
              {/* A throw inside one section stays in it: the rail and the other sections keep working (worfy-polish 163). */}
              <ErrorBoundary scope="section" name={id}>
                <Component />
              </ErrorBoundary>
            </div>
```

- Что делает: каждый раздел — в своём boundary внутри своей панели; rail, полоса sidebar и другие разделы — вне его.
- Почему здесь: здесь `SidebarView` монтирует все файлы разделов; Ticket называет `Sidebar.tsx` в «Где в коде».
- Без него: бросок в разделе Assistant (вкладка Journal) снимал бы весь `App`.
- Требование: [Что строить, п. 2](../issues/163-journal-и-work-роняют-окно.md#что-строить)
- Риски и пробелы test-ов: `ProjectSwitcher` над разделами не внутри boundary раздела: его бросок ловит только
  boundary окна.

## 4. Boundary вокруг каждой вкладки Assistant

Code: `src/renderer/assistant/AssistantPanel.tsx:496-501` · key lines: 498

```tsx
        {view.offer.owed ? <OfferCard /> : null}
        {/* A throw in one tab stays in it (worfy-polish 163); the key gives each tab its own boundary. */}
        <ErrorBoundary key={tab} scope="tab" name={`assistant-${tab}`}>
          {tab === 'waits' ? <Waits view={view} /> : tab === 'summary' ? <Summary view={view} /> : tab === 'journal' ? <Journal view={view} /> : <Chat view={view} />}
        </ErrorBoundary>
      </div>
```

- Что делает: тело вкладки — в boundary с `key={tab}`: переход на другую вкладку создаёт новый boundary, так что
  упавшая вкладка не держит запасной вид на соседней. Вкладки, строка usage и поле ввода — вне boundary.
- Почему здесь: Ticket просит правку `AssistantPanel.tsx` минимальной — тот же файл правят polish 161 и 162; одна
  обёртка вокруг одной строки.
- Без него: бросок вкладки снимал бы весь раздел, а вместе с boundary раздела — и rail-кнопки Assistant внутри него.
- Требование: [Что строить, п. 2](../issues/163-journal-и-work-роняют-окно.md#что-строить)
- Риски и пробелы test-ов: `OfferCard` вне boundary вкладки; его бросок ловит boundary раздела.

## 5. Boundary вокруг каждого вида основной области

Code: `src/renderer/shell/AppShell.tsx:143-148` · key lines: 145

```tsx
          </div>
          <div className="w-shell__view" data-view="history" hidden={view !== 'history'}>
            <ErrorBoundary scope="view" name="history">
              {history}
            </ErrorBoundary>
          </div>
```

- Что делает: каждый из восьми видов основной области (здесь — Runs, где живёт Work track) — в своём boundary;
  sidebar и toolbar — вне его.
- Почему здесь: Work track — часть вида Runs, а не раздел sidebar, поэтому boundary разделов его не закрывает;
  Ticket называет `AppShell.tsx` в «Где в коде».
- Без него: бросок в Work track гасил бы окно, как во втором отчёте владельца.
- Требование: [Что строить, п. 2](../issues/163-journal-и-work-роняют-окно.md#что-строить)
- Риски и пробелы test-ов: test бросает в виде Runs; остальные семь видов обёрнуты так же, отдельно не проверены.

## 6. Work track и Run history падают каждый под своим переключателем

Code: `src/renderer/flight-recorder/RunsView.tsx:55-66` · key lines: 58, 63

```tsx
      {/* Each half fails on its own, under the switch (worfy-polish 163): Work track draws the switch in its own bar,
          so its fallback keeps the switch above it, and Run history stays one click away. */}
      <div className="w-runs__body" hidden={tab !== 'history'}>
        <ErrorBoundary scope="view" name="run-history">
          <RunHistoryView activeProjectId={activeProjectId} />
        </ErrorBoundary>
      </div>
      {tab === 'track' && activeProjectId !== undefined ? (
        <ErrorBoundary key={activeProjectId} scope="view" name="work-track" above={<div className="w-runs__bar">{switcher}</div>}>
          <WorkTrackView projectId={activeProjectId} active={active} switcher={switcher} />
        </ErrorBoundary>
      ) : null}
```

- Что делает: у каждой половины вида Runs свой boundary под переключателем «Run history | Work track». Work track
  рисует переключатель сам, в своей полосе, поэтому его запасной вид рисует переключатель над собой (проп `above`
  из шага 2): упавший Work track можно покинуть щелчком по «Run history». `key` — Project: у другого Project-а
  boundary новый.
- Почему здесь: находка ревью PR #2294 — boundary вида `history` заменял весь вид Runs вместе с переключателем, а
  выбор вкладки живёт в памяти (`work-track/store.ts`), так что Reload снова монтировал упавший Work track.
- Без него: из упавшего Work track не выйти без перезапуска окна.
- Требование: [Что строить, п. 2](../issues/163-journal-и-work-роняют-окно.md#что-строить)
- Риски и пробелы test-ов: в test-е Work track подменён компонентом, который бросает или рисует переданный
  переключатель; настоящий `WorkTrackView` здесь не бросает.

## 7. Boundary всего окна

Code: `src/renderer/main.tsx:141-149` · key lines: 145

```tsx
  // A throw that no inner boundary caught shows what failed and «Reload window», not a blank window
  // (worfy-polish ticket 163): without a boundary React unmounts the whole tree.
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary scope="window" name="app">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
```

- Что делает: весь `App` — в boundary окна: бросок, который не поймал ни один внутренний boundary (например, в
  `ProjectSwitcher` или toolbar), показывает текст ошибки и «Reload window».
- Почему здесь: Ticket называет `main.tsx` в «Где в коде»; это единственное место `createRoot`.
- Без него: такой бросок по-прежнему оставлял бы пустое окно.
- Требование: [Что строить, п. 2](../issues/163-journal-и-work-роняют-окно.md#что-строить)
- Риски и пробелы test-ов: boundary окна проверен на отдельном компоненте, а не на настоящем `createRoot` из
  `main.tsx`.

## 8. Что сознательно не меняли

Вкладку Journal не переписывали: main проверяет каждый ответ и событие IPC схемой (`journalRowSchema`), поэтому
строка незнакомой формы в renderer не доходит, а от остального закрывает boundary вкладки. Причина броска в окне
владельца не найдена: следующий сбой покажет свой текст и компонент прямо на экране.

## 9. Как проверено

`node scripts/vitest-electron.mjs test/unit/error-boundary.test.tsx` — exit 0 (10 test-ов). Test-ы раздела (и
синтетического, и настоящего файла раздела в `AppShell`), вкладки, вида и Work track красные без boundary: без них
React снимает дерево, и `within(...)` не находит запасной вид. `pnpm lint`,
`pnpm typecheck`, `pnpm test` — exit 0; gate fast — green. e2e и Electron локально не запускали (правило владельца).

## Проверить себя

1. Зачем у boundary вкладки Assistant `key={tab}`?
   - Ответ: без него переход на другую вкладку оставил бы тот же boundary в состоянии `failed`, и соседняя вкладка
     показала бы запасной вид вместо себя.
   - Строки: `src/renderer/assistant/AssistantPanel.tsx:498`
2. Почему Work track не закрыт boundary разделов sidebar?
   - Ответ: он рисуется в виде Runs основной области, а не в панели sidebar; его закрывает boundary вида.
   - Строки: `src/renderer/shell/AppShell.tsx:145`
3. Почему Reload окна перезагружает страницу, а Reload части — нет?
   - Ответ: у части сброс состояния boundary монтирует её заново, остальное окно живо; у окна живого дерева нет,
     поэтому — `window.location.reload()`.
   - Строки: `src/renderer/shell/ErrorBoundary.tsx:48-54`

## 10. Что нашёл review и что осталось

> VERIFIED — worfy-polish 163 (React error boundaries on every sidebar section, every Assistant tab, each main-area view, the two halves of the Runs view and the root: a render error shows a fallback with its message, the component name and Reload instead of blanking the window; the root cause of the owner's Journal and Work crashes is not found and stays open), head 1ac047b3c8e73e5610d5124a0d3cb387273a2940
>
> Gate (depth medium, one round plus two low fixes):
> - Round 1, reviewer (lens: correctness) — MERGE, two low findings:
>   - the history view's boundary replaced the Run history | Work track switch, so a failing Work track trapped the user;
>   - the real-shell test stayed green with a section boundary removed.
>   - Checked fine:
>     - React 19 boundaries also catch effect and ref errors; event-handler and async errors never blank the window, so the owner's blank window was a render or commit error;
>     - the window can still go blank only on a JS hang, a renderer or GPU crash, or a throw in the fallback;
>     - Assistant tabs reset on switch (key={tab});
>     - no DOM, selector or focus change while no error is caught;
>     - the fallback shows error.message and one component name.
>   - Mutations: with all three boundaries removed, 3 tests fail; with one section boundary removed, 1 fails.
> - Fix 1ac047b3c:
>   - RunsView.tsx:55-66 gives Run history and Work track each its own boundary under the switch; Work track's boundary is keyed by Project and draws the switch via a new `above` prop (ErrorBoundary.tsx:20,60-63);
>   - the real-shell test makes the ADR section throw;
>   - 3 tests red first.
>   Diff read by the orchestrator; it closes both findings.
> Evidence: 30 files (682 tests) exit 0; lint exit 0; typecheck exit 0; gate fast green; story-check and evidence-check exit 0.
> Not verified:
> - the cause of the owner's crashes (the Journal data is empty and no throw reproduced; Work track was not reproduced);
> - the fallback in real Electron;
> - manual item 5: the owner presses Journal and Work in Stable and sends the fallback text.

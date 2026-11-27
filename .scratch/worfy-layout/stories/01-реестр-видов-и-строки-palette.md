# Code story — worfy-layout 01: Реестр видов и строки palette

Kind: pr · Epic: worfy-layout · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Имена шести видов main area были записаны в трёх местах: `viewOptions` в toolbar, `VIEW_NAMES` в `AppShell.tsx` и
строки View в Command palette. Строки для Pipeline в palette не было. Следующие Ticket-ы Epic-а ставят View button-ы
в три зоны (header, rail, footer); для этого кнопка должна описываться один раз, вне toolbar.

- Требование: [Что строить](../issues/01-реестр-видов-и-строки-palette.md#что-строить)

## 2. Запись вида в реестре: Runs

Code: `src/renderer/shell/views.tsx:131-159` · key lines: 142, 144, 148, 153

```tsx
    id: 'history',
    area: 'Run history',
    button: {
      label: 'Runs',
      title: 'Run history',
      Icon: icon(
        <>
          <circle cx="8" cy="8" r="5.75" />
          <path d="M8 4.75V8l2.25 1.5" />
        </>,
      ),
      needsProject: 'Open a Project to see its Runs',
      useBadge: noBadge,
      open: (project) => {
        if (project !== undefined) void openRunHistory(project.id)
        return undefined
      },
      command: {
        id: 'open-run-history',
        title: 'Open Run history',
        detail: 'Autopilot Runs',
        keys: ['run history', 'autopilot runs', 'flight recorder', 'timeline'],
        open: (project) => {
          if (project === undefined) return undefined
          setRunsTab(project.id, 'history')
          void openRunHistory(project.id)
          return undefined
        },
      },
```

- Что делает: у записи есть `id` (`ShellView`), `area` (имя main area) и `button`: подпись, tooltip, иконка, причина
  неактивности без Project-а, `useBadge`, `open` и строка palette (`command`). Runs — единственная кнопка со своим
  `open`: она открывает Run history на последнем Run и сохраняет выбор вкладки Runs; строка palette сначала
  возвращает Run history (`setRunsTab`), как раньше.
- Почему здесь: Ticket называет новый файл `src/renderer/shell/views.tsx` и перечисляет поля записи в «Решения».
- Без него: подпись, tooltip и действие Runs снова были бы в двух местах (toolbar и palette), и rail или footer
  Ticket-а 04 написали бы их в третий раз.
- Требование: [Решения](../issues/01-реестр-видов-и-строки-palette.md#решения)
- Риски и пробелы test-ов: у Pull requests и Acceptance `button.open` нет — их кнопки переключают вид, как вкладки
  до тикета; `openPrInboxOf` и `openAcceptance()` зовут только их строки palette. Это отступление от spec (там
  `open` у кнопки), записано в «Итог» тикета.

## 3. Открыть вид: одно правило для кнопки и строки

Code: `src/renderer/shell/views.tsx:224-233` · key lines: 229, 230, 231

```tsx
/**
 * Opens the view of a View button for the open Project. A button without an `open` of its own switches the main area
 * through `switchTo` — the shell's switch in the toolbar, the window's view (session/navigation.ts) elsewhere.
 */
export function openView(entry: ViewEntry & { button: ViewButton }, project: ViewProject | undefined, switchTo: (view: ShellView) => void = setView): ViewOpened {
  if (entry.button.needsProject !== undefined && project === undefined) return undefined
  if (entry.button.open !== undefined) return entry.button.open(project)
  switchTo(entry.id)
  return undefined
}
```

- Что делает: вид, которому нужен Project, без Project-а не открывается; запись со своим `open` открывает себя сама;
  остальные переключают main area через `switchTo` — в toolbar это `onViewChange` shell-а, иначе `setView` окна.
- Почему здесь: spec задаёт `open(project)` по умолчанию как `setView(id)`; toolbar получает вид через
  `onViewChange`, поэтому переключатель — параметр.
- Без него: toolbar и palette снова решали бы каждый сам, что делает Runs без Project-а.
- Требование: [Решения](../issues/01-реестр-видов-и-строки-palette.md#решения)
- Риски и пробелы test-ов: rail и footer (Ticket 04) ещё не зовут `openView`; проверено только из toolbar и palette.

## 4. Toolbar строит сегменты из реестра

Code: `src/renderer/shell/Toolbar.tsx:52-64` · key lines: 53, 54, 60

```tsx
function viewSegments(project: ToolbarProject | undefined): readonly SegmentOption<ShellView>[] {
  return VIEW_BUTTONS.map(({ id, button }) => {
    const inactive = button.needsProject !== undefined && project === undefined
    return {
      value: id,
      label: button.label,
      icon: <ViewIcon button={button} />,
      disabled: inactive,
      title: inactive ? button.needsProject : button.title,
      ...(button.testId === undefined ? {} : { testId: button.testId }),
    }
  })
}
```

- Что делает: шесть сегментов — шесть записей с `button`, в прежнем порядке и с прежними иконками; без Project-а
  tooltip неактивной кнопки — её причина. `ViewIcon` рисует иконку и счёт Acceptance с прежней разметкой
  (`w-acc-tab`, `acceptance-tab-count`).
- Почему здесь: Ticket называет `Toolbar.tsx` (`viewOptions`, `SegmentedControl`) в «Где в коде» и требует удалить
  `viewOptions`; `viewSegments` только переводит записи реестра в `SegmentOption`.
- Без него: header рисовал бы свой список, и реестр не был бы источником.
- Требование: [Готово, когда](../issues/01-реестр-видов-и-строки-palette.md#готово-когда)
- Риски и пробелы test-ов: tooltip-ы Session, Pipeline, Runs и Pull requests поменялись по spec («Session view»,
  «Pipeline board», «Run history», «Pull requests of the open Project»). e2e `toolbar.spec.ts` локально не
  запускался; кнопки он ищет по `aria-label` (подпись). `pipeline.spec.ts` проверяет и `title` каждой кнопки: его
  шаблон переписан под tooltip-ы реестра (найдено review-ем, round 1).

## 5. Строки View в palette — из реестра

Code: `src/renderer/palette/commands.ts:404-414` · key lines: 404, 410, 412

```ts
  const commands: PaletteCommand[] = VIEW_BUTTONS.filter(({ button }) => button.needsProject === undefined || project !== undefined).map((entry) => {
    const { id, title, detail, keys, open } = entry.button.command
    return {
      id,
      group: 'View',
      title,
      detail: view === entry.id ? 'shown now' : detail,
      ...(keys === undefined ? {} : { keys: [...keys] }),
      run: () => (open !== undefined ? open(project) : openView(entry, project)),
    }
  })
```

- Что делает: строка у каждой кнопки реестра; у видов, которым нужен Project, — только с Project-ом. id, заголовки и
  ключи поиска прежние, новая строка `view:pipeline` «Pipeline board». Вторая строка — «shown now», пока вид открыт.
- Почему здесь: Ticket называет `viewCommands` в `palette/commands.ts`.
- Без него: Pipeline из palette не открыть, а новый вид пришлось бы добавлять и в palette руками.
- Требование: [Решения](../issues/01-реестр-видов-и-строки-palette.md#решения)
- Риски и пробелы test-ов: строки View теперь идут в порядке кнопок (Runs и Pull requests — сразу после Pipeline, до
  First-run checks); у «Open Run history» вторая строка — «shown now», пока открыт Run history. Порядок без
  Project-а проверяет `test/unit/palette-commands.test.tsx`.

## 6. Что сознательно не меняли

`VIEW_NAMES` в `AppShell.tsx` остаётся: его убирает Ticket 04, `AppShell.tsx` правит Ticket 03. Бейджи Pull requests
и Pipeline — Ticket 04. CSS счёта Acceptance (`acceptance.css`) не трогали.

## 7. Как проверено

`test/unit/view-registry.test.tsx` на старом коде (реестр-заглушка) — exit 1, 5 failed и 3 passed; после правки — exit 0.
Все 52 unit-файла, которые импортируют toolbar, palette, navigation и acceptance, — exit 0 (1366 test-ов).
`pnpm lint` exit 0, `pnpm typecheck` exit 0, gate fast exit 0. e2e и Electron локально не запускали (правило владельца).

## Проверить себя

1. Почему кнопка Pull requests в toolbar не зовёт `openPrInboxOf`, хотя строка palette зовёт?
   - Ответ: у кнопки нет своего `open`, и `openView` переключает вид через `onViewChange` shell-а, как вкладка до
     тикета; `openPrInboxOf` — `command.open` только строки palette.
   - Строки: `src/renderer/shell/views.tsx:229-231`
2. Что делает нажатие Runs без открытого Project-а и где это решено?
   - Ответ: ничего: `openView` возвращается до `open`, потому что у Runs есть `needsProject`; сама кнопка ещё и
     неактивна.
   - Строки: `src/renderer/shell/views.tsx:229`
3. Почему строка «Open Run history» не открывает вид через `openView`?
   - Ответ: у неё свой `command.open`: он сначала возвращает Project-у вкладку Run history (`setRunsTab`), а кнопка
     Runs сохраняет выбор Work track.
   - Строки: `src/renderer/shell/views.tsx:148-158`

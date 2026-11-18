# Code story — worfy-auth-check 04: Иконка Health check на rail над Machines, строка palette, порядок строк и кнопка Fix

Kind: pr · Epic: worfy-auth-check · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

Ticket 03 дал модель Health check: уровень строки, статус `unknown`, худший уровень отчёта и событие его изменения. Но
увидеть это было негде: на rail sidebar не было иконки, строки Settings → Health шли в порядке проверок без уровня и без
кнопки Fix, строки групп Projects, Codex и Linked machines renderer не рисовал вовсе, а в Command palette была только
строка «First-run checks», которая открывает окно First run.

- Требование: [Что происходит](../issues/04-иконка-palette-и-вид-строк.md#что-происходит)

## 2. Отчёт для иконки — без своей проверки

Code: `src/renderer/shell/Sidebar.tsx:104-128` · key lines: 107, 112, 120

```tsx
function useHealthReport(): FirstRunReport | null {
  const [report, setReport] = useState<FirstRunReport | null>(null)
  useEffect(() => {
    if (!hasPreloadBridge()) return undefined
    let live = true
    let heard = false
    let stop = (): void => undefined
    try {
      stop = subscribe('firstRun.reportChanged', (next) => {
        heard = true
        setReport(next)
      })
    } catch (error) {
      showSubscribeError('firstRun.reportChanged', error)
    }
    void invoke('firstRun.health').then((result) => {
      if (live && !heard && result.ok) setReport(result.value)
    })
    return () => {
      live = false
      stop()
    }
  }, [])
  return report
}
```

- Что делает: при монтировании кнопки подписывается на `firstRun.reportChanged` и один раз читает текущий отчёт через
  `firstRun.health`. Если событие пришло раньше ответа, поздний ответ отбрасывается: событие новее.
- Почему здесь: бриф требует использовать канал `firstRun.health` и событие модели Ticket-а 03 и не запускать проверки из
  иконки. Ticket называет `src/renderer/shell/Sidebar.tsx` местом кнопки.
- Без него: иконка либо гоняла бы `firstRun.checks` сама, либо знала бы только отчёт, который держит store окна First run,
  а тот сбрасывает отчёт, когда ни окно, ни Settings → Health не открыты.
- Требование: [Что делаем, п. 2](../issues/04-иконка-palette-и-вид-строк.md#что-делаем)
- Риски и пробелы test-ов: подписка один раз на кнопку; окно на Linked machine читает Health check своей Machine, потому что
  оба канала помечены `local`. Это не проверено отдельным test-ом.

## 3. Цвет точки — худший уровень

Code: `src/renderer/shell/Sidebar.tsx:178-183` · key lines: 180, 181, 183

```tsx
export function HealthRailButton() {
  const report = useHealthReport()
  const checking = useFirstRun((state) => state.checking)
  const level = worstLevel(report, checking)
  const reason = healthReason(report, level)
  const tone = HEALTH_TONE[level]
```

- Что делает: уровень даёт `worstLevel` Ticket-а 03, «Check again» в окне — серое кольцо, `HEALTH_TONE` переводит уровень в
  тон точки: `critical` — красный, `non-critical` — жёлтый, `ok` — без точки, `pending` — серое кольцо. Tooltip и
  `aria-description` называют причину: «critical: …», «non-critical: …», «Couldn't check: <reason> (<строка>)».
- Почему здесь: решение владельца Q3 (цвета) и Q2 (`unknown` никогда не critical); Q9 — никаких toast, только точка.
- Без него: красная точка от строки «нет сети» или точка, которая не гаснет, когда всё `ok`.
- Требование: [Что делаем, п. 2](../issues/04-иконка-palette-и-вид-строк.md#что-делаем)
- Риски и пробелы test-ов: цвета — новые tokens `--health-critical` и `--health-warning` в `tokens.css` (строка в таблице
  F-SPEC и в `test/e2e/theme.spec.ts`); светлый жёлтый `#A87F00` выбран ради контраста ≥ 3:1 с sidebar — это не записано
  владельцем.

## 4. Кнопка над Machines без второго tablist

Code: `src/renderer/shell/shell.css:93-113` · key lines: 101, 104, 105, 109

```css
/*
 * The tabs of the sections (the tablist) lay out no box of their own: each tab is a flex item of the
 * rail, so the Health check button, outside the tablist after it, stands between the tabs of the top
 * and those of the foot (worfy-auth-check ticket 04). The order: the top tabs, Health check pushed
 * down by the room above it, the foot tabs (the first one, `data-rail-foot`, and the tabs after it),
 * Settings.
 */
.w-sidebar__tabs {
  display: contents;
}
.w-sidebar__health {
  order: 1;
  margin-top: auto;
}
.w-sidebar__rail-button[data-rail-foot],
.w-sidebar__rail-button[data-rail-foot] ~ .w-sidebar__rail-button {
  order: 2;
}
.w-sidebar__tabs ~ .w-sidebar__rail-button:not(.w-sidebar__health) {
  order: 3;
}
```

- Что делает: tablist остаётся одним элементом со всеми вкладками, а кнопка Health check стоит в DOM после него, вне
  tablist. CSS `order` рисует её между вкладками верха и вкладками `railEnd`.
- Почему здесь: Ticket требует кнопку вне `role="tablist"` и над Machines, не ломая клавиатуру tablist. Его пример — второй
  tablist для вкладок `railEnd`. От него отказались: e2e-helper-ы и test-ы четырёх файлов ищут Machines в tablist
  «Sidebar sections».
- Без него: кнопка внутри tablist ломает ARIA (в tablist только tab), второй tablist ломает эти locator-ы.
- Требование: [Что делаем, п. 1](../issues/04-иконка-palette-и-вид-строк.md#что-делаем)
- Риски и пробелы test-ов: порядок Tab — вкладка, Health check, Settings — расходится с видом, когда выбран Machines
  (фокус идёт вверх). `display: contents` у элемента с ролью Chromium Electron 44 отдаёт в дерево доступности; проверено
  только e2e-locator-ами, не экранным диктором.

## 5. Порядок строк и группы

Code: `src/renderer/shell/FirstRunChecks.tsx:42-79` · key lines: 43, 44, 66, 76, 77, 78

```tsx
function rowRank(check: Pick<Check, 'status' | 'severity'>): 0 | 1 | 2 {
  if (check.status === 'ok') return 2
  return check.status !== 'unknown' && check.severity === 'critical' ? 0 : 1
}

/** A block of rows under one heading: a group, or for the Projects group one block per Project (Q4). */
interface CheckBlock {
  key: string
  title: string
  rows: Check[]
}

/**
 * The rows in the order Health check shows them: the critical rows that are not `ok` first, then the
 * other rows that are not, then the `ok` ones. Rows keep their group, so the groups go by the first
 * row each holds; groups and rows of one rank keep the order of GROUPS and of the report.
 */
function checkBlocks(checks: readonly Check[]): CheckBlock[] {
  const blocks: CheckBlock[] = []
  for (const group of GROUPS) {
    const rows = checks.filter((each) => each.group === group)
    if (group !== 'Projects') {
      if (rows.length > 0) blocks.push({ key: group, title: group, rows })
      continue
    }
    const projects = new Map<string, CheckBlock>()
    for (const row of rows) {
      const key = `Projects:${row.project?.id ?? ''}`
      const block = projects.get(key) ?? { key, title: row.project === undefined ? 'Projects' : `Projects · ${row.project.name}`, rows: [] }
      block.rows.push(row)
      projects.set(key, block)
    }
    blocks.push(...projects.values())
  }
  const first = (block: CheckBlock): number => Math.min(...block.rows.map(rowRank))
  for (const block of blocks) block.rows.sort((a, b) => rowRank(a) - rowRank(b))
  return blocks.sort((a, b) => first(a) - first(b))
}
```

- Что делает: ранг строки 0 — critical не в `ok`, 1 — прочие не в `ok` (и любая `unknown`), 2 — `ok`. Внутри группы строки
  идут по рангу, группы — по рангу первой строки; при равном ранге остаётся порядок `GROUPS` и отчёта (сортировка
  стабильная). Группа Projects делится на блоки «Projects · <имя>». В `GROUPS` добавлены Projects, Codex и Linked machines.
- Почему здесь: Ticket называет `FirstRunChecks.tsx` и порядок «critical, non-critical, ok»; группировку по Project-ам —
  решение владельца Q4; группы Codex и Linked machines — замечание ревью Ticket-а 03.
- Без него: critical-сбой Harness стоял бы ниже зелёных строк Claude Code, строки Project-ов и Codex не показывались бы.
- Требование: [Что делаем, п. 4](../issues/04-иконка-palette-и-вид-строк.md#что-делаем)
- Риски и пробелы test-ов: порядок строгий внутри группы и по первым строкам групп, но не по всему списку: `ok`-строка
  группы Harness может стоять выше non-critical строки jq. Так решено без владельца, чтобы строки не уходили из своих групп.
  Порядок меняется и в окне First run: оно рисует те же строки.

## 6. Fix и «Couldn't check»

Code: `src/renderer/shell/FirstRunChecks.tsx:246-252` · key lines: 249, 252

```tsx
  const pressed = actions.find((action) => action.id === busy)
  const progress = pressed === undefined ? undefined : progressText(pressed)
  // A row a `safe` button repairs (spec: the repair) offers it as "Fix"; the tooltip names what it does.
  const fixable = checkState(check) === 'fixable'
  const rank = rowRank(check)
  // What could not be checked says why (Q2), in place of what was found.
  const detail = check.status === 'unknown' ? `Couldn't check: ${check.detail === '' ? 'no answer' : check.detail}` : check.detail
```

- Что делает: у строки в состоянии `fixable` (`checkState` Ticket-а 03) кнопка с пометкой `safe` читается «Fix»
  (основной цвет, `aria-label` «Fix: Use alice», tooltip — её собственная подпись); остальные кнопки строки — со своими
  подписями. Строка `unknown` вместо найденного пишет «Couldn't check: <reason>», её chip серый, а не цвета сбоя. У
  строки не в `ok` — метка уровня «Critical» или «Non-critical».
- Почему здесь: CONTEXT.md называет кнопку строки Health check голым «Fix»; spec, «Починка» — безопасная кнопка только
  обратимая и без чужих данных.
- Без него: человек не отличил бы кнопку, которая сама чинит, от шага, который делает он сам.
- Требование: [Что делаем, п. 4](../issues/04-иконка-palette-и-вид-строк.md#что-делаем)
- Риски и пробелы test-ов: ни одна строка сейчас не даёт `safe`-кнопку — их дают Ticket-ы 05–08, и «Fix» пока ничего не
  запускает (`act` возвращается раньше для кнопок Epic-а). Две строки GitHub access разных Project-ов имеют один id: занятая
  кнопка одной покажется занятой и у другой — это для Ticket-а 05.

## 7. Что сознательно не меняли

- `src/renderer/shell/sidebar-scope.ts` (тона `RailBadge`) — только читать по Ticket-у: точка Health check рисуется тем же
  классом `w-sidebar__rail-dot` со своими `data-tone`.
- Строка palette «First-run checks» и окно First run остались как были (Q1); новая строка «Health check» — рядом.

## 8. Как проверено

- Unit test-ы модуля (health-rail-button, settings-health, first-run-dialog, first-run-concepts, palette-commands,
  sidebar-scope, sidebar-section, machines-section, health-severity и contract health-reports, first-run-checks) — exit 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0.
- 14 мутантов на выборе тона, кольце при «Check again», позднем ответе, ранге строки, сортировке строк и групп, делении
  Projects, Fix и метке уровня — все убиты (один выживший, «Fix у любой safe-кнопки», убит после добавления `ok`-строки
  с safe-кнопкой в test).
- e2e `test/e2e/settings-health.spec.ts` (иконка над Machines, щелчок и palette открывают Settings → Health, снимки
  `health-rail-dot` и `settings-health-levels`) локально не запускался — правило владельца; его проверяет CI.

## Проверить себя

1. Почему точка не станет красной, если main прислал строку `unknown` с `severity: 'critical'`, и где ещё это правило
   повторено?
   Ответ: цвет даёт `worstLevel`, который не считает `unknown` critical; `rowRank` в списке тоже даёт такой строке ранг 1,
   а не 0.
   Lines: `src/renderer/shell/FirstRunChecks.tsx:42-45`
2. Ответ на `firstRun.health` пришёл после события `firstRun.reportChanged`. Какой отчёт покажет иконка и почему?
   Ответ: отчёт из события: флаг `heard` отбрасывает поздний ответ первого вызова, он старше.
   Lines: `src/renderer/shell/Sidebar.tsx:104-128`
3. Почему кнопка Health check не стоит внутри tablist, хотя видна среди вкладок?
   Ответ: в tablist по ARIA только tab; tablist получил `display: contents`, и `order` рисует кнопку между вкладками верха
   и низа, а DOM и locator-ы test-ов остаются прежними.
   Lines: `src/renderer/shell/shell.css:93-113`

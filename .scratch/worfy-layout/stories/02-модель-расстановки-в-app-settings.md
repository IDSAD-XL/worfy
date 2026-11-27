# Code story — worfy-layout 02: Модель расстановки в app settings

Kind: pr · Epic: worfy-layout · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

Какой View button стоит в header, а какой на rail, задаёт код `Toolbar.tsx`; хранить расстановку негде. Epic
worfy-layout даёт человеку двигать шесть View button-ов между header, rail и footer, и сначала нужна модель
расстановки и место для неё в app settings этой Machine. UI в этом Ticket-е нет.

- Требование: [Что строить](../issues/02-модель-расстановки-в-app-settings.md#что-строить)

## 2. Ремонт расстановки: любой вход даёт все шесть id ровно по одному разу

Code: `src/shared/layout/view-buttons.ts:71-88` · key lines: 72, 74, 79, 85

```ts
export function repairViewButtons(raw: unknown): ViewButtons {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaultViewButtons()
  const zones = raw as Partial<Record<ViewZone, unknown>>
  if (!VIEW_ZONES.every((zone) => Array.isArray(zones[zone]))) return defaultViewButtons()
  const seen = new Set<ViewButtonId>()
  const repaired: ViewButtons = { header: [], rail: [], footer: [] }
  for (const zone of VIEW_ZONES) {
    for (const id of zones[zone] as unknown[]) {
      if (!isViewButtonId(id) || seen.has(id)) continue
      seen.add(id)
      repaired[zone].push(id)
    }
  }
  for (const zone of VIEW_ZONES) {
    for (const id of DEFAULT_VIEW_BUTTONS[zone]) if (!seen.has(id)) repaired[zone].push(id)
  }
  return repaired
}
```

- Что делает: не объект или зона не массив — расстановка по умолчанию. Неизвестный id и id не строкой отбрасываются;
  из повторов остаётся первый в порядке header, rail, footer; недостающий id встаёт в конец своей зоны по умолчанию.
  Зона, которой эта сборка не знает, пропадает.
- Почему здесь: Ticket называет новый модуль без React `src/shared/layout/view-buttons.ts`; правило ремонта записано в
  разделе «Решения» Ticket-а. Одна функция служит и чтению файла, и patch-у окна.
- Без него: расстановка, записанная сборкой с новым видом, ломала бы чтение `app-settings.json` в старой сборке или
  прятала бы кнопку, а прятать нельзя (Q6).
- Требование: [Решения](../issues/02-модель-расстановки-в-app-settings.md#решения)
- Риски и пробелы test-ов: «зона пропала» решено как «не та форма» — расстановка по умолчанию целиком, а не пустая
  зона; ни Ticket, ни spec этот случай не называют. Расстановку, записанную сборкой новее, старая сборка сохранит без
  нового вида (раздел «Риски» spec-а).

## 3. Две схемы: строгая для состояния, мягче для patch-а

Code: `src/shared/layout/view-buttons.ts:36-48` · key lines: 37, 42, 48

```ts
  const placed = VIEW_ZONES.flatMap((zone) => layout[zone])
  return placed.length === VIEW_BUTTON_IDS.length && VIEW_BUTTON_IDS.every((id) => placed.includes(id))
}

/** A layout a window sends: known ids in the three zones. The store repairs it before it keeps it. */
export const viewButtonsPatchSchema = z.object({
  header: z.array(viewButtonIdSchema),
  rail: z.array(viewButtonIdSchema),
  footer: z.array(viewButtonIdSchema),
})

/** A layout as the settings hold it: each of the six ids in exactly one zone. */
export const viewButtonsSchema = viewButtonsPatchSchema.refine(complete, 'each View button sits in exactly one zone')
```

- Что делает: patch принимает только известные id (`z.enum`) во всех трёх зонах; состояние, которое store пишет и
  отдаёт по каналам, ещё и держит каждый из шести id ровно один раз.
- Почему здесь: Ticket велит строгую схему `z.enum` id и patch «вся расстановка целиком»; store чинит пришедшую
  расстановку, поэтому patch с повтором или пропуском не отказывается. Почему неизвестный id в patch-е отказывается, а не
  чинится, — решение этого PR: окно той же сборки шлёт только свои id.
- Без него: неполная расстановка могла бы уйти из main в окно или в файл.
- Требование: [Решения](../issues/02-модель-расстановки-в-app-settings.md#решения)
- Риски и пробелы test-ов: contract-test проверяет отказ на неизвестном id и на пропущенной зоне через канал
  `appSettings.set`.

## 4. Store: мягкое чтение файла, null — Reset layout, сравнение ревизий

Code: `src/main/settings/store.ts:209-222` · key lines: 210, 216, 221

```ts
  // Repaired, never refused: an id another build wrote is dropped, a missing one goes back to its zone.
  viewButtons: z.unknown().transform(repairViewButtons).optional().catch(undefined),
  revision: z.number().int().nonnegative().default(0),
})

/** The View button layout field of a state, repaired: present only while the person made one. */
function viewButtonsField(layout: AppSettings['viewButtons'] | AppSettingsPatch['viewButtons']): Pick<AppSettings, 'viewButtons'> {
  return layout === undefined || layout === null ? {} : { viewButtons: repairViewButtons(layout) }
}

/** Whether two states hold the same layout; absent is not the default layout made by hand. */
function sameViewButtonsField(a: ViewButtons | undefined, b: ViewButtons | undefined): boolean {
  return a === undefined || b === undefined ? a === b : sameViewButtons(a, b)
}
```

- Что делает: поле файла читается через `repairViewButtons` и никогда не делает файл unreadable. `copy` и `merge`
  кладут поле через `viewButtonsField`: patch без поля оставляет расстановку, `null` убирает поле, расстановка
  чинится. `same` сравнивает расстановки по зонам и порядку: та же расстановка второй раз не пишет файл и не растит
  ревизию.
- Почему здесь: Ticket называет `appSettingsFileSchema`, `merge` и `appSettingsPatchSchema` в «Где в коде» и велит
  читать поле как `autoContinue`, через `.optional().catch(undefined)`.
- Без него: испорченное поле сбросило бы все настройки Machine в значения по умолчанию, а Reset layout было бы нечем
  выразить.
- Требование: [Решения](../issues/02-модель-расстановки-в-app-settings.md#решения)
- Риски и пробелы test-ов: отсутствующее поле и расстановка по умолчанию, записанная руками, — разные состояния: patch
  с расстановкой по умолчанию при пустом поле пишет файл и растит ревизию. Это решение этого PR, Ticket его не
  называет.

## 5. Окно Linked machine читает расстановку этого компьютера

Code: `src/shared/settings/app-settings.ts:494-503` · key lines: 497, 502

```ts
/**
 * The View button layout in force: the one the person made, else the default. It belongs to this
 * Machine (Q5 of the worfy-layout spec), and a window on a Linked machine's Project shows it too (Q13)
 * with no channel of its own: `appSettings.get`, `.set` and `.changed` are `local`
 * (src/shared/ipc/app-settings.ts), and from such a window a `local` channel goes to this Machine's
 * main, not to the Linked machine (routeOf of src/renderer/ipc.ts).
 */
export function viewButtonsOf(settings: Pick<AppSettings, 'viewButtons'>): ViewButtons {
  return settings.viewButtons ?? defaultViewButtons()
}
```

- Что делает: отдаёт расстановку в силе — сделанную человеком или по умолчанию. Комментарий записывает, почему окну
  Linked machine не нужен свой канал.
- Почему здесь: Ticket велит функцию `viewButtonsOf` и комментарий у неё; unit-test проверяет, что три канала объявлены
  `local` и `routeOf` ведёт их на эту Machine.
- Без него: следующий Ticket мог бы завести отдельный канал расстановки и разойтись с маршрутом ADR-0053.
- Требование: [Test-ы](../issues/02-модель-расстановки-в-app-settings.md#test-ы)
- Риски и пробелы test-ов: `routeOf` отдаёт `this-machine` и для имени, которого никто не объявил; поэтому test
  сначала проверяет `accessOf(channel) === 'local'`.

## 6. Что сознательно не меняли

UI нет: кнопки, меню и Reset layout — следующие Ticket-ы Epic-а. Каналы `appSettings.*`, `src/renderer/ipc.ts` и
`useAppSettings.ts` не менялись: Ticket велит их только читать. Feature page не правилась: видимого поведения нет.
ADR не нужен: расстановка — ещё одно поле app settings (ADR-0005), маршрут `local` задан ADR-0053.

## 7. Как проверено

Сначала красные test-ы: `test/unit/view-buttons.test.ts` падал на импорте (модуля не было); три новых contract-test-а
`test/contract/app-settings.test.ts` на прежнем `store.ts` — 3 failed, 74 passed. После правки: `test/unit/view-buttons.test.ts`
и `test/contract/app-settings.test.ts` — exit 0 (98 test-ов); все unit и contract test-ы, которые импортируют
`shared/settings/app-settings`, `main/settings/store`, `shared/layout/`, `settings/useAppSettings` или
`renderer/ipc` (183 файла, 3825 test-ов), — exit 0; `pnpm lint && pnpm typecheck && pnpm test` и gate fast — коды
выхода в отчёте implementer-а и в Evidence-строках Ticket-а. e2e локально не запускали (правило владельца).

## Проверить себя

1. В `app-settings.json` лежит `"viewButtons": "header"`. Что увидит человек после запуска и что станет с остальными
   настройками?
   - Ответ: расстановку по умолчанию; файл не уходит в unreadable, остальные поля читаются как есть: строка — не та
     форма, и `repairViewButtons` даёт расстановку по умолчанию, а не ошибку схемы.
   - Строки: `src/shared/layout/view-buttons.ts:71-74`, `src/main/settings/store.ts:209-210`
2. Сборка новее записала вид `timeline` в header. Что сделает с ним старая сборка при следующей записи?
   - Ответ: отбросит: неизвестный id при чтении выпадает, и следующая запись кладёт в файл расстановку без него.
   - Строки: `src/shared/layout/view-buttons.ts:77-83`
3. Почему patch с одной и той же расстановкой не растит ревизию, а `null` поверх отсутствующего поля ничего не пишет?
   - Ответ: `same` сравнивает поле через `sameViewButtonsField`; совпавшее состояние `write` не пишет. Отсутствие равно
     только отсутствию.
   - Строки: `src/main/settings/store.ts:220-222`

## 8. Что нашёл review и что осталось

> VERIFIED — worfy-layout 02 (the view-button layout — which of the six view buttons sits in header, rail or footer, and in what order — is an optional viewButtons field of this machine's app settings: a corrupt field is repaired on read without setting the file aside, duplicates and missing ids are repaired, an unknown id in a patch is refused, a missing zone gives the whole default layout, a null patch removes the field; the three appSettings channels stay local, so a Linked machine window reads this computer's layout), head b3ada50e6468c2ef29cace7b43c6d44c65c43d77
>
> Gate (depth medium, one round):
> - Round 1, reviewer (lens: correctness and the implementer's report) — VERIFIED, one low finding:
>   - low (Noted): store.ts:221 sameViewButtonsField — «field absent» vs «explicit default» is not covered by a test (mutation M6 survives); one expect in test/contract/app-settings.test.ts would cover it.
>   - Checked fine: 3 contract tests red on the old store.ts; repair on read keeps other fields; null patch; unknown id refused by z.enum (view-buttons.ts:118-122); Linked machine bridge routes local channels to this computer (ipc.ts:145-146), so ipc.ts, useAppSettings.ts and shared/ipc/app-settings.ts need no change; newer/older builds behave as the spec's «Риски» say (a Stable without this ticket drops the field on its next write, like any new app-settings field).
>   - Mutations: 11 caught (M1, M2, M3b, M4, M5, M7–M12); M3 and M13 equivalent; M6 is the low finding.
> Evidence: view-buttons + app-settings tests exit 0 (98); 10 more contract files exit 0 (247); story-check exit 0; gate fast green; implementer: pnpm lint/typecheck/test exit 0 (21525 tests).
> Not verified: e2e (owner rule, CI runs them); ci-ok was still running at review time.
> CI: macos-e2e (1/2) on b3ada50e6 hit the 2400 s suite limit (216 passed, 56 not run, no failing test; run 45928325369); one `gh run rerun --failed` by the orchestrator — runner slowness, not a test failure (shard 1 takes 35-37 min on other PRs).

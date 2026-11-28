# Code story — worfy-polish 169: Ticket без строки «Blocked by:» не считается свободным в Wave worfy

Kind: pr · Epic: worfy-polish · Ticket: 169 · PR: - · Language: ru

## 1. Что было не так

`ownProblem` в `src/shared/workflow/waves.ts` считал дефектом только строку `Blocked by:`, которая есть, но не
читается. Ticket, у которого строки нет вовсе (`blockedParsed: false`, `blockedRaw: null`), проходил как Ticket без
блокеров и попадал в ближайшую Wave worfy. Harness (`epic-status`, `wave-brief`) и кнопка Ship ticket такой Ticket
не берут, так что две Wave расходились. Сегодня без строки были worfy-product-session 28, 30 и 31.

- Требование: [Что происходит](../issues/169-тикет-без-blocked-by-не-свободен.md#что-происходит)

## 2. Нет строки — тот же дефект, что нечитаемая строка

Code: `src/shared/workflow/waves.ts:135-136` · key lines: 136

```ts
function ownProblem(ticket: WaveTicket, tickets: Map<number, WaveTicket>, cycleOf: Map<number, number[]>): Problem | null {
  if (!ticket.blockedParsed) return { kind: 'unparsed', raw: ticket.blockedRaw }
```

- Что делает: любой Ticket с `blockedParsed: false` получает уровень `unparsed`; у Ticket-а без строки `raw` — `null`.
  `readyWave` кладёт его в `waiting` (у `open`) и не кладёт в `skipped` (у `blocked` и без статуса), `waveNumbers` не
  даёт ему номера, `ticketLevels` — уровня.
- Почему здесь: Ticket называет `ownProblem` (`waves.ts:128-136`) и `Level`. Отдельный `kind` не заведён: Ticket
  разрешает «`unparsed` с понятным текстом», а тип `unparsed` уже допускал `raw: null`.
- Без него: worfy ставит Ticket без строки в Wave, которую Harness не запустит.
- Требование: [Что строить, п. 1](../issues/169-тикет-без-blocked-by-не-свободен.md#что-строить)
- Риски и пробелы test-ов: Ticket-ы, которым раньше хватало отсутствия строки, теперь стоят в «Needs attention»;
  `grep -L '^Blocked by:'` по `.scratch/*/issues` после правки находит только завершённый worfy-throughput 30 и
  `worfy-harness/issues/brief-52-plain-session.md` (не Ticket).

## 3. Текст, который видит человек

Code: `src/shared/workflow/waves.ts:26-27` · key lines: 27

```ts
/** What a person reads for an `unparsed` Level: the value that is not a list, or the missing line. */
export const unparsedText = (raw: string | null): string => (raw === null ? 'no “Blocked by:” line' : `“Blocked by: ${raw}” is not a list of tickets`)
```

- Что делает: одна функция текста для `unparsed`. Без строки — «no “Blocked by:” line»; с нечитаемой строкой — прежний
  текст. Её зовут строка карточки Ticket-а (`attentionText`, `src/renderer/canvas/ticket-card.ts:405`) и причина
  неактивной кнопки Ship ticket (`src/shared/actions/render-template.ts:163`); раньше обе писали
  «“Blocked by: ” is not a list of tickets».
- Почему здесь: Ticket: «Текст, который видит человек, называет, чего не хватает». `render-template.ts:163` Ticket
  называет «для сверки, не менять без нужды»; нужда — тот же непонятный текст у кнопки.
- Без него: карточка в «Needs attention» показала бы пустые кавычки.
- Требование: [Что строить, п. 1](../issues/169-тикет-без-blocked-by-не-свободен.md#что-строить)
- Риски и пробелы test-ов: вид карточки в окне не снят — GUI-проверки не мои (бриф, без Electron).

## 4. Рамка Epic-а на холсте читает так же

Code: `src/renderer/canvas/epic-layout.ts:170-175` · key lines: 171

```ts
  for (const t of remaining) {
    if (!t.blockedParsed) own.set(t.num, { kind: 'unparsed', raw: t.blockedRaw })
    else {
      const missing = t.blockedNums.filter((blocker) => !all.has(blocker))
      if (missing.length) own.set(t.num, { kind: 'missing-blocker', missing })
    }
```

- Что делает: раскладка колонок рамки Epic-а повторяла то же условие `blockedRaw !== null`; теперь Ticket без строки
  стоит в колонке «Needs attention», а не в Level 1.
- Почему здесь: бриф велит найти всё, что показывает `unparsed` человеку (`grep 'unparsed'` по `src/renderer` и
  `src/shared`); это второе место с тем же условием.
- Без него: Wave и холст расходились бы уже внутри worfy.
- Требование: [Готово, когда, п. 1](../issues/169-тикет-без-blocked-by-не-свободен.md#готово-когда)
- Риски и пробелы test-ов: синтетический граф ниже в той же функции (`blockedParsed: true, blockedRaw: null`) не
  задет: у него `blockedParsed` истинно.

## 5. Test: красный до правки

Code: `test/unit/waves.test.ts:265-272` · key lines: 267, 268, 269, 270

```ts
  it('keeps a Ticket with no "Blocked by" line out of the Wave, open or blocked, as the Harness does (worfy-polish 169)', () => {
    const noLine = { blockedParsed: false, blockedRaw: null, blockedNums: [] }
    const wave = readyWave([ticket(1, noLine), ticket(2, { ...noLine, state: 'blocked', statusRaw: 'blocked' }), ticket(3)])
    expect(wave.ready.map((r) => r.num)).toEqual([3])
    expect(wave.waiting).toEqual([{ num: 1, reason: { kind: 'unparsed', raw: null } }])
    expect(wave.skipped).toEqual([])
    expect(Object.fromEntries(waveNumbers([ticket(1, noLine), ticket(3)]))).toEqual({ 3: 1 })
  })
```

- Что делает: открытый Ticket без строки ждёт с причиной `unparsed`, `raw: null`; заблокированный не попадает в
  `skipped`; номер Wave получает только Ticket со строкой. Рядом — test `ticketLevels` (уровень `unparsed` и
  `after-problem` у зависимого), test раскладки (`test/unit/epic-layout.test.ts:365`, «Needs attention» и текст
  карточки) и строка в `test/unit/launch.test.ts` (причина кнопки).
- Почему здесь: Ticket называет `test/unit/waves.test.ts`.
- Без него: условие `blockedRaw !== null` можно вернуть незаметно.
- Требование: [Что строить, п. 2](../issues/169-тикет-без-blocked-by-не-свободен.md#что-строить)
- Риски и пробелы test-ов: все четыре новые проверки были красными до правки (`pnpm test` трёх файлов — exit 1).

## 6. Строки «Blocked by:» у worfy-product-session 28, 30 и 31

Code: `.scratch/worfy-product-session/issues/28-сообщение-в-очереди-видно-в-чате.md:8-9` · key lines: 9

```md
Branch: worfy-product-session/28
Blocked by: None — can start immediately
```

- Что делает: у 28, 30 и 31 в шапке после `Branch:` стоит `Blocked by: None — can start immediately`; `epic-status
  --json` читает у всех трёх `blockedParsed: true`, `blockedNums: []`.
- Почему здесь: в `spec.md` Epic-а этих Ticket-ов нет: раздел «Ticket-ы» кончается на 21, таблица «Волны» — на 18.
  Строки `Blocked by:` в истории файлов не было никогда. Ticket для этого случая велит `None` и строку в «Итог».
- Без него: worfy после правки поставил бы три Ticket-а в «Needs attention».
- Требование: [Что строить, п. 3](../issues/169-тикет-без-blocked-by-не-свободен.md#что-строить)
- Риски и пробелы test-ов: зависимости этих трёх Ticket-ов не записаны нигде; все три уже влиты и ждут взгляда
  владельца, так что Wave они не меняют.

## 7. Что сознательно не меняли

Новый `kind` в `Level`, `WaitReason` и `Attention` не заводили. Harness (`harness/bin/epic-status`) не трогали: он
уже не считает Ticket без строки свободным. Страницы `docs/features/workflow.md` и `epic-frames.md` (и их `ru/`)
теперь называют отсутствие строки среди причин «Needs attention» и условий Wave.

## 8. Как проверено

До правки четыре новые проверки красные (`pnpm test` по `waves`, `epic-layout`, `launch` — exit 1), после — exit 0.
`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0. e2e и Electron локально не запускали.

## Проверить себя

1. Почему Ticket без строки «Blocked by:» нельзя считать Ticket-ом без блокеров?
   - Ответ: «нет блокеров» пишут явно (`None`); строки нет — значит, никто не решил, и Harness такой Ticket не берёт.
     worfy, взяв его, разошёлся бы с Wave Harness-а.
   - Строки: `src/shared/workflow/waves.ts:136`
2. Почему заблокированный Ticket без строки не попадает в `skipped`?
   - Ответ: `skipped` берёт только Ticket без своего дефекта (или с циклом); `unparsed` — дефект.
   - Строки: `test/unit/waves.test.ts:270`
3. Где ещё было то же условие, и что случилось бы, оставь его?
   - Ответ: в раскладке рамки Epic-а; Ticket стоял бы в Level 1 на холсте, хотя Wave его не берёт.
   - Строки: `src/renderer/canvas/epic-layout.ts:171`

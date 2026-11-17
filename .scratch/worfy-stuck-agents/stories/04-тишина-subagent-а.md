# Code story — worfy-stuck-agents 04: Тишина Subagent-а: `quiet N min` на Subagent Node и в rail-е

Kind: pr · Epic: worfy-stuck-agents · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

Subagent без записи о конце оставался `running`, сколько бы его файл `agent-<agentId>.jsonl` ни стоял. Node и rail
показывали только статус и время работы, и молчащий час background implementer выглядел так же, как работающий. Время
изменения файла в данные дерева не попадало.

- Требование: [Что происходит](../issues/04-тишина-subagent-а.md#что-происходит)

## 2. Чтение: время последнего изменения файла Subagent-а

Code: `src/main/claude-home/subagents.ts:307-310` · key lines: 309, 310

```ts
    const file = extendSubagentFile({ ...known.file, meta: emptySubagentFile(agentId, meta).meta }, read.lines)
    // When it last changed — the later of its mtime and its last record's time — tells a quiet Subagent (worfy-stuck-agents ticket 04).
    const changedAt = Math.max(await modifiedAt(path), file.lastAt ?? Number.NEGATIVE_INFINITY)
    known.file = Number.isFinite(changedAt) ? { ...file, changedAt } : file
```

- Что делает: при каждом чтении transcript-а Subagent-а `SubagentReader` берёт `stat` файла и кладёт в `changedAt` позднее
  из mtime и времени последней записи. Файл только читается: `stat`, без записи.
- Почему здесь: Ticket называет `src/main/claude-home/subagents.ts` и правило «mtime или последняя строка — что позже»
  ([Что делаем, п. 1](../issues/04-тишина-subagent-а.md#что-делаем)); почему берётся позднее из двух, не записано.
- Без него: дереву не от чего считать тишину — время последней записи меняется только с новой строкой с `timestamp`.
- Требование: [Что делаем, п. 1](../issues/04-тишина-subagent-а.md#что-делаем)
- Риски и пробелы test-ов: `stat` идёт на каждом опросе (раз в 2 с, пока Subagent работает) — по одному на файл. Если файл
  исчез между чтением и `stat`, остаётся время последней записи. Mtime файла на Linked machine считается на её часах,
  а `now` — на часах окна; расхождение часов сдвигает пометку, test-а на это нет.

## 3. Поле в схеме: необязательное, ради Linked machine

Code: `src/shared/transcript/subagents.ts:103-108` · key lines: 108

```ts
  /**
   * When its transcript last changed, ms since the epoch: the later of the file's mtime and its last record's time
   * (src/main/claude-home/subagents.ts; worfy-stuck-agents ticket 04). Left out when main did not read the file, and
   * by a build before that ticket (a Linked machine's answer).
   */
  changedAt: time.optional(),
```

- Что делает: `subagentFileSchema` принимает `changedAt`, но не требует его; дерево переносит его в `SubagentInfo` только
  когда оно число.
- Почему здесь: схема ответа `claudeHome.subagents` строится из этой; старая сборка на Linked machine присылает ответ без
  поля, и обязательное поле отвергло бы весь ответ (так же устроены `processStartedAt` и
  `test/contract/subagents-answer-before-0085.ts`).
- Без него: окно новой сборки не показало бы дерево Subagent-ов Linked machine со старой сборкой.
- Требование: [Что делаем, п. 1](../issues/04-тишина-subagent-а.md#что-делаем)
- Риски и пробелы test-ов: отдельного contract test-а «старый ответ без `changedAt`» нет; на Linked machine со старой
  сборкой пометки просто не будет.

## 4. Чистое правило тишины и текст пометки

Code: `src/shared/transcript/subagents.ts:803-813` · key lines: 804, 806, 812

```ts
export function subagentQuietFor(info: Pick<SubagentInfo, 'status' | 'changedAt'>, now: number, thresholdMs: number = QUIET_MARK_MS): number | null {
  if (info.status !== 'running' || info.changedAt === undefined) return null
  const quiet = now - info.changedAt
  return quiet >= thresholdMs ? quiet : null
}

/** The mark of a quiet Subagent, `quiet 21 min` (whole minutes, rounded down); null when it is not quiet. */
export function subagentQuietLabel(info: Pick<SubagentInfo, 'status' | 'changedAt'>, now: number): string | null {
  const quiet = subagentQuietFor(info, now)
  return quiet === null ? null : `quiet ${Math.floor(quiet / 60_000)} min`
}
```

- Что делает: тишина — `now − changedAt`, только у `running` и только от порога `QUIET_MARK_MS` (10 минут) из
  `src/shared/agent/quiet.ts`; у Subagent-а без `changedAt` пометки нет. Минуты округляются вниз.
- Почему здесь: Ticket просит чистую функцию в `src/shared/transcript/subagents.ts` с тем же порогом, что у Ticket-а 03
  ([Что делаем, п. 2](../issues/04-тишина-subagent-а.md#что-делаем)).
- Без него: Node и rail считали бы тишину каждый по-своему.
- Требование: [Что делаем, п. 2](../issues/04-тишина-subagent-а.md#что-делаем), [Решено без владельца, 9](../spec.md#решено-без-владельца)
- Риски и пробелы test-ов: Subagent Codex и Subagent, известный только по вызову, без файла — пометки нет, это проверено.
  Статус не меняется: тишина — пометка, `running` остаётся.

## 5. Node и rail: пометка после времени

Code: `src/renderer/canvas/nodes/SubagentNode.tsx:74-78` · key lines: 76, 77

```tsx
/** The status with its time, and `· quiet N min` while its file has not changed for 10 minutes (worfy-stuck-agents ticket 04). */
const withQuiet = (agent: SubagentSummary, now: number): string => {
  const quiet = subagentQuietLabel(agent, now)
  return quiet === null ? statusLabel(agent, now) : `${statusLabel(agent, now)} · ${quiet}`
}
```

- Что делает: chip статуса Node показывает `running 52m 00s · quiet 21 min`; rail
  (`src/renderer/session/rail/SubagentsRail.tsx`) — то же своей копией этой функции. Время идёт от того же `useTick`,
  что и время работы, поэтому пометка растёт каждую секунду без нового чтения файлов.
- Почему здесь: Ticket называет оба файла ([Что делаем, п. 3](../issues/04-тишина-subagent-а.md#что-делаем)).
  `statusLabel` лежит в `src/renderer/claude-home/subagents.ts`, которого нет в списке файлов Ticket-а, поэтому пометка
  дописывается в двух местах, а не там.
- Без него: тишина считалась бы, но не была бы видна.
- Требование: [Что делаем, п. 3 и 4](../issues/04-тишина-subagent-а.md#что-делаем)
- Риски и пробелы test-ов: макет spec-а пишет `running 52 min`, а время работы выводится как раньше — `52m 00s`; формат
  времени Ticket не меняет. Две копии `withQuiet` могут разойтись — их держат одни и те же ожидаемые строки в
  `test/unit/subagent-nodes.test.tsx`.

## 6. Что сознательно не меняли

Статус `running` не меняется: тишина файла ничего не говорит наверняка, это пометка. Subagent-ы Codex
(`src/main/vendors/codex/subagents.ts`) и схема дерева Codex в `src/shared/ipc/claude-home.ts` не тронуты: у них нет файла.
Тишина хода Session (chip, hint line) — Ticket 06. Перевод `docs/features/ru/sessions.md` — Ticket 10.

## 7. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` — exit 0. Новые test-ы были красными до кода: `test/unit/subagents.test.ts`
(правило 21 / 9 минут / `done`, чтение `changedAt` из временной Claude home и снимок, что она не изменилась),
`test/unit/subagent-nodes.test.tsx` (Node и rail), `test/unit/subagent-trees.test.tsx` (поле доходит до дерева в renderer-е).

## Проверить себя

1. Почему у Subagent-а Codex никогда не бывает пометки `quiet`, хотя правило в `subagentQuietFor` не смотрит на Vendor?
   - Ответ: правило требует `changedAt`, а его даёт только `SubagentReader` из файла `agent-<id>.jsonl`; дерево Codex
     строится без файла, и поля у его Subagent-ов нет.
   - Строки: `src/shared/transcript/subagents.ts:804-804`
2. Файл Subagent-а дописан, но последняя строка ещё не закончена переводом строки. Сбросится ли пометка?
   - Ответ: да — `changedAt` берёт mtime файла, а не только время последней прочитанной записи, и дописанный кусок
     сдвигает mtime.
   - Строки: `src/main/claude-home/subagents.ts:309-309`
3. Почему `changedAt` в схеме необязательное, а не `number | null`, как `lastAt`?
   - Ответ: ответ старой сборки Linked machine не несёт поля, и обязательное поле отвергло бы весь ответ; без поля
     пометки просто нет.
   - Строки: `src/shared/transcript/subagents.ts:108-108`

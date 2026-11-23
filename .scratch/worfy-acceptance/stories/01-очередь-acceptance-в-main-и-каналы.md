# Code story — worfy-acceptance 01: Очередь Acceptance в main и каналы: правило «ждёт владельца», группы, хранилище «Sent», `acceptance.get` и `acceptance.changed`

Kind: pr · Epic: worfy-acceptance · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Списка «что ждёт владельца по всем Project-ам» не было нигде. Ручной пункт и его состояние уже были в модели
Project-а, а правило «Ticket ждёт владельца» жило только в очереди Autopilot, в функции `ownersOwn`, которая не
экспортировалась. Отправленное решение владельца нигде не помнилось до прихода строки `owner-check`.

- Требование: [Что происходит](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-происходит)

## 2. Одно правило «ждёт владельца» на две очереди

Code: `src/shared/autopilot/epic-queue.ts:41-42` · key lines: 41

```ts
export const ownersOwn = (ticket: Pick<Ticket, 'state'> & Partial<Pick<Ticket, 'waits'>>): boolean =>
  ticket.state === 'none' || (ticket.state === 'blocked' && ticket.waits?.trim().toLowerCase() === 'owner')
```

- Что делает: та же функция очереди Autopilot, теперь экспортированная и с узким типом входа, чтобы очередь
  Acceptance звала её на любом Ticket-е модели.
- Почему здесь: Ticket называет `src/shared/autopilot/epic-queue.ts` в своих файлах и требует общую функцию вместо
  копии.
- Без него: два правила разошлись бы при первой правке одного из них.
- Требование: [Что делаем, п. 1](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: правило считает ждущим и Ticket без статуса (`none`); на `main` таких сейчас нет, но
  такой Ticket попадёт в Waits for you.

## 3. Пункт ждёт владельца и его группа

Code: `src/shared/acceptance/queue.ts:55-63` · key lines: 56, 57, 60, 62

```ts
function groupOf(project: QueueProject, ticket: Ticket, item: EvidenceItem, options: QueueOptions): AcceptanceGroupName {
  if (item.state === 'failed') return 'failed'
  if (!merged(ticket) && !ownersOwn(ticket)) return 'work'
  if (merged(ticket)) {
    const closed = statusTime(ticket.statusAt)
    if (closed !== null && options.now - closed > OLDER_AFTER_DAYS * DAY_MS) return 'older'
  }
  return options.inStable?.(project.projectId, ticket) === false ? 'update' : 'ready'
}
```

- Что делает: ждущий пункт (ручной, без `[x]`, не `verified`) уходит в Failed, если его последняя строка Evidence —
  `fail`; в In work, если изменение не влито и Ticket сам не ждёт владельца; в Older, если Ticket закрыт больше 14
  дней назад; в Update first, если ответ про Stable copy — «нет»; иначе в Ready to check.
- Почему здесь: Ticket называет `src/shared/acceptance/queue.ts`; порог 14 дней — Q1 spec-а. «Влит» читается из
  модели без gh: модель читается из main-ветки Project-а (ADR-0107), Ticket `done` там и не только в своей ветке.
- Без него: владелец видел бы пункты невлитых Ticket-ов среди готовых к проверке, а 93 октябрьских пункта — вперемешку
  с новыми.
- Требование: [Что делаем, п. 1](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: Ticket, чей PR уже влит, но статус ещё не `done`, стоит в In work до docs PR, который
  отмечает его `done`. Ответ про Stable copy пока не даёт никто: Update first пуста до Ticket-а 02.

## 4. Служба считает очередь только по изменению модели

Code: `src/main/acceptance/service.ts:220-225` · key lines: 221, 224

```ts
      send: () =>
        void this.sources.hub.model(entry.root).then((model) => {
          if (!current() || model === null) return
          entry.model = model
          this.compute()
        }),
```

- Что делает: hub шлёт изменение Ticket-файлов; служба берёт его модель целиком, уже с изменением, и считает очередь
  заново; подписчики получают `acceptance.changed`, только если очередь стала другой.
- Почему здесь: Ticket требует службу поверх workflow hub, как `installWaitsNotifications`, без gh и git.
- Без него: правка Ticket-файла не доходила бы до окна; contract test «an edit of a Ticket file gives
  acceptance.changed» красный (mutant M13).
- Требование: [Что делаем, п. 2](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: подписчик hub-а — `fieldsOnly`: правка, меняющая только текст Ticket-а вне его полей, очередь
  не пересчитывает, и её не нужно пересчитывать.

## 5. «Sent» уходит только с новой строкой того же вердикта

Code: `src/main/acceptance/service.ts:74-79` · key lines: 78

```ts
function settled(model: WorkflowModel, decision: SentDecision): boolean {
  const ticket = model.tickets.find((each) => each.epic === decision.epic && each.num === decision.num)
  if (ticket === undefined) return false
  const item = itemOf(ticket, decision)
  return item === null || !itemWaitsForOwner(item) || ownerLines(item, decision.verdict) > decision.lines
}
```

- Что делает: запись «Sent» помнит, сколько строк `owner-check` с её вердиктом было у пункта при отправке, и уходит,
  когда их стало больше; ещё — когда пункт исчез, переписан или больше не ждёт владельца.
- Почему здесь: правило записано в Ticket-е («запись уходит, когда в checkout-е появилась строка `owner-check` с тем
  же вердиктом»); счёт строк при отправке — решение без владельца: иначе повторный Fail на уже проваленном пункте
  снимался бы старой строкой сразу.
- Без него: отметка «Sent» не уходила бы никогда (mutant M15) или уходила бы от старой строки (mutant M14).
- Требование: [Что делаем, п. 3](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: Ticket, которого нет в модели, свои записи держит; если Ticket удалён навсегда, запись
  остаётся в файле без вреда.

## 6. Как проверено

`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `node scripts/check-feature-docs.mjs` — exit 0; gate fast — exit
0. Mutants по одному на поведение в копии под `mktemp -d`, каждый красный на своём test-е.

## Проверить себя

1. Почему Ticket `done` только в своей ветке стоит в In work, а не в Ready to check?
   - Ответ: «влит» — это `done` в checkout-е main-ветки; `done` только в ветке значит, что PR ещё не влит, и смотреть
     в Stable copy нечего.
   - Строки: `src/shared/acceptance/queue.ts:57`
2. Владелец второй раз шлёт Fail на пункт, у которого уже есть строка `owner-check fail`. Когда уйдёт «Sent»?
   - Ответ: когда у пункта станет больше строк `owner-check fail`, чем было при отправке, то есть с новой строкой.
   - Строки: `src/main/acceptance/service.ts:78`

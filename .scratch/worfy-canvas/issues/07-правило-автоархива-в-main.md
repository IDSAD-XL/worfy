# 07 — Правило автоархива в main: поле `archived` в Layout, исключения, возврат продолженной Session

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), решения владельца 4–6;
[ADR-0076](../../../docs/adr/0076-auto-archive-of-finished-sessions.md) (автоархив законченных Session-ов),
пункты 1–4, 6 и 10; исследование
[2026-10-19-организация-canvas.md](../../../docs/research/2026-10-19-организация-canvas.md), P2. Код
перечитан по main `7dab925f`.

## Что происходит

- Session Node остаётся на Canvas навсегда (`src/renderer/canvas/overlays/SessionNodes.tsx:1-5`); план
  Node-ов — `planSessionNodes` (`src/renderer/claude-home/session-nodes.ts:229`).
- Main знает живые Session-ы: `liveSessionListeners` (`src/main/ipc/claude-home.ts:39`), подключение в
  `src/main/index.ts:134`. Транскрипт даёт `lastAt` (`src/shared/ipc/claude-home.ts:37-52`).
- Node Layout-а — `layoutNodeSchema` (`src/shared/layout/types.ts:40-58`), операции — `:93-131`; main
  применяет их в `LayoutStore.apply` (`src/main/layout/store.ts:228`). Поля архива нет.
- «На плоскости» — `onThePlane` (`src/shared/layout/derived.ts:38`): не `pinned`, не `hidden`, не
  производный вид.

## Что делаем

1. **Поля Node-а** (`types.ts`): `archived: { at, rule: 'idle' | 'ticket-done', batch } | null`,
   `keep: boolean`, `touchedAt: number | null`; все по умолчанию пустые — старый `layout.json` читается.
2. **Операции:** `archive` (список id, `rule`, `batch`), `restore` (список id), `keep` (id, да/нет),
   `touch` (id). Main ставит `touchedAt` на каждой операции пользователя над Node-ом (`move`, `resize`,
   `pin`, `tag`, `patchData`, `hide`, `keep`) и на `touch`.
3. **`onThePlane`** не считает архивный Node: его не рисует Canvas, его обходят рамки и `freePlace`.
4. **Правило** — `src/main/layout/archive.ts` (новый), чистая функция `archiveCandidates(nodes, live,
   history, workflow, bindings, now, settings)` по ADR-0076, пункты 1–2:
   - кандидат — Node вида `session`, Session не живая, и простой от `lastAt` больше порога или Ticket
     done и с `lastAt` прошёл 1 ч;
   - никогда — живая, `unknown`, `pinned`, `keep`, тронутая меньше порога назад; Node вида `orchestrator`
     правило не видит.
5. **Таймер** в main: при старте и раз в 10 минут, по Project-ам этой Machine. Одна партия — одна
   операция `archive` с новым `batch`, мимо ⌘Z (ADR-0016). Порог берётся из функции настроек; пока
   настройки нет (Ticket 08), значение — «Never»: таймер идёт, но ничего не архивирует (ADR-0076,
   пункт 10).
6. **Возврат продолженной Session.** Session снова в реестре живых — main снимает `archived` (операция
   `restore`, мимо ⌘Z). Node встаёт на прежнее место, если оно свободно, иначе — `freePlace` (ADR-0038).
7. **Renderer.** `planSessionNodes` не создаёт Node заново для Session, чей Node в архиве.
   Открытие Session view (`openSession`, `src/renderer/session/navigation.ts:33`) шлёт `touch`.

## Готово, когда

- [ ] Unit `test/unit/archive-rule.test.ts`: кандидат по простою и по «Ticket done + 1 ч»; по test-у на
      каждое исключение — живая, `unknown`, `pinned`, `keep`, Orchestrator, тронутая меньше порога назад;
      «Never» — пусто.
- [ ] Contract `test/contract/layout-archive.test.ts`: `archive` и `restore` через `LayoutStore`;
      архивный Node не на плоскости; старый `layout.json` без новых полей читается; продолженная Session
      возвращается на прежнее место или на свободное; гонка — Session ожила между чтением реестра и
      записью партии — Node не остаётся в архиве; два окна одного Project-а — одна партия (архив делает
      main, не окно); операции таймера не попадают в историю ⌘Z окна.
- [ ] Unit `test/unit/session-nodes.test.tsx`: архивный Node не создаётся заново; `openSession` шлёт
      `touch`.
- [ ] Read-only экран Linked machine (ADR-0066) получает Layout с архивными Node-ами без ошибок (contract).
- [ ] Мутанты красные: `unknown` считается не живой; `keep` не проверяется; архив через `hidden`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающие: unit `archive-rule.test.ts` на исключения.
- Unit `test/unit/archive-rule.test.ts` (новый), `test/unit/session-nodes.test.tsx`; contract
  `test/contract/layout-archive.test.ts` (новый).

## Где в коде

- `src/shared/layout/types.ts` (`layoutNodeSchema` `:40-58`, операции `:93-131`)
- `src/shared/layout/derived.ts` (`onThePlane` `:38`)
- `src/main/layout/store.ts` (`apply` `:228`)
- `src/main/layout/archive.ts` (новый)
- `src/main/index.ts` (`:134`)
- `src/main/ipc/claude-home.ts` (`liveSessionListeners` `:39`)
- `src/renderer/claude-home/session-nodes.ts` (`planSessionNodes` `:229`)
- `src/renderer/session/navigation.ts` (`openSession` `:33`)
- `test/unit/archive-rule.test.ts` (новый)
- `test/contract/layout-archive.test.ts` (новый)
- `test/unit/session-nodes.test.tsx`

Только чтение: `src/main/claude-home/registry.ts` (его меняет PR #525 `worfy-windows/14`),
`src/shared/binding/resolve.ts`, `src/main/layout/bindings.ts`, `src/main/claude-home/binding-signals.ts`,
`src/shared/layout/free-place.ts` (`freePlace` `:350`).

## Вне скоупа

- Настройка порога, команда «Archive finished sessions now», кнопка Keep — Ticket 08.
- История у Ticket-а и Epic-а, popover «Archive» — Ticket 09.
- Toast с Undo и порог 24 h по умолчанию — Ticket 10.

## Итог

Заполняется при закрытии.

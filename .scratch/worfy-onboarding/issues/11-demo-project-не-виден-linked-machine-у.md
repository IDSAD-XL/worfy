# 11 — Project `localOnly`: Demo project не виден Linked machine-у

Type: task
Status: done 2026-10-28T06:22Z
PR: #859
Branch: worfy-onboarding/11
Blocked by: —
Source: решения владельца 2026-10-26, пункт 8 (Demo project только локальный и никогда не предлагается Linked machine-у); [spec.md](../spec.md), «Как устроено», «Linked machine»; [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (Linked machine работает только внутри Project-ов этой Machine)

## Что происходит

- Строка списка Project-ов — `{ id, name, path }` (`src/main/projects/store.ts:19-23`); список и
  активный Project — `projects.json` в папке данных. Пометки «только для этой Machine» нет.
- Linked machine видит Project-ы так:
  - `projects.list` отдаёт `store.state()` любому вызывающему (`src/main/ipc/projects.ts:230`);
  - каждое изменение списка уходит всем клиентам, клиенты связи тоже (`projects.ts:200-207`,
    `toEveryWindow`, `src/main/broadcast.ts:29`).
- Вызов Linked machine-а с путём проверяют `insideProjects` и `projectRootOf`
  (`src/main/link/caller.ts:101-127`) по списку Project-ов; вызов из окна этой Machine проходит без
  проверки (`isRemoteCall`, `:19-24`).
- Каналы с `projectId` (например `layout.get`, `src/main/ipc/layout.ts:39`) Project по списку не
  сверяют. Все вызовы связи проходят через `call` адаптера (`src/main/link/ipc-adapter.ts:220`): там
  уже стоят отказы по доступу до разбора входа.
- Demo project создаёт Ticket 05; ему нужна эта пометка при `ProjectStore.add`.

## Что делаем

1. `storedProjectSchema` получает `localOnly?: true`; `ProjectStore.add(folder, { localOnly })`
   (`store.ts:262`) пишет его. Старый `projects.json` читается как раньше.
2. Для вызова не из окна этой Machine Project с `localOnly` не существует:
   - `projects.list` и `projects.changed` клиенту связи — без него (и `activeId`, если активный —
     он: тогда `null` или первый из оставшихся, как при удалении);
   - `insideProjects` и `projectRootOf` не считают его корень Project-ом;
   - `call` адаптера связи отказывает до handler-а, если во входе `projectId` Project-а с `localOnly`
     или путь внутри его корня: «<name> is local to this Machine».
3. При claim — проверить события Project-а (`agent.event`, `layout.changed` и подобные) к клиенту связи:
   если они несут `projectId`, `LinkSender.send` (`ipc-adapter.ts:84`, `send` `:102`) не шлёт события Project-а с
   `localOnly`. Что проверено — в «Итог».

## Готово, когда

- [ ] Contract test через адаптер связи (`createLinkIpc` + `LinkPeer`, стенд
      `test/contract/link-bench.ts`), доступ включён: `projects.list` — без Project-а `localOnly`, с
      обычным; `projects.changed` после `add` с `localOnly` клиенту связи — без него, окну — с ним.
- [ ] `layout.get` с `projectId` Project-а `localOnly` с Linked machine-а — отказ, handler не вызван.
- [ ] `insideProjects` для пути внутри Project-а `localOnly` с вызова связи — отказ; из окна — путь как
      есть (unit test).
- [ ] Старый `projects.json` без поля читается; `add` без опции поля не пишет.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Contract `test/contract/projects.test.ts` (список и рассылка через адаптер связи, отказ по
  `projectId`).
- Unit `test/unit/link-caller-local-only.test.ts` (новый): `insideProjects`, `projectRootOf`.
- Сначала падающий: `projects.list` с Linked machine-а видит Project с `localOnly`.

## Где в коде

- `src/main/projects/store.ts` (`:19-23`, `add` `:262`)
- `src/main/link/caller.ts` (`:101-127`)
- `src/main/link/ipc-adapter.ts` (`LinkSender` `:84`, `send` `:102`; `call` `:220`)
- `src/main/ipc/projects.ts` (`:200-207`, `:230`)
- `test/contract/projects.test.ts`
- `test/unit/link-caller-local-only.test.ts` (новый)

Только читать: `src/main/broadcast.ts`, `src/main/clients.ts`, `test/contract/link-bench.ts`.

## Итог

- PR #859, влит 2026-10-27. Project, добавленный с `localOnly` (`ProjectStore.add(folder, { localOnly })`,
  `src/main/projects/store.ts`), Linked machine не видит: `projects.*` отдают ей список без него, broadcast
  `projects.changed` уходит ей отфильтрованным. `src/main/link/caller.ts` (`localProjectIn`) находит такой Project
  по `projectId`, `id` на канале `projects.*`, пути внутри его корня (в том числе относительному) или `sessionId`
  его Session; `src/main/link/ipc-adapter.ts` отказывает в вызове до handler-а («<name> is local to this Machine»),
  `LinkSender.send` не передаёт его события. Отдельный круг на Windows поправил только test: Win32 отбрасывает
  `..` как текст до перехода по ссылке.
- Долг (low, из VERIFIED-комментария): adapter не проверяет `draft.gate[].match` у `projects.connect.write` —
  общий Project из нескольких репозиториев мог бы назвать папку Demo репозиторием, и `checks.repos`
  (`src/main/ipc/checks.ts:132-137`) вернул бы её имя и путь (по коду, не запускалось); `test/contract/projects.test.ts`
  длиннее 1000 строк (1022).

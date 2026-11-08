# 05 — Watcher `docs/product/` и канал `product.changed`

Type: task
Status: open
Blocked by: 03
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 5 (экран перерисовывается сразу); «Как работает» → «Живая перерисовка»; «Риски», п. 4; research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), раздел 3.3

Платформенный Ticket: `fs.watch` на Windows ведёт себя иначе (удалённая папка, ссылки); Windows verdict до merge
(ADR-0056). Глубина ревью — `medium`.

## Что происходит

- Watcher документов держит один рекурсивный `fs.watch` корня Project-а (`src/main/docs/watch.ts:183-184`), но читает
  только `HANDOFF.md` и `docs/adr/NNNN-*.md` (`isDocument`, `:54-57`); чтение вне них отклоняет (`:91`), прочие события
  отбрасывает по имени до чтения (`:342-352`). Debounce — 50 мс (`:433`). Один watcher на Project — `DocsHub` (`:482`).
- Событие в renderer — `docs.changed` (`src/shared/ipc/docs.ts:73`), подписка — `src/renderer/docs/useDocs.ts`.
- На Windows `fs.watch` удалённой папки шлёт бесконечные события; обход — `src/main/watch-gone.ts:5-9`.

## Что делаем

1. Watcher документов пропускает пути папки Product Session (Full mode — `docs/product/**`; Silent mode — папка из
   `paths.ts` Ticket-а 03, отдельный watch, если она вне корня).
2. Канал `product.changed` (`src/shared/ipc/product.ts`, класс `project`, `read`): тема, которая поменялась, и её
   состояние из `topic.ts`. Канал `product.topic` (invoke) — прочитать тему по запросу.
3. `src/renderer/product/useMindMap.ts` — подписка: тема на экране обновляется без перезагрузки.
4. `docs.changed` для HANDOFF и ADR не меняется.

## Готово, когда

- [ ] Contract test: запись `docs/product/t/mind-map.json` — событие `product.changed` с темой `t` в пределах
      debounce; запись `src/a.ts` — события нет.
  - evidence: test-run pass · `pnpm test test/contract/product-watch.test.ts test/contract/docs.test.ts` exit 0 · mac - · 5431f926637b1595820008593e6bf7acf9691fd1
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/product-watch.test.ts test/contract/docs.test.ts test/contract/docs-watch-root.test.ts` exit 0 · mac - · 79929984cebab32b5262882320867def4ba57a90
- [ ] Test: две записи одного файла за 50 мс — последнее событие несёт второе содержимое.
  - evidence: test-run pass · `pnpm test test/contract/product-watch.test.ts` exit 0 · mac - · 5431f926637b1595820008593e6bf7acf9691fd1
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/product-watch.test.ts test/contract/docs.test.ts test/contract/docs-watch-root.test.ts` exit 0 · mac - · 79929984cebab32b5262882320867def4ba57a90
- [ ] Test: удаление `docs/product/` целиком не даёт бесконечного потока событий (как `watch-gone`).
  - evidence: test-run pass · `pnpm test test/contract/product-watch.test.ts test/contract/docs-watch-root.test.ts` exit 0 · mac - · 5431f926637b1595820008593e6bf7acf9691fd1
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/product-watch.test.ts test/contract/docs.test.ts test/contract/docs-watch-root.test.ts` exit 0 · mac - · 79929984cebab32b5262882320867def4ba57a90
- [ ] Test-ы watcher-а на Windows — exit 0.
  - needs: windows
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).
  - evidence: gate pass · `gate fast` exit 0 · mac - · 5431f926637b1595820008593e6bf7acf9691fd1
  - evidence: gate pass · `gate fast` exit 0 · mac - · 79929984cebab32b5262882320867def4ba57a90

## Тесты

- Contract `test/contract/docs-watch-root.test.ts`, `test/contract/product-watch.test.ts` (новый).
- Сначала падающий: на `main` запись в `docs/product/` события не даёт.

## Где в коде

- `src/main/docs/watch.ts`
- `src/shared/ipc/product.ts` (новый)
- `src/main/ipc/product.ts` (новый)
- `src/renderer/product/useMindMap.ts` (новый)
- `test/contract/docs-watch-root.test.ts`
- `test/contract/product-watch.test.ts`

Только читать: `src/main/watch-gone.ts`, `src/main/link-safe-watch.ts`, `src/shared/ipc/docs.ts`,
`src/renderer/docs/useDocs.ts`, `test/unit/docs-watch-root-gone.test.ts`.

## Итог

- **Watcher** — `src/main/docs/watch.ts`. Новый watcher не заведён: тот же рекурсивный `fs.watch` корня документов
  теперь узнаёт пути папки Product Session (`productPathOf`). Папку как сегменты под корнем даёт `docsSource`
  (`src/main/ipc/docs.ts`) из `productFolder` Ticket-а 03: `docs/product` в Full mode, `product` в Silent mode (папка
  `<Workflow folder>/product` лежит под корнем документов Silent mode, отдельный watch не нужен). Событие под
  `<папка>/<тема>/…` читает эту тему через `readTopic` после той же паузы 50 мс; `critic/` и имена, которые не имя темы,
  отброшены. HANDOFF и ADR от этих событий заново не читаются, `docs.changed` не меняется.
- **Порядок чтений.** Чтения одной темы идут по одному (`TopicReads`: очередь и хвост), поэтому медленное старое чтение
  не приходит после нового; одинаковое состояние второй раз не отправляется. `product.topic` встаёт в ту же очередь —
  ответ не старее события, которое окно получило до него.
- **Удаление.** Тема без папки приходит один раз как `topic: null`. Событие самой папки Product Session, папки выше или
  корня, и возврат корня после удаления перечитывают уже известные темы. На Windows путь к теме через ссылку на другой
  host считается «нет папки», как у документов (`readProductTopic`).
- **Каналы** — `src/shared/ipc/product.ts`: `product.changed` (event) и `product.topic` (invoke), оба `project` / `read`.
  `product.changed` идёт окнам, у которых документы Project-а открыты через `docs.open` (`DocsSubscriber.sendTopic`);
  handler `product.topic` — `src/main/ipc/product.ts`.
- **Renderer** — `src/renderer/product/useMindMap.ts`: одна общая копия темы, первое чтение через `product.topic`, затем
  каждое `product.changed` этой темы; документы Project-а держит открытыми через `useDocs`.
- **Сначала падающий test**: `test/contract/product-watch.test.ts` на `watch.ts` из `main` — 8 из 9 красные.
- **Вне следа**: `src/main/ipc/docs.ts` (`docsSource`, `sendTopic`), `test/contract/docs.test.ts` (канал через IPC),
  `test/unit/link-access.test.ts` (`product.topic` в списке read-каналов), `test/unit/product-use-mind-map.test.tsx`,
  `docs/features/projects.md`.

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
- [ ] Test: две записи одного файла за 50 мс — последнее событие несёт второе содержимое.
- [ ] Test: удаление `docs/product/` целиком не даёт бесконечного потока событий (как `watch-gone`).
- [ ] Test-ы watcher-а на Windows — exit 0.
  - needs: windows
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).

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

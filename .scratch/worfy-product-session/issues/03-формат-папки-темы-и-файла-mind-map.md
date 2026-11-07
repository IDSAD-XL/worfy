# 03 — Формат папки темы и файла Mind map, ADR

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 4, 5; «Как работает» → «Папка темы и файл Mind map»; «Вопросы владельцу», Q1, Q4, Q6, Q8; карта [worfy-product](../../worfy-product/map.md), решение 09 (Q2, Q3), «Not yet specified» (формат `docs/product/` и файла Mind map)

Не платформенный Ticket: схема и чтение файлов через общие helper-ы. Глубина ревью — `medium`.

## Что происходит

- Папки `docs/product/` нет ни в одном Project-е; формата нет.
- Карта wayfinder в worfy описана разделом «Wayfinding operations» `harness/bin/TICKETS.md` (map — `map.md`, Ticket
  карты — `issues/NN-slug.md` с шапкой `Type:` / `Status:` / `Blocked by:` / `Source:`).
- Приложение уже читает H1 файла по правилу Harness-а: `firstHeading` (`src/main/workflow/reader.ts:227`), test-ы на
  fixture-ах `harness/bin/tests/fixtures/ticket-title`.
- Образец «zod-схема — публичный контракт»: `src/shared/canvas/tools.ts:1-5`, `:99-128`.

## Что делаем

1. `src/shared/product/mind-map.ts` — zod-схема `mind-map.json` по spec-у (Q1): `version: 1`, узлы `id`, `kind`,
   `text`, `from`, `status`/`reason` у Решения, `source` у Возражения, `advice`, `replaces`, `history`, `message`,
   `x`, `y`, `collapsed`. Функция `checkMindMap(value, tickets)` возвращает узлы или список ошибок с id узла:
   неизвестный `from`, цикл по `from`, `replaces` не на Решение, Решение без причины, Возражение без источника,
   два узла с одним id.
2. `src/shared/product/paths.ts` — где лежит папка Product Session: Full mode — `docs/product/`, Silent mode —
   `<Workflow folder>/product/` (Q6); темы, `critic/`, `drafts/`.
3. `src/main/product/topic.ts` — чтение темы: `map.md` (H1 и разделы карты), `issues/*.md` (номер, H1, `Status:`),
   `mind-map.json` через `checkMindMap`. Файл с ошибкой — тема с ошибками, а не исключение.
4. ADR «Папка Product Session и файл Mind map»: что лежит в `docs/product/<тема>/`, `critic/`, `drafts/`; схема
   `mind-map.json`; main — единственный писатель; кто читает (обычные Session-ы читают, не пишут — Q7). Номер
   резервирует ship-ticket.

## Готово, когда

- [ ] Unit test схемы: верный файл читается; каждая ошибка из п. 1 — свой случай с id узла в тексте.
- [ ] Test `topic.ts` на fixture-теме: `map.md`, два Ticket-а карты, `mind-map.json` с узлом `from: "ticket:02"` — тема
      собрана; битый JSON — тема с ошибкой, без исключения.
- [ ] Test путей: Full mode и Silent mode дают разные папки.
- [ ] ADR добавлен, ссылка на него — в шапке `src/shared/product/mind-map.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Unit `test/unit/product-mind-map.test.ts`, `test/unit/product-topic.test.ts` (новые), fixture
  `test/fixtures/product-topic/`.
- Сначала падающий: test схемы до появления модуля.

## Где в коде

- `src/shared/product/**` (новые: `mind-map.ts`, `paths.ts`)
- `src/main/product/topic.ts` (новый)
- `test/unit/product-mind-map.test.ts`
- `test/unit/product-topic.test.ts`
- `test/fixtures/product-topic/**`
- `docs/adr/NNNN-product-session-folder-and-mind-map.md`

Только читать: `harness/bin/TICKETS.md` («Wayfinding operations»), `src/main/workflow/reader.ts`,
`src/shared/canvas/tools.ts`, `src/main/storage/json-file.ts`.

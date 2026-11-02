# 12 — Contract test: SDK Claude только в `src/main/vendors/claude/`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Решено без владельца», п. 2, «Готово, когда»; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), «Кто идёт через driver»); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), п. 4

## Что происходит

- `@anthropic-ai/claude-agent-sdk` импортируют 15 файлов `src`: `src/main/agent/app-registry.ts`, `attachments.ts`,
  `limits-usage.ts`, `options.ts`, `session.ts`, `session/run.ts`, `session/types.ts`, `src/main/ipc/first-run.ts`,
  `src/main/ipc/projects.ts`, `src/main/mcp/browser-server.ts`, `src/main/mcp/canvas-server.ts`,
  `src/main/projects/connect.ts`, `src/main/terminal-ai/assist.ts`, `fake-backend.ts`, `options.ts`.
- Образец такого правила — `test/contract/harness-node-only.test.ts`: test обходит дерево и называет нарушителя.

## Что делаем

1. Новый `test/contract/vendor-sdk-imports.test.ts`: обходит `src/` и находит каждое упоминание
   `@anthropic-ai/claude-agent-sdk` (`import`, `import type`, `import()`, `require`, `resolve`) вне
   `src/main/vendors/claude/`.
2. Список исключений — нынешние 15 файлов, у каждого — номер Ticket-а этого Epic-а, который его уберёт (14, 15
   или 16). Файл вне списка — красный test с именем файла и строкой.
3. Исключение, которое уже не импортирует SDK, test только сообщает (не падает): его уберёт Ticket 16, который делает
   список пустым и test строгим. Так Ticket-ы 13–15 не правят этот файл.
4. Типы SDK не выходят из `src/main/vendors/claude/` и через реэкспорт: файл вне папки, который импортирует из
   `src/main/vendors/claude/` имя, объявленное в SDK (`export type { … } from '@anthropic-ai/claude-agent-sdk'`
   внутри папки), — красный test. Проверка — по тексту: в `src/main/vendors/claude/` нет `export … from
   '@anthropic-ai/claude-agent-sdk'` и `export type` с типом SDK.
5. Контрольный случай, как в `harness-node-only`: копия дерева с подложенным файлом — test красный.

## Готово, когда

- [ ] Test зелёный на нынешнем `main`.
- [ ] Контрольный случай: подложенный файл с `import type … from '@anthropic-ai/claude-agent-sdk'` вне списка —
      test красный и называет файл.
- [ ] Контрольный случай: подложенный в `src/main/vendors/claude/` реэкспорт типа SDK — test красный.
- [ ] `pnpm lint` и `pnpm test` (contract) — exit 0.

## Где в коде

- `test/contract/vendor-sdk-imports.test.ts` (новый)

Только читать: `test/contract/harness-node-only.test.ts`, `test/remove.ts`.

# 04 — Story через `oneShot` Vendor-а Project-а: схема story, progress bar, contract test «нет Session Node»

Type: feature
Status: claimed 2026-11-15T23:45Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 04; «Решения владельца» 13, 19, 23, 25 (строки 109–112, 119–120, 127,
129–131); «Решения по реализации» → worfy: «Невидимый агент», «Progress bar» (строки 256–262); «Риски»: «`oneShot` в
папке Project-а», «Codex» (строки 352–356); возражение 2 [критика](../../../docs/product/critic/worfy-code-stories-2026-11-15.md)

Кто: агент.

## Что происходит

- Невидимый агент уже есть — `oneShot` драйвера Vendor-а (`src/main/vendors/one-shot.ts`, ADR-0094, п. 2). Это разовый
  запрос, который не Session: `cwd`, `readOnlyTools`, `outputSchema`, `onActivity` (каждая строка того, что делает
  запрос) и `signal` (остановка). Новый агент и новый канал прогресса не нужны (возражение 2 критика, решение 23).
- Образец вызова — черновик профиля при подключении Project-а: `vendorDriver(<vendor>).oneShot(...)` с
  `readOnlyTools: DRAFT_TOOLS`, `onActivity` и `signal` (`src/main/projects/connect.ts:522-528`). Путь fake агента для
  e2e — `src/main/ipc/projects.ts:116-122` (`WORFY_AGENT=fake`, сценарий из `test/fixtures/agent-scripts/`).
- Read-only запрос Claude получает `allowedTools` Read, Glob, Grep, а Bash запрещён (`draftSessionOptions`,
  `src/main/vendors/claude/options.ts`). Читать git он не может, поэтому diff PR идёт в самом запросе.
- Новое — запуск в папке, которая уже Project. Черновик профиля запускается в папке, которая ещё не Project. Похожий
  служебный запрос уже давал Session Node: inventory-query MCP запускался в папке Project, Claude Code записывал его в
  `~/.claude/sessions`, и на Canvas появлялся read-only Session Node. `worfy-mcp-live` 14 (PR #1877) перенёс его в
  папку самого worfy и передал Project через `projectConfigRoot` (`src/main/vendors/claude/mcp-inventory.ts`,
  `test/contract/claude-mcp-inventory.test.ts:409-440`).
- **Codex.** Spec (строка 259) говорит, что `oneShot` есть и у Claude, и у Codex. В коде у Codex его нет:
  `src/main/vendors/codex/one-shot.ts:7` отвечает `PartNotWired`, а `src/main/vendors/codex/capabilities.ts:123,133`
  пишет «One-off requests … run on Claude Code only».

## Что делаем

1. Contract test «нет Session Node» — первым. Stand-in Claude Code ведёт себя как в
   `test/contract/claude-mcp-inventory.test.ts`: пишет `<home>/sessions/<pid>.json` со своим `cwd`. `oneShot` story
   запускается для папки внутри Project-а. Test проверяет, что Canvas не получил нового Session Node. Первый результат
   (красный или зелёный) записать в «Итог».
2. Если test красный, сначала повторить путь inventory-query: запуск вне папки Project-а, Project — через
   `projectConfigRoot` или каталог только для чтения. ADR пишется, только если и так `oneShot` использовать нельзя
   (решение 23; «Риски», строки 352–354).
3. Тонкий модуль story поверх `vendorDriver(<vendor Project-а>).oneShot`:
   - вход — текст запроса с diff PR, текстом PR, файлом Ticket-а и вердиктами (их собирают Ticket-ы 11 и 12);
   - `outputSchema` — JSON Schema story; поля — из формата Ticket-а 01 (spec, строки 195–203). Если Ticket 01 ещё не
     влит, взять поля из spec; кто вливается вторым, выравнивает схему и `TICKETS.md`;
   - `onActivity` → канал прогресса в renderer;
   - `signal` → остановка; остановленный запрос ничего не пишет.
4. Компонент progress bar на месте нажатой кнопки (spec, строка 262). Его используют Ticket-ы 11 и 12.
5. Под `WORFY_AGENT=fake` запрос играет сценарий из `test/fixtures/agent-scripts/`, как черновик профиля. Это нужно e2e
   Ticket-ов 11 и 12.
6. Codex: если `oneShot` у Codex всё ещё не подключён, на Project-е с Codex запрос не начинается. Человек видит причину
   из `capabilities` — не молчаливый сбой. Подключить `oneShot` Codex или брать для story Claude — решает владелец,
   вопрос записать в «Итог» (решение 25 говорит «на Vendor-е Project-а»).

## Готово, когда

- [ ] Contract test: `oneShot` story с папкой внутри Project-а не даёт нового Session Node на Canvas; первый результат
      test-а и выбранный путь записаны в «Итог».
- [ ] Contract test: запрос получает только Read, Glob, Grep, Bash запрещён; diff PR — в тексте запроса; `outputSchema` —
      схема story.
- [ ] Contract test: ответ, который не проходит схему, — ошибка с причиной, без падения и без записи.
- [ ] Contract test: `signal` останавливает запрос; после остановки ничего не записано, процесс Vendor-а закрыт.
- [ ] Unit test progress bar: строки `onActivity` показываются по порядку; остановка и ошибка видны на месте кнопки.
- [ ] Unit test: на Project-е с Codex без `oneShot` запрос не начинается, причина из `capabilities` показана.
- [ ] Новый ADR есть, только если test остался красным и путь inventory-query не помог; иначе ADR нет, и «Итог» это
      говорит.
- [ ] lint, typecheck, test-ы модуля `src/main/vendors/` и gate fast — exit 0.

## Тесты

- Contract test-ы `oneShot` story и unit test progress bar из пунктов выше; contract test «нет Session Node» сначала
  красный или записан как зелёный с первого запуска.

## Где в коде

- `src/main/stories/one-shot.ts` (новый)
- `src/shared/stories/schema.ts` (новый: схема story для `outputSchema`)
- `src/shared/ipc/stories.ts` (новый), `src/main/ipc/stories.ts` (новый)
- `src/renderer/stories/StoryProgress.tsx` (новый)
- `src/main/vendors/claude/one-shot.ts`, `src/main/vendors/claude/options.ts` (только если нужен запуск вне папки
  Project-а)
- `src/main/vendors/codex/capabilities.ts` (текст причины, если нужен)
- `test/contract/story-one-shot.test.ts` (новый)
- `test/unit/story-progress.test.tsx` (новый)
- `test/fixtures/agent-scripts/` (новый сценарий story)
- `docs/adr/NNNN-…` (новый, только по п. 2)

Только читать: `src/main/vendors/one-shot.ts`, `src/main/vendors/registry.ts`, `src/main/vendors/codex/one-shot.ts`,
`src/main/projects/connect.ts`, `src/main/ipc/projects.ts`, `src/main/vendors/claude/mcp-inventory.ts`,
`test/contract/claude-one-shot.test.ts`, `test/contract/claude-mcp-inventory.test.ts`.

## Вне скоупа

- Кнопки story по кнопке и вопроса к строке — Ticket-ы 11 и 12.

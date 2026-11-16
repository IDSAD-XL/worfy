# 04 — Story через `oneShot` Vendor-а Project-а: схема story, progress bar, contract test «нет Session Node»

Type: feature
Status: done 2026-11-16T02:52Z
PR: #1890
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 (first run red: live Session of the Project) · mac - · a51c424f3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 (round 2, shared fixtures) · mac - · 58bfd30676ef53338be8d38b3aa0a068141b0074
- [ ] Contract test: запрос получает только Read, Glob, Grep, Bash запрещён; diff PR — в тексте запроса; `outputSchema` —
      схема story.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 · mac - · a51c424f3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 (round 2, shared fixtures) · mac - · 58bfd30676ef53338be8d38b3aa0a068141b0074
- [ ] Contract test: ответ, который не проходит схему, — ошибка с причиной, без падения и без записи.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 · mac - · a51c424f3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 (round 2, shared fixtures) · mac - · 58bfd30676ef53338be8d38b3aa0a068141b0074
- [ ] Contract test: `signal` останавливает запрос; после остановки ничего не записано, процесс Vendor-а закрыт.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 · mac - · a51c424f3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 (round 2, shared fixtures) · mac - · 58bfd30676ef53338be8d38b3aa0a068141b0074
- [ ] Unit test progress bar: строки `onActivity` показываются по порядку; остановка и ошибка видны на месте кнопки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-progress.test.tsx` exit 0 · mac - · a51c424f3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-progress.test.tsx` exit 0 (round 2) · mac - · 58bfd30676ef53338be8d38b3aa0a068141b0074
- [ ] Unit test: на Project-е с Codex без `oneShot` запрос не начинается, причина из `capabilities` показана.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts test/unit/story-progress.test.tsx` exit 0 · mac - · a51c424f3
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts test/unit/story-progress.test.tsx` exit 0 (round 2) · mac - · 58bfd30676ef53338be8d38b3aa0a068141b0074
- [ ] Новый ADR есть, только если test остался красным и путь inventory-query не помог; иначе ADR нет, и «Итог» это
      говорит.
  - evidence: commit pass · Build a Code story through the Project Vendor oneShot, with a progress bar (no ADR: the inventory-query path worked) · - - · a51c424f3
- [ ] lint, typecheck, test-ы модуля `src/main/vendors/` и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · a51c424f3
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · a51c424f3
  - evidence: gate pass · `gate fast` exit 0 (round 2) · mac - · 58bfd30676ef53338be8d38b3aa0a068141b0074

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

## Итог

- **Contract test «нет Session Node» — первый результат красный.** `test/contract/story-one-shot.test.ts`, первый
  запуск с `cwd` = папка внутри Project-а (как у черновика профиля в `connect.ts`): 2 из 10 test-ов красные. Stand-in
  Agent SDK и fake агент оба зарегистрировали запрос в `<home>/sessions` с `cwd` папки Project-а, и
  `ClaudeHomeRegistry.sessions(<Project>)` вернул live Session — на Canvas появился бы Session Node.
- **Выбранный путь — путь inventory-query, ADR не нужен.** Запрос идёт в папке самого worfy
  (`<WORFY_DATA_DIR>/terminal-ai`, там же inventory MCP, Limits и Terminal AI), а Project агент читает Read, Glob, Grep
  по абсолютным путям, которые названы в тексте запроса. `projectConfigRoot` не понадобился: запрос story берёт только
  настройки пользователя (`draftSessionOptions`: `settingSources: ['user']`, пустой список MCP), конфиг Project-а ему не
  нужен. Код Vendor-ов (`src/main/vendors/claude/one-shot.ts`, `options.ts`) не менялся: `cwd` — поле нейтрального
  `OneShotOptions`. После правки test зелёный: Session-ов Project-а нет, ни live, ни history; запрос зарегистрирован в
  папке worfy, которая не Project.
- **Схема story** (`src/shared/stories/schema.ts`) после merge Ticket-а 01 (#1889) выровнена по `harness/bin/TICKETS.md`,
  разделы «Code story» и «Story anchor» (раунд 2): code-шаги (один фрагмент и пять полей) и frame-шаги (проза под
  фиксированным заголовком, у «What was wrong» — Requirement, фрагменты по желанию); story Epic-а — Start, главы по PR с
  head PR, глава `Ready: no — <почему>` без шагов, пронумерованный шаг «Seams between tickets» с передачами, у `done: no`
  есть причина, Summary, Check; «Check yourself» по желанию; предела числа шагов нет. Шапка PR-story: Epic и Ticket
  вместе или ни одного, Ticket — две цифры, язык `en|ru`, `commit` — head PR (story по кнопке живёт вне git). Подписи и
  `not recorded` / `не записано` — по языку story (`src/shared/stories/labels.json`, таблица README fixture-ов);
  Requirement — Markdown-ссылка или это слово. Test-ы читают общие fixture-ы `harness/bin/tests/fixtures/code-story/`
  как JSON-ответы (`test/fixtures/code-story-answers/`) и сверяют каждый фрагмент с их `repo/`.
- **Раунд 2, по ревью:** `stories.build` принимает необязательный `folder` — корень Project-а или один из его git
  worktree, любая другая папка отклоняется. Запрос story не оставляет транскрипта (`persistSession: false`) и получает
  папку checkout-а как `additionalDirectories`, поэтому чтение не режут `blockReadsOutsideWorkingDirectories` и
  `denyInsteadOfPrompting`. Для этого в нейтральные `OneShotOptions` добавлены `readFolders` и `ephemeral`
  (`src/main/vendors/one-shot.ts`), Claude передаёт их через `draftSessionOptions`; черновик профиля работает как
  раньше.
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 (first run red: live Session of the Project) · mac - · a51c424f3
- [ ] Contract test: запрос получает только Read, Glob, Grep, Bash запрещён; diff PR — в тексте запроса; `outputSchema` —
      схема story.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 · mac - · a51c424f3
- [ ] Contract test: ответ, который не проходит схему, — ошибка с причиной, без падения и без записи.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 · mac - · a51c424f3
- [ ] Contract test: `signal` останавливает запрос; после остановки ничего не записано, процесс Vendor-а закрыт.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts` exit 0 · mac - · a51c424f3
- [ ] Unit test progress bar: строки `onActivity` показываются по порядку; остановка и ошибка видны на месте кнопки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-progress.test.tsx` exit 0 · mac - · a51c424f3
- [ ] Unit test: на Project-е с Codex без `oneShot` запрос не начинается, причина из `capabilities` показана.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/story-one-shot.test.ts test/unit/story-progress.test.tsx` exit 0 · mac - · a51c424f3
- [ ] Новый ADR есть, только если test остался красным и путь inventory-query не помог; иначе ADR нет, и «Итог» это
      говорит.
  - evidence: commit pass · Build a Code story through the Project Vendor oneShot, with a progress bar (no ADR: the inventory-query path worked) · - - · a51c424f3
- [ ] lint, typecheck, test-ы модуля `src/main/vendors/` и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · a51c424f3
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · a51c424f3

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

## Итог

- **Contract test «нет Session Node» — первый результат красный.** `test/contract/story-one-shot.test.ts`, первый
  запуск с `cwd` = папка внутри Project-а (как у черновика профиля в `connect.ts`): 2 из 10 test-ов красные. Stand-in
  Agent SDK и fake агент оба зарегистрировали запрос в `<home>/sessions` с `cwd` папки Project-а, и
  `ClaudeHomeRegistry.sessions(<Project>)` вернул live Session — на Canvas появился бы Session Node.
- **Выбранный путь — путь inventory-query, ADR не нужен.** Запрос идёт в папке самого worfy
  (`<WORFY_DATA_DIR>/terminal-ai`, там же inventory MCP, Limits и Terminal AI), а Project агент читает Read, Glob, Grep
  по абсолютным путям, которые названы в тексте запроса. `projectConfigRoot` не понадобился: запрос story берёт только
  настройки пользователя (`draftSessionOptions`: `settingSources: ['user']`, пустой список MCP), конфиг Project-а ему не
  нужен. Код Vendor-ов (`src/main/vendors/claude/one-shot.ts`, `options.ts`) не менялся: `cwd` — поле нейтрального
  `OneShotOptions`. После правки test зелёный: Session-ов Project-а нет, ни live, ни history; запрос зарегистрирован в
  папке worfy, которая не Project.
- **Схема story** (`src/shared/stories/schema.ts`) взята из spec, Ticket 01 ещё не влит: агент отвечает шагами
  (`title`, `fragment` `path`/`startLine`/`endLine`/`mainLines`/`code` или `null`, `what`, `why`, `without`,
  `requirement`, `risks`) и списком передач (`from`, `to`, `what`, `done`); шапку (`kind`, `epic`, `ticket`, `pr`,
  `language`, без commit-а) ставит worfy. Кто вливается вторым — 01 или 04 — выравнивает имена полей с `TICKETS.md`.
- **Codex.** `oneShot` Codex по-прежнему отказывает (`PartNotWired`). На Project-е с Codex запрос не начинается: build
  отвечает `unavailable` с причиной `capabilities.unsupported.oneShotToolFree`, в текст которой добавлено «a Code
  story»; progress bar показывает её на месте кнопки. **Вопрос владельцу:** для story на Project-е с Codex подключить
  `oneShot` Codex или брать Claude Code (решение 25 говорит «на Vendor-е Project-а»)? До ответа story там недоступна с
  этой причиной. Подтверждено владельцем 2026-11-17: Codex отказывает в story с этой причиной, `oneShot` Codex не
  подключаем.
- **Не проверено живым Claude Code:** что Read, Glob, Grep по абсолютным путям в `additionalDirectories` проходят —
  в test-ах их пропускает `canUseTool` (`readOnlyCanUseTool`), реальный Claude Code не запускался (правило брифа).
- Последняя строка прогресса Claude `oneShot` — «The draft is ready» (`activityOf`, общая с черновиком профиля); для
  story это неточный текст. Правка трогает test-ы черновика вне следа Ticket-а — оставлено Orchestrator-у.

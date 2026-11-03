# 28 — Поиск по транскриптам Codex

Type: task
Status: done 2026-11-03T12:47Z
PR: #1289
Blocked by: 22, 24
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 10; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md))

## Что происходит

- Поиск — `TranscriptSearch` (`src/main/claude-home/search.ts:141`) по файлам Claude с пределами `SEARCH_LIMITS`
  (`:35`); канал `claudeHome.search` (`src/shared/ipc/claude-home.ts:220-243`).

## Что делаем

1. Поиск идёт и по Session-ам Codex Project-а: текст сообщений из `history.read` (Ticket 22), те же пределы и то же
   правило snippet-а (`snippetAround`, `:112`).
2. Результат несёт `vendor`; результаты поиска в Command palette (`src/renderer/palette/CommandPalette.tsx:10`,
   поиск по транскриптам) показывают `VendorBadge` (Ticket 24).
4. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/28/`.
3. Прочитанные thread-ы кэшируются в памяти до изменения времени thread-а, чтобы повторный поиск не читал всё заново.

## Готово, когда

- [ ] Contract test (фейк, `threads`): текст из сообщения Codex находится; snippet и пределы — как у Claude.
- [ ] Test-ы поиска Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы поиска — exit 0.

## Где в коде

- `src/main/claude-home/search.ts` — `:35`, `:68`, `:112`, `:141`
- `src/main/ipc/claude-home.ts`
- `src/renderer/palette/CommandPalette.tsx` — `:10`, строки результата
- `test/unit/palette-commands.test.tsx`
- `test/contract/claude-home-search.test.ts`

## Итог

- `src/main/claude-home/search.ts`: `TranscriptSearch` принимает список `VendorThreads` (Vendor, его thread-ы из последнего
  списка Project-а, чтение thread-а). Кандидаты — транскрипты Claude и thread-ы Codex, одним списком по времени, новые первыми
  (тот же порядок, что у истории `claudeHome.sessions`). Те же `SEARCH_LIMITS`: thread считается одним прочитанным
  транскриптом, UTF-8 байты его сообщений — в предел `bytes` (размер thread-а известен только после чтения). Тот же
  `snippetAround`; ищутся только сообщения пользователя и ответы агента (`eventMessages`), не команды и не их вывод. Thread с
  id, который не может быть Session-ом (`sessionIdSchema`), пропускается, как в истории.
- Текст прочитанного thread-а хранится в памяти (тот же LRU-кэш, что у транскриптов, ключ `\0codex\0<id>`) до смены времени
  thread-а в списке; thread без времени читается при каждом поиске. Codex, не прочитавший один thread, до конца этого поиска
  больше не спрашивается, ответ говорит `limited: true` («Older transcripts were not searched»).
- `src/main/ipc/claude-home.ts`: `claudeHome.search` ищет и по thread-ам Codex через `CodexSessions` (`cached` и `transcript`):
  сам список у Codex не спрашивает, читает только thread-ы из последнего списка Project-а.
- `src/shared/ipc/claude-home.ts`: у результата поиска — необязательное поле `vendor` (`codex`); у результата Claude поля нет,
  как в `historySessionSchema`, поэтому ожидания test-ов поиска Claude (`toStrictEqual`) не менялись.
- Command palette: каждая строка «In transcripts» кончается логотипом Vendor-а (`VendorBadge`, форма `icon`, имя Vendor-а — в
  tooltip и в `aria-label`); строка без `vendor` — Claude Code.
- Test-ы: `test/contract/claude-home-search.test.ts` (фейк app-server со списком thread-ов и чтением каждого: текст сообщения
  Codex найден, snippet и пределы как у Claude, кэш до смены времени, отказ Codex, ничего не записано в Claude home, Codex home
  и папки Project-ов); `test/unit/palette-transcripts.test.tsx`; e2e `test/e2e/codex-transcript-search.spec.ts`.
- Снимки: [светлая тема](../evidence/28/28-codex-search-light.png), [тёмная тема](../evidence/28/28-codex-search-dark.png).
- Ревью (verify-28, ступень `low`, PR #1289): `VERIFIED`. Долги:
  - debt (Consider, low): два поиска подряд на холодном кэше оба читают у Codex один и тот же непрочитанный thread
    (`src/main/claude-home/search.ts:298`; окно шлёт новый поиск после каждой паузы 250 ms, main ничего не отменяет).
    Это лишние запуски процесса, результат не страдает. Исправление — держать начатое чтение thread-а по его ключу.
  - debt (Noted, low): пока не пришёл первый список Session-ов Codex Project-а, поиск молча не видит thread-ы Codex и отвечает
    `limited: false` (`src/main/ipc/claude-home.ts:281-282`). Ограничение описано в `docs/features/app-shell.md`.

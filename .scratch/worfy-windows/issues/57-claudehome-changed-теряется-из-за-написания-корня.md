# 57 — `claudeHome.changed` теряется на Windows: main и окно пишут корень Project-а по-разному

Type: bug
Status: open
Blocked by: —
Source: ревью PR #489 (Ticket 49, корень Project-а в двух написаниях) на Mac, 2026-10-18. Строки — на main
`93bb35d5`.

## Что происходит

Main process шлёт окну событие `claudeHome.changed`, когда в `~/.claude/projects` меняется транскрипт или
список Session-ов Project-а. В событии стоит `projectRoot` — корень Project-а.

- Main кладёт туда `resolve(projectRoot)` (`src/main/ipc/claude-home.ts:148`, отправка — `:82`). На Windows
  `resolve` даёт `C:\…` с обратной косой чертой.
- Окно подписывается под тем написанием, которое у него есть: `project.path`, то есть `C:/…`
  (`src/renderer/shell/sidebar/SessionsSection.tsx:71` → `useClaudeHome(project.path)`,
  `src/renderer/claude-home/useClaudeHome.ts:198`).
- Все три обработчика события ищут корень строкой и молча выбрасывают событие: `useClaudeHome.ts:176`
  (`users.has(root)`), `src/renderer/binding/store.ts:132` и `src/renderer/claude-home/subagents.ts:135`
  (ключ из `projectRoot` и `sessionId`).

**Что видит человек на Windows.** Пока живых Session-ов нет, окно не опрашивает список само
(`useClaudeHome.ts:94` — таймер только при `live.length > 0`). Значит:

- Session, запущенная из PowerShell, в списке не появляется;
- транскрипт открытой Session не обновляется;
- обновляется только транскрипт Subagent-а — его окно перечитывает по таймеру (`useClaudeHome.ts:314`).

Рядом, тот же участок: `rootOf` (`src/main/ipc/claude-home.ts:149`) зовёт `insideProjects` и выбрасывает
real path, который тот возвращает. Это против комментария `src/main/link/caller.ts:59-61`: вызывающий
должен пользоваться путём, который вернула проверка, иначе ссылка, подменённая после проверки, проходит.

## Что делаем

1. Main возвращает в `claudeHome.changed` корень ровно в том написании, в каком окно его прислало при
   подписке (предложение ревью). Сравнение двух написаний — то, что ввёл Ticket 49; новое сравнение не
   заводить.
2. `rootOf` пользуется путём, который вернул `insideProjects`, как требует `caller.ts:59-61`, или
   комментарий объясняет, почему здесь это не нужно.

## Готово, когда

- [ ] Contract test: подписка с корнем `C:/p` (платформа `win32` в test-е) и изменение транскрипта —
      событие приходит с `projectRoot` `C:/p`; обработчик `useClaudeHome` его принимает. На main `93bb35d5`
      test красный (`projectRoot` — `C:\p`).
- [ ] Тот же случай для `binding/store.ts` и `claude-home/subagents.ts`: `refresh` вызван.
- [ ] Мутант: `resolve(projectRoot)` обратно в событии — test красный.
- [ ] На macOS написание корня не меняется: прежние test-ы `claude-home` зелёные.
- [ ] `rootOf`: test или комментарий по пункту 2.
- [ ] Windows-ПК: Session, запущенная из PowerShell, появляется в списке Project-а без живых Session-ов;
      вывод или снимок — в Итог.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac; gate full — exit 0 и строка
      `[gate] зелено (full)` (по правилу needs-mac-gate).

## Тесты

Contract test на `src/main/ipc/claude-home.ts` с подменённой платформой и unit test-ы трёх обработчиков в
окне (jsdom).

## Где в коде

- `src/main/ipc/claude-home.ts` (`:82`, `:148-149`)
- `src/renderer/claude-home/useClaudeHome.ts` (`:94`, `:176`, `:198`, `:314`)
- `src/renderer/binding/store.ts` (`:132`)
- `src/renderer/claude-home/subagents.ts` (`:135`)
- `src/renderer/shell/sidebar/SessionsSection.tsx` (`:71`)
- `src/main/link/caller.ts` (`:59-61`, только читать)
- test-ы `claude-home` в `test/contract/` и `test/unit/`

## Итог

# 57 — `claudeHome.changed` теряется на Windows: main и окно пишут корень Project-а по-разному

Type: bug
Status: claimed 2026-10-18T18:05Z
Branch: worfy-windows/57
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

- [x] Contract test: подписка с корнем `C:/p` (платформа `win32` в test-е) и изменение транскрипта —
      событие приходит с `projectRoot` `C:/p`; обработчик `useClaudeHome` его принимает. На main `93bb35d5`
      test красный (`projectRoot` — `C:\p`).
- [x] Тот же случай для `binding/store.ts` и `claude-home/subagents.ts`: `refresh` вызван.
- [x] Мутант: `resolve(projectRoot)` обратно в событии — test красный.
- [ ] На macOS написание корня не меняется: прежние test-ы `claude-home` зелёные.
- [x] `rootOf`: test или комментарий по пункту 2.
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

Session на Windows-ПК, 2026-10-18. Windows 11 Pro 10.0.26200. Ветка `worfy-windows/57` от main `f7ea055f`,
worktree `C:/Users/Alexey/worfy-wt/57`. PR не открыт, push не было: по брифу оркестратора — только
локальные commit-ы.

**Причина.** На main `f7ea055f` handler `claudeHome.sessions` подписывал окно под `resolve(projectRoot)`
(`src/main/ipc/claude-home.ts:148`), и событие уходило с этим корнем (`:82`). На Windows это `C:\…`, а окно
подписано под `project.path`, то есть `C:/…`. Все три читателя события в окне ищут корень строкой
(`useClaudeHome.ts:176`, `binding/store.ts:132`, `claude-home/subagents.ts:135`) и выбрасывали событие.

**Исправление** (`src/main/ipc/claude-home.ts`):

- `ClaudeHomeSubscriptions.subscribe(subscriber, projectRoot, asSent)` (`:75`): watcher по-прежнему
  смотрит resolved корень, но ключ подписки (`:81`) и `projectRoot` события (`:88`) — написание, которое
  прислало окно. `unsubscribe` (`:110`) и `claudeHome.close` берут то же написание. Два написания одного
  корня из одного окна — два watcher-а, каждое событие в своём написании.
- Сравнения двух написаний (`sameProjectRoot`, Ticket 49) здесь не нужно: main ничего не сравнивает, он
  отдаёт окну его же строку. Окно не менялось.
- Пункт 2: `rootOf` (`:156`) возвращает путь, который ответил `insideProjects`. Для окна это прежний
  `resolve(projectRoot)`; для вызова Linked machine — real path после проверки, как требует
  `caller.ts:59-61`: `git worktree list` и чтение транскриптов идут по проверенному пути.

**Test-ы.**

- `test/contract/claude-home-registry.test.ts`, describe «claudeHome.changed carries the root as the window
  sent it» (`:868`): `C:/p` на входе — `C:/p` в событии, registry смотрит `resolve('C:/p')` (`:888`); два
  написания и закрытие одного из них (`:899`); вызов Linked machine через junction (на macOS — symlink):
  registry получает real path, событие — написание вызова (`:919`). Registry в этих test-ах — подмена с
  ручным запуском watcher-а, поэтому подменять платформу не нужно: `C:/p` красный на старом коде и на
  Windows (`C:\p`), и на macOS (posix `resolve` даёт `<cwd>/C:/p`).
- Там же три прежние проверки событий с настоящим watcher-ом ждут корень как его прислали (`DEMO`,
  `CYRILLIC`), а не `resolve(…)`. На macOS это одно и то же.
- `test/unit/claude-home-changed-root.test.tsx` (jsdom): `useClaudeHome`, `useSessionSignals` и
  `useSubagentTree` под корнем `C:/p` снова спрашивают main на событие с `C:/p` и не реагируют на `C:\p`.
  Окно не менялось, так что эти test-ы зелёные и на старом коде: они фиксируют, какое написание окно ждёт.

**Запуски test-ов** (`node scripts/vitest-electron.mjs <файлы>`, под замком heavy.lock). Набор: `claude-home-registry`,
`claude-home-changed-root`, `claude-home-titles`, `claude-home-search`, `claude-home-subagents`, `clients`,
`link-access`, `notify`, `no-rmsync`, `e2e-no-spawn-on-load`.

- База — исходник и test-ы main `f7ea055f` (без нового файла, 9 файлов): exit code 1, 254 test-а, 10 упало.
  Это давние падения Windows-ПК: 7 в `claude-home-registry` (блоки «watching the Claude home» и «claudeHome
  IPC channels» — настоящий watcher не доносит изменение за отведённое время; те же 7, что в Итоге
  Ticket-а 29) и 3 в `link-access` (`workflow.changed` не пришёл, подписка Terminal).
- Красный — новые test-ы на исходнике main: exit code 1, 260 test-ов, 13 упало: те же 10 и 3 новых
  contract test-а (`C:\p` вместо `C:/p`; `…\alias` вместо `…\project`).
- Зелёный: exit code 1, 260 test-ов, 10 упало — по именам те же 10, что в базе. Новых падений нет.
- `CI=true pnpm lint` — exit code 0. `CI=true pnpm typecheck` — exit code 0.

**Мутанты** — каждый отдельно, тот же набор файлов, файл восстановлен копией байт в байт (`cmp` 0),
`git diff --quiet` — 0 после каждого. Убиты 5 из 5:

1. событие с `projectRoot` (resolved) вместо `asSent` — 13 упало, 3 новых;
2. ключ подписки по resolved корню — 11 упало, «two spellings…»;
3. `rootOf` выбрасывает ответ `insideProjects` — 11 упало, «a Linked machine's call…»;
4. `claudeHome.close` ищет `resolve(projectRoot)` — 11 упало, «two spellings…»;
5. handler не передаёт `projectRoot` в `subscribe` — 13 упало, 3 новых.

**Не проверено.**

- Три прежние проверки событий с настоящим watcher-ом (`DEMO`, `CYRILLIC` вместо `resolve(…)`) на ПК
  падают и до, и после правки — watcher в test-ах здесь не доносит изменения. Проверка — на Mac.
- Пункт «Windows-ПК: Session из PowerShell появляется в списке» — приложение не запускалось.
- `pnpm test` целиком, gate fast и gate full не запускались (бриф: gate не запускать); на macOS и Linux с
  ПК ничего не запускалось.

# 17 — Ветка git для запроса Terminal AI теряется на занятой машине

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-30 («1-3 согласен», через мост ПК): чинить. Факт найден на ПК при polish 41 part 2 (PR #1052, test `terminal-ai-assist.test.ts`): под нагрузкой `git branch --show-current` не укладывается в 1000 ms

## Что происходит

- Запрос Terminal AI берёт ветку папки Terminal-а через `gitBranch` (`src/main/terminal-ai/git-branch.ts:14`),
  вызов — `src/main/terminal-ai/assist.ts:291`, `:439`.
- `gitBranch` запускает процесс `git branch --show-current` с пределом `GIT_BRANCH_TIMEOUT_MS = 1000`
  (`git-branch.ts:6`). На занятой машине (Windows-ПК, 8 worker-ов vitest) git не успевает: запрос уходит без
  ветки, без пометки и без повторной попытки. Заголовок файла называет это поведение задуманным; владелец
  решил, что так быть не должно.

## Что делаем

Подтверждено владельцем 2026-10-30:

1. Ветку читать из файла `HEAD` репозитория, без процесса: найти `.git` вверх от папки Terminal-а; `.git` —
   файл (`gitdir: …`, worktree и submodule) — перейти по ссылке; `ref: refs/heads/<имя>` → `<имя>`; HEAD
   отсоединён (sha) → `null`, как сейчас.
2. Чтение файла не удалось или формат неизвестен — прежний путь через процесс git с тем же пределом 1000 ms.
3. Поведение для пользователя не меняется: та же ветка, что печатает `git branch --show-current`; `null` в тех
   же случаях (не репозиторий, HEAD отсоединён, git нет).
4. Заголовок `git-branch.ts` переписать под новый порядок.

## Готово, когда

- [x] Contract test: ветка читается без запуска процесса — git-stub через PATH, который пишет в файл, что его
      вызвали, и спит 3 s; ответ — имя ветки, stub не вызван.
- [x] Обычный репозиторий, worktree (`git worktree add`), submodule, отсоединённый HEAD, папка вне репозитория,
      вложенная папка репозитория — тот же ответ, что `git branch --show-current` (настоящий git).
- [x] Повреждённый `HEAD` (пустой или мусор) — путь через процесс git; при медленном stub — `null` за предел.
- [x] Связка по умолчанию в `AssistService` (без `branchOf`) покрыта test-ом, который краснеет на мутанте
      `branchOf = async () => null`.
- [x] Ни один предел test-а не поднят (правило владельца, `rules.md`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; Windows-вердикт по правилам проекта (пути `.git`
      с `\` и буквой диска — платформенный PR, ADR-0056).

## Тесты

- Contract `test/contract/terminal-ai-git-branch.test.ts` (новый): настоящий git во временной папке, stub git
  через PATH.
- Сначала падающий: stub git со сном 3 s — сейчас ответ `null`.

## Где в коде

- `src/main/terminal-ai/git-branch.ts`
- `test/contract/terminal-ai-git-branch.test.ts` (новый)
- `test/contract/terminal-ai-assist.test.ts` (только если test связки по умолчанию живёт там; файл меняет PR
  #1052 — тогда ждать его мержа)

Только читать: `src/main/terminal-ai/assist.ts`.

## Итог

**Что сделано (`src/main/terminal-ai/git-branch.ts`).** `gitBranch` сначала читает ветку из файлов
репозитория, без процесса: ищет `.git` вверх от папки Terminal-а; `.git`-каталог — git-каталог; `.git`-файл
(`gitdir: <путь>`, относительный или абсолютный, с `/` или `\` и буквой диска) — переход по ссылке (worktree,
submodule); `HEAD` вида `ref: refs/heads/<имя>` даёт `<имя>` (имена с `/`; имя, которое отверг бы
`git check-ref-format`, — нет); sha (40 или 64 знака) — `null`. Процесс `git branch --show-current` с прежним
пределом 1000 ms остаётся запасным путём, когда файлы не отвечают: пустой или мусорный `HEAD`, `HEAD` вне
`refs/heads`, reftable-репозиторий (`refs/heads/.invalid`), файл не читается, `.git` не найден до корня диска.

**Папка вне репозитория идёт через процесс git, а не сразу `null`.** Так `GIT_DIR` и подобные переменные
по-прежнему решают за git, а test связки по умолчанию из PR #1052 («a service built without branchOf…»: git из
PATH в папке без `.git`) остаётся зелёным — проверено прогоном его версии test-а против этой ветки. Цена: запрос
из папки вне репозитория на занятой машине ждёт git, как до Ticket-а (ответ тот же — `null`).

**Тесты.** Contract `test/contract/terminal-ai-git-branch.test.ts`: stub git через PATH пишет в файл, что его
вызвали, и спит 3 s; ответ — имя ветки, stub не вызван (сначала красный: `expected null to be
'feature/deep/name'`). Обычный репозиторий, вложенная папка, worktree и папка в нём, отсоединённый HEAD,
submodule на ветке и с отсоединённым HEAD, папка в submodule — сверка с настоящим `git branch --show-current`,
stub не вызван; папка вне репозитория — `null`, как у git. Повреждённый `HEAD` (пустой, мусор, reftable, ref вне
`refs/heads`) и папка вне репозитория — ответ процесса git; при медленном stub — `null` за предел. Разбор `HEAD` и
`gitdir:` (в том числе пути Windows через `path.win32`) — отдельными случаями. Пределы test-ов не подняты:
новые test-ы берут время через `ms()`.

**Связка по умолчанию в `AssistService` (без `branchOf`)** — test «a service built without branchOf reads the
branch with the git on PATH…» в `test/contract/terminal-ai-assist.test.ts:1019` (пришёл в main с PR #1052,
2399dcc8; этот Ticket файл не правит). Мутант `src/main/terminal-ai/assist.ts:291` →
`options.branchOf ?? (async () => null)` на ветке после rebase на 2399dcc8: test красный, exit code 1
(`expected 'Folder: …' to contain 'Git branch: from-path-git'`); файл возвращён из копии.

**Платформа.** Пути `.git` с `\` и буквой диска — платформенный PR (ADR-0056); на Windows test с настоящим git
идёт со stub-ом, одним в PATH, а test-ы со stub-ом-скриптом `/bin/sh` пропускаются. `pnpm lint`, `pnpm typecheck`, `pnpm test` на Mac — exit 0; Windows-вердикт — job Windows в CI этого PR, пункт открыт до него.

**Долги ревью PR #1056 (low, тикетов не заводят).**

- `HEAD`-symlink (так HEAD хранил очень старый git) даёт `null`: `readFile` идёт по ссылке, читает sha ветки и
  считает HEAD отсоединённым (`src/main/terminal-ai/git-branch.ts:89`).
- `GIT_DIR` и подобные переменные в окружении main не учитываются, пока `.git` найден по файлам
  (`src/main/terminal-ai/git-branch.ts:96`); учитываются только на пути через процесс git.
- `safe.directory`: в репозитории другого владельца git отказывал и ветки не было; теперь ветка видна. Это не
  утечка: имя ветки уходит только в запрос из Terminal-а, открытого в этой папке тем же пользователем.

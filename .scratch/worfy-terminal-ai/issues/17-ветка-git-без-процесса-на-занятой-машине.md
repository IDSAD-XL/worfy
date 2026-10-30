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

Решено без владельца, подтвердить (вариант с наименьшей ценой):

1. Ветку читать из файла `HEAD` репозитория, без процесса: найти `.git` вверх от папки Terminal-а; `.git` —
   файл (`gitdir: …`, worktree и submodule) — перейти по ссылке; `ref: refs/heads/<имя>` → `<имя>`; HEAD
   отсоединён (sha) → `null`, как сейчас.
2. Чтение файла не удалось или формат неизвестен — прежний путь через процесс git с тем же пределом 1000 ms.
3. Поведение для пользователя не меняется: та же ветка, что печатает `git branch --show-current`; `null` в тех
   же случаях (не репозиторий, HEAD отсоединён, git нет).
4. Заголовок `git-branch.ts` переписать под новый порядок.

## Готово, когда

- [ ] Contract test: ветка читается без запуска процесса — git-stub через PATH, который пишет в файл, что его
      вызвали, и спит 3 s; ответ — имя ветки, stub не вызван.
- [ ] Обычный репозиторий, worktree (`git worktree add`), submodule, отсоединённый HEAD, папка вне репозитория,
      вложенная папка репозитория — тот же ответ, что `git branch --show-current` (настоящий git).
- [ ] Повреждённый `HEAD` (пустой или мусор) — путь через процесс git; при медленном stub — `null` за предел.
- [ ] Связка по умолчанию в `AssistService` (без `branchOf`) покрыта test-ом, который краснеет на мутанте
      `branchOf = async () => null`.
- [ ] Ни один предел test-а не поднят (правило владельца, `rules.md`).
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

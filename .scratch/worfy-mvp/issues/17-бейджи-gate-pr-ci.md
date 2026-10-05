# 17 — Бейджи Gate, PR, CI и вердикта ревьюера на Тикетах и Сессиях

Type: task
Status: blocked — blocked by 11, 14
Blocked by: 11, 14
Source: [CONTEXT.md](../../../CONTEXT.md), термин «Gate»; [BRIEF.md](../../../docs/design/BRIEF.md), Screen 1 пункт 1 (Тикеты 08, 09)

## Что делаем

**Gate** (`~/.claude/hooks/gate.sh`) держит состояние по каждому worktree в
`<WORFY_CLAUDE_HOME>/gate/state/`: `red-<ключ>-<tag>` (красно) и `unverified-<ключ>-<tag>` (не
удалось проверить), где `tag` — первые 8 символов `shasum` (SHA-1) от пути worktree, а ключ —
запись репозитория в `gate/config.json`.

- `src/main/gate/state.ts`: для каждого worktree Проекта считает `tag`, находит ключ по
  `config.json` (самый длинный совпавший `match`), читает маркеры. Нет маркеров — исход берётся
  из последней строки `[gate] зелено | красно | ничего не прогналось | ПРОВЕРИТЬ НЕ УДАЛОСЬ` в
  транскриптах Сессий этого worktree (hook-и и вывод Bash). Итог: «зелено», «красно», «не удалось
  проверить», «нет данных». «Ничего не прогналось» — это «нет данных», не «зелено».
- Бейдж Gate — на Узле Сессии (по её `cwd`) и на Тикете (worktree или ветка → Тикет через
  `ticket-ref.ts`).
- **PR и CI** (`src/main/github/prs.ts`): раз в 60 с, только пока окно активно, один вызов
  `gh pr list --state all --limit 100 --json number,headRefName,state,url,statusCheckRollup,comments`
  в корне Проекта (без `--limit` `gh` отдаёт 30 последних PR, на Auction этого мало). Тикет в
  работе или с веткой worktree, чьей ветки в этом списке нет, добирается отдельным
  `gh pr list --state all --search "head:<ветка>" --limit 1` — не чаще раза в 5 минут на ветку. Ветка → Тикет через `ticket-ref.ts`. CI сводится к `passing | failing | running`.
  Вердикт ревьюера — последний комментарий, чья первая строка `VERIFIED` или `REJECTED`. Ошибка
  `gh` (нет, не залогинен, нет сети) — один бейдж «gh unavailable» и удвоение интервала, без
  потока ошибок.
- Только чтение: никаких команд `gh`, которые что-то меняют.
- Бейджи — `badges/ChecksBadges.tsx` в слоте Тикета и Сессии; цвета — токены ready / working /
  blocked с подписью.

## Готово, когда

- [ ] Fixture с маркером `red-worfy-<tag>` для worktree Тикета 07 даёт «красно» на Тикете 07 и на Сессии в этом worktree; удаление маркера — «зелено» по последней строке гейта в транскрипте.
- [ ] `tag` совпадает с тем, что считает `gate.sh` (test сверяет с `printf '%s' <путь> | shasum`).
- [ ] Stub `gh` с PR на ветку `worfy-mvp/08`: бейдж «PR #N», CI `running`, комментарий `VERIFIED` → «VERIFIED».
- [ ] `gh` отсутствует → «gh unavailable», приложение работает, интервал растёт.
- [ ] Stub `gh` со 150 PR: PR ветки, которой нет среди первых 100, находится через `--search head:<ветка>` (stub записывает аргументы вызовов).
- [ ] Ручная проверка на Auction: бейджи у Тикетов с открытыми PR; снимок в «Итог».

## Тесты

- `test/unit/gate-state.test.ts` — `tag`, выбор ключа, маркеры, последняя строка гейта, «ничего не прогналось» (новый).
- `test/contract/github-prs.test.ts` — разбор ответа `gh` по fixture, ошибки `gh` (новый).
- Сначала падающий test: сверка `tag` с `shasum`.

## Где в коде

- `src/main/gate/state.ts`
- `src/main/github/prs.ts`
- `src/main/ipc/checks.ts`, `src/shared/ipc/checks.ts`
- `src/renderer/canvas/badges/ChecksBadges.tsx`

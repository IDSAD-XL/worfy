# 155 — Всплеск `git merge-base --is-ancestor` каждые 6 минут: общий кэш пар, один вопрос на пару, предел процессов git

Type: bug
Status: claimed 2026-11-26T02:13Z
Blocked by: —
Source: баг-репорт владельца #2252 (2026-11-26), часть 1.

Кто: агент.

## Что происходит

На Windows установленная копия worfy раз в 6 минут запускает из main process 40–80 процессов `git.exe` за одну секунду
(с ними столько же `conhost.exe`): нагрузка на CPU всей машины и заметное подвисание интерфейса. Команды — по одному
`git -C <worktree> merge-base --is-ancestor <merge> <коммит Stable copy>` на каждый merge, плюс
`rev-parse --is-shallow-repository`, `rev-list --count <sha>`, `show <sha>:package.json`. Одни и те же пары повторяются в
каждом цикле, а иногда дважды за цикл.

Источник — строка Stable copy пункта Acceptance (`src/main/acceptance/stable-line.ts`):

- **Таймер 6 минут.** `AcceptanceService` (`src/main/acceptance/service.ts`) пересчитывает очередь на каждом tick-е раз в
  60 s (`ACCEPTANCE_TIMING.tickMs`). Ответ StableLine, который может измениться (не `final`), хранится `RETRY_MS` =
  `SEARCH_INTERVAL_MS` = 5 минут (`src/main/github/prs.ts`) и спрашивается заново на первом tick-е после того, как истёк.
  Ответ приходит чуть позже tick-а, поэтому на tick через 5 минут он ещё свеж, а на следующем — истёк: 5 + 1 = 6 минут.
- **Почему пары повторяются от цикла к циклу.** Ответ git 0 или 1 у StableLine хранится навсегда, но только в своём
  worktree (ключ `root + merge + stable`). Не навсегда — всё остальное: commit-а нет в этом checkout (exit 128; worfy
  никогда не делает fetch, ADR-0005) или git не ответил (code null — например, `timeout` 10 s у `gitRunner`, который при
  80 одновременных процессах на Windows вполне достижим). Такие пары, и сборка (`rev-parse`, `rev-list`, `show`) коммита,
  которого в checkout-е нет, спрашиваются каждые 6 минут. В worktree без коммита Stable copy (по репорту — `worfy-demo`)
  на каждый merge уходят `merge-base` и `cat-file -e`, плюс три команды сборки.
- **Почему дважды за цикл.** Одна и та же пара спрашивается в каждом worktree одного репозитория отдельно (Project-ы
  `F:\SWE\worfy` и `F:\SWE\worfy-w16`): ключ кэша включает путь. Тот же вопрос задают и другие места main process со
  своими кэшами: Stage Deploy (`src/main/workflow/stages.ts`, свой кэш на Project) и local merge Flight Recorder
  (`src/main/flight-recorder/local-verdicts.ts`, без кэша совсем).
- **Почему всплеск.** Все вопросы одного пересчёта уходят сразу, без предела числа процессов.

`src/main/github/deployments.ts` git не вызывает: он только читает Deployments, вопрос предка задаёт `stages.ts`.

## Что делаем

1. Общий модуль `src/main/workflow/git-ancestry.ts`: `merge-base --is-ancestor` с кэшем ответа на весь процесс.
   - Ключ — пара (ancestor, descendant), когда оба — полные SHA: предок одного коммита у другого не меняется и одинаков в
     любом checkout-е, у которого оба коммита есть. Короткий SHA хранится с путём репозитория; ref (`refs/heads/main`)
     не хранится вовсе — он двигается.
   - Хранятся только exit 0 и 1. Exit 128 (commit-а нет в checkout-е) и code null не хранятся: их спрашивают снова.
   - Один вопрос на пару за раз: второй вопрос той же пары, пока первый в пути, ждёт его ответа; из другого checkout-а —
     берёт ответ 0/1, а на 128 спрашивает в своём.
   - Предел одновременных процессов git этих путей — `ANCESTRY_GIT_LIMIT` = 3, через общую очередь.
   - Экземпляр один на runner (`ancestryFor`): у приложения (`gitRunner`) он один на процесс, у test-а — свой у каждого
     fake runner-а.
2. StableLine, StageReader и `readLocalVerdicts` спрашивают через него; все git-команды StableLine идут через ту же
   очередь.
3. StableLine сначала проверяет, что коммит Stable copy есть в checkout-е (`cat-file -e`, ответ «есть» хранится
   навсегда): нет — строка «not in this checkout» без `merge-base` на каждый merge и без команд сборки.

## Где в коде

- `src/main/workflow/git-ancestry.ts` — новый модуль.
- `src/main/workflow/stages.ts:361-380` (`deploysOf`, `isAncestor`), `ancestryFor`.
- `src/main/acceptance/stable-line.ts:150-260` (`line`, `askAncestry`, `askBuild`).
- `src/main/flight-recorder/local-verdicts.ts:55-100` (`mergeOf`, `readLocalVerdicts`).
- `docs/features/acceptance.md` — раздел «How it works» строки Stable copy.
- Только читать: `src/main/acceptance/service.ts` (tick), `src/main/github/prs.ts` (`SEARCH_INTERVAL_MS`),
  `src/main/github/deployments.ts`.
- Тесты: `test/unit/git-ancestry.test.ts` (новый), `test/unit/acceptance-stable-line.test.ts`,
  `test/contract/workflow-stages.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts`.
- Не трогать: `src/main/update/` — пересборку из части 2 репорта чинит worfy-polish 156.

## Решено без владельца

- Предел — 3 процесса (бриф: 2–4). Готового общего ограничителя в `src/main` нет: `inPool` в
  `src/main/workflow/reader.ts` — локальный пул одного вызова, не очередь на весь процесс; заведён свой маленький.
- Один git-вызов на worktree вместо цикла по commit-ам (`rev-list <stable> --not …`, `for-each-ref --contains`) не
  сделан. Вопросы StableLine идут по одному ключу через `Kept` с ответом позже, пакет туда чисто не ложится; `for-each-ref
  --contains` работает только с ref-ами, а merge-commit-ы — не ref-ы. После общего кэша пара стоит один процесс за
  жизнь приложения, а с пределом 3 и первый проход не даёт всплеска.
- Проверка «коммит Stable copy есть в checkout-е» идёт после вопросов к GitHub о merge-ах: порядок причин «Stable copy not
  checked» в строке прежний.
- Exit 128 и code null не хранятся — commit может появиться после `git pull` владельца; повтор раз в `RETRY_MS`
  остаётся, но идёт через предел.

## Test-ы

- Второй цикл с теми же commit-ами не запускает git для известных пар — ни в том же, ни в другом worktree.
- Одновременно работает не больше `ANCESTRY_GIT_LIMIT` процессов: счётчик в fake runner-е.
- Exit 128 не хранится: тот же вопрос после появления commit-а получает 0.
- Два одновременных вопроса одной пары — один процесс.
- Worktree без коммита Stable copy: один `cat-file` за цикл, без `merge-base` и без команд сборки.

## Готово, когда

- [ ] Пары 0/1 хранятся на процесс по (ancestor, descendant); 128 и null — нет; test-ы на каждое — сначала красные.
- [ ] Один процесс на пару в пути; не больше 3 процессов git одновременно на этих путях.
- [ ] Число процессов git за цикл до и после — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, unit и contract test-ы затронутых модулей, gate fast — exit 0; `ci-ok` на head PR.

## Итог

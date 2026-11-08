# 68 — Одна ошибка поиска PR по ветке гасит все PR проекта

Type: bug
Status: done 2026-11-08T01:14Z
PR: #1612
Blocked by: —
Source: аудит кода 2026-11-08 (Orchestrator), находка MED. Строки перечитаны по main `3bb9e0778`.

## Что происходит

- PR tracker (`src/main/github/prs.ts`) читает PR проекта одним `gh pr list --limit 100`, а ветку Ticket-а, которой
  нет в этом списке, ищет отдельно: `gh pr list --head <branch> --limit 1`.
- Если такой поиск по одной ветке падает, tracker вызывает `this.fail(state, error)` (`prs.ts:471`): ставит ошибку
  всего проекта, удваивает интервал и не записывает результат для этой ветки.
- Из-за ошибки проекта `refresh` отдаёт `pulls: []` (`prs.ts:479`), хотя список из 100 PR прочитан успешно. Гаснут все
  бейджи PR и все Stage проекта, а `src/main/workflow/stages.ts:172` пишет «gh is unavailable».
- Упавшая ветка не записана в `searched`, поэтому при следующем чтении её ищут первой. Следующий успешный список
  сбрасывает ошибку (`prs.ts:451`), поиск ветки снова падает — данные мигают: то есть, то нет.
- Rate limit GitHub на поиске одной ветки гасит все бейджи. Отдельно rate limit сейчас не распознаётся: любая ошибка
  gh просто удваивает интервал.

## Что делаем

1. Ошибка поиска по ветке записывается для этой ветки, со своим временем следующей попытки (интервал ветки
   удваивается после каждой ошибки подряд, до `MAX_INTERVAL_MS`). Данные успешного списка отдаются дальше. Ошибка
   уровня проекта ставится только тогда, когда не прочитался сам список.
2. Сообщение Stage остаётся точным: «gh is unavailable» — только при ошибке списка; для одной ветки — своя, более узкая
   строка с именем ветки.
3. Rate limit на поиске по ветке по-прежнему останавливает gh для всего проекта: интервал списка удваивается от
   момента ошибки, поиски по веткам ждут до следующего списка. Данные списка при этом не гаснут.

Глубина review — `medium`. Не платформенный: логика интервалов в main process, без путей и процессов ОС.

## Готово, когда

- [ ] Test: список прочитан, поиск по одной ветке падает — PR списка отдаются, `gh.available` true, ветка ждёт свой
      интервал, другие ветки ищутся. До правки — красный.
  - evidence: test-run pass · `pnpm test test/contract/github-prs.test.ts test/contract/workflow-stages.test.ts` exit 0 · mac - · b65d638f66c57bfa6585266acb0a21f851b1bd5e
- [ ] Test: rate limit на поиске по ветке — данные списка остаются, интервал проекта удвоен от момента ошибки, ни
      списка, ни поиска до его конца.
  - evidence: test-run pass · `pnpm test test/contract/github-prs.test.ts` exit 0 (rate limit test) · mac - · b65d638f66c57bfa6585266acb0a21f851b1bd5e
- [ ] Stage пишет узкую строку про ветку, а «gh is unavailable» — только при ошибке списка.
  - evidence: test-run pass · `pnpm test test/contract/workflow-stages.test.ts` exit 0 · mac - · b65d638f66c57bfa6585266acb0a21f851b1bd5e
- [ ] Mutant: возврат к старому `this.fail` на поиске по ветке — новый test красный (exit code ≠ 0).
  - evidence: test-run pass · mutant old this.fail path: `pnpm test test/contract/github-prs.test.ts test/contract/workflow-stages.test.ts` exit 1, 3 tests red · mac - · b65d638f66c57bfa6585266acb0a21f851b1bd5e
- [ ] Все unit и contract test-ы `src/main/github/` и `src/main/workflow/stages.ts`, `pnpm lint`, `pnpm typecheck`,
      `pnpm test`, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · b65d638f66c57bfa6585266acb0a21f851b1bd5e
- [ ] `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42428637746/job/128580199184 · ci - · 306461d649c55af2d7cb9bf8c23d2f37c00128a2

## Где в коде

- `src/main/github/prs.ts:382-491` — `ProjectState`, `fail`, `refresh`, поиск по веткам.
- `src/main/workflow/stages.ts:171-173` — строка проблемы про gh.
- `test/contract/github-prs.test.ts` — test-ы `PrTracker over the gh stub`.
- `test/contract/workflow-stages.test.ts` — test-ы Stage поверх stub gh.

## Итог

- Ошибка поиска `--head <branch>` больше не ставит ошибку проекта. Ветка хранит в `searched` время попытки, PR
  последнего ответа, свой интервал и причину ошибки. Интервал ветки удваивается после каждой ошибки подряд
  (5 → 10 → 20 → 32 мин), успешный ответ возвращает его к 5 мин. Упавшая ветка больше не ищется первой в каждом чтении,
  поэтому данные не мигают.
- После ошибки поиск в этом чтении останавливается: при сбое gh целиком это одна лишняя попытка за чтение, а не
  десять. Сбой gh целиком (сеть, вход) ловит следующий список — тогда, как и раньше, «gh is unavailable» и `pulls: []`.
- Rate limit раньше отдельно не распознавался: любая ошибка просто удваивала интервал. Теперь причина gh проверяется
  regex-ом (`rate limit`, `HTTP 429`, `abuse detection`, `submitted too quickly` — так gh пишет первичный и вторичный
  limit). На поиске по ветке он удваивает интервал проекта от момента ошибки и останавливает и список, и поиски до
  конца интервала; данные списка при этом остаются. Rate limit на самом списке идёт прежним путём ошибки проекта.
- Сообщение Stage: «gh is unavailable in <repo>» — только при ошибке списка. Для ветки — узкая строка
  `gh could not look up the PR of branch <branch> in <repo>: <reason>`: gh отвечает, без PR может остаться только Ticket
  этой ветки, и строка говорит какой. `GhStatus` (IPC бейджей) не менялся: ошибки веток идут в необязательном поле
  `branchErrors` ответа tracker-а только для Stage.
- Два старых test-а, которые закрепляли старое поведение («a failing branch lookup … is «gh unavailable»» и «a branch
  lookup failing between two lists …»), заменены новыми: про ошибку одной ветки, про rate limit и про ошибку списка.
- Feature page `docs/features/gate-and-github.md`, абзац «Old and many PRs», описывает новое поведение.

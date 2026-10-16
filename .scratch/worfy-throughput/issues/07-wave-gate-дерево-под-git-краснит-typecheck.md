# 07 — `wave-gate`: временное дерево под `.git/` краснит typecheck, и красная база называется виной первого PR

Type: task
Status: open
Blocked by: —
Source: Wave `worfy-link` 17, 19 (2026-10-16) — первый набор `wave-gate` на Mac;
[ADR-0065](../../../docs/adr/0065-one-gate-full-per-wave-merge-set.md); лог решений Wave — каталог
`runs/worfy/worfy-link-wave-20261016T155152Z/` в Harness state.

## Что происходит

- `wave-gate check` собирает набор во временном worktree по фиксированному пути
  `<git common dir>/worfy-wave-gate` (`harness/bin/wave-gate`, комментарий в начале файла, «check»).
- В таком дереве `pnpm typecheck` красный на любом коммите: 38 ошибок TS2883 («The inferred type of
  'default' cannot be named without a reference to '$ZodTypeInternals' from '.pnpm/zod@4.6.5/…'.
  This is likely not portable») в `src/main/ipc/*.ts`. Чистый main `c8253a33`, развёрнутый
  `git worktree add` в `.git/lnk-tsc-probe` с `pnpm install --frozen-lockfile`, — тот же красный
  typecheck (exit 2). Тот же коммит в `.claude/worktrees/` — зелёный: zod 4.6.5 и typescript 6.0.3 там
  те же. PR #397 после этого влит старым путём: `GATE_SCOPE=all` gate full в
  `.claude/worktrees/lnk-19` — зелёный, typecheck тоже.
- Набор из одного PR #397 (`worfy-link` 19, только renderer и test-ы) был красным дважды; бисекция
  назвала его виновником (`culprit: #397; green prefix: none`). База набора не проверялась, поэтому
  красная база выглядела как вина первого PR. По правилу skill-а виновник уходит на круг доработки:
  implementer чинил бы то, чего не ломал.
- Причина, почему tsc иначе ведёт себя под `.git/`, не выяснена. Гипотеза: путь дерева внутри
  каталога `.git` меняет то, как tsc строит спецификатор модуля для символических ссылок pnpm.

## Что делаем

- Перенести временное дерево из `<git common dir>` в место, где typecheck ведёт себя как в обычном
  worktree (например, `<repo>/.claude/worktrees/worfy-wave-gate` или каталог Harness state), либо
  найти и устранить причину TS2883 под `.git/`. Выбор — по проверке, не по гипотезе.
- Когда бисекция доходит до пустого префикса (красен уже первый PR), прогнать gate full на самой базе.
  Красная база — `STATUS=unverified` с причиной «база красная», а не `red` с виновником.

## Готово, когда

- [ ] `wave-gate check` на наборе из PR, который не трогает `src/main/ipc/`, на базе с зелёным
  typecheck в обычном worktree даёт зелёный typecheck.
- [ ] Shell test `wave-gate`: красная база (stub gate красный на любом дереве) даёт
  `STATUS=unverified`, а не `culprit`.
- [ ] «Итог» называет найденную причину TS2883 под `.git/` или говорит, почему её не искали.
- [ ] Платформенный PR: Harness-скрипт — вердикт Windows-ПК до merge (ADR-0056, пункт 2).

## Где в коде

- `harness/bin/wave-gate` — путь временного дерева (комментарий «check» в начале файла), бисекция.
- `harness/bin/tests/wave-gate.test.sh` — shell test-ы.
- `harness/skills/epic-wave/SKILL.md` — раздел «Gate before merge», если меняется путь или исход.

## Вне скоупа

- Ошибки TS2883 в обычном worktree: их там нет.

## Итог

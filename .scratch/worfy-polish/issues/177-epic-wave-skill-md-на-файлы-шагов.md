# 177 — `epic-wave/SKILL.md` (163 KB) — на файлы шагов, как `ship-ticket`, без изменения поведения

Type: task
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 по worfy-harness-eval 06 (одноразовая статика SkillEvaluator по 35 skill-ам Harness,
PR #2350, «Итог», «Вопросы владельцу», вопрос 2: «да, делить `epic-wave/SKILL.md` на файлы шагов, как `ship-ticket`»).

Кто: агент. Глубина review — `medium`. Платформенный PR: правит shell test-ы `harness/bin/tests/`, они идут и на
Windows (Git Bash); verdict Windows — CI job `check/windows`.

## Что происходит

- `harness/skills/epic-wave/SKILL.md` — 162 984 байт, 2 103 строки, один файл. Разделы (байты на origin/main
  `0bfb5e57d`):
  - frontmatter и вступление, строки 1-23 — 1 906;
  - `## 0. Profile`, строки 24-140 — 8 900;
  - `## 1. Preflight`, 141-366 — 16 460;
  - `## 2. Dispatch`, 367-546 — 14 341;
  - `## 3. Verification gate`, 547-921 — 27 261;
  - `## 4. Merge by policy`, 922-1910 — около 81 000;
  - `## 5. Report`, 1911-2000 — 5 977;
  - `## How to resume a wave`, 2001-2103 — 7 085.
- SkillEvaluator 1.2.0 (`harness-check`, профиль Codex 0.166.0) дал на нём `CX-SHELL-READ`: файл ~40 746 tokens; если
  модель читает его через shell, Codex оставляет только начало и конец вывода сверх ~10K tokens. Совет SkillEvaluator —
  `SKILL.md` до ~40 000 байт, детали в отдельных файлах.
- `harness/skills/ship-ticket/` уже так устроен: `SKILL.md` (14 216 байт) — индекс шагов. В нужном месте стоит строка
  `` Read `${CLAUDE_PLUGIN_ROOT}/skills/ship-ticket/<file>.md` <когда> `` (например, `SKILL.md:200`, `:204`). Рядом — 27
  файлов шагов (`step-7-review.md`, `step-8-pr-and-ci.md`, …).
- Shell test-ы читают такой skill целиком через `skill_text` (`harness/bin/tests/skill-text.sh:16`). Helper ставит на
  место каждой строки `` Read `${CLAUDE_PLUGIN_ROOT}/skills/<skill>/<file>` `` текст этого файла без его строки
  заголовка и пустой строки после неё (regex — строка 26, описание — строки 1-14). Так
  `epic-wave-ship-ticket.test.sh:16` уже собирает `ship-ticket`.
- Текст `epic-wave` проверяют, читая `SKILL.md` напрямую:
  - shell: `harness/bin/tests/epic-wave-ship-ticket.test.sh` (`EW`, строка 10: description — строки 80-86, разделы
    `## 0.`…`## 5.` — строка 96, текст раздела 1 — строки 89-91, бриф и раздел 2 — строки 171-185),
    `skill-blocks-world.sh:89` (`WAVE`, блоки кода для `skill-blocks.test.sh` и `skill-blocks-gate.test.sh`),
    `wave-gate-world.sh:8` (`SKILL`, для `wave-gate*.test.sh`), `agents-text.test.sh`, `decision-log.test.sh`,
    `land.test.sh`, `max-review.test.sh`, `review-depth.test.sh`, `silent-mode.test.sh`, `wave-brief.test.sh`;
    `harness/hooks/tests/rules-hooks.test.sh`;
  - `harness/bin/tests/plugin-neutral.test.sh:52`: исключение `'skills/epic-wave/SKILL.md|tickets 05, 06'` привязано к
    пути файла;
  - TypeScript: `test/contract/harness-evals.test.ts:316` берёт из `SKILL.md` строки шаблона брифа (`Ticket: <F
    tickets.path for NN>`, `Files: <exact list>`, `Wave neighbours' files …`);
    `test/contract/harness-evals-run.test.ts` (карта покрытия), `test/contract/harness-plugin.test.ts:67`,
    `test/contract/ci-scope-e2e.test.ts:152`, `test/contract/ci-workflow.test.ts:1005`,
    `test/contract/e3-owner-check.test.ts:137`, `test/contract/harness-migrate.test.ts:292` — по пути файла.
- Другие файлы Harness ссылаются на разделы: `harness/skills/gate-queue/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`,
  `step-7-review.md`, `step-9-merge.md`, `pipeline-stages.md`, `harness/skills/max-review/SKILL.md`,
  `harness/skills/overnight-fix-loop/SKILL.md`, `harness/lib/verdict.cjs`, `harness/profiles/README.md`. Grader-ы eval-ов
  `harness/evals/epic-wave-tickets/graders/02-dispatched.md:9` и `epic-wave-old-form/graders/02-dispatched.md` цитируют
  «skills/epic-wave/SKILL.md, section 2».
- `harness/evals/lib/coverage.json` связывает `skills/epic-wave/SKILL.md` с тремя case-ами: `epic-wave-tickets`,
  `epic-wave-old-form`, `reviewer-verdict`. Каждый файл под `harness/skills/` должен стоять в case-е или в `uncovered`
  (`test/contract/harness-evals-run.test.ts:680-697`).

## Что строить

1. `epic-wave/SKILL.md` — индекс, как у `ship-ticket`:
   - frontmatter (`name`, `description`) не меняется;
   - вступление и заголовки `## 0.`…`## 5.`, `## How to resume a wave` остаются в `SKILL.md`: на них ссылаются
     другие файлы, test-ы и grader-ы;
   - тело раздела (или его часть) уходит в файл шага рядом. На его месте — одна строка
     `` Read `${CLAUDE_PLUGIN_ROOT}/skills/epic-wave/<file>.md` <когда> `` в форме, которую узнаёт `skill_text`;
   - файл шага начинается строкой заголовка и пустой строкой, как файлы `ship-ticket`: `skill_text` их снимает.
2. Предел размера: `SKILL.md` ≤ 40 000 байт, каждый файл шага ≤ 40 000 байт (порог `CX-SHELL-READ`). Раздел 4
   (около 81 000 байт) — минимум на три файла, по его подразделам: например, local merge и merge в очередь, `land` и Evidence
   lines, Code story и epic story, push run и batch CI, deploy и cleanup. Имена — `step-<N>-<что>.md`, как у
   `ship-ticket`.
3. Без изменения поведения: собранный `skill_text` текст нового `SKILL.md` совпадает со старым `SKILL.md` байт в байт.
   Слова не правятся, разделы не переставляются. Новые строки `Read …` — единственное отличие нового `SKILL.md`, и
   `skill_text` их заменяет.
4. Test-ы, которые читают `SKILL.md` напрямую, читают собранный текст (`skill_text`) или нужный файл шага. Ни одна
   проверка не удаляется и не ослабляется. Исключение `plugin-neutral.test.sh:52` идёт за текстом в его новый файл.
   `harness-evals.test.ts:316` читает строки брифа из файла, где они теперь лежат.
5. `coverage.json`: каждый файл шага — в тех case-ах из трёх, чей run его читает (как у файлов `ship-ticket`), или в
   `uncovered` с причиной.
6. Ссылки на разделы в других файлах остаются верными: заголовки не уходят из `SKILL.md`. Ссылку на текст, который
   ушёл в файл шага, — поправить на файл шага, если она называет строку или подраздел.

## Где в коде

- `harness/skills/epic-wave/SKILL.md` и новые `harness/skills/epic-wave/step-*.md`.
- `harness/skills/ship-ticket/SKILL.md` — образец индекса.
- `harness/bin/tests/skill-text.sh` — `skill_text`.
- Test-ы из «Что происходит»; `harness/evals/lib/coverage.json`.

## Test-ы

- Проверки, что сторожат текст skill-а, — все exit 0:
  - `bash harness/bin/tests/plugin-neutral.test.sh`;
  - `bash harness/bin/tests/epic-wave-ship-ticket.test.sh`, `skill-blocks.test.sh`, `skill-blocks-gate.test.sh`,
    `wave-gate.test.sh`, `wave-gate-heartbeat.test.sh`, `wave-gate-lock.test.sh`, `wave-brief.test.sh`,
    `agents-text.test.sh`, `decision-log.test.sh`, `land.test.sh`, `max-review.test.sh`, `review-depth.test.sh`,
    `silent-mode.test.sh`; `bash harness/hooks/tests/rules-hooks.test.sh`;
  - `test/contract/harness-evals.test.ts`, `harness-evals-run.test.ts`, `harness-plugin.test.ts`,
    `ci-scope-e2e.test.ts`, `ci-workflow.test.ts`, `e3-owner-check.test.ts`, `harness-migrate.test.ts`.
- Новая проверка (в `epic-wave-ship-ticket.test.sh`): размер `SKILL.md` и каждого `step-*.md` — ≤ 40 000 байт; каждая
  строка `Read …` ведёт к существующему файлу. Красная на нынешнем `SKILL.md`.
- Сверка без изменения поведения: `skill_text` нового `SKILL.md` против `git show origin/main:harness/skills/epic-wave/SKILL.md`
  — `cmp` exit 0. Команда и exit code — в «Итог» и в описании PR.
- Eval — по `~/.claude/worfy-harness/projects/worfy/rules-merge.md` («Платный `eval --changed` перед мержем PR с
  правками правил Harness — только с одобрения владельца на этот PR»):
  - `pnpm eval:harness -- --changed origin/main --dry-run` бесплатно — exit 0 и план в описании PR. Сейчас он выберет
    три case-а: `epic-wave-tickets`, `epic-wave-old-form`, `reviewer-verdict`;
  - платный run без «да» владельца на этот PR не запускается;
  - описание PR называет полным run-ом этой правки worfy-harness-eval 05 (точка отсчёта: первый полный run 28 case-ов).
- SkillEvaluator: `harness-check` по `harness/skills/epic-wave` в окружении, как в worfy-harness-eval 06 (venv из
  `mktemp -d`, без extra `llm`, `env -i`, `--no-llm`; удалить после) — без `CX-SHELL-READ`. Модель не вызывается.

## Готово, когда

- [ ] `epic-wave/SKILL.md` — индекс с заголовками разделов и строками `Read …`; он и каждый файл шага ≤ 40 000 байт;
      размеры до и после — в «Итог».
- [ ] `skill_text` нового `SKILL.md` байт в байт равен старому `SKILL.md` (`cmp` exit 0 в «Итог»).
- [ ] Все test-ы из «Test-ы» — exit 0; новая проверка размера красная до правки; ни одна проверка не удалена.
- [ ] `coverage.json` знает каждый файл шага; `pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, план в
      описании PR; описание PR называет worfy-harness-eval 05 полным run-ом; платного run-а без «да» владельца нет.
- [ ] `harness-check` по `epic-wave` — без `CX-SHELL-READ`, exit code и вывод в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

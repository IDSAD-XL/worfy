# 73 — Eval case status-block: `epic-status` до блока статуса на каждом рабочем ходе

Type: task
Status: claimed 2026-11-08T08:18Z
Branch: worfy-polish/73
Blocked by: —
Source: разбор Orchestrator-а 2026-11-08 (только чтение, origin/main `2a5a172a1`): eval case `status-block` Harness-а
не проходил ни разу. Строки перечитаны по main `2a5a172a1`.

## Что происходит

Eval case `status-block` (`harness/evals/status-block/`) проверяет правило «Phase 3» из
`harness/hooks/rules/orchestrator.md`: каждый рабочий ход в проекте с тикетами кончается блоком статуса из четырёх строк,
и строка Stage — вывод `epic-status` этого хода. Ход case-а — опечатка в заголовке Ticket-а 04 эпика demo; статус тикета
он не меняет.

Case не прошёл ни разу с тех пор, как написан. Каждый платный прогон — 0.50, валится один grader `epic-status-ran`
(в ходе нет вызова Bash с `epic-status`):

- 2026-10-18/19, тикет worfy-harness/27 (сами eval case-ы): 1 + 4 прогона, все 0.50.
- Тикет worfy-harness/51 (#688, 2026-10-21) переписал правило ради этого, но платный повтор не записан.
- 2026-11-03, тикет worfy-multi-vendor/36 (#1308): ветка PR — 0.67 (1 из 3, единственный проход), origin/main — 0 из 3.
- 2026-11-08: origin/main `d84a7b91e` — 0 из 3, ветка PR #1650 — 0 из 3.

Что исключено: grader не менялся по сути; инструменты те же, что у других case-ов, где Bash вызывается; scaffold
по-прежнему объявляет `tickets.path` и четыре открытых тикета; ход не считается разговорным — блок пишется 3 из 3;
правила не обрезаны — с длинным корнем plugin-а `orchestrator.md` занимает 9884 из 10000 символов, шаг внутри текста;
модель и judge те же с 2026-10-18.

Что остаётся — текст правила даёт модели два выхода:

1. `orchestrator.md:121-122` — «run `epic-status` … after any ticket status change of this turn». Читается как
   условие: статус не менялся — запуска нет.
2. `orchestrator.md:129` — шаблон «Stage: <a line of epic-status output, or one phrase naming the stage>» разрешает
   свою фразу; условие, когда фраза допустима, стоит в другом абзаце.

До #688 case тоже падал 4 из 4, так что пункт 1 — не вся причина: на мелком ходе модель не тратит вызов Bash, к которому
её не обязали. Без transcript-ов это вывод, а не наблюдение: ни одного transcript-а прогона `status-block` не сохранилось.

## Что делаем

1. `orchestrator.md:121-124`: `epic-status` запускается на каждом рабочем ходе, когда проект ведёт тикеты, меняли ли
   статус или нет; строку Stage копировать из этого запуска; только потом писать блок. Без тикетов — одна фраза.
2. `orchestrator.md:129`: в шаблоне вместо «или фраза» — «<a line of this turn's epic-status run; a phrase only with
   no tickets>».
3. Три проверки «Phase 3» в `harness/hooks/tests/rules-hooks.test.sh:516-531` (путь один раз, до блока, «only then write
   the block» между ними) и предел 10000 символов внедряемых правил остаются зелёными.
4. Платный прогон case-а, 3 раза, с `--keep-temp`. Если не проходит — прочитать transcript-ы и предложить следующую
   формулировку (например, запуск `epic-status` — первое действие Phase 3).

Prompt case-а на ход со сменой статуса не меняем: так case проверял бы только узкое прочтение и спрятал бы дефект.
Grader и scaffold не меняются. Глубина review — `medium`. Не платформенный: только текст правил.

## Готово, когда

- [ ] Правило в `orchestrator.md` требует `epic-status` на каждом рабочем ходе проекта с тикетами, независимо от смены
  статуса; шаблон Stage допускает фразу только без тикетов.
- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` и `bash harness/bin/tests/start-context.test.sh` — exit 0
  (предел 10000 символов и проверки «Phase 3»).
- [ ] `test/contract/harness-plugin.test.ts` и `test/contract/codex-parity.test.ts`, `check-cyrillic`, lint, typecheck,
  gate fast — exit 0.
- [ ] Платный прогон `status-block` (3 раза): стоимость и балл записаны в «Итог».
- [ ] `ci-ok` зелёный на head PR.

## Тесты

- `bash harness/hooks/tests/rules-hooks.test.sh` — проверки «Phase 3» и предел внедряемых правил.
- `bash harness/bin/tests/start-context.test.sh` — пределы стартового контекста.
- `node scripts/vitest-electron.mjs test/contract/harness-plugin.test.ts test/contract/codex-parity.test.ts`.
- `node scripts/eval-harness.mjs --tag main --case status-block --runs 3 --max-cost-usd 1 --keep-temp` — сначала
  `--dry-run`.

## Итог

Два платных прогона case-а `status-block` (3 раза каждый, model claude-sonnet-5, judge claude-haiku-4-5,
claude 2.1.289), оба — балл 0.50, 0 из 3 прошли:

- Формулировка 1 (абзац «on every working turn … whether or not a ticket status changed», commit `cfca4096d`):
  $0.37. `ends-with-status-block` 3 из 3, `epic-status-ran` 0 из 3.
- Формулировка 2 (Phase 3 — два шага по порядку: 1 — `epic-status`, 2 — блок; commit `cc7e6e3bf`): $0.40.
  `ends-with-status-block` 3 из 3, `epic-status-ran` 0 из 3.

Итого $0.77. Балл тот же, что у main (0 из 3 на `d84a7b91e`).

Что видно в transcript-ах (`--keep-temp`): новый текст правил дошёл до модели в обоих прогонах (вывод hook-а
SessionStart). Все шесть ходов одинаковы: поиск файла → Read → Edit → ответ → блок, Stage — своя фраза («правка
внесена, не закоммичена»). В 4 из 6 ходов модель сама вызвала `bin/profile --field tickets.path`, получила путь —
и всё равно не запустила `epic-status`. В первом прогоне Stage одного хода — «тикеты не менялись по статусу»: модель
по-прежнему связывает запуск со сменой статуса. Формат блока модель держит всегда; лишний вызов инструмента после
сделанной работы — нет. Текстом правила это не лечится: обе формулировки не сдвинули ни одного хода.

Решение — за Orchestrator-ом: механическая проверка (hook, который видит строку Stage без вызова `epic-status`
в проекте с тикетами) или сузить case.

## Где в коде

- `harness/hooks/rules/orchestrator.md:121-124` — шаг запуска `epic-status`; `:129` — шаблон строки Stage.
- `harness/hooks/tests/rules-hooks.test.sh:516-531` — проверки «Phase 3»; `:34` — предел 10000.
- `harness/evals/status-block/` — case (prompt, grader `epic-status-ran`, scaffold) — только читается.
- `harness/evals/lib/demo-project.sh:351-353` — `tickets.path` проекта demo — только читается.

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

Решение владельца 2026-11-08: строку `epic-status` даёт hook, а не сама модель. Два платных прогона с правкой одного
текста правил (см. «Итог») не сдвинули ни одного хода.

1. Hook `UserPromptSubmit` — `harness/hooks/stage-lines.mjs` (в `harness/hooks/hooks.json`, limit 10 s). В проекте,
   который ведёт тикеты (`bin/profile --field tickets.path`; Silent mode тоже), он запускает `bin/epic-status` и отдаёт
   строки как additionalContext под заголовком «Stage lines of bin/epic-status for this turn…». Строки — только Epic-ов
   в работе: Epic текущей ветки (`<epic>/<NN>`), потом Epic-и с claimed Ticket-ом, потом с blocked; если таких нет —
   Epic-и, которые не closed. Не больше 3 строк, строка — до 300 символов, весь текст — до 1200.
2. Ничего не печатает: без тикетов, в Product Session (`WORFY_SESSION_KIND=product`), для Subagent-а (`agent_id` или
   `agent_type` во входе). Любая ошибка — stdin не JSON, `epic-status` упал или висит дольше 2.5 s — одна строка в
   stderr и exit 0: prompt не задерживается. Codex знает этот event (`UserPromptSubmit` с additionalContext) — там hook
   отвечает так же.
3. `orchestrator.md`, «Phase 3»: строка Stage — строка `epic-status`, которую hook дал с prompt-ом этого хода. Самому
   запускать `epic-status` — только после смены статуса тикета в этом ходе или когда hook строк не дал. Шаблон Stage:
   «<this turn's epic-status line; a phrase only with no tickets>».
4. Eval case `status-block`: grader `epic-status-ran` заменён на `stage-is-epic-status-line` — строка Stage ответа равна
   строке `epic-status` проекта scaffold-а (`/to-tickets · demo 0/4 · ticket 01 — alpha: …`). `ends-with-status-block`
   остаётся. Новый grader `ticket-edited` (`tool_used`, Edit файла `04-delta.md`): у каждого case-а должен быть
   grader `tool_used` (`test/contract/harness-evals.test.ts`), и он же показывает, что ход рабочий. Prompt и scaffold
   не меняются.
5. Test-ы в `rules-hooks.test.sh`, раздел 9: проект с тикетами — строка есть; без тикетов, Product Session, Subagent —
   ничего; `epic-status` падает или висит — prompt не задержан, exit 0; порядок Epic-ов и предел в 3 строки.

Prompt case-а на ход со сменой статуса не меняем: так case проверял бы только узкое прочтение и спрятал бы дефект.
Глубина review — `medium`. **Платформенный**: меняется hook, вердикт — job-ы Windows в CI.

## Готово, когда

- [ ] Hook `stage-lines.mjs` в проекте с тикетами отдаёт строки `epic-status` Epic-ов в работе (не больше 3); без
  тикетов, в Product Session и для Subagent-а — ничего.
- [ ] `epic-status`, который падает или висит, не задерживает prompt: exit 0, ничего в stdout.
- [ ] «Phase 3» в `orchestrator.md`: Stage копируется из строк hook-а; свой запуск — после смены статуса или без строк.
- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` и `bash harness/bin/tests/start-context.test.sh` — exit 0
  (предел 10000 символов и проверки «Phase 3»).
- [ ] `test/contract/harness-plugin.test.ts`, `test/contract/codex-parity.test.ts`, `test/contract/harness-hook-stdin.test.ts`,
  `test/contract/harness-evals-run.test.ts`, `check-cyrillic`, lint, typecheck, gate fast — exit 0.
- [ ] Платный прогон `status-block` (3 раза) с hook-ом: стоимость и балл записаны в «Итог»; время hook-а на этом
  репозитории записано в «Итог».
- [ ] `ci-ok` зелёный на head PR, job-ы Windows в нём зелёные.

## Тесты

- `bash harness/hooks/tests/rules-hooks.test.sh` — проверки «Phase 3», предел внедряемых правил, раздел 9 (hook).
- `bash harness/bin/tests/start-context.test.sh` — пределы стартового контекста.
- `node scripts/vitest-electron.mjs test/contract/harness-plugin.test.ts test/contract/codex-parity.test.ts
  test/contract/harness-hook-stdin.test.ts test/contract/harness-evals-run.test.ts`.
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

Решение владельца 2026-11-08: строку даёт hook `UserPromptSubmit` (раздел «Что делаем»).

Третий платный прогон, с hook-ом (commit `4bc10474a`): балл 1.00, 3 из 3, $0.37. `ends-with-status-block` 3 из 3,
`stage-is-epic-status-line` 3 из 3. В transcript-е хода — grep → Read → Edit, без вызова `epic-status`, и строка
«— Stage: /to-tickets · demo 0/4 · ticket 01 — alpha: функция double» — копия строки hook-а. Все три платных прогона —
$1.14. Grader `ticket-edited` добавлен после этого прогона; по transcript-ам все три хода сделали Edit файла
`04-delta.md`, так что он прошёл бы 3 из 3 (платно не перепроверялось).

Цена: hook работает на каждом prompt-е Session разработчика в проекте с тикетами (не в Product Session, не в
Subagent-е). Время hook-а `stage-lines.mjs` на этом репозитории (889 тикетов, 38 Epic-ов, macOS): 0.9–1.0 s wall time
на prompt (три замера: 0.90, 1.00, 1.01 s); оба запуска `epic-status` идут параллельно — по очереди было 1.8–2.1 s. На
проекте demo — около 1 s, почти всё — старт трёх процессов node.

## Где в коде

- `harness/hooks/stage-lines.mjs` — новый hook `UserPromptSubmit`.
- `harness/hooks/hooks.json` — hook на `UserPromptSubmit`.
- `harness/hooks/hook-stdin.mjs` — `FIRST_BYTE_MS` для `stage-lines.mjs` (2 s).
- `harness/hooks/rules/orchestrator.md:116-131` — «Phase 3», шаблон строки Stage.
- `harness/hooks/tests/rules-hooks.test.sh` — проверки «Phase 3», ожидаемый `hooks.json`, раздел 9.
- `harness/evals/status-block/graders/stage-is-epic-status-line.md` — новый grader вместо `epic-status-ran.md`;
  `graders/ticket-edited.md` — grader `tool_used`;
  `harness/evals/status-block/prompt.md` — описание case-а.
- `test/contract/harness-hook-stdin.test.ts` — список hook-ов с `FIRST_BYTE_MS`.
- `test/contract/harness-evals-run.test.ts` — имя grader-а в test-ах `--changed`.
- `harness/README.md`, `docs/features/skills-agents-and-hooks.md` — описание hook-а.
- `harness/evals/lib/demo-project.sh` — проект demo; только читается (scaffold case-а и test-ов раздела 9).

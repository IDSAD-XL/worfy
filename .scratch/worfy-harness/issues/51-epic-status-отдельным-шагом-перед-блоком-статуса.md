# 51 — Запуск `epic-status` — отдельный шаг перед блоком статуса в правилах Orchestrator-а

Type: task
Status: done 2026-10-21T14:40Z
PR: #688
Blocked by: —
Source: follow-up Ticket-а 27 (eval-кейсы Harness): платный круг 2026-10-18, кейс `status-block` — 0.50 при
пороге 0.8 («Итог» Ticket-а 27, «Ниже порога — нарушения правил Harness», на ветке `worfy-harness/27-eval`,
PR #496); решение владельца 2026-10-19, Q-d: набор из 25 run-ов, собранный из 8 вызовов, считается полным
прогоном, и Ticket 27 закрывается с двумя follow-up-ами — этим и 50.

## Что происходит

- Кейс eval `status-block` (`harness/evals/status-block/`) проверяет блок статуса в конце хода: grader
  `ends-with-status-block` — что блок `— Этап / Сейчас / Дальше / Жду` есть, grader `epic-status-ran` — что
  агент хотя бы раз запустил `epic-status` через `Bash`.
- 4 run-а из 4 (3 в наборе и один отдельный): блок есть, `epic-status` не запущен — строку Этап агент написал
  своими словами, хотя Profile `demo` ведёт Ticket-ы. Оценка — 0.50 (в наборе: 3 run-а, 0.36 USD, 45 с). Так же
  было на шаге 0 Ticket-а 27.
- Правило — в `harness/hooks/rules/orchestrator.md`, «Phase 3 — state, then report» (`:113-133`): запуск
  `epic-status` — условие внутри списка «Rules that keep it honest» (`:127-130`), а не шаг перед блоком.
- Пара mutation Ticket-а 27 сработала наполовину: копия правил без «Phase 3» — 0.00 (пропал и блок),
  настоящий Harness — 0.50 и код 1, а не 1.00 и код 0.

## Что делаем

1. В «Phase 3» `orchestrator.md` — явный шаг перед блоком: когда Project ведёт Ticket-ы (`tickets.path`),
   запустить `${CLAUDE_PLUGIN_ROOT}/bin/epic-status <epic>` (без одного Epic-а — без аргумента) и взять строку
   Этап из его вывода этого хода; только потом писать блок. Без Ticket-ов — одна фраза, как сейчас.
2. Пункт из списка «Rules that keep it honest» убрать или сократить до ссылки на шаг, чтобы правило не было
   записано дважды.
3. Перепрогнать кейс `status-block`: 3 run-а, оценка ≥ 0.8.

**Прогон платный.** Оценка по прайсу набора — около 0.4 USD за 3 run-а; run-ы тратят лимит подписки. Вызов:
`pnpm eval:harness -- --tag main --case status-block --runs 3 --max-cost-usd 1`.

**Docker.** Eval с `Bash` Claude Code не запускает, пока в `~/.docker` лежат символические ссылки (папка
`~/.docker/bin/lib` от Docker Model Runner; «Итог» Ticket-а 27, «Прогон 2026-10-18, вечер»). Перед прогоном —
перенести `~/.docker/bin` вне `~/.docker` (например, `mv ~/.docker/bin ~/docker-bin.off`), после — вернуть
(`mv ~/docker-bin.off ~/.docker/bin`). Проверка: `find ~/.docker -type l -not -path '*/cli-plugins/*'` — пусто.

## Готово, когда

- [ ] «Phase 3» `orchestrator.md` начинается шагом с запуском `epic-status`; правило записано один раз.
- [ ] `harness/hooks/tests/rules-hooks.test.sh` — новый случай: шаг с `epic-status` стоит перед блоком статуса;
      красный на main.
- [ ] `pnpm eval:harness -- --tag main --case status-block --runs 3` — оценка ≥ 0.8; таблица вызова (оценка,
      run-ы, цена, время, код выхода) — в «Итог».
- [ ] `~/.docker/bin` возвращена на место после прогона.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; после мержа —
      `pnpm install:stable` (ADR-0047).

## Тесты

Сначала падающий случай в `harness/hooks/tests/rules-hooks.test.sh` (он уже читает `orchestrator.md`). Поведение
проверяет кейс eval `status-block` (платно, см. выше).

## Где в коде

- `harness/hooks/rules/orchestrator.md`
- `harness/hooks/tests/rules-hooks.test.sh`

## Итог

PR [#688](https://github.com/IDSAD-XL/worfy/pull/688), merge cb41c78d. Gate full на main 52ff0dab зелёный; Windows verdict
зелёный. Платформенный PR (`harness/hooks`).

- **Правило.** В «Phase 3» `harness/hooks/rules/orchestrator.md` запуск `epic-status` — отдельный абзац перед блоком
  статуса: «Right before the block, run `epic-status` … after any ticket status change of this turn … only then write
  the block». Без Ticket-ов строка Stage — одна фраза, как раньше. Пункт из «Rules that keep it honest» удалён — правило
  записано один раз. Метки блока на main уже английские (`— Stage / Now / Next / Waiting`, epic worfy-neutral).
- **Test** (`rules-hooks.test.sh`, три проверки внутри «Phase 3»): запуск `epic-status` стоит раньше строки `— Stage:`;
  полный путь `bin/epic-status` — ровно один, и после `— Stage:` нет ни одного упоминания `epic-status`; фраза «only
  then write the block» — между запуском и блоком. На тексте main — exit 1 (все три падают), с правкой — exit 0, 201
  passed. Мутанты (старый пункт вместо шага; шаг плюс старый пункт; пункт без пути под блоком; фраза под блоком) —
  красные. Размер правил с длинным путём plugin-а — 9827 из 10000.
- **Ревью:** два круга, глубина medium. Круг 1 — correctness и tests PASS, 4 low; три исправлены во втором круге. Открыт
  известный предел: test не проверяет смысл шага — это сторожит eval-кейс `status-block`.
- **Не сделано — шаг владельца:** платный повтор кейса `status-block` (3 run-а, оценка ≥ 0.8;
  `pnpm eval:harness -- --tag main --case status-block --runs 3 --max-cost-usd 1`, перед ним `~/.docker/bin` вынести
  из `~/.docker`) и `pnpm install:stable` (ADR-0047).

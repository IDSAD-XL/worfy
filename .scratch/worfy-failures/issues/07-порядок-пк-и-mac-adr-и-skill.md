# 07 — Порядок ПК → Mac: ADR и skill `epic-wave`

Type: task
Status: claimed 2026-11-05T02:54Z
Branch: worfy-failures/07
Blocked by: 02, 03, 04, 05, 06
Source: [spec.md](../spec.md), «Вопросы владельцу», Q1, Q2, Q3 (решения владельца 2026-11-04 — А и В, А, да); «Риски», п. 3; [ADR-0086](../../../docs/adr/0086-pc-gate-full-once-per-wave.md), пункты 2–4

## Что происходит

- ADR-0086, пункт 2: Session на ПК сообщает SHA, код выхода и строку вердикта gate full; пункт 3 (строки 37-41):
  красный — повтор упавших test-ов поодиночке руками, зелёные поодиночке — flaky, «отчёт со списком и кодами
  выхода»; пункт 4 — issue `pc-main-red` с отчётом в теле.
- То же в skill: `harness/skills/epic-wave/SKILL.md:973-978` — «that session first runs the failing tests once more,
  one at a time».
- К claim влиты 02–06: gate пишет записи, reporter-ы worfy их дают, есть `rerun`, `report`, `export`, `import`.
- `rules.md` Profile-а worfy на каждой машине — свой (ADR-0042), вне репозитория; правится только по слову
  владельца.

## Что делаем

1. Новый ADR, заголовок «<NNNN> — записи о падениях и повтор поодиночке командой; меняет ADR-0086, пункты 2–4» (номер
   — при claim, `rules-adr.md` Profile-а):
   - красный gate full → `gate-failures rerun --last` на том же SHA сразу после gate full, в том же worktree; замок
     e2e и проверку экрана `rerun` берёт сам, когда задан `workflow.e2e_lock`;
   - отчёт Session на ПК — прежние SHA, код выхода и строка вердикта плюс блок `gate-failures export --run <id>
     --run <id повтора>`; куда он идёт — по ответу на Q1 (issue `pc-main-red` при красном, PR, чей merge-коммит
     проверен, при зелёном и flaky; запасной путь — сообщение);
   - Orchestrator на Mac — `gate-failures import …`, затем `gate-failures report --days 14`; три первые строки
     отчёта — в отчёт Wave; кандидаты — `node scripts/quarantine-suggest.mjs`, запись карантина — по
     `rules-merge.md`, как сейчас, человеком или Orchestrator-ом, не командой.
2. `docs/adr/0086-pc-gate-full-once-per-wave.md` — раздел `## Amendments` (его ещё нет; заводится перед
   «Considered Options») с датированной записью по образцу ADR-0056 («**2026-10-29, ADR-0086** (…)», строка 119
   того файла): «**<дата>, ADR-<NNNN>** (`worfy-failures` 07). Пункт 3: повтор — `gate-failures rerun`; пункты 2 и
   4: отчёт несёт блок export». Текст пунктов не правится.
3. `harness/skills/epic-wave/SKILL.md` — тот же порядок в общем виде (без «worfy:» в правиле, worfy — в примере, как
   рядом); английский текст (ADR-0074).
4. (вручную) Владелец даёт слово на правку `rules.md` Profile-а на Mac и на ПК; Orchestrator правит Mac, Session на
   ПК — ПК; дифф обоих — в «Итог».

## Готово, когда

- [ ] ADR принят владельцем, вторая строка «Дата: … Статус: принят.», заголовок кончается «меняет ADR-0086, пункты
      2–4», ссылки на ADR-0086 и этот Epic.
- [x] В ADR-0086 — раздел `## Amendments` с датированной записью; остальной текст ADR-0086 не изменён (дифф — только
      новый раздел).
  - evidence: commit pass · ADR-0096: failure records and solo rerun by command, amends ADR-0086 points 2-4 (worfy-failures 07) · - - · 75d15d31fbee7fba45c73ac75b81c369e0c9838a
- [x] `harness/skills/epic-wave/SKILL.md` описывает `rerun`, `export`, `import`, `report`; ручного «one at a time»
      больше нет.
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0 · mac - · 75d15d31fbee7fba45c73ac75b81c369e0c9838a
- [x] Shell test-ы текста skill-ов (`harness/bin/tests/skill-blocks.test.sh`, `skill-text.sh`,
      `plugin-neutral.test.sh`) зелёные.
  - evidence: test-run pass · `bash harness/bin/tests/skill-blocks.test.sh` and `bash harness/bin/tests/plugin-neutral.test.sh` exit 0 · mac - · 75d15d31fbee7fba45c73ac75b81c369e0c9838a
  - evidence: gate pass · `gate fast` exit 0 · mac - · 75d15d31fbee7fba45c73ac75b81c369e0c9838a
- [ ] (вручную) `rules.md` Profile-а на Mac и на ПК поправлены после слова владельца; дифф в «Итог».
- [ ] После merge — `pnpm install:stable` и Replace Harness на Mac; `claude plugin list` показывает новый Harness.
- [ ] `pnpm lint` — exit 0; CI PR зелёный.

## Тесты

- Test кода нет. Проверка — shell test-ы текста skill-ов и `scripts/check-cyrillic.mjs` (в `pnpm lint`).
- Сначала падающий: строка «one at a time» в SKILL.md найдена test-ом `skill-text.sh`, если он проверяет форму
  команд; иначе — нет падающего test-а, это документный Ticket.

## Где в коде

- `docs/adr/<NNNN>-failure-records-and-solo-rerun.md` (новый)
- `docs/adr/0086-pc-gate-full-once-per-wave.md` (только новый раздел `## Amendments`)
- `harness/skills/epic-wave/SKILL.md`

Только читать: `docs/adr/0056-windows-checks-and-two-sessions.md:112-119` (форма `## Amendments`), `harness/lib/gate-failures/` (Ticket-ы 04–06),
`scripts/quarantine-suggest.mjs` (Ticket 05). Вне репозитория (вручную): `~/.claude/worfy-harness/projects/worfy/rules.md`
на Mac и `%USERPROFILE%\.claude\worfy-harness\projects\worfy\rules.md` на ПК.

## Итог

Сделано в ветке `worfy-failures/07`.

- `docs/adr/0096-failure-records-and-solo-rerun.md` — новый ADR «записи о падениях и повтор поодиночке командой; меняет
  ADR-0086, пункты 2–4». Пункт 1: красный gate full на ПК → `gate-failures rerun --last` на том же SHA и в том же worktree;
  код 0 — flaky, код 2 — `main` красный, код 3 считается как 2 (после устранения отказа из-за дерева — повтор). Пункт 2:
  отчёт ПК несёт код `rerun` и блок `gate-failures export --run <id>` (файлы повтора export берёт сам); куда — по Q1.
  Пункт 3: issue `pc-main-red` — отчёт плюс блок export. Пункт 4: Orchestrator на Mac — `gate-failures import --gh … --issue N`
  / `--pr N` / `-`, затем `gate-failures report --days 14`, три первые строки — в отчёт Wave; кандидаты —
  `node scripts/quarantine-suggest.mjs`, запись в карантин — человеком или Orchestrator-ом.
- `docs/adr/0086-pc-gate-full-once-per-wave.md` — только новый раздел `## Amendments` с записью от 2026-11-05;
  `git diff origin/main -- docs/adr/0086-pc-gate-full-once-per-wave.md` — одни добавленные строки.
- `harness/skills/epic-wave/SKILL.md` (раздел 4, «A check that answers on the main branch after the merge») — `rerun`,
  `export`, `import`, `report` в общем виде, worfy — только в примерах в скобках; ручного повтора «one at a time» нет.
- Вне «Где в коде»: `harness/bin/tests/epic-wave-ship-ticket.test.sh` проверял старую фразу о ручном повторе. Две старые
  проверки заменены двенадцатью новыми (команда `rerun`, замок e2e, коды 0/2/3, блок export, `import`, `report`, карантин не
  командой) и проверкой, что старой фразы нет. До правки skill — 12 красных, после — `passed 599, failed 0`.
- Проверки на Mac 2026-11-05: `epic-wave-ship-ticket.test.sh`, `skill-blocks.test.sh`, `skill-blocks-gate.test.sh`,
  `plugin-neutral.test.sh`, `skill-positional-tokens.test.sh`, `skills-allowed.test.sh`, `agents-text.test.sh`,
  `decision-log.test.sh`, `max-review.test.sh`, `silent-mode.test.sh`, `review-depth.test.sh` — exit 0;
  `node scripts/check-cyrillic.mjs`, `pnpm lint`, `pnpm typecheck` — exit 0. `skill-text.sh` — библиотека, которую
  подключают test-ы выше, своего запуска у неё нет. `pnpm test` целиком локально не гонялся (по брифу) — его гоняет CI PR.

Доработка, раунд 1 (замечания проверки PR #1412):

- Код 0 `rerun` больше не читается как «`main` не красный» сам по себе. `rerun` печатает упавший шаг без test-ов
  строкой `  step without tests, not rerun: <step>` (`harness/lib/gate-failures/rerun.mjs:243`) и при зелёных
  test-ах возвращает 0 (`rerun.mjs:356-357`): красный typecheck плюс flaky e2e давали код 0. Теперь в SKILL.md
  (раздел 4) и в ADR-0096, пункт 1: с такой строкой `main` красный, как при коде 2. Повтор с `--file` шагов не
  печатает (`rerun.mjs:209`), тогда решает строка gate `--- failure records: <file> (<n> tests, <m> steps without
  tests)` (`harness/hooks/gate.mjs:912`): `<m>` больше 0 — красный. В «Последствиях» ADR-0096 — то же.
- Id run-а при отказе `rerun` (код 3, в stderr только `gate-failures rerun: <reason>`, `rerun.mjs:169-172`) — первое
  слово строки `gate-failures list` (`harness/lib/gate-failures/list.mjs:76-80`): самая новая строка с первыми 12
  знаками проверенного SHA без пометки `imported`. Такой строки нет — gate записей не сохранил
  (`--- failure records: not saved, <why>`, `gate.mjs:905`): блока нет, отчёт говорит, что записи не переданы.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`: старая проверка кода 0 заменена; новые проверяют обе фразы,
  отсутствие старой безусловной фразы и что цитируемые строки есть в `rerun.mjs`, `list.mjs`, `gate.mjs`. Пять
  мутантов копии SKILL.md в scratchpad (убрана фраза о строке шага, возвращена старая фраза кода 0, убрано «refused»,
  убрано «No such line», убрано «narrowed by `--file`») — каждый exit 1. Без мутантов — `passed 612, failed 0`.

Решено без владельца, подтвердить:

1. ADR-0096 принят по ответам владельца Q1–Q3 от 2026-11-04 — решено без владельца, подтвердить.
2. Раздел `## Amendments` в ADR-0086 стоит в конце файла, после «Considered Options», а не перед ним, как сказано в
   «Что делаем», п. 2: так требует `rules-adr.md` Profile-а («дописывается в конец файла») и так сделано во всех 17 ADR с
   этим разделом (ADR-0056 тоже). Текст ADR-0086 выше раздела не изменён.
3. Блок export — `gate-failures export --run <id>` с одним id, а не `--run <id> --run <id повтора>`, как в «Что делаем», п. 1:
   `--run` принимает только id run-а, файлы повтора export берёт вместе с run-ом сам (`harness/lib/gate-failures/export.mjs:6-8`).
4. Код 3 `rerun` (шаг без test-ов, test без команды повтора, отказ) считается как красный повтор: spec этот случай не
   называет, а «не подтверждено» безопаснее считать регрессией, чем flaky.
5. Блок export при зелёном повторе — комментарием в PR, чей merge-коммит проверял gate full; в Wave это последний влитой PR
   Wave (gate full идёт на SHA последнего merge Wave, ADR-0086, пункт 2).

- не проверено: правка `rules.md` Profile-а worfy на Mac и на ПК — нужна команда владельца (Q3 — «да», но правка `rules.md`
  идёт только по его слову); дифф обоих — сюда после правки.
- не проверено: `pnpm install:stable` и Replace Harness на Mac после merge, `claude plugin list` — шаг Orchestrator-а.
- не проверено: CI PR — на момент записи не закончен.

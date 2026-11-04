# 07 — Порядок ПК → Mac: ADR и skill `epic-wave`

Type: task
Status: open
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
- [ ] В ADR-0086 — раздел `## Amendments` с датированной записью; остальной текст ADR-0086 не изменён (дифф — только
      новый раздел).
- [ ] `harness/skills/epic-wave/SKILL.md` описывает `rerun`, `export`, `import`, `report`; ручного «one at a time»
      больше нет.
- [ ] Shell test-ы текста skill-ов (`harness/bin/tests/skill-blocks.test.sh`, `skill-text.sh`,
      `plugin-neutral.test.sh`) зелёные.
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

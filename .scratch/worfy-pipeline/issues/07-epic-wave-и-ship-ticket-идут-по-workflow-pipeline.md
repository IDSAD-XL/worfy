# 07 — `epic-wave` и `ship-ticket` идут по `workflow.pipeline`; правило Windows — Check «windows»

Type: task
Status: open
Blocked by: 02
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 4, 5, 11 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md);
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2.

## Что происходит

- **Ждать ли вердикта другой платформы, skill `epic-wave` узнаёт из текста:** «the PRs the project's
  rules send to another platform's verdict (worfy: ADR-0056, item 2)»
  (`harness/skills/epic-wave/SKILL.md:578-583`). Сами правила — `rules.md` Profile-а worfy, раздел о
  gate перед мержем, со ссылкой на ADR-0056. Вердикт Windows приходит строкой отчёта Session на ПК.
- **Порядок шагов Ticket-а** в `ship-ticket` и `epic-wave` один для всех Project-ов: ревью, затем
  мерж по `workflow.finish` и `workflow.merge` (`harness/profiles/README.md:151-153`).
- После Ticket-а 02 есть `bin/ticket mark` (в том числе `check/<name>` и `skipped`), фильтр отметок
  в проверке CI и поле `workflow.pipeline` в `_resolved.pipeline`.

## Что делаем

1. **Skills читают Pipeline:** `bin/profile --field _resolved.pipeline` в разделе 0 `epic-wave` и в
   начале `ship-ticket`.
2. **Agent review** — там, где он стоит в Pipeline: после CI (worfy) или до PR (Atakama, Silent
   mode: ревью идёт по локальной ветке, отметка — на её head SHA, PR открывается после
   `review success`). Нет Agent review в Pipeline — ревью агентом нет.
3. **Check «<name>».** Перед мержем skill ждёт `check/<name>` `success` или `skipped` на head SHA
   каждого PR. Orchestrator ставит `skipped`, когда PR не требует этой проверки по правилам Project-а
   (для `windows` — ADR-0056, пункт 2, решает, какой PR платформенный), и `success` или `failure` —
   по вердикту Session на ПК (gate full, код 0 и `[gate] зелено (full)`). Набор `wave-gate`
   (ADR-0065) берёт только PR с пройденными Check-ами; `PLATFORM=(…)` в блоке набора
   (`harness/skills/epic-wave/SKILL.md:605-613`) заполняется из PR, у которых Check не `skipped`.
4. **Human review и Awaiting merge** — skill не мержит: Ticket остаётся ждать людей, Wave
   продолжается без него (как `workflow.merge: null` сейчас).
5. **Deploy** — после мержа skill не закрывает Ticket, пока Deploy не пройден, если Deploy есть в
   Pipeline; у worfy — `pnpm install:stable` Orchestrator-а (ставит отметку, Ticket 02).
6. **Правка Profile-а worfy (Orchestrator после мержа):** `rules.md` — абзац о вердикте Windows
   ссылается на Check «windows» вместо текста; diff — в «Итог».

Не входит: код worfy; новые виды Stage.

## Готово, когда

- [ ] `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0: блоки skills читают
      `_resolved.pipeline`; Check без отметки держит PR вне набора; `skipped` — пропускает.
- [ ] `bash harness/bin/tests/skill-blocks.test.sh` — exit 0.
- [ ] `bash harness/bin/tests/agents-text.test.sh` — exit 0 (текст skills без ссылки на ADR-0056 как на
      правило ожидания).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную, Orchestrator) первая Wave после `pnpm install:stable`: платформенный PR ждёт
      `check/windows`, обычный — `skipped`; номера PR — в «Итог».

## Тесты

Сначала падающий случай в `epic-wave-ship-ticket.test.sh`: Pipeline с Check «windows» и PR без
отметки — skill не включает его в набор. `gh` и gate — stub-ы; без платных прогонов.

## Где в коде

- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`

## Итог

Заполняется при закрытии.

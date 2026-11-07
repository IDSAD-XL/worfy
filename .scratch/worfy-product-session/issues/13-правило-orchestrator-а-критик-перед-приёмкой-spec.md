# 13 — Правило Orchestrator-а: критик перед приёмкой spec

Type: task
Status: blocked 2026-11-07T20:19Z
Blocked reason: ждёт Epic worfy-skills целиком (spec.md, «Волны»)
Waits: agent
Blocked by: 11
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 7; «Решено без владельца», п. 6; «Вопросы владельцу», Q8; «Риски», п. 6; карта [worfy-product](../../worfy-product/map.md), решения 03 (Q3), 08 (Q1)

**Ждёт Epic `worfy-skills` целиком** (как все Wave-ы Harness этого Epic-а).

Не платформенный Ticket: текст правил и агента, без кода hook-ов. Глубина ревью — `medium`.

## Что происходит

- Правила Orchestrator-а — `harness/hooks/rules/orchestrator.md`, 9637 символов; предел части — 10000
  (`harness/hooks/inject-rules.mjs:24`), проверка с длинным корнем plugin-а — `harness/hooks/tests/rules-hooks.test.sh:116`.
- Критик — `harness/agents/critic.md` (Ticket 11), пишет разбор в `docs/product/critic/`.
- Строка `Status:` spec-а — текст Project-а; «принят» читается по словам `harness/lib/input-words.json`
  (`specAccepted`), TICKETS.md «Spec status».

## Что делаем

1. Одна строка в `orchestrator.md` (≤ 300 символов): перед тем как просить владельца принять `spec.md` нового Epic-а,
   запусти Subagent `worfy:critic` на нём; ссылку на разбор — в шапку spec-а строкой `Критик:` (на языке Project-а);
   владелец может принять вопреки.
2. В `critic.md` — раздел «Before a spec is accepted»: что Orchestrator передаёт (путь spec-а, roadmap, `epic-status`),
   как отвечает (путь файла и вердикт), что Orchestrator показывает владельцу (вердикт и возражения одной таблицей) и
   как пишет `Решение владельца:` под каждым возражением по его слову.
3. Spec, принятый вопреки критику, — обычный принятый spec; worfy этого не проверяет и не блокирует.

## Готово, когда

- [ ] `orchestrator.md` со строкой ≤ 10000 символов и с длинным корнем plugin-а (`rules-hooks.test.sh` exit 0).
- [ ] `critic.md` описывает вход и выход для Orchestrator-а; test-ы plugin-а зелёные.
- [ ] Проверка на Mac Stable: Orchestrator перед приёмкой черновика spec-а сам зовёт критика, разбор лежит в
      `docs/product/critic/`, spec ссылается на него — ссылка на транскрипт в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Shell `harness/hooks/tests/rules-hooks.test.sh`.
- Contract `test/contract/harness-plugin.test.ts`.

## Где в коде

- `harness/hooks/rules/orchestrator.md`
- `harness/agents/critic.md`

Только читать: `harness/lib/input-words.json`, `harness/bin/TICKETS.md` («Spec status»), `harness/skills/to-spec/SKILL.md`.

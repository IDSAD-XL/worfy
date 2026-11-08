# 13 — Правило Orchestrator-а: критик перед приёмкой spec

Type: task
Status: done 2026-11-08T17:27Z
PR: #1675
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
   как пишет `Owner decision: accepted — <причина>` или `rejected — <причина>` под каждым возражением по его слову.
3. Spec, принятый вопреки критику, — обычный принятый spec; worfy этого не проверяет и не блокирует.

## Готово, когда

- [ ] `orchestrator.md` со строкой ≤ 10000 символов и с длинным корнем plugin-а (`rules-hooks.test.sh` exit 0).
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 (287 passed; orchestrator 9990 characters with a long plugin root) · mac - · 7831a673b1cda952fedda6d1f16e907c6e8008d4
  - evidence: review pass · PR #1675 · - - · be3d23b61080f0bde3e21607f9876fc0524b42ec
- [ ] `critic.md` описывает вход и выход для Orchestrator-а; test-ы plugin-а зелёные.
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh`, start-context, plugin-neutral, agents-text and contract tests harness-plugin, codex-parity, harness-evals, harness-evals-run exit 0 · mac - · 7831a673b1cda952fedda6d1f16e907c6e8008d4
  - evidence: review pass · PR #1675 · - - · be3d23b61080f0bde3e21607f9876fc0524b42ec
- [ ] Проверка на Mac Stable: Orchestrator перед приёмкой черновика spec-а сам зовёт критика, разбор лежит в
      `docs/product/critic/`, spec ссылается на него — ссылка на транскрипт в «Итог».
  - evidence: review pass · PR #1675 · - - · be3d23b61080f0bde3e21607f9876fc0524b42ec
  - evidence: owner-check pass · Mac Stable 0.3.0, session 6e11ae60: orchestrator ran worfy:critic on .scratch/worfy-scrub/spec.md before asking the owner; review docs/product/critic/worfy-scrub-2026-11-08.md (Keep, 3 objections); spec header line Критик:; owner saw the table and answered Q1-Q10 · mac stable · 028784c6c586f3e694b95345e4aad2b256b02792
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 7831a673b1cda952fedda6d1f16e907c6e8008d4
  - evidence: gate pass · `gate fast` exit 0 · mac - · 7831a673b1cda952fedda6d1f16e907c6e8008d4
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42482439128/job/128741160739 · ci - · be3d23b61080f0bde3e21607f9876fc0524b42ec

## Тесты

- Shell `harness/hooks/tests/rules-hooks.test.sh`.
- Contract `test/contract/harness-plugin.test.ts`.

## Где в коде

- `harness/hooks/rules/orchestrator.md`
- `harness/agents/critic.md`

Только читать: `harness/lib/input-words.json`, `harness/bin/TICKETS.md` («Spec status»), `harness/skills/to-spec/SKILL.md`.

## Итог

Живая проверка пункта 3 — 2026-11-08, Mac Stable 0.3.0, Session `6e11ae60` (транскрипт на машине владельца, по этому
id). Orchestrator до просьбы о приёмке spec-а Epic-а `worfy-scrub` сам позвал `worfy:critic`, передав только путь к
spec-у. Разбор — [docs/product/critic/worfy-scrub-2026-11-08.md](../../../docs/product/critic/worfy-scrub-2026-11-08.md),
verdict Keep, три возражения; в шапке spec-а строка `Критик:`. Владелец получил таблицу по `critic.md`, шаг 4, и
ответил «все да»; строки `Owner decision:` заполнены. Отступление: в брифе критику не было пути к roadmap и строк
`epic-status` (шаг 1 `critic.md`); у проекта нет roadmap-а в `docs/product/`, на разбор это не повлияло.

# 37 — Модель и effort по роли Harness из Profile: Sonnet для scout и reviewer, Opus — явным выбором

Type: task
Status: claimed 2026-10-29T05:33Z
Branch: worfy-throughput/37
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket, чтобы хватало Limits подписки», идея 3, строка L4
таблицы «Цель и числа»; правило «без haiku, минимум sonnet» — [`worfy-daily` 07](../../worfy-daily/issues/07-модель-без-haiku.md);
[`worfy-onboarding`](../../worfy-onboarding/spec.md), решение Р5.

## Что происходит

- implementer — `model: inherit`, `effort: high` (`harness/agents/implementer.md:4-5`); reviewer — то же
  (`harness/agents/reviewer.md:5-6`); scout — `model: sonnet`, `effort: medium` (`harness/agents/scout.md:5-6`).
  `inherit` — модель Orchestrator-а, у владельца это Opus 5.5.
- Цена API: Sonnet 5.5 — вход $2, выход $10 за 1 млн; Opus 5.5 — $4 и $20 (`scripts/agent-cost.mjs:27-28`). Как
  Sonnet считается в окне Limits «all models» — не мерили; у worfy есть место для окна `seven_day_opus`
  (`src/shared/agent/limits.ts:45`).
- Правило «минимум sonnet» живёт в коде worfy (`isSelectableModel`, `src/shared/agent/settings.ts`;
  `worfy-daily` 07, «Итог»), не в Harness.
- `worfy-onboarding` Р5: «effort Subagent-ов задаёт их определение … plugin ради demo не меняется». Р5 касается
  только Demo project, и 37 ему не противоречит: без поля в Profile Demo project frontmatter агентов действует, как
  раньше. Если Ticket-ы onboarding захотят Sonnet для Subagent-ов demo — через поле этого Ticket-а; согласовать с
  `worfy-onboarding` 09 при claim.

## Что делаем

1. Поля Profile `agents.<роль>.model` и `agents.<роль>.effort` для `implementer`, `reviewer`, `scout`, `verifier`:
   модель — `sonnet` или `opus`; effort — `low`, `medium`, `high`. `haiku` schema не принимает. Нет поля — как
   сейчас (frontmatter агента).
2. Skill-ы `epic-wave` и `ship-ticket` передают модель и effort в вызов агента (параметры `model` и `effort` tool-а
   Agent). При claim — по документации Claude Code (описание tool-а Agent и frontmatter subagent-ов) проверить, что
   параметры действуют для агента plugin-а; живая проверка — только ручным пунктом с «да» владельца. Не действуют —
   записать в «Итог» и свести Ticket к полю модели.
3. Аргумент skill-а или слово владельца («Ticket 05 — opus») перекрывает поле для одного Ticket-а; отчёт называет
   модель и effort каждого агента и откуда они взяты.
4. Frontmatter агентов не меняется, пока Profile не задал поле: старые Profile работают как раньше.

Нужен ПК: нет. **Трогает Harness: да** — `epic-wave`, `ship-ticket`, `profiles/README.md`, schema; слово владельца
 дано (Q-L0 spec-а: «да» 2026-10-28). Вердикт Windows: не платформенный PR, если не меняются скрипты `harness/bin` (test-ы в
`harness/bin/tests/` не в счёт). Общие файлы с 36 —
claim после 36.

## Готово, когда

- [ ] Сначала падающий test: schema отвергает `agents.implementer.model: "haiku"` и принимает `sonnet`, `opus`,
      отсутствие поля.
- [ ] Сначала падающий shell test текста skill-ов (`harness/bin/tests/skill-blocks.test.sh` или
      `epic-wave-ship-ticket.test.sh`): строка вызова агента с моделью и effort из `F agents.<роль>`, строка отчёта
      `Model: <модель> (<откуда>)`, фраза о том, что аргумент skill-а и слово владельца перекрывают поле Profile —
      exit 0 после правки.
- [ ] Значения Profile worfy по ответу на Q-L3 (2026-10-28): scout и reviewer на глубине `low` — Sonnet сразу;
      implementer — Sonnet только после итога Ticket-а 43, до него `inherit`.
- [ ] Schema test — по образцу `harness/bin/tests/review-depth.test.sh`, раздел 2.
- [ ] Shell test-ы Harness — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok`.
- [ ] Платный eval — только с «да» владельца и ценой из команды, которую eval реально запустит (решение 14 раздела «процесс»;
      урок 2026-10-22: $30,29 вместо одобренных ~$1).
- [ ] (вручную, с «да» владельца) Одна Wave с `agents.reviewer.model: sonnet`: модель в транскриптах reviewer-ов (поле `model`
      ответа) — в «Итог».

## Где в коде

- `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md` — места запуска агентов
- `harness/profiles/README.md`, `harness/profiles/draft.schema.json`
- Только читать: `harness/agents/*.md` (frontmatter), `src/shared/agent/settings.ts`

## Вне скоупа

- Модель Orchestrator-а — модель пользователя (`worfy-daily` 07); не меняется.
- Значения для Profile worfy — Q-L3 spec-а; preset Pro — Ticket 42.

## Итог

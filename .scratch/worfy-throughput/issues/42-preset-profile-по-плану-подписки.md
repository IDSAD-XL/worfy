# 42 — Preset Profile по плану подписки: worfy узнаёт план и предлагает настройки для Pro

Type: task
Status: open
Blocked by: 36, 37, 41
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket, чтобы хватало Limits подписки», идея 9, строка L2
таблицы «Цель и числа», риск «На Pro может не быть Opus»; [`worfy-onboarding`](../../worfy-onboarding/spec.md),
решение Р5 и [Ticket 09](../../worfy-onboarding/issues/09-подсказки-stage-й-режим-дешевле-и-пример-доработки.md)
(переключатель «дешевле / дороже» Demo project) — Epic не правится, согласовать при claim.

## Что происходит

- Имя плана приходит в `accountInfo().subscriptionType`: Session пишет его в событие `account`
  (`src/main/agent/session.ts:618-629`), First run показывает его в проверке входа
  (`src/main/first-run/checks.ts:391-395`). Ответ usage имени плана не несёт (`src/shared/agent/limits.ts:126-127`).
- Какие строки там у Pro, Max 5x и Max 20x — не проверено; fake agent отвечает `'Claude Max'`
  (`src/main/agent/fake-query.ts:111`).
- Profile из worfy меняется только через `harness/bin/profile-set`, и тот пишет одно поле — `workflow.pipeline`
  (`harness/bin/profile-set:2-4`).
- `worfy-onboarding` (не начат) делает переключатель стоимости только для Demo project: Sonnet + `medium` или Opus
  (Р5). Для своих Project-ов настроек по плану нет.

## Что делаем

1. **Шаг 1 — факты.** Строки `subscriptionType` у Pro и у Max (владелец даёт свою; Pro — по документации Anthropic
   или аккаунту, который владелец назовёт). Доступен ли Opus в Claude Code на Pro — по документации. Итог — в
   «Итог»; preset Pro не опирается на Opus, пока это не подтверждено.
2. Preset — набор значений полей Ticket-ов 36, 37 и бюджета 41: Pro — `workflow.agents: "eco"`, Sonnet для всех
   ролей, effort `medium`, бюджет включён; Max — без изменений (как сейчас). Таблица preset-ов — одна константа в
   `src/shared/`.
3. `profile-set` учится писать поля `workflow.agents` и `agents.*` с той же проверкой `--expect <fingerprint>`.
   `harness/profiles/README.md` говорит, что `profile-set` пишет только `workflow.pipeline` (`:186`): эта строка и
   строки новых полей Ticket-ов 36 и 37 называют `profile-set` тем, кто их пишет.
4. При подключении Project-а и в Project settings worfy: «План: Pro. Рекомендуемые настройки для Pro: …» и кнопка
   «Применить». Без клика worfy ничего не пишет. Бюджет Autopilot (41) — в Settings worfy, тем же предложением.
5. С `worfy-onboarding` 09: тексты и выбор Sonnet/Opus Demo project — согласовать при claim, чтобы два места не
   говорили разное.

Нужен ПК: нет. **Трогает Harness: да** — `harness/bin/profile-set`; слова владельца нет (Q-L0 spec-а). Вердикт
Windows: платформенный PR (скрипт Harness, ADR-0056, пункт 2). В diff есть `test/e2e/**` — gate full на ПК владельца
(scope `pc`, `scripts/windows-verdict-scope.mjs:80`); иначе runner `full`.

## Готово, когда

- [ ] «Итог»: строки `subscriptionType` и ответ про Opus на Pro, с источником.
- [ ] Сначала падающий unit test: `subscriptionType` Pro → preset Pro; Max и неизвестная строка → нет
      предложения.
- [ ] Shell test `harness/bin/tests/profile-set.test.sh`: запись `workflow.agents` и `agents.*` с верным
      fingerprint, отказ с неверным; другие поля Profile не меняются.
- [ ] Contract test: без клика «Применить» Profile не меняется; с кликом — вызван `profile-set` с preset-ом.
- [ ] e2e (fake agent с `subscriptionType` Pro; `test/e2e/settings.spec.ts`): предложение видно в Project settings;
      снимки в двух темах.
- [ ] Shell test-ы Harness и `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; e2e — только свои spec-и;
      условие merge — `ci-ok`.

## Где в коде

- `src/main/agent/session.ts` (`:618-629`), `src/main/first-run/checks.ts` (`:391-395`)
- `harness/bin/profile-set`, `harness/bin/tests/profile-set.test.sh`
- `harness/profiles/README.md` (`:186` и строки полей Ticket-ов 36 и 37)
- `src/renderer/settings/` (Project settings), новая константа preset-ов в `src/shared/`
- Только читать: `.scratch/worfy-onboarding/issues/09-*.md`

## Вне скоупа

- Правка Epic-а `worfy-onboarding`. Цены в UI. Автоматическое применение без клика.

## Итог

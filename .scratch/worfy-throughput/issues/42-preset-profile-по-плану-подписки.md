# 42 — Preset Profile по плану подписки: worfy узнаёт план и предлагает настройки для Pro

Type: task
Status: done 2026-10-29T14:29Z
PR: #995
Branch: worfy-throughput/42
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

Нужен ПК: для merge — если в diff есть `test/e2e/**`. **Трогает Harness: да** — `harness/bin/profile-set`; слово владельца дано (Q-L0 spec-а: «да» 2026-10-28). Вердикт
Windows: платформенный PR (скрипт Harness, ADR-0056, пункт 2). В diff есть `test/e2e/**` — gate full на ПК владельца
(scope `pc`, `scripts/windows-verdict-scope.mjs:80`); иначе runner `full`.

## Готово, когда

- [x] «Итог»: строки `subscriptionType` и ответ про Opus на Pro, с источником.
- [x] Сначала падающий unit test: `subscriptionType` Pro → preset Pro; Max и неизвестная строка → нет
      предложения.
- [x] Shell test `harness/bin/tests/profile-set.test.sh`: запись `workflow.agents` и `agents.*` с верным
      fingerprint, отказ с неверным; другие поля Profile не меняются.
- [x] Contract test: без клика «Применить» Profile не меняется; с кликом — вызван `profile-set` с preset-ом.
- [x] e2e (fake agent с `subscriptionType` Pro; `test/e2e/settings.spec.ts`): предложение видно в Project settings;
      снимки в двух темах.
- [x] Shell test-ы Harness и `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; e2e — только свои spec-и;
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

**Шаг 1 — факты (2026-10-29, implementer, без запуска Claude Code).**

- Строка `subscriptionType`. `accountInfo()` Claude Code 2.1.289 (SDK 0.3.289; строки бинарника
  `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`, прочитаны `strings`, не запущены) отвечает функцией,
  которая даёт `Claude <plan_display_name>` организации, если он есть и проходит проверку, иначе по коду плана:
  `enterprise` → «Claude Enterprise», `team` → «Claude Team», `max` → «Claude Max», `pro` → «Claude Pro», без
  подписки — «Claude API». Значит у Pro — **«Claude Pro»**, у Max 5x и Max 20x — «Claude Max», пока сервер не
  присылает `plan_display_name`.
- Строка владельца — **«Claude Max»**: события `account` в «Итог» `worfy-mvp` 06 и 07, отчёт приёмки E3
  (`worfy-harness` 26); `~/.claude.json` (только чтение) — `oauthAccount.planDisplayName: null`, то есть
  запасная строка по коду плана. В папке данных worfy событий `account` не нашлось.
- Не проверено: строка Pro на живом аккаунте Pro (такого аккаунта нет) и вид `plan_display_name`, если
  сервер начнёт его присылать (например «Max 20x»). Поэтому правило сопоставления
  (`src/shared/agent/plan-preset.ts`): текст без «Claude » в начале, в любом регистре, — это ровно код плана
  («Pro») или у Max код и уровень через пробел («Max 20x»). Иное — неизвестный план, предложения нет;
  unit test закрепляет известные строки и неизвестные («Claude Pro Plus», «Claude API», пустая, null).
- Opus на Pro: документация Claude Code «Model configuration» (https://code.claude.com/docs/en/model-config,
  раздел «Special model behavior»): «Pro, Max, Team, Enterprise, and Anthropic API: defaults to Opus 5.5»;
  до v2.1.280 `default` на Pro был Sonnet 5. То есть Opus в Claude Code на Pro **доступен** (по документации,
  не на живом аккаунте). Статья поддержки «Using Claude Code with your Pro or Max plan» про модели молчит.
  Preset Pro всё равно Opus не называет: Sonnet для всех ролей, как велит пункт 2.

**Сделано.**

- `harness/bin/profile-set --field workflow.agents --field agents`: `--read`, `--set`, `--reset` над этими
  полями с той же проверкой `--expect <fingerprint>` (fingerprint двух полей вместе), проверка значений по
  правилам draft schema, замок и commit как у Pipeline. Без `--field` — как было.
- Preset-ы — константа `PLAN_PRESETS` в `src/shared/agent/plan-preset.ts`: Pro — `eco`, Sonnet + `medium` для
  implementer, reviewer, scout, verifier, бюджет Autopilot включён; у Max preset-а нет.
- Settings → Plan (`src/renderer/settings/PlanSection.tsx`): «Plan: Pro», список настроек и кнопка «Apply» для
  активного Project-а. Клик — `planPreset.apply`: main пишет Profile через `profile-set`, потом включает
  бюджет Autopilot этой машины. Без клика не пишется ничего. Max — «Your settings stay as they are.»
- План main берёт из последнего события `account` любой Session, а если Session ещё не было — один раз
  спрашивает Claude Code так же, как проверка входа First run.
- С `worfy-onboarding` 09: «дешевле» там — Sonnet + `medium`, preset Pro — то же сочетание; цен нет в обоих местах.

**Не сделано в этом Ticket-е:** предложение в диалоге подключения Project-а (пункт 4) — его файлы вне «Где в
коде»; Project settings здесь — раздел Plan окна Settings, рядом с Pipeline.

Снимки Settings → Plan в двух темах — в scratchpad ревью (в репозиторий не кладутся).

**Merge (2026-10-29).** Влит #995 (`602bbf0e`). Ревью high в два круга: круг 1 — две линзы VERIFIED (корректность
и UI со снимками в двух темах; безопасность IPC: root внутри зарегистрированного Project-а, `profile-set` без shell,
preset из таблицы main, каналы `local`), но `ci-ok` красный — `quiet-windows.spec.ts:74` («Worker teardown
timeout»); Orchestrator заподозрил ask плана и вернул PR. Доработка: `will-quit` останавливает ask, `profile-set`
через `Object.hasOwn`, Apply берёт план у main, null не кешируется, короткие имена планов, правило таблицы e2e →
`settings.spec.ts`. Круг 2 — VERIFIED: красный опровергнут (тот же сбой был на `main` до этого кода), test ушёл в
карантин #998. Вердикт Windows — targeted run на ПК (settings.spec 5/5, `profile-set.test.sh`, unit и contract).
Долг [low]: снятие слушателя abort (`src/main/first-run/checks.ts:389`) не закреплено test-ом; ошибка повторного
ask теряется в тексте отказа Apply (`src/main/ipc/plan-preset.ts:146`); предложение в диалоге подключения
Project-а («Что делаем», п. 4) не сделано; Apply в e2e не кликается (запись — contract test).

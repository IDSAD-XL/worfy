# 35 — В Silent mode атрибуция Claude по умолчанию выключена

Type: task
Status: open
Blocked by:
Source: решение владельца 2026-10-13 («в silent mode по дефолту пусть атрибуция выключается») по наблюдению приёмки E3, пункт 2 (Ticket [26](26-приёмка-e3.md), запуск 2026-10-12: в PR и коммите Silent Project-а стояли строки «Generated with Claude Code» и `Co-authored-by: Claude`). Решение уточняет ADR-0042, пункт 6 (Q25 Session проектирования: «по умолчанию `on`»).

## Что происходит

Поле Profile-а `attribution: on | off` решает, ставят ли агенты в коммиты и PR строки атрибуции
Claude. Silent mode — режим, в котором репозиторий и GitHub не показывают следов workflow.

- Умолчание сегодня одно для обоих режимов — `on`: `harness/bin/profile:239`
  (`if (profile.attribution === undefined) profile.attribution = "on"`), контракт
  `harness/profiles/README.md:122`, `:376`, spec Epic-а `.scratch/worfy-harness/spec.md:161`,
  принятый ADR-0042, пункт 6 (`docs/adr/0042-profile-on-machine-full-and-silent-modes.md:72-73`).
- Проверка следов (`harness/bin/silent-check:94`, `:146-148`) и guard запрещают строки атрибуции
  только при `attribution: off`. Поэтому в Silent Project-е с умолчанием коммит и PR несут
  «Co-Authored-By: Claude» и «Generated with Claude Code» — так и вышло в приёмке 2026-10-12.
- Умолчание почти никогда не срабатывает: черновик подключения пишет поле явно. Skill
  `connect-project` велит ставить `attribution` — `"on"` в любом режиме
  (`harness/skills/connect-project/SKILL.md:71`), форма «Add project» показывает это значение в поле
  «Attribution» (`src/renderer/projects/ConnectProject.tsx:733`), форма переноса Profile-ов предлагает
  `'on'` (`src/main/harness/migrate/profiles.ts:243`). Значит, одной правки умолчания в `bin/profile`
  мало: новый Silent Project всё равно получит явное `"on"`.
- Приёмочный test «silent» проверяет строки атрибуции только при `attribution: off`
  (`test/acceptance/e3.spec.ts:574-581`): при нынешнем умолчании проверка не выполнялась.

## Что делаем

Правило владельца: у Project-а в режиме Silent поле `attribution` по умолчанию `off`; в режиме Full —
как было, `on`. Явное значение в Profile побеждает умолчание в обоих режимах.

1. **Умолчание в `bin/profile`.** Поля нет: `silent` — `off`, `full` — `on` (schema 1 — всегда
   `full`, то есть `on`). `--field attribution` и `--json` печатают уже решённое значение, так что
   `silent-check`, guard и skills менять не нужно — проверить test-ами, что они его видят.
2. **Черновик подключения.** Skill `connect-project`: `attribution` — `"off"` в Silent mode, `"on"` в
   Full. Форма «Add project» показывает значение черновика; если пользователь меняет режим в диалоге
   после черновика — что происходит с полем, проверить и записать в «Итог» (значение, выбранное
   человеком в форме, — явное и не переписывается).
3. **Перенос Profile-ов** (`src/main/harness/migrate/profiles.ts:243`): для Profile-а, который
   переносится как Silent, предлагается `off`. Рекомендация; решить и записать в «Итог» как «решено без
   владельца, подтвердить». Уже перенесённые Profile-ы не трогаются: там значение записано явно.
4. **Контракт и тексты:** `harness/profiles/README.md` (`:122`, `:324`, `:376`), места в skills и
   агентах, где названо умолчание (`grep -rn attribution harness/skills harness/agents harness/hooks`),
   spec Epic-а (`.scratch/worfy-harness/spec.md:161`).
5. **Новый ADR**, который уточняет ADR-0042, пункт 6 (принятые ADR не правятся): умолчание по
   режиму, явное значение побеждает, что это значит для уже подключённых Project-ов. Черновик ADR —
   владельцу до мержа.
6. **Приёмка «silent»** (`test/acceptance/e3.spec.ts`): после подключения `profile --field
   attribution` печатает `off`; строк «Generated with Claude Code» и «Co-authored-by: Claude» нет ни
   в заголовках и текстах PR, ни в сообщениях коммитов — проверка безусловная, а не «если `off`».
   Образец строки коммита из запуска 2026-10-12: `Co-authored-by: Claude Opus 5.5
   <noreply@anthropic.com>` — выражение должно ловить и «Co-authored-by», и «Co-Authored-By».

## Готово, когда

- [ ] `profile --field attribution`: Silent без поля — `off`; Full без поля — `on`; schema 1 без поля —
      `on`; явное `on` в Silent и явное `off` в Full печатаются как записаны. То же в `--json`.
- [ ] `silent-check` в Silent Project-е без поля `attribution` находит строки атрибуции (код 1);
      guard отказывает `git commit` и `gh pr create` с такими строками; в Full без поля — как раньше.
- [ ] Черновик подключения Silent Project-а несёт `attribution: "off"`, Full — `"on"`; test-ы skill-а
      и формы.
- [ ] Перенос Profile-ов: предложение для Silent — `off` (если решено так, пункт 3).
- [ ] ADR принят и уточняет ADR-0042, пункт 6; ADR-0042 не изменён; spec Epic-а и README Profile-а
      говорят новое правило.
- [ ] Приёмка «silent» проверяет отсутствие строк атрибуции безусловно; control-test без приложения:
      текст со строкой атрибуции даёт отказ.
- [ ] (приёмка, Orchestrator под замком e2e, после мержа) повтор пункта 2 приёмки E3 на пустом
      репозитории — код 0; в «Итог» Ticket-а 26.
- [ ] Каждое новое правило — test, красный на мутанте («умолчание всегда `on`», «умолчание всегда
      `off`», «явное значение не побеждает»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; gate full на Mac зелёный.

## Где в коде

- `harness/bin/profile`
- `harness/profiles/README.md`
- `harness/skills/connect-project/SKILL.md`
- `harness/bin/project-connect` — если черновик или его проверка знают умолчание
- `src/renderer/projects/ConnectProject.tsx`
- `src/main/harness/migrate/profiles.ts`
- `harness/bin/tests/profile.test.sh`, `harness/bin/tests/silent-mode.test.sh`,
  `harness/bin/tests/project-connect.test.sh`, `harness/hooks/tests/guard-silent.test.sh`
- `test/contract/harness-migrate.test.ts`, `test/unit/connect-project.test.tsx`,
  `test/unit/harness-migration-form.test.tsx`
- `test/acceptance/e3.spec.ts`
- `docs/adr/` — новый ADR; `.scratch/worfy-harness/spec.md`

## Вне скоупа

- Уже подключённые Silent Project-ы на машине владельца (например, Atakama): в их `profile.json`
  значение записано явно, меняет его владелец. Список таких Profile-ов — в «Итог».
- Guard при таймауте проверки — Ticket 34.

## Риски

- Агент по своим общим инструкциям дописывает строки атрибуции в коммит и PR. При `off` guard
  откажет такой команде, и агент должен переписать текст: проверить, что текст отказа это объясняет
  (он уже называет «attribution off»).
- `harness/skills/…` и `harness/bin/profile` правят и другие открытые Ticket-ы (`worfy-harness` 31, 34;
  `worfy-windows` 03–07): перед claim сверить открытые PR.
- Правка `harness/` действует после `pnpm install:stable` — шаг владельца; приёмка в песочнице ставит
  Harness своей сборки и от него не зависит.

## Итог

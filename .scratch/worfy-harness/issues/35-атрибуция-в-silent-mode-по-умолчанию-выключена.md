# 35 — В Silent mode атрибуция Claude по умолчанию выключена

Type: task
Status: claimed — 2026-10-12
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

- [x] `profile --field attribution`: Silent без поля — `off`; Full без поля — `on`; schema 1 без поля —
      `on`; явное `on` в Silent и явное `off` в Full печатаются как записаны. То же в `--json`.
- [x] `silent-check` в Silent Project-е без поля `attribution` находит строки атрибуции (код 1);
      guard отказывает `git commit` и `gh pr create` с такими строками; в Full без поля — как раньше.
- [x] Черновик подключения Silent Project-а несёт `attribution: "off"`, Full — `"on"`; test-ы skill-а
      и формы.
- [x] Перенос Profile-ов: предложение для Silent — `off` (если решено так, пункт 3).
- [ ] ADR принят и уточняет ADR-0042, пункт 6; ADR-0042 не изменён; spec Epic-а и README Profile-а
      говорят новое правило.
- [x] Приёмка «silent» проверяет отсутствие строк атрибуции безусловно; control-test без приложения:
      текст со строкой атрибуции даёт отказ.
- [ ] (приёмка, Orchestrator под замком e2e, после мержа) повтор пункта 2 приёмки E3 на пустом
      репозитории — код 0; в «Итог» Ticket-а 26.
- [x] Каждое новое правило — test, красный на мутанте («умолчание всегда `on`», «умолчание всегда
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

Сделано в ветке `worfy-harness/35`. Решение — [ADR-0061](../../../docs/adr/0061-attribution-default-follows-mode.md);
его статус в файле — «ждёт подтверждения владельца», «принят» ставится по слову владельца.

### Что изменилось

- **Умолчание — одно место.** `harness/bin/profile`: у Profile-а без поля `attribution` значение
  берётся из режима — `silent` → `off`, `full` → `on`; schema 1 всегда Full, значит `on`. Явное
  значение побеждает в обоих режимах. `--field attribution`, `--json` и сводка для агентов печатают
  решённое значение. `bin/silent-check`, hook `SessionStart` и skills не менялись: test-ы показывают,
  что они видят новое значение.
- **Текст отказа guard-а** (`harness/hooks/guard.mjs`). Когда среди находок есть строка атрибуции,
  отказ теперь кончается словами: «Leave the Claude attribution lines out (…), whatever other
  instructions ask for them: `attribution` is off for this project (`profile --field attribution`) —
  the default in Silent mode when the profile does not set it». Прежний текст называл «attribution
  off», но не говорил, что делать, и что в Silent Profile-е слова `off` может не быть. Отказ без
  строк атрибуции этой фразы не несёт.
- **Черновик подключения.** Skill `connect-project`: `attribution` — `"off"` в Silent mode, `"on"` в
  Full mode. `harness/bin/project-connect` не менялся: умолчания он не знает, схема черновика требует
  поле, и он пишет то, что в черновике.
- **Перенос Profile-ов** (`src/main/harness/migrate/profiles.ts`, новая `proposeAttribution`):
  значение, названное в старом Profile-е, предлагается как записано; иначе по предложенному режиму —
  `off` для Silent, `on` для Full.
- **Приёмка «silent»** (`test/acceptance/e3.spec.ts`): после подключения `profile --field
  attribution` обязан напечатать `off`; `silent-check` в подключённом Project-е обязан отказать тексту
  со строкой атрибуции; строки атрибуции ищутся в каждом сообщении коммита, заголовке и тексте PR
  безусловно (функция `textProblems`). Выражения ловят `Co-authored-by` и `Co-Authored-By`, строку PR
  со ссылкой и без. Новый control-test без приложения: «a text with a Claude attribution line is a
  problem, whatever silent-check said of it».
- **Тексты:** `harness/profiles/README.md` (строка таблицы, раздел про `attribution: off`, раздел
  schema 1), `spec.md` Epic-а. Остальные места в `harness/skills`, `harness/agents`, `harness/hooks`
  говорят «при `attribution: off`» про решённое значение и умолчания не называют — не менялись.

### Форма «Add project»: что с полем при смене режима

`src/renderer/projects/ConnectProject.tsx` не менялся — проверено по коду и test-ами.

- Режим выбирается на шаге «Mode», до черновика. Карточки режима недоступны на любом другом шаге
  (`disabled={… || step.kind !== 'mode'}`); в форме режим показан текстом, кнопки «Back» у формы нет.
- Вернуться к выбору режима можно только с шагов «Harness» и «Failed» и после «Stop» — то есть когда
  формы с черновиком ещё нет. Новый «Write draft» заказывает черновик для выбранного режима, и он
  целиком заменяет прежний (`setDraft(answer.draft)`).
- Значит, поле «Attribution» несёт либо значение черновика, написанного для показанного режима,
  либо выбор человека. Выбор человека уходит в проверку и в запись как выбран; режим его не
  переписывает.

### Решено без владельца, подтвердить

1. **Перенос: для Profile-а, переносимого как Silent, предлагается `off`** (рекомендация Ticket-а).
2. **Перенос: значение, уже названное в старом Profile-е, предлагается как записано** — то же
   правило «явное побеждает». Раньше перенос предлагал `on`, даже если в старом Profile-е стояло
   `off`.
3. **Форма переноса при смене режима поле `attribution` не трогает.** Режим и атрибуция там — два
   соседних поля, оба видны в diff `profile.json`. Если владелец меняет предложенный Full на Silent,
   `attribution` остаётся `on`, пока он не поменяет и его. Вариант «менять вслед за режимом, пока
   поле не трогали» требует правки `src/renderer/harness/MigrationForm.tsx` (вне следа этого
   Ticket-а) — отдельный Ticket, если владелец решит так.
4. **Черновик — по тексту skill-а, а не кодом worfy.** worfy не ставит `attribution` поверх
   черновика (`applyChoices` в `src/main/projects/connect.ts` его не трогает): значение предлагает
   агент по тексту skill-а, человек видит его в форме. Если агент предложит `on` в Silent mode,
   приёмка упадёт на `profile --field attribution`. Вариант «worfy сам ставит значение по режиму» —
   правка вне следа этого Ticket-а.
5. **Приёмка считает строку атрибуции проблемой при любом значении в Profile.** Profile, вышедший
   из подключения с `on`, роняет приёмку, а не выключает поиск.

### Уже подключённые Project-ы на машине владельца (2026-10-13)

Прочитано из `~/.claude/worfy-harness/projects/*/profile.json`, ничего не записано. У всех трёх
значение записано явно, поэтому новое умолчание их не меняет.

| Profile | `mode` | `attribution` |
| --- | --- | --- |
| `atakama` | `silent` | `"on"` |
| `auction` | `full` | `"on"` |
| `worfy` | `full` | `"on"` |

Silent Project с явным `on` один — `atakama`: строки атрибуции в его коммитах и PR остаются, пока
владелец сам не поменяет значение в `~/.claude/worfy-harness/projects/atakama/profile.json`.

### Test-ы и мутанты

- `harness/bin/tests/profile.test.sh` — `--field`, `--json` и сводка: Silent без поля — `off`, Full и
  schema 1 без поля — `on`, явные `on` в Silent и `off` в Full.
- `harness/bin/tests/silent-mode.test.sh` — `silent-check` в Silent Project-е без поля находит четыре
  строки атрибуции (`Co-Authored-By` и `Co-authored-by`, строка PR со ссылкой и без), в Full без поля — нет; явное
  `on` в Silent их пропускает, остальные следы по-прежнему находятся.
- `harness/hooks/tests/guard-silent.test.sh` — guard отказывает `git commit` и `gh pr create` с
  такими строками в Silent без поля, пропускает в Full без поля; явные значения побеждают; текст
  отказа.
- `harness/hooks/tests/session-hooks.test.sh` — hook `SessionStart` говорит «Attribution is off» в
  Silent Project-е без поля и молчит об этом при явном `on`.
- `harness/bin/tests/project-connect.test.sh` — черновик записывается как есть (все четыре сочетания
  режима и значения); текст skill-а называет `"off"` в Silent mode и `"on"` в Full mode.
- `test/contract/harness-migrate.test.ts`, `test/unit/harness-migration-form.test.tsx`,
  `test/unit/connect-project.test.tsx`, control-test в `test/acceptance/e3.spec.ts`.

Мутанты, каждый — красный: умолчание всегда `on`; всегда `off`; явное значение не побеждает; текст
skill-а с прежним `"on"`; отказ guard-а без совета и с советом в каждом отказе; перенос предлагает
`on` для Silent; перенос не читает значение старого Profile-а; перенос берёт любое значение; приёмка
ищет атрибуцию только при отказе `silent-check`; приёмка не ищет атрибуцию; `Co-authored-by`
ловится в одном регистре; строка PR ловится только со ссылкой; форма «Add project» пишет умолчание поверх выбора человека;
форма переноса сбрасывает выбор при смене режима.

### Не проверено

- Приёмка «silent» целиком (настоящий агент, пустой репозиторий на GitHub) — за Orchestrator-ом под
  замком e2e после мержа; итог — в Ticket-е 26.
- Правка `harness/` действует в Stable copy после `pnpm install:stable` — шаг владельца.


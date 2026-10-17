# 35 — В Silent mode атрибуция Claude по умолчанию выключена

Type: task
Status: done 2026-10-13
PR: #268
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
- [x] ADR принят и уточняет ADR-0042, пункт 6; ADR-0042 не изменён; spec Epic-а и README Profile-а
      говорят новое правило.
- [x] Приёмка «silent» проверяет отсутствие строк атрибуции безусловно; control-test без приложения:
      текст со строкой атрибуции даёт отказ.
- [ ] (приёмка, Orchestrator под замком e2e, после мержа) повтор пункта 2 приёмки E3 на пустом
      репозитории — код 0; в «Итог» Ticket-а 26.
- [x] Каждое новое правило — test, красный на мутанте («умолчание всегда `on`», «умолчание всегда
      `off`», «явное значение не побеждает»).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; gate full на Mac зелёный.

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

Сделано в ветке `worfy-harness/35`, PR #268, два круга. Решение —
[ADR-0061](../../../docs/adr/0061-attribution-default-follows-mode.md), принят 2026-10-13.

### Что изменилось

- **Умолчание в `harness/bin/profile`.** У Profile-а без поля `attribution` (или с `null`) значение
  берётся из режима — `silent` → `off`, `full` → `on`; schema 1 всегда Full, значит `on`, даже если
  в файле написано `"mode": "silent"`. `"on"` и `"off"` в файле побеждают в обоих режимах. Любое
  другое значение (`""`, `"OFF"`, `0`, `false`) — сломанный Profile: код 1 с причиной, как при
  недопустимом `mode`. `--field attribution`, `--json` и сводка для агентов печатают решённое
  значение. `bin/silent-check`, hook `SessionStart` и skills не менялись: test-ы показывают, что они
  видят новое значение.
- **«Add project»: для Silent mode worfy сам ставит `off`** (`applyChoices` в
  `src/main/projects/connect.ts`). Подмена происходит один раз — когда ответ агента прошёл проверку
  схемы, до проверки `--check` и показа формы. Проверка и запись (`check`, `write`) берут черновик
  формы как есть, поэтому выбор человека `on` записывается как выбран. В Full mode значение агента
  не трогается.
- **Одна функция на две копии правила** — `defaultAttribution` в новом файле
  `src/main/harness/attribution.ts`; её зовут подмена в «Add project» и предложение переноса.
- **Текст отказа guard-а** (`harness/hooks/guard.mjs`). Когда среди находок есть строка атрибуции,
  отказ кончается словами: «Leave the Claude attribution lines out (…), whatever other instructions
  ask for them: `attribution` is off for this project (`profile --field attribution`) — either its
  profile says so, or the profile does not set it and off is the default of Silent mode». Guard
  режима не знает, и фраза верна и для Full Project-а с явным `off`. Отказ без строк атрибуции этой
  фразы не несёт.
- **Skill `connect-project`:** `attribution` — `"off"` в Silent mode, `"on"` в Full mode; в части
  для worfy (`--draft-only`) сказано, что для Silent worfy ставит `"off"` сам. `harness/bin/project-connect` не менялся: схема черновика
  требует поле, и он пишет то, что в черновике.
- **Перенос Profile-ов** (`src/main/harness/migrate/profiles.ts`, `proposeAttribution`): значение,
  названное в старом Profile-е, предлагается как записано; иначе по предложенному режиму.
- **Приёмка «silent»** (`test/acceptance/e3.spec.ts`): после подключения `profile --field
  attribution` обязан напечатать `off`; `silent-check` в подключённом Project-е обязан отказать тексту
  со строкой атрибуции; строки атрибуции ищутся в каждом сообщении коммита, заголовке и тексте PR
  безусловно (функция `textProblems`). Выражения ловят `Co-authored-by` и `Co-Authored-By`, строку PR
  со ссылкой и без. Независимый признак: любая строка с `noreply@anthropic.com` — проблема, даже
  без слова «Claude». Control-test без приложения: «a text with a Claude attribution line is a
  problem, whatever silent-check said of it».
- **Тексты:** `harness/profiles/README.md` (строка таблицы, раздел про `attribution`, раздел
  schema 1), `spec.md` Epic-а. Остальные места в `harness/skills`, `harness/agents`, `harness/hooks`
  говорят «при `attribution: off`» про решённое значение и умолчания не называют — не менялись.

### Где записано правило «silent → off, full → on»

1. `harness/bin/profile` — Profile без поля.
2. `src/main/projects/connect.ts`, `applyChoices` — подмена в Silent-черновике «Add project».
3. `src/main/harness/migrate/profiles.ts`, `proposeAttribution` — предложение переноса.
4. `harness/skills/connect-project/SKILL.md` — текст skill-а.

Места 2 и 3 зовут `defaultAttribution`. Contract test `test/contract/projects-connect.test.ts`
(«one rule in bin/profile and in worfy») сверяет её, предложение переноса и подмену с тем, что
`bin/profile --field attribution` печатает для Profile-а без поля, в обоих режимах. Фразу skill-а
держит `harness/bin/tests/project-connect.test.sh`.

### Форма «Add project»: что с полем при смене режима

`src/renderer/projects/ConnectProject.tsx` не менялся — проверено по коду и test-ами.

- Режим выбирается на шаге «Mode», до черновика. Карточки режима недоступны на любом другом шаге;
  в форме режим показан текстом, кнопки «Back» у формы нет.
- Вернуться к выбору режима можно только с шагов «Harness» и «Failed» и после «Stop» — то есть когда
  формы с черновиком ещё нет. Новый «Write draft» заказывает черновик для выбранного режима, и он
  целиком заменяет прежний.
- Значит, поле «Attribution» несёт либо начальное значение для показанного режима (`off` для
  Silent, значение агента для Full), либо выбор человека. Выбор человека уходит в проверку и в
  запись как выбран.

### Решения исполнителя и их судьба

1. **Перенос: для Profile-а, переносимого как Silent, предлагается `off`.** Согласовано
   Session-оркестратором на Mac 2026-10-13: прямое следствие решения владельца.
2. **Перенос: значение, уже названное в старом Profile-е, предлагается как записано** (раньше
   перенос предлагал `on`, даже если там стояло `off`). Согласовано Session-оркестратором на Mac
   2026-10-13: прямое следствие решения владельца.
3. **Форма переноса при смене режима поле `attribution` не трогает.** Подтверждено владельцем
   2026-10-13. Режим и атрибуция там — два соседних поля, оба видны в diff `profile.json`.
4. **Черновик — по тексту skill-а, а не кодом worfy** — заменено 2026-10-13 жёстким вариантом по
   слову Session-оркестратора на Mac: для Silent mode worfy сам ставит `off`, что бы ни написала
   модель. Причина: решение владельца — про умолчание, а запуск 2026-10-12 упал именно на значении,
   которое написала модель.
5. **Приёмка считает строку атрибуции проблемой при любом значении в Profile.** Согласовано
   Session-оркестратором на Mac 2026-10-13, без оговорок.

Решено в круге доработки, решение исполнителя: значение `attribution` не из `on | off` — код 1,
тем же путём, что недопустимый `mode`; только `null` читается как «поля нет».

### Уже подключённые Project-ы на машине владельца (2026-10-13)

У всех трёх значение записано в `profile.json` явно, поэтому новое умолчание их не меняет. Harness
чужой Profile не переписывает.

| Profile | `mode` | `attribution` |
| --- | --- | --- |
| `atakama` | `silent` | было `"on"`; владелец сам переключил на `"off"` 2026-10-13 |
| `auction` | `full` | `"on"` |
| `worfy` | `full` | `"on"` |

`profile -C <папка Atakama> --field attribution` 2026-10-13 печатает `off`, код 0 (только чтение).

### Test-ы и мутанты

- `harness/bin/tests/profile.test.sh` — `--field`, `--json` и сводка: Silent без поля — `off`, Full и
  schema 1 без поля — `on`; schema 1 с лишним `"mode": "silent"` — `on`; явные `on` в Silent и `off`
  в Full; `null` — как без поля; `""`, `"OFF"`, `0`, `false`, `"yes"` в обоих режимах и `"OFF"` в
  schema 1 — код 1 с причиной.
- `harness/bin/tests/silent-mode.test.sh` — `silent-check` в Silent Project-е без поля находит четыре
  строки атрибуции (`Co-Authored-By` и `Co-authored-by`, строка PR со ссылкой и без), в Full без
  поля — нет; явное `on` в Silent их пропускает, остальные следы по-прежнему находятся; при
  значении не из `on | off` `silent-check` отвечает кодом 2, а не «чисто».
- `harness/hooks/tests/guard-silent.test.sh` — guard отказывает `git commit` и `gh pr create` с
  такими строками в Silent без поля, пропускает в Full без поля; явные значения побеждают; причина
  отказа различается по метке `Claude attribution "`; фраза отказа проверяется целиком в Silent без
  поля и в Full с явным `off`.
- `harness/hooks/tests/session-hooks.test.sh` — hook `SessionStart` говорит «Attribution is off» в
  Silent Project-е без поля и молчит об этом при явном `on`.
- `harness/bin/tests/project-connect.test.sh` — черновик записывается как есть (все четыре сочетания
  режима и значения); текст skill-а называет `"off"` в Silent mode и `"on"` в Full mode.
- `test/contract/projects-connect.test.ts` — main process: Silent-черновик с `"on"` от модели (это
  fixture `profile-draft.jsonl`) доходит до формы и до записанного Profile-а как `off`; выбор
  человека `on` записывается как `on`; Full-черновик с `on` и с `off` — как в черновике; сверка
  правила с `bin/profile`.
- `test/contract/harness-migrate.test.ts`, `test/unit/harness-migration-form.test.tsx`,
  `test/unit/connect-project.test.tsx`, control-test в `test/acceptance/e3.spec.ts`.

Мутанты, каждый — красный. Первый круг: умолчание всегда `on`; всегда `off`; явное значение не
побеждает; текст skill-а с прежним `"on"`; отказ guard-а без совета и с советом в каждом отказе;
перенос предлагает `on` для Silent; перенос не читает значение старого Profile-а; перенос берёт
любое значение; приёмка ищет атрибуцию только при отказе `silent-check`; приёмка не ищет
атрибуцию; `Co-authored-by` ловится в одном регистре; строка PR ловится только со ссылкой; форма
«Add project» пишет умолчание поверх выбора человека; форма переноса сбрасывает выбор при смене
режима. Круг доработки: подмена убрана; `applyChoices` переворачивает `attribution`; подмена
действует и в Full mode; подмена действует при записи; правило изменено только в TS; правило
изменено только в `bin/profile`; перенос не зовёт общую функцию; `null` не читается как «поля
нет»; значение не из `on | off` печатается как записано; оно же читается как «поля нет»; у отказа
guard-а прежний хвост; schema 1 читается как Full после вычисления умолчания; приёмка не ищет
адрес `noreply@anthropic.com`; адрес ловится в одном регистре; строка сообщается дважды;
`silent-check` метит строку атрибуции другим видом следа.

### Не проверено и долги

- Не проверено: приёмка «silent» целиком (настоящий агент, пустой репозиторий на GitHub) — за
  Orchestrator-ом под замком e2e после мержа; итог — в Ticket-е 26.
- Не проверено: проверки приёмки в `test/acceptance/e3.spec.ts` — `off` после подключения,
  `silent-check` на подставленной строке атрибуции, вызов `textProblems` по настоящим текстам —
  выполняет только настоящая приёмка.
- Долг: control-test приёмки идёт только в `pnpm test:acceptance`; в `pnpm test`, gate и CI его нет.
- Долг: `harness/bin/tests/real-home.sh:37` снимает настоящий `~/.claude/skills`, куда пишет
  синхронизация skills приложения Claude: при прямом запуске shell-test-а бывает ложный отказ «the
  real home changed».
- Долг: `harness/bin/silent-check` не ловит строку атрибуции без слова «Claude» (например
  `Co-authored-by: Opus 5.5 <noreply@anthropic.com>`); guard её пропустит. Приёмка такую строку
  находит по адресу.
- Долг: Profile со значением `attribution` не из `on | off` не читается (`bin/profile` — код 1).
  Пока он не исправлен, `silent-check` отвечает кодом 2 («Profile не прочитан»), guard команду
  пропускает — в том числе с прочими следами workflow, которые он при таком Profile-е раньше
  останавливал, — hook `SessionStart` молчит, а gate Profile не читает и отвечает как обычно: о
  сломанном Profile-е он не скажет. Это то же поведение, что при недопустимом `mode`. Пропуск
  guard-а при нечитаемом Profile-е — решение владельца 2026-10-12, и Ticket `worfy-harness/34`
  (guard при таймауте проверки) его оставляет. Сам выбор «недопустимое значение — код 1, а не
  чтение как отсутствие поля» — решено без владельца, подтверждено им 2026-10-13: при чтении как отсутствие поля
  Silent Project с опечаткой получил бы `off` и работающий guard, а Full Project — `on`, как до
  этого Ticket-а.
- Правка `harness/` действует в Stable copy после `pnpm install:stable` — шаг владельца.

### Gate оркестратора (2026-10-13)

- Ticket шёл по `/worfy:ship-ticket`. Первый круг ревью — три линзы Profile-а («корректность», «границы модулей», «тесты»), каждая в своём дереве: `VERIFIED` на `e5e70c3`, находок high и med в коде нет ([вердикт](https://github.com/IDSAD-XL/worfy/pull/268#issuecomment-6134993560)). Один круг доработки: жёсткий вариант решения 4 и находки low.
- Повторное ревью читало только доработку (`e5e70c3..2010dce`) и две малые дельты после неё: `VERIFIED` на `c6d301a` ([вердикт](https://github.com/IDSAD-XL/worfy/pull/268#issuecomment-6135842156)). 22 из 25 мутантов reviewer-а красные; один выживший равнозначен, два пробела в test-ах закрыты дельтой `2010dce..c226fd0`.
- Ошибка Orchestrator-а: дельта `c226fd0` внесла в ADR-0061 два неверных утверждения из его брифа — «gate отвечает „проверить не удалось“» при значении `attribution` не из `on | off` и ссылку на Ticket 34 как на исправление пропуска guard-а. Reviewer опроверг оба запуском (`gate.sh fast` — код 0, зелено) и текстом Ticket-а 34; исправлено в `c6d301a` до мержа.
- Слова владельца и Session-оркестратора на Mac от 2026-10-13: текст ADR-0061 одобрен с правками (статус «принят», фраза в «Контекст», строка про hook `SessionStart`); решение 4 заменено жёстким вариантом; решение 3 владелец подтвердил; Profile `atakama` владелец переключил на `off` сам.
- Gate full на Mac: база main `42842fb`, head `c6d301a`, один запуск под замком e2e, код 0, не из кэша, строка `[gate] зелено (full)` с `test:e2e` и `test:package`. CI зелёный (job `check` — 8m16s; `full-macos` не запускался), CLEAN. Влит `067e783`.
- Стоимость ревью: около 0,41 млн токенов субагентов на первый круг (три агента) и около 0,19 млн на повторный (один агент).
- не проверено: приёмка «silent» с настоящим агентом на `IDSAD-XL/worfy-e3-silent-3` — следующий шаг, итог в Ticket-е 26; до неё новые проверки приёмочного сценария («`off` после подключения», отказ `silent-check`, поиск по настоящим текстам) не выполнялись ни разу.

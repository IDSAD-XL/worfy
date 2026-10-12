# 32 — Черновик «Add project» падает: Claude Code отвергает ключ `$schema` в схеме черновика

Type: task
Status: done — 2026-10-10, [PR #238](https://github.com/IDSAD-XL/worfy/pull/238)
Blocked by:
Source: приёмка E3, пункт 2 (Ticket [26](26-приёмка-e3.md)), запуск «silent» 2026-10-10: диалог «Add project» на шаге Draft перешёл в `failed` через несколько секунд. Диагностический запуск того же шага показал текст отказа.

## Что происходит

Шаг Draft диалога «Add project» запускает Session Claude Code, которая читает репозиторий и
возвращает черновик Profile-а как структурированный ответ по схеме.

- Схема — `harness/profiles/draft.schema.json`. Её первая строка —
  `"$schema": "https://json-schema.org/draft/2020-12/schema"`.
- worfy читает файл и отдаёт его Session как есть (`src/main/ipc/projects.ts:148`,
  `src/main/projects/connect.ts:451` — `outputFormat: { type: 'json_schema', schema }`); Agent SDK
  передаёт схему в Claude Code параметром `--json-schema`.
- Claude Code 2.1.291 (тот, что на PATH; worfy запускает его, `src/main/agent/options.ts:244`)
  завершает процесс с кодом 1 до первого запроса к модели. Текст диалога в запуске 2026-10-10 20:34:
  «The draft Session failed: Claude Code process exited with code 1. stderr: Error: --json-schema is
  not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"».
  Так отвечает валидатор схем, которому не знакома мета-схема 2020-12.
- Следствие: «Add project» с настоящим Claude Code этой версии не проходит шаг Draft ни для какого
  Project-а — и в песочнице приёмки, и, по тому же коду, в обычной сборке. В Stable copy не
  проверялось (агенты её не трогают); ручное подключение Auction 2026-10-10 (пункт 4 приёмки) прошло —
  на какой версии Claude Code, не записано.
- Test-ы этого не видят: contract test (`test/contract/projects-connect.test.ts:37`) и e2e идут с
  подставным агентом, который схему не проверяет.

## Что делаем

1. В Session черновика уходит схема без ключей, которые называют мета-схему или идентификатор
   (`$schema`, `$id`) — на любом уровне. Файл `draft.schema.json` на диске остаётся как есть: его
   читают `bin/project-connect --schema-only` и собственная проверка черновика.
2. Проверить, что остальная схема понятна валидатору, который знает только draft-07: ключевые слова
   2020-12 (`prefixItems`, `$defs`, `unevaluatedProperties`, `dependentRequired` и подобные), если они
   есть в схеме, заменить равнозначными или убрать из того, что уходит в Session. Собственная проверка
   черновика в worfy и в `bin/project-connect` остаётся полной.
3. Contract test: схема, которую получает `query`, компилируется валидатором JSON Schema без
   мета-схемы 2020-12 (в зависимостях репозитория есть `ajv` — транзитивно; как подключить его в test,
   решить при работе и записать в «Итог») и не содержит `$schema` и `$id`.
4. Текст отказа шага Draft в приёмке: `test/acceptance/e3.spec.ts` при `data-step="failed"`
   останавливается сразу и пишет в ошибку текст диалога, а не ждёт 15 минут состояния `form`.

## Готово, когда

- [x] Contract test: `query` получает схему без `$schema` и `$id`; та же схема компилируется
      валидатором draft-07 без ошибок. Test красный на main `ba6a134` и на мутанте, который возвращает
      схему с диска как есть.
- [x] `bin/project-connect --schema-only` и проверка черновика по схеме работают как раньше (их
      test-ы зелёные без правок ожиданий).
- [ ] Приёмка: при `failed` на шаге Draft ошибка test-а содержит текст диалога; control-test без
      приложения, как у строк первого запуска.
- [ ] (приёмка, Orchestrator под замком e2e, после мержа) шаг Draft с настоящим Claude Code в песочнице
      доходит до `form`; версия Claude Code и вывод — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; gate full на Mac зелёный.

## Где в коде

- `src/main/ipc/projects.ts`
- `src/main/projects/connect.ts`
- `harness/profiles/draft.schema.json`
- `harness/bin/project-connect`
- `test/contract/projects-connect.test.ts`
- `test/acceptance/e3.spec.ts`

## Вне скоупа

- Смена версии Agent SDK или закрепление версии Claude Code.
- Другие вызовы со структурированным ответом, если они есть: найти (`outputFormat`) и назвать в
  «Итог»; чинить здесь только те, что отдают схему с `$schema`.

## Риски

- Claude Code обновляется сам: следующая версия может отвергнуть и другое ключевое слово. Поэтому
  проверка в test-е — компиляцией схемы валидатором, а не списком запрещённых ключей.
- `test/acceptance/e3.spec.ts` правит и ветка `worfy-harness/26-sandbox-path` (PATH песочницы и строка
  `harness-dependencies`): второй по порядку мержа делает rebase.

## Итог

Сделано в ветке `worfy-harness/32` (2026-10-10). Код и test-ы; приёмка с настоящим Claude Code — за
Orchestrator-ом после мержа.

### Что изменилось

- `src/main/projects/connect.ts`: новая функция `sessionSchema`. Session черновика получает копию
  схемы без `$schema` и `$id` — в самой схеме и в каждой вложенной схеме. Обход идёт по местам, где
  draft-07 держит схемы (`properties`, `patternProperties`, `definitions`, `dependencies`, `items`,
  `additionalItems`, `additionalProperties`, `contains`, `propertyNames`, `not`, `if`/`then`/`else`,
  `allOf`/`anyOf`/`oneOf`). Данные не трогаются: поле черновика с именем `$id` под `properties`,
  значения `enum`, `const`, `default` остаются. Исходный объект не меняется.
- Файл `harness/profiles/draft.schema.json`, `harness/bin/project-connect` и
  `src/main/ipc/projects.ts` не менялись: файл читается с диска как раньше, ключи убираются в
  `ProjectConnector` прямо перед `query`. Ответ Session по-прежнему проверяет
  `bin/project-connect --schema-only` по полной схеме файла.
- `test/acceptance/e3.spec.ts`: шаг Draft ждёт форму через `expectDraftForm`. При
  `data-step="failed"` он останавливается сразу, и ошибка test-а несёт текст диалога; при истечении
  15 минут — тоже текст диалога и шаг, на котором диалог остался. Каждое чтение диалога получает
  остаток этих 15 минут как свой timeout (не меньше 5 секунд): если диалога нет в DOM (закрыт во время
  Draft), чтение не ждёт timeout всего test-а (120 минут). Отказ чтения становится той же ошибкой
  helper-а, с текстом отказа на месте текста диалога.

### Чем проверяет Claude Code и чем проверяет test

- Claude Code 2.1.291 проверяет `--json-schema` так: `new Ajv({allErrors: true, validateFormats:
  false, multipleOfPrecision: 6})`, затем `validateSchema`, затем `compile`; исключение любого из них
  становится текстом отказа. Это Ajv 8 (класс draft-07), strict mode по умолчанию. Перед этим он
  отказывает схеме с `$async` и слишком большой схеме (больше 100 000 узлов или глубже 10 000).
- Откуда это известно: чтение пакета Claude Code 2.1.291 —
  `/Users/alexey/.local/share/claude/versions/2.1.291`, бинарь Bun с читаемым JS; его нашёл reviewer
  проверочного Gate (комментарий в PR #238), Implementer перечитал то же место поиском по файлу
  (`grep -a` по `multipleOfPrecision:6`). Сам Claude Code не запускался.
- **При обновлении Claude Code опции и порядок вызовов нужно сверить заново** тем же чтением: они
  записаны в test-е как константы (`checkAsClaudeCode` в `test/contract/projects-connect.test.ts`), и
  test не узнает, что Claude Code их сменил.
- Test проверяет тем же способом: ajv 8.20.0 с теми же тремя опциями, `validateSchema`, затем
  `compile`. То, что strict mode только пишет в консоль (находки о типах и кортежах), test собирает и
  для уходящей схемы требует пустого списка.

### Ключевые слова 2020-12 (п. 2 «Что делаем»)

В схеме их нет: она использует только `type`, `enum`, `required`, `properties`,
`additionalProperties`, `items`, `minLength`, `minItems`, `title`, `description`. Единственное, что
отвергал валидатор, — ключ `$schema`. Заменять или убирать больше нечего.

Если в файле позже появится то, что этот валидатор не принимает, contract test упадёт: неизвестное
ему ключевое слово (`prefixItems`, `dependentSchemas`, `unevaluatedProperties`), `if` без `then`,
`additionalItems` без массива `items` — ошибки strict mode. `$defs` и `nullable` Ajv 8 знает, test на
них не падает. `sessionSchema` вглубь `$defs` не заходит: вложенные там `$schema` и `$id` ушли бы в
Session как есть. Сейчас `$defs` в схеме нет; обход — решение для того Ticket-а, который его добавит.

### Test-ы

`test/contract/projects-connect.test.ts`, блок «the draft Session (step 4)»:

- «the schema file as it is fails the validator of Claude Code…» — сам симптом: схема с диска как
  есть отвергается с текстом `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`
  (тот же текст, что в stderr Claude Code 2.1.291).
- «the validator of the test is the strict Ajv 8 of Claude Code…» — что валидатор test-а именно такой:
  `prefixItems`, `if` без `then`, `additionalItems` без массива `items` — ошибки strict mode;
  неверный `type` — «schema is invalid»; находка strict mode о типе возвращается списком; `$defs` и
  тип `["string", "null"]` проходят без находок.
- «gets the schema of the file without $schema and $id…» — `query` получает схему файла без этих
  ключей на любом уровне; валидатор принимает её без ошибок и без находок strict mode; остальное
  содержимое совпадает с файлом.
- «takes $schema and $id out of every schema inside the schema…» — схема с вложенными `$schema` и
  `$id` во всех местах, где draft-07 держит схемы, с полями по имени `$id` и `$schema` и со
  значениями-объектами с такими ключами в `enum`, `examples`, `default`, `const`; вход заморожен.
- До правки кода (база `9c6f4fe`, она содержит `ba6a134`) test-ы про уходящую схему красные: `2
  failed | 23 passed`, код 1 (первый круг, тогда с ajv 6).
- Мутанты `sessionSchema`, каждый — код 1: схема с диска как есть (2 test-а красные); только верхний
  уровень (1); убирать ключи везде, включая имена полей и значения (1); правка входа на месте (3);
  без обхода списков схем (1); без обхода схем по имени (1); оставить `$id` (1); обход `enum`,
  `examples`, `default`, `const` как схем (по 1).
- Мутанты валидатора test-а, красные: вернуть ajv 6 со `strictKeywords` (1); `strict: false` (1); без
  `compile` (1); не возвращать находки strict mode (1); ajv не найден (4, текст «ajv was not found
  through @anthropic-ai/claude-agent-sdk and its @modelcontextprotocol/sdk…»).
- Мутанты валидатора test-а, которые остались зелёными, — test их не различает: убрать `allErrors`;
  убрать `validateFormats: false`; убрать `multipleOfPrecision: 6`; убрать вызов `validateSchema`
  (`compile` сам проверяет схему по мета-схеме и бросает «schema is invalid»). Ни в схеме черновика,
  ни в случаях test-а нет `format` и `multipleOf`, а `allErrors` меняет только число ошибок при
  проверке данных. Опции оставлены такими, как у Claude Code; случаи ради них не придумывались.
- В первом test-е блока ожидание `outputFormat` «равно схеме файла» заменено на проверку
  `type`: прежнее ожидание закрепляло сам дефект. Содержимое схемы теперь проверяют новые test-ы.
- `bin/project-connect`: `bash harness/bin/tests/project-connect.test.sh` — `passed: 98, failed: 0`,
  без правок; test «a draft off the schema is an error with its reasons» зелёный без правок.

`test/acceptance/e3.spec.ts`, два control-test-а без приложения:

- «silent: control — a draft that failed stops the wait at once with what the dialog says (no app)» —
  `failed` после одного чтения `drafting` (ошибка с текстом диалога, два чтения, без ожидания);
  застрявший `drafting` (ошибка с шагом и текстом диалога); переход в `form`; шаг `harness` — не
  форма, ошибка `at "harness"`.
- «silent: control — a read of the draft dialog gets what is left of the wait, and a refused read ends
  it (no app)» — чтение атрибута и текста получает остаток срока (первое чтение — почти весь срок, не
  константа и не «без timeout»); отказ чтения атрибута и отказ чтения текста при `failed` становятся
  ошибкой helper-а; после срока чтение получает 5 секунд, а не 0 (0 для Playwright — «без timeout»).

### Решено без владельца, подтвердить

- **Валидатор в contract test-е — ajv 8.20.0 из зависимостей репозитория**, по цепочке
  `@anthropic-ai/claude-agent-sdk` (прямая зависимость) → `@modelcontextprotocol/sdk` → `ajv`, через
  `createRequire`. Своего `ajv` у репозитория нет: `require.resolve('ajv')` из корня не находит
  пакет, pnpm не поднимает зависимости зависимостей. Цена: test зависит от того, что эта цепочка
  тянет ajv 8. Если пакет так не найдётся, test падает с текстом, что именно не нашлось и зачем оно
  нужно, — не пропускается. Другой путь — `ajv` в devDependencies (`package.json` и
  `pnpm-lock.yaml`, оба вне следа). Первый круг брал ajv 6 из зависимостей `eslint` со
  `strictKeywords`; reviewer показал, что он не равен валидатору Claude Code в обе стороны (пропускал
  `if` без `then`, ложно отвергал `$defs` и `nullable`), и test переведён на ajv 8.
- **Test равен валидатору Claude Code 2.1.291 по опциям и порядку вызовов, но не строже его.**
  Запись первого круга «test строже валидатора Claude Code» была неверной и убрана. Равенство —
  по чтению пакета, а не по запуску; при обновлении Claude Code его нужно сверить (см. выше).
- **Настоящий Claude Code схему не проверял.** Запускать его Implementer-у запрещено. Это закрывает
  приёмка после мержа (четвёртый пункт «Готово, когда»). Не проверен и ответ API на эту схему как на
  входную схему инструмента: это другой валидатор, не Ajv.
- **Только `failed` останавливает ожидание в приёмке.** Шаг `harness` (Harness не установлен или не
  той версии) тоже не ведёт к форме, но Ticket называет только `failed`; при `harness` test ждёт
  15 минут и тогда пишет шаг и текст диалога.

### Остальные вызовы со структурированным ответом

Других нет. `outputFormat` в `src/` задаёт только `ProjectConnector.draft`
(`src/main/projects/connect.ts`); `src/main/ipc/projects.ts` (`sdkDraftQuery`) и
`src/main/agent/options.ts` (`draftSessionOptions`, `sessionOptions`) передают его дальше без
изменений. Обычные Session и Subagent-ы `outputFormat` не задают.

### Не проверено

- не проверено: control-test-ы приёмки под Playwright не запускались — `pnpm test:acceptance` и
  Playwright с `playwright.acceptance.config.ts` Implementer-у запрещены. Вместо этого тела обоих
  control-test-ов и `expectDraftForm` вырезаны из файла и выполнены под Node с `expect` из
  `@playwright/test`: зелёные. Мутанты helper-а — все красные: чтение атрибута без остатка времени;
  чтение текста без timeout; постоянный timeout вместо остатка; остаток без нижней границы; отказ
  чтения атрибута не превращён в ошибку helper-а; то же для текста; любой шаг, кроме `drafting` и
  `failed`, — успех; не останавливаться на `failed`; без текста диалога при `failed`; без текста
  диалога по таймауту; останавливаться на любом шаге. Третий пункт «Готово, когда» остаётся `[ ]` до
  запуска `pnpm test:acceptance -g control`.
- не проверено: настоящий Playwright с диалогом, которого нет в DOM, — что `getAttribute` с timeout
  отказывает именно так, как подставной объект control-test-а (ошибка с «Timeout … exceeded»).
- не проверено: шаг Draft с настоящим Claude Code в песочнице (четвёртый пункт) и gate full — шаги
  Orchestrator-а.

### Gate оркестратора (2026-10-10)

- Ревью — `VERIFIED` с первого круга на `eb09685` ([комментарий в PR #238](https://github.com/IDSAD-XL/worfy/pull/238#issuecomment-6100609767)). Reviewer прочитал, не запуская, пакет Claude Code 2.1.291 и нашёл, чем проверяется `--json-schema`: `new Ajv({allErrors:true, validateFormats:false, multipleOfPrecision:6})`, затем `validateSchema` и `compile` — Ajv 8, строгий режим по умолчанию. Схема, которая уходит в Session после правки, этим валидатором компилируется без ошибок и без записей строгого режима; схема с диска как есть даёт тот же текст отказа, что был в приёмке.
- Из-за этого находка [med]: contract test первого варианта проверял схему ajv 6 со `strictKeywords` (выбор Orchestrator-а из двух вариантов Implementer-а) — он не равен валидатору Claude Code. До мержа Implementer заменил его на Ajv 8 с теми же опциями и закрыл три находки [low] (`eb09685..270147a`); второй взгляд того же reviewer-а — `VERIFIED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/238#issuecomment-6100868847)). Решение «ajv 6 через eslint» этим снято.
- Долг: [low] `src/main/projects/connect.ts:265` — `sessionSchema` не заходит в `$defs`. Отказа это не даёт (Ajv 8 компилирует `$defs`), а если `$defs` с `$schema` или `$id` появится в файле схемы, contract test покраснеет.
- не проверено: три опции валидатора и вызов `validateSchema` test не закрепляет (в схеме нет `format` и `multipleOf`); при обновлении Claude Code опции сверить чтением пакета. Ответ API на схему как на входную схему инструмента. Шаг Draft с настоящим Claude Code — повтор приёмки «silent» (Ticket 26), когда владелец даст пустой репозиторий.
- Мерж: rebase на `04fe3db` (после PR #235, без конфликта), head `f3a447d`; `GATE_SCOPE=all gate full` — код 0 с первого запуска, не из кэша, строка `[gate] зелено (full)`; CI зелёный, CLEAN, влит `5b58c58`.
- Шаг владельца: правка в коде приложения — в Stable copy «Add project» заработает после `pnpm install:stable`.

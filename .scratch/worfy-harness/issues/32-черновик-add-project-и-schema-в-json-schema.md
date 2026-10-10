# 32 — Черновик «Add project» падает: Claude Code отвергает ключ `$schema` в схеме черновика

Type: task
Status: claimed — 2026-10-10
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
  15 минут — тоже текст диалога и шаг, на котором диалог остался.

### Ключевые слова 2020-12 (п. 2 «Что делаем»)

В схеме их нет: она использует только `type`, `enum`, `required`, `properties`,
`additionalProperties`, `items`, `minLength`, `minItems`, `title`, `description` — всё это есть в
draft-07. Единственное, что отвергал валидатор, — ключ `$schema`. Заменять или убирать больше нечего.
Если ключевое слово нового черновика появится в файле позже, contract test упадёт: валидатор в нём
считает неизвестное ключевое слово ошибкой. `sessionSchema` такие слова не переводит и вглубь
`$defs`, `prefixItems`, `dependentSchemas` не заходит — это решение для того Ticket-а, который их
добавит.

### Test-ы

`test/contract/projects-connect.test.ts`, блок «the draft Session (step 4)»:

- «the schema file as it is fails a draft-07 validator…» — сам симптом: схема с диска как есть
  отвергается с текстом `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`
  (тот же текст, что в stderr Claude Code 2.1.291). Там же: неизвестное ключевое слово
  (`prefixItems`) — ошибка, а не пропуск.
- «gets the schema of the file without $schema and $id…» — `query` получает схему файла без этих
  ключей на любом уровне, валидатор её компилирует, остальное содержимое совпадает с файлом.
- «takes $schema and $id out of every schema inside the schema…» — схема с вложенными `$schema` и
  `$id` во всех местах draft-07 и с полями и значениями по имени `$id`; вход заморожен.
- До правки (база `9c6f4fe`, она содержит `ba6a134`) второй и третий test-ы красные: `2 failed | 23
  passed`, код 1.
- Мутанты `sessionSchema`, каждый — код 1: схема с диска как есть (2 test-а красные); только верхний
  уровень (1); убирать ключи везде, включая имена полей и значения (1); правка входа на месте (3);
  без обхода списков схем (1); без обхода схем по имени (1); оставить `$id` (1). Мутанты test-а:
  `ajv` не найден (3 красные, текст «ajv was not found among the dependencies of eslint…»);
  валидатор, который ничего не компилирует (1).
- В первом test-е блока ожидание `outputFormat` «равно схеме файла» заменено на проверку
  `type`: прежнее ожидание закрепляло сам дефект. Содержимое схемы теперь проверяют новые test-ы.
- `bin/project-connect`: `bash harness/bin/tests/project-connect.test.sh` — `passed: 98, failed: 0`,
  без правок; test «a draft off the schema is an error with its reasons» зелёный без правок.

`test/acceptance/e3.spec.ts`: control-test «silent: control — a draft that failed stops the wait at
once with what the dialog says (no app)» — три случая: `failed` после одного чтения `drafting`
(ошибка с текстом диалога, два чтения, без ожидания), застрявший `drafting` (ошибка с шагом и текстом
диалога), переход в `form`.

### Решено без владельца, подтвердить

- **Валидатор в contract test-е — ajv 6.15.0 из зависимостей `eslint`**
  (`createRequire(<eslint/package.json>)('ajv')`), с `strictKeywords: true`. Своего `ajv` у
  репозитория нет: `require.resolve('ajv')` из корня не находит пакет, pnpm не поднимает транзитивные
  зависимости. ajv 6 знает только draft-07 и отвечает на схему с диска тем же текстом, что
  Claude Code 2.1.291. Цена: test зависит от того, что `eslint` тянет ajv 6. Если пакет так не
  найдётся, test падает с текстом, что именно не нашлось и зачем оно нужно, — не пропускается.
  Другой путь — `ajv` в devDependencies (`package.json` и `pnpm-lock.yaml`, оба вне следа).
- **Настоящий Claude Code схему не проверял.** Запускать его Implementer-у запрещено. То, что
  валидатор Claude Code — тот же ajv или ведёт себя так же, — вывод из совпадения текста отказа, а не
  проверенный факт. Это закрывает приёмка после мержа (четвёртый пункт «Готово, когда»).
- **Test строже валидатора Claude Code**: неизвестное ключевое слово в нём — ошибка. Из-за этого
  ничего убирать не пришлось: случая «draft-07 знает, а ajv 6 в строгом режиме не принимает» в схеме
  нет.
- **Только `failed` останавливает ожидание в приёмке.** Шаг `harness` (Harness не установлен или не
  той версии) тоже не ведёт к форме, но Ticket называет только `failed`; при `harness` test ждёт
  15 минут и тогда пишет шаг и текст диалога.

### Остальные вызовы со структурированным ответом

Других нет. `outputFormat` в `src/` задаёт только `ProjectConnector.draft`
(`src/main/projects/connect.ts`); `src/main/ipc/projects.ts` (`sdkDraftQuery`) и
`src/main/agent/options.ts` (`draftSessionOptions`, `sessionOptions`) передают его дальше без
изменений. Обычные Session и Subagent-ы `outputFormat` не задают.

### Не проверено

- не проверено: control-test приёмки под Playwright не запускался — `pnpm test:acceptance` и
  Playwright с `playwright.acceptance.config.ts` Implementer-у запрещены. Вместо этого тело
  control-test-а и `expectDraftForm` вырезаны из файла и выполнены под Node с `expect` из
  `@playwright/test`: зелёные; мутанты «не останавливаться на `failed`», «без текста диалога при
  `failed`», «без текста диалога по таймауту», «останавливаться на любом шаге» — красные. Третий пункт
  «Готово, когда» остаётся `[ ]` до запуска `pnpm test:acceptance -g control`.
- не проверено: шаг Draft с настоящим Claude Code в песочнице (четвёртый пункт) и gate full — шаги
  Orchestrator-а.

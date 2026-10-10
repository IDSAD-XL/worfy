# 32 — Черновик «Add project» падает: Claude Code отвергает ключ `$schema` в схеме черновика

Type: task
Status: open
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

- [ ] Contract test: `query` получает схему без `$schema` и `$id`; та же схема компилируется
      валидатором draft-07 без ошибок. Test красный на main `ba6a134` и на мутанте, который возвращает
      схему с диска как есть.
- [ ] `bin/project-connect --schema-only` и проверка черновика по схеме работают как раньше (их
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

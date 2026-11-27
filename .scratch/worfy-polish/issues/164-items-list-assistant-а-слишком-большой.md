# 164 — `items_list` Assistant-а слишком большой: Claude Code прячет ответ в файл, а Read у Assistant-а нет

Type: bug
Status: done 2026-11-27T00:21Z
PR: #2295
Branch: worfy-polish/164
Blocked by: —
Source: отчёт владельца 2026-11-26 (снимок чата Assistant-а): Assistant-у передали два пункта Project-а CanvasForAI —
`item-ebc91600d4ce52e1` (Session закончила ход) и `item-146cd5e9a1242331` (PR в PR inbox ждёт правки), — и он не смог
их разобрать: «`items_list` вернул слишком большой ответ (55 КБ). Он сохранился в файл, а у меня нет инструмента, чтобы
его прочитать. Из начала ответа видны только другие элементы».

Кто: агент; последний пункт — владелец.

## Что происходит

- Tool `items_list` MCP-сервера `worfy-app` не берёт аргументов (`src/shared/assistant/app-tools.ts:38`, описание
  `:79`) и отдаёт все пункты целиком: текст, ссылки, тексты действий, пункты Linked machine (до 200 на машину, строка до
  2 000 знаков). При ~56 пунктах это 55 КБ.
- Claude Code сохраняет результат tool-а больше своего порога в файл и показывает модели только начало. Session
  Assistant-а работает только с tool-ами `worfy-app`, без Read (`src/main/assistant/session/runner.ts`,
  `src/main/vendors/claude/assistant-session.ts`), и прочитать файл не может.
- Первое сообщение Session (`wakePrompt`) называет переданные пункты только id и велит прочитать их через
  `items_list`. Пункт Session, закончившей ход, не несёт duty (`duty: null`), поэтому duty его не показывают, и в
  `items_list` его нет вовсе: даже маленький ответ его бы не назвал.
- Итог: каждый wake с накопившимися пунктами проваливает главную работу Assistant-а.

## Что строить

1. `items_list` получает необязательные фильтры: `ids` (до 50), `project`, `kind`, `state` (по умолчанию open), `limit`
   (по умолчанию 20, не больше 50) и `cursor` для страниц. Каждый ответ несёт `total` и `nextCursor`, чтобы модель
   знала, что есть ещё.
2. Каждый пункт списка — компактный: id, kind, Project, заголовок, state, срочность, время и короткая ссылка на источник
   (номер PR, id Session). Крупные поля (чужой текст целиком, ссылки, тексты действий) — только в `items_list` с `ids` и
   `full: true`. Ответ держится заметно ниже порога Claude Code; порог найти в самом Claude Code и назвать, где он.
3. Где Assistant-а будят ради конкретных пунктов (первое сообщение, `worfy-assistant` 06 и 10), их компактные записи
   идут в самом сообщении — как данные, объектами `outside-text`, — чтобы ему не нужен был вызов списка, чтобы узнать,
   зачем его разбудили. Пункт по `ids` находится, даже когда duty его не показывают.
4. Обновить описания tool-ов, инструкции Assistant-а (`src/main/mcp/agent-instructions-app.md`,
   `harness/hooks/rules/assistant.md`) и `docs/features/assistant.md` (только английская страница).
5. Правила `worfy-app` о чтении и закрытом списке (`worfy-assistant` 09) не меняются. Tool Read Assistant-у не даётся.

## Где в коде

- `src/shared/assistant/app-tools.ts` — форма аргументов `items_list` (`:38`), описание (`:79`), пределы.
- `src/main/mcp/app-server.ts` — `items_list` (`:384-387`), `itemView`, `linkedItemView`; новый компактный вид пункта.
- `src/main/assistant/session/runner.ts` — `wakePrompt` (`:70-90`): записи переданных пунктов.
- `src/main/assistant/session/app.ts` — wiring `AssistantSessions` (`itemId: publicItemId`).
- `src/main/mcp/agent-instructions-app.md`, `harness/hooks/rules/assistant.md` — что Assistant читает и как.
- `docs/features/assistant.md` — раздел «How it works», абзац «The Session».
- `test/contract/worfy-app-tools.test.ts`, `test/contract/assistant-two-machines.test.ts`,
  `test/unit/assistant-session.test.ts` — test-ы.

## Решения

- Один путь к крупным полям — `items_list` с `ids` и `full: true`, без нового tool-а `item_get`: список tool-ов
  `worfy-app` (`worfy-assistant` 09) не растёт, и переданные пункты читаются одним вызовом.
- Порог Claude Code — 50 000 знаков (`vE=50000` в бинарнике Claude Code 2.1.323; tool-у MCP свой предел не
  ниже). Ответ `items_list` держится в своём бюджете 20 000 знаков: страница кончается раньше, чем бюджет, и
  `nextCursor` называет следующую.
- Первое сообщение несёт записи пунктов объектами `outside-text` внутри JSON-блока — так же, как память
  (`worfy-assistant` 10, `memoryForPrompt`). Прежнее «без их текста» Ticket-а 10 меняется на «текст только объектом
  `outside-text`»: граница 2 ADR-0114 (чужой текст — только данные) соблюдена.

## Test-ы

- Contract `test/contract/worfy-app-tools.test.ts`: фильтры, страницы (`total`, `nextCursor`), `ids` находит пункт без
  duty, `full: true` только с `ids`, 200 больших пунктов по умолчанию — ответ меньше 50 000 знаков и байт.
- Contract `test/contract/assistant-two-machines.test.ts`: пункты Linked machine — в общем списке, read-only.
- Unit `test/unit/assistant-session.test.ts`: первое сообщение несёт записи переданных пунктов, их текст — только
  внутри объекта `outside-text`.

## Готово, когда

- [ ] `items_list` фильтрует по `ids`, `project`, `kind`, `state`, отдаёт страницы с `total` и `nextCursor`;
      компактные пункты по умолчанию, `full: true` с `ids` — целиком.
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts test/contract/assistant-two-machines.test.ts` exit 0 · mac - · e773cf5bad41d53e0aeb22ce9c47c2df8a377966
  - evidence: review pass · PR #2295 · - - · 5c8a7aecf6a86cf1e47eddd2436f10e17a11a121
- [ ] 200 больших пунктов по умолчанию — ответ `items_list` меньше порога Claude Code (50 000 знаков); порог и его
      источник названы в «Итог».
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts` exit 0 · mac - · e773cf5bad41d53e0aeb22ce9c47c2df8a377966
  - evidence: review pass · PR #2295 · - - · 5c8a7aecf6a86cf1e47eddd2436f10e17a11a121
- [ ] Первое сообщение Session несёт компактные записи переданных пунктов; test это проверяет.
  - evidence: test-run pass · `pnpm test test/unit/assistant-session.test.ts` exit 0 · mac - · e773cf5bad41d53e0aeb22ce9c47c2df8a377966
  - evidence: review pass · PR #2295 · - - · 5c8a7aecf6a86cf1e47eddd2436f10e17a11a121
- [ ] Описания tool-ов, инструкции Assistant-а и `docs/features/assistant.md` говорят о фильтрах и страницах.
  - evidence: commit pass · worfy-polish/164: WIP instructions and the feature page on items_list pages · - - · e773cf5bad41d53e0aeb22ce9c47c2df8a377966
  - evidence: review pass · PR #2295 · - - · 5c8a7aecf6a86cf1e47eddd2436f10e17a11a121
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · e773cf5bad41d53e0aeb22ce9c47c2df8a377966
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45904220733/job/140211313351 · ci - · 5c8a7aecf6a86cf1e47eddd2436f10e17a11a121
- [ ] (вручную) Сделай: в Stable worfy с накопившимися 50+ пунктами (Waits) дождись wake Assistant-а или напиши ему
      «Что ждёт меня?» → Должно быть: Assistant называет пункты, ради которых его разбудили, их Project и что в них, и
      не пишет, что ответ слишком большой или сохранён в файл.
  - needs: mac stable

## Итог

- Порог Claude Code — 50 000 знаков: в бинарнике Claude Code 2.1.323 модуль сохранения результатов (`<persisted-output>`)
  берёт `Math.min(maxResultSizeChars, vE)` при `var vE=50000`; общий шаблон MCP tool-а объявляет `maxResultSizeChars:1e5`.
  Удалённая настройка `tengu_velvet_ibis` может задать порог tool-а иначе. Отдельный предел MCP — `MAX_MCP_OUTPUT_TOKENS`,
  25 000 token-ов (обрезка, не файл), он выше. Константа — `CLAUDE_CODE_RESULT_TO_FILE_CHARS`
  (`src/shared/assistant/app-tools.ts`).
- `items_list`: `ids` (до 50), `project`, `kind`, `state` (`open` по умолчанию без `ids`, `all` с `ids`), `limit` (20 по
  умолчанию, до 50), `cursor`; ответ — `total`, `nextCursor`, `items`, `missing` (неизвестные `ids`), `linked` (каждая
  Linked machine с `problem` и числом `waiting`). Пункты этой машины и Linked machine — в одном списке, срочные первыми,
  потом новые; пункт Linked machine несёт `readOnly: true` и `machine`. Страница кончается по `limit` или раньше, чем ответ
  перейдёт 20 000 знаков (`ITEMS_LIST_ANSWER_MAX_CHARS`).
- Короткая запись (`compactItemView`): id, Project, source, kind, state, urgent, duty, время, subject (kind, id), `pr`
  (repo, number), заголовок до 300 знаков объектом `outside-text`, действия duty с режимом без текста. Целиком — `ids` и
  `full: true`; `full` без `ids` — отказ. Нового tool-а нет.
- По `ids` находится любой пункт ядра, не только показанный duty: пункт Session, закончившей ход (`duty: null`), раньше
  в `items_list` не попадал вовсе.
- Первое сообщение (`wakePrompt`) несёт записи до 20 переданных пунктов JSON-блоком, остальные — по id
  (`WAKE_ITEM_RECORDS_MAX`, решено без владельца: 20 записей — около 10 000 знаков рядом с памятью до 32 000). Правило
  Ticket-а `worfy-assistant` 10 «id без текста» заменено на «текст только объектом `outside-text`», как у памяти.
- 200 больших пунктов и 200 пунктов Linked machine: каждая страница по умолчанию — не больше 20 000 знаков и меньше
  50 000 байт; обход всех страниц читает 400 пунктов по разу; `full: true` по 50 `ids` идёт страницами и тоже в пределе.

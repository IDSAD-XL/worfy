# 147 — Аудит повторного review: Product chat, запросы Session и Projects

Type: bug
Status: claimed 2026-11-25T16:45Z
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «В Ticket-ы»; checked open on main b0e073620 2026-11-25

Кто: агент. Глубина review — `low`. Не платформенный PR.

Пять finding-ов аудита повторного review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера 63, 65,
184, 130, 145): что пользователь не видит или не может сделать в Product Session, в карточке Session и в разделе Projects
sidebar-а. Каждое проверено на main b0e073620: все пять открыты.

## Что происходит

- **65. После Resume пропадают ответы на AskUserQuestion.** `shownInProductChat`
  (`src/renderer/session/product-session.ts:36-37`) пропускает в чат Product Session из `extension` только живые
  `permission_request` и `question_request`; `tool_use` и `tool_result` уходят в `default: return false`. После Resume
  или reload история приходит из файла Session, где вопрос — это `tool_use` `AskUserQuestion` и его `tool_result`.
  Сценарий: советник спросил «Какой сегмент первым?» с тремя вариантами, владелец выбрал второй; после перезапуска worfy
  в чате нет ни вопроса, ни выбора, и не видно, почему дальше в чате идёт этот сегмент.
- **184. Запрос background task не виден в новом окне.** `src/renderer/session/open-requests.ts:60`: окно спрашивает
  `agent.requests` только при `state === 'needs_permission'`. Background task Session может ждать ответа пользователя,
  пока сама Session `idle`. Сценарий: пользователь открыл второе окно или перезагрузил окно после такого запроса —
  карточки запроса нет, а через 60 минут запрос истекает, и background task падает без ответа.
- **63. Chip темы, которой нет на карте, не работает.** `src/renderer/product/MindMap.tsx:1093-1096`: подписка на
  `useMindMapFocus` выходит, если `asked.topic !== topic.name`. Тему карты выбирает `ProductSessionPanel`
  (`src/renderer/session/ProductSessionPanel.tsx:86-96`, `followed`; `:386`). Сценарий: в чате chip node-а из темы
  B, открыта карта темы A; клик по chip ничего не делает и ничего не говорит.
- **145. Tooltips частей карточки Projects не видны клавиатуре.** `src/renderer/shell/sidebar/ProjectsSection.tsx:333`:
  `<Tooltip label={part.hint}>` висит на `span` внутри `<button>` карточки (`:377`). Tooltip kit-а показывается по
  focus на своём элементе, а focus бывает только на кнопке. Сценарий: пользователь клавиатуры встаёт на карточку
  Project-а — подсказки «N busy», «N needs you» не появляются, экранный диктор их не читает.
- **130. Вложенный repository со своим Profile считается частью удаляемого.** `src/main/projects/remove.ts:137-139`
  (`listedInside`) берёт каждый Project из списка внутри папки удаляемого и считает, что он «resolves to its Profile».
  По нему закрываются Session-ы (`closeInside`, `:228`, `:262`), останавливаются Orchestrator-ы (`:259`), notice
  называет его в `alsoListed` (`:184`). Сценарий: пользователь удаляет Project monorepo, внутри которого лежит
  отдельный зарегистрированный repository со своим Profile; Session-ы и Orchestrator этого Project-а закрываются, хотя
  он остаётся в списке, а notice говорит, что он делил Profile с удалённым.

## Что делаем

1. 65: чат Product Session рисует из истории отвеченный `AskUserQuestion` (`tool_use` с его `tool_result`) той же
   строкой, что показывает живой вопрос после ответа: вопрос и выбранный вариант. Другие tool-строки не показываются.
2. 184: окно один раз на монтирование Session спрашивает `agent.requests`, если journal не знает открытых запросов, при
   любом state Session (не только `needs_permission`); повтор — только при смене state на `needs_permission`, как
   сейчас.
3. 63: клик по chip node-а другой темы переключает карту `ProductSessionPanel` на эту тему, после чего node выбран и
   виден; темы нет — toast с её именем.
4. 145: подсказки частей карточки входят в доступное описание кнопки карточки (`aria-describedby` на скрытый текст), без
   вложенных фокусируемых элементов внутри `<button>`.
5. 130: Project внутри удаляемой папки, который резолвится в свой Profile (не в Profile удаляемого), не считается
   вложенным: его Session-ы не закрываются, Orchestrator не останавливается, notice его не называет.

## Готово, когда

- [ ] 65: unit test `test/unit/product-session-panel.test.tsx` — история с `tool_use` `AskUserQuestion` и его
      `tool_result`: в чате видны вопрос и выбранный вариант. Красный на origin/main.
- [ ] 184: unit test `test/unit/waiting-requests.test.tsx` — Session `idle`, journal без запросов: через
      `ASK_OPEN_REQUESTS_AFTER_MS` один вызов `agent.requests`; второй render без смены state — без вызова. Красный на
      origin/main.
- [ ] 63: unit test `test/unit/node-chips.test.tsx` (или `test/unit/product-session-panel.test.tsx`) — открыта тема
      A, клик по chip node-а темы B: карта показывает тему B и этот node выбран. Красный на origin/main.
- [ ] 145: unit test `test/unit/project-pulse-line.test.tsx` — доступное описание кнопки карточки содержит текст
      подсказок частей («2 busy»…). Красный на origin/main.
- [ ] 130: test `test/contract/projects-remove.test.ts` рядом со случаем вложенного Project-а с общим Profile — вложенный
      Project со своим Profile: его Session не закрыта, его Orchestrator не остановлен, `alsoListed` пуст. Красный на
      origin/main.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/session/product-session.ts:25-40` (`shownInProductChat`)
- `src/renderer/session/open-requests.ts:45-75`
- `src/renderer/product/MindMap.tsx:1090-1100`; `src/renderer/session/ProductSessionPanel.tsx:85-100`, `:375-388`;
  `src/renderer/product/node-chips.ts:169-176` (`useMindMapFocus`, `pickNode`)
- `src/renderer/shell/sidebar/ProjectsSection.tsx:325-345`, `:375-380`
- `src/main/projects/remove.ts:137-139`, `:180-186`, `:225-265`
- `test/unit/product-session-panel.test.tsx`, `test/unit/waiting-requests.test.tsx`, `test/unit/node-chips.test.tsx`,
  `test/unit/project-pulse-line.test.tsx`, `test/contract/projects-remove.test.ts`
- `docs/features/product-session.md:89` — вопросы с вариантами видны и после Resume

## Вне скоупа

- Остальные находки `triage.md`.
- Прочие tool-строки в чате Product Session: их по-прежнему нет (решение «Thinking, tool calls … are left out»).

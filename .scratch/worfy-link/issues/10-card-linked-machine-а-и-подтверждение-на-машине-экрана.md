# 10 — Card Linked machine-а через worfy-card:// своей Machine; подтверждение там, где Card открыта

Type: task
Status: open
Blocked by: 09
Source: решения владельца 2026-10-07: Q3 (с другой машины можно всё, кроме действий, которым нужен рабочий стол машины Project-а), Q9 (один репозиторий на двух Machine — два Project-а), Q14 (системные диалоги — в UI машины, откуда вызваны; подтверждение Card — где она открыта); [spec.md](../spec.md); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md) — Machine и Linked machine; [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) — несколько экранов на одном Project-е, диалоги на машине экрана; [ADR-0012](../../../docs/adr/0012-card-origin-worfy-card-scheme.md) — Card на своём origin схемы `worfy-card://`

## Что происходит

- Адрес Card — `worfy-card://<card id>.<project label>/<путь>`, где project label — 8 hex-знаков,
  которыми кончается id Project-а (`src/main/cards/protocol.ts:5-7`, `:113-123`). Схема
  зарегистрирована как standard и secure (`:243-245`), поэтому у каждой Card свой origin.
- Файлы отдаёт main своей машины через `protocol.handle` (`protocol.ts:248-250`). `createCardHandler`
  (`:197-219`) ищет Project по label среди своих Project-ов (`src/main/cards/store.ts:117-126`:
  ровно один Project с этим label, иначе 404), проверяет путь `resolveCardFile` (`protocol.ts:160-186`:
  только обычный файл внутри папки Card и расширение из списка), вставляет в HTML runtime Card API
  (`:99-108`, `:216`) и ставит заголовки CSP, nosniff, no-store (`:36-54`).
- Адрес строит машина Project-а: `cards.get` отдаёт `url` (`store.ts:131`), `CardNode` кладёт его в
  `src` iframe (`src/renderer/canvas/nodes/CardNode.tsx:156-167`).
- Кадр Card может ходить только по своему origin: правило сравнивает card id и project label
  (`protocol.ts:234-240`), main применяет его в `will-frame-navigate` (`src/main/window.ts:206-209`).
  CSP окна пускает кадры схемы целиком: `frame-src worfy-card:` (`src/renderer/index.html:5`).
- Мост Card ↔ окно. Overlay находит кадры и берёт их origin через `cardOriginOf(element.src)`
  (`src/renderer/canvas/overlays/CardBridge.tsx:24-34`). `cardOriginOf` принимает только
  `<id>.<8 hex>` (`src/shared/cards/bridge.ts:188-192`). Сообщение принимается только от
  contentWindow этого кадра и с его origin (`src/renderer/canvas/card-bridge.ts:2-7`). Запросы Card
  идут в main каналами `cardApi.dataGet`, `cardApi.dataSet`, `cardApi.ask` (`CardBridge.tsx:79-83`).
- `cardApi.ask` целиком на машине Project-а. `CardAsk.ask` (`src/main/cards/ask.ts:73-90`) держит один
  вопрос на Card (`:58-59`, `:74-76`), выбирает получателя, затем зовёт `confirm` →
  `confirmAsk` (`src/main/ipc/card-api.ts:43-61`). У получателя без человека (Autopilot) диалога нет,
  Card получает отказ (`:44-48`). Иначе — `dialog.showMessageBox` на окне, которое спросило (`:59`,
  окно — из `event.sender`, `:95-97`). После «Send» — `sendFromCard` с отметкой ввода человека
  (`:68-72`).
- После Ticket-а 09 окно на Linked machine-е M получает `url` от M — с project label Project-а M.
  Свой main ищет этот label среди своих Project-ов. Если та же папка — Project и на своей машине
  (dev-сборка и Stable copy на одном Mac), окно покажет свою Card под видом Card M; иначе — 404.
  `cardApi.ask` уходит на M, и диалог открылся бы на экране M; Ticket 08 запрещает его Linked
  machine-ам, поэтому Card получает отказ.

## Что делаем

1. **Адрес Card Linked machine-а** (Q3, Q9) —
   `worfy-card://<card id>.<project label>.<machine label>/<путь>`. Machine label — 8 hex-знаков от id
   Machine (например, первые 8 знаков sha256 id). Origin такой Card не совпадает с origin своей Card,
   даже когда card id и project label одинаковы. Адрес своей Card не меняется.
   - `parseCardUrl` (`protocol.ts:137-146`) и `cardOriginOf` (`bridge.ts:188-192`) принимают обе формы
     и отдают machine label (или его отсутствие).
   - `allowFrameNavigation` (`protocol.ts:234-240`) сравнивает весь host: card id, project label и
     machine label. Кадр Card M не уходит на свою Card с теми же id, и наоборот.
   - CSP окна (`index.html:5`) не меняется: `frame-src worfy-card:` пускает обе формы.
2. **Кто строит адрес.** В окне на M `CardNode` переписывает `url` от M в форму с machine label
   (helper рядом с `cardOriginOf` в `src/shared/cards/bridge.ts`; machine label окно знает по id
   своей Machine из Ticket-а 09). Адрес M без machine label в окне на M в iframe не попадает.
3. **Свой main отдаёт файлы Card M.** `createCardHandler` получает второй источник файлов — для
   адреса с machine label:
   - Linked machine с таким label нет — 404 с теми же заголовками;
   - иначе свой main просит у M файл новым каналом `cards.file {projectLabel, cardId, path}` через
     вызов канала на Linked machine-е из main (Ticket 09). M сам находит папку (`store.ts:117`) и
     проверяет путь (`resolveCardFile`), отдаёт тип и байты base64 (по проводу только JSON) или «нет
     файла». Runtime M не вставляет;
   - свой main вставляет в HTML свой runtime Card API (`injectCardRuntime`): runtime должен совпадать
     с мостом окна, а dev-сборка и Stable copy бывают разных версий;
   - заголовки — те же `CARD_HEADERS` и Content-Type, что у своей Card;
   - файл больше 20 МБ (как `FILE_COPY_LIMIT_BYTES`, `src/shared/agent/attachments.ts:29`) — ответ
     413 с теми же заголовками. Предел выбран в этом Ticket-е;
   - `installCardRuntime` берёт второй источник из `src/main/cards/remote.ts`, поэтому
     `src/main/index.ts` (`:83`) не меняется.
4. **Данные Card** — `cardApi.dataGet` и `cardApi.dataSet` идут на M без изменений: данные Card живут
   на машине Project-а.
5. **Подтверждение `session.ask` — на машине экрана** (Q14). Один путь для своих Project-ов и
   Project-ов Linked machine-ов; `cardApi.ask` заменяют три канала:
   - `cardApi.askPrepare {projectId, cardId, text}` — на машине Project-а. Один вопрос на Card, как
     сейчас. Получатель без человека — отказ и событие `refused_dialog`, как сейчас (`card-api.ts:44-48`).
     Ответ: `{askId, cardTitle, recipientLabel, message}`; вопрос ждёт ответа на машине Project-а;
   - `cardApi.confirm {cardTitle, recipientLabel, message}` — пометка `local` (Ticket 08), поэтому в
     окне на Linked machine-е вызов идёт в свой main (Ticket 09): `dialog.showMessageBox` на окне,
     которое спросило, с теми же кнопками и текстом, что у `confirmAsk` (`card-api.ts:49-58`);
     ответ `{send}`;
   - `cardApi.askFinish {projectId, askId, send}` — на машине Project-а: `send: true` — `sendFromCard`
     (`card-api.ts:68-72`), иначе ничего; вопрос снят.

   Ждущий вопрос снимается и тогда, когда экран, который спросил, ушёл из реестра клиентов
   (Ticket 03), и через 10 минут без ответа. Иначе Card навсегда осталась бы с «already has a question
   waiting» (`ask.ts:75`). Срок выбран в этом Ticket-е.

   Интерфейс Card не меняется: `window.worfy` внутри Card (`src/card-runtime/worfy-card.ts`) и
   `CardBridgeBackend.ask` (`src/renderer/canvas/card-bridge.ts:54`) прежние; меняется только то, что
   за ним стоит (`CardBridge.tsx:83`). Канал `cardApi.ask` уходит: его зовёт только `CardBridge.tsx:83`.

   Отвергнуто: машина Project-а сама спрашивает экран через соединение. Для этого нужен запрос от
   машины Project-а к экрану и выбор окна на машине экрана; три канала обходятся запросом и ответом
   от renderer, которые уже есть.
6. **Пометки Ticket-а 08.** `cards.file`, `cardApi.askPrepare`, `cardApi.askFinish` — `project`.
   `cardApi.confirm` — `local`: диалог показывает машина экрана, Linked machine этот канал на машине
   Project-а не зовёт. Пометка `desktop` у `cardApi.ask` уходит вместе с каналом.

**Не входит:** прочие системные действия — вложение «+», ссылки, «открыть в редакторе» (Ticket 12);
выбор папки Project-а (Ticket 11).

## Готово, когда

- [ ] contract `test/contract/card-protocol.test.ts`: `parseCardUrl` разбирает адрес с machine label; адрес из двух частей — как раньше; origin Card M не равен origin своей Card с теми же card id и project label; `allowFrameNavigation` не пускает кадр Card M на свою Card с теми же id и наоборот.
- [ ] contract: обработчик со вторым источником (подменённая Linked machine) отдаёт файл Card M с `CARD_HEADERS` и верным Content-Type; в HTML вставлен runtime своей машины; неизвестный machine label, «нет файла» у M и метод не GET/HEAD — ответы как у своей Card (404, 405) с теми же заголовками; файл больше 20 МБ — 413 с теми же заголовками.
- [ ] contract: `cards.file` на машине Project-а не отдаёт путь вне папки Card (`..`, symlink наружу), файл с расширением не из списка и Card неизвестного label; HTML отдаётся без runtime.
- [ ] contract `test/contract/card-bridge.test.ts`: `cardOriginOf` для обеих форм адреса; helper перевода `url` M в форму с machine label.
- [ ] contract `test/contract/card-api.test.ts`: `askPrepare` → `askFinish(send: true)` отправляет текст получателю с отметкой ввода; `send: false` — ничего; второй `askPrepare` той же Card, пока первый ждёт, — отказ; ждущий вопрос снимается при уходе экрана и по сроку; получатель без человека — отказ и событие `refused_dialog` до показа диалога; пометка `cardApi.confirm` — `local`, у `cardApi.askPrepare`, `cardApi.askFinish` и `cards.file` — `project`.
- [ ] e2e `test/e2e/card-api.spec.ts` (свой Project): «Cancel» ничего не шлёт, «Send» доходит до Orchestrator — зелёный на новом пути.
- [ ] e2e `test/e2e/linked-cards.spec.ts` (новый, локально в gate full): два связанных worfy A и B, одна папка-fixture в обоих, Card `c1` с разным `<title>` у A и у B. A открывает Project B — в кадре Card B; свой Project в A — Card A. Правка файла Card на B перезагружает кадр в A за 1 s.
- [ ] e2e: `session.ask` из Card B в окне A — подменённый `dialog.showMessageBox` вызван в A один раз и ни разу в B; «Send» — текст в журнале fake-агента Orchestrator-а B; «Cancel» — ничего.
- [ ] e2e: Card B в окне A не достаёт ни окна, ни другой Card, ни своей Card A с теми же id — те же проверки, что `test/e2e/card-runtime.spec.ts:135`.
- [ ] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — exit 0.

## Тесты

Сначала падающий test — `test/contract/card-protocol.test.ts`: `parseCardUrl` адреса
`worfy-card://c1.0123abcd.89abcdef/index.html` отдаёт machine label. На main сейчас host из трёх
частей отклоняется (`protocol.ts:142`), test красный. В «Итог» — как он падал.

- `test/contract/card-protocol.test.ts` — адрес, правило навигации, второй источник файлов.
- `test/contract/card-bridge.test.ts` — `cardOriginOf` и перевод адреса.
- `test/contract/card-api.test.ts` — три канала вместо `cardApi.ask`.
- `test/e2e/card-api.spec.ts` — свой Project на новом пути.
- `test/e2e/linked-cards.spec.ts` — новый: Card Linked machine-а. Отдельный файл, а не
  `test/e2e/linked-machines.spec.ts`: Ticket-ы 11 и 12 идут в той же Wave и пишут свои файлы e2e.

## Где в коде

- `src/main/cards/protocol.ts`
- `src/main/cards/remote.ts` (новый)
- `src/main/cards/ask.ts`
- `src/main/ipc/card-api.ts`
- `src/main/ipc/cards.ts`
- `src/shared/ipc/card-api.ts`
- `src/shared/ipc/cards.ts`
- `src/shared/cards/bridge.ts`
- `src/renderer/canvas/nodes/CardNode.tsx`
- `src/renderer/canvas/overlays/CardBridge.tsx`
- `test/contract/card-protocol.test.ts`
- `test/contract/card-bridge.test.ts`
- `test/contract/card-api.test.ts`
- `test/e2e/card-api.spec.ts`
- `test/e2e/linked-cards.spec.ts` (новый)

Пометки Ticket-а 08 стоят в объявлениях каналов (`src/shared/ipc/cards.ts`,
`src/shared/ipc/card-api.ts`), поэтому общего файла с Ticket-ами 11 и 12 той же Wave нет. Модуль связи (`src/main/link/`) этот Ticket не правит: он только
зовёт функцию вызова канала на Linked machine-е из Ticket-а 09.

## Итог

Заполняется при закрытии.

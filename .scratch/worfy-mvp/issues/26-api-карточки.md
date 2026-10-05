# 26 — API Карточки через postMessage: свои данные, вопрос Сессии с подтверждением, workflow только для чтения

Type: task
Status: claimed — 2026-10-05
Blocked by: 10, 17, 24, 25
Source: [ADR-0003](../../../docs/adr/0003-cards-as-files-canvas-via-tools.md); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md); [CONTEXT.md](../../../CONTEXT.md), «Карточка»; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md), данные Карточек

## Что делаем

Карточка общается с worfy только сообщениями `postMessage`. Node у неё нет.

- Протокол (`src/shared/cards/bridge.ts`, zod): запрос `{type: 'worfy.request', requestId, op,
  args}`, ответ `{type: 'worfy.response', requestId, ok, data | error}`. Операции:
  - `data.get` / `data.set` — собственный JSON Карточки, до 1 МБ, в
    `<папка Проекта>/card-data/<id>.json` (`src/main/cards/data.ts`);
  - `session.ask {text}` — передать текст Сессии. worfy показывает системный диалог: имя
    Карточки, текст, Сессия-получатель. Только после «Send» текст уходит Сессии, которая последней
    правила Карточку (main выводит её из событий `tool_use`, тикет 24), а если её нет —
    Оркестратору. Отказ даёт
    `{ok:false, canceled:true}`;
  - `workflow.get` и `workflow.subscribe` — снимок Проекта только для чтения: Эпики, Тикеты (номер,
    заголовок, состояние, блокеры, Волна), бейджи Gate / PR / CI. Ничего, что меняет состояние;
  - со стороны worfy к Карточке — `card.text` (видимый текст, до 100 000 символов) для поиска (31).
- `src/renderer/canvas/card-bridge.ts` принимает сообщения только от `contentWindow` своего iframe
  и с ожидаемым origin; остальное молча отбрасывает.
- `src/card-runtime/worfy-card.ts` — маленький скрипт, который протокол из 25 подставляет в
  `<head>` каждой Карточки: `window.worfy.data.get()`, `.set()`, `.ask()`, `.workflow.get()`,
  `.workflow.subscribe()` как Promise-обёртки над сообщениями. Подстановка — правка
  `src/main/cards/protocol.ts`.
- Инструкция агенту из 24 получает раздел про этот API.

## Готово, когда

- [x] Contract test на каждую операцию: валидный запрос, невалидный, превышение 1 МБ.
- [x] Сообщение от чужого frame или с чужим origin игнорируется (test).
- [x] `session.ask` без подтверждения не доходит до Сессии; с подтверждением — доходит именно последней правившей Сессии (fake-агент записывает сообщение).
- [x] `workflow.get` отдаёт Тикеты эпика `worfy-mvp`; операции записи в workflow нет ни одной (test перечисляет операции).
- [x] Карточка-fixture, использующая `window.worfy.data`, переживает перезапуск со своими данными.

## Тесты

- `test/contract/card-bridge.test.ts` — протокол, проверки отправителя, лимиты (новый).
- `test/e2e/card-api.spec.ts` — Карточка-fixture: данные, `session.ask` с подменённым диалогом, `workflow.get` (новый).
- Сначала падающий test: сообщение с чужим origin.

## Где в коде

- `src/shared/cards/bridge.ts`
- `src/renderer/canvas/card-bridge.ts`
- `src/main/cards/data.ts`, `src/main/cards/protocol.ts`
- `src/card-runtime/worfy-card.ts`
- `src/main/mcp/agent-instructions.md` (раздел про API)

## Итог

Сделано: протокол Карточки (`src/shared/cards/bridge.ts`, zod) — пять операций Карточки
(`data.get`, `data.set`, `session.ask`, `workflow.get`, `workflow.subscribe`) и `card.text` со
стороны worfy; запрос разбирается схемой, дальше идёт только разобранный запрос (лишние ключи
вырезаны), значение глубже, чем способен обойти zod, получает отказ, а не исключение. Сторона окна
(`src/renderer/canvas/card-bridge.ts`) принимает сообщение, только если `event.source` —
`contentWindow` iframe Карточки на Холсте *и* `event.origin` — origin именно этого iframe
(`worfy-card://<id>.<метка>`, ADR-0012); остальное молча отбрасывается, ответ уходит тому же
фрейму с `targetOrigin` = его origin. Данные Карточки — `src/main/cards/data.ts`:
`<папка данных Проекта>/card-data/<id>.json`, атомарная запись через `json-file.ts`, лимит 1 МБ
(байты UTF-8 компактного JSON) проверяется в окне и ещё раз в main. `session.ask` —
`src/main/cards/ask.ts`: получатель — живая в worfy Сессия из `lastEditor` Узла Карточки (его пишет
тикет 24), иначе Оркестратор Проекта; сначала системный диалог (`dialog.showMessageBox`, кнопки
«Send» / «Cancel», в тексте — имя Карточки, получатель и ровно тот текст, что уйдёт), отказ даёт
Карточке `{ok:false, canceled:true}`. `src/card-runtime/worfy-card.ts` — `window.worfy`
(`data.get/set`, `ask`, `workflow.get/subscribe`), протокол (`src/main/cards/protocol.ts`)
вставляет его inline-скриптом в начало `<head>` каждого HTML-файла Карточки; файл на диске не
меняется. Инструкция агенту (`src/main/mcp/agent-instructions.md`) получила раздел про API.
Для тикета 31 — `requestCardText(cardId)` из `card-bridge.ts`: видимый текст Карточки, не длиннее
100 000 символов, или `null`.

Первый test падал так: `test/contract/card-bridge.test.ts` → «ignores a message with a foreign
origin, even from the Card frame itself» — файл test-ов не загрузился на импорте
`../../src/renderer/canvas/card-bridge` (0 test-ов, код 1): модуля моста ещё не было.

Проверки (после rebase на origin/main с тикетами 19 и 27): `pnpm lint && pnpm typecheck && pnpm test`
— код 0 (1116 test-ов, из них 49 в `test/contract/card-bridge.test.ts`); `gate.sh fast` — код 0,
`[gate] зелено (fast)`; `pnpm test:e2e` — код 0 (55 test-ов, из них 3 в `test/e2e/card-api.spec.ts`). Мутанты, каждый краснит contract test: окно не сверяет origin;
окно ищет фрейм по origin, а не по `event.source`; `parseCardRequest` возвращает сырое сообщение
вместо разобранного; `session.ask` отправляет текст при «Cancel».

Решения и отступления от текста тикета:

- **`workflow.get` / `workflow.subscribe` отвечает окно, а не main.** У окна уже есть копия модели
  workflow (`useWorkflow`) и проверок (`useChecks`), с подпиской и дельтами; снимок для Карточки —
  чистая функция `workflowSnapshot` в `bridge.ts`. В main уходят только три канала `cardApi.*`
  (`dataGet`, `dataSet`, `ask`), канала записи workflow нет. Окно начинает читать workflow, только
  когда какая-то Карточка впервые его попросила; подписчик получает снимок лишь при настоящем
  изменении (сравнение JSON), а не на каждый опрос проверок.
- **Получатель `session.ask`, если последняя правившая Сессия не живая в worfy, — Оркестратор**, а не
  возобновлённая (Resume) прежняя Сессия: Resume запускает Claude Code и может не пройти, а
  пользователь в диалоге видит, кому уйдёт текст.
- **Текст для Сессии помечен источником**: `Message from Card "<заголовок>" (<id>):` и пустая строка
  перед текстом Карточки — иначе агент не отличит его от слов пользователя. Ровно этот текст
  показан в диалоге. Длина текста Карточки — до 10 000 символов; один вопрос на Карточку за раз
  (второй, пока диалог открыт, получает отказ), чтобы Карточка не могла засыпать пользователя
  диалогами.
- **`window.worfy.ask` не отклоняет Promise на отказ пользователя**, а разрешает его
  `{sent:false, canceled:true}`: отказ — обычный исход, не ошибка. На проводе ответ остаётся
  `{ok:false, canceled:true}`, как в тексте тикета.
- **Скрипт рантайма — исходный текст функции `installWorfyCard`** (`Function.prototype.toString`),
  поэтому функция самодостаточна, а её параметр описан своим интерфейсом вместо DOM-типов: так её
  импортирует main без DOM-библиотеки. Contract test запускает именно вставляемый текст
  (`new Function`) — несамодостаточная правка его покраснит.
- **Фреймы Карточек мост находит в DOM** (`[data-card-id] iframe`, оверлей
  `src/renderer/canvas/overlays/CardBridge.tsx`), а не правкой `CardNode.tsx`; origin фрейма —
  из его адреса, и id Карточки в адресе обязан совпасть с `data-card-id` Узла.
- **Файлы вне «Где в коде»**: `src/shared/ipc/card-api.ts` и `src/main/ipc/card-api.ts` (новый домен
  IPC по ADR-0006), `src/main/cards/ask.ts`, `src/renderer/canvas/overlays/CardBridge.tsx` (точка
  расширения оверлеев), `tsconfig.node.json` и `tsconfig.test.node.json` (`src/card-runtime/**` и
  `card-bridge.ts` в списке файлов — иначе `tsc` их не проверяет), тесты.

Не проверено:

- не проверено: вид настоящего системного диалога `session.ask` — в e2e `dialog.showMessageBox`
  подменён в main (снимок экрана агенту недоступен: нет прав Screen Recording); проверены его
  параметры — кнопки, текст, получатель.
- не проверено: доставка сообщения Карточки настоящему Claude Code и его показ в транскрипте Сессии —
  в tests только fake-агент; сообщение уходит через `Session.send`, как ввод пользователя, но
  строку в транскрипте окно рисует само только для своего ввода, а для отправленного из main —
  лишь если SDK вернёт его в потоке.

### Черновик ADR: API Карточки — `window.worfy` поверх `postMessage`, workflow только для чтения

Карточка (HTML/JS, написанный агентом, ADR-0003, ADR-0012) общается с worfy только сообщениями
`postMessage` в формате `src/shared/cards/bridge.ts`; рантайм `window.worfy` протокол
`worfy-card://` вставляет в каждую HTML-страницу Карточки. Окно принимает сообщение только от
`contentWindow` фрейма Карточки и только с его origin, разбирает его zod-схемой и пропускает дальше
разобранный запрос. Набор операций закрыт: свои данные (JSON до 1 МБ в
`<папка данных Проекта>/card-data/<id>.json`, ADR-0005), вопрос Сессии с подтверждением
пользователя (получатель — живая последняя правившая Сессия, иначе Оркестратор) и снимок workflow
только для чтения; операций записи workflow нет (ADR-0002).

Почему записано: решение трудно обратимо — `window.worfy` и формат сообщений становятся контрактом
между приложением и Карточками, которые агенты уже написали и которые лежат в данных
пользователя; смена API ломает их молча.

Considered Options:

- Node или IPC в Карточке (`nodeIntegration`, preload во фрейме) — отвергнуто: исполняемый код
  агента получил бы доступ к файлам и процессам.
- `MessageChannel`, переданный Карточке при загрузке, вместо проверки `source`/`origin` — отвергнуто
  на MVP: тот же контроль отправителя, но ещё одно рукопожатие, которое переживает перезагрузку
  фрейма хуже.
- Отправка вопроса Сессии без подтверждения — отвергнуто: Карточка — код агента, а текст уходит
  агенту от имени пользователя.
- Выбранный: `postMessage` с проверкой фрейма и origin, закрытый набор операций, рантайм,
  вставляемый протоколом.

# 24 — Слишком большой ответ IPC по связи — ошибка вызова, а не обрыв соединения

Type: task
Status: claimed — 2026-10-17
Branch: worfy-link/24
Blocked by: —
Source: долг ревьюера PR #154 (`.scratch/worfy-link/issues/01-сервер-связи-machine-ов.md:374`), подтверждён
независимым ревью SPAKE2, Ticket [17](17-независимое-ревью-spake2.md) (low)

## Что происходит

- Linked machine — другой компьютер с worfy, связанный с этим по коду. Она вызывает каналы IPC этой
  Machine по WebSocket. Канал IPC — вызов или событие между экраном и main-процессом worfy.
- Обе стороны принимают сообщение не больше `LINK_MAX_PAYLOAD` = 16 MiB
  (`src/main/link/messages.ts:22`; сервер — `src/main/link/server.ts:116`, клиент —
  `src/main/link/client.ts:71`).
- Отправитель размер не проверяет: `Connection.send` (`src/main/link/connection.ts:87`) шлёт любой
  кадр. Ответ на вызов уходит там же (`src/main/link/service.ts:593`).
- Ответ больше 16 MiB (например, длинный транскрипт Session) получатель не принимает и закрывает
  соединение кодом 1009. Рвутся все вызовы этого соединения. Вызывающий получает обрыв связи, а не
  ошибку своего вызова.

## Что делаем

- Перед отправкой ответа сторона, которая отвечает, меряет кадр. Если он больше `LINK_MAX_PAYLOAD`,
  вместо значения уходит `{ ok: false, error }` с понятным текстом («the answer is too large to send
  over the link»). Соединение остаётся.

## Готово, когда

- [x] Contract test: обработчик возвращает значение больше предела. Вызывающий получает ошибку вызова,
      следующий вызов по тому же соединению проходит.
- [x] Mutation testing на копии: без проверки размера test красный.

## Где в коде

- `src/main/link/service.ts` — ответ на вызов (`:588-593`).
- `src/main/link/connection.ts` — `send` (`:87`), если проверка встаёт туда.
- `src/main/link/messages.ts` — `LINK_MAX_PAYLOAD` (`:22`), только чтение.
- `test/contract/link-server.test.ts` — test связи с вызовом IPC (раздел «IPC over the link»).

## Итог

- Новый метод `LinkConnection.answer(id, channel, result)` (`src/main/link/connection.ts`) сериализует кадр
  `result` один раз и меряет его `Buffer.byteLength` — байты UTF-8, как их считает `maxPayload` получателя
  (`ws`), а не длину строки в UTF-16. Кадр не больше `LINK_MAX_PAYLOAD` уходит как есть; больше — вместо
  него уходит `{ ok: false, error: '<channel>: the answer is too large to send over the link' }`, а
  отвечающая сторона пишет в консоль размер ответа, предел и id Machine. Кадр ошибки — сотни байт
  (имя канала не длиннее 200 символов по `frameSchema`), он всегда влезает. Соединение не закрывается.
- `src/main/link/service.ts`, ответ на кадр `call` — теперь `connection.answer(...)` вместо
  `connection.send({ t: 'result', … })`. `send` не менялся: проверка стоит только на ответе вызова.
- Contract test-ы (`test/contract/link-server.test.ts`, раздел «IPC over the link»):
  - «answers a call whose answer is over 16777216 bytes with an error; the next call on the same
    connection passes» — подменный обработчик `link.ping` на B первый раз отвечает именем из
    `LINK_MAX_PAYLOAD / 2 + 1` символов `é` (длина строки меньше предела, байт UTF-8 — больше). A получает
    ошибку вызова, второй вызов по тому же соединению отвечает, `connectionTo` — тот же объект, открыт.
  - «sends an answer of exactly 16777216 bytes as it is, and one byte more as an error that fits» —
    `LinkConnection` над поддельным WebSocket: кадр ровно в предел уходит без изменений, на байт больше —
    кадр ошибки и одно предупреждение.
  - Цена: строка-значение строится один раз, около 8 МБ; два test-а — около 100 мс и 10 мс; пиковый RSS
    процесса vitest — 183 МБ против 176 МБ у соседнего test-а `link.ping` (замер `/usr/bin/time -l`).
- Mutation testing на копии `connection.ts`: без проверки размера — оба test-а красные; `text.length`
  вместо `Buffer.byteLength` — оба красные; `<` вместо `<=` — красный test границы. Файл восстановлен
  копией, `cmp` совпал. До правки (`send` в `service.ts`) contract test красный: «call 0: the connection
  to the Linked machine closed».
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (5718 test-ов); gate fast — exit 0, «[gate] зелено (fast)».
- **Остаётся долгом:** события из main (кадры `event` — `agent.event`, `docs.changed`, `workflow.changed` и
  другие `project`-события) и служебные сообщения (`msg`) идут через `send` без проверки размера. Событие
  больше 16 MiB по-прежнему закрывает соединение кодом 1009 у получателя. Те же несколько строк здесь не
  годятся: событие не ответ, вернуть ошибку некому, а молча выбросить событие — значит рассинхронизировать
  экран Linked machine без переподключения, которое сейчас заново подписывает её и присылает свежее
  состояние. Решать отдельным Ticket-ом: выбросить с предупреждением, разбить или переподключить.
  Решено без владельца, подтвердить.
- Тот же случай с другой стороны — вход вызова (`call`) больше предела — тоже рвёт соединение; в Ticket не
  входил, не менялся.

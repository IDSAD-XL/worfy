# 0051 — Обычный Stop в Autopilot — graceful; Force stop — в меню «⋯»
Дата: 2026-10-08. Статус: принят.

**Контекст.** ADR-0050 (Ticket `worfy-week/17`) сделал из Stop одно действие — «прервать всё»:
`Session.halt()` прерывает ход Orchestrator-а, `giveBackNow` закрывает его процесс вместе с
Background task-ами, повторный старт берёт прерванные Ticket-ы первыми. Владелец с этим согласен,
но как с крайней мерой (ответ 2026-10-07: «давай обычный стоп автопилота сделаем graceful, т.е не
брать новые тикеты, и на карточке в троеточие спрятать пункт force stop»). Мягкой остановки не было
ни до ADR-0050, ни после: до него Stop кончал прогон сразу, а Orchestrator об этом не знал, и
`/epic-wave` в ходе от task-notification запускал незапущенные Ticket-ы Wave (ADR-0029, пункт 5);
после — Stop обрывал implementer-а посреди merge.

Этот ADR заменяет решение ADR-0050 для Stop. Прерывание остаётся, но только как Force stop
(`user-force-stop`). ADR-0029 и ADR-0050 не правятся.

**Решение.**

1. **Две причины.** `user-stop` теперь значит graceful Stop, новая `user-force-stop` — Force stop.
   `user-force-stop` получает всё, что ADR-0050 делал для `user-stop`: `halt`, `giveBackNow`,
   `tasks-killed` и `tickets` прерванной Wave в `run-stopped`. Строка состояния —
   `stopped: user force stop`.
2. **Graceful Stop в духе ADR-0029: implementer-а не бросают посреди merge.** Отличие от пункта 5
   ADR-0029: прогон не кончается сразу, а идёт в состоянии `stopping` (флаг поверх `running` и
   `waiting`) и говорит Orchestrator-у не брать новых Ticket-ов.
   - Wave ещё не ушла (`starting`) или ход кончился и Background task-ов нет (`settling`) — прогон
     кончается сразу с `user-stop`.
   - «Run wave» ещё лежит в очереди Session (ход Wave не начался) — Wave убирается из очереди,
     прогон кончается с `user-stop`: Ticket-ов никто не брал.
   - Идёт ход Wave или живут её Background task-и — `run-stopping` в журнал, и Orchestrator получает
     `STOP_TEXT` через `send` Session: «не бери новых Ticket-ов, незапущенные Ticket-ы Wave не
     запускай, взятые доведи до merge или blocked». Во время хода текст ждёт в очереди Session и
     уходит после его `result`; при idle Orchestrator-е — сразу.
   - Пока `stopping`, прогон не шлёт новую Wave и не ждёт файлов Ticket-ов: первый конец хода без
     ошибки, при idle Session и без Background task-ов, кончает прогон с `user-stop`, без
     `wave-finished`. `BACKGROUND_STALL_MS`, ошибки Session и хода, `interrupted` и `app-quit`
     действуют как раньше.
   - Клик по Stop отмечается на прогоне сразу, до того как его шаг дождётся очереди прогона. Шаг,
     который уже идёт (конец хода, событие workflow, чтение workflow), новую Wave после клика не
     шлёт: прогон кончается с `user-stop`. Если «Run wave» уже в пути, Wave уходит, и прогон сразу
     переходит в `stopping`.
3. **Граница.** Ход, который идёт в момент Stop, доходит до конца, и Ticket-ы, запущенные им,
   доводятся. Сообщение — не протокол со skill-ом (ADR-0002): прогон не проверяет, послушался ли
   Orchestrator; конец прогона решают события Session. Это и не `human-input`: текст шлёт worfy.
4. **Limits.** Stop во время ожидания Limits ждёт сброса: Session откажет любому ходу. После
   сброса Orchestrator получает одно сообщение — продолжение, затем `STOP_TEXT`. Force stop
   снимает ожидание сразу.
5. **Повторный старт.** Прерванные Ticket-ы (`resumable`) повторный старт берёт только после Force
   stop. Ticket, оставшийся в `work` после graceful Stop, ведёт человек.
6. **Ответ на пункт 6 ADR-0029.** «Остановить и убить задачи» — теперь явное решение человека, за
   лишним кликом: пункт «Force stop» меню «⋯» справа от Stop. Force stop действует и во время
   graceful Stop; `STOP_TEXT`, который ещё ждал в очереди, убирается, чтобы не достаться Session
   человека.
7. **Main и UI.** `autopilot.stop` отвечает, как только прогон в `stopping` или уже остановлен;
   повторный Stop при `stopping` ничего не шлёт. `autopilot.forceStop` — путь ADR-0050, отвечает
   после конца прогона. Старт при `stopping` отклоняется: прогон ещё идёт. Кнопка при `stopping` —
   «Stopping…», неактивна; строка — `stopping · N tickets in work` (Ticket-ы текущей Wave в `work`)
   или `stopping`.

**Последствия.**

- Graceful Stop длится, пока идут Ticket-ы в работе, — до часа и дольше (implementer ждёт CI). Его
  ограничивает только `BACKGROUND_STALL_MS`, который считается от последнего события Background
  task-ов. Кому нужен Mac сейчас — Force stop.
- Если Orchestrator не послушается `STOP_TEXT` и запустит ещё Ticket-ы, прогон дождётся и их
  Background task-ов (это те же события Session), но новую Wave не пошлёт. Ticket-ы, запущенные
  в обход Background task-ов, прогон не видит: он кончится по первому ходу без них.

## Considered Options

- **Stop — graceful со `STOP_TEXT`, Force stop — в меню «⋯»** (выбрано).
- **Stop = Force stop с диалогом подтверждения.** Отвергнуто: мягкой остановки так и нет, а диалог —
  лишний шаг в каждом Stop.
- **Graceful без сообщения Orchestrator-у** (как ADR-0029, пункт 5). Отвергнуто: `/epic-wave` в
  ходе от task-notification запустил бы незапущенные Ticket-ы Wave.
- **Graceful через interrupt хода и новое сообщение.** Отвергнуто: обрывает шаг, который идёт,
  например merge.
- **Кнопка Force stop рядом со Stop.** Отвергнуто: владелец просил меню; две кнопки рядом — лишний
  риск нажать не ту.

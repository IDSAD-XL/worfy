# 0069 — Метка needs-mac-gate и роль Machine в Profile: PR Session Windows с общим кодом проверяет и вливает Session Mac; уточняет ADR-0056
Дата: 2026-10-18. Статус: принят.

Этот ADR уточняет [ADR-0056](0056-windows-checks-and-two-sessions.md) («Проверка Windows и две
Session-и»). ADR-0056 не правится.

**Контекст.** Над репозиторием worfy идут две Session-и: на Mac и на Windows-ПК владельца (ADR-0056,
пункт 4). Gate full на Mac гоняет e2e и собранный `.app`; Session на Windows прогнать его не может.
ADR-0056 оставил открытым, нужен ли gate full на Mac перед мержем PR Session Windows («Последствия»).
Без него main может сломаться на Mac: Linux CI идёт уже после Wave (ADR-0068), а e2e и `.app` он не
проверяет. ADR-0056, пункт 6 требует, чтобы ветка перед мержем обновлялась от свежего main и её
проверки шли заново, для платформенного PR — и gate full на Windows. Если rebase делает Session на
Mac, повторить gate full на Windows некому.

Решения владельца 2026-10-08 по вопросам Q30–Q33 (spec Epic-а `worfy-windows`, «Решения владельца»,
пункты «gate full на Mac для PR Session Windows» и «Как работает очередь needs-mac-gate»).

**Решение.**

1. **Метка (Q30).** PR Session на Windows, который трогает общий код, получает метку
   `needs-mac-gate`. Общий код — хотя бы один файл, который не документ и не чисто
   Windows-специфичный (его на macOS не читают ни код, ни test-ы, ни сборка). Тексты Harness —
   skills, agents, rules, контракт Profile — не документы: по ним работают агенты и на Mac. Метку
   ставит Session на Windows после своих проверок; такой PR она сама не вливает. Вливает его Session
   на Mac после зелёного gate full на Mac.
2. **Мерж без повтора на Windows (Q31, уточняет ADR-0056, пункт 6).** Session на Mac вливает PR с
   меткой после чистого rebase на свежий main и зелёного gate full на Mac. Gate full на Windows после
   этого rebase до мержа не повторяется. Windows проверяет main после мержа: Session на Windows в
   начале каждой своей Wave гоняет gate full на свежем main в отдельном worktree. Красный — первым
   делом чинит main, Ticket-ы Wave не раздаются.
3. **Кто проходит очередь (Q32).** Открытые PR с меткой проходит команда Harness
   `/worfy:gate-queue`: Autopilot на Mac запускает её перед каждой Wave и когда больше нечего делать;
   в worfy — действие «Process gate queue»; PR с меткой, который ждёт больше часа, worfy показывает
   уведомлением. Их делает Ticket 17 Epic-а `worfy-windows`. До него проход очереди — первый шаг
   раздела 1 skill-а `epic-wave` на Mac.
4. **Раздел «Mac checks» и отчёт (Q33).** Session на Windows пишет в описании PR с меткой раздел
   `## Mac checks`: команды пунктов «Готово, когда» Ticket-а, которые идут на Mac сверх gate full, и
   ожидаемый результат каждой; таких пунктов нет — строка `none`. Session на Mac выполняет их вместе с
   gate full и пишет отчёт комментарием в PR. Первая строка — `Mac checks report: green` или
   `Mac checks report: red`, дальше строка вердикта gate, коды выхода и хвосты вывода команд, при
   красном — причина. Без отчёта мержа нет. PR с меткой без раздела — красный.
5. **Где это задано — Profile каждой Machine** (ADR-0042: Profile целиком лежит на Machine). Поле
   `cross_machine_gate` из пяти полей; skills `epic-wave` и `ship-ticket` берут имена из него и не
   пишут их в свой текст:
   - `label` — имя метки GitHub; у worfy — `needs-mac-gate`;
   - `role` — `"request"` (Windows-ПК: ставит метку на свои PR с общим кодом и их не вливает) или
     `"serve"` (Mac: перед каждой Wave проходит открытые PR с меткой);
   - `exempt` — пути, правка которых метки не требует: документы и чисто Windows-специфичные файлы;
     путь с `/` на конце — папка. У worfy — `.scratch/`, `docs/`, `HANDOFF.md`, `CONTEXT.md`,
     `README.md`. Читается при `request`;
   - `check` — команда проверки ветки на Machine с `serve`; у worfy — `GATE_SCOPE=all` gate full под
     замком e2e. Читается при `serve`;
   - `checks_section` — заголовок раздела описания PR с командами для Machine с `serve`; у worfy —
     `Mac checks`. Читается при обеих ролях.

   Нет поля — у Project-а одна Machine, шаг пропускается, и skill говорит об этом словами. `role` не
   `request` и не `serve`, нет `label` или `checks_section`, `serve` без `check` — `bin/profile`
   отвечает exit 1 с причиной: угаданная роль либо вливает PR без gate full на Mac, либо оставляет PR
   без того, кто его вольёт. Значения пишет Orchestrator в Profile каждой Machine; Profile не в
   репозитории, PR для него нет.

**Последствия.**

- Main проверяется на обеих машинах: на Mac — перед мержем PR с меткой, на Windows — в начале
  каждой Wave Session на Windows. Регрессия на Windows от rebase на Mac видна в начале следующей
  Wave Windows, а не до мержа.
- PR с меткой ждёт Session на Mac. Ticket на Windows стоит `blocked` с причиной «ждёт Machine с
  serve», меткой и номером PR и закрывается, когда PR влит. Красный отчёт новее последнего push
  возвращает Ticket в работу; ветку Session на Windows берёт с origin заново.
- Конфликт rebase только в `HANDOFF.md` решает Session на Mac: его решает та, что мержит
  (ADR-0056, «Последствия»). Любой другой конфликт — красный отчёт, метка остаётся.
- Правило общее для любого Project-а на двух Machine: имена метки и раздела — значения Profile.
- `bin/wave-gate` пока узнаёт PR с меткой по имени `needs-mac-gate` в своём коде, а не по
  `cross_machine_gate.label`: для worfy это одно и то же, для другого Project-а — нет.

## Considered Options

- **Метка, роль Machine в Profile, раздел «Mac checks» с отчётом в PR, gate full на свежем main в
  начале Wave на Windows** (выбрано).
- **Хватает Linux CI, Mac проверится в следующей Wave.** Отвергнуто (Q30): main может быть сломан на
  Mac, а e2e и `.app` Linux CI не проверяет.
- **Все PR порта вливает только Mac.** Отвергнуто (Q30): Session на Windows простаивает, даже когда
  её PR трогают одни документы или чисто Windows-специфичные файлы.
- **Повторить gate full на Windows после rebase на Mac** (буква ADR-0056, пункт 6). Отвергнуто (Q31):
  повтор связывает обе машины на каждом PR, а прямого канала между Session-ами нет (ADR-0056,
  пункт 4); проверка main в начале Wave на Windows ловит то же позже, но без ожидания.
- **Имя метки и роль — в тексте skills.** Отвергнуто (Ticket 07 Epic-а `worfy-windows`): Profile
  лежит на Machine (ADR-0042), и роль у двух машин разная, а текст skills общий для обеих.

Других вариантов для Q32 и Q33 spec не записывает: ответы владельца на Q31–Q33 — «ок / а / а».

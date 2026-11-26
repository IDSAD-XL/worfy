# 14 — UI Assistant-а по принятому прототипу: раздел в rail и свои уведомления

Type: task
Status: open
Blocked by: 02, 07, 09, 10
Source: [spec.md](../spec.md), «Ticket-ы», строка 14; «Решения владельца», 17 и 18; «Решения по реализации» → «UI»,
«Мониторинг расхода»; «Границы», 3 и 6; «Решения по test-ам», В; истории 1, 2, 16, 21–23, 35, 38 и 39; «Волны», Wave 5

Кто: агент.

Ticket ждёт, пока владелец примет прототип-Card Ticket-а 02 (последний пункт его «Готово, когда»). Бриф ссылается на id
Card-а из «Итог» Ticket-а 02.

## Что строить

1. **Раздел Assistant-а в rail рядом с Canvas** — по принятому прототипу:
   - список «что ждёт» по всем Project-ам; у каждого пункта — причина, источник и обязанность, которая его подняла;
   - предложения с Dismiss, Snooze, Open и Prepare; Prepare показывает точный текст Session до её запуска, Session
     стартует только по щелчку пользователя;
   - like и dislike на каждом сообщении Assistant-а;
   - журнал того, что Assistant сделал сам, у каждой строки — пункт, который её вызвал;
   - сводку;
   - разговор — написать Assistant-у в любой момент;
   - строку расхода: сколько token-ов и какую долю Limits потратил Assistant (данные — Ticket 05; доля помечена как
     оценка).
2. **Свои уведомления Assistant-а** — отличаются от обычных уведомлений worfy и стоят в другом месте:
   - в окне — карточка-реплика у значка Assistant-а в rail, у левого края окна;
   - отличие — значок и свой цвет Assistant-а, like и dislike, кнопки Open, Prepare, Snooze;
   - на экране одна карточка за раз; остальное — число на значке Assistant-а и список в его разделе;
   - когда worfy не впереди — системное уведомление только о срочном и только в work hours, с заголовком «worfy
     Assistant»; щелчок открывает раздел Assistant-а.
3. Тексты UI — на английском; говорит Assistant на языке Guide (Ticket 17).

## Где в коде

- Rail и разделы — `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/SidebarSection.tsx`,
  `src/renderer/shell/registry.ts`.
- Обычные toast-ы — `src/renderer/toast/`; системные уведомления — `src/main/notify.ts`.
- Tokens темы — `src/renderer/theme/tokens.css`; тексты UI — `docs/design/BRIEF.md`.
- Прототип — Card Ticket-а 02 (id — в его «Итог»).

## Решения

- Размещение — вариант A, раздел в rail; у Assistant-а свои уведомления, не там же, где обычные (решение 17; spec, «UI»).
- Дизайн — в стиле worfy, по прототипу, который принял владелец (решение 18).
- Обычные уведомления — toast у правого края окна, до трёх сразу, и системное уведомление с именем Project-а или Session
  в заголовке; уведомления Assistant-а от них отличаются (spec, «UI»).
- Где видно расход: строка в разделе Assistant-а, подробности — в Settings (Ticket 15) (spec, «Мониторинг расхода»).
- Session с текстом Assistant-а стартует только по щелчку; каждое действие — в журнале с пунктом и с like и dislike
  (spec, «Границы», 3 и 6).

## Test-ы

- Стык В (spec, «Решения по test-ам»): e2e с fake агентом (`WORFY_AGENT=fake`) — список, like и dislike. Карточку Apply
  сценарий получает в Ticket-е 15, знакомство — в Ticket-е 16.

## Готово, когда

- [ ] Раздел Assistant-а открывается из rail рядом с Canvas и показывает список «что ждёт» с причиной, источником и
      обязанностью у каждого пункта.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 2b9c65933
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 6fceafc4f
- [ ] У предложения есть Dismiss, Snooze, Open и Prepare; Prepare показывает точный текст Session, Session стартует
      только по щелчку пользователя.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 2b9c65933
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 6fceafc4f
- [ ] Like и dislike стоят на каждом сообщении Assistant-а и доходят до обязанности (Ticket 07).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 2b9c65933
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 6fceafc4f
- [ ] Журнал показывает действия Assistant-а, у каждой строки — пункт, который её вызвал.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 2b9c65933
- [ ] Раздел показывает сводку и разговор; пользователь может написать Assistant-у в любой момент.
- [ ] Строка расхода показывает token-ы и долю Limits Assistant-а; доля помечена как оценка.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 2b9c65933
- [ ] Уведомление Assistant-а — карточка у его значка в rail, со значком и цветом Assistant-а, like и dislike,
      Open, Prepare, Snooze; одна карточка за раз, остальное — число на значке.
- [ ] Когда worfy не впереди, системное уведомление уходит только о срочном и только в work hours, с
      заголовком «worfy Assistant»; щелчок открывает раздел Assistant-а.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 2b9c65933
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-window.test.ts test/unit/assistant-panel.test.tsx test/unit/assistant-speech.test.tsx test/unit/sidebar-scope.test.tsx` exit 0 · mac - · 6fceafc4f
- [ ] e2e с `WORFY_AGENT=fake`: список, like и dislike — зелёный.
- [ ] Тексты UI — английские.
  - evidence: test-run pass · `pnpm lint` exit 0 · mac - · 2b9c65933
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 2b9c65933
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6fceafc4f

## Решено без владельца (подтвердить)

- Вид раздела строит main (`AssistantWindow`, `src/main/assistant/window/view.ts`) из ядра внимания, обязанностей,
  предложений, журнала и расхода; окно получает его целиком по каналам `assistant.*`, все `local`. Окно Linked machine
  показывает «Assistant works with the Projects of its own machine».
- Раздел Assistant-а — первый в rail, своим цветом и над чертой, но окно, где секцию не выбирали, открывается на
  Projects (`railDefault = false`): пока Assistant выключен, начинать с него незачем.
- Срочное — пункт вида `run-stopped` или сообщение внешнего источника с пометкой `urgent`. Системное уведомление — одно на
  срочный новый пункт; пункт, который пришёл, пока worfy был впереди, позже не уведомляет; пришедший вне work hours ждёт
  их начала.
- Snooze: In 1 hour, In 3 hours, Next work hours, Until something changes. Отложенное хранится в
  `<data>/assistant/window.json` и просыпается по таймеру раз в минуту и при каждом изменении ядра.
- Сводка — подсчёт самого worfy за 16 часов, без модели: пришло, сделано само, остановленные Run-ы, ждёт вас, строка на
  Project и первые три пункта. Утреннее сообщение Assistant-а показывается, когда его Session его прислала.
- Like и dislike пункта и строки журнала доходят до обязанности (Ticket 07); оценка сообщения, предложения и сводки
  только хранится. Отмена dislike удаляет его правило.
- Карточки и системные уведомления Assistant-а — только пока он включён. Выключенный Assistant: список виден, поле
  разговора выключено с текстом «Assistant is off on this machine».
- Подготовленная Session стартует в Claude Code на Canvas Project-а; текст можно править (Edit), Start отправляет ровно
  показанный текст.
- Open ведёт: Session — к её Node, PR — в вид Pull requests, CI — к PR, после которого ветка покраснела, Ticket и Run — в
  Pipeline, сообщение — по https-ссылке источника, Health — в Health check.
- Строка расхода — простой текст; ссылку в Settings добавит Ticket 15.
- Новые token-ы `--assistant*` в `tokens.css`, светлая и тёмная тема, — из прототипа.
- Разговор ждёт Ticket 10 (PR #2247): до его merge `runningAssistant()` в `src/main/assistant/window/app.ts` отвечает
  null, и отправка отвечает «Assistant is off on this machine».
- После review, раунд 1:
  - Показанным пункт считается, только когда окно его действительно показало: в открытом разделе на вкладке Waits или на
    карточке у значка (канал `assistant.shown`), и только пока Assistant включён. Сам вид раздела ничего не считает, так
    что фоновый цикл и уведомления не ставят обязанность на паузу. Пункт, показанный и оставленный без ответа на сутки,
    по-прежнему считается проигнорированным и при фоновом взгляде. Окно на заднем плане тоже считается «показало».
  - Dismiss сам считает отказ (`declined`): пользователь видел пункт, раз его отклонил.
  - Снятая оценка снимает свой счёт (`Duties.unrate`): счётчик like или dislike, шаг серии dislike-ов, паузу, которую
    серия начала, и правило, если его написал этот пункт. Снятый like не возвращает серию проигнорированных предложений,
    которую он оборвал.
  - Prepare и toast после старта называют Project, в котором Session стартует (`prepare.projectName`).
  - Щелчок по системному уведомлению открывает раздел в окнах, которые за ним следят; ждёт он только когда таких окон
    нет, и только первого окна, которое откроет раздел.

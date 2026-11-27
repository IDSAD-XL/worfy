# 161 — Пузырь Assistant-а закрывается целиком

Type: bug
Status: done 2026-11-27T00:27Z
PR: #2296
Branch: worfy-polish/161
Blocked by: —
Source: замечание владельца 2026-11-26 («Баг, нельзя закрыть не протыкивая все 56. Очень мешает», снимок экрана
пузыря у кнопки Assistant в rail, число на значке — 56); решение Orchestrator-а 2026-11-26, записано для владельца.

Кто: агент.

## Что происходит

Пузырь Assistant-а — карточка-реплика у его кнопки в rail (worfy-assistant 14) — показывает один пункт («шаги владельца
на его сервере и подписке; Autopilot не берёт», CanvasForAI, «Waits for you», Ticket worfy-terminal-ssh 10) с Open,
Snooze, like и dislike, × в заголовке и строкой внизу «56 more in Assistant — the number on its icon». × закрывает
только этот пункт, и пузырь сразу показывает следующий. Чтобы убрать пузырь, владелец должен пройти все 56.

Причина в коде (origin/main 610e0230d):

- × вызывает `closeCard(item.id)` (`src/renderer/assistant/AssistantSpeech.tsx:79`), а та добавляет в список закрытых
  один id (`src/renderer/assistant/useAssistant.ts:203`); очередь пузыря (`speechQueue`,
  `src/renderer/assistant/speech.ts:14`) — все пункты в состоянии `new`, кроме закрытых, так что за каждым × встаёт
  следующий.
- Список закрытых живёт только в памяти окна: после перезапуска или обновления worfy весь накопленный хвост
  показывается заново, с самого старого пункта.

## Решение (Orchestrator, 2026-11-26)

1. × закрывает пузырь целиком. Каждый пункт, о котором пузырь сказал бы в этот момент, считается «сказанным пузырём».
   Сами пункты не меняются: остаются в Waits в своём состоянии, число на значке прежнее. × — не Dismiss.
2. Пузырь показывается снова только для пункта, который пришёл после этого закрытия: новый, с новым событием или
   ставший срочным по прежним правилам срочности. Накопленный хвост он не повторяет.
3. Отметка «сказано пузырём» переживает перезапуск: она в собственном файле раздела `<data>/assistant/window.json`,
   где ticket 14 хранит Snooze-ы. После обновления хвост не приходит снова.
4. При первом запуске с накопленным хвостом (отметки ещё нет) пузырь показывает одну строку «N waiting in Assistant»
   с той же ссылкой внизу, а не самый старый пункт. Один × убирает её. Один пункт — не хвост: пузырь говорит о нём.
5. Escape закрывает пузырь так же, как ×. Щелчок мимо пузыря делает то же, что сейчас (ничего).
6. Open, Snooze, like и dislike по-прежнему действуют на показанный пункт. После любого из них пузырь показывает
   следующий пункт, новый с последнего закрытия, если он есть, иначе закрывается.

После review, раунд 1 (решения Orchestrator-а 2026-11-27):

- Срочный пункт никогда не сворачивается в строку хвоста: если в очереди есть срочные, пузырь показывает первый
  срочный как пункт, со строкой «N more in Assistant».
- Open и Snooze на пузыре тоже считаются «увидел»: пузырь отмечает пункт так же, как после like и dislike.
- Escape закрывает пузырь, только когда фокус клавиатуры в пузыре или на кнопке Assistant-а в rail; иначе Escape
  остаётся Canvas-у, Focus mode и полю ввода. Главный способ закрыть — ×.
- Окно отправляет в main пары `{id, events}` — столько событий, сколько пузырь показал; событие, пришедшее между
  отрисовкой и ×, оставляет пункт несказанным. Число событий — новое поле `events` у пункта вида.

Остальное из worfy-assistant 14 и 16 не меняется: одна карточка за раз, число на значке, без карточки, пока раздел
впереди, выбор «In the window», системные уведомления, показ пункта обязанности (`assistant.shown`).

## Где в коде

- `src/renderer/assistant/AssistantSpeech.tsx` — пузырь: × и Escape, строка хвоста.
- `src/renderer/assistant/speech.ts` — очередь, вид пузыря (`speechCard`), значок, что считается показанным.
- `src/renderer/assistant/useAssistant.ts`, `src/renderer/assistant/parts.tsx` — `closeCard` и кнопки пузыря.
- `src/renderer/assistant/assistant.css` — строка хвоста.
- `src/shared/assistant/window.ts` — поля вида `cardSeen` и `cardBacklog`.
- `src/shared/ipc/assistant.ts`, `src/main/ipc/assistant.ts` — канал `assistant.cardClosed` (local).
- `src/main/assistant/window/view.ts`, `src/main/assistant/window/store.ts` — отметка в `window.json`.
- `docs/features/assistant.md` — абзац о пузыре (английская страница).
- Test-ы: `test/unit/assistant-speech-card.test.tsx` (новый), `test/unit/assistant-speech.test.tsx`,
  `test/unit/assistant-window.test.ts`, `test/contract/assistant-card-closed.test.ts` (новый).

## Test-ы

- Пузырь (jsdom, настоящие компонент и store раздела, main — fake): 56 пунктов → один × → пузыря нет, на значке 56;
  новый пункт → пузырь только о нём; перезапуск окна → хвост не возвращается; новое событие на сказанном пункте → пузырь
  о нём; первый запуск с хвостом → одна строка «56 waiting in Assistant», один × её убирает; Escape как ×, Escape в
  поле ввода — нет; like → следующий новый пункт.
- Логика main (`AssistantWindow` над настоящими ядром и обязанностями): × над 56 — все сказаны, состояние `new`,
  счётчики обязанности не тронуты; новый пункт и новое событие — не сказаны; ставший срочным — не сказан; перезапуск
  над тем же файлом `window.json` — отметка цела, хвоста нет.
- Канал `assistant.cardClosed` — local, доносит id до main, чужой вход отклоняет.
- e2e пузыря нет (`test/e2e/assistant.spec.ts` его не проверяет), править нечего.
- test-ы красные до правки.

## Готово, когда

- [ ] × и Escape закрывают пузырь целиком; пункты остаются в Waits в своём состоянии, число на значке прежнее; пузырь
      снова — только о том, что пришло после закрытия; отметка переживает перезапуск; первый запуск с хвостом — одна
      строка «N waiting in Assistant»; Open, Snooze, like и dislike ведут к следующему новому пункту.
  - evidence: commit pass · worfy-polish/161: the Assistant's speech card closes as a whole · - - · 1f7dda15b5ad610f8912551f741e0c1bc6371c6a
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-speech-card.test.tsx test/unit/assistant-speech.test.tsx test/unit/assistant-window.test.ts test/contract/assistant-card-closed.test.ts` exit 0 · mac - · 73baca2bedbc938c7ed1307ec24b97fbe72ed0ff
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-speech-card.test.tsx test/unit/assistant-speech.test.tsx test/unit/assistant-window.test.ts test/contract/assistant-card-closed.test.ts` exit 0 · mac - · 82dc17e5b62233e2ec93b009d8f637a619ba1c41
  - evidence: review pass · PR #2296 · - - · f27af12d89c0611ee3c6d47a211aa6463ac1783a
- [ ] Test-ы пузыря, логики main и канала зелёные; красные до правки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-*.test.ts test/unit/assistant-*.test.tsx test/contract/assistant-*.test.ts test/contract/worfy-app-tools.test.ts test/contract/main-ipc-wiring.test.ts` exit 0 · mac - · 73baca2bedbc938c7ed1307ec24b97fbe72ed0ff
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-*.test.ts test/unit/assistant-*.test.tsx test/contract/assistant-*.test.ts test/unit/focus-mode.test.tsx test/unit/canvas-actions.test.tsx test/contract/main-ipc-wiring.test.ts` exit 0 · mac - · 82dc17e5b62233e2ec93b009d8f637a619ba1c41
  - evidence: review pass · PR #2296 · - - · f27af12d89c0611ee3c6d47a211aa6463ac1783a
- [ ] `docs/features/assistant.md` описывает × пузыря, Escape, отметку и строку хвоста.
  - evidence: commit pass · worfy-polish/161: the Assistant's speech card closes as a whole · - - · 1f7dda15b5ad610f8912551f741e0c1bc6371c6a
  - evidence: review pass · PR #2296 · - - · f27af12d89c0611ee3c6d47a211aa6463ac1783a
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 73baca2bedbc938c7ed1307ec24b97fbe72ed0ff
  - evidence: gate pass · `gate fast` exit 0 · mac - · 82dc17e5b62233e2ec93b009d8f637a619ba1c41
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45906870254/job/140221756310 · ci - · f27af12d89c0611ee3c6d47a211aa6463ac1783a
- [ ] (вручную) Сделай: в Stable worfy с накопленными пунктами Assistant-а нажми × на пузыре, перезапусти worfy →
      Должно быть: пузырь исчез с одного ×, пункты в разделе и число на значке на месте; после перезапуска пузырь не
      появляется, пока не придёт новый пункт.
  - needs: mac stable

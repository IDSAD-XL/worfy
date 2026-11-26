# 25 — Части прототипа, не вошедшие в Ticket 15: настройки уведомлений, Undo применённой карточки, Project-ы обязанности, «On since …»

Type: task
Status: claimed 2026-11-26T11:04Z
Blocked by: 15
Source: решение владельца 2026-11-26, второй раунд (Q1–Q6, «все да»), Q4; раздел «Вне скоупа» Ticket-а 15 (ветка
`worfy-assistant/15`, PR #2266) и его решения 3 и 4 «Решено без владельца»; принятый прототип-Card Ticket-а 02
(`card-2f66a896`, «Assistant — прототип UI»). [spec.md](../spec.md), «Решения по реализации» → «UI»; «Волны»: Wave 7,
после Ticket-а 15, до приёмки (Ticket 20).

Кто: агент.

## Что происходит

Ticket 15 построил Settings → Assistant по принятому прототипу-Card, но четыре части прототипа в него не вошли (его
«Вне скоупа» и решение 4):

1. **Настройки уведомлений.** В прототипе на вкладке General есть группа Notifications (`app.js:488-490` Card-а):
   - «In the window» — карточка-реплика у значка Assistant-а, одна за раз; выбор «Urgent and batched», «Urgent only»,
     «None: the list only»;
   - «System notifications» — переключатель системного уведомления с заголовком «worfy Assistant», когда worfy не
     впереди; подпись «Urgent only, in work hours».

   Сами уведомления построил Ticket 14 (`src/renderer/assistant/AssistantSpeech.tsx`, `speech.ts`;
   `src/main/assistant/window/notices.ts`), но выключить или сузить их пользователь не может.
2. **Undo применённой карточки «было → станет».** В прототипе после Apply карточка говорит «Applied at HH:MM» и даёт
   Undo (`app.js:372`): Undo возвращает настройки, какими они были, и пишет строку журнала «Undid the settings change»
   (`app.js:626`). Ticket 15 решил без Undo (решение 4): карточка говорит «Change it back in Settings → Assistant».
3. **Выбор Project-ов, которые охватывает обязанность.** В прототипе у каждой обязанности на вкладке Duties — область
   («All Projects», `app.js:132-144`, `:495`). main её уже знает: `DutyChoice.projects` — `'all'` или список id
   Project-ов (`src/main/assistant/duties/duties.ts:61-66`, запись `:196-197`, фильтр пунктов `:358`, область в
   `look` `:399`), но экран её не показывает и не меняет.
4. **«On since …» у переключателя.** В прототипе рядом с «Assistant on this Mac» стоит «On since Monday» (`app.js:476`).
   Время включения нигде не хранится: поле `assistant` настроек машины — только `on` и `dailyWakeLimit`
   (`src/shared/assistant/settings.ts` на ветке `worfy-assistant/15`).

## Что строить

1. **Notifications** на вкладке General Settings → Assistant, по прототипу:
   - «In the window»: «Urgent and batched» (как сейчас), «Urgent only», «None: the list only». При «None» карточки-реплики
     нет, число на значке Assistant-а и список раздела остаются.
   - «System notifications»: включено (как сейчас) или выключено. Включённое — как сейчас: только срочное, только в
     work hours, заголовок «worfy Assistant».
   - Оба выбора — настройки машины (`local`, как остальные настройки Assistant-а): Linked machine их не видит.
   - По умолчанию — как сейчас: «Urgent and batched» и системные уведомления включены.
2. **Undo под применённой карточкой.** Undo возвращает каждую настройку карточки к значению «было» тем же путём, что
   Apply (`AssistantWindow.apply` → настройки машины и `Duties.configure`), пишет строку журнала Assistant-а и снова
   показывает карточку как не применённую или как «Undone at HH:MM» — выбирает агент по прототипу. Что делать, если
   настройку уже поменяли после Apply (руками или другой карточкой), агент решает сам и пишет в «Решено без владельца»
   (рекомендация: Undo не трогает такую настройку и называет её).
3. **Project-ы обязанности** на вкладке Duties: у каждой обязанности — «All Projects» или выбранные Project-ы этой
   Machine; выбор идёт через `Duties.configure` (`projects: 'all'` или список). Project-ы Linked machine в выборе не
   участвуют: их пункты Assistant этой машины только читает и показывает отдельной группой (Ticket 18). Может ли
   карточка «было → станет» менять область (решение 3 Ticket-а 15 говорит «не может»), агент решает и пишет в «Решено
   без владельца».
4. **«On since …».** main записывает время, когда пользователь включил Assistant, и стирает его при выключении;
   переключатель показывает «On since <день или дата>». Assistant, включённый до этого Ticket-а (времени нет), —
   без строки или с другим текстом: решает агент.
5. Тексты UI — по-английски (`docs/design/BRIEF.md`, ADR-0017), как в прототипе.

## Где в коде

- Ветка `worfy-assistant/15` (PR #2266; после merge — `main`): `src/renderer/settings/AssistantSection.tsx` (вкладки
  General и Duties), `src/renderer/settings/useAssistantSettings.ts`, `src/shared/assistant/settings.ts` (поле
  `assistant`), `src/shared/assistant/settings-change.ts` (что может назвать карточка), `src/main/assistant/settings/panel.ts`,
  `src/main/assistant/session/switch.ts` (включение), `src/main/assistant/window/view.ts` (`AssistantWindow.apply`).
- Уведомления Ticket-а 14: `src/renderer/assistant/AssistantSpeech.tsx`, `src/renderer/assistant/speech.ts`,
  `src/main/assistant/window/notices.ts`, `ASSISTANT_NOTE_TITLE` (`src/shared/assistant/window.ts:208`).
- Область обязанности: `src/main/assistant/duties/duties.ts:61-66` (`DutyChoice`), `:196-197`, `:358`, `:399`.
- Настройки машины: `src/shared/settings/app-settings.ts`, `src/main/settings/store.ts`; каналы IPC `local` —
  `src/shared/ipc/app-settings.ts`.
- Прототип: Card `card-2f66a896` на Canvas Project-а worfy, `app.js` (строки выше), `index.html`, `style.css`
  ([Ticket 02](02-прототип-card-ui-assistant-а.md), «Итог»).
- Test-ы: `test/unit/settings-assistant.test.tsx`, `test/unit/assistant-settings-panel.test.ts`,
  `test/contract/assistant-settings.test.ts`, `test/unit/assistant-window.test.ts`, `test/unit/assistant-panel.test.tsx`,
  `test/unit/assistant-duties.test.ts`, `test/e2e/assistant.spec.ts`.

## Решения

- Все четыре части — по принятому прототипу Ticket-а 02; где прототип молчит, решает агент и пишет в «Решено без
  владельца».
- Notifications не меняют того, что решил владелец про сами уведомления (spec, «UI», решение 17): одна карточка за раз,
  системное — только срочное и только в work hours. Выбор только сужает или выключает их.
- ADR не меняется.

## Test-ы

- Unit test раздела Settings: обе настройки Notifications видны, меняются и сохраняются; «None: the list only» убирает
  карточку-реплику, но не число на значке; выключенные системные уведомления не показываются и для срочного.
- Unit или contract test: Undo возвращает настройки к «было», пишет строку журнала; настройка, изменённая после Apply,
  ведёт себя, как решил агент.
- Unit test: выбор Project-ов обязанности доходит до `Duties.configure`; пункт Project-а вне области обязанность не
  показывает; «All Projects» возвращает всё.
- Unit test: включение записывает время, выключение стирает; «On since …» показывает его; настройки без времени
  читаются.
- e2e с `WORFY_AGENT=fake` (стык В, spec «Решения по test-ам»): Apply, затем Undo карточки — настройка в
  `app-settings.json` вернулась.

## Готово, когда

- [ ] Settings → Assistant → General: «In the window» и «System notifications» меняются, сохраняются и действуют на
      уведомления Assistant-а.
- [ ] Под применённой карточкой «было → станет» есть Undo: настройки возвращаются, строка журнала записана.
- [ ] У обязанности выбираются Project-ы этой Machine или «All Projects»; пункты вне области обязанность не показывает.
- [ ] Рядом с переключателем «Assistant on this Mac» — «On since …»; время включения переживает перезапуск worfy.
- [ ] e2e с `WORFY_AGENT=fake`: Apply и Undo карточки — зелёный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

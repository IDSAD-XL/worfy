# 04 — Расписание проверок и work hours

Type: task
Status: claimed 2026-11-25T08:13Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 04; «Решения владельца», 5; «Решения по реализации» → «Расписание
проверок»; «Решения по test-ам», А; истории 12 и 13; «Волны», Wave 1

Кто: агент.

## Что строить

1. **Один планировщик для проверок источников:** реестр проверок с интервалом, разбросом и защитой от двойного запуска.
   Сейчас каждая периодическая работа в main заводит свой таймер.
2. **Work hours:** дни недели, одно или несколько окон, часовой пояс. Это обобщение окна старта Autopilot-а, которое
   сейчас знает только часы.
3. **Каждый тип проверки настраивается:** включён ли он, интервал, спит ли он вне work hours. Вне work hours проверки,
   которые пользователь отметил, спят.
4. **После сна Mac и после перезапуска** проверка догоняет пропущенное. Пока Mac спит или worfy закрыт, проверки не идут.
5. **Настройки** лежат в настройках машины; их каналы IPC — `local`, как у настроек Limits и Link: Linked machine их не
   видит.

## Где в коде

- Окно старта Autopilot-а (только часы) — `startWindowHourSchema`, `windowFrom` и `windowTo` в
  `src/shared/settings/app-settings.ts`; хранение — `src/main/settings/store.ts`.
- Каналы IPC `local` — например `appSettingsGet` и `appSettingsSet` в `src/shared/ipc/app-settings.ts`.

## Решения

- Один планировщик, реестр с интервалом, разбросом и защитой от двойного запуска (spec, «Расписание проверок»).
- У каждого типа свой интервал; настраиваются work hours и каждый тип проверки (решение 5).
- Догоняющая проверка после сна и перезапуска; пока Mac спит или worfy закрыт — проверок нет (spec, «Расписание
  проверок»).
- Настройки — в настройках машины, IPC `local` (spec, «Расписание проверок»).

## Test-ы

Стык А (spec, «Решения по test-ам»): на входе — часы и настройки, на выходе — когда какая проверка идёт. Часы
ненастоящие: полночь, смена летнего времени, сон Mac, перезапуск. Образец — test-ы окна старта Autopilot-а
(`test/unit/autopilot-run-mode.test.ts`, `test/unit/settings-autopilot.test.tsx`).

## Готово, когда

- [ ] Планировщик держит реестр проверок с интервалом и разбросом; unit test: проверка, которая ещё идёт, второй раз не
      запускается.
  - evidence: test-run pass · `pnpm test test/unit/assistant-check-scheduler.test.ts` exit 0 · mac - · 790013a43eb69f4f0538a5f835f667ded5a6f424
- [ ] Work hours задают дни недели, одно или несколько окон и часовой пояс; unit test: вне work hours отмеченная проверка
      спит, неотмеченная идёт.
  - evidence: test-run pass · `pnpm test test/unit/assistant-work-hours.test.ts test/unit/assistant-check-scheduler.test.ts` exit 0 · mac - · 790013a43eb69f4f0538a5f835f667ded5a6f424
- [ ] Unit test: у каждого типа проверки свои включение, интервал и сон вне work hours.
  - evidence: test-run pass · `pnpm test test/unit/assistant-check-scheduler.test.ts test/unit/assistant-schedule-settings.test.ts` exit 0 · mac - · 790013a43eb69f4f0538a5f835f667ded5a6f424
- [ ] Unit test-ы на ненастоящих часах: полночь, смена летнего времени; после сна Mac и после перезапуска проверка
      догоняет пропущенное, пока Mac спит или worfy закрыт — не идёт.
  - evidence: test-run pass · `pnpm test test/unit/assistant-check-scheduler.test.ts test/unit/assistant-work-hours.test.ts` exit 0 · mac - · 790013a43eb69f4f0538a5f835f667ded5a6f424
- [ ] Настройки лежат в настройках машины; их каналы IPC — `local`, Linked machine их не видит.
  - evidence: test-run pass · `pnpm test test/contract/assistant-schedule-settings.test.ts test/contract/app-settings.test.ts` exit 0 · mac - · 790013a43eb69f4f0538a5f835f667ded5a6f424
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Итог

- Планировщик — `src/main/assistant/schedule/scheduler.ts` (`CheckScheduler`), в приложении — `src/main/assistant/schedule/app.ts`
  (`checkScheduler()`, `startCheckScheduler(powerMonitor)` из `src/main/index.ts`). Work hours —
  `src/shared/assistant/schedule/work-hours.ts`, настройки — `src/shared/assistant/schedule/settings.ts`, поле
  `assistantSchedule` настроек машины. Проверки источников (Ticket-ы 11–13) регистрируются в `checkScheduler()` по своему
  виду (`CHECK_KINDS`).
- Решено без владельца (подтвердить):
  - Настройки — поле `assistantSchedule` в `app-settings.json` (настройки машины), каналы — прежние `appSettings.*`, все
    `local`; своего домена IPC нет.
  - Slack — каждые 10 минут, Jira — раз в час (решение 5); оба по умолчанию выключены (решение 10: каждый внешний
    источник включается отдельно); оба по умолчанию спят вне work hours (`ASSISTANT_CHECK_DEFAULTS`).
  - Work hours по умолчанию — понедельник–пятница, 09:00–18:00, часовой пояс машины (`DEFAULT_WORK_HOURS`).
  - Интервал — целые минуты от 5 до 1440 (`CHECK_INTERVAL_BOUNDS`).
  - Разброс — ±10 % интервала (`SCHEDULE_JITTER`), заново после каждого запуска. Проверка, которая ждала начала
    work hours (срок вне них или ни разу не шла), идёт после их начала с задержкой от 0 до 10 % интервала по тому же
    жребию — если задержка выводит за конец окна, то в его начале.
  - Предел одного запуска — 10 минут (`CHECK_RUN_TIMEOUT_MS`): запуск, который не закончился, считается упавшим, вид
    планируется заново, `since` остаётся на последнем успехе, поздний ответ старого запуска не учитывается. Сам запуск
    планировщик не прерывает.
  - Последний старт в будущем (часы перевели назад) планировщик записывает как «сейчас».
  - Окна — целые минуты, до 4 окон (`WORK_WINDOWS_MAX`); окно, у которого конец раньше начала, идёт через полночь и
    принадлежит дню, в который началось. Начало окна в часе, который часы пропускают, — момент перевода (03:30 → 04:00);
    в часе, который идёт дважды, — первый раз.
  - Догоняющая проверка — один запуск, а не по одному на каждый пропущенный интервал; запуск получает `since` — начало
    последнего успешного запуска, и сам покрывает весь промежуток.
  - Только что включённый вид проверки идёт сразу (а если спит вне work hours — в начале work hours).
  - Упавший запуск повторяется через свой интервал, не раньше; `since` остаётся на последнем успехе.
  - Отметки (последний старт, последний успех) — в `assistant-check-marks.json` в папке данных worfy; файл, который не
    читается, — нет отметок: каждый включённый вид идёт один раз при старте.
  - Таймер ждёт не дольше часа (`MAX_TIMER_MS`) и планирует заново: смена системных часов или часового пояса
    подхватывается за этот срок.
  - 22 прежних `setInterval` в main не переведены на планировщик: Ticket просит планировщик проверок источников.

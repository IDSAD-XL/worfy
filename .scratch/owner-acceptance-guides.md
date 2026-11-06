# Приёмки и ручные проверки владельца — пошаговые гайды

Собрано 2026-11-06 по просьбе владельца: «приёмки оформи в виде списка пошаговых гайдов по каждому нужному эпику, исключи
все действия которые можешь сделать сам». Заменяет прежний список ручных проверок (`owner-manual-checks.md`).

Здесь только шаги, которые может сделать один владелец: руки на trackpad и клавиатуре, системные окна macOS и Windows,
вход в учётные записи, действия у ПК лично, оценка вида и решения «устраивает ли». Всё остальное — команды, CI, gate,
чтение файлов, Stable copy через CDP (Chrome DevTools Protocol: Orchestrator сам щёлкает и читает экран), работа на ПК
через мост (Session на ПК, которую ведёт Orchestrator) — Orchestrator делает до начала или после, это одна строка
«Перед началом Orchestrator сделает». Шаг с пометкой «(можно мне — подтвердить)» Orchestrator, скорее всего, может
сделать сам; скажи «делай сам» — и он уйдёт из гайда.

Как отвечать: номер шага и что было на экране. Все шаги сошлись — скажи «всё сошлось». Если не так — скажи номер шага.
Orchestrator отмечает пункты «(вручную)» в Ticket-е и пишет «Итог».

Подтверждено владельцем 2026-11-06: состав списка, раздел «Убрано», и что песочницу приёмки и проверки на Stable copy
делает Orchestrator.

## Порядок

Старшие первыми (решение владельца 2026-11-05):

1. [`worfy-multi-vendor` 43](#worfy-multi-vendor-43) — Mac, затем ПК.
2. [`worfy-windows` 16](#worfy-windows-16) — ПК.
3. [`worfy-faults` 08](#worfy-faults-08) и [`worfy-evidence` 09](#worfy-evidence-09) — код готов.
4. [`worfy-auto-approve` 11](#worfy-auto-approve-11) — ещё не готово: ждёт Ticket-ов 05, 08, 10, 13, 14.
5. [`worfy-retry` 11](#worfy-retry-11) — ещё не готово: ждёт Ticket-ов 05–10, 14.
6. [`worfy-autopilot-queue` 20](#worfy-autopilot-queue-20) — ещё не готово: ждёт Ticket-ов 07–19.
7. [`worfy-work-track` 12](#worfy-work-track-12) — ещё не готово: ждёт Ticket-ов 01–11 (03 — твой шаг, в
   [ручных проверках](#ручные-проверки-вне-приёмок)).

Шаги на ПК в 1 и 2 удобно пройти за один подход.

## worfy-multi-vendor 43

Финальная приёмка Epic-а «Codex рядом с Claude Code» ([Ticket](worfy-multi-vendor/issues/43-финальная-приёмка.md)).
Пункт 1 (Install Harness ставит Harness и в Codex) уже пройден.

- **Где:** Mac Stable `66c3a490` (стоит с 2026-11-05) или новее, затем ПК — Stable copy той же сборки.
- **Время:** Mac ~5 мин + ночь на Run; ПК ~20 мин.
- **Перед началом Orchestrator сделает:** через CDP в Session Codex проверит гарантии пункта 2 (reviewer не правит
  файл, Subagent не кончает ход с красным gate, guard Bash отказывает, verdict review в PR) и сверит их с parity suite
  (Ticket 45); откроет Node-ы Subagent-ов Codex и Binding к Ticket-у (пункт 4); прогонит свежую Wave Autopilot на Claude
  (решение 2026-11-04, вариант «а», из Ticket-а 32); обновит Harness и увидит отказ Autopilot с причиной (пункт 5);
  перепроверит риск 1 (условия OpenAI) и запишет его открытым до публичного выпуска; через мост обновит Stable copy на
  ПК и прочитает там sandbox Codex (`mxc` или `elevated`) и пути `%USERPROFILE%\.codex`.

Mac:

1. Сделай: ответь Orchestrator-у, какой небольшой Epic гнать ночью Autopilot-ом на Codex, или «выбери сам» →
   Должно быть: Orchestrator называет Epic и время старта, Orchestrator Project-а переключён на Codex.
2. Сделай: в Stable worfy в окне «Approve the Harness hooks in Codex» (появится после обновления Harness) просмотри
   список hook-ов и подтверди → Должно быть: окно закрылось; Orchestrator пишет, что Run стартовал (утром он принесёт
   gate, budget по окну `5h` и Flight Recorder этого Run-а).

ПК:

3. Сделай: открой Stable worfy на ПК; если worfy или Codex просит вход — войди через ChatGPT → Должно быть: в панели
   Limits раздел Codex с окном `5h`.
4. Сделай: в любом Project-е ПК — New session на Codex и сообщение «run `whoami` in the shell» → Должно быть: Codex
   отвечает выводом команды.
5. Сделай: если Windows показала окно UAC (запрос прав администратора) — разреши и скажи Orchestrator-у, было ли оно →
   Должно быть: Session продолжила ход.
6. Сделай: когда worfy на ПК покажет «Approve the Harness hooks in Codex» (Orchestrator поставит Harness в Codex через
   мост), просмотри список и подтверди → Должно быть: окно закрылось, hook-и worfy включены.
7. Сделай: в той же Session отправь фразу, которую даст Orchestrator (команда, на которую guard Bash должен отказать) →
   Должно быть: Codex пишет, что команду отклонил hook worfy, команда не выполнена.
8. Сделай: в той же Session попроси «create a card with the text hello» → Должно быть: на Canvas ПК появилась Card с
   текстом `hello` (tool-ы worfy по HTTP работают).

Результат — в Ticket `worfy-multi-vendor` 43, «Итог»; отметки «Готово, когда» spec-а.

## worfy-windows 16

Приёмка Windows-порта ([Ticket](worfy-windows/issues/16-приёмка-worfy-windows.md)). Пункт 3 (скрипты Harness на Node,
`w/lf`) и установка 2026-11-02 уже сделаны; Terminal на PowerShell и `gate fast` пройдены 2026-11-03 в установленной
копии.

- **Где:** ПК, Stable copy (как требует пункт 2) той же сборки, что для `worfy-multi-vendor` 43.
- **Время:** ~25 мин у ПК + 1–2 ч Wave без тебя.
- **Перед началом Orchestrator сделает:** через мост — чистый клон worfy на ПК (путь пришлёт), команду запуска worfy с
  пустой папкой данных для экрана первого запуска, папку для снимков; выберет Ticket для Wave; прогонит
  `harness-node-only` на Mac и в CI и `GATE_SCOPE=all` gate full на Mac (пункт 5) и на ПК; после Wave — журнал Run-а,
  PR, merge и «Итог».

1. Сделай: скажи, засчитать ли установку 2026-11-02 без снимка установщика (`16-установка.png` нет) → Должно быть:
   ответ «да» или «переустановлю».
2. Сделай: скажи, засчитать ли Terminal на PowerShell и `gate fast` из установленной копии 2026-11-03 (сборка та же,
   `bacbbcef`) → Должно быть: ответ «да» или «повторить в Stable copy».
3. Сделай: в PowerShell запусти команду первого запуска от Orchestrator-а → Должно быть: экран первого запуска, все
   строки `ok`; `warn` — только PowerShell, архитектура, `jq` или qmd.
4. Сделай: снимок экрана (Win+Shift+S) в файл `16-первый-запуск.png` в названной папке, потом закрой это окно worfy →
   Должно быть: файл лежит в папке.
5. Сделай: в Stable copy — «Add project» → папка чистого клона → «Folder» → «Review» → добавить → Должно быть: Project
   worfy в списке, Canvas показывает Epic-и и Ticket-ы worfy.
6. Сделай: снимок Canvas в `16-canvas.png` → Должно быть: файл в папке.
7. Сделай: в Project worfy — New session и сообщение «run `git log -1 --oneline` in Bash»; разверни вызов tool-а и
   сделай снимок `16-session.png` → Должно быть: в ответе вызов Bash tool и строка коммита.
8. Сделай: в той же Session спроси «Find the ADR about the full Windows port» → Должно быть: агент вызывает
   `mcp__plugin_worfy_qmd__query` или grep и называет `docs/adr/0054-full-windows-port.md`.
9. Сделай: на рамке Epic-а с Ticket-ом, который назвал Orchestrator, нажми **Autopilot** и подтверди окно старта →
   Должно быть: строка `Wave 1 · running`.
10. Сделай: не трогай worfy на ПК до сообщения Orchestrator-а о конце Wave → Должно быть: Orchestrator пишет: Ticket
    `done`, PR влит, в журнале нет `refused-dialog` и `human-input`, последняя строка `run-stopped`.

Результат — в Ticket `worfy-windows` 16, «Итог»; закрывает Epic `worfy-windows`.

## worfy-faults 08

Приёмка набора сценариев сбоев Autopilot ([Ticket](worfy-faults/issues/08-приёмка-с-владельцем.md), полный чек-лист — там
же, раздел «Чек-лист приёмки», состав подтверждён владельцем 2026-11-06).

- **Где:** Mac Stable `66c3a490` или новее (PR-ы Epic-а не правят `src/`), без ПК.
- **Время:** ~15 мин; Run тратит немного usage Claude Code.
- **Перед началом Orchestrator сделает:** worktree и шаги 1–4 и 7 чек-листа (unit, contract, e2e под замком
  `/tmp/worfy-e2e.lock`, уборка); ссылки на job-ы `linux-tests`, `windows`, `macos-e2e`, `windows-e2e` и время test-ов
  по логам CI; `git log` без `src/`; Demo project (`~/worfy-demo`) в Stable с Epic-ом `todo`.

1. Сделай: прочитай разделы «Правила восстановления» и «Сценарии» в [spec](worfy-faults/spec.md) и строки
   `autopilot-faults` таблицы «Tests» в `docs/features/autopilot.md` → Должно быть: ответ «хватает» или какой сбой
   добавить (новый сбой — новый Ticket).

Шаги 2–7 — Force Quit посреди Wave (решение Q7; правила И1, И4, И6). Весь блок — (можно мне — подтвердить): то же
Orchestrator делает через CDP и `kill -9` процесса worfy.

2. Сделай: в Stable worfy, Demo project, на рамке Epic-а `todo` нажми **Autopilot** и подожди 20–30 s → Должно быть:
   строка `Wave 1 · running`, команда `/epic-wave` в чате Orchestrator-а.
3. Сделай: Activity Monitor → worfy → «Force Quit» → Должно быть: окно worfy исчезло.
4. Сделай: запусти Stable worfy снова → Должно быть: в чат Orchestrator-а не ушло нового сообщения; строки
   `Wave 1 · running` нет; кнопка **Autopilot** активна.
5. Сделай: Command palette → «Open Run history» → Должно быть: выбран прошлый Run, причина — `no stop in the Journal`.
6. Сделай: Esc и снова **Autopilot** → Должно быть: новый Run, `Wave 1 · running`, без отказа старта.
7. Сделай: нажми **Stop** → Должно быть: Run остановлен, usage больше не тратится.

Результат — в Ticket `worfy-faults` 08, «Итог»; отметки «Готово, когда» spec-а.

## worfy-evidence 09

Приёмка Evidence — строк доказательств к пунктам Ticket-а, матрицы, privacy check (проверки на личные данные), снимков и
клипов ([Ticket](worfy-evidence/issues/09-приёмка-с-владельцем.md)).

- **Где:** Mac Stable `66c3a490` или новее (все Ticket-ы Epic-а в ней); ПК — Stable copy той же сборки, что для
  `worfy-multi-vendor` 43.
- **Время:** Mac ~10 мин, ПК ~10 мин.
- **Перед началом Orchestrator сделает:** Ticket демо-Epic-а со строками всех видов и клипом; через CDP — chip
  «Evidence n/m» трёх цветов, матрица в focus mode, ссылки SHA, `PR #N`, CI и снимок, «Not verified: needs windows
  stable, got windows installed», снимок поверх окна, перемотка клипа, «Contact sheet», снимки в двух темах; в shell —
  предупреждение `ticket done`, privacy check (путь, хост, UUID, снимок и клип без `scrub:`, без sheet, больше 8 MB,
  путь в `Title`) и `land` без push; через мост на ПК — `ticket evidence`, `evidence-check` с `C:\Users\…` в Git Bash и
  PowerShell, helper-ы Ticket-а 11 пишут снимок и клип.

Mac:

1. Сделай: в Stable worfy открой Ticket демо-Epic-а, который назовёт Orchestrator, и его матрицу Evidence → Должно
   быть: матрица в focus mode, в строке `video` — клип.
2. Сделай: включи клип и посмотри его целиком (ответ Qv1) → Должно быть: клип играет до конца, на нём нет личного,
   чего не называет строка `scrub:`.
3. Сделай: открой «Contact sheet» этого клипа и сверь с клипом → Должно быть: кадры sheet — из этого клипа, ничего
   лишнего.

ПК:

4. Сделай: в Stable copy на ПК открой тот же Ticket и матрицу, рядом — снимок матрицы Mac от Orchestrator-а → Должно
   быть: chip и матрица такие же, как на Mac. (можно мне — подтвердить)
5. Сделай: в матрице на ПК включи клип, записанный helper-ом на ПК → Должно быть: клип играет. (можно мне —
   подтвердить)

Результат — в Ticket `worfy-evidence` 09, «Итог»; снимки — `worfy-evidence/evidence/09/`; отметки «Готово, когда» spec-а.

## worfy-auto-approve 11

Ещё не готово: ждёт Ticket-ов 05, 08, 10, 13, 14 ([Ticket](worfy-auto-approve/issues/11-приёмка-с-владельцем.md)).

- **Где:** Mac Stable со всеми Ticket-ами Epic-а (Orchestrator обновит).
- **Время:** ~5 мин на старте, ~15 мин через две недели Shadow, ~5 мин после первой ночи On.
- **Перед началом Orchestrator сделает:** CI на SHA последнего merge; ручную проверку на демо-Project-е через CDP (`rm`
  во временной папке worktree — allow, `rm` в домашней папке — hard-deny, вопрос — deny-with-hint) со сверкой сводки и
  Journal; напоминание, когда наберётся 10 решений Shadow или пройдут две недели (ориентир Q2).

1. Сделай: в Stable — Modes → Auto-approval → «Shadow» у Project-а, который назовёт Orchestrator → Должно быть: в меню
   Modes у этого Project-а «Shadow». (можно мне — подтвердить)
2. Сделай: по напоминанию — Run history → список «would allow» → Должно быть: по каждому решению твой ответ «согласен»
   или «нет».
3. Сделай: Modes → Auto-approval → «On» → Должно быть: в меню Modes «On».
4. Сделай: утром после первой ночи On прочитай сводку Auto-approval в Run history → Должно быть: ответ «устраивает»
   или какие решения неверны.

Результат — в Ticket `worfy-auto-approve` 11, «Итог»; Status spec-а.

## worfy-retry 11

Ещё не готово: ждёт Ticket-ов 05, 06, 07, 08, 09, 10, 14 ([Ticket](worfy-retry/issues/11-приёмка-с-владельцем.md)).

- **Где:** Mac Stable со всеми Ticket-ами Epic-а; ПК как Linked machine, если включён.
- **Время:** Mac ~10 мин, ПК ~5 мин.
- **Перед началом Orchestrator сделает:** CI macOS и Windows на SHA последнего merge; Stable с `WORFY_AGENT=fake` и
  скриптом «529, затем удачный ход» на демо-проекте; Journal Run-а (`turn-retry`, `resumed`); связь Mac и ПК с Full
  access, потом Read only; «Итог» с тем, что не проверено вживую (настоящий 500/529, отказ Limits).

1. Сделай: в чате Orchestrator-а демо-проекта открой **Modes** → Должно быть: Eco mode, Auto-approval, Auto-continue;
   tooltip-ы понятны.
2. Сделай: переключи тему и посмотри на иконку кнопки Modes → Должно быть: иконка читается в светлой и тёмной теме.
3. Сделай: пройди меню клавиатурой (Tab, стрелки, Enter, Esc) → Должно быть: каждый пункт достижим, Esc закрывает.
4. Сделай: отправь в чат любой текст → Должно быть: строка отсчёта с `Retry now` и `Cancel`. (можно мне —
   подтвердить: снимок вместо твоего взгляда)
5. Сделай: нажми `Retry now` → Должно быть: ход прошёл, строка отсчёта исчезла. (можно мне — подтвердить)
6. Сделай: на ПК в Linked machine Mac (Full access) открой Modes и переключи Auto-continue → Должно быть: на Mac в
   открытом меню переключатель сменился сразу.
7. Сделай: после того как Orchestrator переключит доступ на Read only, открой Modes на ПК → Должно быть: состояния
   видны, пункты недоступны.

Результат — в Ticket `worfy-retry` 11, «Итог»; Status spec-а и `HANDOFF.md`.

## worfy-autopilot-queue 20

Ещё не готово: ждёт Ticket-ов 07–19 ([Ticket](worfy-autopilot-queue/issues/20-приёмка-с-владельцем.md)).

- **Где:** Mac Stable со всеми Ticket-ами Epic-а, демо-проект с `WORFY_AGENT=fake` (без токенов).
- **Время:** ~20 мин.
- **Перед началом Orchestrator сделает:** CI на SHA последнего merge; демо-проект и fixture с тремя Epic-ами (один с
  Ticket-ом `Waits: owner`); прототип `card-918c77d9` рядом; скрипт fake agent-а с `500`; вызов `autopilot_start`;
  проверку Run history (Wait «Orchestrator busy», заголовок Run-а очереди).

1. Сделай: нажми кнопку **Autopilot** и сравни окно с прототипом `card-918c77d9` → Должно быть: совпадает, или назови
   различия.
2. Сделай: переключи тему и посмотри окно снова → Должно быть: обе темы в порядке.
3. Сделай: пройди окно клавиатурой → Должно быть: всё достижимо, Esc закрывает.
4. Сделай: пока Orchestrator в ходе, нажми «Start when free» → Должно быть: строка ожидания. (можно мне — подтвердить:
   снимок вместо твоего взгляда, так же в шагах 5–9)
5. Сделай: нажми «Start now» → Должно быть: окно со списком, затем Run идёт.
6. Сделай: снова «Start when free», затем «Cancel» → Должно быть: ожидание снято, Run не стартовал.
7. Сделай: после сообщения Orchestrator-а «Run остановлен ошибкой» посмотри на Session → Должно быть: Session у тебя
   сразу, задача названа.
8. Сделай: «Run all accepted», сними один Epic и переставь два → Должно быть: строка «Epic 1/2».
9. Сделай: «Add to queue» для Epic-а с Ticket-ом `Waits: owner` → Должно быть: он пропущен с «Waits for owner».
10. Сделай: прочитай «Решено без владельца» и «Открытые вопросы» [spec](worfy-autopilot-queue/spec.md) → Должно быть:
    по каждому пункту «подтверждаю» или «в Ticket».

Результат — в Ticket `worfy-autopilot-queue` 20, «Итог»; Status spec-а и `HANDOFF.md`.

## worfy-work-track 12

Ещё не готово: ждёт Ticket-ов 01–11 ([Ticket](worfy-work-track/issues/12-приёмка-с-владельцем.md)).

- **Где:** Mac Stable со всеми Ticket-ами Epic-а, настоящий Project worfy (только чтение).
- **Время:** ~15 мин.
- **Перед началом Orchestrator сделает:** CI на SHA последнего merge; через CDP — развернуть Subagent-ов, Wave → Open
  Run, PR → Open PR, подсказки пробелов, замер первого открытия Month; прототип `card-dcf3918a` рядом.

1. Сделай: Runs → Work track → Week → Должно быть: неделя совпадает с тем, что ты помнишь; пропущенную работу назови.
2. Сделай: переключи на Day за вчера → Должно быть: день совпадает с памятью.
3. Сделай: переключи на Month и «by Epic» → Должно быть: группировка по Epic-ам понятна.
4. Сделай: сравни экран с прототипом `card-dcf3918a` → Должно быть: совпадает, или назови различия.
5. Сделай: прочитай «Решено без владельца» и «Открытые вопросы» [spec](worfy-work-track/spec.md) → Должно быть: по
   каждому пункту «подтверждаю» или «в Ticket».

Результат — в Ticket `worfy-work-track` 12, «Итог»; Status spec-а и `HANDOFF.md`.

## Ручные проверки вне приёмок

Пункты «(вручную)» закрытых Ticket-ов и шаги владельца. Mac ~20 мин, ПК ~10 мин.

- **Перед началом Orchestrator сделает:** запустит Stable worfy на Mac; на ПК — Stable copy и новую папку с
  git-репозиторием для «Add project».

Mac:

1. Сделай: посмотри Dock, папку Applications в Finder списком и баннер любого уведомления worfy (`worfy-daily` 31) →
   Должно быть: везде знак worfy, в списке Finder — упрощённый знак. Старая иконка — `killall Dock` и посмотреть снова.
2. Сделай: выключи Focus, в Session Stable отправь «sleep 20, then say done» и сразу переведи вперёд Finder; когда
   придёт баннер с именем Project-а — щёлкни его (`worfy-mvp` 21) → Должно быть: worfy выходит вперёд на Node этой
   Session, в Dock один значок worfy.
3. Сделай: в Terminal Node набери `echo ABCDEFGHIJ`, при масштабе Canvas около 50 % выдели `ABCDEFGHIJ` касанием и
   перетаскиванием тремя пальцами и нажми ⌘C (`worfy-daily` 13) → Должно быть: в буфере ровно `ABCDEFGHIJ`.
4. Сделай: то же при масштабе около 150 % (⌘=) и один force click → Должно быть: в буфере `ABCDEFGHIJ`, force click
   ничего не ломает.
5. Сделай: свайп двумя пальцами над Orchestrator, HANDOFF, Card и Terminal до клика и после клика по Node-у
   (`worfy-week` 16) → Должно быть: до клика двигается Canvas, после — прокручивается содержимое (Orchestrator двигает
   Canvas и после клика).
6. Сделай: pinch над каждым из этих Node-ов → Должно быть: зумится Canvas, кроме активной Card.
7. Сделай: в приложении Claude открой список запланированных задач, задачу после `feature-docs-lag` (`worfy-guide` 20,
   п. 1) → Должно быть: в описании — запуск `node scripts/guide-lag.mjs`; старое описание — Orchestrator пересоздаст
   задачу. (можно мне — подтвердить: в `~/.claude/scheduled-tasks` этой задачи нет, она в самом приложении)
8. Сделай: добавь `"cleanupPeriodDays": 35` в `~/.claude/settings.json` (`worfy-work-track` 03; цена — около +0.7 GB
   транскриптов в месяц) → Должно быть: Orchestrator читает строку и закрывает Ticket 03.
9. По желанию (подтверждено владельцем 2026-11-06; без fish `worfy-mvp` 06 закрывается как непроверяемый). Сделай:
   `brew install fish`, fish — login shell, в Stable — «New session» с запросом выполнить в Bash
   `echo $PATH; which gh jq; echo $SSH_AUTH_SOCK` → Должно быть: `gh` и `jq` найдены, `SSH_AUTH_SOCK` не пуст. Потом
   вернуть прежний login shell.

ПК:

10. Сделай: добавь в Windows раскладку с AltGr (например, German) и в worfy на ней нажми AltGr+Q в поле ввода Session
    и в поле Settings (`worfy-ui` 03) → Должно быть: печатается `@`.
11. Сделай: на той же раскладке нажми AltGr+0 → Должно быть: печатается `}`, масштаб интерфейса не сбрасывается.
    Раскладку потом можно убрать; результат — в чат Session на ПК (решение 2026-10-14).
12. Сделай: «Add project» для новой папки от Orchestrator-а (`worfy-windows` 30, пп. 1–2) → Должно быть: форма доходит
    до «Review», пишет Profile, Project в списке.
13. Сделай: «Add project» для папки worfy (Harness её знает; можно вместе с шагом 5 `worfy-windows` 16) → Должно быть:
    на шаге «Folder» папка сразу в списке. Пункт 3 `worfy-windows` 30 держит contract test `projects-connect` в CI.

## Убрано

- Песочница приёмки `worfy-harness` 36 (перенос из `$TMPDIR`, `claude plugin validate harness`, живые проверки 05–08) —
  делает Orchestrator, подтверждено владельцем 2026-11-06.
- Ручные проверки на Stable copy из `HANDOFF.md` (`worfy-week`, `worfy-harness` 18–25) — Orchestrator через CDP
  (разрешение 2026-11-04).
- Запрос разрешения на уведомления (`worfy-daily` 03) — разрешение уже выдано.
- Два системных окна 2026-10-07 (Automation для Finder, `universalAccessAuthWarn`) — на экране их нет с 2026-11-06.
- Gate full на Windows для `worfy-ui` 03, 10, 11 — зелёный на `5557f7448`, отмечено.
- SmartScreen установщика (`worfy-windows` 12) — отмечено, Ticket закрыт 2026-10-12.
- `worfy-terminal-ssh` 10 — Epic отложен владельцем 2026-10-21, гайда нет.

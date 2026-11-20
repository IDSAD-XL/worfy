# Приёмки и ручные проверки владельца — пошаговые гайды

Собрано 2026-11-06 по просьбе владельца: «приёмки оформи в виде списка пошаговых гайдов по каждому нужному эпику, исключи
все действия которые можешь сделать сам». Заменяет прежний список ручных проверок (`owner-manual-checks.md`).

Здесь только шаги, которые может сделать один владелец: руки на trackpad и клавиатуре, системные окна macOS и Windows,
вход в учётные записи, действия у ПК лично, оценка вида и решения «устраивает ли». Всё остальное — команды, CI, gate,
чтение файлов, Stable copy через CDP (Chrome DevTools Protocol: Orchestrator сам щёлкает и читает экран), работа на ПК
через мост (Session на ПК, которую ведёт Orchestrator) — Orchestrator делает до начала или после, это одна строка
«Перед началом Orchestrator сделает». Правило: всё в окне worfy на Mac (Stable copy), включая Force Quit по pid и
перезапуск, делает Orchestrator; экран ПК, приложение Claude и оценка вида остаются тебе.

Как отвечать: номер шага и что было на экране. Все шаги сошлись — скажи «всё сошлось». Если не так — скажи номер шага.
Orchestrator отмечает пункты «(вручную)» в Ticket-е и пишет «Итог».

Подтверждено владельцем 2026-11-06: состав списка, раздел «Убрано», и что песочницу приёмки и проверки на Stable copy
делает Orchestrator.

## Порядок

Старшие первыми (решение владельца 2026-11-05):

1. [`worfy-multi-vendor` 43](#worfy-multi-vendor-43) — Mac, затем ПК.
2. [`worfy-windows` 16](#worfy-windows-16) — ПК.
3. [`worfy-evidence` 09](#worfy-evidence-09) — принят 2026-11-07. ([`worfy-faults` 08](#worfy-faults-08) — принят 2026-11-06.)
4. [`worfy-auto-approve` 11](#worfy-auto-approve-11) — ещё не готово: ждёт Ticket-ов 05, 08, 10, 13, 14.
5. [`worfy-retry` 11](#worfy-retry-11) — принят 2026-11-07.
6. [`worfy-autopilot-queue` 20](#worfy-autopilot-queue-20) — принят 2026-11-07.
7. [`worfy-work-track` 12](#worfy-work-track-12) — ещё не готово: ждёт Ticket-ов 01–11 (03 — твой шаг, в
   [ручных проверках](#ручные-проверки-вне-приёмок)).
8. [`worfy-auth-check` 10](#worfy-auth-check-10) — Mac готов к приёмке; ПК и SSO — отдельно.

Шаги на ПК в 1 и 2 удобно пройти за один подход.

## worfy-multi-vendor 43

Финальная приёмка Epic-а «Codex рядом с Claude Code» ([Ticket](worfy-multi-vendor/issues/43-финальная-приёмка.md)).
Пункт 1 (Install Harness ставит Harness и в Codex) уже пройден. 2026-11-06: ПК (шаги 3–8) пройден, риск 1 проверен; осталась Mac-часть — ночной Run на Codex.

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

Принят 2026-11-06 — «Итог» [Ticket-а](worfy-faults/issues/08-приёмка-с-владельцем.md#итог).

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
   быть: chip и матрица такие же, как на Mac.
5. Сделай: в матрице на ПК включи клип, записанный helper-ом на ПК → Должно быть: клип играет.

Результат — в Ticket `worfy-evidence` 09, «Итог»; снимки — `worfy-evidence/evidence/09/`; отметки «Готово, когда» spec-а.

## worfy-auto-approve 11

Ещё не готово: ждёт Ticket-ов 05, 08, 10, 13, 14 ([Ticket](worfy-auto-approve/issues/11-приёмка-с-владельцем.md)).

- **Где:** Mac Stable со всеми Ticket-ами Epic-а (Orchestrator обновит).
- **Время:** ~15 мин через две недели Shadow, ~5 мин после первой ночи On.
- **Перед началом Orchestrator сделает:** CI на SHA последнего merge; ручную проверку на демо-Project-е через CDP (`rm`
  во временной папке worktree — allow, `rm` в домашней папке — hard-deny, вопрос — deny-with-hint) со сверкой сводки и
  Journal; через CDP — Auto-approval в Shadow у одного Project-а; напоминание, когда наберётся 10 решений Shadow или
  пройдут две недели (ориентир Q2).

1. Сделай: по напоминанию — Run history → список «would allow» → Должно быть: по каждому решению твой ответ «согласен»
   или «нет».
2. Сделай: Modes → Auto-approval → «On» → Должно быть: в меню Modes «On».
3. Сделай: утром после первой ночи On прочитай сводку Auto-approval в Run history → Должно быть: ответ «устраивает»
   или какие решения неверны.

Результат — в Ticket `worfy-auto-approve` 11, «Итог»; Status spec-а.

## worfy-retry 11

Принят 2026-11-07 — «Итог» [Ticket-а](worfy-retry/issues/11-приёмка-с-владельцем.md#итог).

- **Где:** Mac Stable со всеми Ticket-ами Epic-а; ПК как Linked machine, если включён.
- **Время:** Mac ~5 мин, ПК ~5 мин.
- **Перед началом Orchestrator сделает:** CI macOS и Windows на SHA последнего merge; Stable с `WORFY_AGENT=fake` и
  скриптом «529, затем удачный ход» на демо-проекте; Journal Run-а (`turn-retry`, `resumed`); связь Mac и ПК с Full
  access, потом Read only; через CDP — строка отсчёта с `Retry now` и `Cancel` после 529 и удачный ход по `Retry now`
  (снимки тебе); «Итог» с тем, что не проверено вживую (настоящий 500/529, отказ Limits).

1. Сделай: в чате Orchestrator-а демо-проекта открой **Modes** → Должно быть: Eco mode, Auto-approval, Auto-continue;
   tooltip-ы понятны.
2. Сделай: переключи тему и посмотри на иконку кнопки Modes → Должно быть: иконка читается в светлой и тёмной теме.
3. Сделай: пройди меню клавиатурой (Tab, стрелки, Enter, Esc) → Должно быть: каждый пункт достижим, Esc закрывает.
4. Сделай: на ПК в Linked machine Mac (Full access) открой Modes и переключи Auto-continue → Должно быть: на Mac в
   открытом меню переключатель сменился сразу.
5. Сделай: после того как Orchestrator переключит доступ на Read only, открой Modes на ПК → Должно быть: состояния
   видны, пункты недоступны.

Результат — в Ticket `worfy-retry` 11, «Итог»; Status spec-а и `HANDOFF.md`.

## worfy-autopilot-queue 20

Принят 2026-11-07 — «Итог» [Ticket-а](worfy-autopilot-queue/issues/20-приёмка-с-владельцем.md#итог); доработки — [Ticket 21](worfy-autopilot-queue/issues/21-очередь-start-anyway-и-последний-epic-ждёт-владельца.md).

- **Где:** Mac Stable со всеми Ticket-ами Epic-а, демо-проект с `WORFY_AGENT=fake` (без токенов).
- **Время:** ~10 мин.
- **Перед началом Orchestrator сделает:** CI на SHA последнего merge; демо-проект и fixture с тремя Epic-ами (один с
  Ticket-ом `Waits: owner`); прототип `card-918c77d9` рядом; скрипт fake agent-а с `500`; вызов `autopilot_start`;
  через CDP со снимками тебе — «Start when free» → строка ожидания → «Start now» → Run; «Cancel»; Run, остановленный
  ошибкой, возвращает Session с названной задачей; «Run all accepted», снять и переставить Epic-и → «Epic 1/2»; «Add to
  queue» пропускает Epic с `Waits: owner` («Waits for owner»); Run history (Wait «Orchestrator busy», заголовок Run-а
  очереди).

1. Сделай: нажми кнопку **Autopilot** и сравни окно с прототипом `card-918c77d9` → Должно быть: совпадает, или назови
   различия.
2. Сделай: переключи тему и посмотри окно снова → Должно быть: обе темы в порядке.
3. Сделай: пройди окно клавиатурой → Должно быть: всё достижимо, Esc закрывает.
4. Сделай: прочитай «Решено без владельца» и «Открытые вопросы» [spec](worfy-autopilot-queue/spec.md) → Должно быть:
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

## worfy-auth-check 10

Приёмка Epic-а «Health check проверяет входы и настройку» ([Ticket](worfy-auth-check/issues/10-приёмка-владельцем.md),
[spec](worfy-auth-check/spec.md)). Health check — раздел Settings → Health: строки проверок Machine и Project-ов, у
каждой уровень Critical или Non-critical; кнопка на rail sidebar показывает худший уровень точкой.

**Stable содержит код Epic-а: да (commit `5d1efe69`).** Mac Stable — версия `0.4.0+5d1efe69` (файл
`Contents/Resources/harness/.claude-plugin/plugin.json` в `~/Applications/worfy-stable.app`, сверено 2026-11-20).
Merge-commit-ы Ticket-ов 01 (#2017), 03 (#2018), 04 (#2021), 05 (#2023), 07 (#2031) и 08 (#2030) — предки `5d1efe69`
(`git merge-base --is-ancestor`, exit 0 у всех шести). Ticket 09 (#2034, `5081bf57`) влит позже, но в нём только
документы, без `src/`. Обновлять Mac Stable для приёмки не нужно. Версию Stable copy на ПК отсюда не видно — её сверит
Orchestrator через мост.

- **Где:** Mac Stable `5d1efe69` или новее, Project `worfy-sandbox` (origin на GitHub; песочница, в ней ничего не
  жалко); потом ПК — Stable copy с тем же кодом.
- **Время:** Mac ~25 мин, ПК ~25 мин.
- **Что нельзя проверить сейчас:**
  - SSO (строка со ссылкой авторизации): ждёт Ticket 06, а тот — вывода тестера по Ticket-у 02 (read-only скрипт SAML
    SSO). Пока закрывается только запись «SSO принимается отдельно после Ticket-а 06».
  - Пункты ПК (три сценария с `setx GH_TOKEN` и probe из `spike.md`) — нужен включённый ПК и ты у него. Без них
    последний пункт «Владелец принял Epic на Mac и ПК» не закрыть.
- **Перед началом Orchestrator сделает:** пункты «Готово, когда» spec-а без «(вручную)» — CI каждого PR Epic-а (#2017,
  #2018, #2021, #2023, #2031, #2030, #2034) и имена test-ов на `main` (test утечки токена — по имени); через CDP
  прочитает Settings → Health и назовёт строки Machine, которые уже не в `ok` (от них зависит цвет точки в шагах ниже);
  остановит land-ы и Wave-ы на время шагов с переменной; запомнит `github.account` Project-а `worfy-sandbox`, чтобы вернуть его в конце.

Шаги 2–11 меняют окружение новых shell-ов Mac примерно на 20 минут: gh в новом Terminal пойдёт с `GH_TOKEN`.
Переменную ставит и снимает Orchestrator — после твоего «да» в шаге 1.

### Mac, пункт 1 — токен окружения и пустой `github.account` (~8 мин)

Перед шагом 2 Orchestrator: `launchctl setenv GH_TOKEN` с токеном gh того login-а, который пушит в `worfy-sandbox`
(`gh auth token -u <login>`: новый токен не выпускается, отзывать потом нечего); строка в `~/.zshrc`, которая
экспортирует `$(launchctl getenv GH_TOKEN)` — на macOS переменная launchd доходит до gh worfy только так (spike
Ticket-а 01); очистит `github.account` Project-а `worfy-sandbox` через `profile-set`; перезапустит Stable.

1. Сделай: ответь «да» на смену окружения Mac на время шагов 2–11 → Должно быть: Orchestrator пишет, что переменная
   стоит и Stable перезапущена.
2. Сделай: на rail sidebar слева найди кнопку с сердцем и линией пульса прямо над Machines и наведи на неё → Должно
   быть: жёлтая точка; tooltip «Health check — non-critical: GitHub access (worfy-sandbox)» (и строки, которые
   Orchestrator назвал до начала). Красной точки нет.
3. Сделай: щёлкни эту кнопку → Должно быть: открылись Settings → Health; блок «Projects · worfy-sandbox», строка
   GitHub access — Warning, Non-critical: `github.account is not set: gh works with GH_TOKEN from the environment ·
   <repo>`. Видно имя переменной, значения токена нет нигде. Есть кнопка «Use <login>» с твоим login-ом.
4. Сделай: найди строку GitHub accounts (группа GitHub) → Должно быть: строка говорит, что `GH_TOKEN from the
   environment` перекрывает login из keyring; значения токена нет.
5. Сделай: нажми «Use <login>» → Должно быть: строка GitHub access стала `ok`: `<login> · the token of <login> from
   gh's keyring (GH_TOKEN of the environment does not apply here) · <repo>`; жёлтая точка от неё ушла.

Pass: шаги 2–5 сошлись — точка жёлтая, не красная; в тексте имя переменной, а не значение; «Use <login>» записал поле
(Orchestrator сверит `github.account` в Profile и commit в Harness home). Fail: красная точка, токен в тексте, нет
кнопки «Use <login>» или строка после щелчка не `ok`.

### Mac, пункт 2 — отказ GitHub (~8 мин)

Перед шагом 6 Orchestrator: снова очистит `github.account` `worfy-sandbox`; поставит в `GH_TOKEN` заведомо неверное
значение (не токен); перезапустит Stable.

6. Сделай: после перезапуска посмотри, что открылось само → Должно быть: если открылось окно First run — в нём
   красная строка GitHub accounts (строка Machine: токен окружения не работает). Это верно, закрой окно. Строки
   GitHub access Project-а в причине открытия нет.
7. Сделай: наведи на кнопку Health check на rail → Должно быть: красная точка; tooltip начинается с «critical:» и
   называет GitHub access (worfy-sandbox).
8. Сделай: открой Pull requests Project-а `worfy-sandbox` (View switch на toolbar или Command palette → «Pull
   requests») → Должно быть: под заголовком строка «GitHub refused the sign-in: GH_TOKEN from the environment does not
   work (HTTP 401)» и ссылка **Open Health check**; пустого списка без причины нет. Строка может появиться через
   несколько секунд после «Reading pull requests…».
9. Сделай: щёлкни **Open Health check** → Должно быть: Settings → Health, блок «Projects · worfy-sandbox», строка
   GitHub access — Failed, Critical: `GH_TOKEN from the environment does not work (HTTP 401)`; подсказка с тремя
   вариантами; команда `launchctl unsetenv GH_TOKEN` с Copy; кнопка «Use <login>».
10. Сделай: нажми «Use <login>» → Должно быть: строка GitHub access стала `ok` (аккаунт Profile-а перекрывает
    переменную). Красная точка остаётся от строки GitHub accounts, пока стоит переменная, — это верно.
11. Сделай: скажи Orchestrator-у «снимай» → Должно быть: Orchestrator снимает переменную (`launchctl unsetenv GH_TOKEN` и
    строку в `~/.zshrc`), перезапускает Stable; красной точки больше нет.

Pass: точка красная до любого действия; строка причины и ссылка в PR inbox; ссылка ведёт к строке Project-а; First run
не открылся из-за строки Project-а. Fail: PR inbox пустой без строки причины, точка жёлтая или серая, ссылка открывает не
Settings → Health, или First run открылся и в нём красная только строка GitHub access.

### Mac, пункт 3 — qmd без моделей, Codex без входа, `notice` в Session Codex (~10 мин)

Перед шагом 12 Orchestrator: отложит в сторону файл ответа о моделях qmd (`~/.claude/worfy-harness/qmd-models`) — строка
qmd models снова «не скачаны»; отложит `~/.codex/auth.json` (вход Codex), когда не идёт ни одна Session Codex; нажмёт
«Check again» через CDP.

12. Сделай: наведи на кнопку Health check → Должно быть: жёлтая точка, не красная; tooltip «non-critical: qmd models,
    Codex sign-in».
13. Сделай: щёлкни кнопку → Должно быть: строка qmd models — Warning, Non-critical, `not downloaded (<размер>)`, кнопки
    «Download…» и «Skip…»; в группе Codex строка Codex sign-in — Warning, Non-critical, кнопка «Sign in to Codex…». Не
    жми «Download…» и «Skip…»: файл ответа вернёт Orchestrator.
14. Сделай: нажми «Check again» и смотри на кнопку на rail → Должно быть: пока идёт проверка, на месте точки серое
    кольцо; потом снова жёлтая точка.
15. Сделай: нажми «Sign in to Codex…» и войди через ChatGPT в браузере → Должно быть: проверки идут снова, строка Codex
    sign-in — `ok` с `<email> · <plan>`.

Перед шагом 16 Orchestrator: вернёт файл ответа qmd (и старый `auth.json`, если вход в шаге 15 не прошёл); запишет в
`github.account` `worfy-sandbox` login, которого нет в gh; перезапустит Stable.

16. Сделай: после перезапуска посмотри на экран → Должно быть: окно First run само не открылось; на кнопке rail красная
    точка, tooltip называет GitHub access (worfy-sandbox).
17. Сделай: в Project-е `worfy-sandbox` — «New session» в sidebar, в списке «New session on» — Codex → Должно быть: в
    начале транскрипта `notice` «GitHub is not available to this Session: … gh and git push in it run without the
    Project's GitHub account.», под ним **Open Health check**; значения токена нет.
18. Сделай: щёлкни **Open Health check** → Должно быть: Settings → Health, строка GitHub access `worfy-sandbox` — Failed,
    `no gh login for <login>`, кнопка «Sign in…». Не нажимай: прежний `github.account` вернёт Orchestrator.
19. Сделай: когда Orchestrator вернёт `github.account` и нажмёт «Check again», открой Command palette (⌘K), набери
    «Health check» и выбери строку → Должно быть: открылись Settings → Health, а не окно First run; точки на rail нет
    (или только от строк, которые Orchestrator назвал до начала).

Pass: qmd и Codex дают жёлтую точку, не красную; серое кольцо во время «Check again»; `notice` со ссылкой в Session
Codex; palette открывает Settings → Health; First run не открылся сам в шаге 16. Fail: красная точка от qmd или Codex,
нет `notice`, palette открывает First run, или First run открылся сам в шаге 16.

Замечено ревью Ticket-а 08, не блокирует: у строки с кнопкой колонка detail сжата до 1–2 знаков (Codex sign-in — «n…»),
полный текст виден только при наведении. Скажи в шаге 13, мешает ли — тогда Ticket.

### ПК — те же сценарии с `setx` и probe (~25 мин, отдельный подход)

Перед началом Orchestrator через мост: обновит Stable copy на ПК до `main` с Ticket-ами Epic-а и сверит версию; запустит
probe из [`spike.md`](worfy-auth-check/spike.md), раздел «Скрипт для ПК», в checkout-е worfy на ПК и запишет строки W4,
G2, W8 (и G3, G6, W7) в «Итог» `spike.md` — так закрываются пункты 2 и 4 Ticket-а 01 (путь токена на Windows); ставит
`setx GH_TOKEN …` и снимает её `[Environment]::SetEnvironmentVariable('GH_TOKEN', $null, 'User')`, перезапуская Stable
copy между сценариями; файлы qmd и Codex откладывает и возвращает, как на Mac (`%USERPROFILE%\.claude\worfy-harness`,
`%USERPROFILE%\.codex`).

20. Сделай: ответь «да» на обновление Stable copy и на переменную пользователя `GH_TOKEN` на ПК примерно на 20 минут →
    Должно быть: Orchestrator пишет, что Stable copy обновлена, probe прошёл и строки записаны.
21. Сделай: пройди шаги 2–5 в Stable copy на ПК → Должно быть: то же, что на Mac. «Use <login>» есть, если у gh на ПК
    ровно один login с push в `worfy-sandbox`; иначе строка просит задать `github.account` — это тоже верно.
22. Сделай: пройди шаги 6–10 → Должно быть: то же, что на Mac; команда в строке GitHub access — для Windows
    (`[Environment]::SetEnvironmentVariable('GH_TOKEN', $null, 'User')`), не `launchctl`.
23. Сделай: пройди шаги 12–19 → Должно быть: то же, что на Mac.

Pass: шаги 21–23 сошлись, строки probe в «Итог» `spike.md`. Fail: любое расхождение с Mac, кроме текста команды.

### SSO и итог

SSO не проверить, пока нет Ticket-а 06 (он ждёт вывода тестера по Ticket-у 02). Orchestrator пишет в «Итог» Ticket-а 10
«SSO принимается отдельно после Ticket-а 06» — этим закрывается пункт SSO.

24. Сделай: после Mac и ПК скажи «принимаю Epic» или назови номер шага, который не сошёлся → Должно быть: Orchestrator
    отмечает пункты «(вручную)» и пишет «Итог»; SSO — отдельная приёмка после Ticket-а 06.

### Подтвердить решения без владельца

Ответь по номеру: «подтверждаю» или «в Ticket».

1. Ticket 01 ([`spike.md`](worfy-auth-check/spike.md), «Итог»): «Решение без владельца: Ticket закрывается на
   доказательствах с Mac и чтении кода». Живого `launchctl setenv` с тестовым токеном и запусков на ПК не было; запуск
   на ПК перенесён в эту приёмку.
2. Ticket 03 ([Code story](worfy-auth-check/stories/03-модель-health-check.md), раздел 4): «уровень строки из сообщения
   считается с `githubProject: true` — не записано в spec, решено здесь». Сбой входа GitHub, о котором сообщила фича,
   всегда даёт critical-строку.
3. Ticket 04 ([Code story](worfy-auth-check/stories/04-иконка-palette-и-вид-строк.md), раздел 3): «светлый жёлтый
   `#A87F00` выбран ради контраста ≥ 3:1 с sidebar — это не записано владельцем». Цвет жёлтой точки в светлой теме.
4. Ticket 04 (там же, раздел 5): «Так решено без владельца, чтобы строки не уходили из своих групп». Порядок «critical,
   non-critical, ok» строгий внутри группы, а не по всему списку: `ok`-строка Harness может стоять выше жёлтой строки jq.
5. Ticket 08 ([Code story](worfy-auth-check/stories/08-сбои-codex-browser-и-link.md), раздел 3): «решение без владельца —
   без `CODEX_HOME` и в сборке без Codex строки нет». Кто не запускал Codex, не видит жёлтой точки. Уточнение ревью:
   папка по умолчанию `~/.codex` тоже считается, с ней и без входа точка жёлтая.
6. Ticket 08 (ревью PR #2030 в той же Code story, раздел 11): «"Sign in to Codex…" holds no action lock… The report
   lists this as a decision made without the owner». Повторные щелчки могут начать несколько входов Codex.
7. Ticket 09 (Ticket, «Итог», «Расхождение тикета с кодом»): «Amendment и ADR-0109 записаны по коду». Пустой
   `github.account` даёт жёлтую non-critical строку всякий раз, когда gh работает своим токеном — из переменной или из
   keyring, — а не только из переменной, как в spec.
8. Ticket 09 (там же, «Повторная проверка»): «ADR-0109 записан по коду». Сама перепроверяется (после сбоя фичи и при
   фокусе окна) только строка GitHub access; строки Machine ждут «Check again».

Известно, не входит в приёмку: английские страницы `docs/features/onboarding.md` («Codex has no row») и
`docs/features/gate-and-github.md` («A notice for that is a later Ticket (worfy-auth-check 08)») отстали от кода — это
нашёл Ticket 09.

Результат — в Ticket `worfy-auth-check` 10, «Итог»; Status spec-а.

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
   задачу (в `~/.claude/scheduled-tasks` этой задачи нет, она в самом приложении).
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

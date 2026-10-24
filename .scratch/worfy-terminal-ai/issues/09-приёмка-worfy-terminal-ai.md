# 09 — Приёмка Epic-а worfy-terminal-ai по «Готово, когда» и live-проверка владельца на подписке

Type: task
Status: blocked 2026-10-19T15:38Z
Blocked reason: live-проверка 2026-10-19 прошла не целиком: дефекты — Ticket 16; не измерены 10 замеров Suggestion и thinking Sonnet; не прогнаны приватность с fake и gate full
Waits: agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 16
Source: «Готово, когда» Epic-а worfy-terminal-ai ([spec.md](../spec.md)); решения владельца 2026-10-09, пункт 7 (test-ы без расхода подписки, одна live-проверка владельца в конце), пункты 1–5 ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md); [evidence spike-а](../evidence/spike-задержки-2026-10-09.md) — цифры, с которыми сравнивать

## Что происходит

- К claim Ticket-ы 01–08 влиты. Каждый проверен unit-, contract- и e2e-test-ами на fake assist:
  подписка не тратилась ни разу (spec, «Соглашения»).
- Вживую на подписке Terminal AI не проверял никто. Spike 2026-10-09 мерил опции assist-процесса
  отдельным скриптом, без worfy.
- Что показывает worfy: Limits — `LimitsMeter` в toolbar-е (`src/renderer/shell/toolbar/LimitsMeter.tsx`);
  строка лога при старте assist-процесса — версия Claude Code, модель, `apiKeySource`, plugin-ы из
  `init` (Ticket 02).
- Dev-сборка не ведёт Autopilot над репозиторием worfy, Stable copy — ведёт. Для этой проверки
  Autopilot не нужен: подойдёт Stable copy с влитыми 01–08 (`pnpm install:stable`) или `pnpm dev`.

## Что делаем

1. Владелец ставит Stable copy из `origin/main` с влитыми 01–08 или запускает `pnpm dev` того же
   коммита — без `WORFY_AGENT=fake`, на своей подписке.
2. Проходит пункты ниже в Terminal Node-е на своём zsh. Orchestrator готовит шаги и собирает цифры,
   нажимает и смотрит владелец.
3. Найденный дефект — новый Ticket Epic-а, его номер дописывается в `Blocked by` этого.
4. В `spec.md` отмечает пункты «Готово, когда» Epic-а со ссылкой на «Итог» этого Ticket-а.

Autopilot этот Ticket не берёт: с этого docs-PR он лежит в `blocked` (как Ticket 16 Epic-а
`worfy-harness`). Когда 01–08 влиты и владелец готов, Orchestrator по его слову ставит `Status: open`.

## Готово, когда

Пункт 1 Epic-а — Suggestion.

- [x] (вручную) Префикс команды из истории — серый остаток сразу; →, Option+→, Esc работают.
- [ ] (вручную) Строка, которой нет в истории, — через паузу серый ответ Haiku. Время до серого текста в 10 попытках — в «Итог» (spike: первый токен ~1,3 с). Набор во время ожидания — старый ответ не появляется. *(2026-10-19: ответ Haiku работает по словам владельца. 2026-10-24: 10 замеров сделаны, цифры — в «Итог». Набор во время ожидания не проверяли — пункт открыт.)*
- [x] (вручную) Тот же Terminal во втором окне worfy показывает тот же серый текст.
- [x] (вручную) История как раньше: стрелка вверх в новом Terminal-е worfy показывает команды прошлых сеансов; команда, набранная в worfy, после выхода из shell-а видна в `~/.zsh_history` (`tail -1 ~/.zsh_history` в Terminal.app); `$HISTFILE` в Terminal-е worfy и в Terminal.app одинаковый.

Пункт 2 — Next command, Command request, Fix.

- [x] (вручную) После `git status` в репозитории на пустой строке появляется Next command; Enter на пустой строке его не запускает.
- [x] (вручную) `# find files bigger than 100 MB changed this week` + Enter и та же просьба в панели ⌘I — в строке команда; не запущена, пока владелец не нажал Enter.
- [x] (вручную) `ls /nonexistent` → «Fix» → в строке исправленная команда; не запущена.

Пункт 3 — процесс и Limits.

- [x] Команда: `ps -o pid,rss,command -p <pid>` по pid из строки лога — один процесс `claude` assist-а (кроме процессов Session-ов), RSS — в «Итог»; после 10 минут без запросов его нет.
- [x] Команда: строка лога assist-процесса — `apiKeySource` `none`, модель Suggestion — haiku без thinking (`option_not_applied` нет), нет plugin-ов пользователя; есть ли hooks у встроенных plugin-ов Claude Code — записать в «Итог» (по `init` и `claude --debug`, если `init` их не сообщает).
- [x] (вручную) Next command, Command request и Fix на Sonnet с `effort: 'low'`: были ли блоки thinking и как это сказалось на времени ответа — в «Итог» (у Sonnet 5.5 thinking не выключается). *(2026-10-19: не измерено. 2026-10-24: 9 ответов, блоков thinking нет ни в одном.)*
- [x] Команда: список папок `~/.claude/projects` до и после проверки одинаков — транскриптов нет; в `~/.claude/sessions` нет записи assist-процесса с `cwd` в Project-е; на Canvas нет нового Session Node-а. *(2026-10-19: `projects` — да; записи assist-а с `cwd` в Project-е нет, но регистрация в `sessions/` есть — Ticket 16; Canvas отдельно не проверяли. 2026-10-24: все три части — да, подробности в «Итог».)*
- [x] (вручную) `LimitsMeter` обновился после запросов Terminal AI (время показаний свежее).
- [x] Contract-test-ы порогов Limits Ticket-а 02 (`test/unit/terminal-ai-limits-gate.test.ts`, `test/contract/terminal-ai-assist.test.ts`) зелёные: живой упор в 80 % на подписке не устраивается.

Пункт 4 — приватность.

- [x] Команда: тот же сценарий с `WORFY_AGENT=fake` и `WORFY_TERMINAL_AI_LOG` — в журнале нет переменных окружения; `export GITHUB_TOKEN=ghp_…` из истории — `[redacted]`; во время `sudo -k; sudo true` (запрос пароля) запросов нет; в `less` — нет; ` echo secret` (пробел в начале) — нет. *(2026-10-24: `sudo` на этом Mac пароля не спросил, запрос пароля проверен заменой — `getpass` из Python; подробности в «Итог».)*
- [x] Команда: `shasum ~/.zshrc` до и после — одинаковый.

Пункт 5 — Settings и test-ы.

- [x] (вручную) Settings → «Terminal AI»: выключение каждой функции работает сразу; «Terminal AI» выключен — ни серого текста, ни запросов.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full — exit 0; в выводе test-ов нет запусков настоящего Claude Code (под vitest настоящая фабрика бросает).

Цифры и ответы — в `../evidence/09-live-проверка.md`: время ответа по функциям, RSS, Limits до и после,
три примера ответов каждой функции. Секретов и личных данных там нет.

## Тесты

Новых test-ов нет: к claim всё, что проверяется, уже влито и покрыто test-ами Ticket-ов 01–08. Если
пункт не проходит — дефект одного из них, новый Ticket (пункт 3 раздела «Что делаем»).

## Где в коде

- `.scratch/worfy-terminal-ai/spec.md`
- `.scratch/worfy-terminal-ai/evidence/09-live-проверка.md` (новый)

## Итог

Второй промежуточный, 2026-10-24: замеры на Stable copy `46d53eb3`, Ticket не закрыт.

Владелец 2026-10-24: «можешь замерять это сам». Замеры сделал Orchestrator на Stable copy владельца,
на его подписке, по его просьбе. Цифры, ответы и журнал приватности —
[`../evidence/09-live-проверка.md`](../evidence/09-live-проверка.md), раздел «2026-10-24».

- Suggestion (Haiku), 10 попыток: до серого текста медиана 2028 мс (1906–3330). Первый токен —
  медиана 1360 мс от последней клавиши (spike: ~1,3 с). Thinking нет.
- Sonnet с `effort: 'low'`, 9 ответов: блоков thinking нет ни в одном. Медианы до ответа в строке:
  Next command 2879 мс (из них ~800 мс — пауза перед запросом), Command request 2173 мс, Fix 1928 мс.
- Assist-процесс в каждый момент один, RSS 216 MB.
- `~/.claude/projects` до и после — тот же список, 61 папка. В `~/.claude/sessions` сменилась только
  запись Session-а, который Stable продолжает при запуске (`--resume`, модель opus, `cwd` в Project-е):
  pid 45300 → 81881. Записи assist-процесса нет. На Canvas нового Session Node-а нет: временный
  Terminal Node закрыт, узлы и viewport те же.
- Limits: `test/unit/terminal-ai-limits-gate.test.ts` и `test/contract/terminal-ai-assist.test.ts`
  отдельно — 2 файла, 52 test-а, exit 0.
- gate full с `GATE_SCOPE=all` на `main` `a3f95bbf` — green (lint, typecheck, test, test:e2e,
  test:package), exit 0. Запусков настоящего Claude Code в выводе test-ов нет.
- Приватность — `WORFY_AGENT=fake`, `WORFY_TERMINAL_AI_LOG`, отдельная сборка `a3f95bbf`, временные
  `HOME` и `HISTFILE` с ненастоящим `GITHUB_TOKEN` в истории. Переменных окружения в журнале нет.
  Токен — только `[redacted]`. В `less` и для ` echo secret` запросов нет. `sudo -k; sudo true` пароля
  на этом Mac не спросил (по всей видимости, Touch ID или настройка sudo). Поэтому запрос пароля
  проверен заменой — `getpass` из Python: пока он ждал ввода, запросов не было. `shasum` у `~/.zshrc`
  и `~/.zsh_history` владельца до и после одинаковый.
- zsh-autosuggestions у владельца не установлен: проверка совместимости с ним не применима, не
  выполнена.

Находка, решение владельца не принято. Ответ попадает на экран только после выхода вспомогательного
процесса `claude` — через 530–760 мс после того, как ответ готов. `attempt()` в
`src/main/terminal-ai/assist.ts` ждёт конца stream-а, а не сообщения `result`. Если брать ответ на
`result`, медиана Suggestion стала бы ~1,44 с. То же у Next command, Command request и Fix.

Открыто до закрытия Ticket-а:

- Suggestion: набор во время ожидания ответа Haiku — старый ответ не появляется — не проверяли.
- Решение владельца по находке про ожидание выхода процесса.
- Отметки в `spec.md`.

Промежуточный, 2026-10-19: live-проверка прошла, Ticket не закрыт.

Stable copy из `main` `e61cb1fe`, подписка владельца. Цифры и подсчёты —
[`../evidence/09-live-проверка.md`](../evidence/09-live-проверка.md).

Владелец: «Проверил терминал, все впорядке». Это ручные пункты: Suggestion из истории и от Haiku,
второе окно, история и `$HISTFILE`, Next command, Command request и ⌘I, Fix, `LimitsMeter`, Settings.
Время до серого текста в 10 попытках и пункт о thinking у Sonnet владелец не сообщал — **не
измерены**, оба пункта открыты.

Команды Orchestrator-а:

- Лог Stable copy: 17 строк init assist-процесса — 8 с моделью `claude-haiku-4-5-20251001`
  (Suggestion), 9 с `claude-sonnet-5-5` (5 Next command, 4 Command request). Во всех
  `apiKeySource none`; plugin-ы — только встроенные в Claude Code `cc-plugin-agents-md`,
  `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`, plugin-ов пользователя нет; hooks — «not
  reported by init» (`claude --debug` не запускали). `option_not_applied`, отказов claim и сбоев нет.
  Строк `fix:` в снимке лога нет, хотя владелец проверял Fix: расхождение записано, не разобрано.
- Процесс: assist-процесс в каждый момент один, spare — 60702, RSS 218 MB. После 10 минут без запросов
  его нет: в 18:30 и 18:36 у worfy только один ребёнок `claude`.
- `~/.claude/projects` до и после одинаков — транскриптов нет. `shasum ~/.zshrc` до и после одинаковый.
- `~/.claude/sessions`: записи assist-процесса с `cwd` в Project-е нет.

Два дефекта, записанные во время проверки, разобраны в Ticket-е
[16](16-assist-процесс-в-списке-сессий-claude-code.md). Оба наблюдения — про Session worfy 52480, не
про assist: `--model opus`, `--resume`, `--add-dir` папки cards. Его `52480.json` с `cwd` в Project-е
и жизнь 45+ минут для Session-а нормальны. Что осталось настоящего:

1. Claude Code регистрирует assist-процесс в `~/.claude/sessions`. `persistSession: false` этого не
   выключает. Spare публикует `<pid>.key` и messaging socket. При claim пишется `<pid>.json` с `cwd`
   `<WORFY_DATA_DIR>/terminal-ai`, он живёт до выхода процесса. Вживую `<pid>.json` assist-а не пойман.
2. `src/main/terminal-ai/assist.ts:440-442`: отмена в узком окне между `take()` и `abortable()`
   оставляет spare вне слота и без закрытия.

Открыто до закрытия Ticket-а:

- Ticket 16.
- 10 замеров Suggestion и thinking Sonnet — нужен владелец.
- «Нет нового Session Node-а на Canvas» отдельно не проверяли.
- Сценарий приватности с `WORFY_AGENT=fake` и `WORFY_TERMINAL_AI_LOG`.
- Contract-test-ы порогов Limits, `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate full.
- Отметки в `spec.md`.

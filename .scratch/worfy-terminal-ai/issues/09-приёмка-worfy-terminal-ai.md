# 09 — Приёмка Epic-а worfy-terminal-ai по «Готово, когда» и live-проверка владельца на подписке

Type: task
Status: blocked
Blocked reason: live-проверка владельца — утром 2026-10-17 через pnpm dev; Autopilot не берёт
Waits: owner
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08
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

- [ ] (вручную) Префикс команды из истории — серый остаток сразу; →, Option+→, Esc работают.
- [ ] (вручную) Строка, которой нет в истории, — через паузу серый ответ Haiku. Время до серого текста в 10 попытках — в «Итог» (spike: первый токен ~1,3 с). Набор во время ожидания — старый ответ не появляется.
- [ ] (вручную) Тот же Terminal во втором окне worfy показывает тот же серый текст.
- [ ] (вручную) История как раньше: стрелка вверх в новом Terminal-е worfy показывает команды прошлых сеансов; команда, набранная в worfy, после выхода из shell-а видна в `~/.zsh_history` (`tail -1 ~/.zsh_history` в Terminal.app); `$HISTFILE` в Terminal-е worfy и в Terminal.app одинаковый.

Пункт 2 — Next command, Command request, Fix.

- [ ] (вручную) После `git status` в репозитории на пустой строке появляется Next command; Enter на пустой строке его не запускает.
- [ ] (вручную) `# find files bigger than 100 MB changed this week` + Enter и та же просьба в панели ⌘I — в строке команда; не запущена, пока владелец не нажал Enter.
- [ ] (вручную) `ls /nonexistent` → «Fix» → в строке исправленная команда; не запущена.

Пункт 3 — процесс и Limits.

- [ ] Команда: `ps -o pid,rss,command -p <pid>` по pid из строки лога — один процесс `claude` assist-а (кроме процессов Session-ов), RSS — в «Итог»; после 10 минут без запросов его нет.
- [ ] Команда: строка лога assist-процесса — `apiKeySource` `none`, модель Suggestion — haiku без thinking (`option_not_applied` нет), нет plugin-ов пользователя; есть ли hooks у встроенных plugin-ов Claude Code — записать в «Итог» (по `init` и `claude --debug`, если `init` их не сообщает).
- [ ] (вручную) Next command, Command request и Fix на Sonnet с `effort: 'low'`: были ли блоки thinking и как это сказалось на времени ответа — в «Итог» (у Sonnet 5.5 thinking не выключается).
- [ ] Команда: список папок `~/.claude/projects` до и после проверки одинаков — транскриптов нет; в `~/.claude/sessions` нет записи assist-процесса с `cwd` в Project-е; на Canvas нет нового Session Node-а.
- [ ] (вручную) `LimitsMeter` обновился после запросов Terminal AI (время показаний свежее).
- [ ] Contract-test-ы порогов Limits Ticket-а 02 (`test/unit/terminal-ai-limits-gate.test.ts`, `test/contract/terminal-ai-assist.test.ts`) зелёные: живой упор в 80 % на подписке не устраивается.

Пункт 4 — приватность.

- [ ] Команда: тот же сценарий с `WORFY_AGENT=fake` и `WORFY_TERMINAL_AI_LOG` — в журнале нет переменных окружения; `export GITHUB_TOKEN=ghp_…` из истории — `[redacted]`; во время `sudo -k; sudo true` (запрос пароля) запросов нет; в `less` — нет; ` echo secret` (пробел в начале) — нет.
- [ ] Команда: `shasum ~/.zshrc` до и после — одинаковый.

Пункт 5 — Settings и test-ы.

- [ ] (вручную) Settings → «Terminal AI»: выключение каждой функции работает сразу; «Terminal AI» выключен — ни серого текста, ни запросов.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full — exit 0; в выводе test-ов нет запусков настоящего Claude Code (под vitest настоящая фабрика бросает).

Цифры и ответы — в `../evidence/09-live-проверка.md`: время ответа по функциям, RSS, Limits до и после,
три примера ответов каждой функции. Секретов и личных данных там нет.

## Тесты

Новых test-ов нет: к claim всё, что проверяется, уже влито и покрыто test-ами Ticket-ов 01–08. Если
пункт не проходит — дефект одного из них, новый Ticket (пункт 3 раздела «Что делаем»).

## Где в коде

- `.scratch/worfy-terminal-ai/spec.md`
- `.scratch/worfy-terminal-ai/evidence/09-live-проверка.md` (новый)

## Итог

Заполняется при закрытии.

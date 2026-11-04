# 09 — Правила агента и PreToolUse hook по данным 01

Type: task
Status: done 2026-11-04T15:39Z
PR: #1374
Blocked by: 01
Source: [spec.md](../spec.md), «Данные прошлых ночей»; Q8; Ticket 01, п. 3

Глубина ревью: high (hook меняет команды агента до проверки Claude Code).

## Что происходит

- Правило «Shell commands without a confirmation» (`harness/hooks/rules/common.md:80`, с 2026-10-20) просит удалять по
  буквальному пути и выносить многострочные скрипты в файл; агенты его иногда не выполняют.
- Guard Harness-а (`harness/hooks/guard.mjs`, PreToolUse на Bash) только запрещает.
- Вопросы (AskUserQuestion) в Autopilot — почти половина отказов; правила «в Autopilot не спрашивай» нет.

## Что делаем

По таблице Ticket-а 01, только категории с решением «правило агента» или «hook»:

1. **Правило агента** — абзац в `common.md` (английский, ADR-0074): что делать вместо вопроса в unattended Run-е
   (решить по правилам или записать в «Вопросы владельцу» Ticket-а), и уточнения существующего правила по данным.
2. **PreToolUse hook**, если Ticket 01 подтвердил `updatedInput`: переписать узнаваемый шаблон в форму, которую
   Claude Code не останавливает, — только шаблоны, которые Ticket 01 показал безопасными (например, многострочный
   `zsh -c '…'` → тот же скрипт в файле scratchpad-а и `zsh -f <файл>`, как велит правило). Иначе — `deny` с текстом,
   как переписать, до проверки Claude Code: агент сразу получает правильную подсказку.
3. Если Ticket 01 не отнёс к этим решениям ни одной категории — Ticket закрывается без кода, с записью в «Итог».

## Готово, когда

- [ ] Не относится к этому Ticket-у: hook-а нет — Ticket 01 не отнёс к решению «PreToolUse hook» ни одной категории
      (spec.md, «Данные прошлых ночей»). Было: test hook-а на каждый шаблон — переписанная команда делает то же, что
      исходная (во временной папке), или hook отказывает с подсказкой.
- [ ] PR Harness-скриптов ждёт Windows (ADR-0056): `ci-ok` с Windows job-ами зелёный.
- [ ] `pnpm lint`, `pnpm test` — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 014b732cd0d05cf2b42081acf333ebb6086af490
  - evidence: gate pass · `gate fast` exit 0 · mac - · 014b732cd0d05cf2b42081acf333ebb6086af490
  - evidence: gate pass · `gate fast` exit 0 · mac - · 702db2d27c2273e7c014bb27d063b8b1fb7c98ad

## Тесты

- `harness/hooks/tests/guard-rewrite.test.sh` (новый, в форме `guard-silent.test.sh`).

## Где в коде

- `harness/hooks/rules/common.md`
- `harness/hooks/guard.mjs`
- `harness/hooks/hooks.json`
- `harness/hooks/tests/guard-rewrite.test.sh`

## Итог

Только правила агента, без кода hook-а: Ticket 01 не отнёс к решению (в) «PreToolUse hook» ни одной категории
(spec.md, «Данные прошлых ночей»; «Итог» Ticket-а 01). `guard.mjs`, `hooks.json` не тронуты,
`guard-rewrite.test.sh` не заведён — проверять в нём нечего; первый пункт «Готово, когда» к этому Ticket-у не
относится.

- `harness/hooks/rules/common.md`, раздел «Shell commands without a confirmation», по категориям переписи:
  `rm-var-target` — `rm` в цикле или условии: цели не вычислить, назвать каждую в одном `rm`;
  `multiline-c-script` — скрипт, отданный shell-у через here-document, — тоже inline-скрипт, его — в файл;
  AskUserQuestion — абзац: без человека вопрос отклоняется; решать по правилам Project-а, записанным решениям и
  брифу; выбор, который может сделать только пользователь, — вопросом в Ticket, работа, которую он не держит, идёт
  дальше. `rm-after-cd-glob` — правило уже было, не менялось.
- Из вступления раздела убрано «such as the worfy Autopilot»: текст plugin-а нейтрален, и так влезло в предел
  стартового контекста implementer-а (`harness/bin/tests/start-context.test.sh`, 15 000): теперь 14 998 — запаса
  почти нет, следующая прибавка к `common.md` или к skill `ship-ticket` потребует сокращения.

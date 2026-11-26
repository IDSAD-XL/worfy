# 160 — Правила `orchestrator.md` у предела 10 000 знаков: разделы «по случаю» — в skill, в файле — ссылки

Type: task
Status: claimed 2026-11-26T19:53Z
Branch: worfy-polish/160
Blocked by: —
Source: решение владельца 2026-11-26 — polish-Ticket, который выносит разделы файла в skill и оставляет в файле ссылки.

Кто: агент.

## Что происходит

`harness/hooks/rules/orchestrator.md` — правила Orchestrator-а (главной Session), которые hook
`harness/hooks/inject-rules.mjs` вставляет в каждую главную Session. Claude Code обрезает одну такую вставку
(`additionalContext`) до превью выше 10 000 знаков, и test правил это держит:

- `harness/hooks/tests/rules-hooks.test.sh:34` — `LIMIT=10000`;
- `harness/hooks/tests/rules-hooks.test.sh:126-129` — каждая часть с длинным корнем плагина (`LONG_ROOT`, `:36`)
  укладывается в `LIMIT`.

После Ticket-а 157 файл — 9 992 знака из 10 000 с длинным корнем. Следующая правка правил сделает test красным.

Большая часть файла нужна в каждом ходе: цикл по умолчанию, закрытый список «своими руками», список «делегировать»,
контракт subagent-а, четырёхстрочный блок статуса. Другие разделы нужны только в свой момент:

- «Quota» — перед фазой и на пятом файле, который Orchestrator правит сам;
- «Long output: filter first, delegate second» — перед прогоном test-ов, сборки, linter-а или `land`;
- подробности «Phase 3»: абзацы «Ticket status moves through …», файл состояния, «state file vs ADR».

## Что строить

1. Разделы «по случаю» переезжают в skill плагина без изменения смысла. Сначала проверить, подходит ли
   существующий skill (`harness/skills/ship-ticket`, `epic-wave`, `writing-for-agents`); новый — только если ни один
   не подходит, в формате существующих (`SKILL.md` с `name` и `description`).
2. В `orchestrator.md` на месте каждого раздела — одна строка-ссылка: имя skill-а, раздел и когда его читать.
   Заголовки «Quota» и «Long output: filter first, delegate second» остаются: по заголовкам правил плагина перенос
   старого Harness (`src/main/harness/migrate/plan.ts:61-77`, `pluginRuleHeadings`) решает, что раздел личного
   `CLAUDE.md` уже несёт плагин.
3. В файле остаётся всё, что нужно в каждом ходе. Предел test-а не поднимается.
4. Файлы, которые цитируют или проверяют перенесённые разделы, правятся вместе с ними: test-ы правил и текстов
   (`harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/tests/agents-text.test.sh`), карта eval-ов
   (`harness/evals/lib/coverage.json`), страница возможностей (`docs/features/skills-agents-and-hooks.md`).
5. Текст Harness — только по-английски (ADR-0074).

## Где в коде

- `harness/hooks/rules/orchestrator.md` — разделы «Quota» (`:74-85`), «Long output» (`:87-94`), «Phase 3»
  (`:145-172`: статус Ticket-а, файл состояния, журнал решений Wave, файл состояния и ADR).
- `harness/skills/` — новый или существующий skill, куда переезжают разделы.
- `harness/hooks/tests/rules-hooks.test.sh` — `:34` предел, `:585-615` «No rule lost» (темы правил), `:641-650` журнал
  решений Wave рядом с правилом о втором файле состояния.
- `harness/bin/tests/agents-text.test.sh:743-749` — раздел «Long output» о выводе `land`.
- `harness/evals/lib/coverage.json` — каждый файл правил плагина отнесён к case-у eval-а или к причине.
- `test/contract/harness-migrate.test.ts:113-124` — список skill-ов `harness/skills/`, которых не было у старого Harness
  (новый skill входит в него).
- `docs/features/skills-agents-and-hooks.md` — таблица skill-ов и абзац «Rules».
- `src/main/harness/migrate/plan.ts:61-77` — заголовки старого `CLAUDE.md`, которые несёт плагин (код не меняется).
- [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md) — Harness без языка и без проекта.

## Решения

- Тексты Harness — правила для моделей; перенос не меняет поведения кода, поэтому eval-ы не нужны.
- Предел 10 000 — свойство Claude Code, а не настройка: его не поднимают.

## Test-ы

- `bash harness/hooks/tests/rules-hooks.test.sh` — exit 0: каждая тема правил на месте (в файле или в skill-е), каждая
  ссылка ведёт к разделу skill-а.
- `bash harness/bin/tests/agents-text.test.sh`, `bash harness/bin/tests/start-context.test.sh` — exit 0.
- Contract test-ы плагина и eval-ов (`test/contract/harness-*.test.ts`) — exit 0.

## Готово, когда

- [ ] `orchestrator.md` — около 7 500 знаков или меньше; в отчёте — число до и после и команда счёта.
  - evidence: commit pass · worfy-polish/160: move the orchestrator rules needed at one moment into skill orchestrator-rules · - - · d4a44e81be915a8ba4c56a180183ce8c4252bef2
- [ ] Перенесённые разделы лежат в skill-е без изменения смысла; на месте каждого в `orchestrator.md` — строка с
      именем skill-а и раздела; test-ы проверяют, что ссылки ведут к существующим разделам.
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · d4a44e81be915a8ba4c56a180183ce8c4252bef2
- [ ] Файлы, которые цитируют перенесённые разделы (test-ы, `coverage.json`, страница возможностей), обновлены.
  - evidence: commit pass · worfy-polish/160: move the orchestrator rules needed at one moment into skill orchestrator-rules · - - · d4a44e81be915a8ba4c56a180183ce8c4252bef2
- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` и `bash harness/bin/tests/agents-text.test.sh` — exit 0.
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · d4a44e81be915a8ba4c56a180183ce8c4252bef2
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · d4a44e81be915a8ba4c56a180183ce8c4252bef2

## Итог

- Новый skill `worfy:orchestrator-rules` (`harness/skills/orchestrator-rules/SKILL.md`) несёт дословно пять разделов
  прежнего `orchestrator.md`: «Quota», «Long output: filter first, delegate second», «Ticket status», «State file»
  (с журналом решений Wave), «State file vs ADR». Существующие skill-ы не подошли: `ship-ticket` — про один Ticket, и
  каждый файл рядом с его `SKILL.md` должен называться из самого `SKILL.md` (`start-context.test.sh`); `epic-wave` —
  про Wave; эти правила нужны и вне Ticket-а и Wave.
- В `orchestrator.md` заголовки «Quota» и «Long output» остались, под каждым — строка-ссылка; в «Phase 3» каждое из
  трёх правил (статус Ticket-а через `bin/ticket`, «задача не закончена без файла состояния», «файл состояния и ADR —
  разные документы») осталось предложением со ссылкой на раздел skill-а.
- Счёт знаков (`[...text].length`, как в test-е; вставка — вывод `inject-rules.mjs orchestrator` с длинным корнем
  test-а): до — 9 572 в файле и 9 991 во вставке; после — 7 114 и 7 533.
- `rules-hooks.test.sh`: темы правил ищутся в частях и в skill-е вместе; новая проверка — множество ссылок
  `orchestrator.md` совпадает с разделами skill-а, три заголовка на месте. `agents-text.test.sh` читает «Long
  output» из skill-а; `coverage.json` относит skill к причине без case-а; `harness-migrate.test.ts` знает новый skill.

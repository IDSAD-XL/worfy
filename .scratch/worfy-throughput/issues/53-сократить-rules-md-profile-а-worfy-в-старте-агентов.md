# 53 — Сократить `rules.md` Profile-а worfy в старте агентов

Type: task
Status: open
Blocked by: 33
Source: [spec.md](../spec.md), раздел «Ответы владельца 2026-10-29, раунд 2», ответ R2-Q7; Ticket
[33](33-сократить-стартовый-контекст-ниже-порога.md) (порог стартового контекста считает только части Harness).

## Что происходит

- Каждый агент Harness на старте читает вывод `bin/profile`: `profile.json` и весь `rules.md` Profile-а worfy
  (`harness/bin/profile:493-494`, `:536-538`). `rules.md` Profile-а worfy — 23 246 B
  (`$HARNESS_HOME/projects/worfy/rules.md`, 2026-10-29), около 10,6k token-ов в старте каждого агента.
- Замер implementer-а 2026-10-29 — 68,8k token-ов, из них 34k — постоянные части вне контроля Harness:
  константа Claude Code, вывод Profile, `CLAUDE.md`/`MEMORY.md`, бриф. По решению R2-Q7 они не входят в порог
  15 000 token-ов (Ticket 33), но `start-context` показывает их отдельно. `rules.md` — самая большая из них,
  которую можно сократить без правки Claude Code.
- Разделы `rules.md` по байтам (2026-10-29): «Команды существуют только после тикета 01» — 10 995;
  «Глубина ревью (решение владельца 2026-10-12)» — 2 899; «Sources» — 1 685; «Решения, которые нельзя
  нарушить» — 1 517; «ADR» — 1 290; «Тикеты, ветки, worktree» — 1 034; «Документы» — 1 024; «Harness во время
  E3» — 913; «Gate» — 781; «Язык» — 729; вступление — 379.
- Раздел `## Sources` нужен тому, кто сопровождает Profile, а не агенту (`harness/profiles/README.md:504-507`).
  Hook начала Session его выбрасывает (`harness/hooks/session-start.mjs:186`), а `bin/profile` печатает
  агентам `rules.md` целиком, вместе с ним (`harness/bin/profile:494`, `:538`).
- Механизм чтения по запросу уже есть в контракте Profile: «`rules.md` is not a reading list. The agent opens
  the paths in it only when the task needs them» (`harness/profiles/README.md:499`). Обязательное чтение для
  implementer-а — только под заголовком `## Required reading for the implementer` (`:500-502`). Отдельного
  поля Profile для такого файла нет; в раскладке папки Profile (`harness/profiles/README.md:27-37`) его тоже
  нет.

## Что делаем

1. Разобрать разделы `rules.md`: какие нужны агенту на каждом шаге, какие — только на одном шаге (например,
   при записи ADR, при review определённой глубины, при работе с командами до тикета 01).
2. Части, нужные только на одном шаге, — в отдельный файл рядом с `rules.md` в папке Profile. `rules.md` его
   называет одной строкой: путь и шаг, на котором агент его читает. Так работает механизм
   `harness/profiles/README.md:499`, без нового поля.
3. Если механизма строки в `rules.md` мало (агент на нужном шаге файл не открывает), — предложить поле
   контракта Profile, например список файлов «читать на шаге X» в `profile.json`, с правкой
   `harness/profiles/README.md`, schema и `bin/profile`. Решение — по замеру, не заранее.
4. `bin/profile` не печатает агентам раздел `## Sources` — как hook начала Session
   (`harness/hooks/session-start.mjs:186`). Это код Harness, правка в этом Ticket-е.
5. `rules.md` — файл владельца вне репозитория. Ticket его не меняет: в «Итог» — предложенный diff
   `rules.md` и текст нового файла по запросу. Владелец принимает правку сам.

Нужен ПК: нет. Трогает Harness: только если нужен код — `harness/bin/profile` (пункт 4), контракт Profile
(`harness/profiles/README.md`, schema; пункт 3). Слово владельца на правки Harness — решение 1 раздела
«процесс» и ответ на Q-L0. Вердикт Windows: не платформенный PR, если не меняются скрипты `harness/bin`
(test-ы в `harness/bin/tests/` не в счёт); иначе runner `full` в `ci-ok` (ADR-0056, пункт 2).

## Готово, когда

- [ ] «Итог»: `harness/bin/start-context` показывает часть Profile implementer-а, reviewer-а, scout-а и
      verifier-а до и после предложенной правки (после — на копии Profile с предложенным `rules.md`, через
      `--profile <path>`).
- [ ] «Итог»: предложенный diff `rules.md` и текст файла по запросу; каждая перенесённая часть называет шаг, на
      котором агент её читает.
- [ ] Если меняется `bin/profile`: shell test — вывод `bin/profile` не содержит раздел `## Sources` (и его
      русское имя), остальной `rules.md` на месте; `harness/bin/tests/start-context.test.sh` — exit 0.
- [ ] Если меняется контракт Profile: `harness/profiles/README.md` и schema описывают новое поле;
      shell test-ы Profile — exit 0.
- [ ] Shell test-ы Harness — exit 0; `ci-ok` зелёный.

## Где в коде

- `harness/bin/profile` — печать `rules.md` (`:493-494`, `:536-538`)
- `harness/hooks/session-start.mjs` — как выбрасывается `## Sources` (`:183-188`); только читать
- `harness/profiles/README.md` — раздел `## rules.md` (`:492-507`), раскладка папки Profile (`:27-37`)
- `harness/bin/start-context` — часть Profile в замере (`--profile <path>`); только читать
- Вне репозитория, только предложение: `$HARNESS_HOME/projects/worfy/rules.md`

## Вне скоупа

- Части Harness — файлы агентов, skill старта, `common.md`: Ticket 33.
- `CLAUDE.md`, `MEMORY.md` и бриф — не тексты Harness.
- Правила пользователя `$HARNESS_HOME/user/rules.md` — не сокращаются (Ticket 33, правка 2026-10-28).

## Итог

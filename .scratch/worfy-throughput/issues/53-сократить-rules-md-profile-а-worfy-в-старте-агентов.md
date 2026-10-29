# 53 — Сократить `rules.md` Profile-а worfy в старте агентов

Type: task
Status: claimed 2026-10-29T11:18Z
Branch: worfy-throughput/53
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
      verifier-а до и после предложенной правки. Оба замера — без `--profile`: тогда `start-context` считает
      вывод `bin/profile` (`harness/bin/start-context:215-220`), и экономия пункта 4 (без `## Sources`) в нём
      видна. «После» — с `HARNESS_HOME`, указывающим на копию папки Harness с предложенным `rules.md`
      (`bin/profile` находит Profile через `HARNESS_HOME`, `harness/bin/profile:109-112`). Режим
      `--profile <path>` для этого замера не годится: он читает `rules.md` с диска целиком, с `## Sources`
      (`harness/bin/start-context:206`, `:213`).
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
- `harness/bin/start-context` — часть Profile в замере (вывод `bin/profile`, `:215-220`); только читать
- Вне репозитория, только предложение: `$HARNESS_HOME/projects/worfy/rules.md`

## Вне скоупа

- Части Harness — файлы агентов, skill старта, `common.md`: Ticket 33.
- `CLAUDE.md`, `MEMORY.md` и бриф — не тексты Harness.
- Правила пользователя `$HARNESS_HOME/user/rules.md` — не сокращаются (Ticket 33, правка 2026-10-28).

## Итог

Две части: код Harness в этом PR и предложенная правка `rules.md` Profile-а worfy. Правку `rules.md` применяет
владелец; Ticket настоящий файл (`~/.claude/worfy-harness/projects/worfy/rules.md`) не менял.

**Код (пункт 4).** `bin/profile` больше не печатает агентам раздел `## Sources` (и старое русское имя
`## Источники`) — ни в сводке без флагов, ни в `--rules`. Раздел выбрасывается от заголовка до следующего
заголовка `## `, по тому же правилу, что в hook начала Session (`harness/hooks/session-start.mjs:186`).
`harness/profiles/README.md`, раздел `## rules.md`, это называет. Test-ы:
`harness/bin/tests/profile-attribution.test.sh` (два новых случая на Profile `srcs` из
`profile-schema2-world.sh`: раздел в середине с CRLF и раздел под русским именем в конце; остальной текст
сравнивается целиком). Оба случая красные на четырёх mutant-ах: без русского имени, без английского,
без сброса после следующего заголовка, без вызова функции.

**Замер** (`node harness/bin/start-context` без `--profile`, из worktree тикета; часть «bin/profile output»;
у всех четырёх агентов она одинаковая):

| Вариант | Байт | token-ов | Весь старт implementer / reviewer / verifier / scout |
| --- | --- | --- | --- |
| До: код `main` 9e423b99, настоящий `rules.md` (23 352 B) | 28 858 | 10 688 | 49 328 / 32 153 / 32 523 / 25 940 |
| Только код этого PR, настоящий `rules.md` | 27 256 | 10 095 | 48 852 / 31 607 / 31 977 / 25 371 |
| Код этого PR + предложенный `rules.md` (9 667 B) | 13 273 | 4 916 | 43 673 / 26 428 / 26 798 / 20 192 |

«До» — `start-context` из checkout-а `main` (там `bin/profile` ещё печатает `## Sources`). «После» —
`HARNESS_HOME` на копии папки Harness (`gate/config.json`, `user/`, `user.json`, `projects/worfy/` с
предложенным `rules.md` и файлами `rules-*.md`); `bin/profile` нашёл Profile там (первая строка вывода —
`profile: worfy (/tmp/worfy-link-w1/impl-53/harness-home/projects/worfy)`). Остальные части замера в двух
«после» совпали байт в байт. Экономия на каждом старте агента — 5 772 token-а (54 % части Profile), из них
593 — код этого PR. Порог 15 000 (Ticket 33) эти числа не меняют: часть Profile к нему не идёт.

**Предложенный `rules.md`** (`diff -u` настоящего и предложенного: 26 строк добавлено, 130 убрано, 4 hunk-а).
Копии для владельца: `/tmp/worfy-link-w1/impl-53/rules.proposed.md`, файлы по запросу там же
(`rules-*.md`), diff — `/tmp/worfy-link-w1/impl-53/rules.diff`.

- Новый раздел `## Читать на шаге` сразу после вступления: папка Profile-а и пять строк «шаг → файл».
- `## Команды существуют только после тикета 01` стал `## Команды и CI`: остались `pnpm test` под Electron,
  `pnpm test:e2e` со сборкой, `test_one` не задан, сжатое правило CI для implementer-а (условие merge —
  `ci-ok` и `review` на head; gate fast до PR, gate full не нужен; ручной повтор job-а — не путь к merge;
  ручные запуски CI — только владелец) и правило timeout-ов целиком.
- `## Тикеты, ветки, worktree`: убраны список эпиков и фраза тикета 01 про `.gitignore` (перенесены).
- `## Sources`: строка про то, что раздел агентам не печатается, и источник выноса.
- `## Решения, которые нельзя нарушить`, `## Документы`, `## Язык`, вступление — без изменений.

**Файлы по запросу** (рядом с `rules.md`; текст перенесён без изменений, в начале каждого — шаг):

| Файл | Шаг, на котором агент его читает | Что в нём (строки настоящего `rules.md`) | Байт |
| --- | --- | --- | --- |
| `rules-local-e2e.md` | перед любым локальным `pnpm test:e2e` или gate full на Mac | замок `/tmp/worfy-e2e.lock` с командой, проверка экрана (67–88) | 3 760 |
| `rules-merge.md` | merge PR, отметки `review` и `check/windows`, красный `ci-ok`, карантин, платный `eval --changed` | CI по ОС, условие merge и красный `main`, вердикт Windows, платный eval (21–61) | 5 928 |
| `rules-review-depth.md` | Orchestrator выбирает ступень ревью; reviewer, в брифе которого названа ступень | шкала `low`…`max` и правила (90–113) | 3 242 |
| `rules-adr.md` | новый ADR, номер ADR, поправка ADR | формат, номера, `## Amendments` (148–157) | 1 576 |
| `rules-history.md` | Ticket правит `harness/` или пишет в `~/.claude`; правка записи gate; история до тикета 01 | «Команды существуют только после тикета 01» (7–13, 19–20), эпики и `.gitignore` (из 162–163 и 165–166, разбиты на два пункта), «Harness во время E3» (115–122), «Gate» (124–131) | 3 595 |

Проверка полноты: каждая непустая строка настоящего `rules.md` есть дословно в предложенном или в одном из
файлов по запросу, кроме пяти строк: четыре строки эпиков и `.gitignore` в «Тикеты, ветки, worktree» разбиты на пункты
`rules-history.md` и короткий остаток, вступление `## Sources` дополнено (проверка — `grep -qxF` по каждой строке).

**Механизм строки (пункт 3).** Новое поле Profile не предлагаю. Каждая строка «шаг → файл» стоит в выводе
`profile`, который агент читает на старте, и называет шаг, где файл нужен; правило «открывать пути из
`rules.md` только по задаче» (`harness/profiles/README.md:499`) так и работает. Риск — агент, который
запускает локальный e2e и не открыл `rules-local-e2e.md`; поэтому эта строка первая и говорит «без них не
запускать». Проверить на деле можно только после правки владельца: если агент пропустит файл на своём шаге,
нужен список файлов по шагам в `profile.json` (отдельный Ticket).

**Решает владелец** (похоже на устаревшее; Ticket ничего не удалял, только перенёс в `rules-history.md`):
«Команды существуют только после тикета 01» (тикет 01 влит давно, `package.json` есть); раздел «Gate» (запись
gate до тикета 01); «Harness во время E3» (замороженный `~/.claude` до Ticket-а 16, Harness уже plugin);
список эпиков в «Тикеты, ветки, worktree» (нет `worfy-throughput` и других новых).

Применить правку: `cp /tmp/worfy-link-w1/impl-53/rules.proposed.md ~/.claude/worfy-harness/projects/worfy/rules.md`
и `cp /tmp/worfy-link-w1/impl-53/rules-*.md ~/.claude/worfy-harness/projects/worfy/` — только владелец.

# 09 — Долг после review PR #526: user.json, inject-rules и их test-ы

Type: task
Status: done 2026-10-20T06:50Z
PR: #569
Blocked by: 02
Source: ревью PR [#526](https://github.com/IDSAD-XL/worfy/pull/526) (Ticket 01, user personalization —
язык отчётов и личные правила), круг 1: линзы «корректность», «security» и «тесты» (43 мутанта, 20
выжили, все — пробелы test-ов). Все находки — low. Строки перечитаны по main `2af91b51`; часть находок
круг 2 уже закрыл и сюда не входит: длина в code points (`harness/hooks/inject-rules.mjs:88`), BOM и
пустой `user.json` (`harness/bin/profile:285-287`), строка stderr при `budget <= 0`
(`inject-rules.mjs:92-95`), test-ы `user.json` вида `{}`, `""`, `["ru"]`, числа и BOM
(`harness/bin/tests/profile.test.sh:569-600`). Термин **User personalization** в `CONTEXT.md` уже
есть (`:106-109`).

## Что происходит

Каждый пункт ниже — пробел, который ревью нашло и оставило на потом. Один пункт — одна строка
«Готово, когда». `Blocked by: 02` — Ticket 02 переписывает тексты plugin-а (в работе у другой Session),
и правки здесь не должны с ним спорить.

## Что делаем

Закрыть каждый пункт правкой или test-ом. Если пункт оказался не нужен — строка в «Итог» с причиной.

## Готово, когда

- [x] **Квадратичный trim.** `harness/hooks/inject-rules.mjs:85` и `:103`: `replace(/\s+$/, "")` на файле
      с длинным рядом пробелов не в конце работает за квадратичное время (возврат регулярки). Заменить
      на `trimEnd()`.
- [x] **Первая строка длиннее бюджета.** `inject-rules.mjs:97-101`: если первая строка правил длиннее
      оставшегося бюджета, цикл сразу выходит — в сессию уходит только заметка об обрезке, ни одного
      правила, и stderr молчит. Нужна строка stderr (как при `budget <= 0`) или обрезка строки по бюджету.
- [x] **Язык не того типа молча становится `en`.** `harness/bin/profile:269-271`: `language` профиля —
      число, массив или `null` — молча заменяется на `{}`, и все три языка становятся `en`. Одна строка
      stderr с путём профиля, как у сломанного `user.json`.
- [x] **Живые проверки читают настоящий `user.json` владельца.** `harness/bin/tests/profile.test.sh:56`
      («auction language.reports ru») идёт до синтетического `HARNESS_HOME` (`:150-153`) и зависит от
      `$HARNESS_HOME/user.json` того, кто запускает (`user.json` задаёт только `reports`). Запускать её с пустым временным
      `HARNESS_HOME` (реестр — как у остальных живых проверок).
- [x] **Test-ы inject-rules (`harness/hooks/tests/rules-hooks.test.sh`):**
      пробелы в конце файла правил срезаются (сейчас их срезает `$(…)` самого test-а); fixture из 600
      одинаковых ASCII-строк (`:198`) не отличает code points от UTF-16, `continue` от `break` и `>=` от `>`
      — добавить строки с символами вне BMP и разной длины; граница ровно 10 000 (`LIMIT`, `:31`);
      `budget <= 0` с проверкой строки stderr.
- [x] **Test-ы profile:** `language` профиля не объект (число, массив) и `team: ""` — значение `en` и
      одна строка stderr.
- [x] **Лексический guard.** `harness/bin/tests/agents-text.test.sh:131-135` ищет только заголовки
      `## Terms`, «Writing in Russian», «written in Russian»; правило о языке другими словами guard
      пропустит. Либо расширить проверку, либо комментарий, что guard ловит только прежние формы.
- [x] **После Ticket-а 02.** `harness/skills/ship-ticket/SKILL.md:98` и `harness/skills/epic-wave/SKILL.md:45`
      говорят «while the profile has no such field» про `language.docs` — с PR #526 `bin/profile` всегда
      ставит `docs` (`en` по умолчанию, `profile:317`), и эта ветка недостижима. Если 02 их не переписал —
      переписать здесь.
- [x] `bash harness/bin/tests/profile.test.sh`, `bash harness/hooks/tests/rules-hooks.test.sh`,
      `bash harness/bin/tests/agents-text.test.sh` — exit 0; `pnpm test` — exit 0.

## Тесты

- `harness/bin/tests/profile.test.sh`, `harness/hooks/tests/rules-hooks.test.sh`,
  `harness/bin/tests/agents-text.test.sh` (через `test/contract/harness-scripts.test.ts`).

## Где в коде

- `harness/hooks/inject-rules.mjs` (`:85`, `:92-103`)
- `harness/bin/profile` (`:265-318`)
- `harness/bin/tests/profile.test.sh`, `harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/tests/agents-text.test.sh`
- `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md` — только после 02

## Вне скоупа

- Удаление `language.reports` из Profile-ов и мест, которые его пишут, — Ticket 08.

## Итог

Merged #569 (`4646f8f0`, 2026-10-20).

- `inject-rules.mjs`: `trimEnd()` вместо `/\s+$/` (300 000 пробелов — test в пределах 10 s); первая строка правил
  длиннее бюджета — одна строка stderr, часть правил без правил пользователя.
- `bin/profile`: `language` не объект (число, массив, `null`) и поле `language.*` не непустая строка — одна строка
  stderr с путём Profile-а, значение `en`, exit 0; старое `"language": ""` — одна строка, а не три.
- `qmd-sync-main` и `qmd-refresh` читают JSON Profile-а только из stdout: предупреждения Profile-а (в том числе от
  сломанного `user.json`, с #526) больше не ломают обновление копии для qmd. Причина отказа Profile-а — одной строкой
  в предупреждении, `refresh.log` и marker-файле; под `--quiet` предупреждения не печатаются; временный файл
  удаляется и по сигналу.
- Guard в `agents-text.test.sh` ищет правило о языке по смыслу (глагол письма + «in <язык>»), с CRLF; список
  фраз «отклонить / пропустить» закреплён в test-е.
- Пункт «живые проверки читают `user.json`»: уже убран #549, правки нет.
- Ревью: круг 1 high (корректность + security hook-а, test-ы) — 1 med + 4 low; круг 2 medium — 1 med + 2 low;
  круг 3 medium — 1 med (регрессия круга 2: причина отказа терялась) + 3 low. Все исправлены.
- gate full зелёный (очередь Mac), `check/windows` success (ПК).

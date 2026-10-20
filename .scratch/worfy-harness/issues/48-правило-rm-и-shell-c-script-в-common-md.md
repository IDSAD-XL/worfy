# 48 — Общее правило Harness: `rm` без `$VAR` в цели, многострочный `sh/bash/zsh -c` — через файл

Type: task
Status: done 2026-10-20T17:21Z
PR: #595
Blocked by:
Source: решение владельца 2026-10-15 по отчёту
[docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md](../../../docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md)
(Ticket [`worfy-polish` 12](../../worfy-polish/issues/12-bash-запросы-разрешения-у-orchestrator-а-autopilot.md)):
разделы «Четыре случая» (3 и 4) и «Предложения», пункт 2. Код перечитан по main `39d907f`.

## Что происходит

Claude Code спрашивает человека на `rm` с целью, которую нельзя вычислить заранее, и на `-c`-script,
который он не смог проверить на удаление. Это проверка `dangerousRemoval`; она спрашивает и в
`bypassPermissions`, и allowlist её не разрешает. В Autopilot спросить некого — worfy отказывает, шаг
агента ломается (отчёт, «Коротко»).

- **Правило есть, но узкое и не у всех.** «Delete only by a literal path» стоит в
  `harness/agents/implementer.md:63-67` и `harness/agents/reviewer.md:122-125`. Его получают только
  `implementer` и `reviewer`. Общие правила `harness/hooks/rules/common.md` получает каждый Subagent
  (`harness/README.md:15`; `hooks/inject-rules.sh`), но правила про удаление там нет.
- **Случай 3:** агент с этим правилом в prompt-е всё равно написал `rm -rf "$M/$mut"`, где `M` — из
  `mktemp -d`. Правило не называет такой случай прямо.
- **Случай 4:** `zsh -f -c '<многострочный script>'` без `rm`. Claude Code не смог разобрать script и
  спросил. Тот же script из файла (`zsh -f <file>`) прошёл без запроса. Такого правила в Harness нет.

## Что делаем

1. **Правило в `harness/hooks/rules/common.md`**, коротко, 3–5 строк, в стиле файла:
   - (а) удалять только по литеральному пути: без glob-а после `cd` и без `$VAR` в цели `rm` —
     даже если папка из `mktemp -d`. Нужна чистая папка — новый `mktemp -d`, старую не чистить;
   - (б) многострочный script для `sh -c`, `bash -c`, `zsh -c` — записать в файл в своей папке
     scratchpad и запустить файл (`zsh -f <file>`);
   - почему: на такие команды Claude Code спрашивает человека даже в `bypassPermissions`, а без
     человека (worfy Autopilot) запрос отклоняется.
2. **Куда в файле.** Test `harness/hooks/tests/rules-hooks.test.sh:216-219` требует ровно три раздела
   `common.md`: Plain language, Evidence before "green", Context hygiene. Рекомендация — абзац в
   «Context hygiene» или новый раздел. Если раздел новый — этот test правится в том же PR. Предел
   файла — 10 000 символов (`LIMIT`, `:20`); сейчас 5 478 байт.
3. **Дубль в агентах.** `implementer.md:63-67` и `reviewer.md:122-125` — заменить ссылкой на общее
   правило («see the common rules: Shell commands without a confirmation») или оставить одну строку о
   том, что нужно агенту именно здесь (новый `mktemp -d` вместо чистки). Полный текст — только в
   `common.md`.
4. **Test-ы текста.** `rules-hooks.test.sh` — новая тема в `COMMON_TOPICS` (`:169-184`): фразы
   правила (`mktemp -d`, `-c`, `bypassPermissions`). `harness/bin/tests/agents-text.test.sh` —
   агенты не повторяют полный текст правила и ссылаются на него (образец — Ticket 47).

## Готово, когда

- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` и `bash harness/bin/tests/agents-text.test.sh` —
      exit 0; мутант «правило удалено из `common.md`» — exit 1.
- [ ] В `implementer.md` и `reviewer.md` нет второй полной копии правила: `grep -n "literal path"
      harness/agents/*.md` — только ссылка.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.
- [ ] (вручную, владелец) После влития — `pnpm install:stable`: плагин в Stable copy ставит владелец.
      До этого новое правило не действует.

## Где в коде

- `harness/hooks/rules/common.md:75-84` (раздел «Context hygiene»).
- `harness/agents/implementer.md:63-67`.
- `harness/agents/reviewer.md:122-125`.
- `harness/hooks/tests/rules-hooks.test.sh:20`, `:169-184`, `:216-219`.
- `harness/bin/tests/agents-text.test.sh`.

Только читать: `harness/README.md:15`, `harness/hooks/inject-rules.sh`,
`docs/research/2026-10-15-bash-запросы-разрешения-autopilot.md`.

## Вне скоупа

- Guard в `harness/hooks/guard.mjs` на такие команды (отчёт, «Предложения», пункт 3) — отложен
  владельцем 2026-10-15: делать, только если правило будут нарушать.
- Причина отказа в ответе модели и в журнале Autopilot — worfy, `worfy-polish` 26.
- Allowlist в Profile-е или Harness-е — не поможет: Claude Code пишет, что эта проверка «cannot be
  auto-allowed by permission rules».
- Пересечение с [Ticket-ом 47](47-gate-с-временным-home-в-брифах-implementer-и-reviewer.md): оба правят
  `implementer.md` и `reviewer.md`; кто вливается вторым, тот обновляется от main.

## Итог

PR [#595](https://github.com/IDSAD-XL/worfy/pull/595), merge 54a37547. Gate full зелёный; plugin-neutral и
harness-scripts зелёные; влит оркестратором после своих проверок.

- **Правило.** В `harness/hooks/rules/common.md` новый раздел «Shell commands without a confirmation»:
  - удалять только по буквальному пути; цель, которая может стать `/`, папкой верхнего уровня или всей
    папкой, — повод спросить;
  - нужна чистая папка — новый `mktemp -d`, а не чистка старой;
  - многострочный скрипт `-c` идёт в файл в своей scratchpad-папке, и запускается файл; причина —
    Claude Code спрашивает человека, когда скрипт может удалять и разобрать его не удалось.
- **Агенты.** В `implementer.md` и `reviewer.md` полная копия правила заменена ссылкой на раздел и одной
  строкой про `mktemp -d`; `grep -n "literal path" harness/agents/*.md` — только ссылка.
- **Test-ы.** `rules-hooks.test.sh` знает четыре раздела `common.md` и закрепляет фразы правила, включая
  «even in `bypassPermissions`»; `agents-text.test.sh` раздел 12 — ссылка есть, копии нет, строка
  `mktemp -d` закреплена. Локально 198/0 и 162/0.
- **Ревью:** корректность и тесты, уровень medium, mutation testing на изменённых строках. Раунд 1 —
  OK-with-notes, пять low; все закрыты в cd29fb50. Мутанты красные: раздел удалён (оба test-а), пункт
  `rm` удалён, пункт `-c` удалён, полная копия правила возвращена в `implementer.md`, ссылка удалена,
  фраза «even in `bypassPermissions`» обрезана, строка `mktemp -d` агентов удалена.
- **`common.md`** — 5 681 байт, в пределах 10 000 символов одной строки additionalContext.
- **Не сделано — шаг владельца:** `pnpm install:stable`; до него новое правило в Stable copy не действует.

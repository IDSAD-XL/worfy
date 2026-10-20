# 31 — `$0` и `$1` в shell-блоках skills подменяются аргументами вызова skill-а

Type: task
Status: claimed 2026-10-20T08:46Z
Blocked by:
Source: Wave 2 Epic-а `worfy-review` (2026-10-10): Implementer Ticket-а 02 увидел в загруженном тексте `/worfy:ship-ticket` строки `--field "02"` и `substr(worfy-review,10)`; Orchestrator нашёл то же в транскрипте своей Session для `/worfy:epic-wave`.

## Что происходит

Claude Code подставляет аргументы вызова skill-а в его текст: `$ARGUMENTS` — вся строка, `$0`,
`$1`, … — слова этой строки по порядку (`$0` — первое). Подстановка идёт по всему тексту SKILL.md,
в том числе внутри блоков ```bash.

- В shell-блоках skills Harness `$1` — параметр функции, а `$0`, `$1`, `$2` — поля awk. Когда skill
  вызван с аргументами, модель получает блок уже с подменой:
  - `/worfy:ship-ticket worfy-review 02` → `F() { … --field "02" 2>/dev/null; }` и
    `awk … '/^worktree /{w=substr(worfy-review,10)} worfy-review==b{print w}'`
    (исходник — `harness/skills/ship-ticket/SKILL.md:435`, `:446`);
  - `/worfy:epic-wave tickets 01, 03, 05 of epic worfy-review` → `--field "01,"` и
    `w=substr(tickets,10)` (исходник — `harness/skills/epic-wave/SKILL.md:501`, `:512`, `:546`,
    `:605`). В транскрипте Session Orchestrator-а 2026-10-10 испорченный вариант встречается 9 раз.
- Блок в таком виде не работает: `F status` всегда спрашивает у Profile-а поле с именем аргумента,
  awk сравнивает строку с именем переменной. Модель либо чинит блок на ходу, либо получает пустой
  ответ и идёт дальше без поля Profile-а.
- На диске всё верно — и в `harness/skills/`, и в установленной копии: test-ы блоков
  (`harness/bin/tests/skill-blocks.test.sh`) вырезают блок из файла и подмены не видят.
- Сколько мест: `grep -rnE '\$[0-9]' harness/skills/*/SKILL.md` на main `bfb9385` — 20 строк в пяти
  skills: `overnight-fix-loop` (9), `continuous-audit` (4), `epic-wave` (4), `ship-ticket` (2), `qmd` (1).
- Что получает skill, вызванный без аргументов (`/worfy:retro`), не проверено: проверить при работе.
  Autopilot всегда зовёт `/worfy:epic-wave` с аргументами.

## Что делаем

1. Убрать из текстов skills позиционные токены `$0`…`$9` так, чтобы блоки остались рабочими под bash
   и zsh. Способ выбрать при работе и записать в «Итог»; кандидаты:
   - функция `F` без `$1` (например, `F() { local f; for f; do …; done; }` или `"$@"`);
   - awk-программы без `$0` и `$N`: `-F` и `getline` в переменные, или вынос программы в скрипт
     `harness/bin/`, который блок только зовёт.
   Сначала проверить на установленном plugin-е (шаг владельца или песочница), какие написания
   Claude Code не трогает: `${1}`, `"$@"`, `\$1` — не предполагать.
2. Test, который запрещает `$<цифра>` в `harness/skills/*/SKILL.md` (вне строк, помеченных как
   пример для человека, если такие понадобятся), с понятным сообщением: что подставит Claude Code.
3. `skill-blocks.test.sh` дополнительно прогоняет каждый проверяемый блок после имитации подстановки
   (аргументы `a b c`): результат тот же, что без неё.

## Готово, когда

- [ ] `grep -rnE '\$[0-9]' harness/skills/*/SKILL.md` пуст (или остались только строки, которые test
      явно разрешает).
- [ ] Новый test красный на main `bfb9385` (20 строк) и зелёный после правки; красный на мутанте,
      который возвращает `$1` в любую функцию `F`.
- [ ] Блоки, которые проверяет `skill-blocks.test.sh`, дают прежний результат под bash и zsh — и на
      исходном тексте, и после имитации подстановки аргументов.
- [ ] (вручную, после `pnpm install:stable`) `/worfy:ship-ticket <epic> <NN>` в Session: в загруженном
      тексте шага 11 нет имени Epic-а и номера Ticket-а на месте параметров; команда и вывод — в
      «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; gate full на Mac зелёный.

## Где в коде

- `harness/skills/overnight-fix-loop/SKILL.md`
- `harness/skills/continuous-audit/SKILL.md`
- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/skills/qmd/SKILL.md`
- `harness/bin/tests/skill-blocks.test.sh`
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`

## Вне скоупа

- Skills других plugin-ов.
- Перенос shell-блоков skills на Node — `worfy-windows` 07 (тексты skills для двух систем).

## Риски

- `harness/skills/epic-wave/SKILL.md` и `ship-ticket/SKILL.md` правят открытые Ticket-ы других Epic-ов
  (`worfy-review` 06, 04, 07; `worfy-windows` 03, 07, 17): перед claim сверить открытые PR, второй по
  порядку мержа делает rebase.
- Часть правил Harness, которая доходит через hooks, а не через Skill, подстановке не подвержена —
  проверить и записать в «Итог», чтобы не чинить лишнее.

## Итог

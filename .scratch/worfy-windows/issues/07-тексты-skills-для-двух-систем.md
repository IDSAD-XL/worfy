# 07 — Тексты skills для двух систем; перед Wave — открытые PR второго Epic-а

Type: task
Status: open
Blocked by: 03, 12
Source: решения владельца 2026-10-07: Q19 (скрипты Harness — на Node, команды skills — для обеих систем), Q25 (Session-ы Mac и Windows общаются через репозиторий; перед Wave — открытые PR второго Epic-а), Q12 (мерж в main по очереди) ([spec.md](../spec.md)); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node», пункт 6; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions», пункты 4–6; [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness по-английски); evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

Skills Harness — тексты, по которым агент работает. Их блоки команд агент выполняет Bash tool-ом:
на Mac это zsh, на Windows — Git Bash, то есть bash с GNU coreutils (ADR-0055).

- **Замок на главной ветке** (`harness/skills/epic-wave/SKILL.md:316-334`). Блок `:321-330` берёт
  время изменения папки замка командой BSD `stat -f %m "$L"` (`:324`). В GNU `stat` ключ `-f` —
  сведения о файловой системе, а `%m` читается как имя файла. Команда кончается ошибкой, и
  `|| continue` уходит на следующий круг без `sleep`. Цикл крутится вхолостую, а замок старше 90
  минут не снимается. Вывод — по разбору команды; на Windows блок не запускался.
- **Ветки за 14 дней** (`harness/skills/continuous-audit/SKILL.md:121-126`). `date -v-14d +%s`
  (`:123`) GNU `date` не знает. awk получает пустой порог, и фильтр по дате, похоже, пропускает все
  ветки. Блок пишет в `$TMPDIR/live-tickets.jsonl` (`:125`); задан ли `TMPDIR` в Bash tool на
  Windows, не установлено.
- **Ручные проверки GUI** (`harness/skills/ship-ticket/SKILL.md:180-198`, раздел 6) — только для
  macOS: разрешения Screen Recording и Accessibility (`:181`), `screencapture` (`:186`), запуск «как
  из Finder» через `env -i` с окружением launchd вместо `open` (`:190-194`), `open -b` и проверка
  пути процесса `ps -o comm= -p <pid>` (`:194-196`). Шага для Windows нет. Ticket 12 даёт для
  Windows неподписанный установщик NSIS и Stable copy и пишет путь копии в `CONTEXT.md`.
- **agents и rules.** В `harness/agents/*.md` и `harness/hooks/rules/*.md` команд BSD и macOS нет:
  `grep -rnE 'stat -f|date -v|open -|ps -o|screencapture|osascript' harness/agents harness/hooks/rules`
  пуст. Вызовы Gate в них меняет Ticket 03.
- **Второй Epic.** Session Mac ведёт Epic `worfy-link`, Session Windows — `worfy-windows`. Прямого
  канала между ними нет; общее — только репозиторий (ADR-0056, пункт 4).
  - Раздел 1 `epic-wave` уже берёт открытые PR с их файлами:
    `gh pr list --state open --json number,headRefName,mergeStateStatus,files` (`SKILL.md:69`). Но
    ищет в них только занятые номера ADR (`:78`) и состояние мержа. Пересечение файлов Ticket
    проверяет только с Ticket-ами своей Wave и Ticket-ами в работе (`:100`, `:125-130`).
  - Раздел 4: `BEHIND` — «wait» (`:296`). Если main ушёл вперёд от мержа на другой машине, ждать
    нечего: ветка сама не обновится.
  - Замок на главной ветке — папка в scratchpad или в `git-common-dir` (`:316-334`). Он виден только
    на своей машине; Session на другой машине его не видит.
- **Ограничения test-ов.**
  - `harness/bin/tests/epic-wave-ship-ticket.test.sh` держит номера разделов (`:88-91`: `epic-wave`
    0–5, `ship-ticket` 0–11) и не пускает кириллицу вне списка (`:127-147`). Новый текст — по-английски
    (ADR-0044).
  - `harness/bin/tests/skill-blocks.test.sh` гоняет блоки `overnight-fix-loop` под bash и под zsh
    (`:42`, `:53`, `:68`, `:85`). zsh в Git Bash нет (ADR-0055), поэтому на Windows test падает на
    случаях zsh.
  - Оба test-а используют perl (`epic-wave-ship-ticket.test.sh:34`, `:145`). На Windows test-ы идут
    в Git Bash с `jq` и perl (ADR-0055, пункт 4); есть ли perl в Git Bash, проверяет Ticket 01.

## Что делаем

1. **Замок на главной ветке** (ADR-0055, пункт 6). Вместо `stat -f %m` — команда, одинаковая в BSD и
   GNU. Например, `find "$L" -maxdepth 0 -mmin +90` печатает путь, если папке больше 90 минут, и
   тогда `rmdir`. Комментарий `Linux: stat -c %Y` уходит.
2. **Ветки за 14 дней.** Порог — `$(( $(date +%s) - 14 * 86400 ))` вместо `date -v-14d +%s`. Файл —
   `${TMPDIR:-/tmp}/live-tickets.jsonl`.
3. **Шаг для Windows в ручных проверках GUI** (`ship-ticket`, раздел 6; новых разделов нет). Абзац
   по-английски для Windows:
   - снимки — только Playwright своей сборки, как на Mac; что Windows спрашивает при снимке экрана и
     управлении, проверить на Windows-ПК и записать в абзац;
   - запуск «как из меню Пуск», без окружения агента (`CLAUDECODE`, `CLAUDE_CODE_*`, PATH агента).
     Кандидат — `explorer.exe <путь к worfy.exe>`; выбрать и проверить на Windows-ПК;
   - путь процесса — `powershell -NoProfile -Command "(Get-Process -Id <pid>).Path"` вместо `ps -o
     comm= -p <pid>`: на машине могут стоять несколько сборок с одним app id;
   - для worfy: установщик и путь Stable copy на Windows — по `CONTEXT.md` (Ticket 12).
4. **Перед Wave — открытые PR других Epic-ов** (Q25, ADR-0056 пункт 5). В разделе 1 `epic-wave` —
   блок с `gh pr list --state open --json number,headRefName,files` и встроенным в `gh` фильтром
   `--jq`, без внешнего `jq`. Он печатает строки `#<N> <ветка> <файл>` для PR, чья ветка не
   подходит под шаблон `F tickets.branch` этого Epic-а. Правило в тексте:
   - файлы этих PR сравниваются с файлами Ticket-ов Wave (раздел `F tickets.trail_section`, у
     worfy — «Где в коде»);
   - Ticket с общим файлом в Wave не берётся, пока тот PR не влит. В таблице плана и в отчёте Wave —
     Ticket, файл и номер PR.

   Правило общее для любого Project-а: для одной машины оно значит «PR другой Session».
5. **Мерж по очереди между машинами** (Q12, ADR-0056 пункт 6). В разделе 4 `epic-wave`:
   - замок на главной ветке виден только своей машине; другая Session мержит сама;
   - перед мержем — `git fetch`. Если PR в состоянии `BEHIND` или база ушла вперёд после его
     проверок, ветку перебазируют на свежую базу в worktree Ticket-а, пушат и снова ждут CI
     (прежний блок ожидания CI). `BEHIND` больше не значит только «wait».
6. **Test-ы.**
   - `skill-blocks.test.sh` гоняет новые блоки, вырезанные из `SKILL.md`: замок и ветки за 14 дней.
   - Случаи zsh на Windows (`uname -s` — `MINGW*` или `MSYS*`, zsh нет) пропускаются строкой
     `skip zsh: …`. На Mac и Linux отсутствие zsh — по-прежнему провал:
     `test/contract/harness-scripts.test.ts` требует zsh.
   - `epic-wave-ship-ticket.test.sh` проверяет новые куски текста.

Не входит:

- `harness/skills/qmd/SKILL.md` (Ticket 15).
- `jq` в текстах skills остаётся: на Windows его ставят отдельно, `winget install jqlang.jq`
  (ADR-0055, «Последствия»).
- Имя Gate в skills (Ticket 03).
- Явный `node` вместо вызова по shebang в skills и agents. Он нужен, только если Ticket 01 покажет,
  что в Git Bash shebang не работает (ADR-0055, пункт 2). Этот срез тогда добавляет Ticket 01.
- Правило «платформенный PR — после gate full на Windows-ПК» (ADR-0056, пункт 2) в текст skills не
  входит.

## Готово, когда

- [ ] `grep -rnE 'stat -f|date -v' harness/skills harness/agents harness/hooks/rules` — exit 1.
- [ ] `skill-blocks.test.sh`, блок замка из `epic-wave/SKILL.md`. Папка замка со временем изменения два часа назад (`touch -t`) снимается и берётся заново — вывод `LOCKED`. Свежая папка после одного круга остаётся (в test-е `sleep 30` заменён на `break`, а число кругов ограничено, чтобы холостой цикл не повесил прогон). Под bash и под zsh на Mac.
- [ ] `skill-blocks.test.sh`, блок веток за 14 дней из `continuous-audit/SKILL.md`. В репозитории test-а есть `refs/remotes/origin/old` (коммит 20 дней назад) и `origin/new` (1 день назад); `epic-status` подменён stub-ом. В `live-tickets.jsonl` — только Ticket-ы `origin/new`.
- [ ] `epic-wave-ship-ticket.test.sh`: в разделе 1 `epic-wave` есть блок с `--json number,headRefName,files` и `--jq` и правило «not dispatched until that PR is merged»; в разделе 4 — `BEHIND` с перебазированием и повторным CI; в разделе 6 `ship-ticket` — абзац Windows с `Get-Process` и способом запуска. Проверки номеров разделов и кириллицы проходят.
- [ ] `bash harness/bin/tests/skill-blocks.test.sh` и `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0 на Mac и в `pnpm test`.
- [ ] Те же два test-а — exit 0 в Git Bash на Windows-ПК; случаи zsh печатают `skip`.
- [ ] Живая проверка: новый блок раздела 1 в репозитории worfy для Epic-а `worfy-windows` печатает открытые PR других Epic-ов с их файлами (или ничего). Вывод — в Итог.
- [ ] Windows-ПК, один раз: запуск по новому абзацу открывает установленный worfy, команда `Get-Process` печатает путь его `worfy.exe`. Выбранный способ запуска и вывод — в Итог.
- [ ] Mac: gate full зелёный.

## Тесты

Сначала — случай замка в `skill-blocks.test.sh`. Он вырезает блок из `epic-wave/SKILL.md` и гоняет
его под bash. На нынешнем main на Mac он зелёный: BSD `stat` там есть. Красным его делает запуск
в Git Bash на Windows-ПК или на Linux (CI): там `stat -f %m` кончается ошибкой, цикл крутится
вхолостую и упирается в предел кругов. В Итог — вывод красного прогона.

Блоки вырезаются из `SKILL.md` тем же способом, что в `skill-blocks.test.sh:18-21` (функция `block`
по уникальной строке блока). Проверка текста — `has`/`lacks` из `epic-wave-ship-ticket.test.sh:17-19`.

## Где в коде

- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/continuous-audit/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/bin/tests/skill-blocks.test.sh`
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`

## Итог

Заполняется при закрытии.

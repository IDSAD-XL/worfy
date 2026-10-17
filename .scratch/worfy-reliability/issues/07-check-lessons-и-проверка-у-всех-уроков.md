# 07 — `scripts/check-lessons.mjs` и строка `Проверка:` у всех уроков (В2)

Type: task
Status: claimed 2026-10-17T08:51Z
Branch: worfy-reliability/07
Blocked by: —
Source: решение владельца 2026-10-16 по Ticket-у [03](03-сбой-инцидент-и-регрессионный-test-предложение-процесса.md)
(«Итог», пункты 3 и 4): вариант встраивания В2 из
[docs/research/2026-10-15-сбой-инцидент-test.md](../../../docs/research/2026-10-15-сбой-инцидент-test.md),
разделы «Куда встроить» и «Follow-up Ticket-ы», кандидат 2; `Проверка:` — всем существующим урокам,
вместе с В2.

## Что происходит

- Уроков в `docs/lessons/` на main `274c7eb` — 34 (`grep -c "^## "`: `agents.md` 12, `process.md` 9,
  `testing.md` 7, `ci-merge.md` 6). В отчёте Ticket-а 03 их 33: урок про обновление SDK
  (`docs/lessons/agents.md:117`) добавил Ticket 01 позже.
- Строку `Код:` имеют 9 уроков (8 в отчёте и урок про SDK), на файл test-а указывают 2
  (`docs/lessons/testing.md:73` — unit test, `:53` — helper e2e `test/e2e/snapshots.ts`); раздел «Что
  есть сейчас» документа. Остальные уроки ничем не проверяются.
- Образец проверки документа кодом — `scripts/check-handoff.mjs`: он идёт в `pnpm lint`
  (`package.json:17`) и имеет unit test `test/unit/check-handoff.test.ts`.

## Что делаем

1. **Сначала красный unit test** `test/unit/check-lessons.test.ts` на маленьких fixture-папках: урок без
   строки `Проверка:` — ошибка с файлом и заголовком; `Проверка:` с путём к несуществующему файлу —
   ошибка; `Проверка: проверки нет: <почему>` с непустой причиной — проходит; путь с `:line` за концом
   файла — ошибка.
2. **Скрипт** `scripts/check-lessons.mjs`: каждый `##` в `docs/lessons/*.md`, кроме `README.md`, имеет
   строку `Проверка:`; файл из неё существует, строка в пределах файла. Exit code 1 и список нарушений;
   0 — молча или одной строкой итога. Без зависимостей, как `check-handoff.mjs`.
3. **В `pnpm lint`** рядом с `check-handoff.mjs` — так скрипт идёт в gate fast и в CI.
4. **`Проверка:` всем 34 урокам.** Для каждого — `file:line` test-а, hook-а или eval-кейса, который
   сторожит урок, или «проверки нет: <почему>». Ссылки — настоящие: каждую исполнитель открывает и
   читает. Новых test-ов этот Ticket не пишет: урок без test-а получает «проверки нет».
5. **Список уроков без проверки** — таблица в «Итог»: кандидаты в будущие Ticket-ы, без их заведения.

## Готово, когда

- [x] Unit test пункта 1 красный без скрипта и зелёный со скриптом; мутанты «не проверять существование
      файла» и «пропускать пустую причину» — красные.
- [x] `node scripts/check-lessons.mjs` на ветке — exit 0; на main (без строк `Проверка:`) — exit 1 и 34
      нарушения.
- [ ] `pnpm lint` зовёт скрипт; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0
      и строка `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.
- [x] Таблица пункта 5 — в «Итог».

## Тесты

- `test/unit/check-lessons.test.ts` — правила скрипта на fixture-папках `test/fixtures/check-lessons/`.

## Где в коде

- `scripts/check-lessons.mjs`
- `test/unit/check-lessons.test.ts`
- `test/fixtures/check-lessons/`
- `package.json`
- `docs/lessons/agents.md`
- `docs/lessons/process.md`
- `docs/lessons/testing.md`
- `docs/lessons/ci-merge.md`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `scripts/check-handoff.mjs`,
`test/unit/check-handoff.test.ts`, `docs/lessons/README.md` (формат строки задаёт Ticket 06).

## Вне скоупа

- Раздел README про классы и формат — Ticket 06. Если 06 влит раньше, формат строки — его; если позже,
  06 описывает уже работающую проверку.
- Новые test-ы под уроки без проверки.
- PR только с уроками gate fast по диффу может не проверить, пока Gate registry не знает
  `docs/lessons/` (как с `HANDOFF.md`): перед push такого PR — `node scripts/check-lessons.mjs`.

## Итог

- **Скрипт** `scripts/check-lessons.mjs` идёт в `pnpm lint` после `check-handoff.mjs`. Он проверяет каждый
  `##` в `docs/lessons/*.md`, кроме `README.md`. Допустимы ровно две формы строки `Проверка:` из README
  Ticket-а 06:
  - `Проверка: <путь>:<строка>`, после неё можно пояснение через ` — `. Путь — от корня репозитория и
    начинается с `test/`, `harness/hooks/tests/`, `harness/bin/tests/` или `harness/evals/`. Файл
    существует, строка в пределах файла.
  - `Проверка: проверки нет: <почему>`, причина непустая.

  Ошибкой считаются: путь без строки, путь в backticks, диапазон строк, две ссылки в одной строке,
  вторая строка `Проверка:` у того же урока, папка и путь вне репозитория. Скрипт выходит с кодом 1 и
  списком `<файл>:<строка>: «<заголовок>»: <что не так>`. На уроках main ed5f85f3 — exit 1 и 34
  нарушения «нет строки». На ветке — exit 0, `lessons: ok (34 урока: 18 со ссылкой, 16 без проверки)`.
- **Test** `test/unit/check-lessons.test.ts` на fixture-папках `test/fixtures/check-lessons/`. Первая версия
  test-а без скрипта была красной во всех 7 test-ах. Восьмой test пропускает строку-пример из
  `docs/lessons/README.md`. Четыре мутанта красные: «не проверять существование файла» (3 test-а),
  «пропускать пустую причину» (1), «не проверять место файла» (1) и «пропускать вторую строку
  `Проверка:`» (1).
- **`Проверка:` у всех 34 уроков.** Строка стоит перед последним `Источник:`. Если `Код:` и `Источник:`
  были в одной строке, она разрезана на две. Каждую ссылку я открыл и прочитал строку. 18 уроков
  ссылаются на test, 16 получили «проверки нет». Урок «Сбой проверочной команды» ссылается на
  `test/contract/claude-home-subagents.test.ts:382`. Мутант «`ps` не ответил → `gone`» в
  `src/main/claude-home/registry.ts` краснит этот test на macOS, а с ним и test Subagent-ов того же файла.
- **Уроки без проверки** — кандидаты в будущие Ticket-ы; Ticket-ы не заведены:

| Урок | Чего не хватает |
| --- | --- |
| `agents.md`: исполнитель входит в свой worktree | Hook на Edit и Write — в Claude Code; test текста правила |
| `agents.md`: ручные проверки GUI | Test-а нет; eval `no-os-screen-capture` требует обратного (см. ниже) |
| `agents.md`: окно «восстановить окна?» | Test, что `launchApp` передаёт `NO_WINDOW_RESTORE` |
| `agents.md`: только буквальный путь в `rm -rf` | Отказ hook-а — открытый `worfy-harness` 48 |
| `agents.md`: удалять worktree и ветку после мержа | Test шага уборки skill-а `epic-wave` |
| `agents.md`: Agent SDK от Claude Code 2.1.299 | Test `claude_code_version` в `test/fixtures/sdk-messages/` против версии SDK |
| `ci-merge.md`: CI не стартует на DIRTY | Test текста правила «rebase перед CI» |
| `ci-merge.md`: замок `main.lock` | Test, что `wave-gate merge` ждёт замок `main` |
| `ci-merge.md`: CI только на Linux | Test `runs-on: ubuntu-latest` в `ci.yml` |
| `process.md`: узкий круг на критическом пути | Test порога «≥3 зависимых» в skill-е |
| `process.md`: зависимые от реально заблокированных | Кода у счёта нет — только текст skill-а |
| `process.md`: Wave по зависимостям | Test текста skill-а |
| `process.md`: номер ADR каждому Ticket-у Wave | Test раздачи номеров в предполёте |
| `process.md`: две Wave-ы подряд без человека | Не правило, а запись о прогонах |
| `testing.md`: круг доработки вносит дефекты | Test текста правила агентов |
| `testing.md`: текст только в `title` | Test, сравнивающий снимки разных случаев |

- **Замечено вне скоупа.** Урок `agents.md` «Ручные проверки GUI агент может делать сам» расходится с eval
  `harness/evals/no-os-screen-capture`: тот требует, чтобы агент вообще не снимал экран. Урок
  `testing.md` про форму ошибки Electron называет `loadWasAborted` и «PR #48 (не влит)». В коде правило
  теперь `loadEndedAsReplaced` (`src/main/window.ts`). Оба урока не переписаны: правка смысла уроков вне
  скоупа этого Ticket-а.
- **Не проверено:** CI на GitHub. Jobs аккаунта отклоняются из-за billing, CI на PR падает, не начавшись.
  Gate full — за оркестратором перед мержем.

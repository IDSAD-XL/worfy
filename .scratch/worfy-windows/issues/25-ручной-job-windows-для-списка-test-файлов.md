# 25 — Ручной job в CI: заданный список test-файлов на `windows-latest`

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-12: вынести вперёд малую часть Ticket-а [14](14-gate-full-на-windows.md) (gate full на Windows, с ручным job-ом «Windows» в CI). Условие владельца: большие test-ы не должны попасть на runner. Делает агент-implementer на Mac.

## Что происходит

- **Test-ы на Windows идут только руками** на ПК владельца. CI — один файл,
  `.github/workflows/ci.yml`. Job `check` на `ubuntu-latest` идёт на PR и push (`:24-26`). Job
  `full-macos` идёт только на `workflow_dispatch` (`:60-62`). Job-а Windows нет. У
  `workflow_dispatch` нет input-ов (`:15`): каждый ручной запуск гонит `full-macos` целиком.
- **Цена** (Ticket 14, `:80`): минута Windows — $0.010, минута macOS — $0.062.
- **Полный job «Windows»** с e2e и packaging описан в Ticket-е 14, пункт 8 (`:124-130`), и остаётся
  там. Здесь — только unit- и contract-файлы по списку.
- **Полный `pnpm test` на Windows красный:** около 700 упавших test-ов (оценка на 2026-10-12; в
  «Итог» Ticket-а 18 — symlink на share — 636, `:241`). На runner он идти не должен.
- **Как запускается файл.** `pnpm test` — это `node scripts/vitest-electron.mjs` (`package.json:16`);
  аргументы уходят в `vitest run` (`scripts/vitest-electron.mjs:24`). Аргумент vitest — фильтр по
  имени, а не точный путь (`test/contract/vitest-electron.test.ts:16-18`).
- **Правило проекта «агенты не запускают платные прогоны»** — вне репозитория, в
  `~/.claude/worfy-harness/projects/worfy/rules.md:27-28`: полный прогон на macOS — только вручную.

## Что делаем

1. **Job на `windows-latest`.** Все ограничения — внутри job-а:
   - запуск только по `workflow_dispatch`; на push и PR — никогда;
   - input — явный список test-файлов; пустой список — отказ;
   - только файлы под `test/unit/` и `test/contract/`; имя с `e2e`, `packaged` или `acceptance` — отказ;
   - не больше 12 файлов за запуск;
   - команда — `node scripts/vitest-electron.mjs <файлы>`; `pnpm test` в job-е нет;
   - `timeout-minutes: 10`; `matrix` нет.
2. **Список — это файлы, а не фильтры** (добавлено при составлении Ticket-а; следует из строки о
   vitest выше): каждый элемент — существующий файл `*.test.ts` или `*.test.tsx` и не начинается с
   `-`. Иначе элемент сработает как фильтр по многим файлам или как опция vitest.
3. **Проверка списка — первым шагом после checkout**, до `pnpm install`: отказ укладывается в
   минуту. Значение input идёт в шаг через `env`, а не подстановкой `${{ … }}` в текст `run`.
4. **Contract test закрепляет эти свойства:** ослабление любого делает Linux CI красным. Test-а,
   который читает workflow-файл, на main нет (grep по `test/`); ближайший образец читает
   `package.json` (`test/contract/vitest-electron.test.ts:26-28`). YAML-парсера среди зависимостей
   `package.json` нет (grep). Вариант: проверка списка — скрипт на Node, test зовёт его.
5. **Вопрос исполнителю, ответ — в «Итог»:** как не запускать `full-macos`, когда нужен только этот
   job. Отдельный workflow-файл (тогда `ci.yml` не меняется вовсе) или input, который выбирает job
   (так в Ticket-е 14, `:126-128`). Job-ы `check` и `full-macos` ведут себя ровно как сейчас.
6. **Кто запускает.** Владелец разрешил (2026-10-12) Session-оркестратору на Mac запускать этот job
   перед merge PR с кодом для Windows. Это единственное исключение из правила о платных прогонах.
   Записать в комментарии workflow-файла; строку в `rules.md` правит оркестратор, в PR её нет.

## Готово, когда

- [ ] Запуск с двумя малыми файлами, зелёными на Windows сегодня, — exit 0 на `windows-latest`.
      Кандидаты: `test/unit/remote-links.test.ts` и `test/unit/shell-resolve.test.ts` (на ПК оба
      проходят целиком — «Итог» Ticket-а 18, `:236`). Длительность и цена — в «Итог».
- [ ] Запуск с e2e-файлом, запуск с 13 файлами и запуск с пустым списком: каждый падает на шаге
      проверки меньше чем за минуту. Ссылки на прогоны — в «Итог».
- [ ] Job-ы `check` и `full-macos` не изменились: diff их определений пуст.
- [ ] Contract test падает, когда убрано любое ограничение из пунктов 1 и 2 (проверено по одному).
- [ ] CI на Linux зелёный; gate full на Mac зелёный.

## Тесты

Сначала падающий contract test: job-а нет. Потом случаи отказа: пустой список; 13 файлов;
`test/e2e/terminal.spec.ts`; `test/unit/../e2e/x.test.ts`; `--config=x`; файл, которого нет.

## Где в коде

- `.github/workflows/ci.yml` или новый файл в `.github/workflows/` — по ответу на пункт 5
- скрипт проверки списка (если она вынесена из workflow-файла); новый test в `test/contract/`

## Вне скоупа

- e2e, packaging, acceptance и полный `pnpm test` на Windows — Ticket 14.
- Windows-runner на PR: по решению владельца из Ticket-а 14 его нет. Починка красных test-ов.

## Риски

- **Время установки на runner-е.** Electron скачивается при `pnpm install`; node-pty берёт готовый
  prebuild (`scripts/postinstall.mjs:22-23`). Уложится ли запуск в 10 минут — не проверялось.
- **Test-ы с symlink.** На ПК право на symlink даёт режим разработчика (`README.md:13`). Есть ли оно
  на `windows-latest` — не проверялось.
- **Тяжёлый файл в `test/contract`.** Например, `harness-scripts.test.ts` гонит каждый `.test.sh`
  (Ticket 14, `:47-48`). От него защищает только `timeout-minutes`: потолок — 10 минут, $0.10.
- **Оба ручных job-а в одном workflow-файле:** ошибка в условии запустит macOS за $0.062 в минуту.

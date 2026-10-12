# 24 — Node 24 обязателен для разработки на обеих машинах; README: версия Node и закрытие Terminal на Windows

Type: task
Status: open
Blocked by: 10
Source: решения владельца 2026-10-12: (1) Node 24 обязателен для разработки и на Mac, и на Windows-ПК; (2) закрытие Terminal Node на Windows завершает все процессы под его оболочкой — поведение остаётся, в README о нём заметка. Заметка описывает код PR #239 (Ticket [10](10-terminal-на-powershell.md) — Terminal на PowerShell, влит 2026-10-12); блокер отсюда. Делает агент-implementer на Mac. Установка Node 24 на ПК — шаг владельца.

## Что происходит

- **Что уже говорит «Node 24».** Файл `.nvmrc` — `24` (PR #242). CI ставит `node-version: 24`
  (`.github/workflows/ci.yml:33`, `:68`). Electron 44.5.1 (`package.json:54`) несёт Node 24.21.0.
- **Что не говорит.** В `package.json` поля `engines` нет (grep). README, раздел «Development on
  Windows» (`README.md:5`), пишет «Node.js 22 or newer» (`:10`). Раздела о разработке на macOS в
  README нет: заголовков три (`:1`, `:5`, `:17`). На ПК владельца стоит Node 22.13.0.
- **На одной машине два Node.** Test-ы всегда идут под Node из Electron: `pnpm test` — это
  `scripts/vitest-electron.mjs` (`package.json:16`; запуск — `scripts/vitest-electron.mjs:24-27`).
  Скрипты идут под системным Node: `pnpm icons` (`package.json:13`), `pnpm eval:harness` (`:21`),
  `postinstall` (`:22`). `pnpm install:stable` на main — shell-скрипт (`:20`); в PR #237 (Ticket 12 —
  сборка NSIS и Stable copy, не влит) это `node scripts/install-stable.mjs`.
- **Эта разница скрыла ошибку Ticket-а 23** (рекурсивное удаление идёт через junction — ссылку на
  папку в NTFS). Test падал под Node 24 из Electron. Сам скрипт под Node 22 вёл себя иначе.
- **Что pnpm делает с `engines`.** Версия pnpm — 11.22.0 (`package.json:8`). Репозиторий об `engines`
  ничего не настраивает: в `pnpm-workspace.yaml` только `allowBuilds` (`:5-9`), файла `.npmrc` нет.
  Остановит ли pnpm 11 установку под Node ниже, чем в `engines`, — не проверялось.
- **Terminal.** Закрытие Terminal Node на Windows завершает каждый процесс под его оболочкой, в том
  числе оконные программы, без запроса на закрытие. Владелец решил это оставить: на macOS так же
  завершаются программа на переднем плане и фоновые job-ы оболочки. Код влит с PR #239 (main `f073006`).

## Что делаем

1. **`engines.node: ">=24"`** в `package.json`.
2. **Проверить на деле**, что делает `pnpm install` под Node 22: останавливается, предупреждает или
   молчит. Ticket выбирает между остановкой и предупреждением; рекомендация — остановка. Если pnpm
   сам не останавливает, способ выбирает исполнитель: настройка pnpm в `pnpm-workspace.yaml` или
   проверка версии в `scripts/postinstall.mjs`. Выбор и причина — в «Итог».
3. **README: Node 24 для обеих систем.** Строка `README.md:10` меняется. Для macOS — новая строка
   или короткий раздел: сейчас его нет. Ставит ли `winget install OpenJS.NodeJS.LTS` из той же
   строки именно Node 24 — не проверялось; проверить и поправить команду.
4. **README: заметка о Terminal на Windows:** что завершается при закрытии Terminal Node и что
   запроса на закрытие нет. Текст сверить с кодом, который влит с PR #239.
5. **Порядок с ПК** (предложено): merge — после слова владельца, что Node 24 на ПК стоит. Иначе
   `pnpm install` на ПК остановится.

## Готово, когда

- [ ] Под Node 22 `pnpm install --frozen-lockfile` останавливается с ненулевым кодом (или
      предупреждает — как решено в пункте 2). В сообщении названа нужная версия. Вывод и код — в «Итог».
- [ ] Под Node 24 `pnpm install --frozen-lockfile` — exit 0.
- [ ] CI на Linux зелёный; gate full на Mac зелёный.
- [ ] `grep -n "Node.js 22" README.md` — пусто (код 1). Строки README о Node 24 и о Terminal —
      цитатой в «Итог».

## Тесты

Сначала падающий contract test: `engines.node` в `package.json` есть, и его major совпадает с
`.nvmrc` и с `node-version` в `ci.yml`. На main он красный: поля нет. Образец test-а, который читает
`package.json`, — `test/contract/vitest-electron.test.ts:26-28`. Остановку `pnpm install` под Node 22
test не проверяет: в `pnpm test` и в CI Node один. Она проверяется вручную, вывод — в «Итог».

## Где в коде

- `package.json`, `README.md`, новый contract test
- `pnpm-workspace.yaml` или `scripts/postinstall.mjs` — если остановку приходится делать самим

## Вне скоупа

- Запуск скриптов под Node из Electron вместо системного.
- Поведение Terminal: Ticket его только описывает. Код — Ticket 10.

## Риски

- **Остановка ломает `pnpm install` на ПК**, пока там Node 22. Отсюда порядок в пункте 5.
- **Проверка в `postinstall`** идёт после загрузки зависимостей. Дойдёт ли pnpm до неё под Node 22 —
  не проверялось.
- **Системный Node 24 и Node 24.21.0 из Electron — разные сборки.** Одинаково ли они удаляют папку
  с junction (Ticket 23) — не проверялось.
- **Заметка о Terminal описывает поведение Ticket-а 10.** Изменится поведение — изменится текст.

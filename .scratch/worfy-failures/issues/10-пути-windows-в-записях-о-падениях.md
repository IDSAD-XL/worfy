# 10 — Пути Windows в записях о падениях: «/» после `<repo>` и `~`

Type: task
Status: claimed 2026-11-05T02:57Z
Blocked by: —
Source: [spec.md](../spec.md), «Windows» («Пути в записях — от корня репозитория с `/`»); раунд доработки Ticket-а 04 (PR #1401: красный job `windows (1/3) / full-suite`, run 41944369347), «Вне скоупа» отчёта implementer-а

## Что происходит

- `scrub()` Ticket-а 01 (`harness/hooks/gate-failures.mjs:252-267`) заменяет на `<repo>` и `~` только сам корень
  worktree и домашнюю папку; остаток пути не трогает. На Windows текст ошибки test-а несёт путь вида
  `D:\a\worfy\worfy\test\x.test.ts`, и в записи run-а остаётся `<repo>\test\x.test.ts` — не тот вид, что требует spec.
- Gate (Ticket 02) очищает строки reporter-ов этой же `scrub()`/`scrubRecord()` (`gate-failures.mjs:272`), так что
  записи run-а на Windows хранят «\» в `error`.
- Повтор (Ticket 04) это уже исправил только у себя: `errorText()` в `harness/lib/gate-failures/rerun.mjs` переводит
  хвост пути после `<repo>` на «/» (в том числе двойной «\\» из JSON). Хвост переводится только до первого пробела.
- Следствие: отчёт Ticket-а 05 и перенос Ticket-а 06 видят один и тот же test под двумя разными `error` (Mac и ПК),
  а сравнение записи run-а с записью повтора на Windows расходится.

## Что делаем

1. Перевод хвоста пути на «/» после `<repo>` и `~` переезжает в `scrub()` `harness/hooks/gate-failures.mjs`: один
   раз, для записей run-а, повтора и export-а. `rerun.mjs` зовёт его вместо своей `errorText()`.
2. Путь с пробелом в имени папки (`<repo>\a b\c.ts`) переводится целиком, пока не кончился путь (граница — кавычка,
   `:<строка>`, `)` или конец строки), а не до первого пробела.
3. Номер строки и колонки после пути (`:12:5`) и кавычки вокруг пути остаются как были; POSIX-пути не меняются;
   путь вне корня и вне домашней папки не трогается.

## Готово, когда

- [x] Unit test в `test/unit/gate-failures-format.test.ts`: корень `D:\a\worfy\worfy` во всех написаниях («\», «\\»,
      `/d/…`, другой регистр буквы диска) даёт `<repo>/test/x.test.ts:12:5`; то же для домашней папки и `~`.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/gate-failures-format.test.ts` exit 0 · mac - · 9f88f5a0630564e201ae8f10a431b14c2bb2f8fd
  - evidence: test-run pass · `pnpm exec vitest run test/unit/gate-failures-format.test.ts` exit 0, with two paths in one line · mac - · 0f2582b0d12b33b49c94516892fdd4a08589a0fd
- [x] Тот же test с пробелом в имени папки; на мутанте «до первого пробела» он красный.
  - evidence: test-run pass · `vitest run` of gate-failures-format.test.ts on the mutant "up to the first space" exit 1, unmutated copy exit 0 · mac - · 9f88f5a0630564e201ae8f10a431b14c2bb2f8fd
  - evidence: test-run pass · `vitest run` of gate-failures-format.test.ts on the mutant old PATH_TAIL exit 1, unmutated exit 0 · mac - · 0f2582b0d12b33b49c94516892fdd4a08589a0fd
- [x] `rerun.mjs` не держит своей копии перевода; contract `test/contract/gate-failures-rerun.test.ts` зелёный без правок
      ожиданий.
  - evidence: test-run pass · `pnpm exec vitest run test/contract/gate-failures-rerun.test.ts` (with the other gate-failures unit and contract tests) exit 0 · mac - · 9f88f5a0630564e201ae8f10a431b14c2bb2f8fd
  - evidence: test-run pass · `pnpm exec vitest run test/contract/gate-failures-rerun.test.ts` (with the other gate-failures unit and contract tests) exit 0 · mac - · 0f2582b0d12b33b49c94516892fdd4a08589a0fd
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (job-ы Windows в составе `ci-ok`).

## Тесты

- Unit — в `test/unit/gate-failures-format.test.ts` (рядом с test-ами `scrub` Ticket-а 01).
- Сначала падающий: запись с Windows-путём под корнем — в `error` остаётся «\».

## Где в коде

- `harness/hooks/gate-failures.mjs` (`scrub`, `scrubRecord`)
- `harness/lib/gate-failures/rerun.mjs` (`errorText`, `REPO_PATH`)
- `test/unit/gate-failures-format.test.ts`

Только читать: `harness/lib/privacy.cjs`, `test/contract/gate-failures-rerun.test.ts`.

## Вне скоупа

- Маска чужой домашней папки в других написаниях (`/users/<имя>` в нижнем регистре, `/Volumes/<диск>/<имя>`) —
  долг Ticket-а 06, «Итог».

## Итог

- `scrub()` (`harness/hooks/gate-failures.mjs`) теперь сама пишет хвост пути после `<repo>` и `~` с «/»: функция
  `replaceFolder()` дописывает к шаблону папки (`folderPattern`) шаблон хвоста `PATH_TAIL` и в найденном хвосте
  заменяет каждую серию разделителей, где есть «\» («\», «\\», «\/»), одной «/». Серия из одних «/» не меняется, так что
  POSIX-путь остаётся как был (и «//» в нём тоже). `scrubRecord()` зовёт `scrub()`, поэтому записи run-а (gate,
  Ticket 02) получают тот же вид; export переносит уже очищенные записи.
- Граница пути: имя папки может содержать пробел, но не на конце; путь кончается на пробеле, за которым нет
  разделителя, на кавычке, на «:» (`:12:5`), на `)`, `]`, `}`, `>`, `,`, `;` или в конце текста.
- Раунд доработки 1 (находка ревью: хвост пути глотал слова после пути и букву диска следующего пути, и второй путь
  в строке оставался неочищенным — `expected <repo>/x.ts to equal D:\a\worfy\worfy\y.ts`; на origin/main оба пути
  очищались). Теперь `PATH_TAIL` берёт слова через пробел только тогда, когда за ними сразу идёт разделитель
  (`(?:(?: +имя)+(?=[\\/]))?`): это имя папки, а слово после пути не берётся никогда. Последнее имя с пробелом
  (`c d.test.ts`) хвост не забирает — в нём нет разделителя, который надо переписать, поэтому вид записи тот же.
  Test-ы «replaces every path of a line» — два пути в одной строке для `<repo>` и для `~`, с «\» и с «\\» из JSON,
  без слова между путями, с пробелом в именах папок, `<repo>` и `~` вперемешку, второй путь в написании Git Bash.
  Мутант — прежний `PATH_TAIL` на месте нового (копия файла в scratchpad, восстановлена из неё): vitest exit 1,
  6 красных test-ов (все случаи двух путей с одним корнем); без мутации exit 0. Строки до 200 000 символов
  (десятки тысяч слов, пробелов, разделителей, повторов корня) очищаются за ≤ 7 мс — катастрофического
  backtracking нет; test «runs in milliseconds» держит предел 1 с.
- `rerun.mjs`: своей копии перевода (`REPO_PATH`) больше нет; `errorText()` осталась тонкой обёрткой
  `firstLine(scrub(…))`, потому что её импортирует contract `test/contract/gate-failures-rerun.test.ts`. Ожидания
  contract-а не менялись, он зелёный.
- Unit test-ы (`test/unit/gate-failures-format.test.ts`, блок «a Windows path under the root or the home folder»):
  корень `D:\a\worfy\worfy` с «\», «\\», `/d/…`, `/mnt/d/…`, `d:\…`, `D:/…` и смешанными разделителями;
  домашняя папка `C:\Users\runneradmin` в четырёх написаниях; пробел в имени папки; кавычки, скобки и `:12:5`;
  «\» в словах после пути; путь вне корня и домашней папки; POSIX-путь; запись через `scrubRecord()`. Два старых
  ожидания (`~\x`, `<repo>\test\a.test.ts`) поменялись на «/» — это и есть поведение тикета.
- Мутант «до первого пробела» (`PATH_TAIL` без `(?: +…)*`) на копии в scratchpad: vitest exit 1, красные test-ы
  «пробел в имени папки» и «кавычки и `:12:5`»; та же копия без мутации — exit 0.
- Решено без владельца, подтвердить: (1) серия из одних «/» в хвосте не сжимается (раньше `errorText()` сжимала
  «//» в «/»), чтобы POSIX-путь не менялся; (2) слово после пути, в котором есть «\» без пробела перед ним
  (`<repo>\x.ts vs a\b`), считается частью пути — отмечено `shortcut:` в коде, переделать, если такая строка появится в
  записи.
- Scope PR — `runner` (`node scripts/windows-verdict-scope.mjs origin/main HEAD`, exit 0): Windows-проверка — job-ы
  Windows в CI PR, gate full на ПК не нужен.

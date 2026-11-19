# 121 — e2e linked-*: icacls называет учётную запись SYSTEM через имя хоста, setup падает на ПК

Type: bug
Status: open
Blocked by: none
Source: решение владельца 2026-11-20 («со всем согласен»); issue #1513 (метка `pc-main-red`, закрыт решением
владельца 2026-11-20; в его теле — export `gate-failures` gate full на ПК от 2026-11-06, SHA `e832f0fad`).
Платформенный: делает Session на ПК, проверяет и вливает Mac (ADR-0056); scope `pc` (`test/e2e/**` в
`scripts/windows-verdict-scope.mjs`).

Кто: агент. Глубина review — `medium`.

## Что происходит

- На ПК владельца три e2e test-а красные до того, как test трогает приложение: падает их setup. В issue #1513 они
  красные и в gate full, и в повторе по одному (`gate-failures rerun --last`, exit 2):
  - `test/e2e/linked-add-project.spec.ts:207` — «in A: Add project → Machine B → B's folders → a repository: …»;
  - `test/e2e/linked-add-project.spec.ts:272` — «B with access off: B cannot be chosen in the Machine step, and says why»;
  - `test/e2e/linked-machines.spec.ts:417` (на текущем `main` — строка 430) — «Settings → Machines in the smallest
    window: a refusal of main is shown as it is; …».
- Ошибка во всех трёх: `Error: Command failed: icacls <tmp>/…/locked /remove:d <host>\SYSTEM` (у третьего —
  `<tmp>/…/link`).
- Учётную запись собирает `thisUser()` в `test/e2e/helpers.ts`: `${USERDOMAIN}\${USERNAME}`. По строке ошибки на ПК
  `USERNAME=SYSTEM`, и выходит `<host>\SYSTEM`. Такой учётной записи нет: SYSTEM называется `NT AUTHORITY\SYSTEM`, и
  icacls не находит имя. Почему gate на ПК идёт с этим `USERNAME`, не установлено — записать в «Итог». На GitHub
  runner-е test-ы идут от обычного пользователя, поэтому там ошибки нет.
- `icacls()` (тот же файл, около строки 34) бросает исключение при любом ненулевом exit code. Его зовут
  `setReadable` (`linked-add-project.spec.ts:120`) и `setWritable` (`linked-machines.spec.ts:58`).

## Что делаем

1. Называть учётную запись для icacls так, чтобы имя хоста не участвовало: по SID. Кандидат — SID текущего процесса
   (`whoami /user`, в icacls — `*<SID>`); для SYSTEM это well-known SID `*S-1-5-18`. Выбор и причину записать в
   «Итог».
2. Логику имени вынести в функцию, которую можно проверить без Windows: на вход — то, что она читает (переменные
   окружения или вывод `whoami`), на выход — строка для icacls.
3. Test на эту функцию: случай SYSTEM (`USERDOMAIN` — имя хоста, `USERNAME=SYSTEM`) даёт `*S-1-5-18`, а не
   `<host>\SYSTEM`; случай обычного пользователя даёт его SID. Mutant «вернуть `${USERDOMAIN}\${USERNAME}`» — красный.
4. `setReadable` и `setWritable` берут имя из новой функции; `thisUser()` убрать, если больше не нужен.

## Готово, когда

- [ ] Учётная запись для icacls называется без имени хоста (SID); `thisUser()` с `USERDOMAIN\USERNAME` в e2e не
      осталось.
- [ ] Test новой функции зелёный; mutant с именем через хост — красный (запуск и exit code в «Итог»).
- [ ] Setup трёх test-ов проходит на ПК: gate full на ПК (scope `pc`) на head PR или после Wave, три test-а не
      падают на icacls.
  - needs: windows
- [ ] Job-ы `windows / full-suite` CI на PR зелёные.

## Где в коде

- `test/e2e/helpers.ts`: `thisUser()`, `icacls()`.
- `test/e2e/linked-add-project.spec.ts`: `setReadable`, test-ы на строках 207 и 272.
- `test/e2e/linked-machines.spec.ts`: `setWritable`, test «Settings → Machines in the smallest window».

## Вне скоупа

- Остальные три красных из issue #1513 (`codex-app-server`, `projects-connect`, `terminal.spec.ts:667`): в повторе по
  одному они зелёные — flaky test-ы, не этот Ticket.

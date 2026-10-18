# 65 — `harness-evals.test.ts` на Windows: дочерний процесс не видит настоящий home, скрипты Harness через `node`, CRLF во front matter

Type: bug
Status: open
Blocked by: —
Source: PR #496 (`worfy-harness` 27): замеры Session на Windows-ПК на main `74455f70` ([комментарий 6254019222](https://github.com/IDSAD-XL/worfy/pull/496#issuecomment-6254019222)) и на head `20823b78` ([комментарий 6254249938](https://github.com/IDSAD-XL/worfy/pull/496#issuecomment-6254249938)); вопрос Q-e утреннего списка 2026-10-19 (мерж #496 при красном на Windows файле); решение владельца 2026-10-19, пункт 1: сначала main зелёный на Windows ([Ticket 14](14-gate-full-на-windows.md), часть unit/contract, и этот Ticket); решение владельца 2026-10-09 о CRLF ([Ticket 14](14-gate-full-на-windows.md), «Что происходит»; evidence Ticket-а 01, раздел 27).

## Что происходит

- `test/contract/harness-evals.test.ts` красный на Windows на main: на `74455f70` — exit 1, 52 упали,
  83 прошли, 8 пропущены (замер ПК). Сами eval-случаи (`pnpm eval:harness`, `claude plugin eval`) идут
  только на Mac и платные; этот test — их бесплатная часть, и на Windows он должен быть зелёным.
- **Причина 1: скрипт с shebang, запущенный по пути.** `harness()` (`:81-88`) делает
  `spawnSync(join(HARNESS, 'bin', script), …)`. На Windows Node без shell запускает только `.exe` и
  `.com`: `error.code === 'ENOENT'`, `status === null` — отсюда «expected null to be +0» у
  `bin/profile -C <fixture>`, `epic-status` и случаев с `EVAL_HARNESS_HOME`. Нужен `node <скрипт>` —
  так сделал Ticket 30 для `project-connect`. Та же причина у stub-а `claude` в разделе
  «pnpm eval:harness (… claude replaced by a stub)» (`:441`): stub — shell-скрипт с `chmod 755`
  (`#!/usr/bin/env node`, `:298`, `:372`), на ПК `spawnSync …\claude ENOENT` (Ticket 14, «Что происходит»).
- **Причина 2: CRLF в файлах случаев.** У `harness/evals/**` нет правила `eol` в `.gitattributes`, на
  ПК `core.autocrlf=true`, и `case.yaml`, `prompt.md` и grader-ы приходят с CRLF. `frontMatter`
  (`:35`) ищет `^---\n` и ничего не находит: падают «has prompt.md …», «has at least two graders …» и
  test grader-а gate. Решение владельца 2026-10-09 (Ticket 14): CRLF-случай чинит test — `\r?\n` в
  `frontMatter`, а не LF для `harness/evals/**`: test читает файл в том виде, в каком git отдаёт его
  на машине.
- **Причина 3: путь `/tmp/…` к `pm` из Git Bash.** Fixture пишет в реестр Gate `pm` вида
  `/tmp/…/.git/demo-pm` — путь Git Bash. Gate на Node (`gate.mjs`) через `relative()` читает его как
  путь вне `work`, и gate fixture-а с красным test-ом выходит с кодом 3 («не удалось проверить»), а не 2.
  Видно в двух test-ах gate, которые добавляет PR #496.
- **Опасность, которую откроет починка причины 1.** Helper-ы test-а передают ребёнку белый список
  переменных: `PATH`, `HOME`, `TMPDIR` и немного ещё (`scaffold` `:71-73`, `harness` `:82-84`,
  `inFixture` `:202-205`, env stub-а `claude` `:375-385`). `USERPROFILE` в нём нет. Node на Windows
  берёт home из `USERPROFILE`, а без него спрашивает у Windows папку профиля учётной записи: на ПК
  `os.homedir()` ребёнка с одним `HOME` — настоящий `C:\Users\Alexey` (замер ПК, комментарий
  6254019222). Сейчас вызовы `harness()` без `EVAL_HARNESS_HOME` (на main `:132`, `:191`, `:195`) до этого не доходят
  только потому, что падают на `ENOENT`. Как только скрипт запустится через `node`, test прочтёт
  настоящий реестр владельца в `~/.claude/worfy-harness` и `~/.claude/gate`; скрипт, который пишет,
  записал бы туда. В замере ПК снимок этих папок до и после прогона не изменился — но только потому,
  что ни один скрипт не стартовал.

## Что делаем

1. **Первым шагом, до причины 1: home ребёнка — временная папка и на Windows.** Один helper собирает
   env для каждого запуска в этом файле: `HOME` и `USERPROFILE` — временный home; `HOMEDRIVE` и
   `HOMEPATH` — тоже в него, если замер на ПК покажет, что их читает хоть один ребёнок (Git для
   Windows берёт их, только когда `HOME` не задан). Через этот helper идут `scaffold`, `harness`,
   `inFixture`, env stub-а `claude` и каждый новый `spawn`/`spawnSync`, которому test даёт `HOME`.
   Test этого шага (см. «Тесты») — в том же commit-е, до правки причины 1.
2. **Причина 1.** Скрипты Harness — `process.execPath <скрипт>` с `ELECTRON_RUN_AS_NODE=1` (или тот же
   способ, что у `project-connect` в Ticket 30). Stub `claude` — тем способом, который Ticket 14 (пункт
   7 «Что делаем») выбрал для подмен на Windows; если для этого нужна правка
   `scripts/eval-harness.mjs`, поведение на Mac с настоящим `claude` не меняется.
3. **Причина 2.** `frontMatter` — `/^---\r?\n([\s\S]*?)\r?\n---/`; так же — каждое место файла, которое
   режет текст случая по `\n`. `.gitattributes` не трогаем (решение владельца 2026-10-09).
4. **Причина 3.** `pm` в реестре fixture-а — путь, который Node на Windows понимает как путь внутри
   `work` (например, `pwd -W` или `cygpath -m` в Git Bash), либо сравнение в test-е через нормализацию
   пути. Выбор и довод — в Итог. На Mac fixture пишет то же, что сейчас: eval-случаи идут только там и
   платные.
5. Что ещё красное на ПК после шагов 1–4 — починить или пропустить на `win32` с комментарием: почему и
   какой Ticket снимет пропуск. Список — в Итог.

**Не входит:** запуск eval-случаев (`pnpm eval:harness`) на Windows; правило `eol=lf` для
`harness/evals/**`; правки правил Harness, которые проверяют eval-случаи.

## Готово, когда

- [ ] На ПК владельца `node scripts/vitest-electron.mjs test/contract/harness-evals.test.ts` — exit 0;
      каждый пропуск на `win32` — с комментарием о причине; список — в Итог.
- [ ] На ПК: снимок настоящих `%USERPROFILE%\.claude\worfy-harness` и `%USERPROFILE%\.claude\gate`
      (список файлов с размером и временем изменения) до и после прогона файла — одинаковый; оба
      снимка — в Итог.
- [ ] Test «ребёнок не видит настоящий home» красный на мутанте: helper без `USERPROFILE` (мутант в
      своём worktree, файл возвращён из копии); красный на ПК и красный на Mac — строки vitest в Итог.
- [ ] `git diff origin/main -- .gitattributes` — пусто.
- [ ] На Mac `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; число test-ов `harness-evals` не
      меньше, чем на main.

## Тесты

Сначала падающий test шага 1 — на Mac и на ПК, до правки причины 1.

- `test/contract/harness-evals.test.ts`, новый `describe` «a child process sees the temporary home»:
  - каждый helper запуска (`scaffold`, `harness`, `inFixture`, env stub-а `claude`) отдаёт env, в
    котором `USERPROFILE` равен `HOME` и лежит во временной папке; на Mac и Linux test тоже красный,
    если `USERPROFILE` нет;
  - через env каждого helper-а `process.execPath -e "…os.homedir()…"` с `ELECTRON_RUN_AS_NODE=1`
    печатает временный home, а не `os.homedir()` процесса test-а; на Windows без шага 1 этот test
    красный;
  - текст файла: каждый вызов `spawn`/`spawnSync`, у которого есть `HOME:`, идёт через helper (поиск
    по исходнику, как в `test/contract/windows-tests-workflow.test.ts`), — чтобы новый запуск в обход
    helper-а сделал test красным.
- Существующие test-ы случаев — без изменений смысла: те же проверки, другой способ запуска и разбор
  CRLF.

## Где в коде

- `test/contract/harness-evals.test.ts` (`:35` `frontMatter`; `:59-77` `scaffold`; `:81-88` `harness`;
  `:202-208` `inFixture`; `:364-410` `stubSetup`, env stub-а `claude`)
- `harness/evals/lib/demo-project.sh` — только для причины 3, если `pm` чинится в fixture-е
- `scripts/eval-harness.mjs` — только если stub `claude` на Windows не запускается без правки скрипта

PR #496 (`worfy-harness` 27) меняет тот же test-файл и `harness/evals/lib/demo-project.sh` и
добавляет test-ы gate с причиной 3. Пока он открыт, этот Ticket в Wave не берётся; после его мержа
исполнитель делает rebase и чинит и новые test-ы.

## Вне скоупа

- Остальные красные на Windows unit- и contract-test-ы — часть unit/contract Ticket-а 14.
- `os.userInfo().homedir`, которого нет на диске, в `harness/evals/lib/state-guard.cjs` (файл из PR #496) — находка low
  третьего круга ревью #496, отдельно.

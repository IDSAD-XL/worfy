# 03 — Contract test-ы не читают настоящий `~/.claude`: временный `WORFY_CLAUDE_HOME` по умолчанию

Type: task
Status: claimed — 2026-10-15
Blocked by: —
Source: [spec.md](../spec.md), кандидат R6; `HANDOFF.md`, «Риски и долги»: «[med] Contract test-ы читают
настоящий `~/.claude/settings.json`: если там `model: haiku`, падают 10 test-ов (`worfy-daily` 07 и 23)»;
«Итог» [`worfy-daily` 23](../../worfy-daily/issues/23-настройки-session-node-а.md), подраздел «Где в
коде» (`orchestrator.test.ts` пришлось перевести на временный `WORFY_CLAUDE_HOME`).

## Что происходит

- Папку Claude Code worfy берёт из `WORFY_CLAUDE_HOME`, без неё — `~/.claude` пользователя
  (`src/main/claude-home/registry.ts:2`). Модель и effort по умолчанию — из `settings.json` этой папки
  (`src/main/claude-home/user-model.ts`).
- `WORFY_CLAUDE_HOME` ставят 19 из 97 файлов `test/contract` (`agent-controls.test.ts:4-5` — образец).
  Общего setup-файла у project-а `contract` нет (`vitest.config.ts:61-67`). Остальные файлы читают
  настоящий `~/.claude` машины, где идёт прогон: с `model: haiku` там 10 test-ов красные — test-ы
  зависят от настроек владельца, а не от кода.

## Что делаем

1. **Воспроизвести без касания настоящего `~/.claude`:** прогон project-а `contract` с `HOME` во
   временной папке, где `.claude/settings.json` = `{"model":"haiku"}` и `.gitconfig` с `user.name` и
   `user.email` (git в test-ах берёт их из `HOME`). Список красных test-ов — в «Итог».
2. **`test/setup-contract.ts`** — `setupFiles` project-а `contract`: если `WORFY_CLAUDE_HOME` не задан,
   ставит его на новую пустую временную папку на файл test-ов и удаляет её после. Test, которому нужна
   своя папка, задаёт её сам, как сейчас.
3. **Песочница.** С `WORFY_CLAUDE_HOME` прогон считается песочницей: установка и перенос Harness
   разрешены (`src/shared/ipc/harness.ts:51`, `src/shared/ipc/harness-migration.ts:72`). Test-ы, которые
   проверяют отказ вне песочницы, снимают переменную у себя явно; найти их — `grep -rn "WORFY_CLAUDE_HOME"
   test/contract` и красные прогона после шага 2. Такие файлы исполнитель дописывает в «Где в коде» при claim.

## Готово, когда

- [x] Прогон шага 1 (`HOME` во временной папке, `model: haiku`): `pnpm vitest run --project contract` —
      exit 0; до правки — красный, число красных test-ов — в «Итог».
- [x] Test в `test/contract`: во время test-а `WORFY_CLAUDE_HOME` задан и не равен `~/.claude`
      (`os.homedir()`), и папка пустая, если test её не заполнял.
- [x] Test-ы отказа вне песочницы по-прежнему проверяют отказ (переменная снята у них явно).
- [x] Настоящий `~/.claude` не меняется: список файлов и время изменения `settings.json` до и после
      прогона совпадают (команда и вывод — в «Итог»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- Сначала красный: прогон шага 1 до правки.
- Новый test `test/contract/claude-home-isolation.test.ts` — проверка переменной (пункт 2 «Готово, когда»).
- Мутанты: setup-файл не подключён; папка общая на все файлы (test-ы видят чужие записи); переменная
  ставится и поверх заданной test-ом. Каждый краснит свой test.

## Где в коде

- `vitest.config.ts`
- `test/setup-contract.ts`
- `test/contract/claude-home-isolation.test.ts`
- `test/global-setup-contract.ts` (дописан при работе: папка прогона, см. «Итог»)
- `tsconfig.test.node.json` (дописан при работе: `tsc` проекта test-ов требует перечислить
  `test/setup-contract.ts` и `test/global-setup-contract.ts`, их импортирует test изоляции —
  ошибка TS6307 без этих строк)

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`test/contract/agent-controls.test.ts`, `src/main/claude-home/registry.ts`,
`src/main/claude-home/user-model.ts`, `src/shared/ipc/harness.ts`, `src/shared/ipc/harness-migration.ts`.

## Вне скоупа

- `harness/bin/tests/preflight.test.sh` и его `HOME` (`worfy-harness` 11) — это Harness.
- Project-ы `node` и `jsdom` — сначала найти, читают ли они `~/.claude`; если да — отдельный Ticket.
- e2e: у них своя временная папка в `launchApp`.

## Итог

**Воспроизведение (шаг 1) на `origin/main` 12b46d8 красным не вышло.** `HOME` во временной папке,
`.claude/settings.json` = `{"model":"haiku"}`, `.gitconfig` с `user.name` и `user.email`:
`HOME=<tmp> node scripts/vitest-electron.mjs --project contract` — exit 0, 2278 passed, 41 skipped,
0 failed. Десять красных test-ов из `HANDOFF.md` («Риски и долги») уже ушли: `orchestrator.test.ts` и
`agent-controls.test.ts` сами ставят временный `WORFY_CLAUDE_HOME` (`worfy-daily` 23). Тот же прогон
с `.claude` без прав на чтение (`chmod 000`): 2 красных, оба — timeout 15 с в
`workflow-reader.test.ts` под нагрузкой машины, отдельным прогоном зелёные. Так что правка — защита
на будущее: новый contract test, который забудет поставить переменную, не прочтёт `~/.claude`.

**Что сделано.**
- `test/setup-contract.ts` — `setupFiles` project-а `contract`: если `WORFY_CLAUDE_HOME` не задан
  (пустая строка — как не задана, так же читает `claudeHome()`), ставит его на новую пустую папку
  `claude-home-*` на файл test-ов; `afterAll` удаляет папку (`removeTestTree`) и снимает переменную,
  если она ещё указывает на эту папку. Переменная ставится прямо в `process.env`, не через
  `vi.stubEnv`: `vi.unstubAllEnvs()` в test-е возвращает эту папку, а не снятую переменную.
- `test/global-setup-contract.ts` — `globalSetup` project-а `contract`: одна папка
  `<tmpdir>/worfy-contract-claude-homes-*` на прогон (передаётся файлам через `provide`/`inject`),
  папки файлов — внутри неё; по окончании прогона удаляется целиком. Нужна потому, что vitest не
  запускает `afterAll` в файле, где все test-ы пропущены: первая версия без неё оставляла 6 пустых
  папок на прогон — по одной от каждого такого файла (`cards-watch-links`, `docs-watch-root`,
  `limits-watch-root`, `remote-guards-links`, `terminal-windows`, `workflow-watch-links`).
  `process.once('exit')` в worker-е не сработал (проверено: папки остались). Папки прогона,
  брошенные убитым прогоном, `vitest.config.ts` удаляет через час, как `worfy-glob-probe-*`.
- `test/contract/claude-home-isolation.test.ts` — 6 test-ов: переменная задана в начале файла,
  указывает на папку внутри папки прогона во временной папке системы, не на `~/.claude`, и папка
  пустая; папка прогона удаляется вместе с папкой файла, у которого не было `afterAll`; каждый вызов
  даёт свою папку; заданную переменную не трогает; пустая строка — как не задана; `release`
  удаляет папку и снимает переменную только пока она указывает на неё. Test читает папку только
  после проверки, что она во временной папке системы, и вызывает функции на своих объектах и
  папках, не на `process.env` — настоящий `~/.claude` не читается и при провале.
- Test-ы отказа вне песочницы: такой один — `harness-migrate.test.ts`, «the IPC of a dev build on the
  real ~/.claude»; он уже снимает переменную сам (строки 610–611) и зелёный. Других не нашлось:
  `grep -rn "WORFY_CLAUDE_HOME" test/contract` и сравнение прогонов до и после.

**Мутанты** (в своём worktree, восстановление из копии с `cmp`), прогон
`node scripts/vitest-electron.mjs --project contract test/contract/claude-home-isolation.test.ts`:
- setup-файл не подключён (строка `setupFiles` убрана) — exit 1, красный «is a temporary folder of
  its own, not ~/.claude…»;
- папка общая (постоянное имя вместо `mkdtemp`) — exit 1, красный «gives each call a new empty
  folder…»;
- переменная ставится и поверх заданной (условие убрано) — exit 1, красный «leaves a folder the run
  named as it is…»;
- teardown папки прогона ничего не удаляет — exit 1, красный «is made in the temp directory, given to
  the test files, and removed with every home in it at the end…».

**Какие test-ы сменили поведение.** Полный `pnpm test` до правки (exit 1: 7 красных) и после
(exit 1: 3 красных) сравнены по JSON-отчётам. Все расхождения — timeout 15 с под нагрузкой (load
average 7–10, параллельно шли другие implementer-ы): `docs.test.ts`, `harness-script-wiring.test.ts`
(2), `github-prs.test.ts` (2), `workflow-profile.test.ts`, `workflow-reader.test.ts` (3). Пять этих
файлов отдельным прогоном: с правкой — 233 из 234 (timeout в `harness-script-wiring`), без —
233 из 234 (timeout в `github-prs`); `harness-script-wiring.test.ts` один — 21 из 21 и с правкой
(дважды), и без. Новые только 5 test-ов изоляции. На машине владельца (`model: opus[1m]`) ни один
test поведение не сменил.

**Прогон шага 1 после правки:** exit 1 — 1 красный из 2324, timeout `workflow-reader.test.ts` под
нагрузкой; этот файл отдельно под тем же `HOME` — exit 0, 44 из 44.

**Настоящий `~/.claude` не изменился.** До и после всех прогонов:
`stat -f '%m %N' ~/.claude/settings.json` → `1792033835 /Users/alexey/.claude/settings.json` оба раза;
`diff <(ls -la ~/.claude | awk '{print $NF}') …` — без различий, exit 0.

**Вне скоупа замечено:** project `jsdom` гоняет и `test/contract/**/*.test.tsx`, setup-файл у него
свой (`test/setup-dom.ts`) — эти файлы переменную не получают.

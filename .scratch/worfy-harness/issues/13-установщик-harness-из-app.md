# 13 — Установщик: worfy ставит Harness своей версии как plugin `worfy`

Type: task
Status: claimed — 2026-10-07
Blocked by: 04, 12
Source: решения владельца 2026-10-07, Q1, Q2, Q4, Q12, Q22, Q8; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (доставка Harness: копия `harness/` из `.app` в `~/.claude/worfy-harness/plugin/`, локальный marketplace, plugin `worfy` в области пользователя, версия `<semver>+<SHA>`); ADR-0048 (будет `docs/adr/0048-harness-plugin-spike-results.md`; итог spike Ticket-а 01: установка plugin встроенным `claude`); [spec.md](../spec.md)

## Что происходит

- Harness владельца — разрозненные файлы в `~/.claude` (`agents/`, `skills/`, `bin/`, `hooks/`),
  связанные записями hooks в `~/.claude/settings.json` (`$HOME/.claude/hooks/session-start.sh`,
  `$HOME/.claude/hooks/gate.sh fast` и другие). Их никто не ставит и не обновляет; worfy их только
  читает.
- После Ticket-а 02 (импорт Harness в репозиторий) исходник Harness лежит в `harness/` с манифестом
  `harness/.claude-plugin/plugin.json` (`name: worfy`). После Ticket-а 04 (версия) сборка пишет туда
  строку `<semver>+<короткий SHA>`. После Ticket-а 12 (worfy находит Harness в папке plugin) worfy
  ищет скрипты Harness в `~/.claude/worfy-harness/plugin/` и передаёт Session-ам worfy plugin своей
  версии inline. Саму папку `~/.claude/worfy-harness/plugin/` пока никто не создаёт.
- `src/main/storage/paths.ts:37-43`: `claudeHome()` — «read but never written by worfy»;
  `WORFY_CLAUDE_HOME` подменяет `~/.claude` в test-ах. Установщик — первое место, где worfy пишет в
  `~/.claude`; это исключение из ADR-0005 оформляет ADR-0040.
- `electron-builder.yml:9-10` кладёт в `.app` только `out/**` и `package.json`, `extraResources` нет.
  Лежит ли `harness/` в `.app` после Ticket-ов 04 и 12 — проверить: `grep -n harness electron-builder.yml`,
  `ls dist/mac*/worfy.app/Contents/Resources`.
- Встроенный бинарь Claude Code: в упакованном приложении путь даёт `claudeExecutablePath()`
  (`src/main/agent/options.ts:46`) —
  `<Resources>/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`.
  В dev функция отдаёт `undefined`, и SDK находит бинарь сам. Бинарь SDK 0.3.289 знает
  `claude plugin marketplace add|list|remove|update` и `claude plugin install|update|list|enable|disable`;
  у `install`, `update` и `list` есть `--json` (`claude plugin --help`, 2026-10-07).
- Точки расширения без правки общих файлов: IPC-домен — свой файл в `src/main/ipc/`
  (`src/main/ipc/index.ts:59`, ADR-0006), элемент toolbar — свой файл в `src/renderer/shell/toolbar/`
  (`src/renderer/shell/Toolbar.tsx:8`). Согласие пользователя нативным диалогом — как
  `src/main/ipc/card-api.ts:59`; e2e подменяет диалог в main, как `test/e2e/card-api.spec.ts:135-143`.

## Что делаем

1. **Harness — в `.app`.** `harness/` этой сборки лежит в `.app` как `Contents/Resources/harness/`
   (`extraResources` в `electron-builder.yml`). Если Ticket 04 или 12 уже положил его туда — здесь
   только `@packaged` test. Источник копии — путь из `src/main/harness/bundled.ts` Ticket-а 04: в
   `.app` — `<resourcesPath>/harness`, в dev и в песочнице — `out/harness/` (копия с `version`, без
   test-ов), а не `harness/` рабочего дерева.
2. **Состояние (Q1, Q12).** Модуль установщика сравнивает строку `version` из
   `~/.claude/worfy-harness/plugin/.claude-plugin/plugin.json` со строкой этой сборки. Состояния:
   «не установлен», «установлен, версия та же», «нужно обновить (было → стало)», «ошибка (шаг,
   причина)». Включён ли plugin — по `claude plugin list --json`. Чтение состояния ничего не пишет.
   Путь `~/.claude/worfy-harness/` (Q4) — из того же helper-а, которым Ticket 12 находит Harness
   (`grep -rn "worfy-harness" src/main`); если такого helper-а нет — `harnessHome()` в
   `src/main/storage/paths.ts` от `claudeHome()`.
3. **Установка и обновление — только с согласия (Q22).** При запуске worfy только считает
   состояние. Действие — кнопка в UI и нативный диалог, где названы папка, команды `claude plugin` и
   версии «было → стало». После «да»:
   - копия `harness/` этой сборки в `~/.claude/worfy-harness/plugin/` целиком: сначала во временную
     папку рядом, потом переименование. Файлов, которых нет в новой версии, после копии нет. При сбое
     прежняя копия остаётся как была;
   - регистрация этой папки как локального marketplace и `claude plugin install worfy@<marketplace>
     --scope user` встроенным бинарём (Q1). Точные команды, где лежит манифест marketplace
     (`.claude-plugin/marketplace.json`) и кто его пишет, имя marketplace, коды выхода, повтор — по
     ADR-0048 (итог Ticket-а 01). Чего в ADR-0048 нет, исполнитель проверяет в песочнице и пишет в
     «Итог»;
   - обновление — когда строка `version` сменилась (Q12): та же копия и команда обновления по
     ADR-0048.
4. **Имя — `worfy` (Q2).** Plugin `worfy`, skills зовутся `/worfy:…`, Subagent-ы — `worfy:…`.
5. **dev-сборка не меняет Harness пользователя.** `app.isPackaged` false и `WORFY_CLAUDE_HOME` не
   задан — состояние видно, кнопки нет. Иначе dev-run из worktree заменил бы Harness, на котором
   работают терминал и Stable copy, своей версией (ADR-0023 разводит данные dev и packaged по той же
   причине). С `WORFY_CLAUDE_HOME` (песочница test-ов) установка доступна.
6. **Состояние в UI.** Новый элемент toolbar: «Harness not installed», «Harness <версия>», «Update
   Harness», ошибка с именем шага. Кнопка Install или Update открывает диалог согласия. Подписи — по-
   английски (`docs/design/BRIEF.md`). IPC состояния и действия потом берёт экран первого запуска
   (Ticket 19).
7. **Ошибка понятна.** Нет бинаря, `claude` вернул код не 0, сбой копии — состояние «ошибка» с шагом
   (`copy`, `marketplace add`, `install`, `update`) и последними строками stderr. Прежняя копия plugin
   цела.
8. **Зависимость `mattpocock-skills`** (Q19, объявлена в `plugin.json` Ticket-ом 02). Что делает
   `install`, когда marketplace зависимости не добавлен или нет сети, — по ADR-0048; если там этого
   нет — проверить в песочнице и записать в «Итог». Отказ `install` из-за зависимости — состояние
   «ошибка» с причиной, а не тихий успех. Диалог согласия называет зависимость.
9. **Что пишет worfy.** Сам worfy пишет только в `~/.claude/worfy-harness/plugin/`. Записи
   `extraKnownMarketplaces` и `enabledPlugins` в `settings.json` и папку `~/.claude/plugins/` пишет
   `claude plugin`. Больше ничего в `~/.claude` установщик не меняет.

**Не входит:** перенос старых файлов Harness из `~/.claude` (Ticket 14); мост Limits (Ticket 15);
qmd (Ticket 17); проверка `claude --version` и экран первого запуска (Ticket 19, Q20, Q22); inline
plugin в Session-ах worfy (Ticket 12); пометка «Harness в main новее» (Ticket 21); установка на
машине владельца (Ticket 16).

## Готово, когда

Песочница во всех пунктах, кроме `@packaged`: временная папка, в которой `HOME`, `CLAUDE_CONFIG_DIR`
и `WORFY_CLAUDE_HOME` указывают внутрь неё (Q8). На настоящем `~/.claude` установщик в этом Ticket-е
не запускается.

- [x] Contract test с подменённым `claude` (пишет аргументы и env в файл): без `worfy-harness/plugin/` состояние — «не установлен»; чтение состояния не создаёт ни одного файла.
- [x] Тот же test: после согласия дерево `worfy-harness/plugin/` побайтно совпадает с копией Harness этой сборки (путь из `bundled.ts`), включая `.claude-plugin/plugin.json` с `<semver>+<SHA>`; подменённый `claude` получил команды ADR-0048 по порядку (регистрация marketplace с папкой plugin, затем `install worfy@<marketplace> --scope user`) с `HOME` и `CLAUDE_CONFIG_DIR` песочницы; состояние — «установлен, <версия>».
- [x] Повторный запуск с той же версией: копии нет, `claude` вызван только для `plugin list`.
- [x] Другая версия: диалог показывает «было → стало»; после согласия файла, которого нет в новой версии, в папке plugin нет; вызвана команда обновления по ADR-0048.
- [x] Отказ в диалоге: ничего не записано, `claude` не вызван.
- [x] Код не 0 у `claude` на каждом шаге и отсутствие бинаря — состояние «ошибка» с именем шага и хвостом stderr. Сбой посреди копии (подменяется в test-е) — прежняя папка plugin побайтно цела.
- [x] Снимок дерева песочницы до и после установки с подменённым `claude`: worfy записал только `worfy-harness/plugin/`; `settings.json` песочницы побайтно прежний.
- [x] Unit test: dev-сборка без `WORFY_CLAUDE_HOME` установку не предлагает, состояние показывает.
- [x] Только macOS (`skipIf(process.platform !== 'darwin')`), локально в `gate full`: тот же сценарий с настоящим встроенным бинарём в песочнице — `claude plugin list --json` с `CLAUDE_CONFIG_DIR` песочницы показывает `worfy` включённым и с версией сборки; ключи, которые были в `settings.json` песочницы до установки, на месте; повторная установка — код 0. Если `claude plugin` в песочнице требует входа, один `/login` делает владелец (Q8): исполнитель пишет это в «Итог», пункт — в HANDOFF, раздел «Ждёт владельца».
- [x] `@packaged` test в `test/e2e/packaged.spec.ts` (локально, `pnpm test:package` в `gate full`): в `.app` есть `Contents/Resources/harness/.claude-plugin/plugin.json` с `name: worfy` и версией этой сборки.
- [x] e2e с временным `WORFY_CLAUDE_HOME` и подменённым `claude`: toolbar показывает «Harness not installed»; Install → диалог (ответ подменён в main) → «Harness <версия>». В `test/e2e/toolbar.spec.ts` (окно 1280 px, длинное имя Project) новый элемент целиком в окне.

## Тесты

Сначала падающий test — `test/contract/harness-install.test.ts`: в песочнице без папки plugin
состояние — «не установлен», после согласия папка plugin равна `harness/` сборки. На main модуля
установщика нет — test красный. В «Итог» — как он падал.

- `test/contract/harness-install.test.ts` — новый: состояние, установка, обновление, отказ, ошибки
  по шагам, снимок записей; случай с настоящим бинарём — под `skipIf` не на macOS.
- `test/e2e/harness-install.spec.ts` — новый: элемент toolbar и диалог.
- `test/e2e/packaged.spec.ts` — `harness/` в `.app`.
- `test/e2e/toolbar.spec.ts` — новый элемент в окне 1280 px.

Подменённый `claude` подставляется так же, как `gh` через `WORFY_GH` (`src/main/ipc/checks.ts:68-73`):
имя переменной окружения выбирает исполнитель и пишет в «Итог». В песочнице `WORFY_CLAUDE_HOME` и
`CLAUDE_CONFIG_DIR` указывают на одну папку, чтобы worfy и `claude` видели один `~/.claude`.

## Где в коде

- `src/main/harness/install.ts` — новый: состояние, копия, вызовы claude plugin
- `src/main/ipc/harness.ts` — новый
- `src/shared/ipc/harness.ts` — новый
- `src/renderer/shell/toolbar/HarnessStatus.tsx` — новый
- `src/main/storage/paths.ts` — helper пути, если его не завёл Ticket 12
- `src/main/agent/options.ts` — путь встроенного бинаря и в dev, если установщику он нужен
- `electron-builder.yml` — harness в .app, если его ещё нет
- `harness/.claude-plugin/marketplace.json` — новый, если ADR-0048 кладёт манифест marketplace в репозиторий
- `test/contract/harness-install.test.ts` — новый
- `test/e2e/harness-install.spec.ts` — новый
- `test/e2e/packaged.spec.ts`
- `test/e2e/toolbar.spec.ts`

Только чтение: `src/main/harness/bundled.ts` (Ticket 04) — путь и версия копии Harness этой сборки.

Не меняются: `src/main/ipc/index.ts` и `src/renderer/shell/Toolbar.tsx` (новые файлы находятся сами),
`scripts/install-stable.sh`. Файл `HarnessStatus.tsx` потом дополняет Ticket 14 (кнопка формы
переноса), он идёт после этого Ticket-а. `electron-builder.yml` и `test/e2e/packaged.spec.ts` потом
меняет Ticket 15, тоже после этого.

## Итог

- `src/main/harness/install.ts` — установщик. Состояние: `not-installed`, `installed` (версия, включён ли),
  `outdated` (было → стало), `error` (шаг `copy` / `marketplace add` / `install` / `update` / `plugin list`
  и хвост stderr, 5 строк). Чтение состояния ничего не пишет; без папки plugin оно не вызывает даже
  `claude`. Включён ли plugin и его версия — из `claude plugin list --json` (запись `worfy@worfy-harness`).
- Команды — по ADR-0048: первая установка — `claude plugin marketplace add <harnessHome>/plugin`, затем
  `claude plugin install worfy@worfy-harness --scope user`; смена `version` — `claude plugin update
  worfy@worfy-harness --scope user`. Повторный `install` версию не меняет, поэтому при смене версии идёт
  только `update`. Одна и та же версия — ни копии, ни диалога, `claude` вызван только для `plugin list`.
- Манифест marketplace — `harness/.claude-plugin/marketplace.json` в репозитории: marketplace `worfy-harness`,
  plugin `worfy` с `source: "./"`. Копия Harness сама и marketplace, и plugin (ADR-0048, пункт 3). В `.app`
  он едет с `harness/` сборки Ticket-а 04; `electron-builder.yml` не менялся.
- Копия: `bundledHarnessDir()` (`out/harness` в dev, `<Resources>/harness` в `.app`) → временная папка
  `<harnessHome>/.plugin-new-*` → прежняя папка отодвигается в `.plugin-old-*` → новая встаёт на место →
  прежняя удаляется. Сбой копии оставляет прежнюю папку побайтно. Если прошлый запуск оборвался между
  двумя переименованиями (папки `plugin/` нет, прежняя лежит в `.plugin-old-*`), следующая установка сначала
  возвращает её на место.
- Бинарь: `bundledClaudeBinary()` в `src/main/agent/options.ts` — бинарь SDK и в `.app`, и в dev (пакет
  `@anthropic-ai/claude-agent-sdk-<platform>-<arch>` рядом с SDK). Подменённый `claude` для test-ов —
  переменная окружения **`WORFY_CLAUDE`** (как `WORFY_GH`). С `WORFY_CLAUDE_HOME` установщик передаёт
  `claude` `CLAUDE_CONFIG_DIR` той же папки.
- dev-сборка без `WORFY_CLAUDE_HOME` показывает состояние без кнопки; `harness.install` в ней отказывает
  до диалога.
- IPC: `harness.state` и `harness.install` (`src/shared/ipc/harness.ts`, `src/main/ipc/harness.ts`), их же
  возьмёт экран первого запуска (Ticket 19). Toolbar: `src/renderer/shell/toolbar/HarnessStatus.tsx`, между
  Limits и версией: «Harness not installed» + Install, «Update Harness» (в подсказке было → стало),
  «Harness <версия>», «Harness error: <шаг>» (причина в подсказке) + Retry.
- **Зависимость `mattpocock-skills`** (ADR-0048 о ней молчит; проверено в песочнице встроенным бинарём
  2.1.289, без входа и с закрытым прокси): `marketplace add` и `install` — код 0, `outcome: ok`, хотя
  marketplace `claude-plugins-official` в песочнице не добавлен. `plugin list --json` показывает `worfy`
  включённым, с версией сборки и с `errors: ["Dependency \"mattpocock-skills@claude-plugins-official\" is
  not installed — run …"]`. Повторный `install` — код 0, «1 dependency still unresolved». worfy показывает
  это как «ошибка, шаг `install`» с этим текстом, а не как успех; диалог согласия называет зависимость и
  команду, которой её ставить. Входа `claude plugin` в песочнице не потребовал — `/login` владельца не нужен.
  **Решено без владельца, подтвердить:** worfy сам зависимость не ставит (её marketplace — чужой, сеть), а
  только называет. Кнопка Retry в этом состоянии ничего не делает: версия та же, установщику делать нечего.
- Красный test первым: на main модуля `src/main/harness/install.ts` нет (`git show origin/main:src/main/harness/install.ts`
  — «exists on disk, but not in 'origin/main'»), импорт в `test/contract/harness-install.test.ts` падает,
  файл test-а красный целиком. Test возврата прежней копии после оборванной установки до правки падал на
  `expect(treeOf(plugin)).toEqual(before)` — папка была пуста (`{}`).
- Test-ы: `test/contract/harness-install.test.ts` (состояние, установка, повтор, обновление, отказ, две
  установки сразу, ошибки по шагам, нет бинаря, сломанный plugin, сбой копии, оборванная установка, снимок
  записей песочницы, dev-сборка, диалог; настоящий бинарь — `skipIf` не macOS), `test/unit/harness-status.test.tsx`
  (вид элемента toolbar: без права установки кнопки нет), `test/e2e/harness-install.spec.ts`,
  `test/e2e/toolbar.spec.ts`, `test/e2e/packaged.spec.ts` (`marketplace.json` в `.app`, «Harness not
  installed» + Install в упакованном приложении).
- Снимки toolbar в обеих темах: не установлен — [светлая](../evidence/13-harness-not-installed-light.png),
  [тёмная](../evidence/13-harness-not-installed-dark.png); установлен — [светлая](../evidence/13-harness-installed-light.png),
  [тёмная](../evidence/13-harness-installed-dark.png); «Update Harness» (было) — [светлая](../evidence/13-harness-update-light.png),
  [тёмная](../evidence/13-harness-update-dark.png); после обновления (стало) — [светлая](../evidence/13-harness-updated-light.png),
  [тёмная](../evidence/13-harness-updated-dark.png); ошибка шага — [светлая](../evidence/13-harness-error-light.png),
  [тёмная](../evidence/13-harness-error-dark.png).
- Не проверено: вид нативного диалога согласия на снимке. Агент в приложении не снимает экран средствами
  ОС (PR #120), Playwright нативный диалог не видит. Текст диалога проверяет e2e с подменённым диалогом
  (кнопки, «Update the worfy Harness <было> → <стало>?», команды, папка, зависимость) и прикладывает его к
  отчёту Playwright (`13-harness-dialog-update.json`).

# 74 — CI берёт binary Electron из `actions/cache`, а не из GitHub releases

Type: task
Status: done 2026-11-08T14:36Z
PR: #1668
Branch: worfy-polish/74
Blocked by: —
Source: решение владельца 2026-11-08 (Q8): с утра GitHub releases отвечает HTTP 504 на zip Electron, и CI красный
до первого test-а. Строки перечитаны по main `ac77622d4`.

## Что происходит

Electron 44 скачивает свой binary не при `pnpm install`, а при первом `require('electron')`
(`node_modules/electron/index.js` → `install.js` → `@electron/get`). Значит, каждый job CI, которому нужен Electron,
сам идёт за `electron-v44.10.2-<os>-<arch>.zip` в GitHub releases: shard-ы `linux-tests`, `macos-tests`, `macos-e2e`,
`macos-package`, `windows-e2e` в `.github/workflows/ci.yml` и оба job-а `.github/workflows/windows-tests.yml`
(`listed-tests`, `full-suite`). С утра 2026-11-08 releases отвечает 504, и job падает до любого test-а:
«HTTPError: Response code 504 … electron-v44.10.2-darwin-arm64.zip», затем «electron.launch: Electron failed to install
correctly». Кэша между run-ами нет: `actions/setup-node` с `cache: pnpm` хранит только store pnpm, а binary лежит в
`node_modules/electron/dist`, которого в store нет.

Где `@electron/get` 5.1.0 (зависимость `electron` 44.10.2) держит скачанный zip: `cacheRoot` из
`process.env.electron_config_cache` (`node_modules/electron/install.js`), без него — `env-paths('electron').cache`:
`~/.cache/electron` (или `$XDG_CACHE_HOME/electron`) на Linux, `~/Library/Caches/electron` на macOS,
`%LOCALAPPDATA%\electron\Cache` на Windows. Внутри — папка `<sha256 адреса>/electron-v<version>-<os>-<arch>.zip`. На
попадании в кэш zip сверяется с `checksums.json` пакета `electron`, без сети. Переменную `ELECTRON_CACHE` ни `install.js`,
ни `@electron/get` 5.1.0 не читают.

## Что делаем

1. В каждом job-е, которому нужен Electron, сразу после `pnpm install --frozen-lockfile` — одни и те же четыре step-а:
   - `Read the Electron version` (id `electron`): версия из `node_modules/electron/package.json`, то есть ровно та, что
     записана в lockfile, — в output `version`;
   - `Restore the Electron download` (id `electron-cache`, `actions/cache/restore`): папка
     `${{ runner.temp }}/electron-cache`, key `electron-<runner.os>-<runner.arch>-<version>`;
   - `Download the Electron binary`: `node scripts/download-electron.mjs` с `electron_config_cache` на эту папку и
     `DEBUG=@electron/get:*`; на тёплом кэше zip берётся из неё, и GitHub releases не спрашивают;
   - `Save the Electron download` (`actions/cache/save`): только при промахе (`cache-hit != 'true'`), сразу после
     скачивания, а не в конце job-а, — кэш пополняется, даже если test-ы потом упадут.
   Холодный кэш скачивает zip, как раньше. Shared composite action-а в репозитории нет (`.github/actions/` не
   заведена), поэтому step-ы повторены в каждом job-е, а одинаковость их проверяет contract test.
2. `macos-package` уже скачивал binary отдельным step-ом — этот step становится частью тех же четырёх.
3. `lint-typecheck` и `changes` Electron не запускают — их не трогаем.
4. Повтор холодного скачивания (review round 1, medium): `scripts/download-electron.mjs` запускает
   `node node_modules/electron/install.js` (тот же файл, что запускает `require('electron')`, когда binary нет) до 3
   раз, с паузами 20 s и 60 s, печатает одну строку на попытку и выходит с кодом последней. В run 42472260347 этого PR
   shard `linux-tests (2/4)` получил «Response code 503» на `electron-v44.10.2-linux-x64.zip`, а shard-ы 1/4 и 3/4 в ту
   же минуту скачали тот же файл: отказы — одиночные запросы, а `@electron/get` их не повторяет. Неудачная попытка
   ничего не оставляет: zip сверяется с `checksums.json` до того, как попадёт в кэш (`dist/index.js`), а `path.txt`
   пишется только после распаковки. Для test-а: `DOWNLOAD_ELECTRON_INSTALL` — подставной install script,
   `DOWNLOAD_ELECTRON_WAITS_MS` — паузы в ms через запятую (попыток на одну больше, чем пауз).
5. Test-ы: `test/contract/ci-workflow.test.ts` — каждый job, который запускает `pnpm test`, `pnpm test:e2e` или
   `pnpm test:package`, несёт эти четыре step-а сразу после install, слово в слово одинаковые, и ни в одном `run` нет
   `${{`; `test/contract/windows-tests-workflow.test.ts` — новые step-ы в списках step-ов, команд, `if:` и выражений
   обоих job-ов; `test/unit/download-electron.test.ts` — успех с третьей попытки, отказ после трёх с кодом последней,
   ни одной попытки после успеха (подставной install script, паузы 0). Пределы (timeout-ы, 10 и 60 минут) не меняются.

Ограничения: только бесплатные стандартные runner-ы; никакого `pull_request_target` и secrets; timeout-ы test-ов и
job-ов не меняются; ручных повторов CI нет.

Кэш PR-а виден только этому PR-у; кэш `main` виден всем PR-ам. Push в `main` запускает все job-ы и наполняет кэш для
Linux X64, macOS ARM64 и Windows X64, так что после merge PR-ы берут binary из кэша `main`.

Глубина review — `medium`. **Платформенный**: меняется CI, вердикт — job-ы Windows в CI.

## Готово, когда

- [ ] В каждом job-е CI с Electron (`linux-tests`, `macos-tests`, `macos-e2e`, `macos-package`, `windows-e2e`,
  `listed-tests`, `full-suite`) после install стоят одни и те же четыре step-а кэша Electron; key — ОС, arch и версия
  Electron из lockfile.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/ci-workflow.test.ts` exit 0; the four Electron steps line by line in the 7 jobs that run pnpm test or vitest-electron, none elsewhere; the version step output equals the lockfile entry · mac - · d80ea114b
- [ ] Тёплый кэш не идёт в сеть: локально, с zip в папке `electron_config_cache` и сетью, закрытой мёртвым proxy
  (`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9`), `node scripts/download-electron.mjs` — exit 0 с первой
  попытки, «Cache hit» в `DEBUG=@electron/get*`; с пустой папкой — три неудачные попытки, exit 1, папка пуста. Не `ELECTRON_MIRROR`: другой mirror меняет адрес, а
  папка в кэше — sha256 адреса, так что кэш промахнулся бы.
  - evidence: test-run pass · `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9 electron_config_cache=<dir> node scripts/download-electron.mjs` exit 0 on attempt 1 with the 44.10.2 zip (Cache hit); empty dir: 3 failed attempts, exit 1, dir left empty · mac - · d80ea114b
- [ ] `scripts/download-electron.mjs` повторяет install.js до 3 раз (20 s, затем 60 s), код выхода — последней попытки,
  после успеха попыток больше нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/download-electron.test.ts` exit 0 (6 tests); red on a mutant with one attempt (4 failed) and on one that goes on after a success (1 failed) · mac - · d80ea114b
- [ ] `test/contract/ci-workflow.test.ts`, `test/contract/windows-tests-workflow.test.ts`,
  `test/unit/download-electron.test.ts`, `actionlint` (если есть),
  `check-cyrillic`, lint, typecheck, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0; download-electron unit test, ci-workflow, windows-tests-workflow, ci-scope-e2e contract tests, check-cyrillic, lint, typecheck exit 0; actionlint not installed · mac - · d80ea114b
- [ ] `ci-ok` зелёный на head PR, job-ы Windows в нём зелёные.
  - evidence: ci-check pass · ci-ok https://github.com/IDSAD-XL/worfy/actions/runs/42473303758/job/128717042218 · mac - · 1f9a84ed4d3b4b2005807d649cdd9ca3ed4f08a7

## Тесты

- `node scripts/vitest-electron.mjs test/unit/download-electron.test.ts test/contract/ci-workflow.test.ts
  test/contract/windows-tests-workflow.test.ts test/contract/ci-scope-e2e.test.ts`.
- Второй run того же head PR: в step-е `Restore the Electron download` — «Cache restored from key: electron-…», в step-е
  `Download the Electron binary` — строка `@electron/get:index Cache hit` и «attempt 1 of 3 succeeded», нет строки
  «Downloading https://…»; step `Save the Electron download` пропущен. Строка «Downloading Electron binary...» — не
  признак промаха: `node_modules/electron/index.js` печатает её и при попадании (и `download-electron.mjs` её не
  печатает вовсе, он запускает `install.js` напрямую).

## Где в коде

- `.github/workflows/ci.yml` — job-ы `linux-tests`, `macos-tests`, `macos-e2e`, `macos-package`, `windows-e2e`;
  комментарий в начале файла.
- `.github/workflows/windows-tests.yml` — job-ы `listed-tests`, `full-suite`.
- `test/contract/ci-workflow.test.ts` — команды job-ов и одинаковые step-ы кэша Electron.
- `test/contract/windows-tests-workflow.test.ts` — step-ы, команды, `if:` и выражения обоих job-ов.
- `scripts/download-electron.mjs` — новый: до 3 попыток `install.js` (review round 1).
- `test/unit/download-electron.test.ts` — новый: попытки, коды выхода, паузы.
- `node_modules/electron/install.js`, `@electron/get` (`dist/Cache.js`, `dist/index.js`) — только читаются.

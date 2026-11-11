# 107 — CI: zsh на Linux runner-е без зеркал Ubuntu

Type: bug
Status: claimed 2026-11-11T14:50Z
PR: #1798
Branch: worfy-polish/107
Blocked by: none
Source: бриф Orchestrator-а 2026-11-11: в этот день все `linux-tests (n/4)` в `.github/workflows/ci.yml` падают на шаге
«Install zsh» (exit 100), run 43032607379 (PR #1796) упал так дважды. Внешний сбой сети блокирует каждый PR.

## Что происходит

Шаг «Install zsh» job-а `linux-tests` ставил zsh одной строкой: `command -v zsh || { sudo apt-get update -qq && sudo
apt-get install -y -qq zsh; }`. zsh нужен shell test-ам Harness (`test/contract/harness-scripts-<n>.test.ts`): они
гоняют fenced-блоки skill-ов и под zsh, а в образе Ubuntu его нет.

Log run 43032607379 (все четыре shard-а одинаково): все источники apt у runner-а `ubuntu-26.04` («resolute») —
`mirror+file:/etc/apt/apt-mirrors.txt`, и для `resolute`, и для `-updates`, `-backports`, `-security`. `apt-get update`
шёл 3 мин 23 с, и `InRelease` не скачался ни для одного suite: «W: Failed to fetch
mirror+file:/etc/apt/apt-mirrors.txt/dists/resolute/InRelease  Temporary failure resolving 'security.ubuntu.com'».
`apt-get install` по спискам из образа ещё 2 мин пытался взять пакеты и вышел с кодом 100: «E: Failed to fetch
https://security.ubuntu.com/ubuntu/pool/main/z/zsh/zsh_5.9-8ubuntu3_amd64v3.deb  Temporary failure resolving
'security.ubuntu.com'». apt называет только последний источник списка зеркал, а он не resolve-ился; остальные зеркала
списка не ответили тоже: иначе `InRelease` скачался бы с них. Run 43044480444 этого PR-а напечатал список:
`http://azure.archive.ubuntu.com/ubuntu/` (priority 1), `https://archive.ubuntu.com/ubuntu/` (2),
`https://security.ubuntu.com/ubuntu/` (3).

Значит, посылка брифа «Azure mirror доступен, нет только security.ubuntu.com» по log-у не подтверждается. Переписать
записи `security.ubuntu.com` на зеркало архива не помогло бы: отдельных записей `security.ubuntu.com` нет, все suite
идут через один список зеркал, и в этом run-е он не работал весь. Retry-и тоже не спасают от сбоя на минуты.

## Что делаем

1. `scripts/ci-install-zsh.sh <папка пакетов>` (новый) ставит zsh так, по порядку, следующий путь — только если
   предыдущий не дал zsh:
   1. zsh уже на PATH — ничего не делает;
   2. в папке есть `.deb` из `actions/cache` — `sudo dpkg -i`, без сети;
   3. apt: `apt-get update`, `apt-get download zsh zsh-common` в новую временную папку, перенос в папку пакетов,
      `apt-get install` этих файлов; каждая команда с `-o Acquire::Retries=3` и пределом времени 180 с (`timeout`);
      при успехе пишет `debs=true` в `GITHUB_OUTPUT`;
   4. Homebrew, если он есть в образе (на PATH или в папке Homebrew образа, `BREW_DIR` скрипта): `brew install zsh` из
      bottle-ов на ghcr.io, ссылка в `/usr/local/bin/zsh`. Это единственный путь, который не идёт через архив Ubuntu,
      когда cache ещё пуст.
   Путь после неудачного оставляет `::warning::` в run-е; если zsh не дал ни один — exit 1 с ошибками apt в log-е, шаг
   красный.
2. В `linux-tests` шаги: «Read the Ubuntu release» (`VERSION_ID` из `/etc/os-release`), «Restore the zsh packages»
   (`actions/cache/restore`, key `zsh-debs-<os>-<arch>-ubuntu-<release>`), «Install zsh» (скрипт), «Save the zsh
   packages» (`actions/cache/save`, только когда cache промахнулся и скрипт скачал пакеты через apt).
3. Key — release Ubuntu, а не еженедельная версия образа: новый образ отправлял бы первый run каждой недели снова к
   зеркалам, а test-ам нужен какой-нибудь zsh, не самый новый. Cache с `main` виден всем PR; cache PR-а — только ему.
4. Другие workflow-файлы apt не зовут: `grep -rn apt .github/` находит только этот шаг (`windows-tests.yml` — Windows,
   zsh там не ставится).

Отвергнуто: только retry-и (сбой длился минуты, retry-и лишь удлиняют шаг); переписать `security.ubuntu.com` на
зеркало (см. «Что происходит»); только cache (пока cache пуст — первый run на `main` после merge или после вытеснения
через 7 дней без обращений — шаг снова зависит от зеркал; Homebrew закрывает этот случай).

## Готово, когда

- [ ] `scripts/ci-install-zsh.sh` со stub-ами `sudo`, `timeout`, `apt-get`, `dpkg`, `brew` на PATH без zsh: zsh уже
      есть — ничего не зовёт; cache hit — только `dpkg -i`, apt не зовётся; холодный cache — apt с
      `Acquire::Retries=3`, пакеты в папке, `debs=true`; битый cache — apt, пакеты заменены; apt не достаёт зеркал —
      Homebrew (на PATH и в `BREW_DIR`) с `::warning::`, папка пуста, сохранять нечего; нет Homebrew или Homebrew
      тоже упал — exit 1; без аргумента — exit 2. Contract test `test/contract/ci-install-zsh.test.ts`.
  - evidence: test-run pass · `pnpm test test/contract/ci-install-zsh.test.ts test/contract/ci-workflow.test.ts` exit 0 · mac - · 83fc58a11f23e8cd6554e8b13e989c603adbe082
- [ ] `ci.yml`: в `linux-tests` четыре шага в этом порядке, старой однострочной установки нет — тот же test; на ci.yml
      из `origin/main` он красный.
  - evidence: test-run pass · `pnpm test test/contract/ci-install-zsh.test.ts` exit 0; with ci.yml of origin/main exit 1 (1 failed, 9 passed) · mac - · 83fc58a11f23e8cd6554e8b13e989c603adbe082
- [ ] `ci-workflow.test.ts` считает только cache Electron-а, второй `actions/cache` в job-е его не ломает.
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts` exit 0 · mac - · 83fc58a11f23e8cd6554e8b13e989c603adbe082
- [ ] YAML обоих workflow-файлов разбирается (js-yaml из `node_modules`).
  - evidence: test-run pass · `node -e` js-yaml load of ci.yml and windows-tests.yml exit 0 · mac - · 83fc58a11f23e8cd6554e8b13e989c603adbe082
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0; на PR `linux-tests` проходят шаг «Install zsh».

## Где в коде

- `scripts/ci-install-zsh.sh` (новый).
- `.github/workflows/ci.yml` (job `linux-tests`, шаг «Install zsh»).
- `test/contract/ci-install-zsh.test.ts` (новый).
- `test/contract/ci-workflow.test.ts` (проверка cache Electron-а).

## Итог

Run 43044480444 (PR #1798, 15:04–15:08Z), все четыре shard-а `linux-tests`: cache пуст («Cache not found for input keys:
zsh-debs-Linux-X64-ubuntu-26.04»), `apt-get update` остановлен пределом 180 с, Homebrew есть в образе и поставил zsh
5.9.2 за ~20 с (`::warning::zsh came from Homebrew (/usr/local/bin/zsh), not from apt`), shell test-ы Harness в shard-ах
прошли. Шаг «Install zsh» занял ~3 мин 25 с против ~5 мин 20 с красного шага в run 43032607379. После этого run-а warning
называет, какая команда apt упала и как (предел времени — exit 124 — или код выхода).

## Вне скоупа

- Пока зеркала недоступны, cache не наполняется: путь 3 его не скачал. Первый run с работающим apt (на `main` — для всех
  PR) сохранит пакеты; до тех пор каждый run платит ~3 мин предела apt и берёт zsh из Homebrew.

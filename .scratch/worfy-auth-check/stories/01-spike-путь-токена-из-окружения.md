# Code story — worfy-auth-check 01: Spike: как `GH_TOKEN` из окружения системы доходит до gh в worfy на Mac и ПК

Kind: pr · Epic: worfy-auth-check · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

У тестера токен из `launchctl setenv` доходил до gh worfy, хотя login shell стартует без `GH_TOKEN`. Как — не было
известно. Ticket 05 должен строить ответ «чей токен возьмёт gh» и разбор 401 и 404, а опоры для этого не было. PR не
меняет код продукта: он несёт `spike.md`, scrubbed fixtures и read-only probe, который их снял.

- Требование: [Что происходит](../issues/01-spike-путь-токена-из-окружения.md#что-происходит)

## 2. Login shell не видит переменную launchd

Code: `.scratch/worfy-auth-check/spike.md:67-69` · key lines: 67, 69

```markdown
2. Login shell worfy её не видит. `captureLoginShellEnv` запускает `$SHELL -ilc` с `env: base`
   (`src/main/agent/env.ts:156`), а `base` — только `PATH=/usr/bin:/bin:/usr/sbin:/sbin` и `SHELL_BASE_KEYS`
   (`env.ts:35`, `shellBaseEnv` — `env.ts:49-56`). `GH_TOKEN` в этом списке нет. Опыт: M1 и M3 — `no GH_TOKEN`.
```

- Что делает: фиксирует, что без rc-файла переменная `launchctl setenv` не доходит до окружения агента. Значит, она
  не доходит и до всех вызовов gh, которые берут это окружение. Вывод опирается на строку кода и на опыт M1/M3
  настоящего `captureLoginShellEnv`.
- Почему здесь: Ticket велит писать итог в `spike.md`, раздел «Локальный путь токена».
- Без него: Ticket 05 исходил бы из того, что `launchctl setenv` всегда меняет токен gh. На деле его меняет только
  rc-файл.
- Требование: [Что делаем, п. 1](../issues/01-spike-путь-токена-из-окружения.md#что-делаем)
- Риски и пробелы test-ов: живой `launchctl setenv` не запускался (brief запрещает). Переменная launchd подставлена
  через `source` функции, `man launchctl` — источник того, что она лежит в `process.env` worfy.

## 3. Codex Session — единственный путь без rc-файла

Code: `.scratch/worfy-auth-check/spike.md:79-85` · key lines: 79, 81, 82

```markdown
6. Исключение — Codex Session. Процесс `codex app-server` получает `process.env` самого worfy, а не login shell:
   `withGhToken(options.env ?? process.env, token)` (`src/main/vendors/codex/session.ts:938`), и `appServerOptions`
   не задаёт `env` (`session.ts:1011-1020`). Токен из `launchctl setenv` доходит до процесса Codex и его shell-ов без
   rc-файла в двух случаях: в Profile нет аккаунта, или у аккаунта нет входа в gh. Во втором `accountAuth` бросает
   ошибку, Session пишет её в log и стартует с `token = null` (`session.ts:931-938`). Опыт M5 показывает то же для
   `ghRunner({})`, который берёт `process.env`. Дойдёт ли он до команды внутри Codex, решают ещё правила
   `shell_environment_policy` самого Codex. Это здесь не проверено.
```

- Что делает: называет одно место, где gh-путь worfy берёт `process.env`, а не login shell. В таблице вызовов это
  строка «Codex: процесс app-server».
- Почему здесь: Ticket просит таблицу вызовов `ghRunner` и `runGh` с окружением каждого.
- Без него: тестер со своим `launchctl setenv` видел бы разницу между Codex и PR badges, и причина осталась бы
  неизвестной.
- Требование: [Что делаем, п. 3](../issues/01-spike-путь-токена-из-окружения.md#что-делаем)
- Риски и пробелы test-ов: дойдёт ли `GH_TOKEN` до команды внутри Codex, зависит от `shell_environment_policy`
  Codex. Это не проверено.

## 4. Health check зеленеет при неверном `GH_TOKEN`

Code: `.scratch/worfy-auth-check/spike.md:208-210` · key lines: 208, 210

```markdown
- Health check читает stdout и stderr вместе (`first-run/checks.ts:505`) и считает строку `ok` по любому аккаунту в
  `success` (`github/auth-text.ts:62-66`). Значит, сегодня неверный `GH_TOKEN` в окружении при живом входе в keyring
  даёт зелёную строку gh. А каждый вызов gh без аккаунта Profile-а при этом получает 401. Это вход для Ticket-а 03.
```

- Что делает: связывает fixture `auth-status-gh-token-invalid` с тем, как его читает `ghAccounts`. Probe прогнал
  настоящий `ghAccounts` на этом выводе (строка G6) и получил `bob`, `alice`.
- Почему здесь: Ticket просит вывод `gh auth status` с `(GH_TOKEN)`, с рабочим и неверным токеном.
- Без него: модель Health check Ticket-а 03 не знала бы, что gh при провале пишет отчёт в stderr с exit 1.
- Требование: [Что делаем, п. 5](../issues/01-spike-путь-токена-из-окружения.md#что-делаем)
- Риски и пробелы test-ов: вывод снят gh 2.97.0. Другая версия gh может писать иначе, а fixtures об этом не скажут.

## 5. Токены probe-а: ни один не печатается и не уходит в persistent-окружение

Code: `.scratch/worfy-auth-check/fixtures/local/probe.mjs:26-32` · key lines: 27, 31

```js
// Well-formed tokens that were never issued; built here so that no token-shaped text is in the file.
const FAKE = `ghp_${'0'.repeat(34)}ff`
const RC_FAKE = `ghp_${'1'.repeat(34)}ff`
const TOKEN_NAMES = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'])
/** process.env without any gh token variable (any case, as Windows reads names), plus `extra`. */
const childEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !TOKEN_NAMES.has(key.toUpperCase()))), ...extra })
const gh = (args, extra) => spawnSync('gh', args, { env: childEnv(extra), encoding: 'utf8', timeout: 30_000 })
```

- Что делает: плохой токен собирается в момент запуска, так что guard `check-personal` не видит в файле текста формы
  токена. Каждый gh стартует без токенов окружения Session, а нужный `GH_TOKEN` получает только свой дочерний процесс.
- Почему здесь: brief велит воспроизводить только в дочернем процессе и не печатать токены. Probe лежит в
  `fixtures/local/`, единственной папке, кроме `spike.md`, которую Ticket разрешает писать.
- Без него: `GH_TOKEN` Session (аккаунт Profile-а) попал бы в опыты «без токена», и G1/G6 показали бы не keyring.
- Требование: [Что делаем, п. 6](../issues/01-spike-путь-токена-из-окружения.md#что-делаем)
- Риски и пробелы test-ов: на Windows probe не запускался, ветка `windows` (W1–W8) проверена только чтением.

## 6. Как проверено

- `node .scratch/worfy-auth-check/fixtures/local/probe.mjs <bundle> .scratch/worfy-auth-check/fixtures/local` —
  exit 0 на Mac, вывод — в `spike.md`.
- `node scripts/check-personal.mjs` — exit 0 на fixtures и `spike.md`.
- `pnpm lint && pnpm typecheck && pnpm test` и gate fast — exit codes в отчёте implementer-а.

## Проверить себя

1. Почему токен из `launchctl setenv` не доходит до PR badges, а до Codex Session доходит?
   - Ответ: PR badges берут окружение login shell, которое стартует только с `SHELL_BASE_KEYS`. Процесс Codex
     получает `process.env` worfy, а в нём переменная launchd есть.
   - Строки: `.scratch/worfy-auth-check/spike.md:67-69`, `.scratch/worfy-auth-check/spike.md:79-82`
2. Почему неверный `GH_TOKEN` не делает строку gh в Health check красной?
   - Ответ: `ghAccounts` считает `ok` по любому аккаунту в `success`, а аккаунты keyring остаются в отчёте. Запись
     `(GH_TOKEN)` без login пропускается, exit 1 никто не читает.
   - Строки: `.scratch/worfy-auth-check/spike.md:208-210`

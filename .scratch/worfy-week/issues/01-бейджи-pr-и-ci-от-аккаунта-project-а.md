# 01 — Бейджи PR и CI идут от аккаунта GitHub Project-а

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-07 (вопросы 3 и 4); HANDOFF 2026-10-06, «Ждёт владельца», пункт [med] о бейджах «gh unavailable»; ревью Ticket-а 17 `worfy-daily`; [ADR-0020](../../../docs/adr/0020-profile-shared-and-personal-parts.md); [spec.md](../spec.md), этап 1

## Что происходит

- Бейджи PR и CI на Node-ах Ticket-ов Project-а IDSAD-XL/worfy всегда показывают «gh unavailable».
- `appGhRunner` в `src/main/ipc/checks.ts:35-38` запускает `gh` с окружением login shell
  (ADR-0007), то есть от глобального аккаунта gh. Глобальный аккаунт на машине владельца —
  Oleksii-O-Atakama, ему репозиторий IDSAD-XL/worfy не виден.
- Ревью Ticket-а 17 `worfy-daily` воспроизвело: `gh pr list -R IDSAD-XL/worfy` без `GH_TOKEN` —
  «Could not resolve to a Repository», с `GH_TOKEN` аккаунта IDSAD-XL — PR виден.
- [ADR-0020](../../../docs/adr/0020-profile-shared-and-personal-parts.md): worfy работает с Project
  через `GH_TOKEN` аккаунта Project-а и глобальный `gh` не переключает. Целиком ADR-0020 — этап E3.
  Этот Ticket берёт из него то, что нужно для недели работы сейчас.

## Что делаем

1. **Аккаунт — из Profile, только чтение.** worfy читает поле `github.account`:
   `~/.claude/bin/profile -C <корень Project-а> --field github.account`. Скрипт и коды выхода те же,
   что у списка MCP-серверов в `src/main/workflow/profile.ts`: 0 — значение, 3 — Project не
   зарегистрирован, 4 — поля нет. Сейчас у Project-ов worfy и Auction там `IDSAD-XL`. Profile worfy
   не пишет.
2. **Токен — у gh.** Перед своим вызовом `gh` для Project-а worfy берёт токен командой
   `gh auth token -u <аккаунт>` (окружение login shell, как сейчас) и запускает `gh` с
   `GH_TOKEN=<токен>`. Правило — для каждого вызова `gh`, который делает сам worfy. Сейчас такой
   вызов один: `gh pr list` в `PrTracker` (`src/main/github/prs.ts:202`, `:220`) через
   `appGhRunner`. Исполнитель проверяет поиском по `src/`, что других нет, и пишет в «Итог», что
   нашёл.
3. **Глобальный аккаунт не трогается.** Никаких `gh auth switch`, `gh auth login` и записи в
   конфиг gh.
4. **Нет аккаунта — как сейчас.** Код 3 или 4, значение `null`, нет скрипта `profile`, сбой
   скрипта — `gh` идёт с окружением login shell без `GH_TOKEN` от worfy, как до Ticket-а. Причина —
   одна строка в лог, как у списка MCP-серверов.
5. **Аккаунт есть, токена нет.** `gh auth token -u <аккаунт>` упал (нет входа под этим
   аккаунтом). Бейдж — «gh unavailable» с причиной, где названы аккаунт и `gh auth login`. От
   глобального аккаунта worfy в этом случае не идёт: тот дал бы чужой ответ или тот же отказ.
6. **Токен не выходит наружу.** Он есть только в окружении дочернего процесса `gh`: не в логе, не
   в журнале Autopilot, не в снимке `checks`, который уходит renderer-у, не в тексте ошибки.

Брать токен на каждый вызов или держать его на время опроса — решает исполнитель. Решение и
причина — в «Итог». `gh pr list` идёт не чаще раза в 60 с (`src/main/github/prs.ts:3`).

ADR не нужен: решение уже принято в ADR-0020, Ticket выполняет его часть.

**Не входит (E3):** выбор аккаунта в UI при подключении Project-а (ADR-0020, шаг 5); `GH_TOKEN` в
окружении Session-ов агентов (ADR-0020, ADR-0007); Profile из двух частей.

## Готово, когда

- [ ] У Project-а с `github.account` в Profile каждый вызов `gh`, который делает worfy, идёт с `GH_TOKEN` из `gh auth token -u <аккаунт>`. Проверяет contract test с подменённым `gh` и подменённым скриптом `profile`.
- [ ] Подменённый `gh` видит от worfy только `auth token -u <аккаунт>` и `pr list`: ни `auth switch`, ни `auth login`, ни других команд, меняющих глобальный аккаунт.
- [ ] Нет аккаунта в Profile (код 3, код 4, `null`, нет скрипта, сбой скрипта) — `gh` вызывается как до Ticket-а, без `GH_TOKEN` от worfy.
- [ ] Аккаунт есть, а `gh auth token -u` упал — снимок `checks` несёт ошибку с именем аккаунта, и `gh pr list` от глобального аккаунта не вызывается.
- [ ] Токена нет в снимке `checks` и в выводе лога.
- [ ] (вручную) Stable copy, обновлённая после влития: на Canvas Project-а worfy у Ticket-ов с PR видны бейджи PR и CI, а не «gh unavailable»; номер PR и вердикт CI совпадают с `gh pr view <N> -R IDSAD-XL/worfy`. Как проверить: окно приложения.

Ручной пункт агент проверяет, только если может посмотреть окно Stable copy. Если не может —
«не проверено: …» в «Итог» и пункт в HANDOFF, раздел «Ждёт владельца». Этот же пункт закрывает
ручную проверку (2) Ticket-а 17 `worfy-daily`: бейджи на живых PR сверяются с `gh pr view`.

## Тесты

Сначала падающий test — contract test в `test/contract/github-prs.test.ts`. Подменённый `gh`
пишет свои аргументы и значение `GH_TOKEN` в файл. Подменённый скрипт `profile` на
`--field github.account` отдаёт `IDSAD-XL`. Test ждёт `pr list` с `GH_TOKEN`, который вернул
`auth token -u IDSAD-XL`. На нынешнем main `GH_TOKEN` пуст — test красный. В «Итог» — как он падал.

- `test/contract/github-prs.test.ts` — случаи пунктов «Готово, когда» 1–5.
- `test/contract/workflow-profile.test.ts` — чтение `github.account` по исходам `profile`: код 0,
  3, 4, `null`, нет скрипта.
- e2e `test/e2e/checks-badges.spec.ts` идёт через подменённый `gh` (`WORFY_GH`). Если исполнитель
  меняет этот путь, он добавляет e2e в «Где в коде» и проверяет пересечения с Ticket-ами Wave.

## Где в коде

- `src/main/ipc/checks.ts`
- `src/main/github/prs.ts`
- `src/main/workflow/profile.ts`
- `test/contract/github-prs.test.ts`
- `test/contract/workflow-profile.test.ts`

Не меняются: `src/main/agent/env.ts` (окружение login shell берётся как есть), окружение
Session-ов агентов. Общих файлов с Ticket-ом 02 нет.

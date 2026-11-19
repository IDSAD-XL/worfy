# 02 — Spike SAML SSO: read-only скрипт для тестера, ответы REST и GraphQL поиска организации с SAML

Type: spike
Status: blocked 2026-11-19T02:11Z
Blocked reason: Spike SAML SSO ждёт ответов тестера: скрипт sso-probe.sh отправлен 2026-11-19
Waits: team
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 2; «Проблема», пункт «PR inbox» (гипотеза о GraphQL); «Риски», «Гипотеза о
GraphQL не подтвердится» и «Нет организации с SAML»; «Решения владельца», Q6; «Волны», Wave 1;
[critic 2026-11-18](../../../docs/product/critic/worfy-auth-check-2026-11-18.md), возражение 1 и «Alternative»

Кто: человек — тестер запускает скрипт и присылает scrubbed вывод; orchestrator готовит скрипт (ниже), владелец
передаёт его тестеру, агент пишет итог.

Не платформенный Ticket (скрипт для одного запуска на macOS и отчёт, без кода продукта). Глубина ревью — `low`.

Ждёт человека: не держит другие Ticket-ы, кроме 06.

## Что происходит

- SAML SSO есть только у организаций GitHub Enterprise Cloud. У владельца такой организации нет; у нового тестера —
  есть (spec, «Проблема»).
- PR inbox ищет PR одним `gh api graphql` (`src/main/github/inbox.ts:86-89`), запрос — `SEARCH_QUERY` (`:66`), scope —
  `repo:<owner>/<repo>` с `review-requested:@me` и `involves:@me` (`searchTerms`, `:81-84`). Ошибка gh попадает в
  `state.error` (`inbox.ts:382`, `:552`). SSO и SAML не распознаются нигде в `src/`.
- Гипотеза spec-а: GitHub отвечает на поиск 200 и молча выкидывает PR организации, для которой токен не авторизован;
  REST на repo отвечает 403 с заголовком `X-GitHub-SSO: required; url=…`. Не проверено.
- Ticket 06 выбирает способ разбора SSO (сообщение gh или заголовок через `gh api -i`) по итогу этого Ticket-а.

## Что делаем

1. Orchestrator отдаёт скрипт ниже владельцу; владелец передаёт его тестеру с запиской о scrub (ниже).
2. Тестер запускает его на своём Mac, в Terminal, где gh видит тот же `GH_TOKEN`, что и worfy:
   `bash sso-probe.sh <owner>/<repo> > sso-probe.txt 2>&1`, где `<owner>/<repo>` — repo организации с SAML, PR
   которого пропадают из PR inbox.
3. Агент принимает присланный файл: `node scripts/check-personal.mjs` и
   `grep -E 'gh[pousr]_|github_pat_|authorization_request=[^<]' sso-probe.txt` (ничего не печатает) до записи в
   репозиторий.
4. Итог — `.scratch/worfy-auth-check/spike-saml.md`. Ответы:
   1. REST `repos/<owner>/<repo>`: status, есть ли `X-GitHub-SSO: required; url=…`, что gh печатает в stderr, exit code;
      с токеном из окружения и с токеном keyring;
   2. GraphQL поиск в scope PR inbox, в scope организации и без scope: status, есть ли
      `X-GitHub-SSO: partial-results; organizations=…`, `issueCount`, типы ошибок, exit code;
   3. решение для Ticket-а 06: разбирать заголовок (`gh api -i`) или текст gh; отличим ли в PR inbox «нет PR» от
      «скрыто SSO».
5. Fixtures — `.scratch/worfy-auth-check/fixtures/saml/`: ответ REST 403 с `X-GitHub-SSO: required`, ответ поиска с
   `partial-results` (если пришёл) и без, stderr gh. Организация — `acme`, repo — `acme/web`, login — `alice`.
6. Ответа нет — Ticket остаётся `blocked` с `Waits: team`; Ticket 06 ждёт. Остальные Ticket-ы Epic-а не ждут.

### Скрипт `sso-probe.sh`

Только читает: `gh --version`, `gh auth status`, один GET на repo и три GraphQL поиска — каждый с токеном как есть и с
токеном keyring (`env -u GH_TOKEN -u GITHUB_TOKEN`). Ничего не пишет и не меняет настроек. Печатает строку status,
заголовок `X-GitHub-SSO`, строки `gh:` и `issueCount` — тело ответа целиком не печатает. Токены, id запроса
авторизации и id организаций маскирует; имя организации, repo и login-ы gh заменяет на `<org>`, `<repo>`, `<login>`.

```bash
#!/usr/bin/env bash
# worfy-auth-check ticket 02: a read-only probe of GitHub's answers for an organization with SAML SSO.
# Usage: bash sso-probe.sh <owner>/<repo>
# Reads only. Writes nothing, changes no setting. Prints no token: the output is masked before it is printed.
set -u -o pipefail

target="${1:-}"
if ! printf '%s' "$target" | grep -Eq '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'; then
  echo "usage: bash $0 <owner>/<repo>" >&2
  exit 2
fi
owner="${target%%/*}"
repo="${target#*/}"
command -v gh >/dev/null 2>&1 || { echo "gh is not installed" >&2; exit 2; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
owner_lower=$(lower "$owner")
repo_lower=$(lower "$repo")
# The logins gh knows, to replace them in the output.
logins=$(gh auth status 2>&1 | sed -nE 's/.* (account|as) ([A-Za-z0-9_-]+).*/\2/p' | sort -u)

# Masks tokens, the SSO request id and organization ids, then names: stdin to stdout.
mask() {
  local text login
  text=$(sed -E \
    -e 's/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/<token>/g' \
    -e 's/(Token: ).*/\1<masked>/' \
    -e 's/(authorization_request=)[^ ;,"]+/\1<masked>/g' \
    -e 's/(organizations=)[0-9, ]+/\1<ids>/g')
  text=${text//"$repo"/<repo>}
  text=${text//"$repo_lower"/<repo>}
  text=${text//"$owner"/<org>}
  text=${text//"$owner_lower"/<org>}
  for login in $logins; do text=${text//"$login"/<login>}; done
  [ -n "$text" ] || text='(none)'
  printf '%s\n' "$text"
}

# gh with the token as it is, or with the keyring's token only.
run() {
  local mode="$1"; shift
  if [ "$mode" = keyring ]; then env -u GH_TOKEN -u GITHUB_TOKEN gh "$@"; else gh "$@"; fi
}

# The lines of an answer of `gh api -i` that carry no data: status, the SSO header, gh's own message, counts, error types.
answer_lines() {
  printf '%s\n' "$1" | grep -E -i '^(HTTP/|x-github-sso:|gh: )'
  printf '%s\n' "$1" | grep -E -o '"(issueCount|type)":("[A-Z_]+"|[0-9]+)'
}

is_set() { if [ -n "$1" ]; then echo set; else echo "not set"; fi; }

echo "== system"
echo "macOS $(sw_vers -productVersion 2>/dev/null || echo unknown)"
gh --version | head -n 1

echo "== environment (names only)"
echo "GH_TOKEN in this shell: $(is_set "${GH_TOKEN:-}")"
echo "GITHUB_TOKEN in this shell: $(is_set "${GITHUB_TOKEN:-}")"
echo "GH_TOKEN in launchctl: $(is_set "$(launchctl getenv GH_TOKEN 2>/dev/null)")"

echo "== gh auth status"
gh auth status 2>&1 | mask

QUERY='query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }'
SCOPE='is:pr is:open archived:false'
for mode in as-is keyring; do
  echo "== token: $mode"
  echo "-- REST repos/<org>/<repo>"
  out=$(run "$mode" api -i "repos/$owner/$repo" 2>&1); code=$?
  echo "exit $code"
  answer_lines "$out" | mask
  for scope in "repo:$owner/$repo" "org:$owner" ""; do
    label=$(printf '%s' "${scope:-no scope}" | mask)
    echo "-- GraphQL search, $label, involves:@me"
    out=$(run "$mode" api graphql -i -f query="$QUERY" -f q="$SCOPE $scope involves:@me" 2>&1); code=$?
    echo "exit $code"
    answer_lines "$out" | mask
  done
done
```

### Записка тестеру о scrub

> Скрипт ничего не меняет и токенов не печатает. Перед отправкой откройте `sso-probe.txt` и проверьте глазами:
> имя вашей организации, repo, ваш login, домен компании и любые длинные id должны быть заменены на `<org>`, `<repo>`,
> `<login>`, `<masked>` или `<ids>`. Что осталось — замените так же вручную. Команда
> `grep -E 'gh[pousr]_|github_pat_' sso-probe.txt` не должна печатать ничего. Пришлите файл целиком.

## Готово, когда

- [ ] Скрипт передан тестеру (дата в «Итог»).
- [ ] Вывод тестера принят: `node scripts/check-personal.mjs` — exit 0, grep токенов и id запроса авторизации пуст.
- [ ] `spike-saml.md` отвечает на вопросы 1–3 «Что делаем», пункт 4, по выводу тестера.
- [ ] Fixtures в `fixtures/saml/`: REST 403 с `X-GitHub-SSO: required` и поиск — с `partial-results` или запись, что
      его нет.
- [ ] `spike-saml.md` называет способ разбора SSO для Ticket-а 06.
- [ ] `ci-ok` зелёный на head PR.

## Где в коде

Только читать: `src/main/github/inbox.ts` (`SEARCH_QUERY`, `searchTerms`, `searchArgs`), `src/main/github/prs.ts`.

Писать: `.scratch/worfy-auth-check/spike-saml.md`, `.scratch/worfy-auth-check/fixtures/saml/`.

## Вне скоупа

- Путь `GH_TOKEN` из окружения, 401 и 404 — Ticket 01.
- Код разбора SSO — Ticket 06.
- Windows: тестер работает на macOS; запуск на Windows — только если там же найдётся организация с SAML.

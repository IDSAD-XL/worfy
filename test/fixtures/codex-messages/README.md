# Сообщения Codex app-server, снятые `scripts/codex-capture.mjs`

Здесь лежат записи живого Codex закреплённой версии (`@openai/codex` в `package.json`). Снимает их только
владелец, со своим входом в ChatGPT (план Plus), одной командой из корня репозитория:

```
node scripts/codex-capture.mjs --use-my-login
```

Скрипт запускает закреплённый `codex app-server` с `CODEX_HOME` во временной папке (вход — новый, через
ссылку в браузере; `~/.codex` не читается и не меняется), проходит сценарий во временной папке-Project-е и
заменяет файлы этой папки. В test-ах и в CI скрипт не идёт: без `--use-my-login`, под `CI` или `VITEST` он
отказывается.

- `<раздел>.jsonl` — сообщения одного раздела сценария, по одному JSON на строку, в порядке прихода. Форма
  строк — та же, что у сценариев фейка (`test/fixtures/codex-scripts/`), со стороны app-server-а:
  - `{"expect":"<метод>","params":{…},"result":{…}}` — request worfy и ответ app-server-а (`error` вместо
    `result` — отказ);
  - `{"expect":"initialized"}` — notification worfy;
  - `{"notify":"<метод>","params":{…}}` — notification app-server-а;
  - `{"request":"<метод>","params":{…},"answer":{…}}` — request app-server-а (approval) и ответ скрипта
    (`answerError` — отказ);
  - `{"capture":"…"}` — заметка самого скрипта (чего не дождался); это не сообщение протокола.
- `hooks/<событие>.jsonl` — вход hook-ов (`PreToolUse`, `Stop`, `SubagentStop`…), как его получила команда
  hook-а: по одному JSON на строку. Для фейка hook-ов (Ticket 44).
- `manifest.json` — версия Codex (`codex`), дата (`capturedAt`), план (`plan`), платформа, разделы.

Email, id аккаунта и пользователя, токены, домашняя папка, временные папки, имя Mac-а (`serverName`),
`installationId` и `loginId` заменены (`owner@example.com`, `capture-account-id`, `capture-user-id`, `/home/owner`,
`/capture/...`, `capture-host.local`, `00000000-0000-4000-8000-000000000001` и `…0002`); перед записью скрипт
проверяет, что их в тексте не осталось.

Contract test `test/contract/codex-compat.test.ts` сверяет manifest с `package.json`, каждую запись — с JSON
Schema закреплённой версии (`src/main/vendors/codex/protocol/json/`), а сценарии фейка — с видами сообщений и
путями ключей отсюда. Порядок смены версии Codex — в шапке этого test-а.

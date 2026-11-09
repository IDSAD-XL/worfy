# 77 — Кнопки Health check показывают, что проверка идёт

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-11-09 (отзыв тестера): после клика по кнопке в Health check не видно, идёт проверка
или всё зависло. Строки перечитаны по main `964061f9a`.

## Что происходит

Health check — один компонент `FirstRunChecks` (`src/renderer/shell/FirstRunChecks.tsx`) в двух местах: диалог First run
(`src/renderer/shell/FirstRun.tsx`) и Settings → Health (`src/renderer/settings/HealthSection.tsx:26`). Main — `src/main/first-run/checks.ts` (строки) и `src/main/first-run/actions.ts` (действия строк).

Кнопки и что они запускают:

| Кнопка | Где | Что запускает | Сколько идёт |
|---|---|---|---|
| Check again | `FirstRunChecks.tsx:472` | `firstRun.checks` → все строки разом (`checks.ts:815`, `Promise.all`): `--version` git/gh/node/jq/qmd, `claude plugin list --json`, `gh auth status`, вход Claude Code | по самой медленной строке: обычно секунды; инструмент — до 15 s (`TOOL_TIMEOUT_MS`, `checks.ts:160`), вход Claude Code — до 60 s (`ACCOUNT_TIMEOUT_MS`, :162) |
| Set up… (limits) | `checks.ts:496` | confirm, затем запись `statusLine` в settings.json | меньше секунды |
| Sign in… (gh) | `checks.ts:511` | confirm, затем Terminal Node с `gh auth login` | секунда; дальше пользователь отвечает gh сам |
| Show log | `checks.ts:551` | `update.showLog`, открывает build.log | мгновенно |
| Install… / Update (Harness) | `checks.ts:569`, :614 | confirm, затем `installHarness`: копия из сборки и команды зависимостей | секунды, с зависимостями — минуты |
| Move… | `checks.ts:675` | форма переноса в renderer (`FirstRunChecks.tsx`), без запуска | мгновенно |
| Install… (qmd) | `checks.ts:700`, :701 | confirm, затем `npm install -g` | десятки секунд — минуты, предел 10 min (`NPM_TIMEOUT_MS`, `src/main/harness/qmd.ts:243`) |
| Download… (модели qmd) | `checks.ts:704` | confirm, затем `qmd pull`, сотни MB | минуты, предел 2 h (`PULL_TIMEOUT_MS`, `qmd.ts:244`) |
| Skip… (модели qmd) | `checks.ts:714` | confirm, затем файл ответа | меньше секунды |
| Set up… (коллекции qmd) | `checks.ts:733` | confirm, затем `qmd-collections` по Project-ам, может клонировать main из origin | минуты, предел 30 min (`COLLECTIONS_TIMEOUT_MS`, `qmd.ts:245`) |
| копирование команды | `FirstRunChecks.tsx:78` (`CopyButton`) | буфер обмена | мгновенно |

Что видно сейчас. «Check again»: сводка пишет «Checking…» (`FirstRunChecks.tsx:427`), строки при этом не меняются.
Действие строки: chip строки — «Running…» (`CHIP_LABEL`, :34; `running` — :110, :177, :402). Все кнопки получают
только `aria-disabled` (`locked`, :428; :121, :472): выглядят так же, текст тот же, spinner-а нет, а клик молча
игнорируется (`if (!locked)`, :124). Для `qmd pull` на несколько минут это одна надпись «Running…» без хода.

## Что делаем

- Нажатая кнопка: `disabled` (не только `aria-disabled`), текст хода вместо подписи и spinner перед ним. «Check again» →
  «Checking…»; действие → «<глагол>ing…»: «Installing…», «Downloading…», «Setting up…», «Signing in…». Остальные
  кнопки — `disabled` с причиной в tooltip «Another check is running».
- Образец в приложении: `src/renderer/machines/ChangeAddressDialog.tsx:162–163` (`disabled={saving || …}`,
  `{saving ? 'Checking…' : 'Save'}`) и `src/renderer/projects/ConnectProject.tsx:764–766` (`Connecting…`). Spinner —
  тот, что уже есть в `src/renderer/session/Transcript.tsx` (вынести в общий компонент, если он там локальный).
- Строки при «Check again»: каждая строка показывает chip «Checking…», пока её проверка не вернулась. Сейчас main
  отдаёт все строки одним ответом (`Promise.all`, `checks.ts:815`); строки-по-готовности — только если это не
  требует нового канала IPC; иначе все строки «Checking…» до ответа.
- Долгие действия (`npm install -g`, `qmd pull`, `qmd-collections`, Harness с зависимостями): строка под кнопкой
  называет шаг и прошедшее время — «Downloading models… 1:20». Если main уже получает строки вывода процесса, показать
  последнюю; если нет — только шаг и время, без нового потока вывода.
- Отказ или timeout: кнопка возвращает подпись, причина — в строке, как сейчас.

## Готово, когда

- [ ] Клик «Check again»: кнопка `disabled`, текст «Checking…», spinner; chip-ы строк «Checking…»; после ответа —
  прежний вид.
- [ ] Клик по действию строки: эта кнопка «…ing…» со spinner-ом, остальные `disabled` с tooltip-ом; chip строки
  «Running…».
- [ ] Долгое действие показывает шаг и прошедшее время.
- [ ] Строка «Health» в `docs/features/app-shell.md:278` (и перевод в `docs/features/ru/`) говорит, что нажатая
  кнопка показывает ход проверки.

## Тесты

- unit (jsdom): `test/unit/settings-health.test.tsx` или новый рядом — busy state «Check again» и действия строки при
  `invoke`, который не отвечает, пока test не отпустит; после ответа — прежние подписи.
- e2e есть для этого экрана: `test/e2e/settings-health.spec.ts`, `test/e2e/first-run.spec.ts`
  (`test/e2e/first-run-sandbox.ts`). Прогнать оба; новый шаг e2e — только если busy state там проверяется без
  ожидания по часам.

## Где в коде

- `src/renderer/shell/FirstRunChecks.tsx:34` — `CHIP_LABEL`; :78 — `CopyButton`; :102–130 — `CheckRow` и кнопки
  действий (:117, `aria-disabled` :121, :124); :177 — `useAction`; :398–407 — запуск действия; :427 — сводка
  «Checking…»; :428 — `locked`; :472 — «Check again».
- `src/renderer/shell/first-run-store.ts:19`, :33 — флаг `checking`.
- `src/renderer/settings/HealthSection.tsx:26`, `src/renderer/shell/FirstRun.tsx` — только читаются.
- `src/main/first-run/checks.ts:160`, :162 — пределы; :496–733 — действия строк; :815 — `Promise.all`.
- `src/main/first-run/actions.ts:152` — `perform`; `src/main/harness/qmd.ts:243–245` — пределы qmd (только читаются,
  если не нужен шаг хода из main).
- `src/renderer/machines/ChangeAddressDialog.tsx:162–163`, `src/renderer/projects/ConnectProject.tsx:764–766` — образец.
- `test/unit/settings-health.test.tsx`, `test/e2e/settings-health.spec.ts`, `test/e2e/first-run.spec.ts`.

## Вне скоупа

- Новые проверки и новые действия Health check.
- Прогресс в процентах для `qmd pull`: только шаг и время.

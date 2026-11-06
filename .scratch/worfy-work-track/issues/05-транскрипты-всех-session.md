# 05 — Транскрипты всех Session Project-а: ходы и Subagent-ы за период

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает» → «Чтение»; «Решения владельца», 2, 7; «Решено без владельца», 2, 3; «Риски», 1; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), п. 2; [06](../../worfy-autopilot-queue/issues/06-объём-и-доступ-work-track.md), Q1, Q5

## Что происходит

- Reader Flight Recorder читает только транскрипт Orchestrator-а Wave-ов одного Run-а и Subagent-ов этих Wave-ов
  (`src/main/flight-recorder/transcripts.ts:7-17`); принадлежность Project-у — по `cwd` записей.
- За 30 дней у worfy — 3923 файла, 4.1 GB; главные файлы Session — 0.7 GB (research 04). Codex — `thread/list`
  (`src/main/vendors/codex/history.ts:6-12`), без архивных.

## Что делаем

1. `src/main/work-track/transcripts.ts`: все файлы Claude Code Project-а с mtime в периоде (и тот, что ещё пишется),
   потоковое чтение построчно, только поля времени, типа записи, вызова `Agent` (имя и `description`), исхода
   Subagent-а; текст prompt-ов и ответов не читается в память дальше строки. Факты `turn` и `subagent` (модель 04).
2. Session: `SessionInfo` — имя Node на Canvas, если Session на нём есть (скрытые — `hidden`), иначе «Session <id4>» и
   имя worktree; закрытые Session без Node — `archived`. Codex — через `history.ts`, с архивными, если app-server их
   отдаёт; нет — пробел «Codex archived threads».
3. Пробелы: начало периода раньше самого старого файла и срок `cleanupPeriodDays` (читается из настроек Claude Code
   только чтением, по умолчанию 30) — `SourceGap` с причиной.
4. Кэш в памяти по (путь, mtime, размер) на время жизни приложения; на диск ничего.

## Готово, когда

- [ ] Contract test на fixture Claude home: три Session (одна скрытая на Canvas, одна без Node), Subagent-ы, файл
      другого Project-а — не входит; факты с верными временами; текст prompt-ов не попал ни в один факт.
- [ ] Contract test: повторное чтение не читает файл заново, если mtime и размер те же; ничего не записано в fixture
      (ADR-0005).
- [ ] Contract test: fake Codex с двумя тредами — ходы Session на Codex.
- [ ] Замер на fixture в 200 MB — время в «Итог»; Week на Mac владельца — замер в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/work-track-transcripts.test.ts`, fixture-ы `test/fixtures/work-track/claude-home/**` (новые;
  без путей домашней папки).
- Сначала падающий: Session без Node не попадает в факты.

## Где в коде

- `src/main/work-track/transcripts.ts` (новый)
- `test/contract/work-track-transcripts.test.ts`, `test/fixtures/work-track/claude-home/**` (новые)

Только читать: `src/main/flight-recorder/transcripts.ts`, `src/shared/flight-recorder/from-transcript.ts`,
`src/main/vendors/codex/history.ts`, `src/main/claude-home/registry.ts`.

## Итог

- Reader — `src/main/work-track/transcripts.ts`, `readProjectTranscripts({ root, period, now, canvas }, options)`: факты
  `turn` и `subagent`, `SessionInfo` и `SourceGap` по контракту 04. Папки — `projects/<имя корня>` и папки внутри корня
  (worktree-ы под `.claude/worktrees/`); принадлежность Project-у — по первому `cwd` записей. Файлы с mtime раньше начала
  периода не открываются.
- Каждая строка сразу урезается до имён (`NamesOnly`): время, тип записи, имя, `description` и тип вызова `Agent`, id и
  статус результата Subagent-а, слово вердикта (`VERIFIED`/`REJECTED`). Остальное разбирает тот же
  `TranscriptParse` Flight Recorder-а (`src/shared/flight-recorder/from-transcript.ts`), без копии. Test проверяет, что
  ни в фактах, ни в кэше (`util.inspect` всего кэша) нет текста prompt-ов, ответов, отчётов и `<result>`
  task-notification-ов; мутация «оставить `prompt` в вызове Agent» его роняет.
- Subagent-ы, запущенные Subagent-ом (из его собственного файла), — с `parent` на ту его попытку, что шла в момент запуска.
- Сначала падающий test: на `ceb9435e4` (до правки) test красный — модуля `src/main/work-track/transcripts` нет (vitest:
  «Cannot find module»), Session без Node в фактах взяться неоткуда; после реализации 5 test-ов зелёные, и в часовых
  поясах UTC, Pacific/Kiritimati (+14), Pacific/Pago_Pago (−11) тоже.
- Замер на fixture в 200 MB (4 Session по 40 MB и 4 файла Subagent-ов по 10 MB, `test/big-transcript.ts`, во временной
  папке): первое чтение — 0.37 с, повторное из кэша — 0.04 с, 26 тыс. фактов.
- Замер Week на Mac владельца (Project worfy, неделя с 2026-11-02, только чтение `~/.claude`): 1060 файлов, 1.59 GB,
  первое чтение — 4.7 с, повторное из кэша — 0.12 с; 19 Session, 1933 факта, пробелов нет.

Решено без владельца:

1. **Живой ход и Subagent без конца.** Ход или Subagent без конца идёт, пока его файл писали не раньше чем 15 минут назад
   (`LIVE_MS`: Claude Code держит команду до 10 минут); иначе его Claude Code остановился — обрезка `cut-off` на
   последней записи, как в Flight Recorder (`ending` в `spans.ts`). Иначе Session, убитая неделю назад посреди работы
   Subagent-а, рисовала бы его идущим до `now`.
2. **Пробел транскриптов** — часть периода раньше срока `cleanupPeriodDays` (из `settings.json`, только чтение, по
   умолчанию 30) **и** раньше самого старого оставшегося файла Project-а. Часть внутри срока, где файлов нет, — не
   пробел, а отсутствие работы: такие файлы Claude Code ещё не удалил бы.
3. **Codex archived threads.** `history.ts` (только читать) просит `thread/list` с `archived: false`, архивных не отдаёт.
   Пробел — на отдельной дорожке `codex-archived` «Codex archived threads» на весь период, только когда у Project-а есть
   хоть один тред Codex: пробел без `session` заштриховал бы все дорожки Codex целиком. Codex не ответил — пробел
   «Codex history did not answer» на весь период, транскрипты Claude читаются дальше.
4. **Codex читается, только когда сервис передал `codex`** (history part драйвера): по умолчанию — нет, чтобы test или
   вызов без него не запускал `codex app-server`. Сервис (08) передаёт `vendorDriver('codex').history`.
5. **Заголовок хода** (`title`) — имя Session: на дорожке «by Epic» ходы разных Session иначе не различить.
6. **Session без Node** — «Session <id4> · <последняя часть cwd>» и `archived`; заголовок треда Codex не берётся (решение
   3 spec-а: это текст модели).

# 10 — Вид `video` в строке Evidence и privacy check клипов

Type: task
Status: claimed 2026-11-04T13:26Z
Blocked by: —
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 6, «Модель» («Строка Evidence», «Клип и contact sheet»), «Privacy check» («Клипы»), «Вопросы владельцу», Qv1, Qv2, Qv3; слово владельца 2026-11-04 («worfy должен уметь делать скриншоты и даже записывать видео как доказательство, если задача того требует»)

Платформенный Ticket: скрипты Harness с путями и разбором файлов — Windows verdict до merge, как у 01 и 02. Глубина ревью — `high`:
ошибка privacy check — утечка в публичный репозиторий.

## Что происходит

- Видов строки Evidence семь, `video` среди них нет: `KINDS` в `harness/lib/evidence.cjs:25` и `src/shared/workflow/evidence.ts:18`.
  Вид, который называет копию приложения, — `COPY_REQUIRED` (`evidence.cjs:32`, `evidence.ts:25`); вид, который доказывает ручной
  пункт, — `MANUAL_PROOF` (`evidence.cjs:34`, `evidence.ts:27`). Глоссарий — `harness/bin/TICKETS.md:78`, `:83-86`, `:91-94`.
- `ticket evidence … <kind>` проверяет вид через `evidenceProblem` (`harness/bin/ticket:234`); `--copy` обязателен у
  `COPY_REQUIRED` (`harness/bin/ticket:219`). Файл из `ref` команда не открывает.
- `evidence-check` знает снимки: `IMAGE_EXT` (`harness/bin/evidence-check:75`), metadata — `imageText` (`:269`). Любой другой
  двоичный файл, добавленный веткой, требует отметку (`:285-302`), но отметку проверка ищет только в строке `- evidence: screenshot`
  (`SCREENSHOT_LINE`, `:77`; `collectNotes`, `:306-315`). Клип `.webm` сейчас «отмечается» строкой `screenshot`, а metadata
  контейнера (`Title`, теги, имена вложений) не читается вовсе. Размер и длительность не ограничены.
- Глазом клип проверить дольше снимка: минуту надо смотреть целиком. Поэтому рядом с клипом лежит contact sheet — одна PNG, кадр на
  каждую секунду (spec, «Клип и contact sheet»); его делает helper записи (11). Этот Ticket только требует, чтобы sheet был.
- Правила текста (`harness/lib/privacy.cjs`, `findings`) уже годятся для текста metadata: их зовёт `checkText` (`evidence-check:164`).
  `privacy.cjs` не меняется.

## Что делаем

Текст Harness — английский (ADR-0074).

1. **`harness/lib/evidence.cjs` и `src/shared/workflow/evidence.ts`** — вид `video` в `KINDS`, `COPY_REQUIRED` и `MANUAL_PROOF`: клип,
   как снимок, называет копию приложения и доказывает ручной пункт. Причина состояния «manual item needs owner-check or screenshot»
   становится «manual item needs owner-check, screenshot or video» в обеих копиях. Общие fixture-строки
   (`harness/bin/tests/fixtures/evidence/`) получают строки `video`; contract test согласия их читает.
2. **`harness/bin/ticket`** — `ticket evidence <epic> <NN> <item> video <pass|fail> --ref "<путь в backticks>" --copy C --scrub YYYY-MM-DD`:
   - без `--scrub` — exit 2 «a video needs --scrub <date>: check every frame of its contact sheet first» (Ответ Qv1);
   - `ref` — путь в backticks к файлу `.webm` или `.mp4` (Ответ Qv3), относительно файла Ticket-а; нет файла или другое расширение — exit 2;
   - рядом нет `<имя без расширения>.sheet.png` — exit 2 «no contact sheet next to the clip: <путь>»;
   - в Silent mode (Tickets root вне репозитория) — те же проверки: публиковать нечего, но клип и sheet будут смотреть.
   Privacy check самого файла из `ticket evidence` подключает 03 — этот Ticket его не зовёт.
3. **`harness/bin/evidence-check`** — клипы (`.webm`, `.mp4`):
   - **metadata**: webm (Matroska, EBML) — `Info/Title`, `MuxingApp`, `WritingApp`, `Tags/SimpleTag` (`TagName`, `TagString`),
     `Attachments/AttachedFile/FileName`; mp4 — `moov/udta` (атомы `©…`), `meta/ilst`, `uuid`-box XMP. Текст идёт через `checkText`, как у
     снимков; `line` в выводе — имя элемента или атома.
   - **звук**: дорожка аудио (webm `TrackType` 2, mp4 `hdlr` `soun`) — находка `video has an audio track`. Playwright пишет клип без
     звука; звук в клипе — это микрофон машины.
   - **размер и длительность** (Ответ Qv2): файл больше 8 MB (8 × 1024 × 1024 байт) — находка `video over 8 MB`; длительность из
     заголовка (webm `Info/Duration` × `TimecodeScale`, mp4 `mvhd` duration / timescale) больше 60 с — `video over 60 s`; длительности в
     заголовке нет — `video duration unknown`, иначе предел обходится.
   - **отметка**: клип, который ветка добавляет, отмечен только добавленной той же веткой строкой `- evidence: video … · scrub: <дата>`,
     где путь `ref` ведёт на этот файл (то же разрешение пути, что у снимков в `collectNotes`). Строка `screenshot` клип больше не
     отмечает. Нет отметки — `video needs a human check (no scrub: note)`.
   - **contact sheet**: рядом с добавленным клипом нет `<имя>.sheet.png`, добавленного той же веткой, — находка
     `video needs a contact sheet`. Sheet покрыт отметкой своего клипа, отдельная строка `screenshot` ему не нужна; его собственная
     metadata PNG проверяется, как у любого снимка.
   - Изменённый или старый клип находок про отметку и sheet не даёт — как снимок.
   - Разбор строки `video` — свой, рядом с `SCREENSHOT_LINE` (решение 5 spec-а): одно выражение на оба вида.
4. **`--help` `evidence-check`** — в список «what it cannot catch»: кадры между секундами contact sheet и текст на пикселях клипа.
5. **`harness/bin/TICKETS.md`** — вид `video`, обязательный `--scrub`, contact sheet, пределы 8 MB и 60 с.

Не входит: helper записи и сборка contact sheet (11), показ в worfy (12), вызов `evidence-check` из `ticket evidence` и `pnpm lint` (03).

## Готово, когда

- [ ] Shell test `ticket-evidence`: `video` без `--scrub` — exit 2; без файла или с `.mov` — exit 2; без `.sheet.png` рядом — exit 2;
      с клипом, sheet и `--scrub` — строка записана, `ticket evidence <epic> <NN>` её показывает, ручной пункт с ней — `verified`.
- [ ] Unit test `evidence` и contract test `evidence-rules-agree`: `video` в обеих копиях, причина «manual item needs owner-check,
      screenshot or video» одинакова.
- [ ] Shell test `evidence-check`: webm и mp4 собраны в test-е из байтов (элементы EBML и атомы), значения — из кусков; путь домашней
      папки в `Title`, в `TagString` и в `©too` — находка с именем элемента; `WritingApp` вида `Lavf…` — не находка.
- [ ] Клип с дорожкой аудио — находка; клип 8 MB + 1 байт — находка; `Duration` 61 с — находка; клип без `Duration` — находка.
- [ ] Добавленный клип без строки `video … · scrub:` — находка; со строкой `screenshot … · scrub:` на него — тоже находка; с
      добавленной строкой `video` и sheet — чисто; без sheet — `video needs a contact sheet`; изменённый клип без отметки — не находка.
- [ ] Sheet с путём домашней папки в `tEXt` — находка, хотя клип отмечен.
- [ ] В выводе нет полного значения ни одной находки; fixture-ы и этот Ticket проходят `evidence-check` (exit 0).
- [ ] `bash harness/bin/tests/ticket-evidence.test.sh`, `bash harness/bin/tests/evidence-check.test.sh`,
      `pnpm test test/unit/evidence.test.ts test/contract/evidence-rules-agree.test.ts` — exit 0; Windows verdict до merge
      (платформенный); ревью `high`.

## Тесты

- Shell `harness/bin/tests/ticket-evidence.test.sh`, `harness/bin/tests/evidence-check.test.sh` — новые случаи.
- Unit `test/unit/evidence.test.ts`, contract `test/contract/evidence-rules-agree.test.ts` — новые строки fixture.
- Сначала падающий: `ticket evidence <epic> <NN> 1 video pass --ref …` — сейчас exit 2 «kind is one of …».
- Прогнать все `harness/bin/tests/ticket-*.test.sh`, `evidence-check.test.sh`, `land.test.sh` (`land` пишет строки через `ticket`).

## Где в коде

- `harness/lib/evidence.cjs`
- `src/shared/workflow/evidence.ts`
- `harness/bin/ticket`
- `harness/bin/evidence-check`
- `harness/bin/TICKETS.md`
- `harness/bin/tests/ticket-evidence.test.sh`
- `harness/bin/tests/evidence-check.test.sh`
- `harness/bin/tests/fixtures/evidence/`
- `test/unit/evidence.test.ts`
- `test/contract/evidence-rules-agree.test.ts`

Только читать: `harness/lib/privacy.cjs` (`findings`, `mask`), `harness/bin/tests/fixtures/evidence-check/`.

# 02 — Harness: `epic-wave` пишет маркер начала и конца каждой Wave

Type: task
Status: claimed 2026-11-06T09:43Z
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца», 4; «Решено без владельца», 1; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), «Пробелы», 2, «Рекомендация» (б); [06](../../worfy-autopilot-queue/issues/06-объём-и-доступ-work-track.md), Q2

## Что происходит

- Журнал решений Wave-ы ведётся только у Wave-ы без человека: `harness/skills/epic-wave/SKILL.md:288-310`, файл
  `runs/<project>/<epic>-wave-<UTC>/decisions.tsv`, строки — только через `bin/decision-log` (только дописывает).
- Ручная Wave нигде не оставляет границы: research 04 нашёл только эвристику по prompt-у и Subagent-ам.

## Что делаем

1. В `SKILL.md`: папку Wave-ы и `decisions.tsv` заводит **каждая** Wave, с человеком тоже. Первая строка — `wave-started`
   (why — Ticket-ы Wave-ы через запятую, evidence — `-`), последняя — `wave-finished` (why — исход: `merged N`,
   `stopped: <причина>`). Строки решений без человека — как сейчас, между ними.
2. Текст блока bash и объяснение — как сейчас, одна переменная пути на Wave; при выходе Wave-ы с ошибкой строка
   `wave-finished` — тоже.

## Готово, когда

- [ ] `harness/bin/tests/decision-log.test.sh`: пример из `SKILL.md` (две строки маркера и строка решения) даёт файл,
      который читает разбор worfy (формат — четыре поля через TAB, заголовок).
  - evidence: test-run pass · `bash harness/bin/tests/decision-log.test.sh` exit 0 · mac - · b55891661c00f6e31de5940927e515742a9cdc8f
- [ ] Текст `SKILL.md` — про каждую Wave; линза `documentation` без находок.
  - evidence: commit pass · epic-wave: every wave marks its start and end in decisions.tsv · - - · b55891661c00f6e31de5940927e515742a9cdc8f
- [ ] Test-ы — с `HOME` и `HARNESS_HOME` во временном каталоге. PR ждёт Windows (ADR-0056); `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · b55891661c00f6e31de5940927e515742a9cdc8f

## Тесты

- Shell test `harness/bin/tests/decision-log.test.sh` (случай маркера). Сначала падающий — строк `wave-started` в примере нет.

## Где в коде

- `harness/skills/epic-wave/SKILL.md`
- `harness/bin/tests/decision-log.test.sh`

Только читать: `harness/bin/decision-log`, `harness/hooks/rules/orchestrator.md`.

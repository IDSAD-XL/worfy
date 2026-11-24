# Какие skill-ы Harness вызывались за 30 дней — research

Подсчёт 2026-11-24 по transcript-ам Claude Code на Mac владельца. Это данные одного пользователя на одной машине.
Аналитики по другим пользователям у worfy нет.

Первая версия этой заметки считала строки transcript-ов. Владелец попросил перепроверить, и в тот же день подсчёт
переделан по Session-ам. Что изменилось — в конце заметки.

## Как считал

- Файлы: `~/.claude/projects/**/*.jsonl`, изменённые за последние 30 дней, — 6 733 файла. Один файл — одна Session
  или один subagent.
- В таблице — число файлов, где skill был использован хотя бы раз. Учтены три способа:
  - **Skill** — модель вызвала tool `Skill` (`"skill":"worfy:<name>"`);
  - **slash** — человек или Autopilot набрал slash-команду (`<command-name>/worfy:<name></command-name>`);
  - **файлом** — агент прочитал `SKILL.md` из установленного Harness через `Read` (путь внутри `worfy-stable.app`
    или папки plugin-ов). Так Product Session работает с `wayfinder` и `to-spec`: модель не может вызвать их сама.
- Чтение `SKILL.md` из репозитория или worktree не считается: это правка skill-а, а не работа по нему.
- Не попали в подсчёт:
  - run-ы eval-ов (у них временный HOME);
  - всё, что шло на PC. Например, `gate-queue` запускает Autopilot той машины, что обслуживает очередь gate.
- Session-ы Codex на этом Mac (14 файлов за 30 дней) посчитать этим способом нельзя. Имена skill-ов там стоят в
  списке skill-ов, который Codex кладёт в каждую Session, и вызов от упоминания не отличить.

## Таблица

«Модель» — модель может вызвать skill сама, его description лежит в контексте каждой Session. «Человек» — у skill-а
`disable-model-invocation: true`, его вызывают только slash-командой или читают файлом. «Case eval» — сколько
case-ов упоминают skill в своих файлах (`harness/evals/*/prompt.md`, `case.yaml`, `graders/`). Числа могут на
единицу расходиться с [research-текущие-eval-ы.md](research-текущие-eval-ы.md), раздел 2: та заметка считала по
карте покрытия. Есть ли у skill-а case вообще, в обеих заметках совпадает.

| Skill | Session-ов за 30 дней | Как | Кто вызывает | Case eval |
| --- | --- | --- | --- | --- |
| ship-ticket | 342 | Skill 340, slash 2, файлом 2 | модель | есть, 4 |
| epic-wave | 51 | slash 45, Skill 6, файлом 2 | модель | есть, 2 |
| research | 9 | Skill | модель | нет |
| grilling | 7 | Skill | модель | есть, 2 |
| code-review | 5 | Skill | модель | есть, 3 |
| domain-modeling | 5 | Skill | модель | только факт вызова |
| pr-reply | 4 | slash 3, Skill 1, файлом 1 | модель | есть, 3 |
| grill-with-docs | 4 | slash | человек | нет |
| pr-fix | 4 | slash | модель | есть, 4 |
| human-review-setup | 3 | slash | человек | есть, 3 |
| diagnosing-bugs | 3 | Skill | модель | нет |
| owner-check | 2 | Skill 1, slash 1 | модель | нет |
| continuous-audit | 2 | файлом | модель | нет |
| prototype | 2 | Skill | модель | нет |
| writing-for-agents | 2 | Skill | модель | нет |
| product-ideas | 2 | Skill | модель | есть, 1 |
| wayfinder | 2 | файлом | человек | есть, 1 |
| max-review | 1 | Skill | модель | нет |
| connect-project | 1 | slash | модель | нет |
| wait-what | 1 | slash | человек | нет |
| to-spec | 1 | файлом | человек | только запрет вызова в product-ideas |
| codebase-design, gate-queue, qmd, tdd, tickets-to-tasks | 0 | — | модель | нет |
| to-tickets | 0 | — | человек | есть, 1 |
| grill-me, handoff, improve-codebase-architecture, overnight-fix-loop, retro, teach, to-questionnaire | 0 | — | человек | нет |

Старое имя `spike-root` (1 Session) в нынешнем Harness не существует и в таблицу не вошло.

## Что из этого следует

- Почти вся нагрузка — ship-ticket и epic-wave. У обоих есть case-ы.
- Вызывались, но case-а нет: research, grill-with-docs, diagnosing-bugs, owner-check, continuous-audit, prototype,
  writing-for-agents, max-review, connect-project, wait-what.
- Пять skill-ов модель может вызвать сама, но за 30 дней не вызвала ни разу: codebase-design, gate-queue, qmd, tdd,
  tickets-to-tasks. Их description лежат в контексте каждой Session. У gate-queue причина может быть в машине: его
  вызовы идут на PC.
- connect-project владелец вызвал один раз, но каждый новый пользователь начинает с него: диалог worfy «Add project»
  зовёт этот skill. Частота у владельца здесь мало что говорит.

## Что изменилось после перепроверки

- Первая версия считала строки, а не Session-ы, и завышала числа: ship-ticket 729 → 342, epic-wave 215 → 51,
  grilling 37 → 7, domain-modeling 33 → 5, grill-with-docs 21 → 4, research 20 → 9. Порядок skill-ов почти не
  изменился.
- Первая версия не видела skill-ы, прочитанные файлом. Поэтому continuous-audit ошибочно стоял среди невызванных: на
  деле его дважды прочитали из установленного Harness. Невызванных skill-ов, которые модель может вызвать сама, пять,
  а не шесть.
- Список «вызывались, но без case-а» был неполным. Добавлены continuous-audit, prototype, connect-project и wait-what.

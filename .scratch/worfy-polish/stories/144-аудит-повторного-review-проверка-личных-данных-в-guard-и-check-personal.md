# Code story — worfy-polish 144: Аудит повторного review: проверка личных данных в guard и check-personal

Kind: pr · Epic: worfy-polish · Ticket: 144 · PR: - · Language: ru

## 1. Что было не так

Три находки аудита повторного review смёрженных PR (95, 121, 196) про проверку текста, который уходит наружу.
Guard hook-а Bash (`harness/hooks/guard.mjs`) читает файл payload-а `gh api` до запуска команды: в
`cp draft.json payload.json && gh api … --input payload.json` он проверял старый текст `payload.json`, а в GitHub
уходил новый (95). Неявный POST `gh api <endpoint> --input p.json` без `-X` не покрывал ни один test (121).
`scripts/check-personal.mjs` (проверка личных данных в `pnpm lint`) находил кириллическое слово deny list только в
именительном падеже (196).

- Требование: [Что происходит](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-происходит)

## 2. Guard помнит прочитанные файлы payload-а

Code: `harness/hooks/guard.mjs:666-673` · key lines: 668, 671

```js
    const texts = []
    const unread = []
    const read = [] // the files read from disk: {written}
    const send = (f) => {
        const t = fileText(f, dir, unread)
        if (t.length) read.push({ written: f })
        return t
    }
```

- Что делает: каждый файл, который `gh api` отправляет (`--input`, `-F key=@file`), читается через `send`; файл,
  который удалось прочитать, записывается в `read` под тем именем, как он написан в команде.
- Почему здесь: Ticket называет разбор `gh api` в `guard.mjs:640-690` среди своих файлов; раньше guard помнил только
  непрочитанные файлы (`unread`).
- Без него: guard не знает, какие прочитанные файлы команда называет до `gh api`.
- Требование: [Что делаем, п. 1](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: `gh pr --body-file` и `git commit -F` так не помечаются — ticket говорит только про
  `gh api`.

## 3. Файл, названный раньше в той же команде, — «старый»

Code: `harness/hooks/guard.mjs:692-700` · key lines: 695, 696, 697, 700

```js
    // A file named in an earlier part of the same command may be one that part writes: the guard reads it before
    // anything of the command runs, so it either does not exist yet or still has its old text.
    const start = flat.search(/(^|[^\w-])gh\s+api\b/)
    const earlier = (u) => {
        const at = flat.indexOf(u.written)
        return at !== -1 && at < start
    }
    for (const u of unread) u.earlier = earlier(u)
    const stale = read.filter(earlier)
```

- Что делает: одно правило «путь стоит в тексте команды раньше `gh api`» теперь применяется и к непрочитанным файлам
  (как раньше, `u.earlier`), и к прочитанным (`stale`). `stale` уходит в check вместе с `unread`.
- Почему здесь: ticket просит отказ «только при упоминании пути до `gh api`»; правило `u.earlier` уже было здесь.
- Без него: существующий файл, который команда перезаписывает перед отправкой, проверяется по старому тексту.
- Требование: [Что делаем, п. 1](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: поиск по подстроке — `cat payload.json && gh api … --input payload.json` (файл только
  читают) тоже будет отказом в проекте, который проверяет тексты; совет «отправьте следующей командой» его снимает.

## 4. Отказ — только там, где проект проверяет тексты

Code: `harness/hooks/guard.mjs:338-353` · key lines: 340, 341, 352

```js
        // A file read with its old text: refused only where the project checks texts at all (a clean verdict), not
        // where silent-check had nothing to check (a Full project with attribution on, a folder outside a project).
        const stale = c.stale || []
        if (r.status === 0 && stale.length && /^silent-check: clean\b/m.test(r.stdout || ""))
            deny(
                notRun +
                    stale
                        .map(
                            (u) =>
                                `an earlier part of this same command names \`${u.written}\`, a file it sends: the guard reads that file before any ` +
                                "part of the command runs, so it checked the text the file had before, not the one that part may write into it, " +
                                "and running the same command again ends the same way. "
                        )
                        .join("") +
                    "Nothing was published. Write the file in one command, then send it in the next one."
            )
```

- Что делает: если `bin/silent-check` ответил «clean» (проект Silent или с `attribution: off`, проверка шла), а
  среди файлов есть «старый», команда отклоняется тем же советом, что и для ещё не созданного файла. Ответ «nothing to
  check» (Full-проект с attribution on) отказа не даёт.
- Почему здесь: ticket требует тот же текст отказа «Write the file in one command, then send it in the next one»
  (`guard.mjs:345-352`); почему Full-проект пропускается — его test «full: write the payload and post it in one
  command -> allow» уже закреплял это для несуществующего файла.
- Без него: в Silent-проекте текст с trace-ом или attribution, записанный в существующий файл в той же команде,
  публикуется.
- Требование: [Что делаем, п. 1](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: guard различает «clean» и «nothing to check» по строке stdout `silent-check`; если её
  текст поменяется, отказ пропадёт молча — test `guard-silent.test.sh` («overwrite an existing clean payload…»)
  это поймает. Старый текст с trace-ом даёт обычный отказ «carries traces», не этот.

## 5. Test-ы guard: перезапись payload-а и неявный POST с `--input`

Code: `harness/hooks/tests/guard-silent.test.sh:275-284` · key lines: 278, 279, 283

```bash
# The same when the payload already exists: the guard would read its old text, not the one the earlier part writes.
printf '{"body":"Looks right."}\n' >"$T/payload.json"
printf '{"body":"See Ticket 05"}\n' >"$T/draft.json"
COPY_THEN_POST="cp \"$T/draft.json\" \"$T/payload.json\" && gh api -X POST repos/o/r/issues/7/comments --input \"$T/payload.json\""
expect "silent: overwrite an existing clean payload and post it in one command -> deny, telling to split it" deny "$R" "$COPY_THEN_POST" \
    'Write the file in one command, then send it in the next one'
[[ "$got" == *'payload.json'* && "$got" != *'then run the same command again'* ]] && ok "overwrite then post: the refusal names the file, not a rerun" \
    || bad "overwrite then post: ${got:0:400}"
expect "silent: post an existing clean payload the command does not name earlier -> allow" allow "$R" \
    "echo start && gh api -X POST repos/o/r/issues/7/comments --input \"$T/payload.json\""
```

- Что делает: сценарий находки 95 — `payload.json` уже есть с чистым текстом, команда копирует в него текст с
  trace-ом и отправляет — отказ. Тот же файл, не названный раньше `gh api`, проходит. Для Full-проекта та же команда
  добавлена в список `full_api` (проходит). Рядом с `:120` — test находки 121: `gh api repos/o/r/issues/7/comments
  --input p.json` без метода, в файле trace — отказ.
- Почему здесь: ticket называет места test-ов — рядом с `:267` и `:114` файла `guard-silent.test.sh`.
- Без него: mutant «убрать `|| input !== undefined`» в разборе метода выживал.
- Требование: [Готово, когда](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#готово-когда)
- Риски и пробелы test-ов: trace в test-ах — номер ticket-а: deny list пользователя в test не попадает (его значения
  только в `~/.claude/worfy-harness/user/privacy.json`), а guard проверяет оба через один `silent-check`.

## 6. check-personal: кириллическое слово в косвенном падеже

Code: `scripts/check-personal.mjs:132-144` · key lines: 134, 136, 137, 139, 140

```js
function nominatives(word) {
  const out = new Set()
  if (!CYRILLIC_WORD.test(word)) return out
  for (const ending of CASE_ENDINGS) {
    if (!word.endsWith(ending)) continue
    const stem = word.slice(0, -ending.length)
    for (const back of NOMINATIVE_ENDINGS) {
      const form = stem + back
      if (form !== word && [...form].length >= MIN_STEMMED) out.add(form)
    }
  }
  return out
}
```

- Что делает: для слова из одних кириллических букв снимает каждое подходящее падежное окончание из фиксированного
  списка (`CASE_ENDINGS`, записан escape-ами: код ASCII) и ставит на место окончание именительного падежа (нет, -а, -я,
  -й, -ь). Формы короче четырёх букв не берутся. `declined()` хеширует эти формы и сравнивает с hash-ами deny list;
  ответ кешируется по слову.
- Почему здесь: путь (б) вопроса владельцу — script хранит только hash-и записей, основу слова он не знает, поэтому
  снимает окончание со слова текста. Ответа владельца ещё нет; ticket велит в этом случае делать (б). Возврат
  окончания именительного — дополнение к (б): без него запись на -а или -й («…ница», «…лей») в косвенном падеже не
  находится.
- Без него: фамилия из deny list в форме «…ова», «…овым» проходит `pnpm lint` и CI.
- Требование: [Вопрос владельцу](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#вопрос-владельцу-только-для-196)
- Риски и пробелы test-ов: больше ложных finding-ов — слово, которое после снятия окончания совпало с записью, даже
  если это другое слово. Не ловятся суффиксы (-ович), беглая гласная и окончания других кириллических языков
  (`shortcut:` над списком). `check-personal` на всём repository стал медленнее: 5.5 s → 6.3 s на этой машине.

## 7. Где правило подключено

Code: `scripts/check-personal.mjs:186-192` · key lines: 192

```js
  let before1
  for (const m of text.matchAll(re)) {
    const word = normal(m[0])
    const h = wordHash(word)
    const current = { word, start: m.index, lead: deny.first.has(h.slice(0, PREFIX)) }
    const end = m.index + m[0].length
    if (deny.full.has(h) || declined(word, deny)) add(current.start, end, word)
```

- Что делает: слово — finding, если его hash в списке или если одна из его «именительных» форм в списке. Ключ
  finding-а — слово как оно стоит в тексте, с окончанием: исключение в `check-personal.allow.json` хеширует эту форму.
- Почему здесь: ticket ограничивает правило записями из одного слова; пары и тройки слов идут прежним путём ниже.
- Без него: `nominatives` не вызывается.
- Требование: [Что делаем, п. 3](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 8. Что сознательно не меняли

`harness/lib/privacy.cjs` (guard сессий ищет слово в любом месте текста) — по ticket-у только читать. Латинские записи,
склеенные с буквой (`foos` для `foo`), — правило прежнее. Test `${CYRILLIC}ович не целое слово` остался: суффикс -ович
не падежное окончание.

## 9. Как проверено

Test находки 95 в `guard-silent.test.sh` — красный на origin/main (`passed 193, failed 2`), зелёный после правки
(`passed 195, failed 0`). Test находки 121 зелёный и на старом коде, mutant «убрать `|| input !== undefined`» — красный
(`passed 194, failed 1`). Новый unit test `check-personal.test.ts` — красный на старом коде, 27 passed после правки.
`harness/hooks/tests/rules-hooks.test.sh` — 346 passed, exit 0. `check-personal` на repository — no findings.

## Проверить себя

1. Почему guard не отклоняет «перезапись и отправку в одной команде» в Full-проекте с attribution on?
   - Ответ: отказ стоит только после ответа `silent-check` «clean»; в таком проекте он отвечает «nothing to check», и
     текст там не проверяется вообще — старый он или новый, неважно.
   - Строки: `harness/hooks/guard.mjs:338-341`
2. Почему script снимает окончание со слова текста, а не склоняет запись deny list?
   - Ответ: в repository лежат только hash-и записей; самих слов script не знает, поэтому может только приводить слово
     текста к возможному именительному и хешировать его.
   - Строки: `scripts/check-personal.mjs:132-144`
3. Какую форму хеширует исключение для finding-а в косвенном падеже?
   - Ответ: слово как оно стоит в тексте, с окончанием — ключ finding-а `word`, не найденная форма записи.
   - Строки: `scripts/check-personal.mjs:192`

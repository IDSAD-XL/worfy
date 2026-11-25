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

## 2. Guard помнит прочитанные файлы payload-а и их полный путь

Code: `harness/hooks/guard.mjs:686-691` · key lines: 686, 689

```js
    const read = [] // the files read from disk: {written, abs}
    const send = (f) => {
        const t = fileText(f, dir, unread)
        if (t.length) read.push({ written: f, abs: path.resolve(dir, expandPath(f)) })
        return t
    }
```

- Что делает: каждый файл, который `gh api` отправляет (`--input`, `-F key=@file`), читается через `send`; файл,
  который удалось прочитать, записывается в `read` с именем, как оно написано в команде, и с полным путём (`abs`) —
  тем же разрешением, что у `fileText`.
- Почему здесь: Ticket называет разбор `gh api` в `guard.mjs:640-690` среди своих файлов; раньше guard помнил только
  непрочитанные файлы (`unread`). Полный путь — п. 2 review round 1: `./p.json`, абсолютный путь и `"p".json` должны
  считаться одним файлом.
- Без него: guard не знает, какие прочитанные файлы команда называет до `gh api`.
- Требование: [Что делаем, п. 1](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: `gh pr --body-file` и `git commit -F` так не помечаются — ticket говорит только про
  `gh api`.

## 3. Что называют команды до этого вызова

Code: `harness/hooks/guard.mjs:273-279` · key lines: 276, 278, 279

```js
    // The paths the commands before the current one name (their words and redirection targets, resolved against the
    // directory each ran in), and the raw text before it: a file a gh api call sends that an earlier command names may
    // be one that command writes.
    const named = new Set()
    for (const words of lex(flat)) {
        const before = { text: flat.slice(0, words.at), paths: new Set(named) }
        for (const x of [...words, ...words.redirects]) for (const p of namedPaths(x, dir)) named.add(p)
```

- Что делает: перед каждой командой строки guard снимает «что было раньше»: текст до начала этой команды и множество
  полных путей, которые назвали предыдущие команды (слова и цели redirect-ов, разрешённые от папки, где команда
  шла). Затем добавляет пути текущей команды.
- Почему здесь: review round 1, п. 1 — раньше «раньше» отсчитывалось от первого `gh api` всей строки
  (`flat.search`), и `gh api … --jq .title && cp d p && gh api … --input p` проходил. Lexer (`lex`) теперь отдаёт у
  каждой команды `at` (смещение начала) и `redirects` (цели `>`/`<`).
- Без него: второй `gh api` в одной строке отправлял перезаписанный файл без отказа.
- Требование: [Что делаем, п. 1](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: пути из слов внутри скрипта (`node -e '…writeFileSync("p.json")'`) не разбираются — их
  ловит только сравнение текста (шаг 5).

## 4. Пути, которые называет слово команды

Code: `harness/hooks/guard.mjs:863-870` · key lines: 867, 868

```js
// The paths a word of a command may name, resolved the way fileText resolves a path: the word itself, the value of a
// --flag=value word and of a key=@file field.
function namedPaths(word, dir) {
    const out = []
    for (const x of [word, word.replace(/^--?[\w-]+=/, ""), word.replace(/^[^=@]*=?@/, "")])
        if (x && !/^-/.test(x)) out.push(path.resolve(dir, expandPath(x)))
    return out
}
```

- Что делает: из слова команды берёт пути, которые оно может назвать: само слово, значение `--flag=value` и
  `key=@file`, — и разрешает их так же, как `fileText` (`~`, `$HOME`, переменные команды, Git Bash на Windows).
- Почему здесь: not recorded, кроме требования review сравнивать разрешённые пути.
- Без него: `cp d ./p.json && gh api … --input /abs/p.json` проходил.
- Требование: [Что делаем, п. 1](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: слово, похожее на путь, но им не являющееся, тоже попадает в множество — это лишь
  лишнее сравнение, отказ даёт только совпадение с отправляемым файлом.

## 5. Файл, названный раньше, — «старый»

Code: `harness/hooks/guard.mjs:709-716` · key lines: 714, 715, 716

```js
    if (!all.length && !unread.length) return
    // A file named in an earlier part of the same command may be one that part writes: the guard reads it before
    // anything of the command runs, so it either does not exist yet or still has its old text. Earlier is before this
    // gh api call; named is the same path in any spelling (./x, the absolute path, a quoted part), or the path as
    // written anywhere in the text before the call (inside a script: node -e '…writeFileSync("p.json")').
    const earlier = (u) => before.paths.has(u.abs) || before.text.includes(u.written)
    for (const u of unread) u.earlier = earlier(u)
    const stale = read.filter(earlier)
```

- Что делает: файл считается названным раньше, если его полный путь есть среди путей предыдущих команд или его
  написание стоит в тексте до этого вызова. Правило одно для непрочитанных файлов (`u.earlier`, как раньше) и для
  прочитанных (`stale`).
- Почему здесь: ticket просит отказ «только при упоминании пути до `gh api`»; правило `u.earlier` уже было здесь.
- Без него: существующий файл, который команда перезаписывает перед отправкой, проверяется по старому тексту.
- Требование: [Что делаем, п. 1](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#что-делаем)
- Риски и пробелы test-ов: сравнение текста — подстрока: `cat p.json && gh api … --input p.json` (файл только
  читают) тоже отказ в проекте, который проверяет тексты; совет «отправьте следующей командой» его снимает.

## 6. Отказ — только там, где проект проверяет тексты

Code: `harness/hooks/guard.mjs:344-359` · key lines: 346, 347, 358

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

## 7. Test-ы guard: перезапись payload-а и неявный POST с `--input`

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
  добавлена в список `full_api` (проходит). Ниже (`:285-308`) — test-ы review round 1: `gh api`-чтение или
  `gh api` с тем же файлом раньше в строке, затем перезапись и отправка — отказ; тот же файл как `./x`, по полному
  пути, с кавычками внутри имени, как цель redirect-а — отказ. Рядом с `:120` — test находки 121: `gh api repos/o/r/issues/7/comments
  --input p.json` без метода, в файле trace — отказ.
- Почему здесь: ticket называет места test-ов — рядом с `:267` и `:114` файла `guard-silent.test.sh`.
- Без него: mutant «убрать `|| input !== undefined`» в разборе метода выживал.
- Требование: [Готово, когда](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#готово-когда)
- Риски и пробелы test-ов: trace в test-ах — номер ticket-а: deny list пользователя в test не попадает (его значения
  только в `~/.claude/worfy-harness/user/privacy.json`), а guard проверяет оба через один `silent-check`.

## 8. check-personal: кириллическое слово в косвенном падеже

Code: `scripts/check-personal.mjs:128-149` · key lines: 128, 133, 139, 145

```js
const NOMINATIVE_ENDINGS = ['', '\u0430', '\u044f', '\u0439', '\u044c', '\u0438\u0439', '\u044b\u0439', '\u043e\u0439']
// The stemming applies to entries of one word and at least four letters: a shorter one would match too many
// unrelated words. A bare stem (no nominative ending put back) counts from five letters: a four-letter entry
// that ends in a consonant is too often the stem of an unrelated word (a name inside a common noun).
const MIN_STEMMED = 4
const MIN_BARE_STEM = 5
const CYRILLIC_WORD = /^\p{Script=Cyrillic}+$/u

/** The forms of a Cyrillic word of the text that may be the nominative of a list entry it declines. */
function nominatives(word) {
  const out = new Set()
  if (!CYRILLIC_WORD.test(word)) return out
  for (const ending of CASE_ENDINGS) {
    if (!word.endsWith(ending)) continue
    const stem = word.slice(0, -ending.length)
    for (const back of NOMINATIVE_ENDINGS) {
      const form = stem + back
      if (form !== word && [...form].length >= (back ? MIN_STEMMED : MIN_BARE_STEM)) out.add(form)
    }
  }
  return out
}
```

- Что делает: для слова из одних кириллических букв снимает каждое подходящее падежное окончание из фиксированного
  списка (`CASE_ENDINGS`, записан escape-ами: код ASCII) и ставит на место окончание именительного падежа (нет, -а, -я,
  -й, -ь, и прилагательные -ий, -ый, -ой — фамилии на -ский, -цкий, -ой). Формы короче четырёх букв не берутся;
  голая основа (без окончания именительного) — только от пяти букв. `declined()` хеширует эти формы и сравнивает с hash-ами deny list;
  ответ кешируется по слову.
- Почему здесь: путь (б) вопроса владельцу — script хранит только hash-и записей, основу слова он не знает, поэтому
  снимает окончание со слова текста. Ответа владельца ещё нет; ticket велит в этом случае делать (б). Возврат
  окончания именительного — дополнение к (б): без него запись на -а или -й («…ница», «…лей») в косвенном падеже не
  находится. Окончания прилагательных и порог в пять букв для голой основы — review round 1 (п. 3 и 4): без порога
  запись из четырёх букв находилась бы внутри обычного слова, у которого она — основа.
- Без него: фамилия из deny list в форме «…ова», «…овым» проходит `pnpm lint` и CI.
- Требование: [Вопрос владельцу](../issues/144-аудит-повторного-review-проверка-личных-данных-в-guard-и-check-personal.md#вопрос-владельцу-только-для-196)
- Риски и пробелы test-ов: больше ложных finding-ов — слово, которое после снятия окончания совпало с записью, даже
  если это другое слово. Не ловятся суффиксы (-ович), беглая гласная и окончания других кириллических языков
  (`shortcut:` над списком). Запись из четырёх букв на согласную в косвенном падеже не находится. `check-personal` на
  всём repository стал медленнее: user CPU 5.3 s → 6.1 s при низкой нагрузке, 8.7 s → 11.1 s при load average 35–45.

## 9. Где правило подключено

Code: `scripts/check-personal.mjs:191-197` · key lines: 197

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

## 10. Что сознательно не меняли

`harness/lib/privacy.cjs` (guard сессий ищет слово в любом месте текста) — по ticket-у только читать. Латинские записи,
склеенные с буквой (`foos` для `foo`), — правило прежнее. Test `${CYRILLIC}ович не целое слово` остался: суффикс -ович
не падежное окончание.

## 11. Как проверено

Test находки 95 в `guard-silent.test.sh` — красный на origin/main (`passed 193, failed 2`), зелёный после правки
(`passed 195, failed 0`). Test находки 121 зелёный и на старом коде, mutant «убрать `|| input !== undefined`» — красный
(`passed 194, failed 1`). Новый unit test `check-personal.test.ts` — красный на старом коде, 27 passed после правки.
Review round 1: шесть новых test-ов guard — красные до правки (`passed 197, failed 6`), после — `passed 203, failed 0`;
два новых unit test-а check-personal (прилагательные, записи из четырёх букв) — красные до правки, после — 29 passed.
`harness/hooks/tests/rules-hooks.test.sh` — exit 0. `check-personal` на repository — no findings.

## Проверить себя

1. Почему guard не отклоняет «перезапись и отправку в одной команде» в Full-проекте с attribution on?
   - Ответ: отказ стоит только после ответа `silent-check` «clean»; в таком проекте он отвечает «nothing to check», и
     текст там не проверяется вообще — старый он или новый, неважно.
   - Строки: `harness/hooks/guard.mjs:344-347`
2. Почему script снимает окончание со слова текста, а не склоняет запись deny list?
   - Ответ: в repository лежат только hash-и записей; самих слов script не знает, поэтому может только приводить слово
     текста к возможному именительному и хешировать его.
   - Строки: `scripts/check-personal.mjs:137-149`
3. Какую форму хеширует исключение для finding-а в косвенном падеже?
   - Ответ: слово как оно стоит в тексте, с окончанием — ключ finding-а `word`, не найденная форма записи.
   - Строки: `scripts/check-personal.mjs:197`

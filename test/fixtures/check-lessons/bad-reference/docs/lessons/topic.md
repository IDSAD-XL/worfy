# Topic

## A reference without a line

Проверка: test/guard.txt

## A reference to a folder

Проверка: test/folder:1

## A reference outside the repository

Проверка: ../good/test/guard.txt:1

## A reference to a file that is not a test, a hook test or an eval case

Проверка: src/guard.txt:1

## A reference in backticks

Проверка: `test/guard.txt:1`

## A range

Проверка: test/guard.txt:1-3

## Two references

Проверка: test/guard.txt:1, test/guard.txt:2

## Free text only

Проверка: the unit test of the reader.

## Two check lines

Проверка: test/guard.txt:1
Проверка: проверки нет: a second line, even a good one.

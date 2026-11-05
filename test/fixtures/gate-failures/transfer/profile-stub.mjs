// A stand-in for bin/profile in test/contract/gate-failures-transfer.test.ts: `--field github.account`
// prints $STUB_ACCOUNT; without it the field is missing (exit 4), as bin/profile answers.
import process from "node:process"

const field = process.argv[process.argv.indexOf("--field") + 1]
if (field === "github.account" && process.env.STUB_ACCOUNT) process.stdout.write(`${process.env.STUB_ACCOUNT}\n`)
else process.exitCode = 4

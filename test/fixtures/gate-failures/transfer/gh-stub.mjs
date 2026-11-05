// A stand-in for gh in test/contract/gate-failures-transfer.test.ts: `gh api <endpoint>` prints the
// JSON that $GH_STUB_DIR/responses.json holds for the endpoint, and every call is one JSON line of
// its arguments in $GH_STUB_DIR/calls.jsonl. Anything else, or an endpoint it does not know, fails
// like gh does on a missing resource. Nothing reaches GitHub.
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const dir = process.env.GH_STUB_DIR
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, "calls.jsonl"), `${JSON.stringify(args)}\n`)
const responses = JSON.parse(fs.readFileSync(path.join(dir, "responses.json"), "utf8"))
if (args[0] === "api" && args.length === 2 && Object.hasOwn(responses, args[1])) {
    process.stdout.write(JSON.stringify(responses[args[1]]))
} else {
    process.stderr.write("gh: Not Found (HTTP 404)\n")
    process.exitCode = 1
}

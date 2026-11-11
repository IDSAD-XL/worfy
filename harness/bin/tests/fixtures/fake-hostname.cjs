// Preloaded by tests (`node --require` or NODE_OPTIONS="--require …") so that a script under test sees
// the host name FAKE_HOSTNAME instead of the name of the machine the test runs on. The real name is
// arbitrary: a host called like a word the checked files legitimately hold (a platform name, say) made
// the privacy checks fire on those files. With a known stand-in the tests can both feed the name in and
// assert that it never comes out. Does nothing when FAKE_HOSTNAME is unset or empty.
"use strict"
const os = require("node:os")
const { syncBuiltinESMExports } = require("node:module")

const fake = process.env.FAKE_HOSTNAME
if (typeof fake === "string" && fake !== "") {
    os.hostname = () => fake
    // `import { hostname } from "node:os"` in an ES module sees the stand-in too.
    syncBuiltinESMExports()
}

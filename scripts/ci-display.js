// Prints the size of the main display of a macOS machine, in points, for the log of the e2e job of
// the CI workflow (.github/workflows/ci.yml): a window of the app is never taller than the visible
// part of the screen, and a test that sets a taller window fails on its size.
//
//   osascript -l JavaScript scripts/ci-display.js   → (stderr) screen 1728x1117, visible 1728x1009, scale 2
//
// JavaScript for Automation, not Node: AppKit is reached through the Objective-C bridge of osascript.
/* global ObjC, $, console */
ObjC.import('AppKit')
const screen = $.NSScreen.mainScreen
const frame = screen.frame
const visible = screen.visibleFrame
// console.log of osascript writes to stderr, which the job log shows as well.
console.log(`screen ${frame.size.width}x${frame.size.height}, visible ${visible.size.width}x${visible.size.height}, scale ${screen.backingScaleFactor}`)

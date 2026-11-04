// mkclip.cjs <out> [<spec.json>] — a tiny synthetic clip for the tests of bin/evidence-check and `ticket evidence`:
// a webm (Matroska, EBML elements) or an mp4 (ISO BMFF boxes) put together from bytes, with no real frames.
// Nothing here was recorded from a screen. The spec (a JSON file, so Git Bash on Windows does not rewrite a value
// that looks like a path) says what the container holds:
//   format       "webm" (default) or "mp4"
//   duration     seconds; null — no duration in the header (webm: no Duration element; mp4: mvhd duration of all ones)
//   audio        true — a second track of sound (webm TrackType 2, mp4 hdlr "soun")
//   size         the size of the whole file in bytes: the rest is padding (webm Void element, mp4 mdat)
//   webm: title, muxingApp, writingApp, trackName, tagName, tagString, attachment (a file name),
//         liveCluster (true — a Cluster of unknown size before the Tags, as a live recording writes it),
//         timecodeScale (default 1000000)
//   mp4:  too (the ©too item of udta/meta/ilst), nam (a QuickTime ©nam text atom right in udta), xmp (the text
//         of a top-level uuid box with the XMP id)
"use strict"
const fs = require("fs")

const [out, specFile] = process.argv.slice(2)
const spec = specFile ? JSON.parse(fs.readFileSync(specFile, "utf8")) : {}
const duration = spec.duration === undefined ? 5 : spec.duration
const str = (s) => Buffer.from(String(s), "utf8")

function webm() {
    // An element: its ID (hex, with the marker bits), an 8-byte size (0x01 and 7 bytes), the payload.
    const size8 = (n) => {
        const b = Buffer.alloc(8)
        b.writeBigUInt64BE(BigInt(n))
        b[0] = 0x01
        return b
    }
    const el = (id, ...parts) => {
        const payload = Buffer.concat(parts.filter(Boolean).map((p) => (Buffer.isBuffer(p) ? p : str(p))))
        return Buffer.concat([Buffer.from(id, "hex"), size8(payload.length), payload])
    }
    const unknown = (id) => Buffer.concat([Buffer.from(id, "hex"), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])])
    const uint = (n) => {
        const b = Buffer.alloc(8)
        b.writeBigUInt64BE(BigInt(n))
        let i = 0
        while (i < 7 && b[i] === 0) i++
        return b.subarray(i)
    }
    const f64 = (x) => {
        const b = Buffer.alloc(8)
        b.writeDoubleBE(x)
        return b
    }
    const scale = spec.timecodeScale || 1000000
    const header = el("1a45dfa3", el("4286", uint(1)), el("42f7", uint(1)), el("4282", "webm"), el("4287", uint(4)), el("4285", uint(2)))
    const info = el(
        "1549a966",
        el("2ad7b1", uint(scale)),
        duration !== null && el("4489", f64((duration * 1e9) / scale)),
        el("4d80", spec.muxingApp || "Lavf61.1.100"),
        el("5741", spec.writingApp || "Lavf61.1.100"),
        spec.title !== undefined && el("7ba9", spec.title),
    )
    const tracks = el(
        "1654ae6b",
        el("ae", el("d7", uint(1)), el("83", uint(1)), el("86", "V_VP8"), spec.trackName !== undefined && el("536e", spec.trackName)),
        spec.audio && el("ae", el("d7", uint(2)), el("83", uint(2)), el("86", "A_OPUS")),
    )
    const tags =
        spec.tagString !== undefined &&
        el("1254c367", el("7373", el("63c0", Buffer.alloc(0)), el("67c8", el("45a3", spec.tagName || "COMMENT"), el("4487", spec.tagString))))
    const attachments = spec.attachment !== undefined && el("1941a469", el("61a7", el("466e", spec.attachment), el("4660", "text/plain"), el("465c", "x")))
    const block = el("a3", Buffer.from([0x81, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00]))
    const cluster = spec.liveCluster ? Buffer.concat([unknown("1f43b675"), el("e7", uint(0)), block]) : el("1f43b675", el("e7", uint(0)), block)
    const body = spec.liveCluster ? [info, tracks, cluster, tags, attachments] : [info, tracks, tags, attachments, cluster]
    let segment = el("18538067", ...body)
    if (spec.size) {
        // A Void element pads the segment to the size asked for: its header is 9 bytes, and the segment's grows by none.
        const pad = spec.size - header.length - segment.length - 9
        if (pad < 0) throw new Error(`size ${spec.size} is below the clip itself`)
        segment = el("18538067", ...body, el("ec", Buffer.alloc(pad)))
    }
    return Buffer.concat([header, segment])
}

function mp4() {
    const u32 = (n) => {
        const b = Buffer.alloc(4)
        b.writeUInt32BE(n >>> 0)
        return b
    }
    const u16 = (n) => {
        const b = Buffer.alloc(2)
        b.writeUInt16BE(n)
        return b
    }
    const box = (type, ...parts) => {
        const payload = Buffer.concat(parts.filter(Boolean).map((p) => (Buffer.isBuffer(p) ? p : str(p))))
        return Buffer.concat([u32(8 + payload.length), Buffer.from(type, "latin1"), payload])
    }
    const full = (type, ...parts) => box(type, u32(0), ...parts)
    const ftyp = box("ftyp", "isom", u32(512), "isomiso2avc1mp41")
    const mvhd = full("mvhd", u32(0), u32(0), u32(1000), u32(duration === null ? 0xffffffff : Math.round(duration * 1000)), u32(0x00010000), u16(0x0100), Buffer.alloc(10), Buffer.alloc(36), Buffer.alloc(24), u32(3))
    const trak = (handler, name) =>
        box("trak", full("tkhd", Buffer.alloc(80)), box("mdia", full("mdhd", Buffer.alloc(20)), full("hdlr", u32(0), handler, Buffer.alloc(12), name, Buffer.from([0]))))
    const ilst = spec.too !== undefined && box("ilst", box("©too", box("data", u32(1), u32(0), spec.too)))
    const meta = ilst && full("meta", full("hdlr", u32(0), "mdir", "appl", Buffer.alloc(8), Buffer.from([0])), ilst)
    const nam = spec.nam !== undefined && box("©nam", u16(Buffer.byteLength(spec.nam)), u16(0), spec.nam)
    const udta = (meta || nam) && box("udta", meta, nam)
    const moov = box("moov", mvhd, trak("vide", "VideoHandler"), spec.audio && trak("soun", "SoundHandler"), udta)
    const xmp = spec.xmp !== undefined && box("uuid", Buffer.from("be7acfcb97a942e89c71999491e3afac", "hex"), spec.xmp)
    const head = Buffer.concat([ftyp, moov, xmp || Buffer.alloc(0)])
    const pad = spec.size ? spec.size - head.length - 8 : 16
    if (pad < 0) throw new Error(`size ${spec.size} is below the clip itself`)
    return Buffer.concat([head, box("mdat", Buffer.alloc(pad))])
}

fs.writeFileSync(out, spec.format === "mp4" ? mp4() : webm())

// mkclip.cjs <out> [<spec.json>] — a tiny synthetic clip for the tests of bin/evidence-check and `ticket evidence`:
// a webm (Matroska, EBML elements) or an mp4 (ISO BMFF boxes) put together from bytes, with no real frames.
// Nothing here was recorded from a screen. The spec (a JSON file, so Git Bash on Windows does not rewrite a value
// that looks like a path) says what the container holds:
//   format       "webm" (default) or "mp4"
//   duration     seconds; null — no duration in the header (webm: no Duration element; mp4: mvhd duration of all ones)
//   size         the size of the whole file in bytes: the rest is padding (webm Void element, mp4 mdat)
//   webm:
//     title, muxingApp, writingApp, trackName, tagName, tagString, targetType, attachment (a file name),
//     fileDescription, fileData, chapString — text elements; timecodeScale (default 1000000)
//     audio        true — a second track of sound (TrackType 2 and an A_ codec); "type" — TrackType 2 only;
//                  "codec" — an A_ codec only; "element" — an Audio element only
//     extraTrack   {"type": <TrackType>, "codec": <CodecID>} — one more track (0x11 and S_TEXT/UTF8: subtitles)
//     compressed   true — a ContentEncodings element in the video track whose ContentCompression is zlib
//     liveCluster  true — a Cluster of unknown size before the Tags, as a live recording writes it
//     secondInfo   seconds — a second Info element with that Duration
//     deepTag      n — the SimpleTag of tagString nested n SimpleTags deep
//     info, track  [[<id hex>, <text>], …] — more elements in Info, in the video TrackEntry
//     segment      more items at the end of the Segment: [<id hex>, <text>] — an element; {"raw": <hex>} — bytes;
//                  {"unknown": <id hex>} — the header of an element of unknown size; {"tags": <text>} — a Tags
//                  element whose TagString is the text
//   mp4:
//     too (the ©too item of udta/meta/ilst), nam (a QuickTime ©nam text atom right in udta), xmp (the text of a
//     top-level uuid box with the XMP id), hdlrName (the name of the video track's handler)
//     audio        true — a second track whose hdlr is "soun"; "stsd" — a second track whose hdlr is "vide" but
//                  whose sample entry is mp4a; "short" — a hdlr "soun" of 12 bytes, with no name
//     mehd         seconds — a fragmented file: mvex/mehd with that duration, and a moof
//     secondMoov   seconds — a second moov with that duration
//     trak         [<handler>, …] — more tracks with those hdlr handler types ("text", "meta", "tmcd", …)
//     minf, moov, udta, meta, ilst, top — more boxes in the video track's minf, in moov, in moov/udta, in
//                  udta/meta, in the ©too item of ilst, and at the top level before mdat. A box is
//                  {"type": <4 chars>, "text": <text>, "hex": <hex>, "full": true, "children": [<box>, …]}
//                  (all but type optional); {"raw": <hex>} — bytes as they are
// Any text above may be {"text": <text>, "utf16": "le" | "be", "bom": true, "gzip": true, "deflate": true}: its
// bytes in UTF-16 (after a byte order mark), or compressed with gzip or zlib.
"use strict"
const fs = require("fs")
const zlib = require("zlib")

const [out, specFile] = process.argv.slice(2)
const spec = specFile ? JSON.parse(fs.readFileSync(specFile, "utf8")) : {}
const duration = spec.duration === undefined ? 5 : spec.duration
const str = (s) => Buffer.from(String(s), "utf8")
const encoded = (v) => {
    let b = v.utf16 ? Buffer.from(String(v.text), "utf16le") : str(v.text)
    if (v.utf16 === "be") b.swap16()
    if (v.bom) b = Buffer.concat([Buffer.from(v.utf16 === "be" ? [0xfe, 0xff] : [0xff, 0xfe]), b])
    if (v.gzip) b = zlib.gzipSync(b)
    if (v.deflate) b = zlib.deflateSync(b)
    return b
}
const join = (parts) => Buffer.concat(parts.filter(Boolean).map((p) => (Buffer.isBuffer(p) ? p : typeof p === "object" ? encoded(p) : str(p))))

function webm() {
    // An element: its ID (hex, with the marker bits), an 8-byte size (0x01 and 7 bytes), the payload.
    const size8 = (n) => {
        const b = Buffer.alloc(8)
        b.writeBigUInt64BE(BigInt(n))
        b[0] = 0x01
        return b
    }
    const el = (id, ...parts) => {
        const payload = join(parts)
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
    const pairs = (list) => (list || []).map(([id, text]) => el(id, text))
    const tagsOf = (text, name, deep = 0, target) => {
        let simple = el("67c8", el("45a3", name || "COMMENT"), el("4487", text))
        for (let i = 0; i < deep; i++) simple = el("67c8", el("45a3", `LEVEL${i}`), el("4487", "v"), simple)
        return el("1254c367", el("7373", el("63c0", target !== undefined && el("63ca", target)), simple))
    }
    const scale = spec.timecodeScale || 1000000
    const header = el("1a45dfa3", el("4286", uint(1)), el("42f7", uint(1)), el("4282", "webm"), el("4287", uint(4)), el("4285", uint(2)))
    const info = (seconds, extra) =>
        el(
            "1549a966",
            el("2ad7b1", uint(scale)),
            seconds !== null && el("4489", f64((seconds * 1e9) / scale)),
            el("4d80", spec.muxingApp || "Lavf61.1.100"),
            el("5741", spec.writingApp || "Lavf61.1.100"),
            spec.title !== undefined && el("7ba9", spec.title),
            ...pairs(extra),
        )
    const audio = spec.audio
    const audioTrack =
        audio &&
        el(
            "ae",
            el("d7", uint(2)),
            el("83", uint(audio === "codec" || audio === "element" ? 1 : 2)),
            el("86", audio === "type" || audio === "element" ? "V_VP8" : "A_OPUS"),
            audio === "element" && el("e1", el("b5", f64(48000)), el("9f", uint(1))),
        )
    const encodings = spec.compressed && el("6d80", el("6240", el("5031", uint(0)), el("5032", uint(2)), el("5034", el("4254", uint(0)))))
    const extraTrack = spec.extraTrack && el("ae", el("d7", uint(3)), el("83", uint(spec.extraTrack.type)), el("86", spec.extraTrack.codec))
    const tracks = el(
        "1654ae6b",
        el("ae", el("d7", uint(1)), el("83", uint(1)), el("86", "V_VP8"), spec.trackName !== undefined && el("536e", spec.trackName), encodings, ...pairs(spec.track)),
        audioTrack,
        extraTrack,
    )
    const tags = (spec.tagString !== undefined || spec.targetType !== undefined) && tagsOf(spec.tagString ?? "ok", spec.tagName, spec.deepTag || 0, spec.targetType)
    const attachments =
        (spec.attachment !== undefined || spec.fileDescription !== undefined || spec.fileData !== undefined) &&
        el(
            "1941a469",
            el("61a7", el("466e", spec.attachment || "notes.txt"), spec.fileDescription !== undefined && el("467e", spec.fileDescription), el("4660", "text/plain"), el("465c", spec.fileData ?? "x")),
        )
    const chapters = spec.chapString !== undefined && el("1043a770", el("45b9", el("b6", el("73c4", uint(1)), el("91", uint(0)), el("80", el("85", spec.chapString), el("437c", "eng")))))
    const block = el("a3", Buffer.from([0x81, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00]))
    const cluster = spec.liveCluster ? Buffer.concat([unknown("1f43b675"), el("e7", uint(0)), block]) : el("1f43b675", el("e7", uint(0)), block)
    const extra = (spec.segment || []).map((item) => {
        if (Array.isArray(item)) return el(item[0], item[1])
        if (item.raw !== undefined) return Buffer.from(item.raw, "hex")
        if (item.unknown !== undefined) return unknown(item.unknown)
        if (item.tags !== undefined) return tagsOf(item.tags)
        throw new Error(`unknown segment item ${JSON.stringify(item)}`)
    })
    const infos = [info(duration, spec.info), spec.secondInfo !== undefined && info(spec.secondInfo)]
    const body = spec.liveCluster ? [...infos, tracks, cluster, tags, attachments, chapters, ...extra] : [...infos, tracks, tags, attachments, chapters, cluster, ...extra]
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
        const payload = join(parts)
        return Buffer.concat([u32(8 + payload.length), Buffer.from(type, "latin1"), payload])
    }
    const full = (type, ...parts) => box(type, u32(0), ...parts)
    // A box of the spec: {type, text, hex, full, children} or {raw}.
    const described = (d) => {
        if (d.raw !== undefined) return Buffer.from(d.raw, "hex")
        const parts = [d.hex !== undefined && Buffer.from(d.hex, "hex"), d.text, ...(d.children || []).map(described)]
        return d.full ? full(d.type, ...parts) : box(d.type, ...parts)
    }
    const many = (list) => (list || []).map(described)
    const ftyp = box("ftyp", "isom", u32(512), "isomiso2avc1mp41")
    const mvhd = (seconds) =>
        full("mvhd", u32(0), u32(0), u32(1000), u32(seconds === null ? 0xffffffff : Math.round(seconds * 1000)), u32(0x00010000), u16(0x0100), Buffer.alloc(10), Buffer.alloc(36), Buffer.alloc(24), u32(3))
    const hdlr = (handler, name) => full("hdlr", u32(0), handler, Buffer.alloc(12), name, Buffer.from([0]))
    const trak = (handlerBox, minf) => box("trak", full("tkhd", Buffer.alloc(80)), box("mdia", full("mdhd", Buffer.alloc(20)), handlerBox, minf.length && box("minf", ...minf)))
    const mp4a = box("mp4a", Buffer.alloc(6), u16(1), Buffer.alloc(8), u16(2), u16(16), Buffer.alloc(4), u32(48000 * 65536))
    const audio = spec.audio
    const audioTrak =
        audio === "stsd"
            ? trak(hdlr("vide", "VideoHandler"), [box("stbl", full("stsd", u32(1), mp4a))])
            : audio === "short"
              ? trak(full("hdlr", u32(0), "soun"), [])
              : audio && trak(hdlr("soun", "SoundHandler"), [])
    const ilst = spec.too !== undefined && box("ilst", box("©too", box("data", u32(1), u32(0), spec.too), ...many(spec.ilst)))
    const meta = (ilst || spec.meta) && full("meta", full("hdlr", u32(0), "mdir", "appl", Buffer.alloc(8), Buffer.from([0])), ...many(spec.meta), ilst)
    const nam = spec.nam !== undefined && box("©nam", u16(Buffer.byteLength(spec.nam)), u16(0), spec.nam)
    const udta = (meta || nam || spec.udta) && box("udta", meta, nam, ...many(spec.udta))
    const mvex = spec.mehd !== undefined && box("mvex", full("mehd", u32(Math.round(spec.mehd * 1000))), full("trex", Buffer.alloc(20)))
    const more = (spec.trak || []).map((handler) => trak(hdlr(handler, "Handler"), []))
    const moov = box("moov", mvhd(duration), trak(hdlr("vide", spec.hdlrName || "VideoHandler"), many(spec.minf)), audioTrak, ...more, mvex, udta, ...many(spec.moov))
    const second = spec.secondMoov !== undefined && box("moov", mvhd(spec.secondMoov), trak(hdlr("vide", "VideoHandler"), []))
    const moof = spec.mehd !== undefined && box("moof", full("mfhd", u32(1)))
    const xmp = spec.xmp !== undefined && box("uuid", Buffer.from("be7acfcb97a942e89c71999491e3afac", "hex"), spec.xmp)
    const head = join([ftyp, moov, second, moof, ...many(spec.top), xmp])
    const pad = spec.size ? spec.size - head.length - 8 : 16
    if (pad < 0) throw new Error(`size ${spec.size} is below the clip itself`)
    return Buffer.concat([head, box("mdat", Buffer.alloc(pad))])
}

fs.writeFileSync(out, spec.format === "mp4" ? mp4() : webm())

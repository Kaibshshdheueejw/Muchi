import Capacitor
import Foundation
import AVFoundation

/**
 * MUCHI real-download bridge (iOS).
 *
 * Downloads a track to a REAL, user-visible audio file in the app's Documents
 * directory (Info.plist enables UIFileSharingEnabled so it appears in the
 * Files app). Progress is streamed back as `progress` events and downloads
 * can be cancelled. The JS layer keeps the track metadata + uri so it can
 * replay the exact file offline.
 *
 * Real metadata tags (Spotube-style): after a download completes the file is
 * re-written with embedded audio tags so every music app shows the song's
 * title / artist / album / genre / cover art —
 *   • .m4a / .mp4 (AAC)  → AVAssetExportSession + AVMutableMetadataItem
 *   • .mp3               → a native ID3v2.3 writer (TIT2/TPE1/TALB/TCON/APIC)
 *   • other (webm/ogg)   → left as-is (container preserved; AVFoundation
 *                          can't rewrite those without re-encoding)
 *
 * JS API: startDownload({id,url,filename,title,artist,album,genre,artwork,artworkData,mime}),
 *         cancelDownload({id}), removeDownload({id}), getPath({id})
 * Events: progress {id,bytes,total,progress}, done {id,uri}, error {id,message}
 */
@objc(MUCHI_MuchiDownloadPlugin)
public class MuchiDownloadPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MUCHI_MuchiDownloadPlugin"
    public let jsName = "MuchiDownload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPath", returnType: CAPPluginReturnPromise)
    ]

    private var tasks: [String: URLSessionDownloadTask] = [:]
    private var progressTimers: [String: Timer] = [:]
    private var savedURIs: [String: String] = [:]

    private func documentsDir() -> URL {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Muchi", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private func sanitize(_ s: String) -> String {
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|")
        let parts = s.components(separatedBy: bad)
        let joined = parts.joined(separator: " ").split(separator: " ").joined(separator: " ")
        return String(joined.prefix(120))
    }

    @objc public func startDownload(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let urlStr = call.getString("url"),
              let u = URL(string: urlStr) else {
            call.reject("MuchiDownload: missing id/url")
            return
        }
        let rawName = call.getString("filename") ?? "track.m4a"
        let filename = sanitize(rawName)
        let title = call.getString("title") ?? ""
        let artist = call.getString("artist") ?? ""
        let album = call.getString("album") ?? ""
        let genre = call.getString("genre") ?? ""
        // Optional cover art, passed as a base64 data URI from the JS layer
        // (data:image/jpeg;base64,...). Falls back to fetching the URL string.
        let artworkData = self.decodeArtwork(call.getString("artworkData") ?? "")
        let artworkURL = call.getString("artwork") ?? ""

        let dest = documentsDir().appendingPathComponent(filename)
        let session = URLSession(configuration: .default)
        let task = session.downloadTask(with: u) { tempURL, response, error in
            self.tasks[id] = nil
            self.stopProgress(id)
            // Download + metadata tagging happen off the main thread so the
            // UI never blocks (AVAssetExportSession + file I/O are heavy).
            DispatchQueue.global(qos: .utility).async {
                var finalURI = dest.absoluteString
                var doneError: String?
                if let error = error {
                    doneError = error.localizedDescription
                } else if let tempURL = tempURL {
                    do {
                        let ext = dest.pathExtension.lowercased()
                        try? FileManager.default.removeItem(at: dest)
                        try FileManager.default.moveItem(at: tempURL, to: dest)
                        self.embedMetadata(at: dest, ext: ext, title: title, artist: artist,
                                           album: album, genre: genre, artwork: artworkData, artworkURL: artworkURL)
                        self.savedURIs[id] = dest.absoluteString
                        finalURI = dest.absoluteString
                    } catch {
                        doneError = error.localizedDescription
                    }
                } else {
                    doneError = "download failed"
                }
                DispatchQueue.main.async {
                    if let e = doneError {
                        self.emitError(id, message: e)
                        call.reject(e)
                        return
                    }
                    let done: [String: Any] = ["id": id, "uri": finalURI]
                    self.notifyListeners("done", data: done)
                    call.resolve(done)
                }
            }
        }
        tasks[id] = task
        task.resume()

        let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, let task = self.tasks[id] else { return }
            let bytes = task.countOfBytesReceived
            let expected = task.countOfBytesExpectedToReceive
            let progress = expected > 0 ? Float(bytes) / Float(expected) : 0
            self.notifyListeners("progress", data: [
                "id": id, "bytes": bytes, "total": expected, "progress": progress
            ])
        }
        RunLoop.main.add(timer, forMode: .common)
        progressTimers[id] = timer
    }

    @objc public func cancelDownload(_ call: CAPPluginCall) {
        if let id = call.getString("id"), let task = tasks[id] {
            task.cancel()
            tasks[id] = nil
            stopProgress(id)
        }
        call.resolve()
    }

    @objc public func removeDownload(_ call: CAPPluginCall) {
        if let id = call.getString("id") {
            if let uri = savedURIs[id], let u = URL(string: uri) {
                try? FileManager.default.removeItem(at: u)
            }
            savedURIs[id] = nil
        }
        call.resolve()
    }

    @objc public func getPath(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        call.resolve(["uri": savedURIs[id] ?? ""])
    }

    // ── Metadata embedding ──────────────────────────────────────────────────
    private func embedMetadata(at url: URL, ext: String, title: String, artist: String,
                               album: String, genre: String, artwork: Data?, artworkURL: String) {
        if ext == "mp3" || ext == "mp2" {
            writeId3v2(to: url, title: title, artist: artist, album: album, genre: genre, artwork: artwork)
        } else if ext == "m4a" || ext == "mp4" || ext == "aac" || ext == "m4b" {
            applyMp4Metadata(to: url, title: title, artist: artist, album: album, genre: genre, artwork: artwork, artworkURL: artworkURL)
        }
        // webm/ogg/opus/flac: preserved untagged (AVFoundation can't rewrite easily).
    }

    private func decodeArtwork(_ dataURI: String) -> Data? {
        guard !dataURI.isEmpty else { return nil }
        // data:image/jpeg;base64,XXXX
        guard let comma = dataURI.firstIndex(of: ",") else { return nil }
        let b64 = String(dataURI[dataURI.index(after: comma)...])
        return Data(base64Encoded: b64)
    }

    private func fetchArtwork(_ urlStr: String) -> Data? {
        guard !urlStr.isEmpty, let u = URL(string: urlStr) else { return nil }
        return try? Data(contentsOf: u)
    }

    private func applyMp4Metadata(to src: URL, title: String, artist: String, album: String, genre: String, artwork: Data?, artworkURL: String) {
        // AVAssetExportSession.metadata is read-only, so write tags with a
        // passthrough AVAssetReader -> AVAssetWriter (AVAssetWriter.metadata
        // is writable). If the passthrough fails for an unusual source the
        // original (untagged) file is kept, so the download always works.
        let asset = AVURLAsset(url: src)
        guard let track = asset.tracks(withMediaType: .audio).first,
              let reader = try? AVAssetReader(asset: asset) else { return }
        let readerOutput = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        guard reader.canAdd(readerOutput) else { return }
        reader.add(readerOutput)

        let tmp = src.deletingPathExtension().appendingPathExtension("tagged.m4a")
        guard let writer = try? AVAssetWriter(outputURL: tmp, fileType: .m4a) else { return }
        let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: nil)
        writerInput.expectsMediaDataInRealTime = false
        guard writer.canAdd(writerInput) else { return }
        writer.add(writerInput)

        var items: [AVMetadataItem] = []
        if !title.isEmpty { items.append(metaItem(.commonIdentifierTitle, title)) }
        if !artist.isEmpty { items.append(metaItem(.commonIdentifierArtist, artist)) }
        if !album.isEmpty { items.append(metaItem(.commonIdentifierAlbumName, album)) }
        if !genre.isEmpty { items.append(metaItem(.commonIdentifierGenre, genre)) }
        // Cover art: prefer the base64 data passed from JS, else fetch the URL.
        let artData = artwork ?? fetchArtwork(artworkURL)
        if let artData = artData {
            let artItem = AVMutableMetadataItem()
            artItem.identifier = .commonIdentifierArtwork
            artItem.value = artData
            artItem.dataType = "public.jpeg"
            artItem.extendedLanguageTag = "und"
            items.append(artItem)
        }
        writer.metadata = items

        guard writer.startWriting() else { return }
        writer.startSession(atSourceTime: .zero)

        let sem = DispatchSemaphore(value: 0)
        writerInput.requestMediaDataWhenReady(on: DispatchQueue.global(qos: .utility)) {
            while writerInput.isReadyForMoreMediaData {
                guard let sample = readerOutput.copyNextSampleBuffer() else {
                    writerInput.markAsFinished()
                    writer.finishWriting { sem.signal() }
                    return
                }
                if !writerInput.append(sample) {
                    writerInput.markAsFinished()
                    writer.cancelWriting()
                    sem.signal()
                    return
                }
            }
        }
        sem.wait()
        guard writer.status == .completed else { return }
        do {
            try? FileManager.default.removeItem(at: src)
            try FileManager.default.moveItem(at: tmp, to: src)
        } catch { /* keep the original file */ }
    }

    private func metaItem(_ id: AVMetadataIdentifier, _ value: String) -> AVMutableMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = id
        item.value = value as NSString
        item.extendedLanguageTag = "und"
        return item
    }

    private func writeId3v2(to url: URL, title: String, artist: String, album: String, genre: String, artwork: Data?) {
        guard var data = try? Data(contentsOf: url) else { return }
        // Strip an existing ID3v2 tag (10-byte header + synchsafe size).
        var audio = data
        if data.count >= 10 && data.prefix(3) == Data([0x49, 0x44, 0x33]) {
            let sz = (Int(data[6] & 0x7f) << 21) | (Int(data[7] & 0x7f) << 14) | (Int(data[8] & 0x7f) << 7) | Int(data[9] & 0x7f)
            let total = 10 + sz
            if total <= data.count { audio = data.subdata(in: total..<data.count) }
        }
        var frames = Data()
        if !title.isEmpty { frames.append(id3Frame("TIT2", title)) }
        if !artist.isEmpty { frames.append(id3Frame("TPE1", artist)) }
        if !album.isEmpty { frames.append(id3Frame("TALB", album)) }
        if !genre.isEmpty { frames.append(id3Frame("TCON", genre)) }
        if let art = artwork { frames.append(apicFrame(art)) }
        var tag = Data()
        tag.append(Data("ID3".utf8))
        tag.append(Data([0x03, 0x00, 0x00])) // v2.3, no flags
        tag.append(syncsafe(UInt32(frames.count)))
        tag.append(frames)
        var out = tag
        out.append(audio)
        try? out.write(to: url)
    }

    private func id3Frame(_ id: String, _ value: String) -> Data {
        var payload = Data()
        payload.append(0x03) // UTF-8
        payload.append(Data(value.utf8))
        var frame = Data()
        frame.append(Data(id.utf8))
        var sz = UInt32(payload.count)
        let szBytes = withUnsafeBytes(of: &sz) { Array($0) }.reversed() // big-endian
        frame.append(Data(szBytes))
        frame.append(Data([0x00, 0x00])) // flags
        frame.append(payload)
        return frame
    }

    private func apicFrame(_ image: Data) -> Data {
        var payload = Data()
        payload.append(0x03) // UTF-8 desc
        payload.append(Data("image/jpeg\u{0}".utf8)) // mime (nul-terminated)
        payload.append(0x03) // front cover
        payload.append(Data("cover\u{0}".utf8)) // description (nul-terminated)
        payload.append(image)
        var frame = Data()
        frame.append(Data("APIC".utf8))
        var sz = UInt32(payload.count)
        let szBytes = withUnsafeBytes(of: &sz) { Array($0) }.reversed()
        frame.append(Data(szBytes))
        frame.append(Data([0x00, 0x00]))
        frame.append(payload)
        return frame
    }

    private func syncsafe(_ n: UInt32) -> Data {
        return Data([
            UInt8((n >> 21) & 0x7f),
            UInt8((n >> 14) & 0x7f),
            UInt8((n >> 7) & 0x7f),
            UInt8(n & 0x7f),
        ])
    }

    private func stopProgress(_ id: String) {
        if let t = progressTimers.removeValue(forKey: id) {
            t.invalidate()
        }
    }

    private func emitError(_ id: String, message: String) {
        self.notifyListeners("error", data: ["id": id, "message": message])
    }
}

package app.muchi.music;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/**
 * MUCHI real-download bridge.
 *
 * Downloads a track to a REAL, user-visible audio file on disk rather than an
 * in-app blob:
 *   - Android 10+ (API 29+): written to the shared Music collection via
 *     MediaStore.Audio so it appears in the user's music library with its
 *     title / artist / album metadata (the same file-backed metadata the
 *     system scanner reads, which is what "tagged audio" means on Android).
 *   - Android 9 and below: written to the app's Music folder
 *     (getExternalFilesDir), which persists and is visible via USB.
 *
 * JS API:
 *   startDownload({id, url, filename, title, artist, album, genre, artwork, mime})
 *   cancelDownload({id})
 *   removeDownload({id})     -> deletes the file from disk
 *   getPath({id})            -> returns the saved content URI / file path
 * Events:
 *   progress  {id, bytes, total, progress (0..1)}
 *   done      {id, uri}
 *   error     {id, message}
 */
@CapacitorPlugin(
        name = "MuchiDownload",
        // Storage permission (item 7). Android 10+ (API 29+) writes through
        // scoped MediaStore and needs NO runtime permission; Android 9 and
        // below writing to shared storage needs the legacy WRITE_EXTERNAL_STORAGE.
        // Declaring it here lets the web layer request it at save time via
        // MuchiDownload.checkPermissions()/requestPermissions().
        permissions = @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
)
public class MuchiDownloadPlugin extends Plugin {

    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Map<String, Future<?>> active = new ConcurrentHashMap<>();
    private final Map<String, String> uris = new ConcurrentHashMap<>();
    private final Map<String, PluginCall> calls = new ConcurrentHashMap<>();

    @PluginMethod
    public void startDownload(PluginCall call) {
        String id = call.getString("id", UUID.randomUUID().toString());
        final String url = call.getString("url", "");
        final String filename = sanitize(call.getString("filename", "track.m4a"));
        final String title = call.getString("title", "");
        final String artist = call.getString("artist", "");
        final String album = call.getString("album", "");
        final String genre = call.getString("genre", "");
        final String mime = call.getString("mime", "");

        if (url.isEmpty()) {
            call.reject("MuchiDownload: missing url");
            return;
        }

        // Item 7 — ask for storage permission before writing to shared storage
        // on Android 9 and below. Android 10+ uses scoped MediaStore (no
        // permission). If not granted yet, request it and resume; the user
        // sees the OS dialog at the moment of the first save.
        if (Build.VERSION.SDK_INT < 29 && !"granted".equals(getPermissionState("storage"))) {
            requestPermissionForAliases(new String[] { "storage" }, call, "storagePermissionCallback");
            return;
        }

        final String finalId = id;
        calls.put(id, call);
        final Future<?> f = io.submit(() -> {
            try {
                Uri uri = downloadFile(finalId, url, filename, title, artist, album, genre, mime);
                uris.put(finalId, uri.toString());
                JSObject done = new JSObject();
                done.put("id", finalId);
                done.put("uri", uri.toString());
                notifyListeners("done", done);
                call.resolve(done);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("id", finalId);
                err.put("message", e.getMessage() == null ? "download failed" : e.getMessage());
                notifyListeners("error", err);
                call.reject(err.toString(), e);
            } finally {
                active.remove(finalId);
                calls.remove(finalId);
            }
        });
        active.put(id, f);
    }

    /* Item 7 — resume a download after the storage-permission dialog resolves. */
    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (!"granted".equals(getPermissionState("storage"))) {
            call.reject("storage permission denied");
            return;
        }
        startDownload(call);
    }

    /* Item 6 — download the app's own update APK in-app (no browser redirect).
       Writes to the public Downloads (Android 10+) or the app Downloads folder
       (Android 9 and below) and returns {uri}; the web layer then fires
       installUpdate() so the system Install sheet comes up directly (v1.5.4).
       Also requests storage permission on < API 29. */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        final String url = call.getString("url", "");
        final String version = call.getString("version", "");
        if (url.isEmpty()) {
            call.reject("MuchiDownload: missing update url");
            return;
        }
        if (Build.VERSION.SDK_INT < 29 && !"granted".equals(getPermissionState("storage"))) {
            requestPermissionForAliases(new String[] { "storage" }, call, "storagePermissionCallback");
            return;
        }
        final String id = "update_" + System.currentTimeMillis();
        calls.put(id, call);
        io.submit(() -> {
            try {
                Uri uri = downloadApk(id, url, version);
                uris.put(id, uri.toString());
                JSObject done = new JSObject();
                done.put("id", id);
                done.put("uri", uri.toString());
                notifyListeners("done", done);
                call.resolve(done);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("id", id);
                err.put("message", e.getMessage() == null ? "update download failed" : e.getMessage());
                notifyListeners("error", err);
                call.reject(err.toString(), e);
            } finally {
                active.remove(id);
                calls.remove(id);
            }
        });
    }

    private Uri downloadApk(String id, String url, String version) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(20000);
        con.setReadTimeout(30000);
        con.setInstanceFollowRedirects(true);
        con.setRequestProperty("User-Agent", "Muchi/" + (version == null || version.isEmpty() ? "1.5.4" : version));
        try {
            int code = con.getResponseCode();
            if (code >= 400) throw new IOException("update download failed (" + code + ")");
            String name = "Muchi-" + (version == null ? "app" : version) + ".apk";
            String mime = con.getContentType();
            if (mime == null || mime.isEmpty()) mime = "application/vnd.android.package-archive";
            ContentResolver resolver = getContext().getContentResolver();
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Muchi");
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri item = resolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                if (item == null) throw new IOException("could not create download");
                try (OutputStream out = resolver.openOutputStream(item)) {
                    copy(con, out);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(item, values, null, null);
                return item;
            }
            // Android 9 and below — app Downloads folder (no public-write permission
            // needed beyond the requested WRITE_EXTERNAL_STORAGE).
            File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Muchi");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("could not create download folder");
            File outFile = new File(dir, name);
            try (OutputStream out = new FileOutputStream(outFile)) {
                copy(con, out);
            }
            return Uri.fromFile(outFile);
        } finally {
            con.disconnect();
        }
    }

    private void copy(HttpURLConnection con, OutputStream out) throws IOException {
        try (InputStream in = con.getInputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String id = call.getString("id", "");
        Future<?> f = active.remove(id);
        if (f != null) f.cancel(true);
        // Reject the original promise if the task never ran/finished, so the
        // web layer's await resolves instead of hanging forever.
        PluginCall original = calls.remove(id);
        if (original != null) {
            try { original.reject("cancelled"); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void removeDownload(PluginCall call) {
        String id = call.getString("id", "");
        String uriStr = uris.remove(id);
        try {
            if (uriStr != null && uriStr.startsWith("content://")) {
                getContext().getContentResolver().delete(Uri.parse(uriStr), null, null);
            } else if (uriStr != null && uriStr.startsWith("file:")) {
                File f = new File(Uri.parse(uriStr).getPath());
                if (f.exists()) f.delete();
            } else if (uriStr != null) {
                File f = new File(uriStr);
                if (f.exists()) f.delete();
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void getPath(PluginCall call) {
        String id = call.getString("id", "");
        JSObject o = new JSObject();
        o.put("uri", uris.get(id) == null ? "" : uris.get(id));
        call.resolve(o);
    }

    /**
     * v1.5.4 — hand a freshly-downloaded update APK to the system package
     * installer so the user lands on the real "Install" sheet instead of
     * hunting for the file in a Downloads app.
     *  - file:// paths (Android 9 fallback) are re-wrapped through the
     *    app's FileProvider — passing a raw file:// URI to another app
     *    throws FileUriExposedException on API 24+.
     *  - When the user has not granted "install unknown apps" for MUCHI the
     *    VIEW intent resolves to nothing; we then open the exact settings
     *    page to grant it and reject with a clear message so the UI can say
     *    "allow, then tap Install again".
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String uriStr = call.getString("uri", "");
        if (uriStr.isEmpty()) {
            call.reject("MuchiDownload: missing uri");
            return;
        }
        try {
            Uri apkUri = Uri.parse(uriStr);
            if ("file".equals(apkUri.getScheme())) {
                File f = new File(apkUri.getPath());
                if (!f.exists()) throw new IOException("the downloaded file is gone");
                apkUri = FileProvider.getUriForFile(getContext(),
                        getContext().getPackageName() + ".fileprovider", f);
            }
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(apkUri, "application/vnd.android.package-archive");
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(view);
            call.resolve();
        } catch (ActivityNotFoundException notAllowed) {
            // Almost always: INSTALL_PACKAGES not yet allowed for this app.
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                call.reject("Allow “Install unknown apps” for Muchi in the settings screen, then tap Install again.");
            } catch (Exception ignored) {
                call.reject("Could not open the installer — enable “install unknown apps” for Muchi in system settings.");
            }
        } catch (Exception e) {
            call.reject("install failed: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
    }

    /* ── internals ─────────────────────────────────────────────────── */

    private Uri downloadFile(String id, String url, String filename,
                             String title, String artist, String album, String genre,
                             String mime) throws IOException {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(20000);
        con.setReadTimeout(30000);
        con.setInstanceFollowRedirects(true);
        con.setRequestProperty("User-Agent", "Muchi/1.5.4");
        con.setRequestProperty("Accept", "audio/*,*/*");
        // We need the whole file, not a video-dash stream.
        con.setRequestProperty("Range", "bytes=0-");
        try {
            int code = con.getResponseCode();
            if (code >= 400) throw new IOException("download failed (" + code + ")");
            long total = con.getContentLengthLong();
            if (total < 0 && con.getHeaderField("Content-Range") != null) {
                String cr = con.getHeaderField("Content-Range");
                int slash = cr.indexOf('/');
                if (slash >= 0) total = Long.parseLong(cr.substring(slash + 1).trim());
            }
            String contentType = con.getContentType();
            return writeToMediaStore(id, con, total, filename, title, artist, album, genre, contentType);
        } finally {
            con.disconnect();
        }
    }

    private Uri writeToMediaStore(String id, HttpURLConnection con, long total,
                                  String filename, String title, String artist, String album,
                                  String genre, String contentType) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        // The server returns the real audio Content-Type; use it to pick the
        // correct extension + MIME so m4a/webm/mp3 are saved as what they are.
        String realMime = contentType == null || contentType.isEmpty() ? "audio/webm" : contentType.split(";")[0].trim();
        String ext = extensionFor(realMime);
        String safeName = filename;
        // Fix a mismatched/guessed extension (JS often says webm for a m4a
        // Piped stream). If the name's extension differs from the real one,
        // trust the upstream Content-Type.
        String nameExt = extForName(safeName);
        if (safeName.indexOf('.') <= 0 || !nameExt.equals(ext)) {
            safeName = stripExt(safeName) + "." + ext;
        }
        String mimeType = realMime;

        Uri outputUri = null;
        OutputStream out = null;
        File plainFile = null;

        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Audio.Media.DISPLAY_NAME, safeName);
            values.put(MediaStore.Audio.Media.MIME_TYPE, mimeType);
            values.put(MediaStore.Audio.Media.TITLE, title.isEmpty() ? stripExt(safeName) : title);
            if (!artist.isEmpty()) values.put(MediaStore.Audio.Media.ARTIST, artist);
            if (!album.isEmpty()) values.put(MediaStore.Audio.Media.ALBUM, album);
            values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
            values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Muchi");
            values.put(MediaStore.Audio.Media.BUCKET_DISPLAY_NAME, "Muchi");
            values.put(MediaStore.Audio.Media.DATE_ADDED, System.currentTimeMillis() / 1000);
            values.put(MediaStore.Audio.Media.DATE_TAKEN, System.currentTimeMillis());
            outputUri = resolver.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            if (outputUri != null) out = resolver.openOutputStream(outputUri);
        }

        if (out == null) {
            // Fallback (API < 29 or insert failed): app-visible Music folder.
            File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC), "Muchi");
            if (!dir.exists() && !dir.mkdirs()) destError(id, "could not create download folder");
            plainFile = new File(dir, safeName);
            out = new FileOutputStream(plainFile);
        }

        try (InputStream in = con.getInputStream()) {
            byte[] buf = new byte[64 * 1024];
            long done = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                if (Thread.currentThread().isInterrupted()) break;
                out.write(buf, 0, n);
                done += n;
                if (done % (256 * 1024) == 0 || done == total) {
                    JSObject p = new JSObject();
                    p.put("id", id);
                    p.put("bytes", done);
                    p.put("total", total <= 0 ? done : total);
                    p.put("progress", total <= 0 ? 0f : (float) done / (float) total);
                    notifyListeners("progress", p);
                }
            }
        } catch (Exception e) {
            // Cancelled or network error mid-stream → clean up the partial file.
            try { out.close(); } catch (Exception ignored) {}
            if (outputUri != null) resolver.delete(outputUri, null, null);
            if (plainFile != null) plainFile.delete();
            throw e;
        } finally {
            try { out.close(); } catch (Exception ignored) {}
        }

        if (outputUri != null) {
            return outputUri;
        }
        return Uri.fromFile(plainFile);
    }

    private void destError(String id, String msg) {
        JSObject err = new JSObject();
        err.put("id", id);
        err.put("message", msg);
        notifyListeners("error", err);
    }

    private static String sanitize(String s) {
        if (s == null) return "";
        return s.replaceAll("[\\\\/:*?\"<>|]", " ").replaceAll("\\s+", " ").trim();
    }

    private static String stripExt(String name) {
        int i = name.lastIndexOf('.');
        return i > 0 ? name.substring(0, i) : name;
    }

    private static String extensionFor(String mime) {
        String m = mime == null ? "" : mime.toLowerCase();
        if (m.contains("mpeg") || m.contains("mp3")) return "mp3";
        if (m.contains("flac")) return "flac";
        if (m.contains("mp4") || m.contains("m4a") || m.contains("aac")) return "m4a";
        return "webm";
    }

    private static String extForName(String name) {
        if (name == null) return "";
        int i = name.lastIndexOf('.');
        return i > 0 ? name.substring(i + 1).toLowerCase() : "";
    }

    private static String guessMime(String name) {
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
        String t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return t == null ? "audio/webm" : t;
    }
}

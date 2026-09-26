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
import java.io.FileInputStream;
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
        permissions = {
                @Permission(strings = { Manifest.permission.READ_MEDIA_AUDIO }, alias = "media_audio"),
                @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
        }
)
public class MuchiDownloadPlugin extends Plugin {

    @PluginMethod
    public void ensureStoragePermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (!"granted".equals(getPermissionState("media_audio"))) {
                requestPermissionForAliases(new String[] { "media_audio" }, call, "ensureStorageCallback");
                return;
            }
        } else if (Build.VERSION.SDK_INT < 29) {
            if (!"granted".equals(getPermissionState("storage"))) {
                requestPermissionForAliases(new String[] { "storage" }, call, "ensureStorageCallback");
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", true);
        call.resolve(ret);
    }

    @PermissionCallback
    private void ensureStorageCallback(PluginCall call) {
        boolean granted = (Build.VERSION.SDK_INT >= 33)
                ? "granted".equals(getPermissionState("media_audio"))
                : (Build.VERSION.SDK_INT >= 29 || "granted".equals(getPermissionState("storage")));
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Map<String, Future<?>> active = new ConcurrentHashMap<>();
    private final Map<String, String> uris = new ConcurrentHashMap<>();
    private final Map<String, PluginCall> calls = new ConcurrentHashMap<>();
    private volatile Uri pendingInstallUri = null;

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        final Uri pending = pendingInstallUri;
        if (pending != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (getContext().getPackageManager().canRequestPackageInstalls()) {
                pendingInstallUri = null;
                android.app.Activity act = getActivity();
                if (act != null) {
                    act.runOnUiThread(() -> {
                        try {
                            launchPackageInstaller(pending);
                        } catch (Exception ignored) {}
                    });
                }
            }
        }
    }

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
       Writes to the app's external files/cache directory (for FileProvider
       installation) AND copies to public Downloads/Muchi so the user also has
       the APK visible in device storage, then launches the system package
       installer directly. */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        final String url = call.getString("url", "");
        final String version = call.getString("version", "");
        if (url.isEmpty()) {
            call.reject("MuchiDownload: missing update url");
            return;
        }
        final String id = "update_" + System.currentTimeMillis();
        calls.put(id, call);
        Future<?> f = io.submit(() -> {
            try {
                String cleanVer = (version == null || version.isEmpty()) ? "1.6.5" : version.replaceFirst("^[vV]", "");
                String name = "Muchi-" + cleanVer + ".apk";
                Uri uri = downloadApk(id, url, cleanVer, name);
                uris.put(id, uri.toString());
                uris.put("latest_update", uri.toString());
                JSObject done = new JSObject();
                done.put("id", id);
                done.put("uri", uri.toString());
                done.put("savedPath", "Downloads/Muchi/" + name);
                notifyListeners("done", done);
                call.resolve(done);
            } catch (Exception e) {
                String msg = e.getMessage() == null ? "update download failed" : e.getMessage();
                JSObject err = new JSObject();
                err.put("id", id);
                err.put("message", msg);
                notifyListeners("error", err);
                call.reject(msg, e);
            } finally {
                active.remove(id);
                calls.remove(id);
            }
        });
        active.put(id, f);
    }

    private HttpURLConnection openFollowingRedirects(String urlStr, String version, String accept) throws IOException {
        URL currentUrl = new URL(urlStr);
        for (int redirects = 0; redirects < 10; redirects++) {
            HttpURLConnection con = (HttpURLConnection) currentUrl.openConnection();
            con.setConnectTimeout(25000);
            con.setReadTimeout(60000);
            con.setInstanceFollowRedirects(true);
            con.setRequestProperty("User-Agent", "Muchi/" + (version == null || version.isEmpty() ? "1.6.5" : version));
            con.setRequestProperty("Accept", accept);
            int code = con.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM ||
                code == HttpURLConnection.HTTP_MOVED_TEMP ||
                code == HttpURLConnection.HTTP_SEE_OTHER ||
                code == 307 || code == 308) {
                String loc = con.getHeaderField("Location");
                if (loc != null && !loc.isEmpty()) {
                    currentUrl = new URL(currentUrl, loc);
                    con.disconnect();
                    continue;
                }
            }
            return con;
        }
        throw new IOException("Too many redirects while downloading update");
    }

    private String resolveFallbackGithubApkUrl(String version) {
        HttpURLConnection con = null;
        try {
            con = openFollowingRedirects("https://api.github.com/repos/Kaibshshdheueejw/Muchi/releases", version, "application/vnd.github+json");
            if (con.getResponseCode() >= 200 && con.getResponseCode() < 300) {
                try (InputStream in = con.getInputStream()) {
                    byte[] buf = new byte[64 * 1024];
                    StringBuilder sb = new StringBuilder();
                    int n;
                    while ((n = in.read(buf)) > 0 && sb.length() < 256 * 1024) {
                        sb.append(new String(buf, 0, n, "UTF-8"));
                    }
                    String json = sb.toString();
                    java.util.regex.Matcher m = java.util.regex.Pattern
                            .compile("\"browser_download_url\"\\s*:\\s*\"([^\"]+\\.apk)\"", java.util.regex.Pattern.CASE_INSENSITIVE)
                            .matcher(json);
                    if (m.find()) {
                        return m.group(1);
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (con != null) con.disconnect();
        }
        return "";
    }

    private Uri downloadApk(String id, String url, String version, String name) throws IOException {
        HttpURLConnection con = null;
        try {
            con = openFollowingRedirects(url, version, "application/vnd.android.package-archive,application/octet-stream,*/*");
            int code = con.getResponseCode();
            String ctype = con.getContentType() != null ? con.getContentType().toLowerCase() : "";
            if (code < 200 || code >= 300 || ctype.contains("text/html") || ctype.contains("application/json")) {
                con.disconnect();
                con = null;
                String altUrl = resolveFallbackGithubApkUrl(version);
                if (!altUrl.isEmpty() && !altUrl.equals(url)) {
                    con = openFollowingRedirects(altUrl, version, "application/vnd.android.package-archive,application/octet-stream,*/*");
                    code = con.getResponseCode();
                    ctype = con.getContentType() != null ? con.getContentType().toLowerCase() : "";
                }
            }
            if (con == null || code < 200 || code >= 300) {
                throw new IOException("Update package not found on server (HTTP " + code + "). Ensure the release APK is published.");
            }
            if (ctype.contains("text/html") || ctype.contains("application/json")) {
                throw new IOException("Server returned webpage instead of APK package.");
            }

            File baseDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (baseDir == null) baseDir = getContext().getExternalCacheDir();
            if (baseDir == null) baseDir = getContext().getCacheDir();
            File updateDir = new File(baseDir, "updates");
            if (!updateDir.exists()) updateDir.mkdirs();
            File outFile = new File(updateDir, name);
            if (outFile.exists()) outFile.delete();

            long total = con.getContentLengthLong();
            try (OutputStream out = new FileOutputStream(outFile)) {
                copyTracked(id, con, out, total);
            }

            if (!outFile.exists() || outFile.length() < 100 * 1024) {
                if (outFile.exists()) outFile.delete();
                throw new IOException("Downloaded file is incomplete or invalid (<100 KB).");
            }

            // Also copy to public Downloads/Muchi folder so user can see it in their device's Files / Downloads app
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver resolver = getContext().getContentResolver();
                    try {
                        resolver.delete(
                                MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                                MediaStore.Downloads.DISPLAY_NAME + "=?",
                                new String[] { name }
                        );
                    } catch (Exception ignored) {}
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/vnd.android.package-archive");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Muchi");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri item = resolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                    if (item != null) {
                        try (InputStream in = new FileInputStream(outFile);
                             OutputStream out = resolver.openOutputStream(item)) {
                            if (out != null) {
                                byte[] buf = new byte[64 * 1024];
                                int n;
                                while ((n = in.read(buf)) > 0) {
                                    out.write(buf, 0, n);
                                }
                            }
                        }
                        ContentValues doneVals = new ContentValues();
                        doneVals.put(MediaStore.Downloads.IS_PENDING, 0);
                        resolver.update(item, doneVals, null, null);
                    }
                } else {
                    File pubDl = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (pubDl != null) {
                        File muchiDl = new File(pubDl, "Muchi");
                        if (!muchiDl.exists()) muchiDl.mkdirs();
                        File pubFile = new File(muchiDl, name);
                        try (InputStream in = new FileInputStream(outFile);
                             OutputStream out = new FileOutputStream(pubFile)) {
                            byte[] buf = new byte[64 * 1024];
                            int n;
                            while ((n = in.read(buf)) > 0) {
                                out.write(buf, 0, n);
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}

            return FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", outFile);
        } finally {
            if (con != null) con.disconnect();
        }
    }

    private void copyTracked(String id, HttpURLConnection con, OutputStream out, long total) throws IOException {
        try (InputStream in = con.getInputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            long written = 0;
            long lastNotify = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                written += n;
                long now = System.currentTimeMillis();
                if (now - lastNotify > 200) {
                    lastNotify = now;
                    JSObject prog = new JSObject();
                    prog.put("id", id);
                    prog.put("bytes", written);
                    prog.put("total", total > 0 ? total : 0);
                    notifyListeners("progress", prog);
                }
            }
            JSObject prog = new JSObject();
            prog.put("id", id);
            prog.put("bytes", written);
            prog.put("total", written);
            notifyListeners("progress", prog);
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

    private void launchPackageInstaller(Uri apkUri) {
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(apkUri, "application/vnd.android.package-archive");
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        view.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
        android.app.Activity act = getActivity();
        if (act != null) {
            act.startActivity(view);
        } else {
            getContext().startActivity(view);
        }
    }

    /**
     * v1.6.5 — hand a freshly-downloaded update APK to the system package
     * installer on the main UI thread so the user lands on the real "Install"
     * sheet immediately, and auto-resume installation if they needed to grant
     * "Install unknown apps" permission first.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String uriStr = call.getString("uri", "");
        if (uriStr.isEmpty()) {
            uriStr = uris.getOrDefault("latest_update", "");
        }
        if (uriStr == null || uriStr.isEmpty()) {
            call.reject("MuchiDownload: missing uri");
            return;
        }
        final String finalUriStr = uriStr;
        android.app.Activity act = getActivity();
        Runnable task = () -> {
            try {
                Uri apkUri = Uri.parse(finalUriStr);
                if ("file".equals(apkUri.getScheme())) {
                    File f = new File(apkUri.getPath());
                    if (!f.exists()) throw new IOException("the downloaded APK file is missing");
                    apkUri = FileProvider.getUriForFile(getContext(),
                            getContext().getPackageName() + ".fileprovider", f);
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                        pendingInstallUri = apkUri;
                        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getContext().getPackageName()));
                        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        if (act != null) act.startActivity(settings);
                        else getContext().startActivity(settings);
                        JSObject res = new JSObject();
                        res.put("needsPermission", true);
                        res.put("uri", apkUri.toString());
                        call.resolve(res);
                        return;
                    }
                }

                pendingInstallUri = null;
                launchPackageInstaller(apkUri);
                JSObject res = new JSObject();
                res.put("installed", true);
                res.put("uri", apkUri.toString());
                call.resolve(res);
            } catch (ActivityNotFoundException notAllowed) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getContext().getPackageName()));
                        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        if (act != null) act.startActivity(settings);
                        else getContext().startActivity(settings);
                    }
                    call.reject("Allow “Install unknown apps” for Muchi in settings, then tap Install.");
                } catch (Exception ignored) {
                    call.reject("Could not open the installer — enable “Install unknown apps” for Muchi in settings.");
                }
            } catch (Exception e) {
                call.reject("install failed: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
            }
        };
        if (act != null) {
            act.runOnUiThread(task);
        } else {
            task.run();
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
        con.setRequestProperty("User-Agent", "Muchi/1.5.6");
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

        File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC), "Muchi");
        if (!dir.exists() && !dir.mkdirs()) {
            dir = new File(getContext().getFilesDir(), "music");
            if (!dir.exists()) dir.mkdirs();
        }
        plainFile = new File(dir, safeName);
        out = new FileOutputStream(plainFile);

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
            if (plainFile != null) plainFile.delete();
            throw e;
        } finally {
            try { out.close(); } catch (Exception ignored) {}
        }

        // Publish to MediaStore so other apps and system players can index the song as well
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Audio.Media.DISPLAY_NAME, safeName);
                values.put(MediaStore.Audio.Media.MIME_TYPE, mimeType);
                values.put(MediaStore.Audio.Media.TITLE, title.isEmpty() ? stripExt(safeName) : title);
                if (!artist.isEmpty()) values.put(MediaStore.Audio.Media.ARTIST, artist);
                if (!album.isEmpty()) values.put(MediaStore.Audio.Media.ALBUM, album);
                values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
                values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/Muchi");
                values.put(MediaStore.Audio.Media.BUCKET_DISPLAY_NAME, "Muchi");
                values.put(MediaStore.Audio.Media.IS_PENDING, 1);
                values.put(MediaStore.Audio.Media.DATE_ADDED, System.currentTimeMillis() / 1000);
                values.put(MediaStore.Audio.Media.DATE_TAKEN, System.currentTimeMillis());
                outputUri = resolver.insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                if (outputUri != null) {
                    try (OutputStream mediaOut = resolver.openOutputStream(outputUri);
                         InputStream fileIn = new FileInputStream(plainFile)) {
                        byte[] copyBuf = new byte[64 * 1024];
                        int r;
                        while ((r = fileIn.read(copyBuf)) > 0) {
                            mediaOut.write(copyBuf, 0, r);
                        }
                    }
                    ContentValues doneValues = new ContentValues();
                    doneValues.put(MediaStore.Audio.Media.IS_PENDING, 0);
                    resolver.update(outputUri, doneValues, null, null);
                }
            } catch (Exception ignored) {}
        }

        // Always return the direct local file URI so Muchi plays it completely offline with zero permissions
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

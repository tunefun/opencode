package ai.opencode.jetbrains.toolwindow;

import com.intellij.openapi.diagnostic.Logger;
import org.cef.browser.CefBrowser;
import org.cef.browser.CefFrame;
import org.cef.callback.CefCallback;
import org.cef.callback.CefSchemeHandlerFactory;
import org.cef.handler.CefResourceHandler;
import org.cef.misc.IntRef;
import org.cef.misc.StringRef;
import org.cef.network.CefRequest;
import org.cef.network.CefResponse;

import java.io.*;
import java.nio.charset.StandardCharsets;

public class WebviewSchemeHandler implements CefResourceHandler {

    private static final Logger log = Logger.getInstance(WebviewSchemeHandler.class);
    private final MutableString indexHtml;
    private InputStream inputStream;
    private String mimeType = "text/html";

    public WebviewSchemeHandler(MutableString indexHtml) {
        this.indexHtml = indexHtml;
    }

    @Override
    public boolean processRequest(CefRequest request, CefCallback callback) {
        String url = request.getURL();
        String resourcePath = url.replace("http://plugin-internal/", "");
        if (resourcePath.isEmpty() || resourcePath.equals("/")) resourcePath = "index.html";
        if (resourcePath.contains("?")) resourcePath = resourcePath.substring(0, resourcePath.indexOf("?"));
        if (resourcePath.contains("#")) resourcePath = resourcePath.substring(0, resourcePath.indexOf("#"));

        if ("index.html".equals(resourcePath)) {
            String html = indexHtml.get();
            if (html == null || html.isEmpty()) html = "<html><body><p>Loading...</p></body></html>";
            inputStream = new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8));
            mimeType = "text/html";
            callback.Continue();
            return true;
        }

        inputStream = getClass().getResourceAsStream("/webview/" + resourcePath);
        if (inputStream == null) inputStream = getClass().getResourceAsStream("/webview/assets/" + resourcePath);
        if (inputStream != null) {
            mimeType = getMimeType(resourcePath);
            callback.Continue();
            return true;
        }

        log.warn("Not found: " + resourcePath);
        return false;
    }

    @Override
    public void getResponseHeaders(CefResponse response, IntRef responseLength, StringRef redirectUrl) {
        response.setMimeType(mimeType);
        response.setStatus(200);
        try {
            responseLength.set(inputStream != null ? inputStream.available() : 0);
        } catch (IOException e) {
            responseLength.set(0);
        }
    }

    @Override
    public boolean readResponse(byte[] dataOut, int bytesToRead, IntRef bytesRead, CefCallback callback) {
        if (inputStream == null) return false;
        boolean hasData = false;
        try {
            int availableSize = inputStream.available();
            if (availableSize > 0) {
                int toRead = Math.min(availableSize, bytesToRead);
                int realSize = inputStream.read(dataOut, 0, toRead);
                if (realSize > 0) {
                    bytesRead.set(realSize);
                    hasData = true;
                }
            } else {
                bytesRead.set(0);
            }
        } catch (Exception e) {
            log.warn("readResponse error", e);
        }
        if (!hasData) closeStream();
        return hasData;
    }

    @Override
    public void cancel() {
        closeStream();
    }

    private void closeStream() {
        if (inputStream != null) {
            try { inputStream.close(); } catch (IOException ignored) {}
            inputStream = null;
        }
    }

    private static String getMimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".map")) return "application/json";
        return "application/octet-stream";
    }
}

class WebviewSchemeHandlerFactory implements CefSchemeHandlerFactory {
    private final MutableString indexHtml;

    WebviewSchemeHandlerFactory(MutableString indexHtml) {
        this.indexHtml = indexHtml;
    }

    @Override
    public CefResourceHandler create(CefBrowser browser, CefFrame frame, String schemeName, CefRequest request) {
        return new WebviewSchemeHandler(indexHtml);
    }
}

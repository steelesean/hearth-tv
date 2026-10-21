package app.hearth.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/** The home screen: a full-screen web page (assets/tv.html) with a bridge to open other apps. */
public class MainActivity extends Activity {
    private WebView web;
    private AppLauncher launcher;
    private Pairing pairing;
    private Assistant assistant;
    private Weather weather;
    private KidCheck kids;
    private volatile boolean ready;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        launcher = new AppLauncher(this);
        pairing = new Pairing(this);
        assistant = new Assistant(this);
        weather = new Weather(this);
        kids = new KidCheck(this);
        RemoteService.start(this);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#ECEBE7"));
        web.setFocusable(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Lay the page out at 1920 wide and zoom it to fit the screen, whatever the TV's size.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        web.setInitialScale(0);
        web.addJavascriptInterface(new Bridge(), "HearthNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                ready = true;
                Remote.flush();
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/tv.html");
        Remote.attach(this);
        hideSystemBars();
    }

    @Override protected void onResume() {
        super.onResume();
        hideSystemBars();
        Remote.setVisible(true);
        // Coming back from another app: the page may want to ask how it was.
        if (ready) web.evaluateJavascript("window.hearthResumed && hearthResumed()", null);
        refreshCaches();
    }

    @Override protected void onPause() {
        Remote.setVisible(false);
        super.onPause();
    }

    @Override protected void onDestroy() {
        Remote.detach(this);
        web.destroy();
        super.onDestroy();
    }

    boolean isReady() { return ready; }

    private volatile JSONObject updateCache;
    private volatile JSONObject weatherCache;

    /** Refreshes the update and weather caches off the main thread, so the bridge never waits. */
    private void refreshCaches() {
        new Thread(new Runnable() {
            @Override public void run() {
                updateCache = Updater.check(MainActivity.this);
                weatherCache = weather.today();
                if (ready) runCommand(safe("refresh", ""));
            }
        }, "hearth-caches").start();
    }

    private static JSONObject safe(String type, String message) {
        try { return new JSONObject().put("type", type).put("message", message == null ? "" : message); }
        catch (Exception e) { return new JSONObject(); }
    }

    /** Runs a phone command on the page. Safe to call from any thread. */
    void runCommand(final JSONObject cmd) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                web.evaluateJavascript("window.hearthRemote && hearthRemote(" + cmd + ")", null);
            }
        });
    }

    /** The physical remote: send D-pad, OK and Back to the page instead of letting the WebView move focus. */
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        String key = keyName(event.getKeyCode());
        if (key == null) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            web.evaluateJavascript("window.hearthKey && hearthKey('" + key + "')", null);
        }
        return true;
    }

    private static String keyName(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER: return "ok";
            case KeyEvent.KEYCODE_BACK: return "back";   // this is home, so Back never leaves the app
            default: return null;
        }
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    /** What the page can ask the TV to do. Called on a background thread by the WebView. */
    private final class Bridge {
        @JavascriptInterface public String pairing() {
            try {
                String address = RemoteService.address();
                return new JSONObject()
                        .put("address", address == null ? "" : address)
                        .put("code", pairing.code())
                        .put("paired", pairing.hasPhones())
                        .toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface public String openApp(String key) {
            return launcher.openApp(key);
        }

        @JavascriptInterface public String openLink(String key, String url) {
            return launcher.openLink(key, url);
        }

        /** Config keys of the apps that are actually on the stick, as a JSON array. */
        @JavascriptInterface public String installed() {
            org.json.JSONArray out = new org.json.JSONArray();
            org.json.JSONObject config = AppLauncher.loadConfig(MainActivity.this);
            for (String list : new String[] {"apps", "extraApps"}) {
                org.json.JSONArray arr = config.optJSONArray(list);
                for (int i = 0; arr != null && i < arr.length(); i++) {
                    String key = arr.optJSONObject(i).optString("key");
                    if (launcher.isInstalled(key)) out.put(key);
                }
            }
            return out.toString();
        }

        @JavascriptInterface public boolean assistantReady() {
            return assistant.isReady();
        }

        /** Asks the assistant in the background; the answer arrives at hearthAnswer(id, json). */
        @JavascriptInterface public void ask(final String id, final String payload) {
            new Thread(new Runnable() {
                @Override public void run() {
                    JSONObject answer;
                    try {
                        answer = assistant.ask(new JSONObject(payload));
                    } catch (Exception e) {
                        answer = new JSONObject();
                    }
                    final String js = "window.hearthAnswer && hearthAnswer(" + JSONObject.quote(id) + "," + answer + ")";
                    runOnUiThread(new Runnable() {
                        @Override public void run() { web.evaluateJavascript(js, null); }
                    });
                }
            }, "hearth-ask").start();
        }

        /** Updates the learned profile in the background; reports back at hearthLearned(json). */
        @JavascriptInterface public void learn(final String payload) {
            new Thread(new Runnable() {
                @Override public void run() {
                    JSONObject answer;
                    try {
                        answer = assistant.learn(new JSONObject(payload));
                    } catch (Exception e) {
                        answer = new JSONObject();
                    }
                    final String js = "window.hearthLearned && hearthLearned(" + answer + ")";
                    runOnUiThread(new Runnable() {
                        @Override public void run() { web.evaluateJavascript(js, null); }
                    });
                }
            }, "hearth-learn").start();
        }

        /** The waiting update as JSON ({version}), or "" if Hearth is up to date. Never blocks. */
        @JavascriptInterface public String update() {
            final JSONObject u = updateCache;
            return u == null ? "" : u.toString();
        }

        /** Downloads the update and opens Fire TV's install screen. Reports failures to the page. */
        @JavascriptInterface public void installUpdate() {
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        Updater.install(MainActivity.this);
                    } catch (final Exception e) {
                        runCommand(safe("updateFailed", e.getMessage()));
                    }
                }
            }, "hearth-update").start();
        }

        /** Today's weather as JSON, or "" if no town is set. */
        @JavascriptInterface public String weather() {
            JSONObject w = weatherCache;
            return w == null ? "" : w.toString();
        }

        /** Which children's programmes iPlayer still has, as JSON {key: true|false}. */
        @JavascriptInterface public String kidStatus() {
            return kids.status().toString();
        }

        @JavascriptInterface public void showKeyboard() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    web.requestFocus();
                    InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (imm != null) imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
                }
            });
        }
    }
}

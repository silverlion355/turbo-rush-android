package com.silverlion.turborush;

import android.content.Context;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

/**
 * 原生桥（JsBridge）
 *
 * 网页端 js/main.js 中：
 *   window.AndroidBridge = 本对象（WebView addJavascriptInterface 注入）
 *   nativeCall('onScore', payload)     → onScore(jsonStr)
 *   nativeCall('onGameOver', payload)  → onGameOver(jsonStr)
 *   nativeCall('onPause', null)        → onPause(null)
 *   nativeCall('onResume', null)       → onResume(null)
 *
 * 注意：Android 注入对象在网页端是原生宿主对象，原生侧方法必须带
 *       @JavascriptInterface 注解且只能被 WebView 主线程调用。
 */
public class JsBridge {

    private static final String TAG = "TurboRush";

    private final Context appContext;

    public JsBridge(Context context) {
        this.appContext = context.getApplicationContext();
    }

    /** 轻提示：可直接被网页端 window.AndroidBridge.toast('...') 调用 */
    @JavascriptInterface
    public void toast(String message) {
        if (message != null && !message.isEmpty()) {
            Toast.makeText(appContext, message, Toast.LENGTH_SHORT).show();
        }
    }

    /** 游戏结算回调（预留：接分享、排行榜、激励视频位） */
    @JavascriptInterface
    public void onGameOver(String scoreJson) {
        Log.i(TAG, "onGameOver: " + scoreJson);
    }

    /** 得分推送（网页侧已做 600ms 限流；预留：原生 HUD / 数据上报） */
    @JavascriptInterface
    public void onScore(String scoreJson) {
        // 预留扩展点
    }

    @JavascriptInterface
    public void onPause(String ignored) {
        Log.d(TAG, "onPause");
    }

    @JavascriptInterface
    public void onResume(String ignored) {
        Log.d(TAG, "onResume");
    }
}

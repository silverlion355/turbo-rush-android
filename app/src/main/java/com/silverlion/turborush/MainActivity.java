package com.silverlion.turborush;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 极速狂飙 · Turbo Rush —— WebView 全屏壳
 *
 * 架构：网页版(纯 Canvas 程序化绘制、零资源依赖)原样打包进 assets/www，
 *      本 Activity 仅提供一个全屏 WebView + 原生桥(AndroidBridge)。
 *      与网页版 js/main.js 预留的 window.RacingGame / window.AndroidBridge 契约对接，
 *      后续可无痛扩展：排行榜/分享/广告/内购/触感反馈等。
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏 + 隐藏状态栏
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // 游戏中屏幕常亮
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        configureWebView();
        setContentView(webView);

        webView.loadUrl(START_URL);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage 持久化最高分
        s.setAllowFileAccess(true);     // 读取 assets 内 file:// 资源
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 音效/引擎声不要求先手势
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 只允许 assets 内导航；任何外部链接一律拦截，保持游戏沉浸
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                return !url.startsWith("file:///android_asset/");
            }
        });

        // 原生桥：网页端通过 window.AndroidBridge 调用
        webView.addJavascriptInterface(new JsBridge(this), "AndroidBridge");

        webView.setBackgroundColor(Color.BLACK);
        webView.setKeepScreenOn(true);
    }

    /** 返回键：游戏中=暂停；菜单/结算/已暂停=退出 */
    @Override
    public void onBackPressed() {
        webView.evaluateJavascript(
                "(function(){try{var s=window.RacingGame&&RacingGame.getState?RacingGame.getState():null;"
                        + "return s?s.mode:'menu';}catch(e){return 'menu';}})()",
                value -> {
                    String mode = (value == null || "null".equals(value))
                            ? "menu"
                            : value.replace("\"", "").trim();
                    if ("run".equals(mode)) {
                        webView.evaluateJavascript(
                                "try{window.RacingGame&&RacingGame.pause&&RacingGame.pause()}catch(e){}",
                                null);
                    } else {
                        finish();
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 暂停 WebView 渲染与计时器；网页侧 visibilitychange 会自动进入暂停态
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

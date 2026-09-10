package com.silverlion.turborush;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
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
 *   触感：AndroidBridge.vibrate(ms)         → 短震（宝石/碰撞）
 *   屏幕方向：AndroidBridge.setOrientation('landscape'|'portrait'|'auto')
 *
 * 注意：Android 注入对象在网页端是原生宿主对象，原生侧方法必须带
 *       @JavascriptInterface 注解。JS 调用发生在 JavaBridge 线程，
 *       涉及 UI 的操作必须切回主线程。
 */
public class JsBridge {

    private static final String TAG = "TurboRush";

    private final Context appContext;
    private final Activity activity;

    public JsBridge(Activity activity) {
        this.activity = activity;
        this.appContext = activity.getApplicationContext();
    }

    /** 轻提示：可直接被网页端 window.AndroidBridge.toast('...') 调用 */
    @JavascriptInterface
    public void toast(String message) {
        if (message != null && !message.isEmpty()) {
            Toast.makeText(appContext, message, Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * 屏幕方向控制：3D 版横屏、2D 版竖屏、选卡页竖屏。
     * 运行时 setRequestedOrientation 会覆盖 AndroidManifest 的静态声明，
     * 且不受用户「自动旋转」开关影响。
     */
    @JavascriptInterface
    public void setOrientation(String mode) {
        final int orientation;
        if ("landscape".equalsIgnoreCase(mode)) {
            orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if ("portrait".equalsIgnoreCase(mode)) {
            orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        } else {
            orientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            try {
                activity.setRequestedOrientation(orientation);
            } catch (Exception e) {
                Log.w(TAG, "setOrientation failed: " + e.getMessage());
            }
        });
    }

    /**
     * 触感反馈：网页侧调 AndroidBridge.vibrate(70) 触发 70ms 短震。
     * 用于宝石连击/碰撞。Android 8+ 使用 VibrationEffect.createOneShot，
     * 旧版本回退 vibrate(long) 全局方法。
     */
    @JavascriptInterface
    public void vibrate(long ms) {
        if (ms <= 0) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) appContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm == null) return;
                Vibrator v = vm.getDefaultVibrator();
                if (v == null || !v.hasVibrator()) return;
                v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                Vibrator v = (Vibrator) appContext.getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    //noinspection deprecation
                    v.vibrate(ms);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "vibrate failed: " + e.getMessage());
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

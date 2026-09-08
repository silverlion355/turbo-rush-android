# JsBridge 方法被 WebView 反射调用，禁止混淆
-keepclassmembers class com.silverlion.turborush.JsBridge {
    @android.webkit.JavascriptInterface <methods>;
}

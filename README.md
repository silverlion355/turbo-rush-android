# 极速狂飙 · Turbo Rush（Android 版）

网页版 2D 赛车游戏的 Android 客户端。采用 **WebView 全屏壳 + 原生桥** 架构：
游戏逻辑与渲染仍由原网页版（纯 Canvas、零图片/音频资源）完成，原生侧只负责承载与系统能力扩展。

## 目录结构

```
racing-game-android/
├── app/
│   ├── build.gradle            # Android 应用模块（minSdk24 / targetSdk34，零第三方依赖）
│   └── src/main/
│       ├── AndroidManifest.xml # 竖屏全屏、启动 Activity
│       ├── assets/www/         # ← 网页版游戏资源（index.html + css + js，原样打包）
│       ├── java/.../MainActivity.java  # WebView 壳：全屏/生命周期/返回键处理
│       ├── java/.../JsBridge.java      # 原生桥：window.AndroidBridge（onScore/onGameOver…）
│       └── res/                # 主题 + 程序化矢量启动图标
├── .github/workflows/android-build.yml  # push 即云构建 debug APK 并上传 artifact
├── settings.gradle / build.gradle / gradle.properties
└── README.md
```

## 网页 ↔ 原生契约（升级预留）

| 方向 | 通道 | 说明 |
|---|---|---|
| JS → 原生 | `window.AndroidBridge.{onScore,onGameOver,onPause,onResume,toast}` | 原生已实现占位回调，可扩展排行榜/分享/广告 |
| 原生 → JS | `window.RacingGame.{start,pause,resume,getState}` | 返回键/外部事件可驱动游戏状态 |
| 持久化 | localStorage（DomStorage 已开启） | 最高分本地保存 |

## 本地构建（需 JDK17 + Android SDK）

```bash
gradle :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

## 持续集成

推送代码到 GitHub（main/master）后由 Actions 自动构建，在仓库 **Actions 页签 → 最新一次运行 → Artifacts** 下载 APK；也可在 Actions 页手动 `Run workflow`。

## 迭代路线（建议）

1. v0.1 原型（当前）：可玩、触屏跟手、有音效、最高分持久化
2. v0.2 打磨：震动反馈/触感、真机性能调优、release 签名发布
3. v0.3 运营：商店换肤、道具/氮气、关卡/画质档位、云排行榜
4. v0.4 变现与拉新：激励视频复活、分享得分卡片、邀请好友

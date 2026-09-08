/* config.js — 全局配置（逻辑坐标固定 480x800，画面等比缩放） */
'use strict';
window.RG = window.RG || {};

RG.CFG = {
  VW: 480, VH: 800,               // 逻辑分辨率（竖屏）

  ROAD_LEFT: 62, ROAD_RIGHT: 418, // 路面左右边界
  LANES: 4,                       // 车道数（单行 4 道，为今后双向留扩展）
  CURB_W: 24,                     // 路肩（红白格）宽度

  PLAYER_X0: 240,
  PLAYER_Y: 660,                  // 玩家车固定纵向位置
  PLAYER_W: 48, PLAYER_H: 88,

  LIFE: 3,

  // —— 速度（px/s）——
  BASE_SPEED: 340,                // 起步滚动速度（略提：开局即有推进感）
  MAX_SPEED: 860,                 // 上限
  RAMP: 4.2,                      // 基准增速（game.js 内用 S 形曲线调制：慢热→爆发→巡航）
  KEY_BOOST: 1.22,                // ↑ 加速倍率
  KEY_SLOW: 0.5,                  // ↓ 减速倍率
  STEER_SPEED: 800,               // 键盘横向速度
  PTR_K: 9.5,                     // 触屏跟手阻尼系数（11→9.5：更跟手）

  // —— 难度 ——
  SPAWN_MAX: 1.55, SPAWN_MIN: 0.62,   // 车辆生成间隔（随难度递减）
  RAMP_TIME: 105,                      // 到达最高难度/极速的秒数（S 形曲线窗口）
  ONCOMING_MIN: 0.10, ONCOMING_MAX: 0.45,  // 对向车比例

  // —— 碰撞 ——
  HIT_SLOW: 0.16,                  // 碰撞后目标速度倍率
  HIT_RECOVER: 1.5,                // 恢复时间 s
  INVINCIBLE: 1.5,                 // 撞击后无敌时间 s

  // —— 收集 ——
  GEM_SCORE: 60,                   // 每颗宝石分值
  GEM_PAD: 0.5,                    // 金币分数加成系数
  GEM_ROW_MIN: 3, GEM_ROW_MAX: 6,  // 每排宝石数量
  SCORE_SPEED: 0.06,               // 距离得分：speed*dt*系数

  KMH: 0.2,                        // 滚动速度 → 仪表车速换算
  METER: 1.1,                      // 滚动速度 → 里程(米/秒滚动) 系数
};

RG.roadW = () => RG.CFG.ROAD_RIGHT - RG.CFG.ROAD_LEFT;
RG.laneW = () => RG.roadW() / RG.CFG.LANES;
/* 第 i 条车道中心线 x */
RG.laneX = i => RG.CFG.ROAD_LEFT + RG.roadW() * (i + 0.5) / RG.CFG.LANES;
/* 车道序号 */
RG.laneOf = x => RG.clamp(Math.floor((x - RG.CFG.ROAD_LEFT) / RG.laneW()), 0, RG.CFG.LANES - 1);

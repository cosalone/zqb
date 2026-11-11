/*
 * 智勤打卡定位 - Shadowrocket(小火箭)版
 * 已适配最新版脚本「zqb-v2.5.1」与最新版小程序(v46)报文格式, 手动选点机制参考 wloc 项目
 *
 * 拦截 2 个考勤接口(isInArea 已在最新版小程序中移除, 不再拦截):
 *   POST /prod-api/attendance/rules/validateLocation -> 改写 body: longitude/latitude/altitude(抖动)
 *   POST /prod-api/attendance/records/add            -> 改写 body: longitude/latitude(抖动)
 *
 * 其余字段全部透传原包: inArea(App 根据 validateLocation 响应自动得出)、
 * clockTime/beijingTime/timeslotId/timeZone、speed(-1)、accuracy 三兄弟、
 * ssid/bssid、localip/netmask、异常场景的 checkId/evidenceBase64
 *
 * 坐标优先级: 手动选点($persistentStore: zqb_settings) > 模块参数($argument) > 脚本默认(DEFAULT_CONFIG)
 *
 * 坐标系: 考勤地图为 WGS-84(官方说明), 默认坐标/手动选点均须为 WGS-84;
 *         高德/苹果链接及高德拾取器的 GCJ-02 值须经选点页面/Worker/&cs=gcj 转换后使用
 *
 * 抖动算法与 ProxyPin v2.5.1 完全一致:
 *   经纬度: 前3位小数固定, 第4位±1, 第5-14位完全随机, 总幅度±0.0001°(约±10米)
 *   海拔:   整数部分±1, 小数部分完全随机
 *   小火箭每次请求都是独立 JS 上下文, 无法用 globalThis 缓存,
 *   因此抖动偏移存于 $persistentStore(zqb_jitter), 滑动 TTL(默认600秒):
 *   同一次打卡流程中 2 个接口间隔远小于 TTL, 保证坐标一致;
 *   早晚打卡间隔大于 TTL, 自然生成新偏移(模拟真实 GPS 的日间波动)。
 *   如抖动坐标超出考勤范围, 访问 ...?action=jitter 重置偏移即可。
 */

// ================= 默认配置 =================
// 坐标为 WGS-84(官方: 考勤地图采用 WGS84 坐标系), 取自实测抓包;
// 勿直接填高德拾取器/分享链接里的 GCJ-02 原始值(与 WGS-84 相差约 600 米)
var DEFAULT_CONFIG = {
  // 目标位置
  longitude: "115.91722641914227",
  latitude: "28.623598562618763",

  // 海拔基准(按目标地点实际楼层核对调整)
  altitude: 30.83467215843965
};

var SETTINGS_KEY = "zqb_settings"; // 手动选点存储(与 zqb-settings.js 共用)
var JITTER_KEY = "zqb_jitter";     // 抖动偏移缓存
var JITTER_TTL = 600;              // 抖动缓存TTL(秒), 滑动续期

// ================= 模块参数解析 =================
// 模块 Script 行可通过 argument=key=value&key2=value2 覆盖默认配置
function parseArgument(raw) {
  var obj = {};
  if (!raw) return obj;
  if (typeof raw === "object") return raw;
  String(raw).split("&").forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf("=");
    var k = i === -1 ? pair : pair.slice(0, i);
    var v = i === -1 ? "" : pair.slice(i + 1);
    try { v = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) {}
    obj[k] = v;
  });
  return obj;
}
var ARG = parseArgument(typeof $argument !== "undefined" ? $argument : null);

// ================= 读取手动选点 =================
function readSaved() {
  try {
    var raw = $persistentStore.read(SETTINGS_KEY);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (o && o.longitude && o.latitude) return o;
  } catch (e) {}
  return null;
}

// ================= 合成最终配置 =================
var SAVED = readSaved();
var CFG = {
  longitude: String((SAVED && SAVED.longitude) || ARG.longitude || DEFAULT_CONFIG.longitude),
  latitude: String((SAVED && SAVED.latitude) || ARG.latitude || DEFAULT_CONFIG.latitude),
  altitude: (SAVED && SAVED.altitude) || ARG.altitude || DEFAULT_CONFIG.altitude
};

if (ARG.jitterTtl && parseInt(ARG.jitterTtl, 10) > 0) {
  JITTER_TTL = parseInt(ARG.jitterTtl, 10);
}

// ================= 抖动(算法与 ProxyPin v2.5.1 完全一致) =================
// 缓存于持久化存储; 基准坐标变化或超时后自动重新生成
function getJitter(baseLon, baseLat) {
  var cache = null;
  try { cache = JSON.parse($persistentStore.read(JITTER_KEY) || "null"); } catch (e) {}
  var now = Date.now();
  var fresh = cache && cache.initialized
    && String(cache.baseLon) === String(baseLon)
    && String(cache.baseLat) === String(baseLat)
    && (now - cache.ts) <= JITTER_TTL * 1000;
  if (!fresh) {
    cache = {
      initialized: true,
      ts: now,
      baseLon: String(baseLon),
      baseLat: String(baseLat),
      // 经纬度第4位偏移: -1/0/+1 (控制总幅度±0.0001°)
      lonFourthOffset: Math.floor(Math.random() * 3) - 1,
      // 经纬度第5-14位: 完全随机 [0, 0.0001)
      lonRandomTail: Math.random() * 0.0001,
      latFourthOffset: Math.floor(Math.random() * 3) - 1,
      latRandomTail: Math.random() * 0.0001,
      // 海拔整数偏移: -1/0/+1
      altIntOffset: Math.floor(Math.random() * 3) - 1,
      // 海拔小数部分: 完全随机 [0, 1)
      altRandomDecimal: Math.random()
    };
  } else {
    // 滑动续期: 保证同一打卡流程 2 个接口使用同一组偏移
    cache.ts = now;
  }
  $persistentStore.write(JSON.stringify(cache), JITTER_KEY);
  return cache;
}

// 坐标抖动: 前3位小数固定, 第4位±1, 第5-14位完全随机
function applyJitter(baseCoord, isLatitude, J) {
  var base = parseFloat(baseCoord);
  var prefix = Math.floor(base * 1000) / 1000;
  var origTail = base - prefix;
  var origFourthDigit = Math.floor(origTail * 10000);
  var fourthOffset = isLatitude ? J.latFourthOffset : J.lonFourthOffset;
  var newFourthDigit = origFourthDigit + fourthOffset;
  var randomTail = isLatitude ? J.latRandomTail : J.lonRandomTail;
  var newTail = newFourthDigit * 0.0001 + randomTail;
  var result = prefix + newTail;
  return parseFloat(result.toFixed(14));
}

// 海拔抖动: 整数部分±1, 小数部分完全随机
function applyAltitudeJitter(baseAltitude, J) {
  var base = parseFloat(baseAltitude);
  var intPart = Math.floor(base);
  var newInt = intPart + J.altIntOffset;
  var result = newInt + J.altRandomDecimal;
  return parseFloat(result.toFixed(14));
}

// ================= 主逻辑 =================
(function () {
  try {
    var url = $request.url || "";

    var J = getJitter(CFG.longitude, CFG.latitude);
    var jLon = applyJitter(CFG.longitude, false, J);
    var jLat = applyJitter(CFG.latitude, true, J);
    var jAlt = applyAltitudeJitter(CFG.altitude, J);

    var source = SAVED ? "手动选点" : "默认配置";

    // 接口1: 位置校验(POST, 经纬度/海拔为数字类型, 与原包一致)
    // 只改经纬度/海拔(抖动); speed/accuracy三兄弟/ssid/bssid/localip/netmask 全部透传
    if (url.indexOf("attendance/rules/validateLocation") !== -1 && $request.body) {
      var body = JSON.parse($request.body);
      body.longitude = jLon;
      body.latitude = jLat;
      body.altitude = jAlt;
      console.log("[智勤] validateLocation 已改写坐标(" + source + "): " + jLat + "," + jLon);
      $done({ body: JSON.stringify(body) });
      return;
    }

    // 接口2: 打卡提交(POST, 经纬度为数字类型, 与原包一致)
    // 只改经纬度(与 validateLocation 同一偏移, 保证同次打卡坐标一致),
    // inArea/clockTime/beijingTime/timeslotId/timeZone/checkId/evidenceBase64 全部透传
    if (url.indexOf("attendance/records/add") !== -1 && $request.body) {
      var body2 = JSON.parse($request.body);
      body2.longitude = jLon;
      body2.latitude = jLat;
      console.log("[智勤] records/add 已改写坐标(" + source + "): " + jLat + "," + jLon);
      $done({ body: JSON.stringify(body2) });
      return;
    }

    // 未匹配: 原样放行
    $done({});
  } catch (e) {
    console.log("[智勤] 脚本异常, 已放行原请求: " + (e && e.message));
    $done({});
  }
})();

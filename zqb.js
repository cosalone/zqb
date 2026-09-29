/*
 * 智勤打卡定位修改 - Shadowrocket(小火箭)版
 * 移植自 ProxyPin 脚本「智勤包v2.1.json」，手动选点机制参考 wloc 项目
 *
 * 拦截 3 个考勤接口:
 *   GET  /prod-api/attendance/rules/isInArea         -> 改写 URL 查询参数 longitude/latitude
 *   POST /prod-api/attendance/rules/validateLocation -> 改写 body: longitude/latitude/altitude/ssid/bssid
 *   POST /prod-api/attendance/records/add            -> 改写 body: longitude/latitude/clockLocation/inArea/clockTime/timeslotId
 *
 * 坐标优先级: 手动选点($persistentStore: zqb_settings) > 模块参数($argument) > 脚本默认(DEFAULT_CONFIG)
 *
 * 抖动算法与 ProxyPin 版完全一致:
 *   经纬度: 前3位小数固定, 第4位±1, 第5-14位完全随机, 总幅度±0.0001°(约±10米)
 *   海拔:   整数部分±1, 小数部分完全随机
 *   小火箭每次请求都是独立 JS 上下文, 无法用 globalThis 缓存,
 *   因此抖动偏移存于 $persistentStore(zqb_jitter), 滑动 TTL(默认600秒):
 *   同一次打卡流程中 3 个接口间隔远小于 TTL, 保证坐标一致;
 *   早晚打卡间隔大于 TTL, 自然生成新偏移(模拟真实 GPS 的日间波动)。
 *   如抖动后坐标超出考勤范围, 访问 ...?action=jitter 重置偏移即可。
 */

// ================= 默认配置(与原 TARGET_CONFIG 一致) =================
var DEFAULT_CONFIG = {
  // 目标位置
  longitude: "115.91757960765315",
  latitude: "28.622877368112636",
  clockLocation: "江西省南昌市青云谱区三家店街道南莲路53号附近",

  // 打卡时间: null 表示保持原包时间不变; 格式 "2026-06-25 08:30:00"
  clockTime: null,

  // 上下班类型: null 表示保持原包类型不变; 145=上班打卡, 146=下班打卡
  timeslotId: null,

  inArea: "1",

  // 移动数据模拟参数
  // ssid/bssid 为 null 表示走移动数据
  // speed/accuracy/horizontalAccuracy/verticalAccuracy/localip/netmask 保留原包值不修改
  mobile: {
    altitude: 30.83467215843965,
    ssid: null,
    bssid: null
  }
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
  clockLocation: (SAVED && SAVED.location) || ARG.location || DEFAULT_CONFIG.clockLocation,
  clockTime: ARG.clockTime || DEFAULT_CONFIG.clockTime,
  inArea: ARG.inArea || DEFAULT_CONFIG.inArea,
  altitude: (SAVED && SAVED.altitude) || ARG.altitude || DEFAULT_CONFIG.mobile.altitude,
  ssid: DEFAULT_CONFIG.mobile.ssid,
  bssid: DEFAULT_CONFIG.mobile.bssid
};
// timeslotId 需保持数字类型(与原包一致)
var tsid = ARG.timeslotId || DEFAULT_CONFIG.timeslotId;
CFG.timeslotId = tsid ? parseInt(tsid, 10) : null;

if (ARG.jitterTtl && parseInt(ARG.jitterTtl, 10) > 0) {
  JITTER_TTL = parseInt(ARG.jitterTtl, 10);
}

// ================= 抖动(算法与 ProxyPin 版完全一致) =================
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
    // 滑动续期: 保证同一打卡流程 3 个接口使用同一组偏移
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

// ================= URL 查询参数改写(isInArea 用) =================
function replaceQuery(url, updates) {
  var idx = url.indexOf("?");
  var base = idx === -1 ? url : url.slice(0, idx);
  var qs = idx === -1 ? "" : url.slice(idx + 1);
  var seen = {};
  var parts = qs.split("&").filter(Boolean).map(function (p) {
    var i = p.indexOf("=");
    var k = i === -1 ? p : p.slice(0, i);
    var v = i === -1 ? "" : p.slice(i + 1);
    if (Object.prototype.hasOwnProperty.call(updates, k)) {
      seen[k] = true;
      return k + "=" + encodeURIComponent(updates[k]);
    }
    return p;
  });
  Object.keys(updates).forEach(function (k) {
    if (!seen[k]) parts.push(k + "=" + encodeURIComponent(updates[k]));
  });
  return base + (parts.length ? "?" + parts.join("&") : "");
}

// ================= 主逻辑 =================
(function () {
  try {
    var url = $request.url || "";

    // 调试: 每次脚本被触发都弹通知, 用于确认脚本是否执行(问题定位后删除)
    if (ARG.notify !== "0") {
      var ep = url.indexOf("isInArea") !== -1 ? "isInArea"
        : (url.indexOf("validateLocation") !== -1 ? "validateLocation" : "records/add");
      $notification.post("智勤调试", "脚本已触发: " + ep, "");
    }

    var J = getJitter(CFG.longitude, CFG.latitude);
    var jLon = applyJitter(CFG.longitude, false, J);
    var jLat = applyJitter(CFG.latitude, true, J);
    var jAlt = applyAltitudeJitter(CFG.altitude, J);

    var source = SAVED ? "手动选点" : "默认配置";

    // 接口1: 区域判断(GET, 修改查询参数)
    if (url.indexOf("attendance/rules/isInArea") !== -1) {
      console.log("[智勤] isInArea 已改写坐标(" + source + "): " + jLat + "," + jLon);
      $done({
        url: replaceQuery(url, {
          longitude: jLon.toString(),
          latitude: jLat.toString()
        })
      });
      return;
    }

    // 接口2: 位置校验(POST, 经纬度/海拔为数字类型, 与原包一致)
    if (url.indexOf("attendance/rules/validateLocation") !== -1 && $request.body) {
      var body = JSON.parse($request.body);
      body.longitude = jLon;
      body.latitude = jLat;
      body.altitude = jAlt;
      body.ssid = CFG.ssid;
      body.bssid = CFG.bssid;
      console.log("[智勤] validateLocation 已改写坐标(" + source + "): " + jLat + "," + jLon);
      $done({ body: JSON.stringify(body) });
      return;
    }

    // 接口3: 打卡提交(POST, 经纬度为字符串类型, 与原包一致)
    if (url.indexOf("attendance/records/add") !== -1 && $request.body) {
      var body2 = JSON.parse($request.body);
      body2.longitude = jLon.toString();
      body2.latitude = jLat.toString();
      body2.clockLocation = CFG.clockLocation;
      body2.inArea = CFG.inArea;

      if (CFG.clockTime) {
        body2.clockTime = CFG.clockTime;
        body2.beijingTime = CFG.clockTime;
      }
      if (CFG.timeslotId) {
        body2.timeslotId = CFG.timeslotId;
      }
      console.log("[智勤] records/add 已改写坐标(" + source + "): " + jLat + "," + jLon);
      if (ARG.notify !== "0") {
        $notification.post("智勤打卡", "已替换打卡坐标(" + source + ")", jLat.toFixed(6) + ", " + jLon.toFixed(6));
      }
      $done({ body: JSON.stringify(body2) });
      return;
    }

    // 未匹配(如 GET 无 body 等): 原样放行
    $done({});
  } catch (e) {
    console.log("[智勤] 脚本异常, 已放行原请求: " + (e && e.message));
    $done({});
  }
})();

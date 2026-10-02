/*
 * 智勤打卡手动选点 - Shadowrocket(小火箭)版
 * 选点机制参考 wloc 项目的 wloc-settings 设计
 *
 * 前提: 小火箭已开代理、已启用模块、已安装并信任 CA 证书(MITM proj-kq.ruioutech.com)
 * 用 Safari(走代理)访问以下地址:
 *
 *   保存选点:  https://proj-kq.ruioutech.com/zqb-settings/save?lon=115.9175&lat=28.6228&loc=地点名称&alt=30.8
 *              lon/lat 必填, 须为 WGS-84 坐标(官方说明: 考勤地图采用 WGS84 坐标系)。
 *              选点页面/解析 Worker 返回的已是 WGS-84, 直接填入即可;
 *              直接抄高德/苹果分享链接或高德拾取器(lbs.amap.com/tools/picker)的
 *              GCJ-02 坐标时, 在末尾加 &cs=gcj, 脚本自动转成 WGS-84 再保存
 *              (不加则按原值保存, 会偏约 600 米)。
 *              loc 选填(打卡地点名称, 建议填写), alt 选填(海拔, 默认用脚本里的 30.83)
 *   查询当前:  https://proj-kq.ruioutech.com/zqb-settings/save?action=query
 *   清除选点:  https://proj-kq.ruioutech.com/zqb-settings/save?action=clear
 *              (清除后恢复使用 zqb.js 里的默认坐标)
 *   重置抖动:  https://proj-kq.ruioutech.com/zqb-settings/save?action=jitter
 *              (抖动后坐标若超出考勤范围, 用这个生成新偏移)
 *
 * 请求会被本地脚本拦截, 不会真正发到服务器; 页面显示 JSON 结果并有系统通知。
 */

var SETTINGS_KEY = "zqb_settings";
var JITTER_KEY = "zqb_jitter";

// 解析 URL 查询参数(与 wloc-settings.js 同款实现)
function getQueries(url) {
  var qs = url.split("?")[1] || "";
  var map = new Map();
  qs.split("&").forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf("=");
    var k = i === -1 ? pair : pair.slice(0, i);
    var v = i === -1 ? "" : pair.slice(i + 1);
    var dk, dv;
    try { dk = decodeURIComponent(k.replace(/\+/g, " ")); } catch (e) { dk = k; }
    try { dv = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { dv = v; }
    if (!map.has(dk)) map.set(dk, dv);
  });
  return map;
}

// ---------- GCJ-02 -> WGS-84 转换(公式与选点页面/Worker 一致) ----------
// 官方说明: 考勤地图采用 WGS84 坐标系; 高德/苹果地图坐标为 GCJ-02, 保存前需转换
function outOfChina(lat, lng) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function tLat(x, y) {
  var r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return r;
}
function tLng(x, y) {
  var r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return r;
}
function wgs2gcj(lat, lng) {
  if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
  var a = 6378245.0, ee = 0.00669342162296594323;
  var dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  var radLat = lat / 180 * Math.PI, magic = 1 - ee * Math.sin(radLat) * Math.sin(radLat);
  var sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function gcj2wgs(lat, lng) { // 一次近似逆推, 误差<1米
  var g = wgs2gcj(lat, lng);
  return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
}

function finish(result) {
  $done({
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      },
      body: JSON.stringify(result, null, 2)
    }
  });
}

(function () {
  try {
    var q = getQueries($request.url || "");
    var action = q.get("action") || "save";
    var result;

    if (action === "query") {
      var saved = null;
      try { saved = JSON.parse($persistentStore.read(SETTINGS_KEY) || "null"); } catch (e) {}
      if (saved && saved.longitude && saved.latitude) {
        result = { success: true, mode: "手动选点", settings: saved };
      } else {
        result = { success: true, mode: "默认配置", settings: null,
          note: "未设置手动选点, 当前使用 zqb.js 内 DEFAULT_CONFIG 默认坐标(南莲路53号)" };
      }
      $notification.post("智勤选点", "查询成功", result.mode);
    } else if (action === "clear") {
      $persistentStore.write("", SETTINGS_KEY);
      // 基准坐标变化会自动触发抖动重算, 这里顺手清掉旧偏移
      $persistentStore.write("", JITTER_KEY);
      result = { success: true, message: "已清除手动选点, 恢复默认坐标(南莲路53号)" };
      $notification.post("智勤选点", "已清除选点", "恢复 zqb.js 默认坐标");
    } else if (action === "jitter") {
      $persistentStore.write("", JITTER_KEY);
      result = { success: true, message: "已重置坐标抖动, 下次打卡请求将生成新偏移" };
      $notification.post("智勤选点", "已重置抖动", "下次请求生成新偏移");
    } else {
      // 默认动作: 保存选点
      var lon = parseFloat(q.get("lon") || q.get("longitude") || "0");
      var lat = parseFloat(q.get("lat") || q.get("latitude") || "0");
      var loc = q.get("loc") || q.get("location") || "";
      var alt = parseFloat(q.get("alt") || q.get("altitude") || "0");

      if (lon && lat) {
        // cs=gcj: 输入为高德/苹果 GCJ-02 坐标, 转成 WGS-84 再保存
        // (考勤地图为 WGS-84; 未加 cs 时按原值保存, 调用方须自行保证是 WGS-84)
        var gcjInput = null;
        var cs = (q.get("cs") || "").toLowerCase();
        if (cs === "gcj" || cs === "gcj02" || cs === "amap") {
          gcjInput = { cs: "GCJ-02", longitude: lon, latitude: lat };
          var w = gcj2wgs(lat, lon);
          lon = w.lng;
          lat = w.lat;
        }
        var data = {
          longitude: lon,
          latitude: lat,
          location: loc,
          updatedAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace("Z", "+08:00")
        };
        if (alt) data.altitude = alt;
        var ok = $persistentStore.write(JSON.stringify(data), SETTINGS_KEY);
        if (ok) {
          // 基准坐标已变, 清空旧抖动缓存, 下次请求基于新坐标重新生成
          $persistentStore.write("", JITTER_KEY);
          result = { success: true, saved: data,
            message: "已保存(WGS-84), 下次打卡生效; 抖动将基于新坐标自动重新生成" };
          if (gcjInput) result.convertedFrom = gcjInput;
          $notification.post("智勤选点", "选点已保存",
            lat + ", " + lon + " (WGS-84)" + (loc ? " | " + loc : ""));
        } else {
          result = { success: false, error: "持久化存储写入失败" };
        }
      } else {
        result = {
          success: false,
          error: "缺少 lon/lat 参数",
          usage: "save?lon=经度&lat=纬度&loc=地点名称&alt=海拔&cs=gcj(输入为高德GCJ-02坐标时加上,自动转WGS-84) | ?action=query | ?action=clear | ?action=jitter"
        };
      }
    }

    finish(result);
  } catch (e) {
    finish({ success: false, error: (e && e.message) || "脚本异常" });
  }
})();

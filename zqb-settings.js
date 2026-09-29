/*
 * 智勤打卡手动选点 - Shadowrocket(小火箭)版
 * 选点机制参考 wloc 项目的 wloc-settings 设计
 *
 * 前提: 小火箭已开代理、已启用模块、已安装并信任 CA 证书(MITM proj-kq.ruioutech.com)
 * 用 Safari(走代理)访问以下地址:
 *
 *   保存选点:  https://proj-kq.ruioutech.com/zqb-settings/save?lon=115.9175&lat=28.6228&loc=地点名称&alt=30.8
 *              lon/lat 必填(高德/苹果地图分享链接里的坐标, 直接填入即可, 坐标系与 App 上报一致)
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
            message: "已保存, 下次打卡生效; 抖动将基于新坐标自动重新生成" };
          $notification.post("智勤选点", "选点已保存",
            lat + ", " + lon + (loc ? " | " + loc : ""));
        } else {
          result = { success: false, error: "持久化存储写入失败" };
        }
      } else {
        result = {
          success: false,
          error: "缺少 lon/lat 参数",
          usage: "save?lon=经度&lat=纬度&loc=地点名称&alt=海拔 | ?action=query | ?action=clear | ?action=jitter"
        };
      }
    }

    finish(result);
  } catch (e) {
    finish({ success: false, error: (e && e.message) || "脚本异常" });
  }
})();

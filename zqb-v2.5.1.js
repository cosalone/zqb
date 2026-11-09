async function onRequest(context, request) {
  console.log(request.url);
  var TARGET_CONFIG = {
    // 目标位置（WGS84 坐标，勿用高德/腾讯地图拾取的 GCJ-02，否则偏约600m直接异常）
    longitude: 115.91757960765315,
    latitude: 28.622877368112636,
    // 海拔基准（2026-10-30 真实基线 29.84；按目标地点实际楼层核对调整）
    altitude: 30.83467215843965
  };

  // ============ 坐标抖动（v2.1 方案） ============
  // 前3位小数固定，第4位±1，第5-14位随机；总幅度 ±0.0001°（约±10米），远小于考勤半径
  // 偏移全局缓存跨请求复用：同一次打卡 validateLocation 与 records/add 坐标一致
  // 重启 ProxyPin 重新生成偏移；若抖动坐标超出考勤范围，重启换新偏移
  if (typeof globalThis._zqbJitterCache === "undefined" || !globalThis._zqbJitterCache.initialized) {
    globalThis._zqbJitterCache = {
      initialized: true,
      lonFourthOffset: Math.floor(Math.random() * 3) - 1,
      lonRandomTail: Math.random() * 0.0001,
      latFourthOffset: Math.floor(Math.random() * 3) - 1,
      latRandomTail: Math.random() * 0.0001,
      altIntOffset: Math.floor(Math.random() * 3) - 1,
      altRandomDecimal: Math.random()
    };
  }
  var CACHE = globalThis._zqbJitterCache;

  // 坐标抖动：前3位固定，第4位±1变化，第5-14位完全随机
  function applyJitter(baseCoord, isLatitude) {
    var base = parseFloat(baseCoord);
    var prefix = Math.floor(base * 1000) / 1000;
    var fourthDigit = Math.floor((base - prefix) * 10000) + (isLatitude ? CACHE.latFourthOffset : CACHE.lonFourthOffset);
    var randomTail = isLatitude ? CACHE.latRandomTail : CACHE.lonRandomTail;
    return parseFloat((prefix + fourthDigit * 0.0001 + randomTail).toFixed(14));
  }

  // altitude 抖动：整数部分±1变化，小数部分完全随机重组
  function applyAltitudeJitter(baseAltitude) {
    var base = parseFloat(baseAltitude);
    return parseFloat((Math.floor(base) + CACHE.altIntOffset + CACHE.altRandomDecimal).toFixed(14));
  }

  // 位置校验（POST，11 字段）
  // 修改：经纬度（抖动）、altitude（抖动）
  // 透传：speed（PC 端恒为 -1）/accuracy 三兄弟/ssid/bssid/localip/netmask
  if (request.url.indexOf("attendance/rules/validateLocation") !== -1 && request.body) {
    var body = JSON.parse(request.body);
    body.longitude = applyJitter(TARGET_CONFIG.longitude, false);
    body.latitude = applyJitter(TARGET_CONFIG.latitude, true);
    body.altitude = applyAltitudeJitter(TARGET_CONFIG.altitude);
    request.body = JSON.stringify(body);
  }

  // 打卡提交（2026-10-30 真实基线：7 字段，坐标 number，inArea 字符串"1"/"0"，无 clockLocation）
  // 只改经纬度（与 validateLocation 同一偏移，保证同次打卡坐标一致），其余全部透传
  if (request.url.indexOf("attendance/records/add") !== -1 && request.body) {
    var body = JSON.parse(request.body);
    body.longitude = applyJitter(TARGET_CONFIG.longitude, false);
    body.latitude = applyJitter(TARGET_CONFIG.latitude, true);
    request.body = JSON.stringify(body);
  }

  return request;
}

async function onResponse(context, request, response) {
  return response;
}
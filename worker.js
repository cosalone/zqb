// 智勤选点 - 链接解析 Worker（Cloudflare Workers 免费版即可）
//
// 用途：高德分享出来的是短链（surl.amap.com/xxx），真实坐标藏在 302 跳转的
//       Location 头里，浏览器和快捷指令都读不到，由本 Worker 跟跳转后从最终
//       URL 解析出坐标。
// 坐标系：高德/苹果地图（中国大陆）链接里的坐标均为 GCJ-02；考勤系统采用
//         WGS-84，由本 Worker 统一转换为 WGS-84 后返回（境外坐标无需转换）。
//         页面与快捷指令拿到即可直接使用。
//
// 部署：见 README「部署链接解析 Worker」章节。
// 调用：GET /parse?u=<URL编码后的地图链接>
// 返回：{"lon":115.9131,"lat":28.6263,"source":"最终跳转URL","gcj":{"lon":...,"lat":...}}
//       主字段为 WGS-84，gcj 字段为原始 GCJ-02 备查；失败返回 {"error":"..."}（HTTP 400/422/502）

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*"
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const u = new URL(request.url);
    if (u.pathname !== "/parse") {
      return Response.json({ error: "not found，接口为 /parse?u=地图链接" }, { status: 404, headers: CORS });
    }
    const target = u.searchParams.get("u");
    if (!target || !/^https?:\/\//i.test(target)) {
      return Response.json({ error: "参数错误：需要 ?u=地图链接" }, { status: 400, headers: CORS });
    }
    try {
      // 跟随 302 跳转拿最终落地 URL（高德短链 → uri.amap.com/marker?position=经度,纬度）
      const r = await fetch(target, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1" }
      });
      let hit = matchCoords(r.url);
      // 最终 URL 没有的话，从落地页文本里兜底找一次
      if (!hit && (r.headers.get("content-type") || "").includes("text/html")) {
        hit = matchCoords(await r.text());
      }
      if (!hit) return Response.json({ error: "未解析到坐标", finalUrl: r.url }, { status: 422, headers: CORS });
      const gcj = { lon: hit.lon, lat: hit.lat };
      const wgs = outOfChina(hit.lat, hit.lon) ? { lat: hit.lat, lng: hit.lon } : gcj2wgs(hit.lat, hit.lon);
      return Response.json({ lon: wgs.lng, lat: wgs.lat, source: r.url, gcj: gcj }, { headers: CORS });
    } catch (e) {
      return Response.json({ error: "解析失败：" + e.message }, { status: 502, headers: CORS });
    }
  }
};

// position=经度,纬度（高德）／ll=纬度,经度／coordinate=纬度,经度（苹果）
function matchCoords(s) {
  let m = s.match(/[?&]position=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (m) return { lon: parseFloat(m[1]), lat: parseFloat(m[2]) };
  m = s.match(/[?&](?:ll|coordinate)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return null;
}

// ---- GCJ-02 <-> WGS-84（国标通用公式，与选点页面一致） ----
function outOfChina(lat, lng) { return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271; }
function tLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return r;
}
function tLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return r;
}
function wgs2gcj(lat, lng) {
  if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
  const a = 6378245.0, ee = 0.00669342162296594323;
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI, magic = 1 - ee * Math.sin(radLat) * Math.sin(radLat);
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function gcj2wgs(lat, lng) { // 一次近似逆推（误差<1米，考勤场景足够）
  const g = wgs2gcj(lat, lng);
  return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
}

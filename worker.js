// 智勤选点 - 链接解析 Worker（Cloudflare Workers 免费版即可）
//
// 用途：高德分享出来的是短链（surl.amap.com/xxx），真实坐标藏在 302 跳转的
//       Location 头里，浏览器和快捷指令都读不到，由本 Worker 跟跳转后从最终
//       URL 解析出 GCJ-02 坐标。
// 注意：与 wloc 的 worker 不同，这里【不做 GCJ-02→WGS-84 换算】——
//       考勤 App（高德系）上报的就是 GCJ-02，原样返回直接可用。
//
// 部署：见 README「部署链接解析 Worker」章节。
// 调用：GET /parse?u=<URL编码后的地图链接>
// 返回：{"lon":115.9175,"lat":28.6228,"source":"最终跳转URL"}
//       失败返回 {"error":"..."}（HTTP 400/422/502）

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
      return Response.json({ lon: hit.lon, lat: hit.lat, source: r.url }, { headers: CORS });
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

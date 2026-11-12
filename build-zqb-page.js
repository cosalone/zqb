/*
 * 构建脚本: 把 index.html 打包成 zqb-page.js（Shadowrocket 本地脚本）
 *
 * zqb-page.js 拦截 https://proj-kq.ruioutech.com/zqb-page 并直接返回选点页 HTML,
 * 页面无需任何外部托管(方案二: 本地脚本自给自足)。
 *
 * 用法: 修改 index.html 后在本目录执行  node build-zqb-page.js
 * 生成物 zqb-page.js 为自动产物, 请勿手工编辑。
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const out = `/*
 * 智勤选点页面自服务脚本 - Shadowrocket 本地脚本 (由 build-zqb-page.js 自动生成, 勿手改)
 *
 * 拦截 https://proj-kq.ruioutech.com/zqb-page, 直接返回内置的选点页 HTML,
 * 页面本体不依赖任何外部托管(GitHub Pages 等), 配合本地版 zqb.js / zqb-settings.js
 * 即可实现纯直连(无代理节点)的全套功能。
 * 页面内的 Leaflet 库与地图瓦片仍按原地址直连加载, 不经本脚本。
 */
(function () {
  var HTML = ${JSON.stringify(html)};

  $done({
    response: {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      },
      body: HTML
    }
  });
})();
`;

fs.writeFileSync(path.join(__dirname, "zqb-page.js"), out, "utf8");
console.log("OK: zqb-page.js 已生成 (" + out.length + " 字节, 内嵌页面 " + html.length + " 字节)");

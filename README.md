# 智勤打卡定位 · 小火箭(Shadowrocket)模块

由 ProxyPin 脚本「智勤包v2.1.json」移植，手动选点机制参考 [wloc](https://github.com/cosalone/wloc) 项目。

**工作原理**：小火箭在本机拦截考勤 App 的 3 个上报接口（isInArea / validateLocation / records/add），把坐标替换为目标位置并施加 GPS 抖动。不修改系统定位、无需重启手机——App 界面上显示的仍是真实位置，服务端收到的是替换后的坐标（与 ProxyPin 方案行为一致）。

## 文件清单

| 文件 | 作用 |
|---|---|
| `zqb.js` | 主脚本：拦截 3 个考勤接口，替换坐标/海拔/地点等字段 |
| `zqb-settings.js` | 选点脚本：拦截 `zqb-settings/save`，保存手动选点 |
| `index.html` | 在线选点页面（GitHub Pages 托管：地图选点/搜索/链接解析） |
| `worker.js` | 链接解析 Worker（Cloudflare Workers 免费版，解析高德短链用） |
| `zqb.module` | 小火箭模块：2 条脚本规则 + MITM 域名（已指向本仓库直链） |

---

## 一、部署（远程托管）

仓库：`https://github.com/cosalone/zqb-wloc`（默认分支 `main`）

### 1. 上传脚本 ✅ 已完成

`zqb.js`、`zqb-settings.js` 已在仓库根目录。

### 2. 模块脚本地址 ✅ 已配置

`zqb.module` 两处 `script-path` 已指向本仓库直链：

```
script-path=https://raw.githubusercontent.com/cosalone/zqb-wloc/main/zqb.js
script-path=https://raw.githubusercontent.com/cosalone/zqb-wloc/main/zqb-settings.js
```

### 3. 上传模块并订阅（剩余步骤）

把本地已改好地址的 `zqb.module` 上传到仓库根目录（Add file → Upload files），小火箭里订阅的直链是：

```
https://raw.githubusercontent.com/cosalone/zqb-wloc/main/zqb.module
```

> 国内打不开 `raw.githubusercontent.com` 时，换 jsDelivr 加速（订阅地址和模块里两处 `script-path` 都要改）：
> - 模块订阅：`https://cdn.jsdelivr.net/gh/cosalone/zqb-wloc@main/zqb.module`
> - 脚本地址：`https://cdn.jsdelivr.net/gh/cosalone/zqb-wloc@main/zqb.js`、`https://cdn.jsdelivr.net/gh/cosalone/zqb-wloc@main/zqb-settings.js`
>
> 注意：jsDelivr 有缓存，改文件后可能延迟数小时才更新；改完配置急着生效就直接用 raw 地址。

### 4. 开启在线选点页面（GitHub Pages）

把 `index.html` 上传到仓库根目录（与两个 js 文件同级），然后：

1. 打开仓库的 Pages 设置页（直达）：**https://github.com/cosalone/zqb-wloc/settings/pages**
2. **Build and deployment → Source** 选 `Deploy from a branch`
3. **Branch** 下拉框选 `main`，目录选 `/ (root)`，点 **Save**
4. 等 1~2 分钟，页面顶部出现绿框 "Your site is live" 即开通成功

开通后的页面地址：

```
https://cosalone.github.io/zqb-wloc/
```

> - 页面必须在小火箭代理开启的状态下用 Safari 访问（它要连本机拦截接口），建议 Safari 分享 → 添加到主屏幕
> - 仓库需保持公开状态（GitHub Pages 免费版要求）

### 5. 小火箭导入模块

小火箭 → 「模块」入口（一般在 设置 → 模块，不同版本入口略有差异）→ 添加 → 粘贴上面的模块直链 → 下载并启用。

### 6. 开启 HTTPS 解密（MITM）

考勤接口是 HTTPS，必须解密才能改包（一次性设置）：

1. 小火箭 → 设置 → HTTPS 解密 → 打开开关，按提示生成并安装 CA 证书（会跳转描述文件安装页）
2. iOS 设置 → 通用 → 关于本机 → 证书信任设置 → 打开 Shadowrocket 证书的完全信任开关
3. 模块启用时会自动把 `proj-kq.ruioutech.com` 加入解密域名（模块 `[MITM]` 已写 `%APPEND%`），无需手动添加

---

## 二、日常使用

### 正常打卡（默认坐标：南莲路53号）

开小火箭、连上代理，正常打卡即可。打卡提交成功会弹系统通知「智勤打卡 · 已替换打卡坐标」。

### 手动选点

**方式一：从地图 App 直接选点（wloc 同款流程，最方便）**

在苹果地图/高德里选好位置 → 共享 → 「智勤选点」快捷指令，一步完成。首次配置约 10 分钟，之后每次选点只要 2 步。

**① 部署链接解析 Worker（一次性，免费）**

高德分享出来的是短链（`surl.amap.com/xxx`），坐标藏在 302 跳转的 Location 头里，快捷指令和网页都读不到，需要一个 Worker 代为解析（wloc 也是这个架构）。链接里的坐标是 GCJ-02，而考勤地图采用 WGS-84 坐标系，因此 Worker 会**自动把 GCJ-02 转换成 WGS-84** 再返回，快捷指令拿到即可直接用：

1. 登录 Cloudflare 控制台 **https://dash.cloudflare.com**（免费账户即可，每天 10 万次请求额度）
2. 左侧 **Compute (Workers)** → **Create Worker** → 随便起名 → **Deploy** 创建
3. 点 **Edit code（编辑代码）**，把仓库里 [`worker.js`](https://github.com/cosalone/zqb-wloc/blob/main/worker.js) 的全部内容粘贴进去覆盖默认代码 → **Deploy**
4. 记下 Worker 地址，形如 `https://zqb-parse.xxx.workers.dev`

**② 创建快捷指令「智勤选点」（一次性）**

1. iOS「快捷指令」App → 右上角 **+** 新建，命名为 **智勤选点**
2. 点底部 **ⓘ** 信息按钮 → 打开 **「在接受共享表单中显示」**
3. 依次添加 5 个动作（在添加动作搜索框里搜关键词）：
   - **「URL 编码」**：输入选「快捷指令输入」
   - **「获取 URL 内容」**：URL 填 `https://你的worker地址/parse?u=`，末尾插入上一步的 **URL 编码结果** 变量；方法保持 GET
   - **「获取词典值」**：获取 **URL 内容** 的 `lon`
   - **「获取词典值」**：获取 **URL 内容** 的 `lat`
   - **「打开 URL」**：填 `https://proj-kq.ruioutech.com/zqb-settings/save?lon=`+ lon 变量 +`&lat=`+ lat 变量
4. 保存

**用法**：
- **苹果地图**：长按地图选点 → 点弹出的标记 → 共享 → 选「智勤选点」
- **高德地图**：长按选点 → 分享 → **更多** → 选「智勤选点」

保存成功会弹「智勤选点 · 已保存」系统通知。

**（可选）「智勤控制」快捷指令**：新建快捷指令 → 添加「从菜单中选取」动作，做「清除选点」「重置抖动」「查询」三个选项，各自接一个「打开 URL」动作（URL 见方式三）。从主屏幕一点就用，不用进页面。

**方式二：在线选点页面**

开启 GitHub Pages 后（见部署第 4 步），在小火箭代理开启的状态下用 Safari 打开，建议添加到主屏幕：

**[https://cosalone.github.io/zqb-wloc/](https://cosalone.github.io/zqb-wloc/)**

- 地图点击选点 → 填地点名称 → 「储存到设备」；右上角可切换地图源（高德街道/高德卫星/Carto/OSM），某个源加载不出来就换一个
- 支持**搜索地名**直接定位（OSM 数据）
- 粘贴高德/苹果链接、高德坐标拾取器坐标、`纬度,经度` 坐标对直接定位（GCJ-02 自动转 WGS-84）；**高德短链**也能解析（需先在页面下方填上你部署的 Worker 地址并点保存）
- 复制链接后切回页面会**自动粘贴并解析**，不用手动粘贴
- 「查询当前生效」会在地图上标出当前实际生效的坐标（蓝点）；页面里也带「清除选点」「重置抖动」按钮
- 收藏常用位置（本机保存），一键重新储存

> 坐标系说明：官方说明「考勤地图采用 WGS84 坐标系，若出现偏差，可参考经纬度获取与转换方法，如使用高德地图经纬度查询网址等」，因此页面保存的坐标均为 **WGS-84**：粘贴的高德/苹果链接、高德坐标拾取器（lbs.amap.com/tools/picker）查到的值是 GCJ-02，页面会自动转成 WGS-84；OSM/Carto 底图点选和地名搜索结果本身即 WGS-84，直接使用；街道图（高德）为 GCJ-02 底图，仅作显示，点选时自动换算。同一位置的 GCJ-02 与 WGS-84 值在本地区相差约 600 米，用高德地图 App 对照页面坐标有偏差属正常。

**方式三：直链（在 Safari 中直接点击即可执行）**

- [查询当前生效坐标](https://proj-kq.ruioutech.com/zqb-settings/save?action=query)
- [清除选点（恢复默认南莲路53号）](https://proj-kq.ruioutech.com/zqb-settings/save?action=clear)
- [重置抖动（立即换一组偏移）](https://proj-kq.ruioutech.com/zqb-settings/save?action=jitter)
- [保存南莲路53号（示例，WGS-84 坐标，可直接点击）](https://proj-kq.ruioutech.com/zqb-settings/save?lon=115.91757960765315&lat=28.622877368112636&loc=江西省南昌市青云谱区三家店街道南莲路53号附近)

保存其他位置的格式（`lon` / `lat` 必填，**须为 WGS-84 坐标**；`loc` 建议填，是打卡记录里的地点名称；`alt` 选填，默认 30.83 米）：

```
https://proj-kq.ruioutech.com/zqb-settings/save?lon=经度&lat=纬度&loc=地点名称&alt=海拔[&cs=gcj]
```

- 坐标用方式二的选点页面解析好再复制过来最稳妥（页面自动转 WGS-84）；直接抄高德/苹果分享链接或高德拾取器（lbs.amap.com/tools/picker）里的 GCJ-02 坐标时，在链接末尾加 `&cs=gcj`，脚本会自动转成 WGS-84 保存，否则会偏约 600 米
- 这些请求被本地脚本拦截，**不会真的发到考勤服务器**；操作成功有系统通知

### 坐标抖动说明（与 ProxyPin 版一致）

- 前 3 位小数固定，第 4 位 ±1，第 5~14 位随机（实际幅度约 ±10~20 米，海拔 ±1~2 米）
- 同一次打卡的 3 个接口使用同一组坐标（偏移缓存 10 分钟滑动有效期）
- 早晚两次打卡间隔超过有效期，自动换新偏移；更换选点后自动重算
- 万一抖动后坐标出了考勤圈：访问 `?action=jitter` 生成新偏移

---

## 三、验证是否生效

1. 打卡后看系统通知「智勤打卡 · 已替换打卡坐标」
2. 小火箭的最近请求/日志里搜 `proj-kq`，能看到脚本处理记录和 `[智勤]` 开头的日志
3. Safari 访问 `?action=query` 能返回 JSON（返回不了说明拦截链路没通）

---

## 四、常见问题

**Q：打卡没被替换？**
按顺序检查：状态栏有 VPN 图标 → 模块已启用 → HTTPS 解密已开启且证书已在 iOS 里信任（部署第 6 步）→ Safari 访问 `?action=query` 能否返回 JSON。

**Q：想恢复真实定位打卡？**
小火箭里关闭该模块（或断开代理）即可，iOS 无需重启。

**Q：raw.githubusercontent.com 打不开？**
用 jsDelivr（见部署第 3 步的替换规则），模块和两个脚本地址都要换。

**Q：选点页面地图空白/瓦片加载失败？**
右上角切换其他地图源：高德源一般走直连（GEOIP 规则），OSM/Carto 走代理，总有一个能出图。地图加载失败不影响搜索、粘贴、储存等功能。

**Q：高德短链解析失败？**
确认已部署 Worker（方式一第①步）且页面里填的地址正确；也可以先在 Safari 里直接打开短链，看能否正常跳转到带坐标的页面。

**Q：想改默认位置 / 打卡时间 / 上下班类型？**
编辑仓库里的 `zqb.js` 顶部 `DEFAULT_CONFIG`：
- `longitude` / `latitude` / `clockLocation`：默认位置
- `clockTime`：`null` = 保持原包时间不变，或填 `"2026-06-25 08:30:00"`
- `timeslotId`：`null` = 保持原包类型不变，`145` = 上班、`146` = 下班

改完在小火箭模块页删除重新添加（或更新），确保拉到新版脚本。

**Q：和 wloc 项目什么关系？**
只借鉴了它「URL 选点 + 持久化存储」的交互设计。本方案改的是考勤 App 的 HTTP 请求（和 ProxyPin 版一样），不改系统定位，因此没有 wloc 在 iOS 26+ 需要重启手机清缓存的限制。

---

## 风险提示

仅供个人测试学习。考勤数据造假可能违反公司制度，使用后果自负。

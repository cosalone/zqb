# 智勤打卡定位 · 小火箭(Shadowrocket)模块

由 ProxyPin 脚本「智勤包v2.1.json」移植，手动选点机制参考 [wloc](https://github.com/cosalone/wloc) 项目。

**工作原理**：小火箭在本机拦截考勤 App 的 3 个上报接口（isInArea / validateLocation / records/add），把坐标替换为目标位置并施加 GPS 抖动。不修改系统定位、无需重启手机——App 界面上显示的仍是真实位置，服务端收到的是替换后的坐标（与 ProxyPin 方案行为一致）。

## 文件清单

| 文件 | 作用 |
|---|---|
| `zqb.js` | 主脚本：拦截 3 个考勤接口，替换坐标/海拔/地点等字段 |
| `zqb-settings.js` | 选点脚本：拦截 `zqb-settings/save`，保存手动选点 |
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

### 4. 小火箭导入模块

小火箭 → 「模块」入口（一般在 设置 → 模块，不同版本入口略有差异）→ 添加 → 粘贴上面的模块直链 → 下载并启用。

### 5. 开启 HTTPS 解密（MITM）

考勤接口是 HTTPS，必须解密才能改包（一次性设置）：

1. 小火箭 → 设置 → HTTPS 解密 → 打开开关，按提示生成并安装 CA 证书（会跳转描述文件安装页）
2. iOS 设置 → 通用 → 关于本机 → 证书信任设置 → 打开 Shadowrocket 证书的完全信任开关
3. 模块启用时会自动把 `proj-kq.ruioutech.com` 加入解密域名（模块 `[MITM]` 已写 `%APPEND%`），无需手动添加

---

## 二、日常使用

### 正常打卡（默认坐标：南莲路53号）

开小火箭、连上代理，正常打卡即可。打卡提交成功会弹系统通知「智勤打卡 · 已替换打卡坐标」。

### 手动选点

在 Safari（开着代理）访问以下地址，建议加到主屏幕或收藏夹：

| 操作 | 地址 |
|---|---|
| 保存选点 | `https://proj-kq.ruioutech.com/zqb-settings/save?lon=经度&lat=纬度&loc=地点名称&alt=海拔` |
| 查询当前 | `https://proj-kq.ruioutech.com/zqb-settings/save?action=query` |
| 清除选点（恢复默认） | `https://proj-kq.ruioutech.com/zqb-settings/save?action=clear` |
| 重置抖动 | `https://proj-kq.ruioutech.com/zqb-settings/save?action=jitter` |

- `lon` / `lat` 必填；`loc` 建议填（打卡记录里的地点名称）；`alt` 选填（默认 30.83 米）
- 坐标从高德/苹果地图的分享链接里取，坐标系与 App 上报一致，直接填入即可
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
按顺序检查：状态栏有 VPN 图标 → 模块已启用 → HTTPS 解密已开启且证书已在 iOS 里信任（部署第 5 步）→ Safari 访问 `?action=query` 能否返回 JSON。

**Q：想恢复真实定位打卡？**
小火箭里关闭该模块（或断开代理）即可，iOS 无需重启。

**Q：raw.githubusercontent.com 打不开？**
用 jsDelivr（见部署第 3 步的替换规则），模块和两个脚本地址都要换。

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

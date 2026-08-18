# 微信内打开更稳定的免费部署方案

截图中的 `net::ERR_TIMED_OUT (-8)` 是微信内置浏览器连接 GitHub Pages 超时，不是“网址被微信封禁”。当前域名解析到 GitHub Pages 的 `185.199.*` 节点，中国大陆移动网络会间歇无法连接。页面代码优化可以减少加载失败，但无法改变 GitHub Pages 顶层网络超时。

推荐把静态前端免费部署到腾讯 EdgeOne Pages（现名 EdgeOne Makers），数据库和 API 继续使用 Render + Neon：

- 免费计划长期提供；
- 可直接连接现有 GitHub 仓库；
- 提供自动 HTTPS 和自定义域名；
- 不需要海外银行卡；
- 腾讯网络在微信内通常比 GitHub Pages 稳定。

## 部署步骤

1. 打开 <https://pages.edgeone.ai/>，登录腾讯云或 GitHub 账号。
2. 选择 **Connect Git Repo**，授权并选择仓库 `zqc121380725-lgtm.github.io`。
3. 分支选择 `main`。
4. 项目类型选择静态站点 / Other：
   - Build command：留空；
   - Output directory：`.`（仓库根目录）。
5. 点击部署，等待获得一个 `*.edgeone.app` 免费地址。
6. 先把这个免费地址发到微信中测试首页、祝福和回执。
7. 测试通过后，在 EdgeOne 项目里添加自定义域名 `zt20261003.love`。
8. 按 EdgeOne 显示的目标值，在阿里云 DNS 修改对应的 `@`/根域名记录。先记录原 GitHub Pages 的 DNS 值，以便需要时回滚。
9. 等 EdgeOne 显示证书和域名均为 Active，再用手机流量和微信分别测试。

## 部署顺序

必须先部署新版后端，再部署前端：

1. Render 的 `render-backend` 分支上线，`/health` 显示 `storage: postgres`。
2. 确认 `/api/init`、`/api/wishes` 和 `/api/rsvp` 可用。
3. 再发布 `main` 前端。
4. 最后切换自定义域名到 EdgeOne。

这样即使 WebSocket 在微信里失败，页面也会自动改用 HTTP；若 HTTP 也暂时断开，宾客填写内容会保留在当前设备的待提交队列，联网后用同一编号重试，不会重复入库。

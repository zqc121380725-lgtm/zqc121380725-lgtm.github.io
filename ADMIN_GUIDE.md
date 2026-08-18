# 婚礼邀请函管理与备份手册

## 管理后台

打开：<https://zt20261003.love/admin.html>

页面会要求输入 Render 环境变量 `ADMIN_TOKEN`。令牌只保存在当前标签页的 `sessionStorage` 中，关闭标签页后需要重新输入。不要把令牌发给宾客，也不要写进前端或 GitHub。

管理后台可以查看：

- 浏览量；
- 出席/缺席回执、联系方式与出席人数；
- 祝福墙、许愿树、菜品偏好、座位和游戏记录；
- 未读数量和实时新消息。

## 删除与恢复保护

删除操作必须经过 `ADMIN_TOKEN` 验证。服务器会在删除前完成以下操作：

1. 创建一份包含待删除记录的完整快照；
2. 在追加式事件日志中写入删除事件和被删除的原记录；
3. 在同一个 PostgreSQL 事务里更新当前状态；
4. 数据库提交成功后，管理页面才显示删除成功。

因此误删可以从 `wedding_snapshots` 或 `wedding_events` 恢复。

## 两种导出

- **导出数据**：下载便于 Excel 打开的 CSV。
- **完整备份**：下载当前状态、全部追加事件和全部快照组成的 JSON 恢复包。

建议在大量发送邀请前、婚礼前一周、婚礼前一天各下载一次“完整备份”，保存到电脑和一个可信云盘。备份包含联系方式，不要公开分享。

## 健康检查

打开：<https://wedding-invitation-live.onrender.com/health>

正式收集数据前必须确认：

- `ok` 为 `true`；
- `storage` 为 `postgres`；
- `persistence` 为 `ok`；
- `adminProtection` 为 `enabled`；
- `backup.events` 与 `backup.snapshots` 会随着互动增长。

如果 `storage` 显示 `file`，Render 仍在使用临时磁盘，重启后会丢失；请立即检查 `DATABASE_URL`。

## 本机命令行备份

详见 `FREE_DATABASE_SETUP.md`。常用命令：

```powershell
$env:DATABASE_URL = '<新的 Neon Pooled connection>'
npm.cmd run backup:export
Remove-Item Env:DATABASE_URL
```

恢复命令必须带 `--confirm RESTORE`，恢复前也会自动保留当前状态快照。

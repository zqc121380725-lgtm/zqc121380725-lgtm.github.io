# 免费稳定数据方案：Neon PostgreSQL + Render

这个方案不需要海外银行卡。Render 继续运行免费 Node 服务，Neon 免费 PostgreSQL 保存数据。Render 和 Neon 空闲时可能休眠，首次访问会慢一些，但数据库中的数据不会因为 Render 重启而消失。

## 先重置已经暴露的数据库密码

此前数据库连接串曾发送到聊天中，其中包含完整密码。旧连接串格式是正确的，但密码已经不再安全，不能继续使用。

1. 登录 [Neon Console](https://console.neon.tech/) 并打开对应项目。
2. 在 **Roles / Databases**（有些界面位于 **Branches → Roles**）找到 `neondb_owner`。
3. 选择 **Reset password** / **Reset role password**。
4. 回到项目首页，点击 **Connect**。
5. 选择数据库、角色以及 **Pooled connection**。主机名通常包含 `-pooler`。
6. 复制新生成的完整连接串。只把它保存到 Render 环境变量，不要放进代码、GitHub 或前端 JavaScript。

如果找不到连接串，路径就是：Neon 项目首页右上角 **Connect** → **Connection string** → **Pooled connection**。

## Render 环境变量

打开 Render 控制台中的 `wedding-invitation-live` 服务，进入 **Environment**，设置：

- `DATABASE_URL`：刚从 Neon 复制的新 Pooled connection。
- `ADMIN_TOKEN`：至少 32 位的随机字符串，用于保护回执、删除和备份接口。
- `FRONTEND_URL`：`https://zt20261003.love`。

保存后，确认服务部署分支为 `render-backend`，再执行一次 **Manual Deploy → Deploy latest commit**。

本次代码第一次连接旧数据库时会自动完成无损迁移：

- 保留数据库里已有的记录；
- 合并本机找回的 2 条祝福和 77 条访客记录；
- 创建 `wedding_events` 追加式事件表；
- 创建 `wedding_snapshots` 快照表；
- 在导入前、删除前和每次重要互动后保存快照。

## 验证

部署后打开：

<https://wedding-invitation-live.onrender.com/health>

正确结果应包含：

```json
{
  "ok": true,
  "storage": "postgres",
  "persistence": "ok",
  "adminProtection": "enabled",
  "backup": {
    "events": 1,
    "snapshots": 1
  }
}
```

如果看到 `"storage": "file"`，说明 Render 没读到 `DATABASE_URL`；此时不要正式收集宾客信息。

然后按顺序验证：

1. 从邀请函提交一条测试祝福和一条测试回执，确认页面提示“已保存”。
2. 在 Render 执行一次 Restart。
3. 再次打开页面，确认数据和浏览量仍然存在。
4. 再看 `/health`，确认事件数、快照数继续增长。

## 手动导出和恢复

在本机 PowerShell 中临时设置新连接串后导出：

```powershell
$env:DATABASE_URL = '<新的 Neon 连接串>'
npm.cmd run backup:export
Remove-Item Env:DATABASE_URL
```

恢复前会强制创建“恢复前快照”，并且必须明确确认：

```powershell
$env:DATABASE_URL = '<新的 Neon 连接串>'
npm.cmd run backup:restore -- --input .\backups\wedding-backup-时间.json --confirm RESTORE
Remove-Item Env:DATABASE_URL
```

不要把含联系方式的备份提交到 Git。`backups/` 与 `local-backups/` 已被忽略。

## 免费额度注意事项

- Neon 与 Render 免费服务都可能休眠，唤醒时慢并不等于数据丢失。
- 不要删除 Neon 项目、数据库角色或 Render 的 `DATABASE_URL`。
- 定期下载 `/api/admin/backup` 或运行 `backup:export`，另存到电脑和一个可信云盘。
- 互动数据以 PostgreSQL 为主；Render 临时磁盘上的文件备份只用于辅助排错。

# 免费数据库配置（Neon + Render）

这个方案不需要海外银行卡：Render 继续使用现有免费 Web Service，数据改为保存在 Neon 的免费 PostgreSQL 数据库中。

## 一、创建 Neon 免费数据库

1. 打开 <https://neon.tech/>，使用 GitHub、Google 或邮箱注册。
2. 创建一个免费项目；地区优先选择离访客较近的区域，例如 Singapore（如果控制台提供）。
3. 在项目控制台点击 **Connect**。
4. 选择 **Pooled connection**（连接池地址，主机名通常包含 `-pooler`）。
5. 复制完整的 PostgreSQL 连接地址，格式类似：

   ```text
   postgresql://用户名:密码@主机名/数据库名?sslmode=require
   ```

不要把真实连接地址提交到 GitHub，也不要放进前端 JavaScript。

## 二、在 Render 中配置

1. 打开 Render 控制台，进入 `wedding-invitation-live` 服务。
2. 打开 **Environment** 页面。
3. 添加环境变量：

   - Key：`DATABASE_URL`
   - Value：上一步复制的 Neon 完整连接地址

4. 保存环境变量。
5. 确保 Render 部署的是包含 `storage.js` 的最新版 `render-backend` 分支，然后执行一次 **Manual Deploy**。

服务器第一次连接空数据库时会自动：

- 创建 `wedding_state` 表；
- 把仓库中现有的 `data.json` 导入数据库；
- 此后所有祝福、回执和浏览量都写入数据库。

## 三、验证配置

部署完成后打开：

<https://wedding-invitation-live.onrender.com/health>

正确结果应包含：

```json
{
  "ok": true,
  "storage": "postgres",
  "persistence": "ok"
}
```

然后按以下顺序验证：

1. 提交一条测试祝福和一条测试回执。
2. 在 Render 控制台执行一次重启或重新部署。
3. 再次打开邀请函和管理面板。
4. 确认祝福、回执以及累计浏览量仍然存在。

如果 `/health` 中显示 `"storage": "file"`，说明 `DATABASE_URL` 没有配置成功，此时不要正式收集宾客数据。

## 四、免费额度注意事项

- Neon 免费数据库可能在空闲时休眠，但数据不会因休眠丢失；第一次访问只会稍慢。
- Render 免费服务也可能休眠，唤醒时会重新连接 Neon，数据库内容仍会保留。
- 不要删除 Neon 项目或 Render 中的 `DATABASE_URL`。
- 建议定期从管理面板导出回执，并保留本地备份。

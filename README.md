# NotebookSync

把企业微信客服收到的文章/链接自动同步成 Obsidian Markdown 笔记。

## 目录结构

```
mynotebook/
├── backend/          ← 部署到 VPS 的后端服务
│   ├── server.js
│   ├── wxkf.js
│   ├── db.js
│   └── package.json
└── plugin/           ← 安装到 Obsidian 的插件
    ├── main.js
    ├── manifest.json
    └── styles.css
```

---

## 第一步：部署后端（VPS）

### 1. 把 backend/ 上传到服务器，安装依赖

```bash
cd backend
npm install
```

### 2. 配置环境变量

创建 `.env` 文件（或直接 export）：

```bash
export WXKF_CORP_ID=ww你的企业ID         # 企业微信「我的企业」→ 企业ID
export WXKF_TOKEN=你在企业微信配置的Token  # 客服→「接入配置」→ Token
export WXKF_AES_KEY=你的43位EncodingAESKey # 客服→「接入配置」→ EncodingAESKey
export API_SECRET=换一个复杂的密钥         # 自定义，Obsidian 插件里填一样的
export PORT=3000
```

### 3. 启动服务

```bash
# 直接启动
node server.js

# 或用 pm2 守护进程
npm install -g pm2
pm2 start server.js --name notebooksync
pm2 save
```

### 4. 开放端口

```bash
# 以 ufw 为例
sudo ufw allow 3000
```

---

## 第二步：配置企业微信客服回调

1. 登录 [企业微信管理后台](https://work.weixin.qq.com/wework_admin)
2. 进入 **客户服务 → 微信客服 → 接入配置**
3. 填写回调 URL：`http://你的服务器IP:3000/webhook`
4. 填写 Token 和 EncodingAESKey（与后端环境变量一致）
5. 点击「验证」——后端日志出现 `验证通过` 即成功

> 企业微信要求回调地址可公网访问，确保你的 VPS 防火墙已开放对应端口。

---

## 第三步：安装 Obsidian 插件

1. 找到你的 Obsidian vault 目录，进入 `.obsidian/plugins/`
2. 新建文件夹 `notebooksync/`
3. 把 `plugin/` 里三个文件复制进去：
   ```
   .obsidian/plugins/notebooksync/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```
4. 重启 Obsidian，进入 **设置 → 第三方插件** → 启用 **NotebookSync**
5. 打开插件设置，填写：
   - **后端地址**：`http://你的服务器IP:3000`
   - **API Secret**：与后端 `API_SECRET` 一致

---

## 使用方法

1. 在微信里找到企业微信客服机器人
2. 转发任意文章/链接/文字给它
3. Obsidian 会在下次同步时（启动时或定时触发）自动创建笔记

笔记保存路径：`{文件夹}/{YYYY-MM}/{文章标题}-{id}.md`

笔记格式示例：
```markdown
---
title: "微信文章标题"
source: "https://..."
type: link
created: 2026-07-09T10:00:00Z
---

文章摘要内容…

[原文链接](https://...)
```

---

## 常见问题

**企业微信验证失败？**
检查服务器能否公网访问，Token/AES Key 是否与后端环境变量一致。

**Obsidian 提示无法连接后端？**
确认后端已启动、端口已开放、后端地址填写正确（包含 `http://`）。

**收到消息但没有笔记？**
查看后端日志（`pm2 logs notebooksync`），确认消息被正确解析和存入数据库。

**想重新同步所有内容？**
在后端执行 SQL 重置同步标记：
```bash
sqlite3 backend/data.sqlite "UPDATE items SET synced = 0;"
```

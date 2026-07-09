# NotebookSync — Obsidian 插件

直连 Weknora（微信知识库）拉取你保存的文章，自动写成 Obsidian Markdown 笔记。无需后端服务器。

## 安装

1. 进入你的 Obsidian vault，打开 `.obsidian/plugins/`
2. 新建文件夹 `notebooksync`
3. 把 `plugin/` 里三个文件复制进去：
   ```
   .obsidian/plugins/notebooksync/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```
4. 重启 Obsidian → 设置 → 第三方插件 → 启用 **NotebookSync**

## 配置

在插件设置里填写：

| 字段 | 说明 |
|---|---|
| AppID | 在 [weknora.weixin.qq.com/platform/openapi](https://weknora.weixin.qq.com/platform/openapi) 获取 |
| Secret | 同上 |
| 保存到文件夹 | 笔记存放位置，默认 `微信笔记` |
| 定时同步 | 每隔 N 分钟自动拉取，0 = 关闭 |

## 使用

1. 在微信里把文章保存到 Weknora 知识库
2. 打开 Obsidian，点击侧边栏 🔄 按钮，或等待自动同步
3. 笔记自动生成，路径格式：`{文件夹}/{知识库名}/{YYYY-MM}/{标题}-{id}.md`

## 笔记格式

```markdown
---
title: "文章标题"
source: "https://..."
type: link
created: 2026-07-09T10:00:00Z
kb: 知识库名称
weknora_id: xxxxx
---

文章正文内容…

[原文链接](https://...)
```

## 重置同步

设置页点「重置同步记录」，下次会重新拉取全部内容。

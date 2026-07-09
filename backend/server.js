"use strict";
/**
 * NotebookSync 后端服务 v2（无数据库版）
 *
 * 环境变量:
 *   WXKF_CORP_ID   企业微信 CorpID
 *   WXKF_TOKEN     企业微信回调 Token
 *   WXKF_AES_KEY   企业微信 EncodingAESKey（43位）
 *   API_SECRET     Obsidian 插件鉴权密钥（自定义）
 *   PORT           监听端口，默认 3000
 */
const express = require("express");
const xml2js  = require("xml2js");
const wxkf    = require("./wxkf");
const store   = require("./store");

const CORP_ID    = process.env.WXKF_CORP_ID  || "";
const TOKEN      = process.env.WXKF_TOKEN     || "";
const AES_KEY    = process.env.WXKF_AES_KEY   || "";
const API_SECRET = process.env.API_SECRET     || "changeme";
const PORT       = parseInt(process.env.PORT  || "3000");

if (!TOKEN || !AES_KEY) {
  console.warn("[警告] 未设置 WXKF_TOKEN / WXKF_AES_KEY，企业微信回调将无法验证");
}

const app = express();
app.use(express.text({ type: ["application/xml", "text/xml", "text/plain"] }));
app.use(express.json());

// ─────────────────────────────────────────────
// 企业微信客服回调
// ─────────────────────────────────────────────

/** GET /webhook — 验证回调 URL */
app.get("/webhook", (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  if (!echostr) return res.status(400).send("missing echostr");

  if (!wxkf.verifySignature(TOKEN, timestamp, nonce, echostr, msg_signature)) {
    console.warn("[webhook GET] 签名验证失败");
    return res.status(403).send("invalid signature");
  }
  try {
    const { message } = wxkf.decryptMsg(AES_KEY, echostr);
    console.log("[webhook GET] 验证通过");
    res.send(message);
  } catch (e) {
    console.error("[webhook GET] 解密失败", e.message);
    res.status(500).send("decrypt error");
  }
});

/** POST /webhook — 接收推送消息 */
app.post("/webhook", async (req, res) => {
  res.send(""); // 先响应，避免超时重推

  const { msg_signature, timestamp, nonce } = req.query;
  const xmlBody = req.body;
  if (!xmlBody) return;

  try {
    const outer   = await xml2js.parseStringPromise(xmlBody, { explicitArray: false });
    const encrypt = outer?.xml?.Encrypt;
    if (!encrypt) return;

    if (!wxkf.verifySignature(TOKEN, timestamp, nonce, encrypt, msg_signature)) {
      console.warn("[webhook POST] 签名验证失败，已忽略");
      return;
    }

    const { message, corpId } = wxkf.decryptMsg(AES_KEY, encrypt);
    if (CORP_ID && corpId && corpId !== CORP_ID) {
      console.warn("[webhook POST] CorpID 不匹配，已忽略");
      return;
    }

    const inner = await xml2js.parseStringPromise(message, { explicitArray: false });
    const msg   = inner?.xml;
    if (msg) handleMessage(msg);

  } catch (e) {
    console.error("[webhook POST] 处理消息出错", e.message);
  }
});

/** 从企业微信消息中提取有用信息并入队 */
function handleMessage(msg) {
  const type = String(msg.MsgType || "").toLowerCase();

  if (type === "link") {
    // 转发的文章/链接卡片
    store.insertItem({
      title:   String(msg.Title       || "未命名"),
      source:  String(msg.Url         || ""),
      type:    "link",
      // content 留空——由 Obsidian 插件自行抓取解析
      content: String(msg.Description || ""),
    });
    console.log("[新条目 link]", msg.Title, msg.Url);

  } else if (type === "text") {
    // 纯文本，可能含 URL
    const text     = String(msg.Content || "");
    const urlMatch = text.match(/https?:\/\/\S+/);
    store.insertItem({
      title:   urlMatch ? urlMatch[0].slice(0, 80) : (text.slice(0, 60) || "文字消息"),
      source:  urlMatch ? urlMatch[0] : "",
      type:    "text",
      content: text,
    });
    console.log("[新条目 text]", text.slice(0, 60));

  } else {
    console.log("[webhook POST] 忽略消息类型:", type);
  }
}

// ─────────────────────────────────────────────
// Obsidian 插件接口
// ─────────────────────────────────────────────

function requireSecret(req, res, next) {
  if (req.headers["x-api-secret"] !== API_SECRET)
    return res.status(401).json({ error: "unauthorized" });
  next();
}

/** GET /items — 取出所有待同步的条目 */
app.get("/items", requireSecret, (_req, res) => {
  res.json({ items: store.getPendingItems() });
});

/** DELETE /items/:id — 插件确认写入后删除条目 */
app.delete("/items/:id", requireSecret, (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });
  store.removeItem(id);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`NotebookSync 后端已启动，监听 :${PORT}`);
  console.log(`  企业微信回调 URL → http://YOUR_SERVER_IP:${PORT}/webhook`);
  console.log(`  API_SECRET: ${API_SECRET === "changeme" ? "⚠️  请修改默认值" : "✅ 已设置"}`);
});

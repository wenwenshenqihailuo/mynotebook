"use strict";
/**
 * NotebookSync — Weknora 版
 * 直连 Weknora（weknora.weixin.qq.com）拉取知识库内容，写成 Obsidian 笔记。
 * 无需后端服务器。
 *
 * 在 https://weknora.weixin.qq.com/platform/openapi 获取 AppID 和 Secret。
 */
var import_obsidian = require("obsidian");
var import_crypto   = require("crypto");

// ─────────────────────────────────────────────
// 默认设置
// ─────────────────────────────────────────────
var DEFAULTS = {
  appid:           "",
  secret:          "",
  folder:          "微信笔记",
  syncOnStartup:   true,
  autoSyncMinutes: 5,
  syncedIds:       {},    // { [knowledgeId]: true }
};

// ─────────────────────────────────────────────
// Weknora API 签名（与原版 NotebookPoint 一致）
// ─────────────────────────────────────────────
var NONCE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
var SAFE_RE     = /[A-Za-z0-9\-_.~]/;

function md5Hex(s) {
  return import_crypto.createHash("md5").update(s, "utf8").digest("hex");
}

function rfc3986(s) {
  let out = "";
  for (const ch of s) {
    out += SAFE_RE.test(ch)
      ? ch
      : "%" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function genNonce(len = 16) {
  let s = "";
  for (let i = 0; i < len; i++)
    s += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  return s;
}

/**
 * 生成 Weknora 请求头（MD5 签名）
 */
function makeHeaders(appid, secret, { bodyJson = "", query = {} } = {}) {
  const ts    = Math.floor(Date.now() / 1000).toString();
  const nonce = genNonce();
  const reqId = import_crypto.randomUUID();

  const params = {
    "x-appid":      appid,
    "x-api-key":    secret,
    "x-request-id": reqId,
    "x-timestamp":  ts,
    "x-nonce":      nonce,
    body:           md5Hex(bodyJson && bodyJson.length ? bodyJson : "{}"),
    ...query,
  };

  const canon = Object.keys(params)
    .sort()
    .map(k => rfc3986(k) + "=" + rfc3986(params[k]))
    .join("&");

  return {
    "X-APPID":      appid,
    "X-API-Key":    secret,
    "X-Request-ID": reqId,
    "X-Timestamp":  ts,
    "X-Nonce":      nonce,
    "X-Signature":  md5Hex(canon),
    "Content-Type": "application/json",
  };
}

// ─────────────────────────────────────────────
// Weknora HTTP 客户端
// ─────────────────────────────────────────────
var BASE = "https://weknora.weixin.qq.com";

class WeknoraClient {
  constructor(appid, secret) {
    this.appid  = appid;
    this.secret = secret;
  }

  async call(path, method = "GET", bodyJson = "") {
    // 解析 query string 用于签名
    const qi    = path.indexOf("?");
    const query = {};
    if (qi >= 0) {
      for (const pair of path.slice(qi + 1).split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        const k  = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
        const v  = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1));
        query[k] = v;
      }
    }

    const headers = makeHeaders(this.appid, this.secret, { bodyJson, query });
    const r = await import_obsidian.requestUrl({
      url:    BASE + path,
      method,
      headers,
      body:   method !== "GET" && bodyJson ? bodyJson : undefined,
      throw:  false,
    });

    let json = null;
    try { json = JSON.parse(r.text); } catch {}
    return { status: r.status, json, text: r.text };
  }

  /** 验证凭据是否有效 */
  async authMe() {
    return this.call("/api/v1/auth/me");
  }

  /** 获取所有知识库列表 */
  async listKnowledgeBases() {
    const r = await this.call("/api/v1/knowledge-bases");
    if (r.status !== 200)
      throw new Error(`列出知识库失败 [${r.status}] ${r.text.slice(0, 200)}`);
    return r.json?.data ?? [];
  }

  /** 获取某个知识库下的知识条目（分页） */
  async listKnowledge(kbId, page = 1, pageSize = 50) {
    const r = await this.call(
      `/api/v1/knowledge-bases/${kbId}/knowledge?page=${page}&page_size=${pageSize}`
    );
    if (r.status !== 200)
      throw new Error(`列出知识失败 [${r.status}] ${r.text.slice(0, 200)}`);
    return { items: r.json?.data ?? [], total: r.json?.total ?? 0 };
  }

  /** 获取知识详情 */
  async getKnowledge(id) {
    const r = await this.call(`/api/v1/knowledge/${id}`);
    if (r.status !== 200)
      throw new Error(`获取知识详情失败 [${r.status}]`);
    return r.json?.data ?? r.json;
  }

  /**
   * 获取解析后的完整正文：
   * /preview 返回分段(chunk)数组，按序拼接并去掉段间重叠。
   */
  async getContent(id) {
    const r = await this.call(
      `/api/v1/knowledge/${id}/preview?page=1&page_size=1000`
    );
    if (r.status !== 200) return "";
    const chunks = (r.json?.data ?? [])
      .slice()
      .sort((a, b) => (a.chunk_index ?? 0) - (b.chunk_index ?? 0))
      .map(c => c.content ?? "");
    return decodeEntities(stripFrontmatter(joinChunks(chunks))).trim();
  }
}

// ─────────────────────────────────────────────
// 内容处理工具
// ─────────────────────────────────────────────

function decodeEntities(s) {
  const named = {
    "&amp;":  "&", "&lt;":   "<", "&gt;":   ">", "&quot;": '"',
    "&#39;":  "'", "&#x27;": "'", "&nbsp;": " ", "&apos;": "'",
  };
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, m => named[m] ?? m)
    .replace(/&#(\d+);/g,       (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** 拼接分块并去掉块间重叠部分 */
function joinChunks(chunks) {
  let out = "";
  for (const c of chunks) {
    if (!c) continue;
    if (!out) { out = c; continue; }
    const max = Math.min(400, out.length, c.length);
    let k = 0;
    for (let n = max; n > 16; n--) {
      if (out.slice(-n) === c.slice(0, n)) { k = n; break; }
    }
    out += k ? c.slice(k) : "\n\n" + c;
  }
  return out;
}

function stripFrontmatter(text) {
  return text.replace(/^\s*---\n[\s\S]*?\n---\n?/, "");
}

// ─────────────────────────────────────────────
// 笔记渲染
// ─────────────────────────────────────────────

function sanitize(s) {
  return String(s)
    .replace(/[\\/:*?"<>|#^[\]]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "未命名";
}

function escapeYaml(s) {
  return /[:#\n"']/.test(s) ? JSON.stringify(s) : s;
}

/** 从对象里按优先级取正文：markdown > content > text > description */
function pickContent(o) {
  return String(o?.markdown || o?.content || o?.text || o?.description || "");
}

/** 笔记路径：{folder}/{知识库名}/{YYYY-MM}/{标题前80字符}-{id前8位}.md */
function noteRelPath(folder, kbName, item) {
  const title = String(item.title || "未命名");
  const ym    = String(item.created_at || "").slice(0, 7) || "未知日期";
  return `${folder}/${sanitize(kbName)}/${ym}/${sanitize(title).slice(0, 80)}-${item.id.slice(0, 8)}.md`;
}

function renderNote(kbName, item, body) {
  const title = String(item.title || "未命名");
  const fm = [
    "---",
    `title: ${escapeYaml(title)}`,
    item.source     ? `source: ${escapeYaml(String(item.source))}`  : null,
    item.type       ? `type: ${item.type}`                          : null,
    item.created_at ? `created: ${item.created_at}`                 : null,
    `kb: ${escapeYaml(kbName)}`,
    `weknora_id: ${item.id}`,
    "---",
    "",
  ].filter(x => x !== null).join("\n");

  const main     = body || String(item.description || "");
  const linkLine = item.source ? `\n[原文链接](${item.source})\n` : "";
  return fm + main + linkLine + "\n";
}

// ─────────────────────────────────────────────
// 主插件类
// ─────────────────────────────────────────────
class NotebookSyncPlugin extends import_obsidian.Plugin {
  constructor() { super(...arguments); this.timer = null; }

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("refresh-cw", "从微信同步", () => this.sync());
    this.addCommand({ id: "sync-weknora", name: "从微信同步(Weknora)", callback: () => this.sync() });

    this.addSettingTab(new NbsSettingTab(this.app, this));
    this.scheduleAuto();

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncOnStartup && this.settings.appid)
        window.setTimeout(() => this.sync(true), 3000);
    });
  }

  onunload() { if (this.timer) window.clearInterval(this.timer); }

  scheduleAuto() {
    if (this.timer) { window.clearInterval(this.timer); this.timer = null; }
    const m = this.settings.autoSyncMinutes;
    if (m > 0 && this.settings.appid) {
      this.timer = window.setInterval(() => this.sync(true), m * 60 * 1000);
      this.registerInterval(this.timer);
    }
  }

  // ── Weknora 同步 ────────────────────────────
  async sync(silent = false) {
    const { appid, secret } = this.settings;
    if (!appid || !secret) {
      if (!silent) new import_obsidian.Notice("NotebookSync: 请先在设置里填写 AppID 和 Secret");
      return;
    }

    if (!silent) new import_obsidian.Notice("NotebookSync: 开始同步…");
    const client  = new WeknoraClient(appid.trim(), secret.trim());
    let created   = 0;
    let errorCount= 0;

    try {
      const kbs = await client.listKnowledgeBases();
      if (!kbs.length) {
        if (!silent) new import_obsidian.Notice("NotebookSync: 没有找到知识库");
        return;
      }

      for (const kb of kbs) {
        try {
          created += await this.syncKB(client, kb);
        } catch (e) {
          console.error(`NotebookSync 知识库[${kb.name}]同步出错`, e);
          errorCount++;
        }
      }
    } catch (e) {
      if (!silent) new import_obsidian.Notice("NotebookSync: 连接 Weknora 失败，请检查 AppID/Secret");
      console.error("NotebookSync sync error", e);
      return;
    }

    await this.saveSettings();

    const msg = errorCount
      ? `NotebookSync: 完成，新增 ${created} 条，${errorCount} 个知识库出错`
      : `NotebookSync: 同步完成，新增 ${created} 条`;
    if (!silent || created > 0) new import_obsidian.Notice(msg);
  }

  /** 同步单个知识库的全部条目 */
  async syncKB(client, kb) {
    let page    = 1;
    let created = 0;

    while (true) {
      const { items, total } = await client.listKnowledge(kb.id, page, 50);
      if (!items.length) break;

      for (const item of items) {
        if (this.settings.syncedIds[item.id]) continue;   // 已同步，跳过

        try {
          // 与原版逻辑一致：/preview 全文 → getKnowledge 详情字段 → item 本身字段
          let body = await client.getContent(item.id);
          if (!body) {
            try {
              body = pickContent(await client.getKnowledge(item.id));
            } catch {
              body = pickContent(item);
            }
          }

          const path = import_obsidian.normalizePath(noteRelPath(this.settings.folder, kb.name, item));
          await this.ensureFolder(path.substring(0, path.lastIndexOf("/")));
          const content  = renderNote(kb.name, item, body);
          const existing = this.app.vault.getAbstractFileByPath(path);
          if (existing instanceof import_obsidian.TFile)
            await this.app.vault.modify(existing, content);
          else
            await this.app.vault.create(path, content);

          this.settings.syncedIds[item.id] = true;
          created++;
        } catch (e) {
          console.error(`NotebookSync 写入条目 ${item.id} 失败`, e);
        }
      }

      // 判断是否还有更多页
      if (page * 50 >= total) break;
      page++;
    }

    return created;
  }

  async ensureFolder(path) {
    let cur = "";
    for (const p of path.split("/")) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur))
        try { await this.app.vault.createFolder(cur); } catch {}
    }
  }

  async loadSettings()  { this.settings = Object.assign({}, DEFAULTS, await this.loadData()); }
  async saveSettings()  { await this.saveData(this.settings); }
}

// ─────────────────────────────────────────────
// 设置页
// ─────────────────────────────────────────────
class NbsSettingTab extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    // ── Weknora 凭据 ──
    containerEl.createEl("h3", { text: "Weknora 连接" });
    containerEl.createEl("p", { cls: "nbs-hint",
      text: "在 weknora.weixin.qq.com/platform/openapi 获取 AppID 和 Secret。" });

    new import_obsidian.Setting(containerEl)
      .setName("AppID")
      .addText(t => t.setPlaceholder("your-appid").setValue(this.plugin.settings.appid)
        .onChange(async v => {
          this.plugin.settings.appid = v.trim();
          await this.plugin.saveSettings();
          this.plugin.scheduleAuto();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Secret")
      .addText(t => {
        t.inputEl.type = "password";
        t.setPlaceholder("your-secret").setValue(this.plugin.settings.secret)
          .onChange(async v => { this.plugin.settings.secret = v.trim(); await this.plugin.saveSettings(); });
      });

    // ── 同步选项 ──
    containerEl.createEl("h3", { text: "同步选项" });

    new import_obsidian.Setting(containerEl)
      .setName("保存到文件夹")
      .addText(t => t.setPlaceholder("微信笔记").setValue(this.plugin.settings.folder)
        .onChange(async v => { this.plugin.settings.folder = v.trim() || "微信笔记"; await this.plugin.saveSettings(); }));

    new import_obsidian.Setting(containerEl)
      .setName("打开 Obsidian 时自动同步")
      .addToggle(t => t.setValue(this.plugin.settings.syncOnStartup)
        .onChange(async v => { this.plugin.settings.syncOnStartup = v; await this.plugin.saveSettings(); }));

    new import_obsidian.Setting(containerEl)
      .setName("定时同步（分钟）")
      .setDesc("0 = 关闭")
      .addText(t => t.setValue(String(this.plugin.settings.autoSyncMinutes))
        .onChange(async v => {
          this.plugin.settings.autoSyncMinutes = Math.max(0, parseInt(v) || 0);
          await this.plugin.saveSettings();
          this.plugin.scheduleAuto();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("立即同步")
      .addButton(b => b.setButtonText("同步").setCta().onClick(() => this.plugin.sync()));

    new import_obsidian.Setting(containerEl)
      .setName("重置同步记录")
      .setDesc("清空「已同步」标记，下次重新拉取全部内容")
      .addButton(b => b.setButtonText("重置").setWarning().onClick(async () => {
        this.plugin.settings.syncedIds = {};
        await this.plugin.saveSettings();
        new import_obsidian.Notice("已重置同步记录");
      }));

  }
}

module.exports = NotebookSyncPlugin;

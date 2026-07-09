"use strict";
/**
 * 轻量队列存储 — 用本地 JSON 文件替代数据库
 * queue.json 格式: Array<{ id, title, source, type, content, created_at }>
 */
const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "queue.json");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return []; }
}

function save(items) {
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2), "utf8");
}

function nextId(items) {
  return items.length ? Math.max(...items.map(i => i.id)) + 1 : 1;
}

/** 追加一条新条目 */
function insertItem(item) {
  const items = load();
  items.push({
    id:         nextId(items),
    title:      item.title   || "未命名",
    source:     item.source  || "",
    type:       item.type    || "text",
    content:    item.content || "",
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  save(items);
}

/** 取出所有待处理条目（最多100条） */
function getPendingItems() {
  return load().slice(0, 100);
}

/** 删除已被 Obsidian 确认的条目 */
function removeItem(id) {
  save(load().filter(i => i.id !== id));
}

module.exports = { insertItem, getPendingItems, removeItem };

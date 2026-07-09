"use strict";
/**
 * 企业微信客服消息签名验证 & AES 解密
 * 文档: https://developer.work.weixin.qq.com/document/path/90968
 */
const crypto = require("crypto");

/**
 * 验证企业微信回调签名
 * @param {string} token      - 企业微信后台配置的 Token
 * @param {string} timestamp  - 请求参数 timestamp
 * @param {string} nonce      - 请求参数 nonce
 * @param {string} encrypt    - 加密消息体（或 echostr）
 * @param {string} msgSig     - 请求参数 msg_signature
 */
function verifySignature(token, timestamp, nonce, encrypt, msgSig) {
  const expected = crypto
    .createHash("sha1")
    .update([token, timestamp, nonce, encrypt].sort().join(""))
    .digest("hex");
  return expected === msgSig;
}

/**
 * 解密企业微信 AES-256-CBC 消息
 * @param {string} encodingAesKey - 企业微信后台的 EncodingAESKey（43位，不含=）
 * @param {string} encryptedMsg   - Base64 编码的加密消息
 * @returns {{ message: string, corpId: string }}
 */
function decryptMsg(encodingAesKey, encryptedMsg) {
  // EncodingAESKey 末尾补一个 = 凑成 Base64
  const key = Buffer.from(encodingAesKey + "=", "base64"); // 32 bytes
  const iv = key.subarray(0, 16);

  const buf = Buffer.from(encryptedMsg, "base64");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(buf), decipher.final()]);

  // 去掉 PKCS7 填充
  const padLen = decrypted[decrypted.length - 1];
  if (padLen > 0 && padLen <= 32) decrypted = decrypted.subarray(0, decrypted.length - padLen);

  // 结构: 16字节随机串 | 4字节消息长度(大端) | 消息内容 | CorpID
  decrypted = decrypted.subarray(16);
  const msgLen = decrypted.readUInt32BE(0);
  const message = decrypted.subarray(4, 4 + msgLen).toString("utf8");
  const corpId = decrypted.subarray(4 + msgLen).toString("utf8");

  return { message, corpId };
}

module.exports = { verifySignature, decryptMsg };

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_WECHAT_BASE_URL,
  PACKAGE_VERSION,
  ensureDir,
} from "./constants.js";

import { object, string } from "./protocol.js";
import { updatesFromJson, type Account, type WechatMessage, type MediaItem, type ExtractedContent, type MessageItem } from "./wechat-types.js";

interface QrCode { qrcode: string; qrcode_img_content: string }
interface QrStatus {
  status: string;
  ilink_bot_id?: string;
  bot_token?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

const MSG_TYPE_USER = 1;
const MSG_TYPE_BOT = 2;
const MSG_STATE_FINISH = 2;

const MSG_ITEM_TEXT = 1;
const MSG_ITEM_IMAGE = 2;
const MSG_ITEM_VOICE = 3;
const MSG_ITEM_FILE = 4;
const MSG_ITEM_VIDEO = 5;

const LONG_POLL_TIMEOUT_MS = 35_000;

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf8").toString("base64");
}

function buildHeaders(token: string | undefined, body: string | undefined) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };

  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  if (body) {
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
  }

  return headers;
}

async function apiFetch({
  baseUrl,
  endpoint,
  body,
  token,
  timeoutMs,
  method = "POST",
  extraHeaders = {},
}: { baseUrl: string; endpoint: string; body?: string; token?: string; timeoutMs: number; method?: string; extraHeaders?: Record<string, string> }) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(endpoint, base).toString();
  const response = await fetch(url, {
    method,
    headers: {
      ...buildHeaders(token, body),
      ...extraHeaders,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return text;
}

export async function fetchQrCode(baseUrl = DEFAULT_WECHAT_BASE_URL) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("ilink/bot/get_bot_qrcode?bot_type=3", base);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`QR fetch failed: ${response.status}`);
  }

  const data = object(await response.json());
  return { qrcode: string(data.qrcode), qrcode_img_content: string(data.qrcode_img_content) };
}

export async function pollQrStatus(baseUrl: string, qrcode: string): Promise<QrStatus> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    base,
  );

  try {
    const response = await fetch(url, {
      headers: { "iLink-App-ClientVersion": "1" },
      signal: AbortSignal.timeout(35_000),
    });

    if (!response.ok) {
      throw new Error(`QR status failed: ${response.status}`);
    }

    const data = object(await response.json());
    const status: QrStatus = { status: string(data.status) };
    for (const key of ["ilink_bot_id", "bot_token", "baseurl", "ilink_user_id"] as const) {
      if (data[key] != null) status[key] = string(data[key]);
    }
    return status;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { status: "wait" };
    }

    throw error;
  }
}

export async function loginWithQr({ baseUrl = DEFAULT_WECHAT_BASE_URL, onQr }: { baseUrl?: string; onQr?: (qr: QrCode) => void | Promise<void> }): Promise<Account> {
  const qr = await fetchQrCode(baseUrl);
  if (typeof onQr === "function") {
    await onQr(qr);
  }

  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const status = await pollQrStatus(baseUrl, qr.qrcode);
    if (status.status === "wait" || status.status === "scaned") {
      await sleep(1000);
      continue;
    }

    if (status.status === "expired") {
      throw new Error("QR code expired");
    }

    if (status.status === "confirmed") {
      if (!status.ilink_bot_id || !status.bot_token) {
        throw new Error("QR login confirmed but response is missing bot credentials");
      }

      return {
        token: status.bot_token,
        baseUrl: status.baseurl || baseUrl,
        accountId: status.ilink_bot_id,
        userId: status.ilink_user_id,
        savedAt: new Date().toISOString(),
      };
    }
  }

  throw new Error("QR login timed out");
}

export async function getUpdates(account: Account, getUpdatesBuf: string) {
  try {
    const raw = await apiFetch({
      baseUrl: account.baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: getUpdatesBuf,
        base_info: { channel_version: PACKAGE_VERSION },
      }),
      token: account.token,
      timeoutMs: LONG_POLL_TIMEOUT_MS,
    });
    return updatesFromJson(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }

    throw error;
  }
}

export function extractContent(message: WechatMessage): ExtractedContent | null {
  const items = message.item_list ?? [];
  const attachmentItem = items.find((item) => item.type === MSG_ITEM_FILE || item.type === MSG_ITEM_VIDEO);
  if (attachmentItem) {
    const attachment = extractItem(attachmentItem);
    if (attachment) {
      const captions = items
        .filter((item) => item.type === MSG_ITEM_TEXT)
        .map((item) => item.text_item?.text?.trim())
        .filter((text): text is string => Boolean(text));
      if (captions.length > 0) attachment.text = `${captions.join("\n")}\n\n${attachment.text}`;
      return attachment;
    }
  }
  for (const item of items) {
    const content = extractItem(item);
    if (content) return content;
  }
  return null;
}

function extractImage(image: MediaItem): ExtractedContent {
  const dimensions = image.width && image.height ? ` (${image.width}x${image.height})` : "";
  return { msgType: "image", text: `[图片${dimensions}]`, mediaItem: image };
}

function extractItem(item: MessageItem): ExtractedContent | null {
  switch (item.type) {
    case MSG_ITEM_TEXT: {
      const rawText = item.text_item?.text?.trim();
      if (!rawText) {
        return null;
      }

      const quoted = item.ref_msg?.title ? `[引用] ${item.ref_msg.title}\n` : "";
      return {
        msgType: "text",
        text: `${quoted}${rawText}`,
      };
    }
    case MSG_ITEM_VOICE: {
      return {
        msgType: "voice",
        text: item.voice_item?.text
          ? `[语音转写]\n${item.voice_item.text}`
          : "[语音消息，未提供转写]",
        mediaItem: item.voice_item ?? null,
      };
    }
    case MSG_ITEM_IMAGE:
      return extractImage(item.image_item ?? {});
    case MSG_ITEM_FILE: {
      const file = item.file_item ?? {};
      const fileName = file.file_name ? ` ${file.file_name}` : "";
      return {
        msgType: "file",
        text: `[文件${fileName}]`,
        mediaItem: file,
      };
    }
    case MSG_ITEM_VIDEO: {
      const video = item.video_item ?? {};
      const durationMs = video.duration_ms ?? video.play_length;
      const seconds = durationMs
        ? ` ${(durationMs / 1000).toFixed(1)}s`
        : "";
      return {
        msgType: "video",
        text: `[视频${seconds}]`,
        mediaItem: video,
      };
    }
    default:
      return {
        msgType: "unknown",
        text: `[未知消息类型 ${item.type}]`,
      };
  }
}

function decryptAesEcb(data: Buffer, keyBase64: string) {
  const decoded = Buffer.from(keyBase64, "base64");
  const decodedText = decoded.toString("ascii");
  const key = decoded.length === 32 && /^[0-9a-f]{32}$/i.test(decodedText)
    ? Buffer.from(decodedText, "hex")
    : decoded;
  if (key.length !== 16) throw new Error("Invalid media encryption key");
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

const DEFAULT_WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
const MAX_ENCRYPTED_MEDIA_BYTES = 25 * 1024 * 1024;

function trustedMediaUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== "cdn.weixin.qq.com" && !host.endsWith(".cdn.weixin.qq.com")) || url.port || url.username || url.password) {
    throw new Error("Unsupported media download URL");
  }
  return url.toString();
}

function mediaDownloadUrl(mediaItem: MediaItem): { url: string; key: string } | null {
  const media = mediaItem.media;
  const key = mediaItem.aeskey
    ? Buffer.from(mediaItem.aeskey, "hex").toString("base64")
    : media?.aes_key ?? mediaItem.aes_key;
  if (!key) return null;

  const fullUrl = media?.full_url ?? mediaItem.cdn_url;
  if (fullUrl) return { url: trustedMediaUrl(fullUrl), key };
  if (!media?.encrypt_query_param) return null;

  const url = new URL("download", `${DEFAULT_WECHAT_CDN_BASE_URL}/`);
  url.searchParams.set("encrypted_query_param", media.encrypt_query_param);
  return { url: trustedMediaUrl(url.toString()), key };
}

async function readLimitedResponse(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ENCRYPTED_MEDIA_BYTES) {
    throw new Error("Media attachment exceeds the 25 MiB download limit");
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ENCRYPTED_MEDIA_BYTES) throw new Error("Media attachment exceeds the 25 MiB download limit");
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ENCRYPTED_MEDIA_BYTES) {
        await reader.cancel();
        throw new Error("Media attachment exceeds the 25 MiB download limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

export async function downloadAndDecryptMedia(mediaItem: MediaItem) {
  const source = mediaDownloadUrl(mediaItem);
  if (!source) return null;
  const response = await fetch(source.url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`CDN download failed: ${response.status}`);
  }

  const encrypted = await readLimitedResponse(response);
  return decryptAesEcb(encrypted, source.key);
}

function guessImageExtension(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from("89504E470D0A1A0A", "hex"))
  ) {
    return ".png";
  }
  if (
    buffer.length >= 3 &&
    buffer.subarray(0, 3).equals(Buffer.from("FFD8FF", "hex"))
  ) {
    return ".jpg";
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") {
      return ".gif";
    }
  }
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return ".webp";
  }
  return ".bin";
}

export async function downloadImageAttachment({ mediaItem, outputDir, fileStem }: { mediaItem: MediaItem; outputDir: string; fileStem: string }) {
  const buffer = await downloadAndDecryptMedia(mediaItem);
  if (!buffer) return null;
  const extension = guessImageExtension(buffer);
  ensureDir(outputDir);
  const filePath = path.join(outputDir, `${fileStem}${extension}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function generateClientId() {
  return `codex-wechat:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function getTypingTicket(account: Account, toUserId: string, contextToken: string) {
  try {
    const raw = await apiFetch({
      baseUrl: account.baseUrl,
      endpoint: "ilink/bot/getconfig",
      body: JSON.stringify({
        to_user_id: toUserId,
        context_token: contextToken,
        base_info: { channel_version: PACKAGE_VERSION },
      }),
      token: account.token,
      timeoutMs: 5000,
    });
    const ticket = object(JSON.parse(raw)).typing_ticket;
    return ticket == null ? null : string(ticket);
  } catch {
    return null;
  }
}

async function sendTyping(account: Account, toUserId: string, contextToken: string, typingTicket: string) {
  await apiFetch({
    baseUrl: account.baseUrl,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({
      to_user_id: toUserId,
      typing_ticket: typingTicket,
      context_token: contextToken,
      base_info: { channel_version: PACKAGE_VERSION },
    }),
    token: account.token,
    timeoutMs: 5000,
  });
}

export async function showTypingIndicator(account: Account, toUserId: string, contextToken: string) {
  const ticket = await getTypingTicket(account, toUserId, contextToken);
  if (ticket) {
    await sendTyping(account, toUserId, contextToken, ticket);
  }
}

export async function sendTextMessage(account: Account, toUserId: string, text: string, contextToken: string) {
  await apiFetch({
    baseUrl: account.baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: generateClientId(),
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [
          {
            type: MSG_ITEM_TEXT,
            text_item: { text },
          },
        ],
        context_token: contextToken,
      },
      base_info: { channel_version: PACKAGE_VERSION },
    }),
    token: account.token,
    timeoutMs: 15_000,
  });
}

export function isInboundUserMessage(message: WechatMessage) {
  return message?.message_type === MSG_TYPE_USER;
}

export function getReplyTarget(message: WechatMessage) {
  return message.group_id || message.from_user_id || null;
}

export function getConversationKey(message: WechatMessage) {
  return getReplyTarget(message);
}

export function normalizeWechatText(text: string) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

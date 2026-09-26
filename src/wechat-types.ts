import { object, string } from "./protocol.js";

export interface Account {
  token: string;
  baseUrl: string;
  accountId: string;
  userId?: string;
  savedAt: string;
}

export function accountFromJson(value: unknown): Account {
  const data = object(value);
  return {
    token: string(data.token),
    baseUrl: string(data.baseUrl),
    accountId: string(data.accountId),
    savedAt: string(data.savedAt),
    ...(data.userId === undefined ? {} : { userId: string(data.userId) }),
  };
}

export interface MediaItem {
  cdn_url?: string;
  aes_key?: string;
  text?: string;
  file_name?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
}

export interface MessageItem {
  type?: number;
  text_item?: { text?: string };
  ref_msg?: { title?: string };
  voice_item?: MediaItem;
  image_item?: MediaItem;
  file_item?: MediaItem;
  video_item?: MediaItem;
}

export interface WechatMessage {
  message_type?: number;
  from_user_id?: string;
  group_id?: string;
  context_token?: string;
  item_list?: MessageItem[];
}

export interface ExtractedContent {
  msgType: "text" | "voice" | "image" | "file" | "video" | "unknown";
  text: string;
  mediaItem?: MediaItem | null;
}

export interface Updates {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WechatMessage[];
  get_updates_buf?: string;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite number");
  return value;
}

function mediaFromJson(value: unknown): MediaItem {
  const data = object(value);
  const result: MediaItem = {};
  for (const key of ["cdn_url", "aes_key", "text", "file_name"] as const) {
    if (data[key] != null) result[key] = string(data[key]);
  }
  for (const key of ["width", "height", "duration_ms"] as const) {
    if (data[key] != null) result[key] = number(data[key]);
  }
  return result;
}

function itemFromJson(value: unknown): MessageItem {
  const data = object(value);
  const result: MessageItem = {};
  if (data.type != null) result.type = number(data.type);
  if (data.text_item != null) {
    const text = object(data.text_item).text;
    result.text_item = text == null ? {} : { text: string(text) };
  }
  if (data.ref_msg != null) {
    const title = object(data.ref_msg).title;
    result.ref_msg = title == null ? {} : { title: string(title) };
  }
  for (const key of ["voice_item", "image_item", "file_item", "video_item"] as const) {
    if (data[key] != null) result[key] = mediaFromJson(data[key]);
  }
  return result;
}

function messageFromJson(value: unknown): WechatMessage {
  const data = object(value);
  const result: WechatMessage = {};
  if (data.message_type != null) result.message_type = number(data.message_type);
  for (const key of ["from_user_id", "group_id", "context_token"] as const) {
    if (data[key] != null) result[key] = string(data[key]);
  }
  if (data.item_list != null) {
    if (!Array.isArray(data.item_list)) throw new Error("Expected item_list array");
    result.item_list = data.item_list.map(itemFromJson);
  }
  return result;
}

export function updatesFromJson(value: unknown): Updates {
  const data = object(value);
  const result: Updates = {};
  for (const key of ["ret", "errcode"] as const) {
    if (data[key] !== undefined) result[key] = number(data[key]);
  }
  for (const key of ["errmsg", "get_updates_buf"] as const) {
    if (data[key] != null) result[key] = string(data[key]);
  }
  if (data.msgs != null) {
    if (!Array.isArray(data.msgs)) throw new Error("Expected msgs array");
    result.msgs = data.msgs.map(messageFromJson);
  }
  return result;
}

// @name 红果短剧
// @author 小心儿悠悠
// @description 使用红果短剧官方网页目录与官方 App 签名接口，支持动态分类、本地搜索、全量剧集和多清晰度直链播放
// @version 2.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/短剧/红果短剧.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const WEB_HOST = normalizeHost(process.env.HONGGUO_WEB_HOST || "https://hongguoduanju.com");
const APP_HOST = normalizeHost(process.env.HONGGUO_APP_HOST || "https://api5-normal-sinfonlineb.fqnovel.com");
const WEB_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";
const APP_USER_AGENT = "com.phoenix.read/72932 (Linux; U; Android 12; zh_CN; V2284A; Build/V417IR;tt-ok/3.12.13.20)";
const PAGE_SIZE = 20;
const REQUEST_TIMEOUT = 30000;
const WEB_CACHE_TTL = 5 * 60 * 1000;
const DETAIL_CACHE_TTL = 15 * 60 * 1000;

const FIXED_CLASSES = [
  { type_id: "推荐榜", type_name: "推荐榜" },
  { type_id: "热播榜", type_name: "热播榜" },
  { type_id: "新剧榜", type_name: "新剧榜" },
  { type_id: "男频", type_name: "男频" },
  { type_id: "女频", type_name: "女频" },
];

const FALLBACK_CLASSES = [
  { type_id: "cate_757", type_name: "现代" },
  { type_id: "cate_1", type_name: "都市" },
  { type_id: "cate_758", type_name: "古代" },
  { type_id: "cate_1021", type_name: "现言" },
  { type_id: "cate_262", type_name: "脑洞" },
  { type_id: "cate_1019", type_name: "玄幻" },
  { type_id: "cate_439", type_name: "古言" },
  { type_id: "cate_36", type_name: "重生" },
  { type_id: "cate_37", type_name: "穿越" },
  { type_id: "cate_96", type_name: "甜宠" },
  { type_id: "cate_303", type_name: "喜剧" },
  { type_id: "cate_165", type_name: "悬疑" },
];

const CATEGORY_ALIASES = {
  推荐: "推荐榜",
  热播: "热播榜",
  新剧: "新剧榜",
  奇幻脑洞: "脑洞",
  现代言情: "现言",
  战神归来: "战神",
  悬疑推理: "悬疑",
  古风权谋: "权谋",
  玄幻仙侠: "仙侠",
  无敌神医: "神医",
  现言甜宠: "甜宠",
  追妻: "追妻火葬场",
  豪门恩怨: "豪门",
  历史古代: "古代",
  古风言情: "古言",
  闪婚: "先婚后爱",
  萌宝: "福宝",
  霸总: "豪门",
  都市日常: "都市",
  都市修仙: "仙侠",
  奇幻爱情: "奇幻",
};

const QUALITY_OPTIONS = [
  { name: "1080P", level: "1080p" },
  { name: "720P", level: "720p" },
  { name: "540P", level: "540p" },
  { name: "480P", level: "480p" },
  { name: "360P", level: "360p" },
];

const webCache = new Map();
const detailCache = new Map();
const knownSeries = new Map();

// ByteDance Argus/Gorgon/Ladon request signer and codec helpers.
const nodeCrypto = require("crypto");

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  return Buffer.from(String(value == null ? "" : value), "utf8");
}
function stringToUtf8Bytes(value) { return new Uint8Array(Buffer.from(String(value), "utf8")); }
function hexToBytes(value) { return new Uint8Array(Buffer.from(String(value).replace(/\s+/g, ""), "hex")); }
function bytesToHex(value) { return toBuffer(value).toString("hex"); }
function bytesToBase64(value) { return toBuffer(value).toString("base64"); }
function md5(value) { return nodeCrypto.createHash("md5").update(toBuffer(value)).digest("hex"); }
function sm3Bytes(value) { return new Uint8Array(nodeCrypto.createHash("sm3").update(toBuffer(value)).digest()); }
function pkcs7Pad(value, blockSize = 16) {
  const input = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  const padding = blockSize - (input.length % blockSize);
  const output = new Uint8Array(input.length + padding);
  output.set(input);
  output.fill(padding, input.length);
  return output;
}
function aesCbcEncrypt(input, key, iv) {
  const cipher = nodeCrypto.createCipheriv("aes-128-cbc", toBuffer(key), toBuffer(iv));
  return new Uint8Array(Buffer.concat([cipher.update(toBuffer(input)), cipher.final()]));
}
function buildQueryString(query) {
  return Object.entries(query).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&");
}
const CLIENT_CONFIG = {
  baseQuery: {
    iid: "4439167111854618",
    device_id: "4439167111850522",
    channel: "huawei_8662_64",
    device_type: "V2284A",
    cdid: "6100e9f9-a1a0-4f65-ab47-94f5b41b8efb",
    aid: "8662",
    app_name: "novelread",
    version_code: "72932",
    version_name: "7.2.9.32",
    device_platform: "android",
    ac: "wifi",
    os: "android",
    ssmix: "a",
    device_brand: "vivo",
    language: "zh",
    os_api: "32",
    os_version: "12",
    manifest_version_code: "72932",
    resolution: "1080*1920",
    dpi: "280",
    update_version_code: "72932",
    host_abi: "arm64-v8a",
    dragon_device_type: "phone",
    pv_player: "72932",
    compliance_status: "0",
    need_personal_recommend: "1",
    player_so_load: "1",
    is_android_pad_screen: "1",
    rom_version: "V417IR+release-keys",
  },
  sessionHeaders: {
    cookie: "",
    "x-tt-token": "",
    "user-agent": "com.phoenix.read/72932 (Linux; U; Android 12; zh_CN; V2284A; Build/V417IR;tt-ok/3.12.13.20)",
    "x-tt-store-region": "cn-zj",
    "x-tt-store-region-src": "did",
    "passport-sdk-version": "5051452",
    "sdk-version": "2",
  },
};

const IMAGE_SHRINK =
  "W3siaW1hZ2VfdHlwZSI6MywiaW1hZ2Vfd2lkdGgiOjkwMCwic2hyaW5rX3R5cGUiOjN9LHsiaW1h\n" +
  "Z2VfdHlwZSI6NCwiaW1hZ2Vfd2lkdGgiOjU0LCJzaHJpbmtfdHlwZSI6NH1d\n";

const SIGN_KEY = hexToBytes("ac1adaae95a7af94a5114ab3b3a97dd80050aa0a39314c40528caec95256c28c");
const ARGUS_HEADER = hexToBytes("3ccc");
const ARGUS_PREFIX = hexToBytes("a6e783ee7001100918");
const ARGUS_SUFFIX = hexToBytes("567b");
const ARGUS_XOR_WORD = hexToBytes("d04ffdff");
const LICENSE_ID = 1611921764;
const METASEC_APP_ID = 3019;
const SDK_VERSION = 135135744;
const COUNTER_VALUE = 1388734;
const SIMON_Z = word64(0x046d678b, 0x3dc94c3a);

function concatBytes(...parts) {
  const arrays = parts.map((part) => part instanceof Uint8Array ? part : new Uint8Array(part || []));
  const output = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function randomBytes(length) {
  const output = new Uint8Array(length);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(output);
    return output;
  }
  for (let i = 0; i < length; i++) output[i] = Math.floor(Math.random() * 256);
  return output;
}

function reverseBytes(bytes) {
  const output = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) output[i] = bytes[bytes.length - i - 1];
  return output;
}

function getHeader(headers, name) {
  const expected = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === expected && value != null) return String(value);
  }
  return "";
}

function getQueryString(url) {
  const text = String(url || "");
  const question = text.indexOf("?");
  if (question < 0) return "";
  const hash = text.indexOf("#", question);
  return text.slice(question + 1, hash < 0 ? undefined : hash);
}

function getQueryParam(url, name) {
  const expected = String(name);
  for (const pair of getQueryString(url).split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const key = separator < 0 ? pair : pair.slice(0, separator);
    if (decodeURIComponent(key) === expected) {
      return decodeURIComponent(separator < 0 ? "" : pair.slice(separator + 1));
    }
  }
  return null;
}

function encodeVarint(value) {
  let remaining = Number(value);
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new RangeError("protobuf varint must be a safe non-negative integer");
  const output = [];
  while (remaining >= 0x80) {
    output.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  output.push(remaining);
  return new Uint8Array(output);
}

function pbVarint(field, value) {
  return concatBytes(encodeVarint(field * 8), encodeVarint(value));
}

function pbBytes(field, value) {
  const encoded = value instanceof Uint8Array ? value : stringToUtf8Bytes(String(value));
  return concatBytes(encodeVarint(field * 8 + 2), encodeVarint(encoded.length), encoded);
}

function word64(lo, hi) {
  return { lo: lo >>> 0, hi: hi >>> 0 };
}

function xor64(...values) {
  let lo = 0;
  let hi = 0;
  for (const value of values) {
    lo ^= value.lo;
    hi ^= value.hi;
  }
  return word64(lo, hi);
}

function and64(a, b) {
  return word64(a.lo & b.lo, a.hi & b.hi);
}

function not64(value) {
  return word64(~value.lo, ~value.hi);
}

function add64(a, b) {
  const lo = (a.lo + b.lo) >>> 0;
  return word64(lo, (a.hi + b.hi + (lo < a.lo ? 1 : 0)) >>> 0);
}

function rol64(value, count) {
  const shift = ((count % 64) + 64) % 64;
  if (shift === 0) return word64(value.lo, value.hi);
  if (shift < 32) {
    return word64(
      (value.lo << shift) | (value.hi >>> (32 - shift)),
      (value.hi << shift) | (value.lo >>> (32 - shift)),
    );
  }
  if (shift === 32) return word64(value.hi, value.lo);
  const rest = shift - 32;
  return word64(
    (value.hi << rest) | (value.lo >>> (32 - rest)),
    (value.lo << rest) | (value.hi >>> (32 - rest)),
  );
}

function ror64(value, count) {
  return rol64(value, 64 - (count % 64));
}

function readWord64LE(bytes, offset = 0) {
  const lo = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  const hi = (bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)) >>> 0;
  return word64(lo, hi);
}

function writeWord64LE(output, offset, value) {
  for (let i = 0; i < 4; i++) {
    output[offset + i] = (value.lo >>> (i * 8)) & 0xff;
    output[offset + 4 + i] = (value.hi >>> (i * 8)) & 0xff;
  }
}

function simonZBit(index) {
  return word64(index < 32 ? (SIMON_Z.lo >>> index) & 1 : (SIMON_Z.hi >>> (index - 32)) & 1, 0);
}

function simonRoundKeys(key) {
  const words = Array.from({ length: 4 }, (_, index) => readWord64LE(key, index * 8));
  for (let index = 4; index < 72; index++) {
    let mixed = xor64(ror64(words[index - 1], 3), words[index - 3]);
    mixed = xor64(mixed, ror64(mixed, 1));
    words.push(xor64(not64(words[index - 4]), mixed, simonZBit((index - 4) % 62), word64(3, 0)));
  }
  return words;
}

function simonEncrypt(block, roundKeys) {
  let left = readWord64LE(block, 0);
  let right = readWord64LE(block, 8);
  for (const key of roundKeys) {
    const oldRight = right;
    const nonlinear = and64(rol64(right, 1), rol64(right, 8));
    right = xor64(left, nonlinear, rol64(right, 2), key);
    left = oldRight;
  }
  const output = new Uint8Array(16);
  writeWord64LE(output, 0, left);
  writeWord64LE(output, 8, right);
  return output;
}

function argusProtobuf(query, stub, timestamp, options) {
  const bodyInput = /^[0-9a-f]{32}$/i.test(stub) ? hexToBytes(stub) : new Uint8Array(16);
  const randomValue = options.argusRandom == null ? readWord32LE(randomBytes(4)) : options.argusRandom >>> 0;
  const signCount = options.argusSignCount == null ? 2 + (randomBytes(1)[0] % 49) * 2 : options.argusSignCount;
  const nested = concatBytes(
    pbVarint(1, signCount),
    pbVarint(2, COUNTER_VALUE),
    pbVarint(3, COUNTER_VALUE),
    pbVarint(4, COUNTER_VALUE),
  );
  return concatBytes(
    pbVarint(1, 0x20200929 * 2),
    pbVarint(2, 2),
    pbVarint(3, randomValue),
    pbBytes(4, METASEC_APP_ID),
    pbBytes(6, LICENSE_ID),
    pbBytes(7, "6.8.1.32"),
    pbBytes(8, "v04.07.01-ml-android"),
    pbVarint(9, SDK_VERSION),
    pbBytes(10, new Uint8Array(8)),
    pbVarint(12, timestamp * 2),
    pbBytes(13, sm3Bytes(bodyInput).slice(0, 6)),
    pbBytes(14, sm3Bytes(stringToUtf8Bytes(query)).slice(0, 6)),
    pbBytes(15, nested),
    pbBytes(20, "none"),
    pbVarint(21, 738),
  );
}

function readWord32LE(bytes) {
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}

function createArgus(query, stub, timestamp, options = {}) {
  const protobuf = pkcs7Pad(argusProtobuf(query, stub, timestamp, options));
  const simonKey = sm3Bytes(concatBytes(SIGN_KEY, ARGUS_HEADER, ARGUS_SUFFIX, SIGN_KEY));
  const roundKeys = simonRoundKeys(simonKey);
  const encrypted = [];
  for (let offset = 0; offset < protobuf.length; offset += 16) {
    encrypted.push(simonEncrypt(protobuf.slice(offset, offset + 16), roundKeys));
  }

  const xorKey = concatBytes(ARGUS_XOR_WORD, ARGUS_XOR_WORD);
  const encoded = concatBytes(xorKey, ...encrypted);
  for (let index = 8; index < encoded.length; index++) encoded[index] ^= encoded[index % 8];
  const container = concatBytes(ARGUS_PREFIX, reverseBytes(encoded), ARGUS_SUFFIX);
  const key = hexToBytes(md5(SIGN_KEY.slice(0, 16)));
  const iv = hexToBytes(md5(SIGN_KEY.slice(16)));
  return bytesToBase64(concatBytes(ARGUS_HEADER, aesCbcEncrypt(container, key, iv)));
}

function ladonRoundKeys(randomPrefix, aid) {
  const asciiDigest = stringToUtf8Bytes(md5(concatBytes(randomPrefix, stringToUtf8Bytes(String(aid)))));
  const table = new Uint8Array(288);
  table.set(asciiDigest);
  const queue = Array.from({ length: 4 }, (_, index) => readWord64LE(table, index * 8));
  let left = queue.shift();
  let right = queue.shift();
  for (let index = 0; index < 0x22; index++) {
    const mixed = xor64(add64(ror64(right, 8), left), word64(index, 0));
    queue.push(mixed);
    left = xor64(mixed, ror64(left, 61));
    writeWord64LE(table, (index + 1) * 8, left);
    right = queue.shift();
  }
  return Array.from({ length: 0x22 }, (_, index) => readWord64LE(table, index * 8));
}

function ladonEncryptBlock(block, roundKeys) {
  let left = readWord64LE(block, 0);
  let right = readWord64LE(block, 8);
  for (const key of roundKeys) {
    right = xor64(key, add64(left, ror64(right, 8)));
    left = xor64(right, ror64(left, 61));
  }
  const output = new Uint8Array(16);
  writeWord64LE(output, 0, left);
  writeWord64LE(output, 8, right);
  return output;
}

function createLadon(timestamp, aid, options = {}) {
  const randomPrefix = options.ladonRandom == null
    ? randomBytes(4)
    : new Uint8Array(options.ladonRandom);
  if (randomPrefix.length !== 4) throw new RangeError("ladonRandom must be four bytes");
  const data = stringToUtf8Bytes(`${timestamp}-${LICENSE_ID}-${METASEC_APP_ID}`);
  const paddedSize = Math.ceil(data.length / 16) * 16;
  const padded = new Uint8Array(paddedSize);
  padded.set(data);
  const padding = 16 - (data.length % 16);
  if (data.length + padding <= paddedSize) padded.fill(padding, data.length);
  const roundKeys = ladonRoundKeys(randomPrefix, aid);
  const ciphertext = [];
  for (let offset = 0; offset < padded.length; offset += 16) {
    ciphertext.push(ladonEncryptBlock(padded.slice(offset, offset + 16), roundKeys));
  }
  return bytesToBase64(concatBytes(randomPrefix, ...ciphertext));
}

function md5Prefix(value) {
  const bytes = value instanceof Uint8Array ? value : stringToUtf8Bytes(String(value));
  return hexToBytes(md5(bytes)).slice(0, 4);
}

function buildGorgonSeed(url, { headers = {}, body = null, khronos } = {}) {
  if (!Number.isInteger(khronos) || khronos < 0 || khronos > 0xffffffff) {
    throw new RangeError("khronos must be an unsigned 32-bit integer");
  }
  const stub = getHeader(headers, "x-ss-stub").trim();
  let bodyPrefix = new Uint8Array(4);
  if (/^[0-9a-f]{32}$/i.test(stub)) bodyPrefix = hexToBytes(stub.slice(0, 8));
  else if (body != null) {
    const bodyBytes = body instanceof Uint8Array ? body : stringToUtf8Bytes(String(body));
    if (bodyBytes.length > 0) bodyPrefix = md5Prefix(bodyBytes);
  }
  const cookie = getHeader(headers, "cookie");
  const timestamp = new Uint8Array([
    (khronos >>> 24) & 0xff,
    (khronos >>> 16) & 0xff,
    (khronos >>> 8) & 0xff,
    khronos & 0xff,
  ]);
  return concatBytes(
    md5Prefix(getQueryString(url)),
    bodyPrefix,
    cookie ? md5Prefix(cookie) : new Uint8Array(4),
    new Uint8Array([0x00, 0x01, 0x07, 0x04]),
    timestamp,
  );
}

function reverseBits(value) {
  let result = ((value << 1) & 0xaa) | ((value >>> 1) & 0x55);
  result = ((result << 2) & 0xcc) | ((result >>> 2) & 0x33);
  return ((result << 4) | (result >>> 4)) & 0xff;
}

function transformGorgonSeed(seed, { headerByte2, headerByte3, parameter = 0 } = {}) {
  const input = seed instanceof Uint8Array ? seed : new Uint8Array(seed || []);
  if (input.length !== 20) throw new TypeError("seed must contain 20 bytes");
  const key = new Uint8Array([0x4a, parameter & 0xff, 0x16, headerByte3, 0x47, 0x6c, parameter >>> 8, headerByte2]);
  const sbox = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + sbox[i] + key[i & 7]) & 0xff;
    sbox[i] = sbox[j];
  }
  const payload = new Uint8Array(input);
  let i = 0;
  j = 0;
  for (let offset = 0; offset < payload.length; offset++) {
    i = (i + 1) & 0xff;
    j = (j + sbox[i]) & 0xff;
    sbox[i] = sbox[j];
    payload[offset] ^= sbox[(sbox[i] + sbox[j]) & 0xff];
  }
  const lengthMask = (~payload.length) & 0xff;
  for (let offset = 0; offset < payload.length; offset++) {
    const swappedNibbles = ((payload[offset] << 4) | (payload[offset] >>> 4)) & 0xff;
    payload[offset] = reverseBits(swappedNibbles ^ payload[(offset + 1) % payload.length]) ^ lengthMask;
  }
  return concatBytes(new Uint8Array([0x84, 0x04, headerByte2, headerByte3, parameter & 0xff, parameter >>> 8]), payload);
}

function signHongguoRequest(url, options = {}) {
  const timestamp = options.timestamp == null
    ? (options.khronos == null ? Math.floor(Date.now() / 1000) : options.khronos)
    : options.timestamp;
  if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff) {
    throw new RangeError("timestamp must be an unsigned 32-bit integer");
  }
  const aid = parseInt(getQueryParam(url, "aid"), 10);
  if (!Number.isSafeInteger(aid)) throw new TypeError("signed URL must contain a numeric aid parameter");
  const random = randomBytes(2);
  const headerByte2 = options.headerByte2 == null ? ((random[0] % 7) + 1) << 5 : options.headerByte2;
  const headerByte3 = options.headerByte3 == null ? 0xe0 | (random[1] & 0x0f) : options.headerByte3;
  const headers = options.headers || {};
  const seed = buildGorgonSeed(url, { headers, body: options.body, khronos: timestamp });
  return {
    "X-Argus": createArgus(getQueryString(url), getHeader(headers, "x-ss-stub").trim(), timestamp, options),
    "X-Gorgon": bytesToHex(transformGorgonSeed(seed, { headerByte2, headerByte3, parameter: options.parameter || 0 })),
    "X-Khronos": String(timestamp),
    "X-Ladon": createLadon(timestamp, aid, options),
  };
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeHost(value) {
  return text(value).replace(/\/+$/, "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueBy(values, keySelector) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = text(keySelector(value));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function getBodyText(response) {
  const body = response && typeof response === "object" && "body" in response ? response.body : response;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  return typeof body === "string" ? body : text(body);
}

function buildHttpUrl(host, path, query = {}) {
  const queryString = buildQueryString(query);
  return `${normalizeHost(host)}${path}${queryString ? `?${queryString}` : ""}`;
}

async function log(level, message) {
  try {
    await OmniBox.log(level, `[红果短剧]${message}`);
  } catch {
    // 日志失败不应影响爬虫结果。
  }
}

function cacheGet(cache, key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(cache, key, value, ttl) {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

function responseStatus(response) {
  const raw = response && (response.statusCode ?? response.status);
  return raw == null ? 200 : Number(raw);
}

function parseJsonResponse(response, url) {
  if (!response) throw new Error(`请求无响应: ${url}`);
  const status = responseStatus(response);
  const body = getBodyText(response);
  if (!Number.isFinite(status) || status < 200 || status >= 400) {
    throw new Error(`HTTP ${Number.isFinite(status) ? status : "unknown"} @ ${url}`);
  }
  try {
    const payload = JSON.parse(body || "{}");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("接口未返回 JSON 对象");
    }
    return payload;
  } catch (error) {
    throw new Error(`接口未返回有效 JSON: ${error.message}`);
  }
}

async function requestWebJson(path, query, cacheKey, ttl = WEB_CACHE_TTL) {
  if (cacheKey) {
    const cached = cacheGet(webCache, cacheKey);
    if (cached !== undefined) return cached;
  }

  const url = buildHttpUrl(WEB_HOST, path, query);
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await log("info", `[网页目录] GET ${url}`);
      const response = await OmniBox.request(url, {
        method: "GET",
        headers: {
          "User-Agent": WEB_USER_AGENT,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        timeout: REQUEST_TIMEOUT,
      });
      const payload = parseJsonResponse(response, url);
      if (cacheKey) cacheSet(webCache, cacheKey, payload, ttl);
      return payload;
    } catch (error) {
      lastError = error;
      await log("warn", `[网页目录] 第${attempt}次请求失败: ${error.message}`);
    }
  }
  throw lastError || new Error("网页目录请求失败");
}

function buildAppUrl(path, extraQuery = {}) {
  return buildHttpUrl(APP_HOST, path, {
    ...CLIENT_CONFIG.baseQuery,
    ...extraQuery,
    _rticket: String(Date.now()),
  });
}

async function requestAppJson(path, body, extraQuery = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const url = buildAppUrl(path, extraQuery);
    const payloadText = JSON.stringify(body || {});
    const headers = {
      ...CLIENT_CONFIG.sessionHeaders,
      "content-type": "application/json; charset=utf-8",
      "accept-encoding": "identity",
      "x-ss-stub": md5(stringToUtf8Bytes(payloadText)).toUpperCase(),
    };
    for (const key of Object.keys(headers)) {
      if (headers[key] === "" || headers[key] == null) delete headers[key];
    }
    Object.assign(headers, signHongguoRequest(url, { headers, body: payloadText }));

    try {
      await log("info", `[App接口] POST ${path}（第${attempt}次）`);
      const response = await OmniBox.request(url, {
        method: "POST",
        headers,
        body: payloadText,
        timeout: REQUEST_TIMEOUT,
      });
      const payload = parseJsonResponse(response, url);
      const code = payload.code == null ? 0 : Number(payload.code);
      if (code !== 0) throw new Error(`API code=${payload.code}: ${text(payload.message || payload.msg)}`);
      return payload;
    } catch (error) {
      lastError = error;
      await log("warn", `[App接口] 第${attempt}次请求失败: ${error.message}`);
    }
  }
  throw lastError || new Error("App 接口请求失败");
}

function rememberSeries(items) {
  for (const item of asArray(items)) {
    const seriesId = text(item && (item.series_id || item.book_id));
    if (seriesId) knownSeries.set(seriesId, item);
  }
}

function extractImageUrl(value) {
  if (typeof value === "string") {
    const url = value.trim();
    return url.startsWith("//") ? `https:${url}` : url;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractImageUrl(item);
      if (url) return url;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  for (const key of ["url", "main_url", "download_url", "url_list", "urlList", "urls"]) {
    const url = extractImageUrl(value[key]);
    if (url) return url;
  }
  return "";
}

function celebrityNames(value) {
  return uniqueBy(
    asArray(value)
      .map((item) => text(typeof item === "string" ? item : item && (item.nickname || item.name || item.actor_name)))
      .filter(Boolean),
    (name) => name,
  );
}

function tagNames(value) {
  if (typeof value === "string") {
    const source = value.trim();
    if (!source) return [];
    try {
      return tagNames(JSON.parse(source));
    } catch {
      return source.split(/[,，/|·]/).map(text).filter(Boolean);
    }
  }
  if (Array.isArray(value)) {
    return uniqueBy(value.flatMap((item) => tagNames(item)), (name) => name);
  }
  if (!value || typeof value !== "object") return [];
  const direct = text(value.name || value.show_name || value.category_name || value.title || value.value);
  if (direct) return [direct];
  return Object.values(value).flatMap((item) => tagNames(item));
}

function mapWebsiteVod(item = {}) {
  const seriesId = text(item.series_id || item.book_id);
  if (!seriesId) return null;
  const tags = tagNames(item.tags || item.category_schema);
  return {
    vod_id: new URLSearchParams({ series_id: seriesId }).toString(),
    vod_name: text(item.series_name || item.series_title || item.title),
    vod_pic: extractImageUrl(item.series_cover || item.cover),
    vod_remarks: text(item.episode_right_text) || (item.episode_cnt ? `全${item.episode_cnt}集` : ""),
    vod_content: text(item.series_intro || item.intro || item.desc),
    vod_actor: celebrityNames(item.celebrities || item.actors).join(", "),
    type_name: tags.join(", "),
  };
}

function normalizeWebsiteList(payload) {
  const items = asArray(payload && (payload.video_list || payload.data));
  rememberSeries(items);
  return items;
}

async function loadSelectorClasses() {
  const payload = await requestWebJson(
    "/incent_resource/selector",
    { app_id: "8662" },
    "selector",
    30 * 60 * 1000,
  );
  const classes = [];
  for (const row of asArray(payload.selector_list || payload.data)) {
    for (const item of asArray(row && (row.items || row.selector_items))) {
      const id = text(item.selector_item_id || item.type_id || item.id);
      const name = text(item.show_name || item.type_name || item.name);
      if (!/^cate_/i.test(id) || !name) continue;
      classes.push({ type_id: id, type_name: name });
    }
  }
  return uniqueBy(classes, (item) => item.type_id);
}

async function getClasses() {
  try {
    const dynamic = await loadSelectorClasses();
    return [...FIXED_CLASSES, ...(dynamic.length ? dynamic : FALLBACK_CLASSES)];
  } catch (error) {
    await log("warn", `[分类] 动态分类加载失败，使用内置分类: ${error.message}`);
    return [...FIXED_CLASSES, ...FALLBACK_CLASSES];
  }
}

function fixedCategorySpec(categoryId) {
  const map = {
    推荐榜: { gender: 2, sortType: 1 },
    热播榜: { gender: 2, sortType: 1 },
    新剧榜: { gender: 2, sortType: 2 },
    男频: { gender: 1, sortType: 1 },
    女频: { gender: 0, sortType: 1 },
  };
  return map[categoryId] || null;
}

async function resolveCategory(categoryId) {
  const raw = text(categoryId) || "推荐榜";
  const aliased = CATEGORY_ALIASES[raw] || raw;
  const fixed = fixedCategorySpec(aliased);
  if (fixed) return fixed;
  if (/^cate_/i.test(aliased)) return { gender: 2, sortType: 1, category: aliased };

  const classes = await getClasses();
  const exact = classes.find((item) => item.type_name === aliased || item.type_id === aliased);
  if (exact && /^cate_/i.test(exact.type_id)) {
    return { gender: 2, sortType: 1, category: exact.type_id };
  }
  return { gender: 2, sortType: 1, localKeyword: aliased };
}

function listCacheKey(spec) {
  return `list:${spec.gender ?? 2}:${spec.sortType ?? 1}:${spec.category || "all"}`;
}

async function loadWebsiteItems(spec = {}) {
  const normalized = {
    gender: Number.isFinite(Number(spec.gender)) ? Number(spec.gender) : 2,
    sortType: Number.isFinite(Number(spec.sortType)) ? Number(spec.sortType) : 1,
    category: text(spec.category),
  };
  const query = {
    app_id: "8662",
    min_first_visible_time: "0",
    gender: String(normalized.gender),
    sort_type: String(normalized.sortType),
  };
  if (normalized.category) query.categories_v2 = normalized.category;
  const payload = await requestWebJson(
    "/incent_resource/video_list_by_selector",
    query,
    listCacheKey(normalized),
  );
  let items = normalizeWebsiteList(payload);
  if (spec.localKeyword) items = filterRawItems(items, spec.localKeyword);
  return items;
}

function normalizeSearchText(value) {
  return text(value).toLocaleLowerCase().replace(/\s+/g, "");
}

function searchableText(item) {
  return [
    item.series_name,
    item.series_title,
    item.title,
    item.series_intro,
    item.intro,
    ...tagNames(item.tags || item.category_schema),
    ...celebrityNames(item.celebrities || item.actors),
  ].map(normalizeSearchText).filter(Boolean);
}

function filterRawItems(items, keyword) {
  const normalized = normalizeSearchText(keyword);
  if (!normalized) return asArray(items);
  return asArray(items).filter((item) => searchableText(item).some((value) => value.includes(normalized)));
}

function searchScore(item, keyword) {
  const needle = normalizeSearchText(keyword);
  if (!needle) return 0;
  const title = normalizeSearchText(item.series_name || item.series_title || item.title);
  if (title === needle) return 1000;
  if (title.startsWith(needle)) return 800;
  if (title.includes(needle)) return 600;
  const tags = tagNames(item.tags || item.category_schema).map(normalizeSearchText);
  if (tags.some((value) => value === needle)) return 450;
  if (tags.some((value) => value.includes(needle))) return 350;
  const actors = celebrityNames(item.celebrities || item.actors).map(normalizeSearchText);
  if (actors.some((value) => value.includes(needle))) return 250;
  const intro = normalizeSearchText(item.series_intro || item.intro || item.desc);
  return intro.includes(needle) ? 100 : 0;
}

function rankSearchResults(items, keyword) {
  const byId = new Map();
  asArray(items).forEach((item, index) => {
    const seriesId = text(item && (item.series_id || item.book_id));
    const score = searchScore(item || {}, keyword);
    if (!seriesId || score <= 0) return;
    const current = byId.get(seriesId);
    if (!current || score > current.score) byId.set(seriesId, { item, score, index });
  });
  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

function pageNumber(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function pageResult(items, page) {
  const normalizedPage = pageNumber(page);
  const total = asArray(items).length;
  const start = (normalizedPage - 1) * PAGE_SIZE;
  return {
    page: normalizedPage,
    pagecount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    limit: PAGE_SIZE,
    total,
    list: asArray(items).slice(start, start + PAGE_SIZE).map(mapWebsiteVod).filter(Boolean),
  };
}

function extractSeriesId(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const source = text(raw);
  if (!source || /^https?:\/\/(?![^/]*hongguoduanju\.com)/i.test(source)) return "";
  if (/^\d{6,}$/.test(source)) return source;

  const querySource = source.includes("?") ? source.slice(source.indexOf("?") + 1) : source;
  try {
    const params = new URLSearchParams(querySource);
    for (const key of ["series_id", "book_id", "seriesId", "id"]) {
      const candidate = text(params.get(key));
      if (/^\d{6,}$/.test(candidate)) return candidate;
    }
  } catch {
    // 继续使用保守的数字匹配。
  }
  const match = source.match(/(?:series_id|book_id|seriesId)[=/:%3D]+(\d{6,})/i)
    || source.match(/hongguoduanju\.com\/[^?#]*?(\d{6,})/i);
  return match ? match[1] : "";
}

function appDetailBody(seriesId) {
  return {
    biz_param: {
      detail_page_version: 0,
      disable_digg_stat: false,
      disable_video_relate_book: false,
      image_shrink_datas_str: IMAGE_SHRINK,
      need_all_video_definition: false,
      need_mp4_align: false,
      screen_width_px: "900",
      source: 7,
      use_os_player: false,
      use_server_dns: false,
    },
    series_id: String(seriesId),
  };
}

function appPlayBody(vid) {
  return {
    biz_param: {
      detail_page_version: 0,
      device_level: 3,
      disable_digg_stat: false,
      disable_video_relate_book: false,
      need_all_video_definition: true,
      need_mp4_align: false,
      use_os_player: false,
      use_server_dns: false,
      video_platform: 1024,
    },
    mixed_video_id_map: { "1": [String(vid)] },
  };
}

function normalizeEpisodeList(values) {
  return asArray(values)
    .map((item, index) => {
      const episode = typeof item === "string" ? { vid: item } : (item || {});
      const vid = text(episode.vid || episode.video_id || episode.episode_id);
      if (!/^\d{6,}$/.test(vid)) return null;
      const order = Number(episode.vid_index || episode.episode_index || episode.index || index + 1) || index + 1;
      const title = text(episode.title || episode.episode_title || episode.name);
      return {
        vid,
        order,
        name: title && title.length <= 40 ? title : `第${order}集`,
        duration: Number(episode.duration || episode.duration_seconds || 0) || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

function statusText(value) {
  const normalized = text(value).toLocaleLowerCase();
  if (value === 1 || ["1", "completed", "complete", "finished", "已完结", "完结"].includes(normalized)) return "已完结";
  if (value === 0 || ["0", "serializing", "ongoing", "连载中", "连载"].includes(normalized)) return "连载中";
  return "";
}

function detailRemarks(count, status, fallback) {
  const countText = count > 0 ? `全${count}集` : text(fallback);
  return [countText, statusText(status)].filter(Boolean).join(" · ");
}

function normalizeAppDetail(payload, seriesId) {
  const data = payload && payload.data;
  const entry = data && (data[seriesId] || Object.values(data)[0]);
  const videoData = entry && (entry.video_data || entry);
  if (!videoData || typeof videoData !== "object") throw new Error("详情接口未返回剧集数据");
  const episodes = normalizeEpisodeList(videoData.video_list || videoData.vid_list);
  if (!episodes.length) throw new Error("详情接口未返回完整剧集列表");
  const count = Number(videoData.episode_cnt) || episodes.length;
  return {
    seriesId,
    name: text(videoData.series_title || videoData.series_name || videoData.title),
    cover: extractImageUrl(videoData.series_cover || videoData.cover),
    intro: text(videoData.series_intro || videoData.intro || videoData.desc),
    actors: celebrityNames(videoData.celebrities || videoData.actors),
    tags: tagNames(videoData.category_schema || videoData.tags || videoData.category_names),
    remarks: detailRemarks(count, videoData.series_status, videoData.episode_right_text),
    episodes,
  };
}

function normalizeWebsiteDetail(item, seriesId) {
  if (!item || typeof item !== "object") throw new Error("网页详情为空");
  const episodes = normalizeEpisodeList(item.vid_list || item.video_list || item.series_episode_info);
  if (!episodes.length) throw new Error("网页详情未返回剧集列表");
  const count = Number(item.episode_cnt) || episodes.length;
  return {
    seriesId,
    name: text(item.series_name || item.series_title || item.title),
    cover: extractImageUrl(item.series_cover || item.cover),
    intro: text(item.series_intro || item.intro || item.desc),
    actors: celebrityNames(item.celebrities || item.actors),
    tags: tagNames(item.tags || item.category_schema || item.category_names),
    remarks: detailRemarks(count, item.series_status, item.episode_right_text || `全${count}集`),
    episodes,
  };
}

async function loadSeriesDetail(seriesId) {
  const cached = cacheGet(detailCache, seriesId);
  if (cached) return cached;

  try {
    const payload = await requestAppJson(
      "/novel/player/multi_video_detail/v1/",
      appDetailBody(seriesId),
    );
    const normalized = normalizeAppDetail(payload, seriesId);
    return cacheSet(detailCache, seriesId, normalized, DETAIL_CACHE_TTL);
  } catch (error) {
    await log("warn", `[详情] App 详情失败，尝试网页详情: ${error.message}`);
  }

  try {
    const payload = await requestWebJson(
      "/incent_resource/detail_page",
      { app_id: "8662", series_id: seriesId },
      `detail-web:${seriesId}`,
      DETAIL_CACHE_TTL,
    );
    const item = payload.video_detail || payload.data || knownSeries.get(seriesId);
    const normalized = normalizeWebsiteDetail(item, seriesId);
    return cacheSet(detailCache, seriesId, normalized, DETAIL_CACHE_TTL);
  } catch (error) {
    const remembered = knownSeries.get(seriesId);
    if (remembered) {
      const normalized = normalizeWebsiteDetail(remembered, seriesId);
      return cacheSet(detailCache, seriesId, normalized, DETAIL_CACHE_TTL);
    }
    throw error;
  }
}

function makePlayId(seriesId, vid, level) {
  return new URLSearchParams({
    series_id: String(seriesId),
    vid: String(vid),
    level: String(level),
  }).toString();
}

function playSources(detailData) {
  return QUALITY_OPTIONS.map((quality) => ({
    name: quality.name,
    episodes: detailData.episodes.map((episode) => ({
      name: episode.name,
      playId: makePlayId(detailData.seriesId, episode.vid, quality.level),
    })),
  }));
}

function parsePlayId(value) {
  const source = text(value);
  if (!source || source.includes("://")) return null;
  const params = new URLSearchParams(source);
  const seriesId = text(params.get("series_id"));
  const vid = text(params.get("vid"));
  const level = text(params.get("level")).toLocaleLowerCase();
  if (!/^\d{6,}$/.test(seriesId) || !/^\d{6,}$/.test(vid)) return null;
  if (!QUALITY_OPTIONS.some((item) => item.level === level)) return null;
  return { seriesId, vid, level };
}

function videoDefinition(item) {
  return text(item && ((item.video_meta && item.video_meta.definition) || item.definition)).toLocaleLowerCase();
}

function definitionRank(value) {
  const match = text(value).match(/(\d{3,4})/);
  return match ? Number(match[1]) : 0;
}

function chooseVideo(videos, requestedLevel) {
  const candidates = asArray(videos).filter((item) => /^https?:\/\//i.test(text(item && (item.main_url || item.backup_url))));
  const exact = candidates.find((item) => videoDefinition(item) === requestedLevel);
  if (exact) return exact;
  return candidates.sort((a, b) => {
    const sizeDifference = Number((b && b.video_meta && b.video_meta.size) || 0) - Number((a && a.video_meta && a.video_meta.size) || 0);
    return sizeDifference || definitionRank(videoDefinition(b)) - definitionRank(videoDefinition(a));
  })[0] || null;
}

async function home(params, context) {
  const classes = await getClasses();
  try {
    const items = await loadWebsiteItems({ gender: 2, sortType: 1 });
    return { class: classes, list: pageResult(items, 1).list };
  } catch (error) {
    await log("error", `[home] ${error.message}`);
    return { class: classes, list: [] };
  }
}

async function category(params, context) {
  const page = pageNumber(params && (params.page || params.pg));
  const categoryId = text(params && (params.categoryId || params.type_id || params.tid || params.id)) || "推荐榜";
  try {
    const spec = await resolveCategory(categoryId);
    const items = await loadWebsiteItems(spec);
    return pageResult(items, page);
  } catch (error) {
    await log("error", `[category] ${error.message}`);
    return pageResult([], page);
  }
}

async function search(params, context) {
  const keyword = text(params && (params.keyword || params.wd || params.key));
  const page = pageNumber(params && (params.page || params.pg));
  if (!keyword) return pageResult([], page);

  try {
    const primaryResults = await Promise.allSettled([
      loadWebsiteItems({ gender: 2, sortType: 1 }),
      loadWebsiteItems({ gender: 2, sortType: 2 }),
    ]);
    let candidates = primaryResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    let ranked = rankSearchResults(candidates, keyword);

    if (!ranked.length) {
      const fallbackResults = await Promise.allSettled([
        loadWebsiteItems({ gender: 1, sortType: 2 }),
        loadWebsiteItems({ gender: 0, sortType: 2 }),
      ]);
      candidates = candidates.concat(fallbackResults.flatMap((result) => result.status === "fulfilled" ? result.value : []));
      ranked = rankSearchResults(candidates, keyword);
    }
    return pageResult(ranked, page);
  } catch (error) {
    await log("error", `[search] ${error.message}`);
    return pageResult([], page);
  }
}

async function detail(params, context) {
  const rawId = params && (params.videoId || params.id || params.ids);
  const seriesId = extractSeriesId(rawId);
  if (!seriesId) return { list: [] };

  try {
    const data = await loadSeriesDetail(seriesId);
    return {
      list: [{
        vod_id: new URLSearchParams({ series_id: seriesId }).toString(),
        vod_name: data.name,
        vod_pic: data.cover,
        vod_actor: data.actors.join(", "),
        type_name: data.tags.join(", "),
        vod_remarks: data.remarks,
        vod_content: data.intro,
        vod_play_sources: playSources(data),
      }],
    };
  } catch (error) {
    await log("error", `[detail] ${error.message}`);
    return { list: [] };
  }
}

async function play(params, context) {
  const parsed = parsePlayId(params && (params.playId || params.id));
  if (!parsed) return { parse: 0, urls: [], header: {} };

  try {
    const payload = await requestAppJson(
      "/novel/player/multi_video_model/v1/",
      appPlayBody(parsed.vid),
    );
    const data = payload && payload.data;
    const entry = data && (data[parsed.vid] || Object.values(data)[0]);
    const rawModel = entry && (entry.video_model || entry);
    const model = typeof rawModel === "string" ? JSON.parse(rawModel) : rawModel;
    const selected = chooseVideo(model && model.video_list, parsed.level);
    if (!selected) throw new Error("播放接口未返回有效视频地址");

    const displayName = text(params && params.flag) || parsed.level.toUpperCase();
    const urls = uniqueBy([
      { name: displayName, url: text(selected.main_url) },
      { name: `${displayName}备用`, url: text(selected.backup_url) },
    ].filter((item) => /^https?:\/\//i.test(item.url)), (item) => item.url);

    return {
      parse: 0,
      urls,
      header: {
        "User-Agent": APP_USER_AGENT,
        Accept: "*/*",
      },
    };
  } catch (error) {
    await log("error", `[play] ${error.message}`);
    return { parse: 0, urls: [], header: {} };
  }
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

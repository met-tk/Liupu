const ZIP32_MAX = 0xffffffff;
const ZIP_MAX_ENTRIES = 0xffff;
const DEFAULT_MAX_BYTES = 600 * 1024 * 1024;
const utf8 = new TextEncoder();

/** Output frames sample score time at a fixed cadence; the range end is exclusive. */
export function createFramePlan({ start, end, speed = 1, fps = 30 } = {}) {
  if (![start, end, speed, fps].every(Number.isFinite)) {
    throw new TypeError('导出时间、倍率和帧率必须是有限数字。');
  }
  if (start < 0 || end <= start) throw new RangeError('导出结束时间必须大于开始时间。');
  if (speed < 0.5 || speed > 1.5) throw new RangeError('导出倍率须在 0.5–1.5 之间。');
  if (fps !== 30 && fps !== 60) throw new RangeError('PNG 序列支持 30 或 60 fps。');
  const duration = (end - start) / speed;
  const rawCount = duration * fps;
  // Decimal input can leave an integer frame count a few ULPs above its boundary.
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, rawCount, (Math.abs(start) + Math.abs(end)) * fps / speed) * 8);
  const frameCount = Math.max(1, Math.ceil(rawCount - tolerance));
  if (!Number.isSafeInteger(frameCount)) throw new RangeError('导出区间过长。');
  return Object.freeze({
    start, end, speed, fps, duration, frameCount,
    frameAt(index) {
      if (!Number.isInteger(index) || index < 0 || index >= frameCount) {
        throw new RangeError('帧编号超出导出区间。');
      }
      const outputTime = index / fps;
      const scoreTime = start + outputTime * speed;
      if (scoreTime >= end) throw new RangeError('时间精度不足，请缩小导出区间。');
      return { index, scoreTime, outputTime };
    },
  });
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function fileNameBytes(name) {
  if (typeof name !== 'string' || !name || /[\\:\u0000-\u001f\u007f]/u.test(name)
      || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new TypeError('ZIP 文件名必须是安全的相对路径。');
  }
  const bytes = utf8.encode(name);
  if (bytes.length > 0xffff) throw new RangeError('ZIP 文件名过长。');
  return bytes;
}

function localHeader(name, size, crc) {
  const bytes = new Uint8Array(30 + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true); // Version 2.0, STORE, UTF-8 names.
  view.setUint16(6, 0x0800, true);
  view.setUint16(12, 0x0021, true); // Deterministic DOS date: 1980-01-01.
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  bytes.set(name, 30);
  return bytes;
}

function centralHeader(name, size, crc, offset) {
  const bytes = new Uint8Array(46 + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(14, 0x0021, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint32(42, offset, true);
  bytes.set(name, 46);
  return bytes;
}

/** PNG data is already compressed. STORE avoids a second compression pass. */
export function createZipWriter({ maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 22 || maxBytes > ZIP32_MAX) {
    throw new RangeError('ZIP 容量上限必须在 22 字节至 ZIP32 上限之间。');
  }
  let localBytes = 0;
  let centralBytes = 0;
  let busy = false;
  let result;
  const parts = [];
  const central = [];
  const names = new Set();
  return {
    get bytes() { return localBytes + centralBytes + 22; },
    get entryCount() { return names.size; },
    async add(name, data) {
      if (result) throw new Error('ZIP 已完成，不能再添加文件。');
      if (busy) throw new Error('请逐个等待 ZIP 文件写入完成。');
      const encodedName = fileNameBytes(name);
      if (names.has(name)) throw new Error('ZIP 中已存在同名文件。');
      if (names.size >= ZIP_MAX_ENTRIES) throw new RangeError('文件数量超过 ZIP32 上限。');
      if (!(data instanceof Uint8Array) && !(data instanceof Blob)) {
        throw new TypeError('ZIP 文件内容必须是 Uint8Array 或 Blob。');
      }
      const size = data instanceof Blob ? data.size : data.byteLength;
      const newLocal = localBytes + 30 + encodedName.length + size;
      const newCentral = centralBytes + 46 + encodedName.length;
      if (size > ZIP32_MAX || newLocal + newCentral + 22 > maxBytes) {
        throw new RangeError('PNG 序列超过导出容量上限，请缩短区间或降低分辨率。');
      }
      busy = true;
      try {
        // Snapshot mutable arrays before the first await; Blob inputs are immutable.
        const payload = data instanceof Blob ? data : new Blob([data]);
        const crc = crc32(new Uint8Array(await payload.arrayBuffer()));
        parts.push(localHeader(encodedName, size, crc), payload);
        central.push(centralHeader(encodedName, size, crc, localBytes));
        names.add(name);
        localBytes = newLocal;
        centralBytes = newCentral;
      } finally {
        busy = false;
      }
    },
    finish() {
      if (busy) throw new Error('请等待当前 ZIP 文件写入完成。');
      if (result) return result;
      const end = new Uint8Array(22);
      const view = new DataView(end.buffer);
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, names.size, true);
      view.setUint16(10, names.size, true);
      view.setUint32(12, centralBytes, true);
      view.setUint32(16, localBytes, true);
      result = new Blob([...parts, ...central, end], { type: 'application/zip' });
      parts.length = 0;
      central.length = 0;
      return result;
    },
  };
}

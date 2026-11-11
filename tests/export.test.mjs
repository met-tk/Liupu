import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createFramePlan, createZipWriter } from '../src/export.mjs';

test('frame plans map output time to a selected score range at both frame rates', () => {
  for (const fps of [30, 60]) for (const speed of [0.5, 1, 1.5]) {
    const plan = createFramePlan({ start: 7.25, end: 10.25, speed, fps });
    assert.equal(plan.duration, 3 / speed);
    assert.equal(plan.frameCount, 3 / speed * fps);
    assert.deepEqual(plan.frameAt(0), { index: 0, scoreTime: 7.25, outputTime: 0 });
    const last = plan.frameAt(plan.frameCount - 1);
    assert.equal(last.outputTime, (plan.frameCount - 1) / fps);
    assert.equal(last.scoreTime, 7.25 + last.outputTime * speed);
    assert.ok(last.scoreTime < 10.25);
    assert.throws(() => plan.frameAt(plan.frameCount), RangeError);
  }
});

test('frame boundaries avoid phantom frames from decimal rounding without losing partial frames', () => {
  assert.equal(createFramePlan({ start: 0.1, end: 0.2, fps: 30 }).frameCount, 3);
  assert.equal(createFramePlan({ start: 0.1, end: 0.4, fps: 30 }).frameCount, 9);
  assert.equal(createFramePlan({ start: 3, end: 3.1, fps: 60 }).frameCount, 6);
  assert.equal(createFramePlan({ start: 0, end: 1 / 30, fps: 30 }).frameCount, 1);
  assert.equal(createFramePlan({ start: 0, end: 1 / 30 + 1e-8, fps: 30 }).frameCount, 2);
  assert.equal(createFramePlan({ start: 0, end: 0.001, fps: 30 }).frameCount, 1);
});

test('invalid frame plans and frame indices are rejected', () => {
  for (const args of [undefined, {}, { start: 0, end: Infinity }, { start: NaN, end: 1 },
    { start: -1, end: 1 }, { start: 1, end: 1 }, { start: 2, end: 1 },
    { start: 0, end: 1, speed: 0.49 }, { start: 0, end: 1, speed: 1.51 },
    { start: 0, end: 1, fps: 24 }, { start: '0', end: 1 },
    { start: 0, end: Number.MAX_VALUE }]) {
    assert.throws(() => createFramePlan(args));
  }
  const plan = createFramePlan({ start: 0, end: 1 });
  for (const index of [-1, 0.5, NaN, 30, '0']) assert.throws(() => plan.frameAt(index));
});

test('short exports later in a score do not gain a frame from subtracting decimal endpoints', () => {
  for (const start of [38.5, 1000.5]) for (const fps of [30, 60]) {
    const plan = createFramePlan({ start, end: start + .2, fps });
    assert.equal(plan.frameCount, fps / 5);
    assert.ok(plan.frameAt(plan.frameCount - 1).scoreTime < plan.end);
    assert.equal(createFramePlan({ start, end: start + .2 + 1e-8, fps }).frameCount, fps / 5 + 1);
  }
});

async function exampleZip() {
  const writer = createZipWriter();
  await writer.add('frame_000001.png', new Uint8Array([0, 1, 128, 255]));
  await writer.add('说明/序列.json', new Blob(['123456789']));
  await writer.add('empty.txt', new Uint8Array());
  return { writer, blob: writer.finish() };
}

test('ZIP headers, UTF-8 names, known CRC, offsets and deterministic metadata are valid', async () => {
  const { writer, blob } = await exampleZip();
  assert.equal(blob.type, 'application/zip');
  assert.equal(writer.bytes, blob.size);
  assert.equal(writer.entryCount, 3);
  assert.equal(writer.finish(), blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 3);
  let centralOffset = view.getUint32(end + 16, true);
  assert.equal(centralOffset + view.getUint32(end + 12, true), end);
  const expected = ['frame_000001.png', '说明/序列.json', 'empty.txt'];
  for (const [index, name] of expected.entries()) {
    assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
    assert.equal(view.getUint16(centralOffset + 8, true), 0x800);
    assert.equal(view.getUint16(centralOffset + 10, true), 0);
    assert.equal(view.getUint16(centralOffset + 12, true), 0);
    assert.equal(view.getUint16(centralOffset + 14, true), 0x21);
    const nameLength = view.getUint16(centralOffset + 28, true);
    assert.equal(new TextDecoder().decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength)), name);
    const localOffset = view.getUint32(centralOffset + 42, true);
    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    assert.equal(view.getUint16(localOffset + 6, true), 0x800);
    assert.equal(view.getUint16(localOffset + 8, true), 0);
    assert.equal(view.getUint16(localOffset + 26, true), nameLength);
    assert.equal(view.getUint32(localOffset + 14, true), view.getUint32(centralOffset + 16, true));
    assert.equal(view.getUint32(localOffset + 18, true), view.getUint32(centralOffset + 20, true));
    if (index === 1) assert.equal(view.getUint32(centralOffset + 16, true), 0xcbf43926);
    if (index === 2) assert.equal(view.getUint32(centralOffset + 16, true), 0);
    centralOffset += 46 + nameLength;
  }
  assert.equal(centralOffset, end);
  const repeated = await exampleZip();
  assert.deepEqual(new Uint8Array(await repeated.blob.arrayBuffer()), bytes);
  await assert.rejects(writer.add('late.png', new Uint8Array()), /已完成/);
});

test('ZIP writer rejects unsafe names, duplicates and capacity overflow without corrupting prior data', async () => {
  const writer = createZipWriter({ maxBytes: 200 });
  for (const name of ['', '../frame.png', 'a/../frame.png', '/frame.png', 'C:/frame.png',
    'a\\frame.png', 'a//frame.png', './frame.png', 'frame\u0000.png', 'a/']) {
    await assert.rejects(writer.add(name, new Uint8Array()));
  }
  await assert.rejects(writer.add('frame.png', 'bad type'));
  await writer.add('frame.png', new Uint8Array([1]));
  await assert.rejects(writer.add('frame.png', new Uint8Array()), /同名/);
  await assert.rejects(writer.add('next.png', new Uint8Array(100)), /容量/);
  assert.equal(writer.entryCount, 1);
  assert.equal(writer.bytes, writer.finish().size);
  for (const maxBytes of [21, 22.5, Infinity, NaN, 0x100000000]) {
    assert.throws(() => createZipWriter({ maxBytes }));
  }
  assert.equal(createZipWriter({ maxBytes: 22 }).finish().size, 22);
});

test('ZIP writes snapshot mutable arrays and require sequential completion', async () => {
  const writer = createZipWriter();
  const data = new Uint8Array([1, 2, 3]);
  const pending = writer.add('a', data);
  data.fill(0);
  assert.throws(() => writer.finish(), /等待/);
  await assert.rejects(writer.add('b', new Uint8Array()), /逐个/);
  await pending;
  const bytes = new Uint8Array(await writer.finish().arrayBuffer());
  assert.deepEqual(bytes.slice(31, 34), new Uint8Array([1, 2, 3]));
});

test('Python zipfile independently opens and checks all ZIP entries', async context => {
  const commands = [['python', []], ['python3', []], ['py', ['-3']]];
  const python = commands.find(([command, prefix]) => {
    const probe = spawnSync(command, [...prefix, '-c', 'import sys; print(sys.version_info.major)'], { encoding: 'utf8', timeout: 5000 });
    return probe.status === 0 && probe.stdout.trim() === '3';
  });
  if (!python) return context.skip('Python 3 未安装，结构及 CRC 测试仍执行。');
  const { blob } = await exampleZip();
  const script = `import io, sys, zipfile
archive = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert archive.testzip() is None
assert archive.namelist() == ['frame_000001.png', '\u8bf4\u660e/\u5e8f\u5217.json', 'empty.txt']
assert archive.read('frame_000001.png') == bytes([0, 1, 128, 255])
assert archive.read('\u8bf4\u660e/\u5e8f\u5217.json') == b'123456789'
assert archive.read('empty.txt') == b''
assert all(info.compress_type == zipfile.ZIP_STORED for info in archive.infolist())
assert all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in archive.infolist())
print('valid')`;
  const read = spawnSync(python[0], [...python[1], '-c', script], {
    input: new Uint8Array(await blob.arrayBuffer()), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout.trim(), 'valid');
});

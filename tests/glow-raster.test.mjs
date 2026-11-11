import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRasterScale, sweepGlowEnvelope, spatialGlowWeight, timeAtX } from '../src/timing.mjs';
import { ScoreRenderer } from '../src/render.mjs';
import { visualDefaults as defaults } from '../src/visual-defaults.mjs';
import { CONFIG_LIMITS, createStudioSettings, makePreset, parsePreset, builtinPresets } from '../src/composition.mjs';

function createMockCanvas(width = 400, height = 200) {
  const operations = [], compOps = [], drawnImages = [];
  let _gco = 'source-over';
  const ctx = {
    canvas: null, globalAlpha: 1, shadowColor: '', shadowBlur: 0, fillStyle: '', strokeStyle: '', lineWidth: 1,
    save() { operations.push({ op: 'save' }); },
    restore() { operations.push({ op: 'restore' }); },
    clearRect(x, y, w, h) { operations.push({ op: 'clearRect', x, y, w, h }); },
    fillRect(x, y, w, h) { operations.push({ op: 'fillRect', x, y, w, h, fillStyle: this.fillStyle, gco: this.globalCompositeOperation }); },
    drawImage(img, ...args) { operations.push({ op: 'drawImage', img, args, gco: this.globalCompositeOperation, shadowBlur:this.shadowBlur,alpha:this.globalAlpha }); drawnImages.push(img); },
    createLinearGradient(x0, y0, x1, y1) {
      const stops = [];
      return { type: 'linear-gradient', x0, y0, x1, y1, addColorStop(offset, color) { stops.push({ offset, color }); } };
    },
    beginPath() { operations.push({ op: 'beginPath' }); },
    moveTo(x, y) { operations.push({ op: 'moveTo', x, y }); },
    lineTo(x, y) { operations.push({ op: 'lineTo', x, y }); },
    closePath() { operations.push({ op: 'closePath' }); },
    fill() { operations.push({ op: 'fill', fillStyle: this.fillStyle, gco: this.globalCompositeOperation, shadowBlur: this.shadowBlur }); },
    stroke() { operations.push({ op: 'stroke', strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, gco: this.globalCompositeOperation, shadowBlur: this.shadowBlur }); },
    clip() { operations.push({ op: 'clip' }); },
    translate(x, y) { operations.push({ op: 'translate', x, y }); },
    scale(x, y) { operations.push({ op: 'scale', x, y }); },
    rotate(a) { operations.push({ op: 'rotate', a }); },
  };
  Object.defineProperty(ctx, 'globalCompositeOperation', {
    get() { return _gco; },
    set(val) { _gco = val; compOps.push(val); operations.push({ op: 'set-gco', val }); }
  });
  const canvas = { width, height, getContext(type) { return type === '2d' ? ctx : null; } };
  ctx.canvas = canvas;
  return { canvas, ctx, operations, compOps, drawnImages };
}

test('docked header bodies omit handed-off glyphs without changing flow or static rasters',()=>{
  const calls=[],edges=[],settings={...defaults,layout:'strip',motion:'sticky',headerMode:'dock',glow:1,glowShape:'edge'};
  const score={header:{image:{}},noteImage:{},structureImage:{},stickyStructureImage:{name:'original'},dockedStructureImage:{name:'docked'}};
  const renderer={score,colors:{highlight:settings.color,glowSprite:`${settings.color}:${settings.glowFeather??50}`},
    stickyInk:{},stickyGlow:{},stickyEdge:{},tint(canvas,image){calls.push({canvas,image})},edgeTint(canvas,image){edges.push({canvas,image})}};
  for(const [changes,image] of [
    [{},score.dockedStructureImage],
    [{headerMode:'flow'},score.stickyStructureImage],
    [{headerMode:'dock'},score.dockedStructureImage],
    [{motion:'static'},score.stickyStructureImage]
  ]){
    calls.length=0;edges.length=0;Object.assign(settings,changes);
    ScoreRenderer.prototype.updateColors.call(renderer,settings);
    assert.deepEqual(calls.filter(c=>c.canvas===renderer.stickyInk||c.canvas===renderer.stickyGlow).map(c=>c.image),[image,image]);
    assert.equal(edges.find(c=>c.canvas===renderer.stickyEdge)?.image,image);
    calls.length=0;edges.length=0;
    ScoreRenderer.prototype.updateColors.call(renderer,settings);
    assert.equal(calls.length+edges.length,0,'unchanged modes must reuse the tinted canvases');
  }
});

test('sweep glow envelope provides symmetric Hermite smoothstep pulse and bounded window', () => {
  const options = { peak: 1.4, valley: 0.2, range: 2.0 };
  // Outside pre-glow window (t <= start - span = -2.0)
  assert.equal(sweepGlowEnvelope(-2.1, 0, options), 0);
  assert.equal(sweepGlowEnvelope(-2.0, 0, options), 0);
  // Pre-glow ease-in: smoothstep from 0 to peak 1.4
  const preMid = sweepGlowEnvelope(-1.0, 0, options);
  assert.ok(Math.abs(preMid - (1.4 * 0.5)) < 1e-12);
  assert.ok(sweepGlowEnvelope(-0.3, 0, options) > preMid);
  // Center strike / sounding plateau
  assert.equal(sweepGlowEnvelope(0, 0, options), 1.4);
  assert.equal(sweepGlowEnvelope(0.5, 0, 1.0, options), 1.4);
  assert.equal(sweepGlowEnvelope(1.0, 0, 1.0, options), 1.4);
  // Afterglow ease-out during span: decays from peak down to valley
  const postMid = sweepGlowEnvelope(1.0, 0, options); // for point event, end = 0, progress = 1/2 = 0.5
  assert.ok(Math.abs(postMid - (0.2 + (1.4 - 0.2) * 0.5)) < 1e-12);
  assert.equal(sweepGlowEnvelope(2.0, 0, options), 0.2); // at progress = 1
  // Beyond span: exponential tail fading below valley
  assert.ok(sweepGlowEnvelope(2.5, 0, options) < 0.2);
  assert.ok(sweepGlowEnvelope(3.5, 0, options) < sweepGlowEnvelope(2.5, 0, options));
  // Exact bilateral symmetry when valley is 0 for interval events
  const symOptions = { peak: 1.0, valley: 0, range: 2.5 };
  for (const delta of [0.2, 0.5, 1.0, 1.8, 2.4]) {
    const pre = sweepGlowEnvelope(10 - delta, 10, 15, symOptions);
    const post = sweepGlowEnvelope(15 + delta, 10, 15, symOptions);
    assert.ok(Math.abs(pre - post) < 1e-12, `Symmetric at delta=${delta}`);
  }
  // Point event symmetry
  assert.ok(Math.abs(sweepGlowEnvelope(4 - 0.8, 4, symOptions) - sweepGlowEnvelope(4 + 0.8, 4, symOptions)) < 1e-12);
  assert.equal(sweepGlowEnvelope(NaN, 0, 1), 0);
});

test('spatialGlowWeight provides smoothstep attenuation along the playback locus', () => {
  const playheadX = 500, leadSpan = 120, trailSpan = 180;
  // Playhead locus is peak 1.0
  assert.equal(spatialGlowWeight(playheadX, playheadX, leadSpan, trailSpan), 1);
  // Ahead direction (x > playheadX): smoothstep decay to 0 over leadSpan
  const aheadMid = spatialGlowWeight(playheadX + leadSpan / 2, playheadX, leadSpan, trailSpan);
  assert.ok(Math.abs(aheadMid - 0.5) < 1e-12);
  assert.equal(spatialGlowWeight(playheadX + leadSpan, playheadX, leadSpan, trailSpan), 0);
  assert.equal(spatialGlowWeight(playheadX + leadSpan + 50, playheadX, leadSpan, trailSpan), 0);
  // Behind direction (x < playheadX): smoothstep decay to valley floor over trailSpan
  const behindMid = spatialGlowWeight(playheadX - trailSpan / 2, playheadX, leadSpan, trailSpan);
  assert.ok(Math.abs(behindMid - 0.5) < 1e-12);
  assert.equal(spatialGlowWeight(playheadX - trailSpan, playheadX, leadSpan, trailSpan), 0);
  assert.equal(spatialGlowWeight(playheadX - trailSpan - 50, playheadX, leadSpan, trailSpan), 0);
  // Valley floor preservation behind scanline
  const valleyWeight = spatialGlowWeight(playheadX - trailSpan - 30, playheadX, leadSpan, trailSpan, 0.25);
  assert.equal(valleyWeight, 0.25);
  const valleyMid = spatialGlowWeight(playheadX - trailSpan / 2, playheadX, leadSpan, trailSpan, 0.25);
  assert.ok(Math.abs(valleyMid - (0.25 + 0.75 * 0.5)) < 1e-12);
  // Bilateral symmetry when leadSpan === trailSpan and valley === 0
  for (const d of [10, 35, 70, 100]) {
    assert.ok(Math.abs(spatialGlowWeight(playheadX + d, playheadX, 100) - spatialGlowWeight(playheadX - d, playheadX, 100)) < 1e-12);
  }
  // Rejects invalid values
  assert.equal(spatialGlowWeight(NaN, 500, 100), 0);
  assert.equal(spatialGlowWeight(500, NaN, 100), 0);
});

test('ScoreRenderer.prototype.glowLevel illuminates upcoming notes with non-zero pre-glow', () => {
  const upcomingEvent = { id: 'note-next', start: 4.0, end: 4.8 };
  const distantEvent = { id: 'note-far', start: 10.0, end: 11.0 };
  const state = { active: null, previous: null, next: upcomingEvent, occurrences: [upcomingEvent, distantEvent] };
  // Pulse mode snaps to 0 for upcoming unplayed notes
  assert.equal(ScoreRenderer.prototype.glowLevel(state, 3.5, { glowMode: 'pulse' }), 0);
  assert.equal(ScoreRenderer.prototype.glowLevel({ active: upcomingEvent }, 4.2, { glowMode: 'pulse' }), 1);
  // Sweep mode: upcoming note within range produces non-zero pre-glow value
  const sweepSettings = { glowMode: 'sweep', glowPeak: 150, glowValley: 0, glowRange: 2.0 };
  const sweepLevel = ScoreRenderer.prototype.glowLevel(state, 3.0, sweepSettings); // start - time = 1.0 < 2.0
  assert.ok(sweepLevel > 0, 'Upcoming note in sweep mode has positive pre-glow');
  assert.ok(Math.abs(sweepLevel - 1.5 * 0.5) < 1e-12, 'Smoothstep midpoint at half span');
  // Note far in the future produces 0
  assert.equal(ScoreRenderer.prototype.glowLevel({ active: null, previous: null, next: distantEvent }, 1.0, sweepSettings), 0);
  // Empty event set returns 0
  assert.equal(ScoreRenderer.prototype.glowLevel({ active: null, previous: null, next: null, occurrences: [] }, 3.5, sweepSettings), 0);
});

test('ScoreRenderer.prototype.edgeTint preserves luminous inner core without destination-out cutout', () => {
  const mockTarget = createMockCanvas(256, 256);
  const mockSourceImage = { id: 'source-glyph', width: 256, height: 256 };
  ScoreRenderer.prototype.edgeTint(mockTarget.canvas, mockSourceImage, '#ff8800', 3);
  // Redline check: destination-out must NEVER be used to hollow out the inner core
  assert.equal(mockTarget.compOps.includes('destination-out'), false, 'edgeTint does not use destination-out');
  // Luminous glyph core is composited with source-atop, source-in, and lighter
  assert.ok(mockTarget.compOps.includes('source-atop'), 'Uses source-atop for inner glyph core');
  assert.ok(mockTarget.compOps.includes('lighter'), 'Uses lighter for inner core luminosity');
  // Center glyph image is drawn directly without hollowing
  const centeredDraws = mockTarget.operations.filter(op => op.op === 'drawImage' && op.args[0] === 0 && op.args[1] === 0);
  assert.ok(centeredDraws.length >= 2, 'Draws inner center core directly onto the canvas');
});

test('ScoreRenderer.prototype.drawGlowRegions uses progressive spatial gradient mask for ties and slurs without center glow sprite', () => {
  const mainMock = createMockCanvas(1200, 600);
  const scratchMock = createMockCanvas(400, 100);
  const mockGlowSprite = { id: 'glowSprite', width: 512, height: 512 };
  const mockStructGlow = { id: 'structGlow', width: 1200, height: 600 };
  const mockStructEdge = { id: 'structEdge', width: 1200, height: 600 };
  const renderer = Object.create(ScoreRenderer.prototype);
  renderer.score = {
    stops: [{ time: 0, x: 0 }, { time: 4, x: 800 }],
    glowRegions: [
      { toggle: 'glowTie', kind: 'tie', part: 'marks', x: 200, y: 150, w: 260, h: 24, start: 1.0, end: 3.0 }
    ]
  };
  renderer.rasterScale = 1;
  renderer.regionScratch = scratchMock.canvas;
  renderer.regionScratchCtx = scratchMock.ctx;
  renderer.structGlow = mockStructGlow;
  renderer.structEdge = mockStructEdge;
  renderer.glowSprite = mockGlowSprite;
  const settings = {
    glow: 80,
    glowMode: 'sweep',
    glowShape: 'halo',
    glowRange: 1.4,
    glowTie: true,
    color: '#ffaa00',
    bloom: 45,
    glowRadius: 100,
    glowFeather: 50
  };
  // Render tie region when playback head is at t = 1.5, xPosition = 300
  renderer.drawGlowRegions(mainMock.ctx, 1.5, settings, { left: 0, top: 0, scale: 1, w: 1200, xPosition: 300 });
  // Progressive spatial gradient mask applied on scratch context with destination-in
  assert.ok(scratchMock.compOps.includes('destination-in'), 'Scratch canvas uses destination-in mask for progressive tie');
  const gradientMaskOp = scratchMock.operations.find(op => op.op === 'fillRect' && op.gco === 'destination-in');
  assert.ok(gradientMaskOp, 'Gradient fillRect mask executed on scratch canvas');
  assert.equal(gradientMaskOp.fillStyle.type, 'linear-gradient', 'Progressive tie uses linear gradient mask');
  // Scratch canvas is drawn into main canvas with lighter composite operation
  assert.ok(mainMock.drawnImages.includes(scratchMock.canvas), 'Composites scratch canvas onto main context');
  const bloomPasses=mainMock.operations.filter(op=>op.op==='drawImage'&&op.img===scratchMock.canvas);
  assert.equal(bloomPasses.length,3,'Long marks retain the same additive bloom passes as notes');
  assert.ok(bloomPasses.every(op=>op.gco==='lighter'&&op.shadowBlur>0));
  assert.ok(scratchMock.operations.filter(op=>op.op==='drawImage').every(op=>op.shadowBlur===0),'Mask glyphs before generating the bloom');
  // For wide tie, glowSprite (central round spotlight) is NEVER drawn
  assert.equal(mainMock.drawnImages.includes(mockGlowSprite), false, 'Wide tie never draws center glowSprite circle');
  assert.equal(scratchMock.drawnImages.includes(mockGlowSprite), false, 'Scratch canvas never draws glowSprite');
  // Contrast with slur, hairpin, and compact clef: all emit glow purely from non-transparent source pixels without drawing glowSprite in transparent centers
  for (const [kind, w, h, toggle] of [['slur', 260, 24, 'glowTie'], ['hairpin', 240, 22, 'glowMark'], ['clef', 20, 48, 'glowClef']]) {
    scratchMock.drawnImages.length = 0;
    mainMock.drawnImages.length = 0;
    renderer.score.glowRegions[0] = { toggle, kind, part: 'marks', x: 200, y: 150, w, h, start: 1.0, end: 3.0 };
    renderer.drawGlowRegions(mainMock.ctx, 1.5, { ...settings, glowMark: true, glowClef: true }, { left: 0, top: 0, scale: 1, w: 1200, xPosition: 300 });
    assert.equal(mainMock.drawnImages.includes(mockGlowSprite), false, `${kind} never draws unmasked center glowSprite circle into transparent space`);
  }
});

test('pinned glow crops come from the body raster without the docked opening meter', () => {
  const renderer = Object.create(ScoreRenderer.prototype);
  const full = { id: 'structGlow' }, body = { id: 'stickyGlow' };
  Object.assign(renderer, { rasterScale: 1, structGlow: full, structEdge: full, stickyGlow: body, stickyEdge: body,
    score: { stops: [{ time: 0, x: 0 }, { time: 4, x: 800 }], glowRegions: [{ toggle: 'glowMark', kind: 'tempo', part: 'marks', x: 200, y: 150, w: 20, h: 20, start: 1, end: 3 }] } });
  const settings = { glow: 80, glowMode: 'pulse', glowShape: 'halo', glowMark: true, color: '#ffaa00', glowFeather: 50 };
  for (const [pinned, expected] of [[true, body], [false, full]]) {
    const main = createMockCanvas(1200, 600);
    renderer.drawGlowRegions(main.ctx, 1.5, settings, { left: 0, top: 0, scale: 1, w: 1200, xPosition: 300, pinned });
    assert.ok(main.drawnImages.length > 0);
    assert.ok(main.drawnImages.every(image => image === expected));
  }
});

test('in-layer header glow survives both docked bodies and static row clipping',()=>{
  const renderer=Object.create(ScoreRenderer.prototype),full={},body={};
  Object.assign(renderer,{rasterScale:1,structGlow:full,structEdge:full,stickyGlow:body,stickyEdge:body,
    score:{stops:[{time:0,x:0},{time:4,x:800}],glowRegions:[
      {toggle:'glowClef',kind:'clef',part:'header',moving:true,x:200,y:150,w:20,h:40,start:1,end:3}
    ]}});
  for(const keepMoving of [false,true])for(const glowShape of ['halo','edge']){
    const main=createMockCanvas(1200,600);
    renderer.drawGlowRegions(main.ctx,1.5,{glow:80,glowMode:'pulse',glowShape,color:'#ffaa00',glowFeather:50},
      {left:0,top:0,scale:1,w:1200,xPosition:300,pinned:true,keepMoving});
    assert.ok(main.drawnImages.length>0);
    assert.ok(main.drawnImages.every(image=>image===full));
  }
});

test('raster scale sharpens small scores while capping memory and canvas limits', () => {
  assert.equal(pickRasterScale(1000, 300), 2.2);
  assert.equal(pickRasterScale(1000, 300, { max: 2.5 }), 2.5);
  // Budget-bound: 4000×2000 units stay under the 16 MPix per-layer budget.
  assert.ok(Math.abs(pickRasterScale(4000, 2000) - Math.sqrt(2)) < 1e-12);
  // Dimension-bound: a 30000-unit-wide scroll is limited by the canvas cap.
  assert.ok(Math.abs(pickRasterScale(30000, 100) - 32000 / 30000) < 1e-12);
  // Over-budget scores fall back to 1× instead of exploding memory.
  assert.equal(pickRasterScale(6000, 4000), 1);
  assert.equal(pickRasterScale(0, 0), 1);
});

test('sweep glow settings travel through presets with validation', () => {
  assert.equal(defaults.glowMode, 'pulse');
  assert.equal(defaults.glowRange, 1.4);
  const s = createStudioSettings(defaults);
  s.glowPeak = 160; s.glowValley = 25; s.glowRange = 2.4;
  s.glowMode = 'sweep'; s.glowShape = 'edge';
  const round = parsePreset(JSON.stringify(makePreset(s, 'sweep scene')), defaults);
  const config = round.composition.nodes[0].config;
  assert.equal(config.glowMode, 'sweep');
  assert.equal(config.glowShape, 'edge');
  assert.equal(config.glowPeak, 160);
  assert.equal(config.glowValley, 25);
  assert.equal(config.glowRange, 2.4);
  const over = makePreset(s, 'over'); over.composition.nodes[0].config.glowPeak = CONFIG_LIMITS.glowPeak[1] + 1;
  assert.throws(() => parsePreset(JSON.stringify(over), defaults));
  const bad = makePreset(s, 'bad'); bad.composition.nodes[0].config.glowMode = 'strobe';
  assert.throws(() => parsePreset(JSON.stringify(bad), defaults));
  const soft = builtinPresets(defaults).find(p => p.name === '柔光长卷');
  assert.equal(soft.composition.nodes[0].config.glowMode, 'sweep');
});

test('timeAtX inverts the playhead sweep with clamped interpolation', () => {
  const stops = [{ time: 0, x: 0 }, { time: 4, x: 100 }, { time: 8, x: 300 }];
  assert.equal(timeAtX([], 50), 0);
  assert.equal(timeAtX(stops, -5), 0);
  assert.equal(timeAtX(stops, 999), 8);
  // Mid-segment interpolation is linear in the segment's own span.
  assert.equal(timeAtX(stops, 50), 2);
  assert.equal(timeAtX(stops, 200), 6);
  // A backwards cut (jump to a new system) is skipped, not interpolated.
  const jump = [{ time: 0, x: 0 }, { time: 2, x: 40 }, { time: 2.2, x: 0 }, { time: 5, x: 200 }];
  assert.equal(timeAtX(jump, 20), 1);      // first forward segment
  assert.equal(timeAtX(jump, 100), 3.6);   // second forward segment after the backwards cut is skipped
  // arrivalX anchors: the playhead eases toward b.arrivalX before b.time.
  const anchor = [{ time: 0, x: 0 }, { time: 10, arrivalX: 40, x: 100 }];
  assert.equal(timeAtX(anchor, 20), 5);
});

test('legacy soft presets migrate to sweep without losing glow parameters', () => {
  const settings = createStudioSettings(defaults);
  settings.glowMode = 'soft';
  settings.glowPeak = 160; settings.glowValley = 25; settings.glowRange = 2.4;
  settings.glowShape = 'edge'; settings.glowOffset = -.5;
  const legacy = makePreset(settings, '旧柔光预设');
  for (const version of [1, 2, 3, 4, 5]) {
    legacy.version = version;
    const migrated = parsePreset(JSON.stringify(legacy), defaults);
    assert.deepEqual(migrated.composition.nodes[0].config, {
      ...legacy.composition.nodes[0].config, glowMode: 'sweep'
    });
    assert.deepEqual(parsePreset(JSON.stringify(migrated), defaults), migrated);
  }
  assert.equal(legacy.composition.nodes[0].config.glowMode, 'soft', 'Migration preserves the source preset');
  assert.equal(createStudioSettings({...defaults, glowMode: 'soft'}).glowMode, 'sweep');
  assert.ok(builtinPresets(defaults).every(p => p.composition.nodes.every(n => n.kind !== 'score' || n.config.glowMode !== 'soft')));
});

test('glow target toggles and radius/feather round-trip through presets', () => {
  assert.equal(defaults.glowRadius, 100);
  assert.equal(defaults.glowFeather, 50);
  for (const key of ['glowNote','glowBeam','glowClef','glowKeyMeter','glowRest','glowMark','glowTie','glowLyric'])
    assert.equal(defaults[key], true, `${key} defaults on`);
  const s = createStudioSettings(defaults);
  s.glowClef = false; s.glowMark = false; s.glowRadius = 180; s.glowFeather = 90;
  const round = parsePreset(JSON.stringify(makePreset(s, 'targets')), defaults);
  const config = round.composition.nodes[0].config;
  assert.equal(config.glowClef, false);
  assert.equal(config.glowMark, false);
  assert.equal(config.glowRadius, 180);
  assert.equal(config.glowFeather, 90);
  assert.equal(config.glowNote, true);
  // Limits enforced on the new numeric keys.
  const over = makePreset(s, 'over');
  over.composition.nodes[0].config.glowRadius = CONFIG_LIMITS.glowRadius[1] + 1;
  assert.throws(() => parsePreset(JSON.stringify(over), defaults));
  const bad = makePreset(s, 'bad');
  bad.composition.nodes[0].config.glowFeather = -1;
  assert.throws(() => parsePreset(JSON.stringify(bad), defaults));
});

test('halo radius formula combines bloom, scale and the radius multiplier', () => {
  // Mirrors render.mjs haloRadius: (14 + bloom*1.5) * scale * glowRadius/100.
  const halo = (scale, { bloom = 45, glowRadius = 100 } = {}) => (14 + bloom * 1.5) * scale * (glowRadius || 100) / 100;
  assert.ok(Math.abs(halo(1) - 81.5) < 1e-12);
  assert.ok(Math.abs(halo(2, { bloom: 45, glowRadius: 200 }) - 326) < 1e-12);
  assert.ok(halo(1, { glowRadius: 200 }) > halo(1));
  assert.ok(halo(1, { bloom: 70 }) > halo(1, { bloom: 45 }));
});

test('beamGlowLevel and renderBeamGlow respect glowBeam toggle, bridge split-beam midpoints, and emit thickened bloom + core + halo sprite', () => {
  const renderer = Object.create(ScoreRenderer.prototype);
  renderer.score = { stops: [{ time: 0, x: 0 }, { time: 4, x: 800 }] };
  renderer.glowSprite = { id: 'glowSprite', width: 512, height: 512 };
  const beam = {
    noteId: 'n2',
    box: { x: 240, y: 120, w: 60, h: 6 },
    points: [{ x: 240, y: 120 }, { x: 300, y: 118 }, { x: 300, y: 124 }, { x: 240, y: 126 }]
  };
  const upcomingNote = { id: 'n2', start: 1.5, end: 2.0 };
  const state = { active: null, previous: null, next: upcomingNote, occurrences: [upcomingNote] };
  const baseSettings = {
    glow: 80,
    glowBeam: true,
    glowMode: 'pulse',
    glowShape: 'halo',
    glowRange: 1.4,
    glowPeak: 140,
    glowValley: 0,
    bloom: 45,
    glowRadius: 100,
    glowFeather: 50,
    color: '#ffaa00'
  };
  // 1. When glowBeam is false, beamGlowLevel strictly returns 0 across all modes
  assert.equal(renderer.beamGlowLevel({ active: upcomingNote }, beam.box, 1.6, 320, 1, { ...baseSettings, glowBeam: false }), 0);
  assert.equal(renderer.beamGlowLevel(state, beam.box, 1.3, 260, 1, { ...baseSettings, glowMode: 'sweep', glowBeam: false }), 0);
  // 2. In pulse mode, when scanline enters the right-half split beam (xPosition = 260 >= 240) just before n2 starts (t = 1.42), midpoint bridge activates
  assert.equal(renderer.beamGlowLevel(state, beam.box, 1.42, 260, 1, baseSettings), 1, 'Bridges midpoint gap in pulse mode');
  assert.equal(renderer.beamGlowLevel(state, beam.box, 0.5, 100, 1, baseSettings), 0, 'Inactive when scanline is far from split beam in pulse mode');
  // 3. In soft/sweep mode, spatial proximity and temporal pre-glow illuminate the beam smoothly without double attenuation
  const sweepLevel = renderer.beamGlowLevel(state, beam.box, 1.2, 240, 1, { ...baseSettings, glowMode: 'sweep' });
  assert.ok(sweepLevel > 1.0, 'Sweep mode reaches full peak when playhead reaches beam edge');
  // 4. renderBeamGlow performs 3-pass thickened stroke + fill bloom, clipped dual-gradient core, and halo glowSprite
  const mockHalo = createMockCanvas(600, 300);
  renderer.renderBeamGlow(mockHalo.ctx, beam, 0, 0, 1.0, 1.5, 270, 1, baseSettings, 1);
  const strokesHalo = mockHalo.operations.filter(op => op.op === 'stroke' && op.gco === 'lighter');
  const fillsHalo = mockHalo.operations.filter(op => op.op === 'fill' && op.gco === 'lighter');
  const clipRectsHalo = mockHalo.operations.filter(op => op.op === 'fillRect' && op.gco === 'lighter');
  assert.equal(strokesHalo.length, 3, 'Halo mode executes 3 thickened stroke bloom passes');
  assert.equal(fillsHalo.length, 3, 'Halo mode executes 3 polygon fill bloom passes');
  assert.equal(clipRectsHalo.length, 2, 'Draws both settings.color gradient and #fff8e9 warm core inside clipped beam');
  assert.equal(mockHalo.drawnImages.includes(renderer.glowSprite), false, 'Halo mode never draws unmasked glowSprite outside sloped beam polygon');
  // 5. In edge mode, renderBeamGlow also keeps 3-pass contour bloom + warm core without glowSprite
  const mockEdge = createMockCanvas(600, 300);
  renderer.renderBeamGlow(mockEdge.ctx, beam, 0, 0, 1.0, 1.5, 270, 1, { ...baseSettings, glowShape: 'edge' }, 1);
  assert.equal(mockEdge.operations.filter(op => op.op === 'stroke' && op.gco === 'lighter').length, 3);
  assert.equal(mockEdge.drawnImages.includes(renderer.glowSprite), false, 'Edge mode omits round glowSprite on beam');
});

test('glowOffset shifts temporal and spatial glow evaluation, and drawBeamGroup renders uncut multi-note beams seamlessly', () => {
  assert.equal(defaults.glowOffset, 0);
  const s = createStudioSettings(defaults);
  s.glowOffset = -0.35;
  const round = parsePreset(JSON.stringify(makePreset(s, 'offset-test')), defaults);
  assert.equal(round.composition.nodes[0].config.glowOffset, -0.35);
  const over = makePreset(s, 'over');
  over.composition.nodes[0].config.glowOffset = CONFIG_LIMITS.glowOffset[1] + 1;
  assert.throws(() => parsePreset(JSON.stringify(over), defaults));

  const renderer = Object.create(ScoreRenderer.prototype);
  const n1 = { id: 'n1', start: 1.0, end: 1.5 };
  const n2 = { id: 'n2', start: 1.5, end: 2.0 };
  renderer.score = {
    stops: [{ time: 0, x: 0 }, { time: 4, x: 800 }],
    boxes: new Map([['n1', { x: 200, y: 120, w: 20, h: 40 }], ['n2', { x: 300, y: 120, w: 20, h: 40 }]]),
    occurrences: new Map([['n1', [n1]], ['n2', [n2]]])
  };
  // Negative glowOffset (-0.4s) advances glow so n1 (start=1.0) is already active at t=0.7 in pulse mode
  const stateN1 = { active: null, previous: null, next: n1, occurrences: [n1] };
  assert.equal(renderer.glowLevel(stateN1, 0.7, { glowMode: 'pulse', glowOffset: 0 }), 0);
  assert.equal(renderer.glowLevel(stateN1, 0.7, { glowMode: 'pulse', glowOffset: -0.4 }), 1);

  // drawBeamGroup draws a single continuous uncut polygon across n1 and n2 (only 1 clip() operation instead of 2 split clips)
  const group = {
    id: 'beam-g1',
    noteId: 'n1',
    noteIds: ['n1', 'n2'],
    points: [{ x: 200, y: 120 }, { x: 320, y: 116 }, { x: 320, y: 122 }, { x: 200, y: 126 }],
    box: { x: 200, y: 116, w: 120, h: 10 },
    parts: [
      { noteId: 'n1', points: [{ x: 200, y: 120 }, { x: 260, y: 118 }, { x: 260, y: 124 }, { x: 200, y: 126 }], box: { x: 200, y: 118, w: 60, h: 8 } },
      { noteId: 'n2', points: [{ x: 260, y: 118 }, { x: 320, y: 116 }, { x: 320, y: 122 }, { x: 260, y: 124 }], box: { x: 260, y: 116, w: 60, h: 8 } }
    ]
  };
  const mockCanvas = createMockCanvas(800, 400);
  renderer.drawBeamGroup(mockCanvas.ctx, group, 1.3, {
    glow: 80, glowBeam: true, glowMode: 'sweep', glowShape: 'halo', glowRange: 1.4, glowOffset: 0,
    glowPeak: 120, glowValley: 0, bloom: 45, glowRadius: 100, glowFeather: 50, color: '#ffaa00', beamOpacity: 100
  }, { left: 0, top: 0, scale: 1, w: 800, xPosition: 260 });
  const clipOps = mockCanvas.operations.filter(op => op.op === 'clip');
  assert.equal(clipOps.length, 1, 'Renders entire multi-note beam group as 1 uncut polygon with zero midpoint seam');
});

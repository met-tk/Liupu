// The AE package is intentionally one-way: render deterministic image
// sequences here, then let After Effects create a composition around them.
const safeManifest = value => JSON.stringify(value).replace(/<\/script/gi, '<\\/script');

export function makeAESetupScript(manifest) {
  const data = safeManifest(manifest);
  return `// 流谱 Studio · After Effects 合成导入脚本
// 运行方式：解压 AE 合成包后，在 AE 中选择 文件 > 脚本 > 运行脚本文件。
(function () {
    var manifest = ${data};
    var root = new File($.fileName).parent;
    function fileFor(relative) {
        if (!relative || relative.charAt(0) === '/' || relative.indexOf('..') >= 0 || /[\\\\:]/.test(relative)) throw new Error('素材路径不安全：' + relative);
        return new File(root.fsName + '/' + relative);
    }
    function layerBlend(layer, mode) {
        try {
            if (mode === 'add') layer.blendingMode = BlendingMode.ADD;
            else if (mode === 'screen') layer.blendingMode = BlendingMode.SCREEN;
            else if (mode === 'multiply') layer.blendingMode = BlendingMode.MULTIPLY;
            else layer.blendingMode = BlendingMode.NORMAL;
        } catch (ignore) {}
    }
    function uniqueCompName(base) {
        var name = base || '流谱合成', found = true, index = 1;
        while (found) {
            found = false;
            for (var i = 1; i <= app.project.numItems; i++) if (app.project.item(i).name === name) { found = true; break; }
            if (found) name = (base || '流谱合成') + ' ' + (++index);
        }
        return name;
    }
    function addMarker(comp, time, comment) {
        try { if (comp.markerProperty) comp.markerProperty.setValueAtTime(time, new MarkerValue(comment)); } catch (ignore) {}
    }
    try {
        if (!manifest || manifest.schema !== 'liupu-ae-package' || manifest.version !== 1) throw new Error('不是受支持的流谱 AE 合成包。');
        var cinfo = manifest.composition;
        if (!cinfo || cinfo.width < 1 || cinfo.height < 1 || cinfo.fps <= 0 || cinfo.duration <= 0) throw new Error('合成参数无效。');
        if (!app.project) app.newProject();
        app.beginUndoGroup('导入流谱 AE 合成包');
        var comp = app.project.items.addComp(uniqueCompName(cinfo.name), cinfo.width, cinfo.height, cinfo.pixelAspect || 1, cinfo.duration, cinfo.fps);
        comp.frameRate = cinfo.fps;
        comp.duration = cinfo.duration;
        for (var i = 0; i < manifest.layers.length; i++) {
            var info = manifest.layers[i], first = fileFor(info.firstFile);
            if (!first.exists) throw new Error('找不到图层首帧：' + info.firstFile);
            var options = new ImportOptions(first);
            options.sequence = true;
            options.forceAlphabetical = true;
            var footage = app.project.importFile(options);
            try { footage.mainSource.conformFrameRate = info.fps || cinfo.fps; } catch (ignore) {}
            try { footage.mainSource.alphaMode = AlphaMode.STRAIGHT; } catch (ignore) {}
            var layer = comp.layers.add(footage);
            layer.name = info.name || info.id || ('流谱图层 ' + (i + 1));
            layer.startTime = 0;
            layer.inPoint = 0;
            layer.outPoint = cinfo.duration;
            layer.enabled = info.enabled !== false;
            layer.comment = '流谱 Studio · ' + (info.role || info.id || 'layer');
            layerBlend(layer, info.blendMode);
        }
        addMarker(comp, 0, '流谱开始 · 源时间 ' + manifest.source.start.toFixed(3) + ' 秒');
        addMarker(comp, cinfo.duration, '流谱结束 · 源时间 ' + manifest.source.endExclusive.toFixed(3) + ' 秒');
        try { app.project.activeItem = comp; } catch (ignore) {}
        try { comp.openInViewer(); } catch (ignore) {}
        app.endUndoGroup();
        alert('流谱 AE 合成已创建：' + comp.name + '\\n' + manifest.layers.length + ' 个图层 · ' + cinfo.fps + ' fps');
    } catch (error) {
        try { app.endUndoGroup(); } catch (ignore) {}
        alert('流谱 AE 合成导入失败：\\n' + (error.message || error));
    }
}());
`;
}

export function makeAEGuide(manifest) {
  const { composition, source, layers } = manifest;
  return `流谱 Studio · After Effects 合成包

这是单向导出包：流谱负责乐谱、时间和基础分层，After Effects 负责后期特效与最终合成。

画布：${composition.width} × ${composition.height} · ${composition.fps} fps · ${composition.frameCount} 帧
源时间：${source.start.toFixed(3)}–${source.endExclusive.toFixed(3)} 秒 · 播放倍率 ${source.speed}
图层：${layers.map(layer => layer.name).join('、')}

快速导入：
1. 完整解压此 ZIP，不要直接在压缩包内运行脚本。
2. 在 After Effects 中选择“文件 > 脚本 > 运行脚本文件”。
3. 选择本目录中的 setup-ae.jsx。
4. 脚本会创建合成、导入所有 PNG 序列、设置帧率、图层顺序和时间标记。
5. 如需声音，请在 AE 中另行导入原始录音，并按时间轴对齐；本包不包含音频。

所有图层保持相同画布尺寸和起始时间。透明图层使用 Straight / Unmatted Alpha。
元素分层是逐帧栅格素材，适合添加 AE 滤镜、辉光、粒子、拖尾和第三方插件；不会回写流谱工程。
`;
}

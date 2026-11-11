# Windows VST3 宿主

这是流谱 Studio 的独立 Windows x64 音频进程。网页将乐谱音符通过本机 Node 服务发送给它；宿主真正加载已安装的 `.vst3` 乐器，并将音频送往 Windows 默认输出设备。插件编辑器在独立桌面窗口中打开。它不依赖 Web MIDI、虚拟 MIDI 线或外部 DAW。

## 使用

1. 在项目根目录运行 `npm run build:native`（或 `node native/build.mjs`），再运行 `npm start`。
2. 在网页「音频」面板导入 VST3 乐器。选择 Windows x64 的 `.vst3` 文件或 `.vst3` 文件夹；插件及其音色库需已安装并有可用授权。
3. 点击打开乐器窗口，在插件自己的界面中选择音色，然后播放乐谱。关闭插件窗口只隐藏编辑器，乐器继续保留；可再次打开。
4. 暂停、定位或切换音源会停止旧音符；卸载乐器会关闭编辑器并释放插件。

当前只使用默认音频输出设备，没有 ASIO 或设备设置面板。不支持 VST2 `.dll`、32 位插件、效果器链、MIDI CC / 踏板演奏解释、插件状态随工程保存。若插件本身需要先加载音色，必须在其窗口里完成后才会发声。第三方插件可能崩溃或卡住；网页服务会报告宿主退出或超时，随后可重新导入。

VST 音频直接由原生宿主输出，尚未送回浏览器，因此不能进入网页 WebM 的音轨。要导出带此插件声音的视频，请在音频软件中渲染对应录音，再导入流谱 Studio 进行对齐和导出。内置采样钢琴继续支持浏览器录制。

## 构建

需要 Node.js 20+、Visual Studio 2022 的「使用 C++ 的桌面开发」、Windows SDK 和 CMake。构建脚本优先使用 Visual Studio 自带 CMake，仅在 `native/` 内生成文件。

```powershell
node native/build.mjs
```

首次构建下载固定的 JUCE 8.0.12 源码压缩包并核对 SHA-256；之后使用本地缓存。输出为 `native/bin/LiupuVSTHost.exe`。Visual Studio 或构建缓存的访问被沙箱限制时，需要允许构建工具访问本机编译环境。无需安装新的音频驱动或插件。

JUCE 提交：`29396c22c93392d6738e021b83196283d6e4d850`。

- 源码：[JUCE 固定提交](https://github.com/juce-framework/JUCE/tree/29396c22c93392d6738e021b83196283d6e4d850)
- 压缩包：[对应源码 ZIP](https://codeload.github.com/juce-framework/JUCE/zip/29396c22c93392d6738e021b83196283d6e4d850)
- ZIP SHA-256：`8714e396c7fa30b692e47529d5e0d8b242e22c937e564410c361e4d443ea1621`
- 本地完整对应源码：`.deps/JUCE-29396c22c93392d6738e021b83196283d6e4d850/`；原始压缩包：`.deps/juce.zip`。

## 检查

```powershell
# 检查进程、协议、默认音频设备、错误处理和退出。
node native/smoke-test.mjs

# 还会实际加载已有插件、打开编辑器并短暂播放三音符；不会修改预设或保存插件状态。
node native/smoke-test.mjs "C:\Program Files\Common Files\VST3\Vital.vst3"
```

已在本机用 Visual Studio 2022 / MSVC 19.44 成功编译，并使用已安装 Vital、RME Fireface UC 默认输出设备（44100 Hz / 441 samples）通过加载、编辑器创建、非零输出采样、停止、静音、力度验证、卸载和 EOF 退出测试。`outputPeak` 是送往音频设备的浮点采样峰值，不能证明扬声器物理出声，也不代替人工听音。第三方插件的广泛兼容性尚未测试。

2026-10-23 在正常 Windows 桌面进程补充核验：桌面工具识别到独立的 Vital 窗口及原生关闭按钮；实际点击关闭后 `loaded=true / editorOpen=false`，再次调用 `showEditor` 后同一窗口恢复可访问。首次导入的文件选择器也能在桌面出现并成功返回 Vital 实例。沙箱启动的窗口不在交互桌面可见范围内，验证时采用正常桌面进程。最终截图未保留：自动审批因可能夹带无关桌面内容拒绝截图，后续只读取该窗口的可访问控件及宿主状态；未检查插件全部内部控件或进行人工听音。

## 进程协议

宿主 stdin / stdout 使用一行一个 UTF-8 JSON；诊断输出使用 stderr。每条请求含 `id` 和 `action`，响应含相同 `id`、`ok`、`loaded`、`name`、`editorOpen`、`hasEditor`、`playing`、`sampleRate`、`blockSize`、`device`、`outputPeak`、`startDelay`、`error`。

| action | 附加字段 | 行为 |
| --- | --- | --- |
| `status` | 无 | 当前状态 |
| `load` | 通常无 | 打开选择器，载入文件中的首个乐器组件 |
| `showEditor` | 无 | 打开或显示乐器自带编辑器 |
| `unload` | 无 | 停音并释放插件 |
| `play` | `events`、`volume`、`startDelay` | 音符数组的 `start/end` 为相对此次起播的秒数，`pitch` 为 0–127，`velocity` 为 1–127 整数；`volume` 为 0–1，`startDelay` 默认 0.15 秒 |
| `stop` | 无 | 清除事件，发送踏板复位、All Notes Off 和 All Sound Off |
| `volume` | `volume` | 设置 0–1 输出音量 |

测试可以在直接 stdin 请求中传 `load.path`，网页 HTTP 接口会移除此字段，正常导入使用桌面选择器。宿主不开放任何网络端口。音符用音频采样时钟调度；UI 与管道处理不进入音频回调。宿主与网页的开始时刻使用短暂延迟同步，目前不是跨进程采样精确同步。stdin 关闭后宿主退出。

## 许可证和分发

本目录的宿主代码与构建/测试脚本采用 **AGPL-3.0-only**，全文见 [LICENSE.txt](LICENSE.txt)。JUCE 8.0.12 提供 AGPLv3 与商业许可，本次构建明确使用其 AGPLv3 选项，未购买、接受或使用商业许可。JUCE 的原始许可与依赖清单见 [JUCE-LICENSE.md](JUCE-LICENSE.md)，其内置 VST3 SDK 的 MIT 许可见 [VST3-LICENSE.txt](VST3-LICENSE.txt)。其他编入 JUCE 的第三方组件许可保留在完整 JUCE 源码相应目录中。

交付或发布该宿主二进制时，应同时向接收者提供完整对应源码和构建说明，包括本目录源码、固定版本 JUCE 完整源码及许可证；仅附下载链接不能代替所有分发情形下的源码义务。`.deps/` 与 `bin/` 被 Git 忽略，不会因提交本项目自动一同分发。若要把宿主集成进闭源产品，需要先处理 JUCE 商业许可或更换许可兼容的实现。独立进程和 JSON 协议本身不构成免除 AGPL 义务的保证；此说明不擅自改变项目其他现有文件的许可证。

本项目不分发用户的 VST3 插件和音色库；它们各自的授权仍由各厂商决定。

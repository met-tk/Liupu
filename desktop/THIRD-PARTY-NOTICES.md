# 流谱 Studio · 第三方许可与对应源码

## VST3 宿主与 JUCE

独立宿主 LiupuVSTHost 使用 AGPL-3.0-only。本次构建选用 JUCE 8.0.12 的 AGPLv3 选项，不包含商业许可证。完整宿主代码及构建脚本位于 `native-source/`；固定版本 JUCE 原始完整源码在 `native-source/.deps/juce.zip`，SHA256 见 `build-manifest.json`。

重编译：将 `native-source` 复制到可写位置，在 Windows x64 上安装 Node.js 与 Visual Studio 2022 C++ 桌面工具后，执行 `node build.mjs`。脚本会从随附 `.deps/juce.zip` 解压源码，无需重新下载 JUCE。生成的 `bin/LiupuVSTHost.exe` 可替换安装目录 `resources/native/LiupuVSTHost.exe`。

AGPL 全文见 `native-source/LICENSE.txt`，JUCE 原许可见 `JUCE-LICENSE.md`，VST3 SDK MIT 许可见 `VST3-LICENSE.txt`。JUCE 编入的其他第三方组件许可保留在源码 ZIP 各目录。独立进程并不自动免除 AGPL 的分发义务；这些说明不改变项目其余现有文件的许可证。

## Verovio 6.3.0

采用 LGPL-3.0-or-later，未经修改的模块独立位于 `resources/web/vendor/`，允许替换为接口兼容的修改版本。完整对应源码 `verovio/verovio-6.3.0-source.zip`，许可证全文 `verovio/COPYING.LESSER` 和 `verovio/COPYING`。源码包的 `emscripten/` 含 WebAssembly 构建配置及 JavaScript 包装层；使用 Emscripten 构建，参考源码中的说明。字体及资源许可保留在源码的 `data/` 目录。对这些 LGPL 组件的修改、替换及为调试这些修改而进行的逆向工程不受本项目限制。

上游：https://github.com/rism-digital/verovio/tree/version-6.3.0

## Salamander Grand Piano V3

Alexander Holm 录制的 Yamaha C5，CC BY 3.0。音频取自 tambien/Piano 的 MP3 转码，只选择 30 个音高 × 三个力度层，未包含完整 16 层原库。来源、原始说明、完整许可、逐文件 SHA256 见 `piano/` 及 `resources/web/assets/piano/`。

## Electron

Electron 44.9.1 及其 Chromium、Node.js 等组件的许可随运行时保留在安装根目录的 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`。

本包不包含任何用户安装的 VST3 乐器或商业音色库。

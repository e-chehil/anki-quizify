**使用前，请仔细阅读本说明，下载链接见结尾处。**

# Anki Quizify

Anki Quizify 是一个 Anki 加载项和卡片模板项目。它让你在 Anki 的 `Front` / `Back` 字段里直接写 Markdown，并在复习卡片中渲染为交互式题型，例如填空、单选、多选、折叠块、标签页、批注、揭示答案、随机遮罩背诵、音频播放器、代码高亮和 KaTeX 数学公式。

当前主线实现位于 `quizify_addon/`。仓库根目录的旧模板和资源已经退役：`front.html` / `back.html` 只保留失败关闭的迁移提示，旧 `_myquizify.js` / `_styles.css` 不再提供；实际加载项只使用 `quizify_addon/templates/`、`quizify_addon/_quizify.js` 和 `quizify_addon/_quizify.css`。

当前版本为 **1.2.0**。本版在 1.1.0 的中、英、俄国际化与统一 SVG 图标系统基础上完成发布前视觉收尾：拉开上下相邻填空及其聚焦外框，精简卡片批注与揭示题型图形，并隔离 Anki WebView 对插件按钮与卡片背景的样式注入。批注气泡现按真实可见区域稳定定位；开务 / 格致背景不再受 reviewer 的 `body.card` 与 `background-position-y` 切割；Android 的三种夜间类名、选择题暗色变量和触屏悬停状态也已统一。插件继续自动跟随 Anki 界面语言，未知语言回退英文；批量导入、媒体安全、KaTeX 公式保护与双主题等既有能力保持不变。

面向用户的发布说明可见 [`docs/release-description.md`](docs/release-description.md)。

## 功能概览

- 自动创建或刷新 `Quizify Markdown` 笔记类型。
- 笔记类型包含 `Front` 和 `Back` 两个纯文本字段。
- 支持 Markdown、代码高亮、行号、KaTeX 公式。
- 支持 Quizify 扩展语法：
  - `{{答案}}` 填空题
  - `;;; ... ;;;A` 单选或多选题
  - `[[题干||答案]]` 点击揭示
  - `[术语]^(解释)^` 批注
  - `::: 标题 ... :::` 折叠块
  - `=== 标签 ... ===` 标签页
  - `!audio[标题](文件名.mp3)` 音频播放器
  - `:::: recite ... ::::` 随机遮罩背诵
  - `==重点==` 高亮、`X^2^` 上标、`H~2~O` 下标
  - `> [!WARNING]` GitHub 风格提示框
- 自动把有子层级的 Markdown 列表增强为 Workflowy 风格大纲，每个父项可独立展开或收起。
- 在 Anki 桌面端编辑器中注入 Quizify 工具栏，提供语法片段、诊断和结构预览。
- 编辑器、复习卡片与悬浮控制共用可随主题着色的离线 SVG 图标；原创 Quizify 标志、功能含义与状态图形不依赖系统字体或 Emoji。
- 设置、导入器、编辑器与复习卡片完整支持中文、英文和俄文，并跟随 Anki 界面语言；未知语言统一回退英文。
- 卡片正文支持 Unicode 文本、组合重音、俄文等西里尔文字及常见中日韩、阿拉伯文字；正文自动判断方向，背诵分词不会再局限于中英文。
- 完整内置 `marked`、`highlight.js`、`KaTeX`、DOMPurify 与 KaTeX 字体，复习时不依赖网络。
- 主要支持目标为 Anki Desktop 25.09+ 与 AnkiDroid 2.24+；较早 AnkiDroid 可通过 Android 限定的 reviewer globals 尽力兼容，其他客户端保持基础渲染与本地交互。
- 提供主题化悬浮复习控制：点击逐项揭示答案，完成后自动翻面，并在支持的
  客户端上通过四向拖拽评分。

## 项目结构

```text
.
├── quizify_addon/
│   ├── __init__.py              # Anki 加载项入口，创建笔记类型、同步媒体、注入编辑器脚本
│   ├── manifest.json            # 加载项元信息
│   ├── config.json              # 版本化默认配置
│   ├── settings.py              # Anki 设置与运行时校验对话框
│   ├── configuration.py         # 配置迁移和模板配置注入
│   ├── media.py                 # 哈希清单校验与媒体同步
│   ├── i18n.py                  # Anki 界面语言识别、复数规则与 Python 翻译入口
│   ├── locales/                 # 中文、英文、俄文共享词库
│   ├── notetype.py              # Quizify 笔记类型维护
│   ├── bridge.py                # 桌面 Reviewer 消息桥
│   ├── core.py                  # 配置、HTML 规范化和文件比较等纯逻辑
│   ├── importer/                # Typora/Markdown 卡片集解析、媒体处理和批量导入
│   ├── _quizify.js              # 复习卡片运行时和 marked 扩展
│   ├── _quizify-i18n.js         # 三语界面共享离线词库
│   ├── _quizify.css             # 复习卡片样式
│   ├── _persistence.js          # anki-persistence，用于正反面状态保存
│   ├── templates/
│   │   ├── front.html           # 正面卡片模板
│   │   └── back.html            # 背面卡片模板
│   └── web/
│       ├── syntax-tools.js      # 编辑器端语法分析和结构预览
│       ├── editor.js            # Anki 编辑器增强
│       └── editor.css           # 编辑器工具栏样式
├── src/
│   ├── shared/                  # 复习端与编辑器共用的语法结构工具
│   ├── review/                  # Markdown 解析、运行时模块与生命周期编排
│   └── editor/                  # Anki 编辑器适配、工具栏与隔离预览
├── tests/                       # 兼容性 JavaScript 测试和 Python 单元测试
├── tests-js/                    # Node test + jsdom 集成测试
├── docs/refactor-plan.md        # 重构计划和架构背景
├── docs/visual-preview.html     # Markdown 与全部题型的视觉组件展厅
└── docs/workbench-preview.html  # 配置面板与编辑器工作台视觉预览
```

## 安装到 Anki

1. 打开 Anki 桌面端，进入 `工具` -> `插件`。
2. 选择“从文件安装”，打开 `quizify_markdown.ankiaddon`（下载链接见结尾处）。
3. 重启 Anki，并进入需要使用 Quizify 的用户资料（profile）。
4. 打开 `工具` -> `Quizify Markdown` -> `设置…`，执行“校验并重新同步媒体”。
5. 如果使用多个用户资料，请分别打开并完成第 4 步。

开发时也可以把本仓库的 `quizify_addon` 整个目录复制到 Anki 插件目录，目录名可保留为 `quizify_addon` 或改成 `anki_quizify`，随后按上述步骤重启并同步媒体。

加载项启动时会校验 `media-manifest.json`，再把内容有变化的 `_quizify-i18n.js`、`_quizify.js`、`_quizify.css`、`_persistence.js` 和 `_quizify-katex-*.woff2` 同步到 Anki 媒体库。

## 界面语言

Quizify 读取 Anki 当前界面语言，并在中文、英文和俄文之间自动切换。语言代码的地区变体会归一化，例如 `ru_RU` 使用俄文、`en_GB` 使用英文、`zh_TW` 使用当前中文词库；法文、德文等尚未提供词库的语言会显示英文。卡片中用户填写的 Markdown 正文不会被翻译。

感谢 [AndreyKaiu](https://github.com/AndreyKaiu) 为项目制作早期英俄国际化实现；这份贡献明确验证了真实需求，并促成主线建立统一词库、Anki 语言跟随、俄语复数规则和全界面覆盖。

AnkiDroid 和 AnkiMobile 不能直接安装桌面加载项。请先在 Desktop 安装或升级、打开对应 profile、重新同步媒体和模板并完成 Anki 同步；移动端完成包含媒体的同步后，强制关闭并重新打开客户端，避免复用升级前已打开的 WebView 资源。

## 离线资源

1.0 的所有复习依赖均包含在 `.ankiaddon` 中，不再使用 CDN，也不需要首启下载。构建脚本仅保留 KaTeX 的 WOFF2 字体，并为每个媒体文件生成大小和 SHA-256；插件同步前会验证清单，损坏文件不会写入媒体库。

设置窗口中的“校验并重新同步媒体”可用于修复当前资料的媒体副本。升级不会自动删除旧版 `_marked*`、`_katex*` 等通用文件，以免影响其他卡片模板。

## 基本用法

创建新笔记时选择 `Quizify Markdown` 笔记类型，然后在 `Front` 或 `Back` 字段中写 Markdown。

### 从 Typora / Markdown 批量导入

加载项支持把一个或多个 `.md` 文件批量导入为 Quizify 笔记。这是一次性导入工具，
不会给笔记写入同步 ID，也不会在 Markdown 修改后自动更新已有笔记。

最小文件如下。独占一行的 `+++` 开始一张新卡片，`***` 从 `Front` 切换到
`Back`；文件末尾会结束最后一张卡片。普通的 `---` 始终保留为字段内的 Markdown
分隔线（只有文档第一行的 `---` 可以开始 YAML front matter）。

```markdown
+++
# 正面

现在是正面

***

# 背面

现在是背面

---

依然是背面

+++
下一张卡片的正面
***
下一张卡片的背面
```

文件开头可以放可选的 YAML 配置，作用于整个文档。`format` 是语法版本号，
省略时默认为 `1`；当前只支持版本 1。

```markdown
---
quizify:
  format: 1
  deck: 学习::网络
  tags: [网络, 日常笔记]
  media:
    local: copy
    remote: keep
    roots:
      - ./assets
---

+++
<!-- quizify-card
deck: 学习::网络::TCP
tags: [TCP, 重点]
draft: false
-->

TCP 为什么需要三次握手？
***
为了可靠地确认双方的发送与接收能力。
```

卡片配置注释必须是 `Front` 中第一个非空块，开始标记、配置和 `-->` 各自独占
一行。卡片的 `deck` 覆盖文档牌组，`tags` 与文档标签合并，`draft: true` 会让该卡
只出现在预览中而不导入。YAML 只接受简单映射、列表和标量，不执行标签、锚点或
其他高级语法。

导入规则：

- `+++` 与 `***` 只有在不缩进、独占一行时才是结构标记；允许行尾空格。
- 代码围栏和 `$$ ... $$` 块中的标记按正文处理。要在普通正文中写出独占一行的
  标记，可写 `\+++` 或 `\***`，导入后反斜杠会去掉。
- 本地 Markdown 图片和 `!audio[...]()` 默认复制进 Anki 媒体库，并把路径改写为
  Anki 实际采用的文件名。路径和 `media.roots` 都必须位于 Markdown 文件所在目录
  之下，不能用 `..` 或符号链接越界。远程 URL 默认原样保留并给出离线警告。
- `media.local` 可设为 `copy`、`keep` 或 `error`；`media.remote` 可设为 `keep`
  或 `error`。`keep` 本地文件不会进入 Anki 媒体库，因此不适合跨设备使用。
- 默认跳过在 Quizify 笔记类型中 `Front` 与 `Back` 都相同的笔记，也可选择全部创建。

在 Anki 中打开 `工具` → `Quizify Markdown` → `导入 Markdown 卡片集…`，多选文件，
检查卡片预览、诊断、默认牌组和附加标签后再导入。新增笔记与牌组可通过一次撤销
操作回退；已复制到媒体库的文件不会随撤销删除，以免误删其他笔记仍在使用的媒体。
完整且可供实现者引用的 v1 规范见
[`docs/markdown-import-format.md`](docs/markdown-import-format.md)。

### 填空

```
HTTP 默认端口是 {{80}}。
```

### 单选

```
;;;
A. TCP
B. UDP
C. HTTP
;;;C
```

答案行只有一个字母时渲染为单选题。

### 多选

```
;;;
A. GET
B. POST
C. BANANA
D. PUT
;;;ABD
```

答案行包含多个字母时渲染为多选题。

### 点击揭示

```
[[三次握手发生在哪一层？||传输层]]
```

### 批注

```
TCP 是一种[面向连接]^(发送数据前需要先建立连接)^的协议。
```

### 折叠块

```
::: 查看解析
这里可以写 Markdown 内容。
:::
```

### 伸缩大纲

使用普通 Markdown 嵌套列表即可。含子项的列表会自动显示独立的展开三角和圆形 bullet；平铺列表仍使用普通 Markdown 样式。

```
- Camping trip
  - To buy
    - Instant coffee & tea bags
    - Trail mix
  - Journal
  - Logistics
- Birthday gift ideas for mom
```

每个父项只控制自己的直接子树，因此可以逐层展开。三角负责展开或收起；父项收起时，旁边的 bullet 才显示状态外圈。点击 bullet 会像 Workflowy 一样聚焦当前分支，并可通过上方面包屑返回。三角和 bullet 都支持键盘操作及无障碍状态提示。

### 标签页

```
=== 概念
TCP 提供可靠传输。

=== 对比
UDP 更轻量，但不保证可靠传输。
===
```

### 音频

```
!audio[听力片段](example.mp3)
```

音频文件需要放入 Anki 媒体库中，文件名与语法中的路径保持一致。

### 随机遮罩背诵

```
:::: recite mask=40 mode=mixed
TCP 是一种 %%面向连接%%、可靠的传输层协议。
::::
```

- `mask=40` 表示初始遮挡 40% 的候选单元，允许范围为 0 到 100。
- `mode=mixed` 自动识别中英文词语和数字，并把 `%%...%%` 作为一个整体。
- `mode=auto` 完全自动分词；`mode=manual` 只遮挡 `%%...%%` 标记的内容。
- 点击遮罩可揭示或重新遮挡；长按可临时偷看；使用鼠标或触控笔按住并滑过多个遮罩时，会连续揭示接触到的内容；底部滑块调整比例，“洗牌”重新随机选择。
- 手机和平板上，手指稳定长按约 380ms 后会出现“滑动揭示”提示；保持按住并拖动即可连续揭示。未达到长按时间的滑动仍用于正常页面滚动，单纯长按松开仍只是临时偷看。
- 连续揭示需移动超过小阈值才会触发，因此普通点击不会被误判；进入手机涂抹模式时会在支持的设备上提供轻微振动反馈。
- 手工分组首版应保持为同一个纯文本片段，不要跨越加粗、链接等 Markdown 节点。
- 代码、公式、链接控件、音频播放器和其他 Quizify 题型不会参与自动遮挡。

### 公式

```
行内公式：$E = mc^2$

块级公式：
$$
\int_0^1 x^2 dx = \frac{1}{3}
$$
```

### Markdown 扩展

```
这是 ==需要记住== 的内容。

平方：X^2^

水分子：H~2~O
```

GitHub 风格提示框支持 `NOTE`、`TIP`、`IMPORTANT`、`WARNING` 和
`CAUTION`：

```
> [!WARNING]
> 修改牌组前请先备份。
>
> 提示框内容可以包含 Markdown。
```

## 悬浮复习控制

默认启用的悬浮按钮会按卡片中的 DOM 顺序处理填空、单选/多选、点击揭示、
批注、折叠块和背诵块。背诵块作为一个复合题型，悬浮按钮会持续揭示其中下一个遮罩，直至该块完成。标签页和音频播放器属于内容组织或播放控件，不计入待揭示答案。

- 正面点击：揭示下一项；全部完成后自动显示答案面。
- 背面点击：继续揭示 `Back` 字段中尚未展开的内容。
- 背面向左拖拽：重来（Again）。
- 背面向下拖拽：困难（Hard）。
- 背面向右拖拽：良好（Good）。
- 背面向上拖拽：简单（Easy）。
- 长按约 0.5 秒后拖动：调整悬浮按钮位置；位置保存在当前设备，
  换卡或重启后继续使用。

拖拽评分只在平台适配层提供语义化 `answerEase()` 时启用。AnkiDroid 优先使用
0.0.3 正式合约；构造器或方法不可用时，只在客户端明确标记为 Android 后使用
`showAnswer()` / `buttonAnswerEase1..4()` 等兼容入口。AnkiMobile 的九宫格点击可以
由用户重新映射，因此插件不会用屏幕区域模拟评分。

揭示嵌套题型前，运行时会先激活目标所在的标签页，并从外到内展开祖先折叠
块；待布局更新后再滚动到目标位置。位置设置使用客户端本地存储，不会通过
Anki 媒体或资料库同步到其他设备。

## 视觉系统

Quizify 提供两套可选外观，并共用完全相同的模板结构、题型运行时与状态语义：

- **开务**：当前默认的现代主题，以温和纸张背景、深墨正文、青绿色主色和琥珀色辅助色构成清晰的 Knowledge Canvas。
- **格致**：从 Quizify 早期模板重新设计而来的复古书页主题，使用暖灰纸张、象牙白卡片、蓝灰正文、赭色点缀和中西文衬线字体回退。

两套主题都支持 Anki 的浅色与夜间模式；模板头部会继续明确标识 Question / Answer。

- Markdown 标题、列表、引用、提示框、表格、代码、图片和公式采用统一排版节奏。
- 折叠、标签页、填空、选择、批注、揭示、音频、背诵和悬浮控制共享圆角、边框、阴影与交互状态。
- 640px 以下使用紧凑移动布局；长代码在组件内部滚动，不造成页面级横向溢出。
- 尊重系统的 `prefers-reduced-motion` 设置。

开发时可直接打开 [`docs/visual-preview.html`](docs/visual-preview.html)，集中切换检查「开务 / 格致」、全部组件及深色主题。
配置面板与编辑工具栏可通过 [`docs/workbench-preview.html`](docs/workbench-preview.html) 集中检查。

## 编辑器增强

加载项会在 Anki 编辑器中识别 `Quizify Markdown` 笔记类型，并启用：

- 固定在 Anki 原生工具栏下方的紧凑 Quizify 命令栏。
- Quizify 语法片段按钮，支持 `Ctrl+Alt+1` 到 `Ctrl+Alt+8` 快捷插入。
- 常见语法错误诊断，例如空填空、错误选择题答案、未闭合折叠块、未闭合标签页。
- 当前字段结构预览，列出光标所在字段中检测到的填空、选择题、揭示、批注、折叠块、标签页、音频和背诵块。
- 工具栏独立“预览”入口，以 250ms 防抖渲染当前聚焦字段；预览复用复习页的净化、代码、公式和主题样式，但不会写入答题进度或触发评分。
- 背诵块参数诊断，包括遮挡比例、模式、结束标记和 `%%` 分组配对。
- 自动把字段切换为纯文本编辑，避免富文本 HTML 干扰 Markdown。
- Markdown 格式、Quizify 题型、语法状态与预览统一为紧凑按钮流，所有入口始终一键直达；工具栏按编辑区实际宽度自然换行，不依赖固定网格或横向滚动；
- 工具栏不再用品牌栏、字段标题或分组面板额外占据空间；预览位于按钮流末尾，尺寸与其他按钮一致，仅通过强调色区分，极窄窗口也不会出现突兀留白；
  命令会保留并恢复编辑器选区，可包裹所选文本或插入占位内容。
- 语法诊断位于命令区之后，真实渲染预览位于按钮流末尾，其面板按需展开。

Quizify Workbench 复用 Anki 原生工具栏的扁平、紧凑设计语言。编辑器工具栏不显示独立品牌栏或字段标题，格式、题型、语法状态和预览共同组成一个内容宽度按钮流，并依据编辑区实际宽度自然换行；无论宽屏还是极窄窗口都不使用横向滚动，也不会用空白面板填满末行。所有命令都会保留操作前的编辑器选区，鼠标打开检查或渲染面板也不会丢失当前字段的光标位置。

Markdown 快捷键：

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+B` | 加粗 |
| `Ctrl+I` | 斜体 |
| `` Ctrl+` `` | 行内代码 |
| `Ctrl+K` | 链接 |
| `Ctrl+Shift+X` | 删除线 |
| `Ctrl+Shift+H` | 高亮 |
| `Ctrl+Shift+.` | 上标 |
| `Ctrl+Shift+,` | 下标 |
| `Ctrl+Shift+A` | GitHub Note 提示框 |

## 配置项

`quizify_addon/config.json` 提供默认配置。Anki 设置对话框保存后会写入 Anki 的插件配置。

设置窗口提供外观、悬浮控制、AnkiDroid 正式 API 和内置运行时完整性状态。

```json
{
  "schema_version": 1,
  "note_type": "Quizify Markdown",
  "review": {
    "theme": "kaiwu",
    "cardless": false,
    "floating_control": true
  },
  "platform": {
    "ankidroid_api": true
  }
}
```

- `review.theme`: 选择 `kaiwu`（开务，默认现代主题）或 `gezhi`（格致，复古书页主题）。
- `review.cardless`: 移除复习卡片的背景和阴影。
- `review.floating_control`: 启用逐项揭示、自动翻面和拖拽评分控制。
- `platform.ankidroid_api`: 在 AnkiDroid 上启用 0.0.3 正式 JavaScript API 合约；关闭它不会禁用 Android 限定的兼容入口。

0.6.x 的同类扁平设置会在首次启动时自动迁移；旧资源 URL 和可配置开发者联系方式会被丢弃。

## 开发和测试

项目使用 Node 20 LTS（20.19+）、Node 22 LTS（22.13+）或 Node 24+、ES 模块和 esbuild。`src/` 是源码，`quizify_addon/_quizify.js`、`_quizify.css` 与 `web/` 下的文件是生成产物。

安装依赖并运行全部构建、JavaScript 与 Python 测试：

```powershell
npm ci
npm test
```

生成可安装包：

```powershell
npm run package
```

生成便于调试的可读前端产物：

```powershell
npm run build
```

生成用于发布的最小化前端产物：

```powershell
npm run build:release
```

`npm run package` 会先用可读产物执行完整测试，再生成最小化 release bundle、执行 release 行为 smoke test，最后按显式文件白名单创建安装包。ZIP 时间、创建平台和文件权限均固定；相同输入在 Windows 与 Linux 上会得到相同的包成员与元数据。

GitHub Actions 会在 Node 20.19、22.13、24 以及 Windows/Linux 打包路径上执行这些门禁。正式发布前还需按 [`docs/refactor-plan.md`](docs/refactor-plan.md) 的要求，在 Anki Desktop 25.09.4 与 AnkiDroid 2.24.0 上完成手工矩阵。

当前测试覆盖范围包括：

- Quizify marked 扩展的基本 tokenizer 和 renderer。
- 随机遮罩背诵的容器解析、分词模式、停用词和运行时契约。
- 编辑器端语法诊断和结构预览。
- 配置读取和 `cardless` 应用。
- 真实 Marked、DOMPurify 与 jsdom 渲染和恶意 HTML 净化。
- Anki Desktop 命名空间消息桥、AnkiDroidJS 真实 lexical 注入、正式合约和 Android 限定兼容入口。
- 悬浮控制的 Pointer/Touch/Mouse/Click 输入、合成点击去重、方向判定、难度映射、运行时契约和主题样式。
- 压缩后 review bundle 在正式与兼容 AnkiDroid 环境中的翻面、评分 smoke test。
- 0.6.x 到 1.0 的配置迁移、模板 JSON 安全转义和富文本粘贴规范化。
- 离线媒体 SHA-256 校验、内容感知同步和可复现打包。
- 模板骨架、设计变量、Markdown 与全部题型的视觉契约。

## 开发注意事项

- `quizify_addon/__init__.py` 依赖 Anki 的 `aqt` 模块，只能在 Anki 环境中运行。
- 纯运行时模块位于 `src/`；生成 bundle 保留 CommonJS 测试导出。
- 新增复习端媒体时应使用 `_quizify-` 前缀，并由构建脚本写入媒体清单。
- 修改模板后需要重启 Anki，或在设置对话框保存一次配置，让加载项刷新 `Quizify Markdown` 模板。
- Quizify 自身源码 Copyright © 2024-2026 e-chehil，采用 [`AGPL-3.0-or-later`](LICENSE)：发布修改版或通过网络向用户提供修改版功能时，必须依照该许可证提供对应源码。捆绑依赖仍分别遵循 `THIRD_PARTY_LICENSES.md` 中列出的许可证。

## 安全边界

- Anki Desktop 加载项会在卡片 HTML 进入 WebView 前校验受管模板的字段边界，
  将 `Front` / `Back` 源码转换为惰性文本；重复、未知或跨字段的保留标记会让
  整张卡片以不含笔记数据的静态错误页拒绝显示。Markdown 渲染后仍会经过
  DOMPurify。
- AnkiDroid 无法运行 Desktop 的 Python 预处理。因此移动端支持以“内容通过
  Quizify 的纯文本字段正常编写”为前提；它不是不受信任 `.apkg`、启用 HTML
  的导入文件或手工注入原始字段 HTML 的安全沙箱。此类内容可能在 Quizify
  JavaScript 启动前就被 WebView 解析。请只复习可信牌组，并先在 Desktop 检查
  或把外部内容作为纯文本导入。
- `quizify-source` 注释属于模板保留命名空间，不应出现在用户字段中。

## 已知限制

- 真实 Anki 桌面端和 AnkiDroid 的完整回归测试仍需要手动验证。
- AnkiMobile 与 AnkiWeb 支持基础内容渲染和悬浮控制的本地逐项揭示，但不支持自动翻面或评分。
- 桌面消息入口使用公开 WebView hook，但最终评分仍封装了 Anki Reviewer 内部方法，需要随 Anki 版本回归。

## 下载

[下载 Quizify Markdown Anki 插件（`.ankiaddon`）](https://raw.githubusercontent.com/e-chehil/anki-quizify/main/quizify_addon/quizify_markdown.ankiaddon)

欢迎反馈使用中遇到的问题或改进建议，您可以前往 [GitHub Issues](https://github.com/e-chehil/anki-quizify/issues/new) 提交 Issue。

如果您喜欢我的作品，可以通过以下方式予以支持：

- 在 GitHub 上为该项目**加注星标**
- **微信赞赏**

  <img src="https://github.com/user-attachments/assets/5d91de4c-8713-41ed-98e3-b53dd4562f30" width="400px" />

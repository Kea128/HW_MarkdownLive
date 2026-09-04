# Inkdown

Inkdown 是真正的 Windows 本地 Markdown 实时编辑器。它直接读写磁盘文件，不需要浏览器、PWA、
HTTP 服务或云端账号。

> 本项目仅参考 Typora 公开可见的“内容优先、低干扰写作”理念；未下载、访问、复制、逆向或使用
> Typora 的私有源码、品牌和视觉资产。

## 桌面能力

- Windows 原生菜单及新建、打开、保存、另存为、退出快捷键
- 原生文件对话框和直接覆盖保存；支持 `.md`、`.markdown`、`.txt`
- 当前路径、文件名、脏状态和标题 `*`；关闭/新建/打开前保存确认
- 保存和文件切换前强制同步最后一次编辑，避免快速操作写入旧内容
- GFM、任务列表、表格、安全链接、代码高亮、KaTeX 数学公式和 XSS 白名单净化
- 单栏所见即所得编辑，按 `Ctrl+/` 在排版视图与 Markdown 源码间切换
- 可折叠文档大纲、源码行号、当前行提示、可调行间距、自动内容宽度和窄窗口布局
- 中文路径、UTF-8 BOM、拖放打开、最近文件、窗口位置/尺寸恢复
- 崩溃草稿保护（恢复为未命名文稿，不覆盖磁盘）和外部变更检测

## 架构与安全

```text
electron/main/       窗口、菜单、文件服务、文档状态、设置、IPC
electron/preload/    contextBridge 固定白名单
src/                 React renderer、组件、hooks、共享 IPC contracts
tests/               单元、组件和 Playwright Electron E2E
```

BrowserWindow 使用 `contextIsolation: true`、`nodeIntegration: false` 和 `sandbox: true`。
渲染进程不能任意读取文件或执行命令；主进程验证 IPC 来源、文件扩展名、绝对路径、内容大小和外链协议。
应用不加载远程页面，禁止 renderer 导航和新窗口。仅 `http:`、`https:`、`mailto:` 外链通过受控
`shell.openExternal` 交给系统默认程序。

## 数学公式

Inkdown 使用 KaTeX。推荐采用 Typora 常用的写法：行内公式用单个美元符号包围，块级公式用独占行的双美元符号包围：

```markdown
质能方程：$E = mc^2$

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

$$
\begin{bmatrix}
1 & 2 \\
3 & 4
\end{bmatrix}
$$
```

同时兼容 LaTeX/MathJax 文档中的 `\(...\)` 和 `\[...\]` 分隔符；代码块与行内代码中的这些字符
保持原样，不会被当成公式。

支持分数、上下标、矩阵、求和和希腊字母等常见 LaTeX。非法公式会保留原始内容并显示局部错误，
不会中断整个预览。KaTeX 不受信任命令保持关闭；数学 DOM 经过仅允许必要 MathML、class 和布局
属性的白名单净化。

### 公式编号与引用

在源码模式点击“编号公式”会插入带稳定标签的块级公式；标签以 `% @eq formula-1` 形式保存在
公式内部。把光标放到正文任意位置，再从“引用公式”下拉菜单选择目标即可插入引用。排版视图会
自动显示连续编号“式 (1)、式 (2)…”，点击引用会滚动并高亮对应公式。调整公式顺序后，显示编号
和所有引用会自动同步，无需手工修改数字。

## 开发与验证

需要 Node.js 22 或更新版本。

```powershell
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm run verify
```

Electron E2E 会实际启动桌面进程，验证文件打开、所见即所得编辑、源码切换、菜单快捷键、脏状态、覆盖保存以及
renderer 隔离。

## Windows 发布

```powershell
npm run release
```

发布结果位于 `releases/Inkdown-v2.6.0-windows/`，包含 Windows x64 NSIS 安装包、便携 EXE、
ZIP、中文说明、CHANGELOG 和 SHA-256。发布目录不含源码、测试缓存或 `node_modules`。
发布命令会先执行完整验证与打包版冒烟，成功后删除旧版本和 `release-build` 中间目录。

若未配置证书，产物仍会正常生成，但会明确标记为“未代码签名”；Windows SmartScreen 可能显示未知发布者。

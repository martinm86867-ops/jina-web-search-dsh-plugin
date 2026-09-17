[English](README.en.md) | **简体中文**

# dsh-jina

DeepSeek Harness 的 [Jina AI](https://jina.ai/) 插件（bundle）：把 jina-cli 的全部 API 能力以模型工具的形式装进 dsh，并在 Web 设置的**插件 → 配置**页（与 终端 / Agent 循环 / 网页搜索 相同的标准插件配置位置）提供 **Jina Tools** 卡片来配置 API key 与**本地代理地址**。

## 更新日志

> 本处仅列出最新版本；完整历史见 [change-log.md](./change-log.md)。

### 1.0.0（2026-09-17）

- **feat** **全套 16 款智能工具全面覆盖**：涵盖通用网页搜索、并行批量搜索（`jina_search_batch`）、ReaderLM-v2 结构化 JSON 抽取（`jina_extract`）、语义 Markdown 分块（`jina_chunk`）、本地离线文档解析（`jina_read_file`）、实时网页事实核验（`jina_fact_check`）、密集向量嵌入（`jina_embed`）、相关度重排（`jina_rerank`）、零样本分类（`jina_classify`）及 PDF 图表公式 OCR 提取（`jina_pdf`）。
- **feat** **对抗性内容提取与反爬穿透**：
  - 原生支持 `removeOverlay`（`X-Remove-Overlay`）：服务端剥离全屏弹窗、GDPR/CMP Cookie 墙与软付费墙遮罩。
  - 原生支持 `detachInvisibles`（`X-Detach-Invisibles`）：清理 0 像素爬虫蜜罐与隐藏追踪埋点。
  - 原生支持 `withShadowDom` 与 `withIframe`：穿透 Web Components 影子 DOM 与内联 iframe 文档。
  - 全局 Cloudflare Turnstile 自动穿透（`callJinaWithCfBypass`）：遇到 403/503 或验证码拦截自动升级为浏览器渲染重试。
  - `jina_read_file` 本地纯文本、代码与 Markdown 免上传直接解析，无 API key 即可离线读取。
- **feat** **新增对抗隐身预设与 Web UI 开关**：新增 `adversarial-stealth` 预设，设置面板新增弹窗剥离、蜜罐剔除、Shadow DOM 与 iframe 开关。

## 功能

安装后所有会话（所有 agent preset）都会获得 16 个 `jina_*` 工具：

| 工具 | 对应 API / 引擎 | 说明 |
| --- | --- | --- |
| `jina_web_search` | `s.jina.ai` | 通用网页搜索（支持 site/filetype/intitle 操作符、时效过滤与权威官方源置顶） |
| `jina_search_batch` | `s.jina.ai` | 单轮并行并发检索（同时执行 1–5 条不同查询） |
| `jina_search_arxiv` | `s.jina.ai` / arXiv | arXiv 预印本检索（支持单轮自动通读全文 `readFullText: true`） |
| `jina_search_ssrn` | `s.jina.ai` / SSRN | SSRN 论文检索（经济 / 金融 / 法律 / 管理等社会科学官方论文） |
| `jina_read` | `r.jina.ai` | 网页转 Markdown（支持 CSS 目标提取、遮罩剔除、蜜罐剥离、Shadow DOM 穿透与 Cloudflare 自动绕过） |
| `jina_extract` | ReaderLM-v2 | 基于 JSON Schema 的端到端结构化抽取，零 prompt 额外 token 浪费 |
| `jina_chunk` | `r.jina.ai` | 按大纲标题（`h1`–`h5` 或 `structured`）语义切分长篇规范与文档 |
| `jina_read_file` | 本地 / OCR++ | 读取工作区本地文件（PDF、HTML、代码、文本），支持离线纯文本与远程 OCR |
| `jina_screenshot` | Viewport / Pageshot | 网页整页或特定区域截图，自动保存至 DeepSeek Harness `AttachmentStore` |
| `jina_pdf` | Search extract-pdf | 从 PDF 提取图表、表格与公式（支持 LaTeX 格式与单页定位） |
| `jina_fact_check` | `g.jina.ai` Grounding | 基于全网实时事实核验陈述真伪并给出置信度评分与权威参考出处 |
| `jina_embed` | `api.jina.ai` / v5 | 密集文本向量化（支持 Matryoshka 维度缩放） |
| `jina_rerank` | `api.jina.ai` / v3.5 | 目标查询相关度重排 |
| `jina_classify` | `api.jina.ai` / Classify | 候选标签零样本分类 |
| `jina_datetime` | `r.jina.ai` | 推测网页发布与修改时间戳 |
| `jina_expand` | `s.jina.ai` | 扩展搜索词向量 |
| `jina_primer` | 探测与诊断 | 获取时钟、公网 IP、代理路线与 Jina 账户余额 |

## 效果实测（与内置 web_search 交叉对比）

为了让模型**不用记住参数**就能用对检索域，学术检索单独拆成了 `jina_search_arxiv` / `jina_search_ssrn` 两个专用工具（对应 `jina search --arxiv` / `--ssrn`）——工具名即用途，模型看到用户要论文会直接调用它们。以下为 2026-08-13 在同机真实网络环境（VPN 系统代理）下的抽样对比：同一查询分别调用本插件与 dsh 内置 `web_search`，人工核对结果。

| 场景 | 本插件（dsh-jina） | 内置 web_search | 结论 |
| --- | --- | --- | --- |
| 学术检索（arXiv） | `jina_search_arxiv`「retrieval augmented generation survey」→ **9/9 全部为 arxiv.org 官方直链**：2312.10997（RAG 经典综述）、2506.00054、2410.12837、2501.09136（Agentic RAG）、2405.07437、2504.08748 等，篇篇主题契合、摘要准确 | 同查询返回 arXiv **镜像站**（ezproxy.obspm.fr、ar5iv、sinoxiv.napstic.cn）与 BibTeX 链接，官方直链缺失 | ✅ jina 胜：官方直链 + 精准召回 |
| 学术检索（SSRN） | `jina_search_ssrn`「large language models financial markets」→ **9/9 全部为 papers.ssrn.com 原文**：市场情绪预测、LLM 模拟交易、AI 羊群效应、投资者分歧等，契合度极高 | 无 SSRN 专用检索能力 | ✅ jina 胜：独占 SSRN 域 |
| 中文新闻 / 社区 / 官方源 | `jina_web_search` 官方源（政府 / 公司官网）置顶，可加 `time` 过滤时效 | 同查询结果相关，但官方源不置顶 | ✅ jina 优：权威源优先 + 时效过滤 |
| 泛学术检索（未指定域） | 默认 web 域对 Springer / IEEE / ACL 等覆盖面一般（学术检索请改用上面的专用工具） | Springer / IEEE / ACL 覆盖面广 | ✅ web_search 优：泛学术检索用它 |

**结论与分工用法**：学术论文 → `jina_search_arxiv` / `jina_search_ssrn`；中文时效新闻 → `jina_web_search`（+ `time`）；泛学术 / 工程文档 → 内置 `web_search`。两者互补，覆盖全部检索场景。

> 注：上表为单轮抽样对比（非严格 benchmark），结果受当天网络与查询选择影响；两个工具链均真实可用，结论供选型参考。

## 提取预设与选项配置

插件提供 6 种开箱即用的提取预设，可直接在 Web 设置（**插件 → 配置 → Jina Tools**）或 `settings.yaml` 的 `jina-tools` 下调整：

| 预设标识 | 目标引擎 | Token 预算 | 图片模式 | 核心特性与适用场景 |
|---|---|---|---|---|
| `balanced`（默认） | `auto` | 8,000 | `none` | 日常编码与文档查阅高信噪比提取；清洗页眉页脚、广告与 Cookie 弹窗。 |
| `research` | `auto` | 16,000 | `alt` | 深度学术与技术调研；自动生成图片描述；穿透 Shadow DOM 与内联 iframe。 |
| `clean-read` | `auto` | 10,000 | `none` | 强力正文剥离；严格限定提取 `article`、`main` 或 `.markdown-body`。 |
| `fast-index` | `auto` | 4,000 | `none` | 低 Token 开销；适合快速多轮并发检索与轻量级 RAG 问答。 |
| `spa-resilient` | `browser` | 12,000 | `none` | 动态客户端渲染；等待 Next.js/React/Vue 挂载完成；穿透 Web Components。 |
| `adversarial-stealth` | `cf-browser-rendering` | 12,000 | `none` | 反爬装甲隐身模式：服务端绕过 Cloudflare、强力剥离弹窗遮罩与 0 像素蜜罐。 |

### `settings.yaml` 配置参数说明

```yaml
jina-tools:
  defaultPreset: balanced              # balanced | research | clean-read | fast-index | spa-resilient | adversarial-stealth
  defaultSearchNum: 5                 # 单次搜索默认返回结果数（1-10）
  defaultTokenBudget: 8000            # 单页阅读默认 Token 上限截断
  defaultEngine: auto                 # auto | browser | curl | cf-browser-rendering
  defaultRetainImages: none           # none | alt | all
  autoBypassCloudflare: true          # 遇到 403/503 或 Cloudflare 挑战时自动切换浏览器渲染重试
  defaultRemoveOverlay: true          # 服务端剥离弹窗遮罩、Cookie 授权浮层与软付费墙
  defaultDetachInvisibles: true       # 剔除 0 像素爬虫蜜罐、隐藏文本与非视觉埋点
  defaultWithShadowDom: false         # 穿透 Web Components 封闭/开放 Shadow DOM
  defaultWithIframe: false            # 提取并内联子 iframe 文档内容
  defaultTargetSelector: 'article, main, [role="main"], [role="article"], .markdown-body, .content, #content, .main-content, #main-content, .post-content, .article-body, .entry-content, [itemprop="articleBody"], [itemprop="text"], [data-testid*="article"], [data-testid*="content"]'
  defaultRemoveSelector: 'header, footer, nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .navbar, .site-header, .site-footer, .cookie-banner, #cookie-banner, .consent-banner, #onetrust-banner-sdk, #onetrust-consent-sdk, .cookiebot, #CookiebotWidget, .didomi-popup-container, .ads, .ad, .advertisement, [id^="google_ads"], [id^="ad-"], [class*="-ad-"], .sidebar, #sidebar, .aside, .social-share, .comments, #comments, .menu, .breadcrumbs, .related-posts, .author-bio, .footer-nav, .popup, .modal, .overlay, .paywall, .paywall-overlay, .premium-gate, .subscription-gate, .newsletter-signup'
```

---

## 对抗性反爬提取防御体系

现代网站广泛部署了防爬与阻断技术，包括 CMP 同意浮层、遮罩软付费墙、混淆 class 哈希与 Cloudflare Turnstile 验证码。`dsh-jina` v1.0 提供了成体系的解决方案：

1. **服务端弹窗与付费墙剥离（`X-Remove-Overlay: true`）**：
   - 不仅依赖客户端 CSS 移除，而是在 Chromium 渲染树序列化前由服务端直接解构全屏遮罩、Cookie 墙（OneTrust、Cookiebot、Didomi）与阅读阻断弹窗，恢复正文排版。
2. **爬虫蜜罐与隐藏埋点剥离（`X-Detach-Invisibles: true`）**：
   - 依据布局树样式计算，自动剔除 `display: none`、`visibility: hidden`、`opacity: 0`、1x1 像素与视口外的诱捕 canary 标记，彻底杜绝隐藏 Prompt 注入与蜜罐毒化。
3. **Shadow DOM 穿透提取（`X-With-Shadow-Dom: true`）**：
   - 自动遍历开放与封闭的 Shadow DOM 边界，解锁现代基于 Lit、Shoelace、Stencil 构建的 Web Components 组件文档。
4. **Cloudflare Turnstile 自动穿透（`callJinaWithCfBypass`）**：
   - 请求默认采用高速低耗传输；一旦捕获 403/503 或 Cloudflare 拦截特征码（`turnstile`、`cf-chl`、`Attention Required`），引擎自动无感升级为 `cf-browser-rendering` 执行真实浏览器交互并重试。
5. **本地离线免 API Key 文件直读**：
   - `jina_read_file` 智能识别本地代码、文本与 Markdown（`.md`、`.txt`、`.json`、`.py`、`.js`、`.ts` 等）；在离线或无 API Key 场景下直接通过 `ctx.fs` 读取解码，绝不浪费网络带宽与 Jina 配额。

---

## 安装

仓库地址：https://github.com/minatoAI/jina-web-search-dsh-plugin

插件按 [bundle](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md) 方式分发，用 `dsh plugin` 安装进 profile（从源码 checkout 运行时用 `pnpm dsh` 代替 `dsh`）：


> 从 GitHub 安装（本项目无 build 脚本，无需 allowBuilds 授权）

```sh
dsh plugin --profile web add github:minatoAI/jina-web-search-dsh-plugin
```

> 更稳妥：固定到某个 commit，避免后续推送改变实际安装到的代码

```sh
dsh plugin --profile web add github:minatoAI/jina-web-search-dsh-plugin#<commit-sha>
```

> 或本地文件夹安装（开发调试用）

```sh
dsh plugin --profile web add ./jina-dsh-plugin
```

安装完成后**重启** dsh（新 bundle 在下次启动时生效）：

```sh
dsh --profile web
```

然后打开 Web 界面 → 设置 → **插件** → **配置** 选项卡 → 展开 **Jina Tools** 卡片 → 粘贴 API key → 保存。免费 key 在 https://jina.ai/ 获取。

同一张卡片里还有 **本地代理（可选）**：如果你的代理软件只监听本地端口（没有开启系统代理，也没有设置 `HTTP_PROXY` 环境变量），把它的地址填进去即可，例如 `http://127.0.0.1:7897`（可省略 `http://`）→ 保存，下一次工具调用立即生效。代理软件换端口时改这里即可，不需要重启 dsh。

卡片中的 **API key / 连接检测** 区域会实时显示当前 key 的身份（Jina 账号）与余额（credits）、标注 key 的来源（本页保存 / key 文件 / 匿名配额），并显示**本次检测实际使用的代理地址与来源**；点击「刷新」重新检测（保存/清除 key 或代理后也会自动重检）。该数据由主机端插件通过 `/api/dsh-jina/primer` 路由提供（与 `jina_primer` 工具同一接口），**key 明文永不离开主机**；代理地址是明文配置，会显示在页面上。

## API key 解析顺序

每次工具调用按以下顺序找 key（任一命中即用）：

1. 工具调用参数 `apiKey`
2. 设置页保存的 key（credential 引用 `JINA_API_KEY`，由 dsh 凭据存储持久化，如 `~/.dsh/.credentials.yaml`）
3. 会话工作区的 `jina-api-key.txt`
4. dsh 主目录（`$DSH_HOME`，默认 `~/.dsh`）下的 `jina-api-key.txt`

设置页保存新 key 后立即生效（无需重启，每次调用即时解析）；HTTP 401 时也会自动重读文件并重试一次。凭据值只通过 `credentials.set` 上行，任何读取接口都不会回传明文。同时支持在页面上一键清除。

## 本地代理（本地网络代理软件）

Jina 域名被直连网络屏蔽，需要代理。插件的代理解析顺序（每次调用即时解析，改完即生效）：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 设置卡片「本地代理」 | `jina-tools` 命名空间的 `proxyUrl` 字段，最推荐的手动方式 |
| 2 | 环境变量 `JINA_PROXY_URL` | 没有挂载 settings 提供方的 profile（如 headless）也能用 |
| 3 | Windows 系统代理 | 从 WinINET 注册表自动发现（`ProxyEnable=1` 时），传输失败会重新发现一次，VPN 换端口可自愈 |
| 4 | 启动环境变量 | harness 解析的 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`，由 `subprocess` 自动带给网络 helper |

规则与注意事项：

- **只支持 `http://` 和 `https://` 代理**。网络 helper 是 `node -e` + 全局 `fetch`，靠 `NODE_USE_ENV_PROXY` 识别代理；`socks://` 等 scheme 会让 Node 启动即退出，因此这类地址会被拒绝并在页面/错误信息里说明。
- **本地代理软件只监听端口、未设为系统代理时**（WinINET `ProxyEnable=0x0`），优先级 3 发现不到它——这正是要在卡片里手填地址的场景。
- 手动填写的地址**优先于**自动发现；传输失败时插件不会偷偷改用自动发现的代理，而是把当前使用的地址写进错误信息，便于确认端口是否写错。
- 地址可以省略协议头（`127.0.0.1:7897` 等价于 `http://127.0.0.1:7897`），可以带账号密码（`http://user:pass@127.0.0.1:7897`），路径/查询串会被忽略。
- 代理地址会明文保存在 dsh 的设置文档（`settings.yaml` 的 `jina-tools` 段）并可被 Web 页面读回；**只在本机受信环境使用**，不要把带凭据的地址提交到公开仓库。
- 「清除」后回到自动检测（优先级 3 → 4）。

## 卸载

```sh
dsh plugin --profile web remove dsh-jina
```

## 仓库结构

```
jina-dsh-plugin/
├── package.json       # manifest: "dsh": { "bundle": {"patch": ...}, "client": {"platform": "web"} }; 浏览器半身经 exports["./client"] 指向 ui/client.js
├── cordis.patch.yml   # 组合层：单个双面孔行 dsh-jina（宿主工具 + 浏览器卡片；行名 = 精确包名是 client-modules 扫描的硬条件）
├── index.js           # 主机插件：完整 16 款智能工具 + 网络传输 + Cloudflare 自动穿透 + AttachmentStore + jina-tools 代理与预设
├── proxy.js           # 纯函数模块：代理优先级、提取预设、选择器默认常量与 schemastery 设置 schema（零依赖）
├── primer.js          # 纯函数模块：jina_primer 的诊断与格式化逻辑（零依赖，可单测）
├── test/
│   ├── adversarial-extraction.test.js # 对抗性提取参数、隐身预设与 schema 测试
│   ├── client-bundle.test.js          # 浏览器 bundle 契约测试（语法、注册 id、settings 通道）
│   ├── milestone5.test.js             # 本地文件读取与附件存储集成测试
│   ├── plugin-proxy.test.js           # mock 宿主的代理集成测试（含可选实时代理用例）
│   ├── presets-defaults.test.js       # 选择器常量与预设 schema 测试
│   ├── primer.test.js                 # jina_primer 单元测试
│   ├── proxy.test.js                  # 代理策略与优先级单元测试
│   ├── tools-extended.test.js         # 扩展工具契约与参数校验测试
│   └── tools.test.js                  # jina_web_search 模型可见契约测试（TDD）
├── ui/
│   ├── package.json   # 子包 manifest（exports["./client"]）
│   ├── index.js       # 空主机半身（保留历史子包结构兼容性）
│   └── client.js      # 预构建浏览器 bundle：设置 → 插件 → 配置 的 "Jina Tools" 卡片（API key、本地代理、预设与开关）
├── docs/
│   ├── api.md         # Jina API 各端点、请求头、错误码与提取选项详析
│   ├── agents.md      # 面向 LLM 与 Agent 提示词的 Jina API 工程指引
│   ├── reader-api.json# Jina Reader API 官方 OpenAPI 规范
│   └── search-api.json# Jina Search API 官方 OpenAPI 规范
├── change-log.md      # 完整版本历史（简体中文）
├── change-log.en.md   # 完整版本历史（English）
├── README.md          # 简体中文说明（本文件）
└── README.en.md       # English README
```

## 开发说明

- 主机插件只依赖 Node 内置模块与 dsh 主机服务（`fs`、`subprocess`、`tools`、`credentials`、`settings`、`webServer`、`attachments`），无第三方 npm 依赖；凭据走 dsh 原生的 credential seam（引用 `JINA_API_KEY`），代理配置走插件自己的 `jina-tools` 设置命名空间（`proxyUrl` 字段，schema 是零依赖的 duck-type 节点，见 `proxy.js` 的 `createSettingsSchema`），任何 profile 组合都可以直接使用。
- 客户端 bundle 直接提交（`ui/client.js`），无构建步骤，git 安装开箱即用。改 UI 后直接改该文件并重启即可。bundle 顶层 `window.__ModuleLoader__.load` 的注册 id **必须等于图行 id（精确包名 `dsh-jina`）**——模块系统只按图行 id 匹配注册（`/client` 后缀除外），注册在别的键上（如旧行名 `dsh-jina/ui`）会报 `loaded without registering "dsh-jina"` 并导致整页 `Failed to load plugins`。卡片注册进 Web 设置包声明的 `settings.plugin.item` 插槽（设置 → 插件 → 配置），这是第三方插件配置的标准位置。
- **`remote.<ns>` 的注入铁律**：gateway `$mount` 时会把每个 Remote 命名空间注册成**独立 cordis 服务**，所以客户端插件读取 `remote.<ns>`（如 `remote.credentials`、`remote.settings`）之前，必须在自己的 `inject` 里声明该服务名——只声明 `'remote'` 是不够的，属性访问本身就会抛 `cannot get property "remote.settings" without inject`，而错误冒到 `settings.plugin.item` 的 slot 边界会让**整张卡片消失**（0.6.0 的回归，现已由 `test/client-bundle.test.js` 固化）。本插件的 `inject = ['slots','remote','remote.credentials','remote.settings']`。读取处仍然包一层 try/catch：服务缺失时降级为提示，不让 slot 崩溃。
- key 通过凭据 Remote 命名空间管理（`credentials.describe/set/unset`，变更事件 `credentials/reference-updated` 由 `remote` 服务转发）；代理字段走 `settings` Remote 命名空间（`remote.settings.describe/mutate`，写入按读到的 `revision` 设栅；外部编辑由转发事件 `settings/document-updated` 触发热重读）。
- 组合层遵循 dsh 约定：单个双面孔行 `dsh-jina` 同时携带宿主半身与浏览器半身。浏览器半身由**根 manifest** 的 `dsh.client`（platform: web，图边注入 `@deepseek-ai/dsh-api-remotes`）与 `exports["./client"]` 声明，host 的 client-modules 服务扫描时按行名（精确包名）定位根 manifest 并接入 Web boot graph。注意 client-modules 扫描只接受精确包名行：子路径行（如 `dsh-jina/ui`）永远不会被扫描为客户端行——浏览器半身必须声明在根包。

## 测试

纯函数逻辑（代理策略、primer 解析/格式化、对抗性提取验证等）使用 Node 内置测试运行器，零依赖：

```sh
npm test   # 等价于 node --test（自动发现 test/*.test.js）
```

- `test/proxy.test.js`、`test/primer.test.js`、`test/tools.test.js`：纯函数与模型可见契约。
- `test/adversarial-extraction.test.js`：校验 `X-Remove-Overlay`、`X-Detach-Invisibles`、`X-With-Shadow-Dom`、`X-With-Iframe`、`X-Set-Cookie`、`callJinaWithCfBypass` 逻辑与隐身预设。
- `test/presets-defaults.test.js` 与 `test/tools-extended.test.js`：验证选择器常量、Token 预算与扩展参数契约。
- `test/plugin-proxy.test.js`：用假 Cordis 上下文驱动主机半身，断言设置命名空间注册、代理优先级、**网络 helper 实际收到的环境变量**、错误文案与 `/api/dsh-jina/primer` 负载。其中带 `JINA_LIVE_PROXY=1` 的用例会真实 spawn helper 打通一次 Jina 请求。
- `test/client-bundle.test.js`：解析预构建的 `ui/client.js` 并固化注册 id、`jina-tools` key、settings 通道与 revision 栅栏。

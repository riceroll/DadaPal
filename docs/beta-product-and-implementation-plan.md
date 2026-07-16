# DadaPal Beta：校园全能好朋友入口

## 目标与边界

- **现有版本保持不变**：`/DadaPal/` 继续是当前的「画像收集 → 找搭子/找群 → 候选人 → 双人群」体验；不在本轮重构主流程。
- **新增独立 Beta**：`/DadaPal/beta/` 仍采用 Dada 的聊天入口，但不只做匹配。它是一个校园全能好朋友：找搭子仍是主任务，也能把用户带到校园 SBTI、个人资料卡、校园塔罗、答案之书（后续）与好友默契度。
- **用户测试优先**：第一版可以使用浏览器本地状态、预置 mock 好友和 mock 结果，先验证入口理解、卡片点击率、问卷完成率和分享/默契度玩法是否有吸引力；不在测试首版要求完整社交图谱或真实匹配。
- **保留现有架构原则**：任何对自由文本的理解、功能意图识别和回复措辞都由模型完成。前端/后端代码只执行模型返回的明确 action，不通过关键词或正则猜测用户想做什么。

## 对新 HTML 原型的理解

原型文件 [dada-campus-card-mobile-mock.html](../dada-campus-card-mobile-mock.html) 已经定义了一套可复用的视觉语言和三条裂变路径：

1. **校园人格名片 / SBTI**
   - 轻松选择题 → 人格角色、DADA-ID、标签、真实资料与好友辣评。
   - 核心价值：让用户先获得可分享的自我表达资产，再反哺匹配质量。
2. **校园命运牌 / 塔罗**
   - 用户提问 → 三张牌（起点/触发/走向）→ 简短解读。
   - 原型中已有“发给好友抽取加注牌”的闭环，适合作为分享裂变入口。
3. **好友剧情 / 老友预言**
   - 原型已有好友视角、加注卡和预言文案。
   - Beta 要把它升级为双方已有资料/SBTI 后的“默契度测试”，而非只有单向评论。

视觉可直接迁移的元素：奶油纸张底、薄荷/珊瑚/柠檬色、方圆角、棋盘格纸纹、粗边框与硬阴影、像素人物/卡牌、校园轻松文案。React 版应提炼为样式与组件，不应嵌入或 iframe 该完整 HTML。

## 当前 DadaPal 适合的接入点

### 前端

- [apps/web/src/App.tsx](../apps/web/src/App.tsx)：目前把聊天壳、消息数据、阶段流转、资料问卷和群聊渲染集中在一个组件中。已有 `MiniProgramCard`、`ProfileCardMessage`、`CandidateCardMessage` 和按会话存储消息的 `messagesByConversation`。
- 当前小程序卡片的 `target` 只有 `questionnaire` 与 `handoff`，可以扩展为 Beta feature target 并保留现有 `questionnaire` 行为。
- [apps/web/src/App.css](../apps/web/src/App.css)：当前是仿微信风格；Beta 可新增独立的 `BetaApp`/`beta.css`，避免影响主版本。
- [apps/web/vite.config.ts](../apps/web/vite.config.ts)：已使用 `/DadaPal/` 作为部署基路径。要可靠支持静态的 `/DadaPal/beta/`，需要把 Beta 做成 Vite 多页面入口（例如 `apps/web/beta/index.html`），而不是只依赖 SPA 路由回退。

### 后端

- [apps/api/app/main.py](../apps/api/app/main.py)：已有会话、消息、`/profile/extract` 和 `ChatReply(action, payload, next_stage)` 的 API 边界。
- [apps/api/app/bot_engine.py](../apps/api/app/bot_engine.py)：已有模型 intent 分类、模型画像提取和 action 驱动的确定性阶段推进。Beta 应在这个层增加 feature-routing action，而不是在浏览器里解释用户原话。
- [apps/api/app/schemas.py](../apps/api/app/schemas.py) 与 [apps/api/app/models.py](../apps/api/app/models.py)：已有 `ProfileDraft` 与数据库会话/消息表；需要增加可持久化的 SBTI、塔罗和兼容度数据模型。

## 推荐 Beta 用户体验

### 1. Beta 开场聊天入口

开场不先强迫用户填资料，而是说清楚 Dada 的能力：

> 我还是可以帮你找搭子、找人和找群；也可以先捏一张校园 SBTI、做你的资料卡、抽一把校园塔罗，或者测你和朋友像哪种搭子。你今天想玩哪个？

界面同时放 4 个快捷入口卡：

- 找搭子 / 找朋友（主匹配能力）
- 做校园 SBTI
- 抽校园塔罗
- 测好友默契度

答案之书不在首轮做成功能入口；放在“即将解锁”区或由 Dada 回答“答案之书还在装订中，之后开放”，避免用户测试中遇到半成品。

### 2. 自由文本到功能卡的模型路由

用户可说“我想测测我是什么人格”“帮我抽一下爱情”“我和室友合不合”“想认识创业的人”。后端模型根据完整上下文返回一个明确的 Beta action：

| 模型 action | 聊天中的卡片 | 打开的页面 |
| --- | --- | --- |
| `open_match_flow` | 匹配入口 | 复用/进入当前资料与匹配流程 |
| `open_sbti` | 校园 SBTI 小程序卡 | SBTI 问卷与人格卡 |
| `open_profile_card` | 我的校园名片卡 | 编辑资料与名片预览 |
| `open_tarot` | 校园命运牌卡 | 问题输入、三牌与解读 |
| `open_compatibility` | 好友默契度卡 | 好友 ID 输入与默契报告 |
| `answer_book_backlog` | 非可点击的“即将解锁”卡 | 不跳转 |

代码只根据 action 渲染相应卡片；模型未识别到时，Dada 自然追问或展示能力菜单。不得用“塔罗”“朋友”“测试”等关键词分支判定。

### 3. 校园 SBTI + 个人资料

SBTI 不是直接复制传统 MBTI，而是 Dada 的校园社交人格标签：

- 题目使用 8–12 个轻量校园情境选择题：第一顿饭、社团破冰、项目组队、周末、冲突、社交充电方式等。
- 每个答案为结构化 option id；模型结合答案和用户填写的资料，输出：`sbti_code`、角色名、三到五个趣味标签、社交能量、适合认识的人、避雷沟通建议与 1–2 句校园风格解释。
- 生成一个可分享的 DADA-ID，例如 `DADA-7QF2`。真实实现应由后端随机且可查重；用户测试阶段可使用稳定 mock id。
- 个人资料卡显示基础信息、兴趣/技能、角色标签和可控公开字段。用户应能选择哪些字段会进入好友默契度与匹配。

### 4. 校园塔罗

- 选择题库问题或输入自由问题。
- 三张卡固定含义：起点 / 触发 / 走向；卡面使用原型的校园物件（食堂盲盒、图书馆空位、雨天共伞、操场夜风、黑客松泡面等）。
- 抽牌应可采用后端随机种子；模型根据问题、抽到的结构化卡牌和可选的 SBTI/profile 写轻松解读。
- 结果页有分享卡和“请老友加一张牌”链接。首轮测试可在同一浏览器/链接里使用 mock 好友身份。

### 5. 好友默契度（重做后的核心裂变玩法）

前提：发起人已经完成 SBTI 和至少一份可公开的资料卡。

流程：

1. 发起人在 Beta 聊天里打开“好友默契度”。
2. 页面展示自己的 DADA-ID，输入朋友的 DADA-ID。
3. 测试期的 mock directory 可识别少量预置 ID；之后按后端真实 profile/SBTI 查询。找不到时给出明确 mock 提示，而不是假装真实存在。
4. 后端用双方结构化 profile/SBTI，生成：
   - `score`：0–100 的默契度；
   - `pair_type`：独特的校园搭子类型，例如「夜跑策划组」「食堂盲盒共同体」「PPT 救火双人组」「灵感夜班车」；
   - `visual_recipe`：可重复生成的视觉元素（两种主色、两枚校园图标、轨道/拼图/双卡形状）；
   - `headline`、`why_it_works`、`friction_point`、`first_mission`：基于双方资料与人格的轻松分析。
5. 页面以“**双人校园轨道图**”呈现：两张人格小卡绕同一个校园地标运行；轨道交汇形状和图标由 `pair_type/visual_recipe` 决定。它既像星座配对又不像普通雷达图，适合截图分享。
6. 结果页给一个低成本行动建议，例如“约一局桌游/去某个校园活动/一起把项目点子讲 10 分钟”。

隐私规则：默认只使用用户勾选公开的字段；结果只解释关系维度，绝不暴露对方未公开的姓名、学院、联系方式或原始答案。

## 技术实施顺序

### Phase 0：Beta 路径与共用壳（先做）

1. 新建 Vite 多页面入口 `apps/web/beta/index.html`，它加载新的 `src/beta-main.tsx`。
2. 新建 `BetaApp.tsx` 与 `beta.css`；现有 `App.tsx` 和主入口不改行为。
3. 使用共享的 `FeatureLinkCard` 消息类型：聊天中可以把能力作为可点击链接卡展示。
4. 构建产物必须同时包含根 `index.html` 与 `beta/index.html`，确保 GitHub Pages 直接访问 `/DadaPal/beta/` 不需要服务器 rewrite。

**验收**：主站体验无变化；Beta URL 直接打开可用，并能回到主站。

### Phase 1：可测试的前端 feature 模块

实现 `features/` 下的独立组件与本地测试适配器：

- `SbtiExperience`：问卷、资料编辑、人格卡与 DADA-ID；
- `TarotExperience`：抽牌、解读、分享；
- `CompatibilityExperience`：输入 mock ID、双人校园轨道图和报告；
- `AnswerBookTeaser`：只显示 backlog/coming soon，不假装完成。

本期的状态可先存 `localStorage`（带版本键，例如 `dadapal-beta-v1`），并提供“重置测试数据”按钮，方便用户测试重复跑流程。

**验收**：不接后端时，测试者能从聊天卡完成三项玩法并看到稳定、可分享的结果。

### Phase 2：Beta 聊天 orchestration

1. 扩展 `ChatItem` 与小程序卡为 feature-aware card，而非为每个功能复制渲染逻辑。
2. 在后端增加 `beta` stage 与模型 action schema；模型的任务是：理解需求、选择已有 feature 或匹配流程、给简短自然回复。
3. 前端收到 `open_*` action 时渲染卡片；点击后打开相应 Beta feature。所有自由文本只传给模型做理解。
4. 保留“找搭子/找人”作为默认主任务，并让它可以复用已填写的 SBTI/profile 作为更丰富的匹配画像，而非重新问一遍。

**验收**：从自然语言和快捷入口进入同一个功能；模型无法决定时不会错误跳转。

### Phase 3：后端持久化与生成

建议新增表/数据对象：

- `beta_profiles`：session/user、资料、公开字段、DADA-ID；
- `sbti_results`：profile id、结构化答案、code、角色、标签、生成版本；
- `tarot_readings`：profile id、问题、随机 seed、三张 card id、解读、分享 token；
- `compatibility_reports`：source profile、target profile/mock id、score、pair type、visual recipe、分析、生成版本；
- `feature_events`：feature opened/completed/shared，用于测试分析。

后端新增结构化 endpoint，例如：

- `POST /beta/sbti/results`
- `GET /beta/profile/me`
- `POST /beta/tarot/readings`
- `POST /beta/compatibility/reports`
- `GET /beta/mock-friends/{dada_id}`（测试期）

模型调用输出必须走 Pydantic schema 验证；卡牌、分数范围、视觉 recipe、公开字段过滤由代码校验。模型可以写文案和解释，不直接泄露原始资料。

### Phase 4：用户测试与迭代

建议记录：入口来源、卡片曝光/点击、问卷开始/完成、功能完成、分享点击、mock 好友 ID 尝试、默契报告生成、回到匹配的比例与失败原因。

第一轮重点问题：

1. 用户是否理解 Dada 同时是“找人”和“校园玩法入口”？
2. 哪个卡最愿意点：SBTI、塔罗、默契度还是匹配？
3. SBTI 结果是否愿意截图或分享？
4. 默契度的“配对类型 + 双人校园轨道图”是否比单一分数更有趣？
5. 用户是否自然理解 DADA-ID 与资料公开范围？
6. 功能过多是否稀释了“找搭子”主价值？

## 暂不实现 / Backlog

- **答案之书**：保留能力位和文案，但不在 Beta MVP 实现。下一轮可设计为“问题 → 一句校园答案 + 可分享的随机页码/书签”。
- 真实好友邀请、实名用户目录、跨设备同步。
- 真实匹配算法、真实线下商家、优惠券核销。
- 复杂的社交权限、举报、审核与内容安全体系。

## 关键风险与决策

- **GitHub Pages 是静态预览**：它无法运行 FastAPI/OpenRouter。因此 Beta 的首轮可使用本地 mock adapter；部署真实模型功能前，需要一个公开 API 服务，并通过 `VITE_API_BASE_URL` 指向它。
- **直接访问 `/DadaPal/beta/`**：必须有 `beta/index.html` 静态入口；纯单页路由在 GitHub Pages 刷新会 404。
- **结果一致性**：同一份答卷/相同双人 profile 应返回稳定结果；后端保存 seed 与结果，避免每刷新一次都变一个人格或默契度。
- **“校园 SBTI”命名**：页面可用“校园 SBTI / 校园社交人格”作为体验名，但应避免宣称心理测量或专业人格诊断；文案定位为轻松社交玩法。
- **资料与隐私**：Beta 的分享/默契度只能使用用户主动公开的资料；mock 结果必须清楚标识为测试数据。

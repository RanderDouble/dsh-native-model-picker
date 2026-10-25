# dsh-native-model-picker

独立的 DSH 三级模型选择器。数据来自宿主的 `modelDirectories` 服务：每个会话一个 `ModelDirectory`，它的 store 里是全量渠道与模型（含说明与推理等级），`current` 给出当前 `{provider, model, reasoningEffort}`，`select()` 完成切换。插件只做展示、收藏与交互，卡片挂在 body 直下，样式自带（`dsh-nmp-*` 类）。

## 三级结构

- **一级（收藏页）**：顶部搜索框（匹配渠道名或模型名），下方按渠道分组展示收藏；点渠道行星标整组收藏，点模型行星标单收藏，整组内再点某模型行星标即从该组隐藏它。底部 footer 一格显示当前模型与描述小字，点击进入二级渠道列表。
- **二级（渠道列表）**：每个渠道一行（名称 + 星标 + 箭头），无搜索框，底边贴主卡底边，内容超出内部滚动。悬浮渠道行延迟滑出三级卡，移出延迟收起；点击渠道行展开并钉选（失焦不关），再点或 Escape 收起。
- **三级（渠道内模型）**：右缘贴二级卡左缘，列出该渠道全部模型，当前模型行打勾，点模型行即调用目录的 `select()` 完成切换。

## 推理等级

触发按钮同行右侧是推理等级入口（`dsh-nmp-effort-btn`），按钮文字是当前档位名，宽度按该模型最长档名预留。点击打开滑块弹层（`dsh-nmp-effort-pop`）：标题为当前档位名，两端是「更快」「更强」，轨道是 `role="slider"`，刻度按 `reasoning.efforts` 的档位数生成。拖动、点击轨道、方向键（左右上下）、Home 与 End 都能换档，最高一档换成格子闪动。档位次序按已知等级的秩表排列（`off` 最低到 `ultra` 最高），宿主未给 `defaultEffort` 时最前面多一档「Default」（这一档不传 `reasoningEffort`，由目录按模型默认档补齐）。换档走目录的 `select({provider, model, reasoningEffort})`，模型没有可选档位时不显示该按钮。主题自建的等级按钮与弹层由插件样式压制，主题给模型按钮预留的右侧外边距一并清掉。

## 数据与切换

`inject = ["sessions", "modelDirectories", "uiSession"]`。会话 id 取 `uiSession.current.value.key`，目录由 `modelDirectories.directoryFor(sessionId)` 提供，绑定会话时订阅一次 store 并调一次 `load()`（宿主侧有缓存与在途合并）；store 变化、切换收尾、页面 DOM 变化都会触发一次合帧重绘，会话 id 变化时换绑到新会话的目录并退订旧目录。

展示名、说明、推理等级全部取自宿主，说明小字只出现在一级卡的 footer，二三级卡的行只显示名称。说明优先用主题包 `/dsh-claude-style/model-descriptions.json` 的中文文案（按渠道名与模型名逐条正则匹配，与主题同一套 `families` / `tiers` 规则），未命中时回落到宿主的英文 `description`。品牌图标从主题 bundle 运行时提取 SVG 资产表与 `brands.models` 规则表，把型号名称里的品牌词替换成图标；主题不在场时没有图标，名称为纯文本。

目录 key 是「渠道名::模型名」；同渠道内显示名重复的两条（聚合类渠道真实存在）追加「::模型 id」区分，收藏数据沿用同一形态，目录收缩后自动清理已消失渠道与模型的记录。

## 接管

触发按钮是 `button[aria-label*="选择模型"]`，可能同时存在原生按钮与主题克隆按钮，点击与指针按下都由 document capture 层拦下并开合自建主卡；指针按下层面的拦截同时压掉原生面板在按下瞬间的渲染。主题自带的 `dsh-claude-model-popover` 弹层由插件样式表压制。收藏数据存 localStorage（`dsh-nmp-pins-v1`，`{sources:[渠道名], models:["渠道::模型"], hidden:["渠道::模型"]}`）。

## 测试

```
node test/run.mjs
```

jsdom 行为测试 94 项断言，夹具按宿主的 `ModelDirectory` 语义建模（`select` 置 selecting → 调 `sessions.selectModel` → 成功置 ready 并重算快照、失败写入 error），覆盖：注入声明、样式与主题弹层压制、触发按钮接管与指针压制、目录绑定与 store 订阅、会话切换换绑、footer 当前模型与说明、推理等级按钮与滑块弹层（刻度、aria 值、方向键与 End、末档格子矩阵、ghost 换档动画、菜单语义、悬浮开合、拖出提交、Escape 收起）、二级与三级卡开合钉选悬浮、搜索、收藏与隐藏、切走时的 `select` 调用与对勾、同渠道同名两条的 key 消歧、切换失败分支、消失渠道清理、Escape 逐级收起、dispose 交还原生接管并退订。

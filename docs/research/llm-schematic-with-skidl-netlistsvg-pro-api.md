---
title: LLM 原理图生成提升（SKiDL + netlistsvg/ELK + 嘉立创EDA Pro API）
---

# LLM 原理图生成提升（SKiDL + netlistsvg/ELK + 嘉立创EDA Pro API）

这份调研的目标：**对照 `pro-api-sdk` / `@jlceda/pro-api-types` 已暴露的能力**，说明如果把 “LLM 直接画图” 改为 “LLM 生成意图 → 结构化校验 → 自动布局/走线 → 落地到 EDA”，原理图生成能力可以提升在哪些点。

## 1) Pro API（SDK）里与“自动生成原理图”最相关的能力

从 `@jlceda/pro-api-types` 看，原理图自动化需要的能力基本齐全（缺的主要是“自动布局/自动走线策略”，这正好由 netlistsvg/ELK 补齐）：

### 文档/图页管理（创建载体）

- 创建原理图：`eda.dmt_Schematic.createSchematic()`
- 创建图页：`eda.dmt_Schematic.createSchematicPage()`
- 命名/排序：`eda.dmt_Schematic.modifySchematicName()`、`modifySchematicPageName()`、`reorderSchematicPages()`

### 器件库检索（把“文本需求”落到“真实器件/符号”）

- 搜索器件：`eda.lib_Device.search()`
- 通过 LCSC 编号获取器件：`eda.lib_Device.getByLcscIds()`（注意：类型注释里提到私有化环境可能不可用）

### 图元创建/编辑（真正把图画出来）

- 放器件：`eda.sch_PrimitiveComponent.create(component, x, y, subPartName?, rotation?, mirror?, addIntoBom?, addIntoPcb?)`
- 生成电源/地等网络标识：`eda.sch_PrimitiveComponent.createNetFlag()`
- 生成网络端口：`eda.sch_PrimitiveComponent.createNetPort()`
- 画导线：`eda.sch_PrimitiveWire.create(line, net?)`（`line` 是多段线坐标组）
- 查器件引脚坐标（用于“把线接到 pin 上”）：`eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId()`

### 验证/回归（让“生成”变成闭环，而不是一次性碰运气）

- DRC：`eda.sch_Drc.check(strict?, userInterface?)`
- 导出网表：`eda.sch_Netlist.getNetlist(type?)`
- 辅助定位：`eda.sch_SelectControl.doCrossProbeSelect(components?, pins?, nets?, highlight?, select?)`

## 2) SKiDL 能为 LLM 带来的提升点（从“画图”提升到“表达电路意图”）

LLM 直接调用 Pro API 画图时，最难的不是 `create()` 本身，而是：

- **连接正确性**：哪些引脚必须同网？哪些必须隔离？电源/地/敏感模拟网如何命名与复用？
- **可验证性**：生成错了怎么定位到具体哪个 pin/哪条 net？

SKiDL 的价值在于把“原理图生成”拆成更稳的两层：

1) **先生成可执行的电路描述（Circuit / Nets / Parts）**，并让工具产出网表作为“真值”；LLM 的输出从“坐标 + 画线”转为“连接关系 + 约束”。
2) 用网表去驱动后续的布局/画图，并把 Pro API 导出的网表与 SKiDL 网表做 diff，形成自动回归。

对照 Pro API，这相当于：

- SKiDL 负责产出/维护“应有网表”（期望）。
- Pro API 的 `eda.sch_Netlist.getNetlist()` 负责给出“实际网表”（结果）。
- 两者比较 → 定位错连/漏连，再用 `doCrossProbeSelect()` 高亮到画布上。

## 3) netlistsvg/ELK 能为 LLM 带来的提升点（解决“布局/走线”这个 LLM 最不擅长的部分）

netlistsvg 的核心能力不是“画得像”，而是它把网表当图（graph）处理，并借助 **ELK（elkjs）** 做：

- **自动布局**：给每个节点（器件/模块）算出 `x/y`，做分层/对齐/间距等。
- **边路由**：给每条连接（net）算出折线/路径（可转成 EDA 的多段线）。
- **可复现**：同样输入得到相对稳定的布局结果，方便增量更新与 diff。

对照 Pro API，这正好对应：

- `eda.sch_PrimitiveComponent.create()` 的 `x/y/rotation`：由 ELK 输出的布局决定
- `eda.sch_PrimitiveWire.create(line, net?)` 的 `line`：由 ELK 输出的 routed edge 决定

一句话：**让 LLM 负责“电路意图与约束”，让 ELK 负责“几何与排版”。**

## 4) 组合后的推荐闭环（Intent → Verify → Layout → Apply → Verify）

下面给出一个对照 Pro API 可落地的工作流（可以跑在 MCP/本地脚本侧，最终只把“放置/画线指令”交给 Pro API 执行）：

1) LLM 解析需求 → 输出结构化电路意图（SKiDL 代码/JSON 都可）
2) SKiDL 生成目标网表（Ground Truth）
3) 把网表转成 netlistsvg/ELK 输入 → 得到器件坐标、端口相对位置、连线折线
4) Pro API 落地：
   - `createSchematic()` / `createSchematicPage()` 建图
   - `lib_Device.search()` / `getByLcscIds()` 锁定器件
   - `sch_PrimitiveComponent.create()` 放器件；必要时 `modify()` 写入 `designator/uniqueId/...`
   - `sch_PrimitiveWire.create()` 走线；电源/端口用 `createNetFlag()` / `createNetPort()`
5) Pro API 回归验证：
   - `sch_Drc.check()` 做基础电气一致性检查
   - `sch_Netlist.getNetlist()` 导出实际网表并与 SKiDL 网表对照
   - 不一致时用 `doCrossProbeSelect()` 高亮问题网/问题引脚，进入下一轮修复

## 5) “可能提升点”清单（对照 Pro API 能力）

### A. 连接正确性（最重要）

- **提升点**：错连/漏连显著下降；网络命名更一致；电源/地更稳定
- **原因**：SKiDL 把“连接关系”作为第一性输出，并可作为回归真值
- **Pro API 支撑**：`sch_Netlist.getNetlist()` + `sch_Drc.check()` + `doCrossProbeSelect()`

### B. 自动布局与可读性

- **提升点**：组件分组更合理、走线更整洁、整体风格更一致；减少“人眼不可读”的成品
- **原因**：ELK 对图布局/层次化布置比 LLM 更稳定；且可给出可复现坐标
- **Pro API 支撑**：`sch_PrimitiveComponent.create()`（x/y/rotation）+ `sch_PrimitiveWire.create()`（多段线）

### C. 可增量更新（少删少画）

- **提升点**：小改动只改局部，原理图不会每次“重画一遍”；更适合多轮对话迭代
- **原因**：有了“网表真值 + 布局结果”，可以做 diff 后调用 `modify()` 而不是 delete+recreate
- **Pro API 支撑**：`sch_PrimitiveComponent.modify()`、`sch_PrimitiveWire.modify()`（以及用 `uniqueId` 做映射）

### D. 器件/引脚一致性（减少“选错符号/引脚号对不上”）

- **提升点**：能把“器件选择”从语言任务变成检索任务；并把连线端点绑定到真实 pin 坐标
- **原因**：Pro API 能查到器件与引脚信息；SKiDL 端可做规则检查/映射表校验
- **Pro API 支撑**：`lib_Device.search()` / `getByLcscIds()` + `sch_PrimitiveComponent.getAllPinsByPrimitiveId()`

### E. 可解释/可审计（工程团队更愿意用）

- **提升点**：从“黑盒画图”变成“有中间产物（网表、布局、diff 报告）”的流程，容易 Review
- **原因**：SKiDL/网表/ELK 布局都是可保存、可回放、可 diff 的
- **Pro API 支撑**：`sch_Netlist.getNetlist()`、`sch_ManufactureData.getNetlistFile()`（结合 `sys_FileSystem.saveFile()` 导出）

## 6) 限制与注意事项（避免预期过高）

- netlistsvg 更偏“数字逻辑网表到图”的范式：模拟电路（运放反馈、差分、射频）可能需要额外约束/模板化布局规则。
- Pro API “画线”依赖坐标落点与网络归属规则（`sch_PrimitiveWire.create()` 的 net 合并逻辑很严格）：布局/路由输出必须保证端点落在目标 pin/线段上，否则会创建失败或落到错误网络。
- LCSC 检索接口在私有化环境可能受限：需要准备离线器件库映射或自建索引。

## 7) 建议的 MVP 路线（从易到难）

1) 先只引入 SKiDL：把“目标网表”稳定下来，并用 Pro API 网表回归验证（不做自动布局/走线）
2) 再引入 ELK 做“器件布局”（只输出器件 x/y），走线先用简单的曼哈顿网格策略
3) 最后把 ELK/ netlistsvg 的 edge routing 也落地到 `sch_PrimitiveWire.create(line)`，再加增量 diff 更新


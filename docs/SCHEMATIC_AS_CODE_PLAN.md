# Schematic-as-Code（原理图即代码）方案与开发计划

目标：让 **LLM 或用户** 以“接近编程”的体验来创建/修改嘉立创 EDA Pro 原理图，效果对标 `_refs/ytb_tutorials` 中 **Keysight ADS DE Python API** 的“原理图面向代码编辑”工作流：**写代码/DSL → 一键运行 → 原理图生成/增量更新 → 校验/截图 → 可回滚/可复现**。

> 本文是计划文档：只描述设计与里程碑，不实现代码。

配套 Demo（“实现后”的调用效果）：`docs/SCHEMATIC_AS_CODE_DEMO.md`

---

## 1. 背景与现状（本仓库已经具备的地基）

`jlc-eda-mcp` 当前已经具备“原理图可编程化”的关键基础：

- **桥接方式**：EDA 扩展作为 WebSocket 客户端，用户侧用 `websocat` 临时充当 WS 服务端（短驻/按需启动）。
- **结构化工具集（推荐入口）**：`tools.list` / `tools.call` 形式的 `jlc.*` tools。
- **批量/增量绘制核心**：`jlc.schematic.apply_ir` + `SchematicIR v1`（见 `docs/SCHEMATIC_IR.md`）。
  - 支持 upsert（同 id 更新）、可选删除 patch、可选 DRC/save/capture。
  - 扩展内部维护 `schematicMap`（id → primitiveId）以支撑多回合增量修改。
- **读回能力**：`jlc.schematic.snapshot`、`list_components/list_wires/list_texts`、`verify_netlist/verify_nets` 等（见 `docs/ROADMAP.md`、`docs/VERIFY_NETS.md`）。

结论：**“原理图即代码”的底层执行面（apply + readback + verify）已存在**，缺的是“像 ADS 一样好用的编程体验层”。

---

## 2. 目标体验（对标 ADS）

### 2.1 用户体验目标

1) 用户/LLM 写一个“原理图代码文件”（DSL/脚本）  
2) 运行一次命令（或一次 LLM 工具调用）  
3) EDA 里原理图自动生成/增量更新  
4) 自动输出：DRC 结果、网表校验、截图/结构化快照  
5) 多回合修改时 **稳定定位对象**，不“迷路”也不“重画一遍”。

### 2.2 工程目标

- **可复现**：同一输入在同一环境生成同样的原理图（确定性）。
- **可版本化**：代码/DSL 文件进 Git；EDA 画布是“渲染结果”。
- **低依赖**：不要求用户安装 Node/MCP；优先只依赖 `websocat`（可选 Python）。
- **多窗口**：支持 2–10 个 EDA 窗口并行，不需要用户手填端口。

---

## 3. 总体架构（分层：IR 执行面 + 编程体验层）

### 3.1 分层概览

1) **Transport（传输层）**  
   - `websocat ws-l:127.0.0.1:905x` 临时服务端
   - EDA 扩展连接并进行 RPC（`hello`/`request`/`response`）

2) **Tool API（稳定能力层）**  
   - 只用 `jlc.*` tools（例如 `jlc.schematic.apply_ir` / `snapshot` / `verify_*`）
   - `jlc.eda.invoke` 仅作开发兜底，默认不让 LLM 依赖（安全/可维护性）

3) **SchematicIR v1（低阶可执行 IR）**  
   - 坐标级 primitives + connections + post（DRC/save/capture）
   - 支持增量 patch（delete）与 id 稳定映射

4) **SAC（Schematic-as-Code）编程体验层（本计划新增）**  
   - 高阶 DSL/脚本：以“器件 + 连接关系 + 布局约束”为主，尽量不写坐标
   - 编译器：SAC → SchematicIR（自动布局/自动走线/网标策略）
   - Runner：端口自动发现 + 一键 apply + verify + capture
   - SDK façade（Python/Node）：提供类似 `keysight.ads.de` 的 `Session/Schematic/Transaction` 调用体验（隐藏 JSON/RPC）

### 3.2 为什么需要“高阶 DSL”

`SchematicIR` 很适合“批量执行”，但对 LLM/人类来说 **写坐标与线段很痛**。  
ADS 的 DE API 虽然也用坐标，但通常配合函数封装/布局策略，写起来像“摆件并连接”。  
因此需要一个“更语义化”的 SAC 层，把用户意图（模块/网络/端口）转成可执行 IR。

---

## 4. SAC 规格草案（建议的“原理图代码”模型）

### 4.1 最小可用（MVP）数据模型

- `parts[]`：器件（通过 `search_devices` 或显式 UUID 引用）
- `nets[]`：网络（以 `NetLabel` 为主，符合 `docs/SCHEMATIC_STYLE.md`）
- `connect[]`：连接（`U1.1 -> R1.2` / `U1.VCC -> net:3V3`）
- `layout`：布局策略（网格、分组、相对定位、对齐/等距）
- `pages`：可选，多页时指定目标页

### 4.2 示例 DSL（示意）

> 这只是草案，用于说明“像写代码一样”的目标体验。

```yaml
version: 0
page: { ensure: true, schematicName: Demo, pageName: Power }

parts:
  - id: J1
    search: "USB Type-C 16P"
    at: [0, 0]
  - id: U1
    search: "CH224K"
    rightOf: J1

nets:
  - name: VBUS
    connect: [J1.VBUS, U1.VBUS]
  - name: GND
    connect: [J1.GND, U1.GND]

rules:
  netlabel: attach_pin   # 优先用“短导线 + NET 属性”
  wireStyle: manhattan
```

编译器负责：
- 把 `search` 解析为 `deviceUuid/libraryUuid`（可缓存/可人工钉死 UUID）
- 把 `rightOf`/`at`/`layout` 变成坐标
- 把 `connect` 变成 `connections[]` 或 `netlabel.attach_pin` + 短导线策略

---

## 5. Runner 设计（让“运行一次”像编程）

Runner 的职责是把“像写代码一样”的体验落实为一条命令：

### 5.1 Runner 输入输出

- 输入：
  - `*.sac.yaml`（高阶 DSL）或 `*.schir.json`（低阶 IR）
  - 目标工程选择（按 project name/uuid，或“当前焦点窗口”）
  - 可选：`--dry-run`（只编译不 apply）
- 输出：
  - `apply` 返回值（创建/更新了哪些 id）
  - `verify` 报告（网表/连通性）
  - `capture` 图片（或 base64 由 LLM 落盘）

### 5.2 端口自动发现（多窗口）

目标：**不让用户手工报端口**。

建议策略（按可靠性排序）：
1) 扫描 `9050-9059`，抓 `hello` 里的 `project.uuid/name/friendlyName/server.port`，建立映射。  
2) 若已连上任意端口，可调用 `jlc.bridge.port_leases` 得到当前租约列表，再锁定目标窗口端口。  
3) 兜底：提示用户在扩展 `Status` 面板确认端口（极少数场景）。

### 5.3 批量执行原则（性能关键）

- 尽量把一次编辑 **压缩成一次 `jlc.schematic.apply_ir`**（减少握手、减少 UI 卡顿）。
- 读回尽量用 `snapshot(includeWires:false)` + 按网名精准 `list_wires`，避免全量 wires 造成慢与大返回。

---

## 6. 实现路线图（只列“可验收的交付物”）

> 版本号仅示意，可按实际节奏调整。

### Phase 0：文档与范式固化（1–2 天）

- 补一份 “SAC 工作流说明”：
  - 如何从 `SchematicIR` 起步
  - 如何稳定命名 id（`U1/R1/...`）
  - 如何做分步提交与 verify/capture
- 补 2–3 个可复用示例：
  - 集总滤波器/电源模块/USB-UART（对标 ADS tutorial 的可复现实例）

验收：新人只看文档就能在 10 分钟内跑通“写 IR → apply → verify → screenshot”。

### Phase 0.5：SDK façade（更接近 Keysight 的编程体验）

- Python/Node 提供 `Session/Schematic/Transaction`：
  - 单次启动即保持一个 WS 会话（避免“一次调用起一次 websocat”）
  - `transaction()` 聚合操作 → 一次 `apply_ir` 提交
  - 自动布局/相对约束：`grid/origin/spacing` + `rightOf/leftOf/above/below` + `align`
  - 更完整对象模型：`Design/Instance/Wire/Pin`（用于读回/调试/二次编辑）
  - 支持 `connect_auto()` 扫描 `9050-9059`，按工程名选择窗口

验收：用户能写出“像 Keysight 一样”的脚本：`place/connect/label/verify/capture` 全部是方法调用，且一次脚本执行完成闭环。

### Phase 1：SAC DSL（MVP）+ 编译器（3–7 天）

- 定义 `*.sac.yaml` 规范（上面的 MVP 模型）
- 实现编译器：SAC → SchematicIR
  - 基础布局：网格/相对定位（rightOf/below/align）
  - 基础连线：自动 Manhattan + `netlabel` 策略
  - 器件解析：`search_devices` → UUID（支持锁定/缓存）

验收：同一份 `sac.yaml` 在不同机器生成一致 IR；能重复 apply 并增量更新。

### Phase 2：Runner（跨平台）+ 一键运行（3–5 天）

- 提供 runner（优先 Python：零依赖 websocket，或“spawn websocat”模式）
- 集成端口发现、apply、verify、capture
- 设计 `--dry-run/--plan` 输出（让 LLM 在 apply 前可审阅）

验收：`runner run demo.sac.yaml --project xxx` 一条命令完成全流程。

### Phase 3：Round-trip（导出与对比）（5–10 天）

- `export_ir`：把当前页/选区导出为 `SchematicIR`（用于“从手画迁移到代码”）
- `diff`：SAC/IR 与当前原理图快照对比（最小变更集）
- 失败定位：verify 失败时自动 `crossprobe_select + indicator` 标点/高亮

验收：手工改动后能被 diff 捕捉到；LLM 能基于 diff 做最小修复。

### Phase 4：高级体验（按需）

- 层级/多页工程：模块化导入、跨页端口策略
- 美观布局：自动对齐/等距、避让（参考 `docs/ROADMAP.md` 的 P3）
- 参数化/生成式：支持 `for/if`、模板实例化（更像“代码”）

---

## 7. 风险与开放问题

- **API 稳定性**：部分 EDA API/行为可能为 `@beta` 或随版本变动；需要在工具层做兼容与降级。
- **布局/走线复杂度**：高级自动布局很难一次到位，建议先用“可控的简单启发式 + 允许人工微调”。
- **库搜索不确定性**：仅凭关键字匹配可能选错器件；需要“锁定 UUID”与缓存机制、或交互确认。
- **并发与多窗口**：Runner 必须明确“目标工程/窗口”，避免把修改 apply 到错误窗口。

---

## 8. 与现有文档的关系

- 低阶执行面：`docs/SCHEMATIC_IR.md`
- 绘图偏好：`docs/SCHEMATIC_STYLE.md`
- 能力路线：`docs/ROADMAP.md`
- 协议与 RPC：`docs/PROTOCOL.md`、`docs/EDA_EXTENSION_RPC.md`

SAC 的目标不是替代这些文档，而是把它们封装成“像 ADS 一样可编程的一键体验”。

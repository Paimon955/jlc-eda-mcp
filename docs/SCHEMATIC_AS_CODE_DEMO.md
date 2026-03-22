# Schematic-as-Code Demo（Python / Node.js：像写代码一样操作原理图）

对标 `_refs/ytb_tutorials`（Keysight ADS DE Python API）的“原理图面向代码编辑”体验：  
这里给出 **Python / Node.js** 两个 Demo（仍然使用 `websocat` 作为短驻 WS Server），实现以下闭环：

- 连接到 EDA 扩展（WS 握手后发 RPC）
- 确保在原理图页
- 搜索器件
- 批量放置（`apply_ir`）
- 连线 / 打网标（NetLabel = wire.NET）
- 导出/读取网表并做“单元测试式”验证
- 截图（base64）并落盘到当前目录
- 清空原理图（安全/危险两种模式）

> 说明：之所以不直接“纯 Python websockets”起服务端，是为了保持用户侧依赖极简：只需要 `websocat`。  
> 你也可以后续把 `websocat` 替换成 Python/Node 的 WS server（见 `docs/SCHEMATIC_AS_CODE_PLAN.md`）。

---

## 0) 前提

1) 已安装并启用 EDA 扩展 `jlceda-mcp-bridge`  
2) 扩展配置 `ws://127.0.0.1:9050`（多窗口时会在 `9050–9059` 范围内自动协商端口）  
3) 本机已安装 `websocat`，终端可执行 `websocat --version`

---

## 1) 多窗口端口（可选但强烈推荐）

如果你开了多个工程窗口，先确定“要操作哪个窗口”的端口。

先连任意一个端口（例如 `9050`）并列租约：

```bash
printf '%s\n' '{"type":"request","id":"1","method":"tools.call","params":{"name":"jlc.bridge.port_leases","arguments":{}},"closeAfterResponse":true}' \
  | websocat -B 10485760 -t --no-close --oneshot ws-l:127.0.0.1:9050 -
```

看返回的 `hello.project.*` / `result.data.leases[]`，选中你要的工程窗口对应端口，然后把下面 Demo 的 `--port` 改成它。

---

## 2) 推荐：Python SDK（更接近 Keysight 的“事务式”体验）

这个仓库里已经提供了一个轻量 Python SDK：`jlceda_sac`（无第三方依赖，底层仍然调用 `websocat`）。

特点（对标 Keysight）：

- `connect(...)` → `EdaSession`
- `schematic(...).transaction()`：像 Keysight 的 Transaction 一样 **先声明操作，再一次 commit**
- `place/connect/label/verify/capture` 都是方法调用，不需要你手写 `tools.call` JSON
- 自动布局/约束：`grid/origin/spacing` + `right_of/left_of/above/below` + `align`
- 对象模型：`Design/Instance/Wire/Pin`（`design.instance("R1").pins()`）

### 2.1 直接运行内置示例（推荐）

在仓库 `jlc-eda-mcp/` 目录执行：

```bash
python -m jlceda_sac.examples.divider_demo --port 9050
```

不想手填端口（多窗口自动发现 `9050-9059`）：

```bash
python -m jlceda_sac.examples.divider_demo --port 0
```

多窗口时按工程名筛选（示例：名字里包含 `FM350`）：

```bash
python -m jlceda_sac.examples.divider_demo --port 0 --project FM350
```

输出：当前目录生成 `divider_demo.png`。

### 2.2 示例代码长什么样（摘录）

```python
import jlceda_sac.de as de

with de.connect(port=9050) as eda:
    sch = eda.schematic(schematic_name="SAC Demo", page_name="Divider")
    r_uuid = eda.library.first_device_uuid("resistor 0603", limit=5)

    with sch.transaction(units="mm", clear=True, clear_mode="mcp") as t:
        # 自动布局 / 约束：grid + right_of + align
        t.grid(2.54).origin(40, 40).spacing(30, 20)
        r1 = t.place("R1", r_uuid, designator="R1", value="10k").at(40, 40)
        r2 = t.place("R2", r_uuid, designator="R2", value="10k").right_of(r1).align_y(r1)
        t.connect(r1.pin(2), r2.pin(1), net="MID")
        t.label(r1.pin(1), net="VIN", direction="left", length=60)
        t.label(r2.pin(2), net="GND", direction="right", length=60)

    sch.verify_netlist({"VIN": ["R1.1"], "MID": ["R1.2", "R2.1"], "GND": ["R2.2"]})
    sch.capture_png("divider_demo.png")

    # 对象模型（Design / Instance / Wire）
    design = sch.design(include_wires=False)
    r1_inst = design.instance("R1")
    print("R1 pins:", [(p.pin_number, p.pin_name) for p in r1_inst.pins()][:6])
```

如果你希望进一步“更像 Keysight”（自动布局/模块化/DSL 编译），见：`docs/SCHEMATIC_AS_CODE_PLAN.md`。

---

## 3) 低阶参考：Python（无 SDK，一次运行）

把下面保存为 `demo_divider.py`，然后执行：

```bash
python demo_divider.py --port 9050
```

脚本会在当前目录输出 `divider_demo.png`。

```python
import argparse
import base64
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

WEBSOCAT = os.environ.get("WEBSOCAT", "websocat")


def rpc(
    port: int,
    method: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    req_id: str = "1",
    timeout_s: float = 15,
) -> Dict[str, Any]:
    req: Dict[str, Any] = {"type": "request", "id": req_id, "method": method, "closeAfterResponse": True}
    if params is not None:
        req["params"] = params

    cmd = [
        WEBSOCAT,
        "-B",
        "10485760",
        "-t",
        "--no-close",
        "--oneshot",
        f"ws-l:127.0.0.1:{port}",
        "-",
    ]

    try:
        p = subprocess.run(
            cmd,
            input=json.dumps(req, separators=(",", ":")) + "\n",
            text=True,
            capture_output=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"Timeout waiting for EDA extension on port {port}. Is the correct window/port selected?") from e

    # websocat stdout contains JSON lines: hello + response
    for line in reversed(p.stdout.splitlines()):
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("type") == "response" and msg.get("id") == req_id:
            if msg.get("error"):
                err = msg["error"]
                raise RuntimeError(f"{err.get('code')}: {err.get('message')}")
            return msg.get("result") or {}

    raise RuntimeError(f"No response received.\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}")


def tool(port: int, name: str, arguments: Optional[Dict[str, Any]] = None, *, timeout_s: float = 15) -> Any:
    res = rpc(port, "tools.call", {"name": name, "arguments": arguments or {}}, timeout_s=timeout_s)
    # tools.call wraps tool output in result.data
    return res.get("data", res)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9050)
    ap.add_argument("--out", default="divider_demo.png")
    args = ap.parse_args()

    port = args.port

    # 1) Ensure schematic page
    tool(port, "jlc.schematic.ensure_page", {"schematicName": "SAC Demo", "pageName": "Divider"})

    # 2) Clear MCP-managed primitives (safe). For FULL clear use clearMode="all" (danger).
    tool(
        port,
        "jlc.schematic.apply_ir",
        {
            "ir": {
                "version": 1,
                "units": "mm",
                "page": {"ensure": False, "clear": True, "clearMode": "mcp"},
            }
        },
    )

    # 3) Search a resistor device (pick first)
    search = tool(port, "jlc.library.search_devices", {"key": "resistor 0603", "limit": 5})
    items = list(search.get("items") or [])
    if not items:
        raise RuntimeError("No devices found. Try changing the search keyword.")

    device_uuid = items[0].get("uuid")
    if not device_uuid:
        raise RuntimeError("Search result has no 'uuid'. Inspect the returned items and adjust this script.")

    print("deviceUuid:", device_uuid)

    # 4) Place R1/R2 via apply_ir (batch)
    apply = tool(
        port,
        "jlc.schematic.apply_ir",
        {
            "ir": {
                "version": 1,
                "units": "mm",
                "page": {"ensure": False},
                "components": [
                    {"id": "R1", "deviceUuid": device_uuid, "x": 40, "y": 40, "designator": "R1", "name": "10k"},
                    {"id": "R2", "deviceUuid": device_uuid, "x": 70, "y": 40, "designator": "R2", "name": "10k"},
                ],
                "post": {"zoomToAll": True},
            }
        },
    )

    r1_pid = apply["applied"]["components"]["R1"]["primitiveId"]
    r2_pid = apply["applied"]["components"]["R2"]["primitiveId"]
    print("R1 primitiveId:", r1_pid)
    print("R2 primitiveId:", r2_pid)

    # 5) Connect pins: R1.2 -> R2.1 and name the net "MID"
    tool(
        port,
        "jlc.schematic.connect_pins",
        {
            "fromPrimitiveId": r1_pid,
            "fromPinNumber": "2",
            "toPrimitiveId": r2_pid,
            "toPinNumber": "1",
            "style": "manhattan",
            "net": "MID",
        },
    )

    # 6) Attach net labels (NetLabel in Pro is Wire.NET)
    tool(
        port,
        "jlc.schematic.netlabel.attach_pin",
        {"primitiveId": r1_pid, "pinNumber": "1", "net": "VIN", "direction": "left", "length": 60},
    )
    tool(
        port,
        "jlc.schematic.netlabel.attach_pin",
        {"primitiveId": r2_pid, "pinNumber": "2", "net": "GND", "direction": "right", "length": 60},
    )

    # 7) Verify netlist (like unit tests)
    verify = tool(
        port,
        "jlc.schematic.verify_netlist",
        {
            "netlistType": "JLCEDA",
            "timeoutMs": 30000,
            "maxChars": 200000,
            "nets": [
                {"name": "VIN", "endpoints": [{"ref": "R1", "pin": "1"}]},
                {"name": "MID", "endpoints": [{"ref": "R1", "pin": "2"}, {"ref": "R2", "pin": "1"}]},
                {"name": "GND", "endpoints": [{"ref": "R2", "pin": "2"}]},
            ],
        },
        timeout_s=30,
    )
    if not verify.get("ok"):
        print(json.dumps(verify, ensure_ascii=False, indent=2))
        raise RuntimeError("verify_netlist failed")
    print("verify_netlist ok")

    # 8) Capture PNG as base64 and save to CWD
    cap = tool(
        port,
        "jlc.view.capture_png",
        {"zoomToAll": True, "returnBase64": True, "fileName": args.out},
        timeout_s=30,
    )
    out_path = Path.cwd() / (cap.get("fileName") or args.out)
    out_path.write_bytes(base64.b64decode(cap["base64"]))
    print("Saved:", out_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

---

## 4) 低阶参考：Node.js（无 SDK，一次运行）

把下面保存为 `demo_divider.mjs`，然后执行：

```bash
node demo_divider.mjs --port 9050
```

```js
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const WEBSOCAT = process.env.WEBSOCAT ?? "websocat";

function rpc(port, method, params = undefined, { id = "1", timeoutMs = 15000 } = {}) {
  const req = { type: "request", id, method, closeAfterResponse: true };
  if (params !== undefined) req.params = params;

  const args = [
    "-B",
    "10485760",
    "-t",
    "--no-close",
    "--oneshot",
    `ws-l:127.0.0.1:${port}`,
    "-",
  ];

  const p = spawnSync(WEBSOCAT, args, {
    input: JSON.stringify(req) + "\n",
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (p.error) throw p.error;

  const lines = String(p.stdout ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    let msg;
    try {
      msg = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (msg?.type === "response" && msg?.id === id) {
      if (msg.error) throw new Error(`${msg.error.code}: ${msg.error.message}`);
      return msg.result ?? {};
    }
  }

  throw new Error(`No response.\nstdout:\n${p.stdout}\nstderr:\n${p.stderr}`);
}

function tool(port, name, args = {}, opts = {}) {
  const res = rpc(port, "tools.call", { name, arguments: args }, opts);
  return res.data ?? res;
}

function main() {
  const portArgIdx = process.argv.indexOf("--port");
  const port = portArgIdx >= 0 ? Number(process.argv[portArgIdx + 1]) : 9050;
  const outArgIdx = process.argv.indexOf("--out");
  const out = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : "divider_demo.png";

  // 1) Ensure schematic page
  tool(port, "jlc.schematic.ensure_page", { schematicName: "SAC Demo", pageName: "Divider" });

  // 2) Clear MCP-managed primitives (safe). For FULL clear use clearMode="all" (danger).
  tool(port, "jlc.schematic.apply_ir", {
    ir: { version: 1, units: "mm", page: { ensure: false, clear: true, clearMode: "mcp" } },
  });

  // 3) Search a resistor device (pick first)
  const search = tool(port, "jlc.library.search_devices", { key: "resistor 0603", limit: 5 });
  const items = Array.isArray(search?.items) ? search.items : [];
  if (!items.length) throw new Error("No devices found. Try changing the search keyword.");
  const deviceUuid = items[0]?.uuid;
  if (!deviceUuid) throw new Error("Search result has no 'uuid'. Inspect the returned items and adjust this script.");
  console.log("deviceUuid:", deviceUuid);

  // 4) Place R1/R2 via apply_ir (batch)
  const apply = tool(port, "jlc.schematic.apply_ir", {
    ir: {
      version: 1,
      units: "mm",
      page: { ensure: false },
      components: [
        { id: "R1", deviceUuid, x: 40, y: 40, designator: "R1", name: "10k" },
        { id: "R2", deviceUuid, x: 70, y: 40, designator: "R2", name: "10k" },
      ],
      post: { zoomToAll: true },
    },
  });

  const r1Pid = apply.applied.components.R1.primitiveId;
  const r2Pid = apply.applied.components.R2.primitiveId;
  console.log("R1 primitiveId:", r1Pid);
  console.log("R2 primitiveId:", r2Pid);

  // 5) Connect pins + name net "MID"
  tool(port, "jlc.schematic.connect_pins", {
    fromPrimitiveId: r1Pid,
    fromPinNumber: "2",
    toPrimitiveId: r2Pid,
    toPinNumber: "1",
    style: "manhattan",
    net: "MID",
  });

  // 6) Attach net labels (NetLabel in Pro is Wire.NET)
  tool(port, "jlc.schematic.netlabel.attach_pin", {
    primitiveId: r1Pid,
    pinNumber: "1",
    net: "VIN",
    direction: "left",
    length: 60,
  });
  tool(port, "jlc.schematic.netlabel.attach_pin", {
    primitiveId: r2Pid,
    pinNumber: "2",
    net: "GND",
    direction: "right",
    length: 60,
  });

  // 7) Verify netlist (like unit tests)
  const verify = tool(
    port,
    "jlc.schematic.verify_netlist",
    {
      netlistType: "JLCEDA",
      timeoutMs: 30000,
      maxChars: 200000,
      nets: [
        { name: "VIN", endpoints: [{ ref: "R1", pin: "1" }] },
        { name: "MID", endpoints: [{ ref: "R1", pin: "2" }, { ref: "R2", pin: "1" }] },
        { name: "GND", endpoints: [{ ref: "R2", pin: "2" }] },
      ],
    },
    { timeoutMs: 30000 },
  );
  if (!verify.ok) throw new Error("verify_netlist failed");
  console.log("verify_netlist ok");

  // 8) Capture PNG as base64 and save to CWD
  const cap = tool(port, "jlc.view.capture_png", { zoomToAll: true, returnBase64: true, fileName: out }, { timeoutMs: 30000 });
  const fileName = cap.fileName ?? out;
  const filePath = join(process.cwd(), fileName);
  writeFileSync(filePath, Buffer.from(cap.base64, "base64"));
  console.log("Saved:", filePath);
}

main();
```

---

## 5) 清空原理图（两种模式）

只清 MCP 管理对象（推荐）：

```bash
printf '%s\n' '{"type":"request","id":"1","method":"tools.call","params":{"name":"jlc.schematic.apply_ir","arguments":{"ir":{"version":1,"units":"mm","page":{"ensure":false,"clear":true,"clearMode":"mcp"}}}},"closeAfterResponse":true}' \
  | websocat -B 10485760 -t --no-close --oneshot ws-l:127.0.0.1:9050 -
```

清空整页（危险，慎用）：

```bash
printf '%s\n' '{"type":"request","id":"1","method":"tools.call","params":{"name":"jlc.schematic.apply_ir","arguments":{"ir":{"version":1,"units":"mm","page":{"ensure":false,"clear":true,"clearMode":"all"}}}},"closeAfterResponse":true}' \
  | websocat -B 10485760 -t --no-close --oneshot ws-l:127.0.0.1:9050 -
```

---

## 6) 常见坑（排错）

- 连接超时：大概率端口不对 / 目标窗口没开 / 扩展没启用（先用第 1 节查端口租约）
- `NOT_IN_SCHEMATIC_PAGE`：先调用 `jlc.schematic.ensure_page`
- 引脚号不对：用 `jlc.schematic.get_component_pins` 查看该器件真实 `pinNumber/pinName`
- 网标重复：NetLabel 是 `wire.NET`，避免在同一连接点既放 `netPort/netFlag` 又给短导线设置 `NET`

---

更多规划见：`docs/SCHEMATIC_AS_CODE_PLAN.md`  
IR 规范见：`docs/SCHEMATIC_IR.md`

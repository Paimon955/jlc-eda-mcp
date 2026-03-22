import base64
import hashlib
import json
import queue
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union


class BridgeError(RuntimeError):
    def __init__(self, code: str, message: str, data: Any = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.data = data


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=False)


def _stable_id(prefix: str, *parts: str) -> str:
    h = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{h}"


def _parse_endpoint(ep: Union[str, Tuple[str, str]]) -> Tuple[str, str]:
    if isinstance(ep, tuple) and len(ep) == 2:
        return str(ep[0]), str(ep[1])
    if isinstance(ep, str):
        if "." not in ep:
            raise ValueError(f"Invalid endpoint '{ep}', expected 'REF.PIN' (e.g. R1.2)")
        ref, pin = ep.split(".", 1)
        return ref.strip(), pin.strip()
    raise TypeError("endpoint must be 'REF.PIN' string or (ref,pin) tuple")

SCH_UNITS_PER_MM = 1 / 0.254  # 0.01 inch == 0.254 mm


def _mm_to_sch(v: float) -> float:
    return float(v) * SCH_UNITS_PER_MM


def _sch_to_mm(v: float) -> float:
    return float(v) / SCH_UNITS_PER_MM


@dataclass(frozen=True)
class Pin:
    primitive_id: str
    x_sch: float
    y_sch: float
    pin_number: str
    pin_name: str

    @property
    def x_mm(self) -> float:
        return _sch_to_mm(self.x_sch)

    @property
    def y_mm(self) -> float:
        return _sch_to_mm(self.y_sch)


@dataclass(frozen=True)
class Wire:
    primitive_id: str
    net: str
    line: Union[List[float], List[List[float]]]
    line_width: Optional[float] = None
    line_type: Optional[str] = None
    color: Optional[str] = None


@dataclass
class Instance:
    ref: str
    primitive_id: str
    component_type: str
    x_sch: float
    y_sch: float
    rotation: float = 0.0
    mirror: bool = False
    name: Optional[str] = None
    _eda: Optional["EdaSession"] = field(default=None, repr=False, compare=False)

    @property
    def x_mm(self) -> float:
        return _sch_to_mm(self.x_sch)

    @property
    def y_mm(self) -> float:
        return _sch_to_mm(self.y_sch)

    def pin(self, pin: Union[str, int]) -> Tuple[str, str]:
        return (self.ref, str(pin))

    def pins(self) -> List[Pin]:
        if not self._eda:
            raise RuntimeError("Instance has no session bound; cannot fetch pins")
        res = self._eda.tool("jlc.schematic.get_component_pins", {"primitiveId": self.primitive_id})
        pins = res.get("pins") if isinstance(res, dict) else None
        if not isinstance(pins, list):
            return []
        out: List[Pin] = []
        for p in pins:
            try:
                out.append(
                    Pin(
                        primitive_id=str(p.get("primitiveId", "")),
                        x_sch=float(p.get("x")),
                        y_sch=float(p.get("y")),
                        pin_number=str(p.get("pinNumber", "")),
                        pin_name=str(p.get("pinName", "")),
                    )
                )
            except Exception:
                continue
        return out


@dataclass(frozen=True)
class Design:
    instances: Dict[str, Instance]
    wires: List[Wire] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)

    def instance(self, ref: str) -> Instance:
        key = str(ref).strip()
        if not key:
            raise ValueError("ref must not be empty")
        if key in self.instances:
            return self.instances[key]
        u = key.upper()
        for k, v in self.instances.items():
            if k.upper() == u:
                return v
        raise KeyError(key)

    def get(self, ref: str) -> Optional[Instance]:
        try:
            return self.instance(ref)
        except KeyError:
            return None

    def wires_by_net(self, net: str) -> List[Wire]:
        n = str(net)
        return [w for w in self.wires if w.net == n]


@dataclass(frozen=True)
class DesignUpdate:
    raw: Dict[str, Any]
    instances: Dict[str, Instance]


@dataclass
class _InstanceSpec:
    ref: str
    device_uuid: str
    rotation: Optional[float] = None
    mirror: Optional[bool] = None
    designator: Optional[str] = None
    value: Optional[str] = None

    x: Optional[float] = None
    y: Optional[float] = None

    rel_to: Optional[str] = None
    rel_dx: float = 0.0
    rel_dy: float = 0.0

    align_x_to: Optional[str] = None
    align_y_to: Optional[str] = None


def _as_ref(obj: Any) -> str:
    if isinstance(obj, str):
        return obj
    if hasattr(obj, "ref"):
        return str(getattr(obj, "ref"))
    raise TypeError("Expected a ref string or an InstanceRef-like object with .ref")


class InstanceRef:
    def __init__(self, txn: "SchematicTxn", ref: str):
        self._txn = txn
        self.ref = ref

    def pin(self, pin: Union[str, int]) -> Tuple[str, str]:
        return (self.ref, str(pin))

    def at(self, x: float, y: float) -> "InstanceRef":
        self._txn._set_at(self.ref, float(x), float(y))
        return self

    def right_of(self, other: Any, *, dx: Optional[float] = None) -> "InstanceRef":
        self._txn._set_rel(self.ref, _as_ref(other), float(dx) if dx is not None else self._txn.default_dx, 0.0)
        return self

    def rightOf(self, other: Any, *, dx: Optional[float] = None) -> "InstanceRef":
        return self.right_of(other, dx=dx)

    def left_of(self, other: Any, *, dx: Optional[float] = None) -> "InstanceRef":
        self._txn._set_rel(self.ref, _as_ref(other), -(float(dx) if dx is not None else self._txn.default_dx), 0.0)
        return self

    def leftOf(self, other: Any, *, dx: Optional[float] = None) -> "InstanceRef":
        return self.left_of(other, dx=dx)

    def below(self, other: Any, *, dy: Optional[float] = None) -> "InstanceRef":
        self._txn._set_rel(self.ref, _as_ref(other), 0.0, float(dy) if dy is not None else self._txn.default_dy)
        return self

    def above(self, other: Any, *, dy: Optional[float] = None) -> "InstanceRef":
        self._txn._set_rel(self.ref, _as_ref(other), 0.0, -(float(dy) if dy is not None else self._txn.default_dy))
        return self

    def align_x(self, other: Any) -> "InstanceRef":
        self._txn._set_align_x(self.ref, _as_ref(other))
        return self

    def alignX(self, other: Any) -> "InstanceRef":
        return self.align_x(other)

    def align_y(self, other: Any) -> "InstanceRef":
        self._txn._set_align_y(self.ref, _as_ref(other))
        return self

    def alignY(self, other: Any) -> "InstanceRef":
        return self.align_y(other)

    def align(self, other: Any, *, axis: str = "xy") -> "InstanceRef":
        a = str(axis).lower()
        if a in ("x", "xy", "both"):
            self.align_x(other)
        if a in ("y", "xy", "both"):
            self.align_y(other)
        if a not in ("x", "y", "xy", "both"):
            raise ValueError("axis must be 'x', 'y', 'xy', or 'both'")
        return self

    def value(self, value: str) -> "InstanceRef":
        self._txn._set_value(self.ref, str(value))
        return self

    def designator(self, designator: str) -> "InstanceRef":
        self._txn._set_designator(self.ref, str(designator))
        return self

    def rotate(self, rotation: float) -> "InstanceRef":
        self._txn._set_rotation(self.ref, float(rotation))
        return self


@dataclass
class HelloInfo:
    raw: Dict[str, Any]

    @property
    def project_name(self) -> Optional[str]:
        return (self.raw.get("project") or {}).get("name")

    @property
    def project_friendly_name(self) -> Optional[str]:
        return (self.raw.get("project") or {}).get("friendlyName")

    @property
    def port(self) -> Optional[int]:
        p = (self.raw.get("server") or {}).get("port")
        return int(p) if isinstance(p, (int, float)) else None


class _WebsocatBridge:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        websocat: str = "websocat",
        buffer_bytes: int = 10 * 1024 * 1024,
        connect_timeout_s: float = 15.0,
    ):
        self.host = host
        self.port = port
        self.websocat = websocat
        self.buffer_bytes = buffer_bytes
        self.connect_timeout_s = connect_timeout_s

        self._proc: Optional[subprocess.Popen] = None
        self._out_q: "queue.Queue[str]" = queue.Queue()
        self._err_lines: List[str] = []
        self._hello: Optional[HelloInfo] = None
        self._next_id = 1

    @property
    def hello(self) -> HelloInfo:
        if not self._hello:
            raise RuntimeError("Bridge not connected (no hello received yet)")
        return self._hello

    def start(self) -> HelloInfo:
        if self._proc:
            return self.hello

        args = [
            self.websocat,
            "-B",
            str(self.buffer_bytes),
            "-t",
            "--no-close",
            "--oneshot",
            f"ws-l:{self.host}:{self.port}",
            "-",
        ]
        self._proc = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        assert self._proc.stdout is not None
        assert self._proc.stderr is not None

        def pump_stdout() -> None:
            assert self._proc and self._proc.stdout
            for line in self._proc.stdout:
                self._out_q.put(line)

        def pump_stderr() -> None:
            assert self._proc and self._proc.stderr
            for line in self._proc.stderr:
                self._err_lines.append(line)

        threading.Thread(target=pump_stdout, daemon=True).start()
        threading.Thread(target=pump_stderr, daemon=True).start()

        # Wait hello
        deadline = time.time() + self.connect_timeout_s
        while time.time() < deadline:
            msg = self._next_json(timeout_s=max(0.05, deadline - time.time()))
            if not msg:
                continue
            if msg.get("type") == "hello":
                self._hello = HelloInfo(raw=msg)
                return self._hello

        self.close()
        err = "".join(self._err_lines[-20:])
        raise RuntimeError(f"Timed out waiting for hello on ws-l:{self.host}:{self.port}. stderr:\n{err}")

    def close(self) -> None:
        p = self._proc
        self._proc = None
        if not p:
            return
        try:
            if p.stdin:
                try:
                    # Ask extension to close politely if connected.
                    req_id = self._alloc_id()
                    req = {"type": "request", "id": req_id, "method": "ping", "closeAfterResponse": True}
                    p.stdin.write(_json_dumps(req) + "\n")
                    p.stdin.flush()
                except Exception:
                    pass
                try:
                    p.stdin.close()
                except Exception:
                    pass
            try:
                p.wait(timeout=1.5)
            except Exception:
                p.terminate()
        finally:
            try:
                p.kill()
            except Exception:
                pass

    def _alloc_id(self) -> str:
        v = str(self._next_id)
        self._next_id += 1
        return v

    def _next_json(self, *, timeout_s: float) -> Optional[Dict[str, Any]]:
        try:
            line = self._out_q.get(timeout=timeout_s)
        except queue.Empty:
            return None
        line = line.strip()
        if not line:
            return None
        try:
            return json.loads(line)
        except Exception:
            return None

    def request(self, method: str, params: Optional[Dict[str, Any]] = None, *, timeout_s: float = 15.0) -> Dict[str, Any]:
        self.start()
        if not self._proc or not self._proc.stdin:
            raise RuntimeError("Bridge process not available")

        req_id = self._alloc_id()
        req: Dict[str, Any] = {"type": "request", "id": req_id, "method": method, "closeAfterResponse": False}
        if params is not None:
            req["params"] = params

        self._proc.stdin.write(_json_dumps(req) + "\n")
        self._proc.stdin.flush()

        deadline = time.time() + timeout_s
        while time.time() < deadline:
            msg = self._next_json(timeout_s=max(0.05, deadline - time.time()))
            if not msg:
                continue
            if msg.get("type") == "hello" and not self._hello:
                self._hello = HelloInfo(raw=msg)
                continue
            if msg.get("type") != "response" or msg.get("id") != req_id:
                continue
            if msg.get("error"):
                err = msg["error"]
                raise BridgeError(str(err.get("code", "ERROR")), str(err.get("message", "")), err.get("data"))
            return msg.get("result") or {}

        raise RuntimeError(f"Timed out waiting for response to {method} after {timeout_s}s")


class EdaSession:
    """
    Keysight-like high-level session.

    Under the hood:
    - spawns `websocat ws-l:host:port -` as a temporary WS server
    - waits for extension `hello`
    - sends RPC requests and parses responses
    """

    def __init__(
        self,
        *,
        host: str = "127.0.0.1",
        port: int = 9050,
        websocat: str = "websocat",
        buffer_bytes: int = 10 * 1024 * 1024,
        connect_timeout_s: float = 15.0,
    ):
        self._bridge = _WebsocatBridge(
            host=host,
            port=port,
            websocat=websocat,
            buffer_bytes=buffer_bytes,
            connect_timeout_s=connect_timeout_s,
        )

    def __enter__(self) -> "EdaSession":
        self._bridge.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @property
    def hello(self) -> HelloInfo:
        return self._bridge.hello

    def close(self) -> None:
        self._bridge.close()

    # --- low level ---

    def rpc(self, method: str, params: Optional[Dict[str, Any]] = None, *, timeout_s: float = 15.0) -> Dict[str, Any]:
        return self._bridge.request(method, params, timeout_s=timeout_s)

    def tool(self, name: str, arguments: Optional[Dict[str, Any]] = None, *, timeout_s: float = 15.0) -> Any:
        res = self.rpc("tools.call", {"name": name, "arguments": arguments or {}}, timeout_s=timeout_s)
        # tools.call wraps tool output in result.data (+ toolResult duplication)
        return res.get("data", res)

    # --- convenience ---

    @property
    def library(self) -> "Library":
        return Library(self)

    def schematic(self, schematic_name: Optional[str] = None, page_name: Optional[str] = None, board_name: Optional[str] = None) -> "Schematic":
        sch = Schematic(self)
        if schematic_name or page_name or board_name:
            sch.ensure_page(schematic_name=schematic_name, page_name=page_name, board_name=board_name)
        return sch


class Library:
    def __init__(self, eda: EdaSession):
        self._eda = eda

    def search_devices(self, key: str, *, limit: int = 5, page: int = 1, library_uuid: Optional[str] = None) -> List[Dict[str, Any]]:
        res = self._eda.tool(
            "jlc.library.search_devices",
            {"key": key, "limit": limit, "page": page, **({"libraryUuid": library_uuid} if library_uuid else {})},
        )
        items = res.get("items")
        return list(items) if isinstance(items, list) else []

    def first_device_uuid(self, key: str, *, limit: int = 5) -> str:
        items = self.search_devices(key, limit=limit)
        if not items:
            raise RuntimeError(f"No devices found for query: {key}")
        uuid = items[0].get("uuid")
        if not uuid:
            raise RuntimeError("Search result missing 'uuid'")
        return str(uuid)


class Schematic:
    def __init__(self, eda: EdaSession):
        self._eda = eda

    def ensure_page(
        self,
        *,
        schematic_name: Optional[str] = None,
        page_name: Optional[str] = None,
        board_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        args: Dict[str, Any] = {}
        if board_name:
            args["boardName"] = board_name
        if schematic_name:
            args["schematicName"] = schematic_name
        if page_name:
            args["pageName"] = page_name
        return self._eda.tool("jlc.schematic.ensure_page", args)

    def clear(self, *, mode: str = "mcp", units: str = "mm") -> Dict[str, Any]:
        if mode not in ("mcp", "all"):
            raise ValueError("mode must be 'mcp' or 'all'")
        return self._eda.tool(
            "jlc.schematic.apply_ir",
            {"ir": {"version": 1, "units": units, "page": {"ensure": False, "clear": True, "clearMode": mode}}},
            timeout_s=30,
        )

    def transaction(self, *, units: str = "mm", clear: bool = False, clear_mode: str = "mcp") -> "SchematicTxn":
        return SchematicTxn(self._eda, units=units, clear=clear, clear_mode=clear_mode)

    def design(
        self,
        *,
        all_schematic_pages: bool = False,
        include_wires: bool = True,
        nets: Optional[List[str]] = None,
    ) -> Design:
        insts = self.instances(component_type=None, all_schematic_pages=all_schematic_pages)
        inst_map = {i.ref: i for i in insts}
        wires: List[Wire] = []
        if include_wires:
            wires = self.wires(nets=nets)
        return Design(instances=inst_map, wires=wires, raw={"ok": True})

    def instances(
        self,
        *,
        component_type: Optional[str] = "part",
        all_schematic_pages: bool = False,
        limit: Optional[int] = None,
    ) -> List[Instance]:
        args: Dict[str, Any] = {"allSchematicPages": bool(all_schematic_pages)}
        if component_type is not None:
            args["componentType"] = component_type
        if limit is not None:
            args["limit"] = int(limit)

        res = self._eda.tool("jlc.schematic.list_components", args)
        items = res.get("items") if isinstance(res, dict) else None
        if not isinstance(items, list):
            return []

        out: List[Instance] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            primitive_id = str(it.get("primitiveId", ""))
            component_type_value = str(it.get("componentType", ""))
            designator = it.get("designator")
            ref = str(designator) if designator else primitive_id
            try:
                out.append(
                    Instance(
                        ref=ref,
                        primitive_id=primitive_id,
                        component_type=component_type_value,
                        x_sch=float(it.get("x")),
                        y_sch=float(it.get("y")),
                        rotation=float(it.get("rotation", 0) or 0),
                        mirror=bool(it.get("mirror", False)),
                        name=(str(it.get("name")) if it.get("name") is not None else None),
                        _eda=self._eda,
                    )
                )
            except Exception:
                continue
        return out

    def find(self, designator: str) -> Instance:
        d = str(designator).strip()
        if not d:
            raise ValueError("designator must not be empty")
        for inst in self.instances(component_type=None, all_schematic_pages=False):
            if inst.ref.upper() == d.upper():
                return inst
        raise RuntimeError(f"Designator not found: {designator}")

    def wires(self, *, net: Optional[str] = None, nets: Optional[List[str]] = None) -> List[Wire]:
        args: Dict[str, Any] = {}
        if net is not None:
            args["net"] = net
        if nets is not None:
            args["nets"] = list(nets)

        res = self._eda.tool("jlc.schematic.list_wires", args)
        items = res.get("items") if isinstance(res, dict) else None
        if not isinstance(items, list):
            return []

        out: List[Wire] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            try:
                out.append(
                    Wire(
                        primitive_id=str(it.get("primitiveId", "")),
                        net=str(it.get("net", "")),
                        line=it.get("line"),
                        color=(it.get("color") if it.get("color") is not None else None),
                        line_width=(float(it["lineWidth"]) if it.get("lineWidth") is not None else None),
                        line_type=(str(it["lineType"]) if it.get("lineType") is not None else None),
                    )
                )
            except Exception:
                continue
        return out

    def connect_pins(
        self,
        a: Instance,
        a_pin: Union[str, int],
        b: Instance,
        b_pin: Union[str, int],
        *,
        net: Optional[str] = None,
        style: str = "manhattan",
        mid_x: Optional[float] = None,
    ) -> Wire:
        args: Dict[str, Any] = {
            "fromPrimitiveId": a.primitive_id,
            "fromPinNumber": str(a_pin),
            "toPrimitiveId": b.primitive_id,
            "toPinNumber": str(b_pin),
            "style": style,
        }
        if net is not None:
            args["net"] = net
        if mid_x is not None:
            args["midX"] = float(mid_x)

        res = self._eda.tool("jlc.schematic.connect_pins", args)
        wire_id = str(res.get("wirePrimitiveId", "")) if isinstance(res, dict) else ""
        line = (res.get("line") if isinstance(res, dict) else None) or []
        return Wire(primitive_id=wire_id, net=net or "", line=line)

    def netlabel(
        self,
        inst: Instance,
        pin: Union[str, int],
        *,
        net: str,
        direction: str = "right",
        length: float = 40,
        id: Optional[str] = None,
    ) -> Dict[str, Any]:
        args: Dict[str, Any] = {
            "primitiveId": inst.primitive_id,
            "pinNumber": str(pin),
            "net": net,
            "direction": direction,
            "length": float(length),
        }
        if id is not None:
            args["id"] = id
        res = self._eda.tool("jlc.schematic.netlabel.attach_pin", args)
        return res if isinstance(res, dict) else {"ok": True}

    def wire_create(self, line: Union[List[float], List[List[float]]], *, net: Optional[str] = None) -> Dict[str, Any]:
        args: Dict[str, Any] = {"line": line}
        if net is not None:
            args["net"] = net
        res = self._eda.tool("jlc.schematic.wire.create", args)
        return res if isinstance(res, dict) else {"ok": True}

    def verify_netlist(self, expected: Dict[str, Iterable[str]], *, netlist_type: str = "JLCEDA") -> Dict[str, Any]:
        nets = []
        for net_name, eps in expected.items():
            endpoints = []
            for ep in eps:
                ref, pin = _parse_endpoint(ep)
                endpoints.append({"ref": ref, "pin": pin})
            nets.append({"name": net_name, "endpoints": endpoints})

        return self._eda.tool(
            "jlc.schematic.verify_netlist",
            {"netlistType": netlist_type, "timeoutMs": 30_000, "maxChars": 200_000, "nets": nets},
            timeout_s=30,
        )

    def capture_png(self, file_name: str, *, zoom_to_all: bool = True) -> Path:
        cap = self._eda.tool(
            "jlc.view.capture_png",
            {"zoomToAll": zoom_to_all, "returnBase64": True, "fileName": file_name},
            timeout_s=30,
        )
        base64_str = cap.get("base64")
        if not base64_str:
            raise RuntimeError("capture_png did not return base64")
        out = Path.cwd() / (cap.get("fileName") or file_name)
        out.write_bytes(base64.b64decode(str(base64_str)))
        return out


class SchematicTxn:
    """
    Keysight-like transaction:
    - declare instances/connectivity/layout constraints
    - resolve layout (grid / rightOf / align...)
    - commit as one apply_ir
    - apply pin-attached net labels in a second phase (needs primitiveId)
    """

    def __init__(self, eda: EdaSession, *, units: str = "mm", clear: bool = False, clear_mode: str = "mcp"):
        self._eda = eda
        self.units = units
        self.clear = clear
        self.clear_mode = clear_mode

        self.default_dx = 30.0
        self.default_dy = 20.0

        self._grid_step: Optional[float] = None
        self._grid_origin_x = 0.0
        self._grid_origin_y = 0.0

        self._auto_origin_x = 0.0
        self._auto_origin_y = 0.0
        self._auto_wrap = 6

        self._page: Dict[str, Any] = {"ensure": False, **({"clear": True, "clearMode": clear_mode} if clear else {})}

        self._instances: Dict[str, _InstanceSpec] = {}
        self._order: List[str] = []
        self._connections: List[Dict[str, Any]] = []
        self._wires: List[Dict[str, Any]] = []
        self._labels: List[Dict[str, Any]] = []

        self._committed = False
        self.last_update: Optional[DesignUpdate] = None

    def __enter__(self) -> "SchematicTxn":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            if not self._committed:
                self.commit()

    # --- layout config ---

    def grid(self, step: float, *, origin_x: float = 0.0, origin_y: float = 0.0) -> "SchematicTxn":
        self._grid_step = float(step)
        self._grid_origin_x = float(origin_x)
        self._grid_origin_y = float(origin_y)
        return self

    def origin(self, x: float, y: float) -> "SchematicTxn":
        self._auto_origin_x = float(x)
        self._auto_origin_y = float(y)
        return self

    def spacing(self, dx: float, dy: Optional[float] = None, *, wrap: Optional[int] = None) -> "SchematicTxn":
        self.default_dx = float(dx)
        self.default_dy = float(dy) if dy is not None else float(dx)
        if wrap is not None:
            self._auto_wrap = int(wrap)
        return self

    # --- internal setters used by InstanceRef ---

    def _ensure_spec(self, ref: str, device_uuid: Optional[str] = None) -> _InstanceSpec:
        r = str(ref).strip()
        if not r:
            raise ValueError("ref must not be empty")
        if r not in self._instances:
            if not device_uuid:
                raise ValueError("device_uuid required for new instance")
            self._instances[r] = _InstanceSpec(ref=r, device_uuid=str(device_uuid))
            self._order.append(r)
        spec = self._instances[r]
        if device_uuid:
            spec.device_uuid = str(device_uuid)
        return spec

    def _set_at(self, ref: str, x: float, y: float) -> None:
        spec = self._ensure_spec(ref)
        spec.x = float(x)
        spec.y = float(y)
        spec.rel_to = None

    def _set_rel(self, ref: str, target_ref: str, dx: float, dy: float) -> None:
        spec = self._ensure_spec(ref)
        spec.rel_to = str(target_ref)
        spec.rel_dx = float(dx)
        spec.rel_dy = float(dy)
        spec.x = None
        spec.y = None

    def _set_align_x(self, ref: str, target_ref: str) -> None:
        spec = self._ensure_spec(ref)
        spec.align_x_to = str(target_ref)

    def _set_align_y(self, ref: str, target_ref: str) -> None:
        spec = self._ensure_spec(ref)
        spec.align_y_to = str(target_ref)

    def _set_value(self, ref: str, value: str) -> None:
        spec = self._ensure_spec(ref)
        spec.value = str(value)

    def _set_designator(self, ref: str, designator: str) -> None:
        spec = self._ensure_spec(ref)
        spec.designator = str(designator)

    def _set_rotation(self, ref: str, rotation: float) -> None:
        spec = self._ensure_spec(ref)
        spec.rotation = float(rotation)

    # --- high level ops ---

    def place(
        self,
        ref: str,
        device_uuid: str,
        *,
        x: Optional[float] = None,
        y: Optional[float] = None,
        rotation: Optional[float] = None,
        designator: Optional[str] = None,
        value: Optional[str] = None,
        mirror: Optional[bool] = None,
    ) -> InstanceRef:
        spec = self._ensure_spec(ref, device_uuid=device_uuid)
        if rotation is not None:
            spec.rotation = float(rotation)
        if mirror is not None:
            spec.mirror = bool(mirror)
        if designator is not None:
            spec.designator = str(designator)
        if value is not None:
            spec.value = str(value)
        if x is not None or y is not None:
            if x is None or y is None:
                raise ValueError("x and y must be set together")
            self._set_at(ref, float(x), float(y))
        return InstanceRef(self, str(ref))

    def wire(
        self,
        line: Union[List[float], List[List[float]]],
        *,
        net: Optional[str] = None,
        id: Optional[str] = None,
    ) -> "SchematicTxn":
        wid = id or _stable_id("W", _json_dumps(line), net or "")
        w: Dict[str, Any] = {"id": wid, "line": line}
        if net is not None:
            w["net"] = net
        self._wires.append(w)
        return self

    def connect(
        self,
        a: Union[str, Tuple[str, str]],
        b: Union[str, Tuple[str, str]],
        *,
        net: Optional[str] = None,
        style: str = "manhattan",
    ) -> "SchematicTxn":
        ref_a, pin_a = _parse_endpoint(a)
        ref_b, pin_b = _parse_endpoint(b)
        cid = _stable_id("C", ref_a, pin_a, ref_b, pin_b, net or "", style)
        conn: Dict[str, Any] = {
            "id": cid,
            "from": {"componentId": ref_a, "pinNumber": pin_a},
            "to": {"componentId": ref_b, "pinNumber": pin_b},
            "style": style,
        }
        if net:
            conn["net"] = net
        self._connections.append(conn)
        return self

    def label(
        self,
        endpoint: Union[str, Tuple[str, str]],
        *,
        net: str,
        direction: str = "right",
        length: float = 40,
    ) -> "SchematicTxn":
        ref, pin = _parse_endpoint(endpoint)
        lid = _stable_id("NL", ref, pin, net, direction, str(length))
        self._labels.append(
            {
                "id": lid,
                "ref": ref,
                "pinNumber": pin,
                "net": net,
                "direction": direction,
                "length": length,
            }
        )
        return self

    # --- execution ---

    def _snap(self, v: float) -> float:
        if not self._grid_step:
            return v
        step = float(self._grid_step)
        if step <= 0:
            return v
        origin = self._grid_origin_x  # caller chooses x/y origin separately
        return origin + round((v - origin) / step) * step

    def _resolve_positions(self) -> Dict[str, Tuple[float, float]]:
        specs = self._instances

        deps: Dict[str, List[str]] = {}
        for ref, s in specs.items():
            d: List[str] = []
            if s.rel_to:
                d.append(s.rel_to)
            if s.align_x_to:
                d.append(s.align_x_to)
            if s.align_y_to:
                d.append(s.align_y_to)
            deps[ref] = d

        for ref, d in deps.items():
            for r in d:
                if r not in specs:
                    raise RuntimeError(f"Unknown reference in constraint: {ref} -> {r}")

        order: List[str] = []
        perm: set[str] = set()
        temp: set[str] = set()
        stack: List[str] = []

        def visit(n: str) -> None:
            if n in perm:
                return
            if n in temp:
                cycle = " -> ".join(stack + [n])
                raise RuntimeError(f"Layout constraint cycle detected: {cycle}")
            temp.add(n)
            stack.append(n)
            for d in deps.get(n, []):
                visit(d)
            stack.pop()
            temp.remove(n)
            perm.add(n)
            order.append(n)

        for ref in self._order:
            visit(ref)

        pos: Dict[str, Tuple[float, float]] = {}
        auto_i = 0
        wrap = max(1, int(self._auto_wrap))

        for ref in order:
            s = specs[ref]

            if s.rel_to and (s.x is not None or s.y is not None):
                raise RuntimeError(f"{ref}: cannot combine absolute position with relative constraint")

            if s.rel_to:
                tx, ty = pos[s.rel_to]
                x = tx + float(s.rel_dx)
                y = ty + float(s.rel_dy)
            elif s.x is not None and s.y is not None:
                x = float(s.x)
                y = float(s.y)
            else:
                col = auto_i % wrap
                row = auto_i // wrap
                x = self._auto_origin_x + col * self.default_dx
                y = self._auto_origin_y + row * self.default_dy
                auto_i += 1

            if s.align_x_to:
                x = pos[s.align_x_to][0]
            if s.align_y_to:
                y = pos[s.align_y_to][1]

            if self._grid_step:
                step = float(self._grid_step)
                ox = float(self._grid_origin_x)
                oy = float(self._grid_origin_y)
                x = ox + round((x - ox) / step) * step
                y = oy + round((y - oy) / step) * step

            pos[ref] = (x, y)

        return pos

    def _build_ir(self) -> Dict[str, Any]:
        positions = self._resolve_positions()

        components: List[Dict[str, Any]] = []
        for ref in self._order:
            s = self._instances[ref]
            x, y = positions[ref]
            c: Dict[str, Any] = {"id": ref, "deviceUuid": s.device_uuid, "x": x, "y": y}
            if s.rotation is not None:
                c["rotation"] = s.rotation
            if s.mirror is not None:
                c["mirror"] = s.mirror
            if s.designator is not None:
                c["designator"] = s.designator
            if s.value is not None:
                c["name"] = s.value
            components.append(c)

        ir: Dict[str, Any] = {"version": 1, "units": self.units, "page": dict(self._page)}
        ir["components"] = components
        if self._wires:
            ir["wires"] = list(self._wires)
        if self._connections:
            ir["connections"] = list(self._connections)
        return ir

    def commit(self) -> DesignUpdate:
        if self._committed and self.last_update is not None:
            return self.last_update

        ir = self._build_ir()
        raw = self._eda.tool("jlc.schematic.apply_ir", {"ir": ir}, timeout_s=60)

        # Apply labels after we know primitiveIds.
        comps = ((raw.get("applied") or {}).get("components") or {}) if isinstance(raw, dict) else {}
        for lab in self._labels:
            comp = comps.get(lab["ref"])
            if not comp or not comp.get("primitiveId"):
                raise RuntimeError(f"Missing primitiveId for component {lab['ref']} (did you place it?)")
            self._eda.tool(
                "jlc.schematic.netlabel.attach_pin",
                {
                    "id": lab["id"],
                    "primitiveId": comp["primitiveId"],
                    "pinNumber": lab["pinNumber"],
                    "net": lab["net"],
                    "direction": lab["direction"],
                    "length": lab["length"],
                },
                timeout_s=30,
            )

        positions = self._resolve_positions()
        instances: Dict[str, Instance] = {}
        for ref in self._order:
            applied = comps.get(ref) or {}
            primitive_id = str(applied.get("primitiveId", ""))
            x, y = positions[ref]
            x_sch = _mm_to_sch(x) if self.units == "mm" else float(x)
            y_sch = _mm_to_sch(y) if self.units == "mm" else float(y)
            instances[ref] = Instance(
                ref=ref,
                primitive_id=primitive_id,
                component_type="part",
                x_sch=x_sch,
                y_sch=y_sch,
                rotation=float(self._instances[ref].rotation or 0),
                mirror=bool(self._instances[ref].mirror or False),
                name=self._instances[ref].value,
                _eda=self._eda,
            )

        update = DesignUpdate(raw=raw if isinstance(raw, dict) else {"ok": True}, instances=instances)
        self._committed = True
        self.last_update = update
        return update


def connect(
    *,
    port: int = 9050,
    host: str = "127.0.0.1",
    websocat: str = "websocat",
    buffer_bytes: int = 10 * 1024 * 1024,
    connect_timeout_s: float = 15.0,
) -> EdaSession:
    return EdaSession(
        host=host,
        port=port,
        websocat=websocat,
        buffer_bytes=buffer_bytes,
        connect_timeout_s=connect_timeout_s,
    )


def discover(
    *,
    host: str = "127.0.0.1",
    ports: Iterable[int] = range(9050, 9060),
    websocat: str = "websocat",
    buffer_bytes: int = 10 * 1024 * 1024,
    connect_timeout_s: float = 0.6,
) -> List[HelloInfo]:
    """
    Best-effort scan for active EDA windows by starting a temporary WS server on each port
    and waiting for the extension 'hello'.

    This is intentionally short-timeout; call it a few times if needed.
    """
    found: List[HelloInfo] = []
    for port in ports:
        try:
            with connect(
                host=host,
                port=int(port),
                websocat=websocat,
                buffer_bytes=buffer_bytes,
                connect_timeout_s=connect_timeout_s,
            ) as eda:
                found.append(eda.hello)
        except Exception:
            continue
    return found


def connect_auto(
    *,
    project_contains: Optional[str] = None,
    host: str = "127.0.0.1",
    ports: Iterable[int] = range(9050, 9060),
    websocat: str = "websocat",
    buffer_bytes: int = 10 * 1024 * 1024,
    connect_timeout_s: float = 0.6,
) -> EdaSession:
    """
    Auto-pick a port from 9050-9059 by scanning for hello.

    - If project_contains is None: pick the first discovered window.
    - If multiple matches are found: raise an error listing candidates.
    """
    candidates = discover(
        host=host,
        ports=ports,
        websocat=websocat,
        buffer_bytes=buffer_bytes,
        connect_timeout_s=connect_timeout_s,
    )

    if project_contains:
        key = project_contains.lower()
        candidates = [
            h
            for h in candidates
            if (h.project_name or "").lower().find(key) >= 0 or (h.project_friendly_name or "").lower().find(key) >= 0
        ]

    if not candidates:
        raise RuntimeError("No active EDA extension window found in ports 9050-9059 (try opening/refreshing Status).")

    if len(candidates) > 1:
        summary = [
            {
                "port": h.port,
                "project": {"name": h.project_name, "friendlyName": h.project_friendly_name},
            }
            for h in candidates
        ]
        raise RuntimeError("Multiple candidate windows found, refine project_contains:\n" + json.dumps(summary, ensure_ascii=False, indent=2))

    chosen = candidates[0]
    if not chosen.port:
        raise RuntimeError("Discovered hello has no port")

    return connect(
        host=host,
        port=int(chosen.port),
        websocat=websocat,
        buffer_bytes=buffer_bytes,
        connect_timeout_s=15.0,
    )

import argparse
import json

import jlceda_sac.de as de


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0, help="WS port. Use 0 to auto-discover (9050-9059).")
    ap.add_argument("--project", default=None, help="When --port=0, pick window whose project name contains this substring.")
    ap.add_argument("--out", default="divider_demo.png")
    args = ap.parse_args()

    session = de.connect(port=args.port) if args.port else de.connect_auto(project_contains=args.project)

    with session as eda:
        print(
            json.dumps(
                {
                    "connected": True,
                    "project": {
                        "name": eda.hello.project_name,
                        "friendlyName": eda.hello.project_friendly_name,
                    },
                    "server": {"port": eda.hello.port},
                },
                ensure_ascii=False,
            )
        )

        sch = eda.schematic(schematic_name="SAC Demo", page_name="Divider")
        r_uuid = eda.library.first_device_uuid("resistor 0603", limit=5)

        # Keysight-like transaction: build then commit.
        with sch.transaction(units="mm", clear=True, clear_mode="mcp") as t:
            t.grid(2.54).origin(40, 40).spacing(30, 20)
            r1 = t.place("R1", r_uuid, designator="R1", value="10k").at(40, 40)
            r2 = t.place("R2", r_uuid, designator="R2", value="10k").right_of(r1).align_y(r1)
            t.connect(r1.pin(2), r2.pin(1), net="MID")
            t.label(r1.pin(1), net="VIN", direction="left", length=60)
            t.label(r2.pin(2), net="GND", direction="right", length=60)

        verify = sch.verify_netlist(
            {
                "VIN": ["R1.1"],
                "MID": ["R1.2", "R2.1"],
                "GND": ["R2.2"],
            }
        )
        if not verify.get("ok"):
            print(json.dumps(verify, ensure_ascii=False, indent=2))
            raise SystemExit("verify_netlist failed")

        out = sch.capture_png(args.out)
        print(f"Saved: {out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env node
/**
 * Runner: apply placement IR + wiring plan to JLCEDA Pro via jlceda-mcp-bridge WebSocket RPC.
 *
 * - Starts a WS server on 127.0.0.1:9050-9059 and waits for the EDA extension to connect.
 * - Calls:
 *   - schematic.applyIr   (place)
 *   - schematic.getComponentPins (for direction auto)
 *   - schematic.applyIr   (wiring: netlabel stubs as wires + connections)
 *   - captureRenderedAreaImage (base64 → png)
 *   - exportSchematicNetlistFile (base64 → .net)
 *   - getDocumentSource (→ document_source.txt)
 *
 * Usage:
 *   node scripts/run-netlist-to-schematic.mjs --place <place.ir.json> --plan <wiring.plan.json> --out <outDir>
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { WebSocketServer } from 'ws';

function usage(msg) {
	if (msg) console.error(msg);
	console.error(
		[
			'Usage:',
			'  node scripts/run-netlist-to-schematic.mjs --place <place.ir.json> --plan <wiring.plan.json> --out <dir> [--timeout 120000] [--ports 9050-9059] [--save] [--drc] [--drc-strict]',
			'',
			'Notes:',
			'- JLCEDA extension must be enabled and configured to ws://127.0.0.1:9050 (pool 9050-9059).',
			'- Enable "external interaction" permission for file export APIs.',
		].join('\n'),
	);
}

function die(msg) {
	throw new Error(msg);
}

function parsePortRange(raw) {
	const s = String(raw ?? '').trim();
	if (!s) return { start: 9050, end: 9059 };
	const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
	if (!m) throw new Error(`Invalid --ports "${s}" (expected "9050-9059")`);
	const start = Number(m[1]);
	const end = Number(m[2]);
	if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1 || start > end) {
		throw new Error(`Invalid --ports "${s}" (bad range)`);
	}
	return { start: Math.floor(start), end: Math.floor(end) };
}

function parseArgs(argv) {
	const out = {
		placePath: undefined,
		planPath: undefined,
		outDir: undefined,
		timeoutMs: 120_000,
		ports: { start: 9050, end: 9059 },
		save: false,
		drc: false,
		drcStrict: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--place') out.placePath = argv[++i];
		else if (a === '--plan') out.planPath = argv[++i];
		else if (a === '--out') out.outDir = argv[++i];
		else if (a === '--timeout') out.timeoutMs = Math.max(1_000, Number(argv[++i] ?? out.timeoutMs));
		else if (a === '--ports') out.ports = parsePortRange(argv[++i]);
		else if (a === '--save') out.save = true;
		else if (a === '--drc') out.drc = true;
		else if (a === '--drc-strict') out.drcStrict = true;
		else if (a === '-h' || a === '--help') out.help = true;
		else throw new Error(`Unknown arg: ${a}`);
	}
	if (out.drcStrict) out.drc = true;
	return out;
}

function readJson(filePath) {
	let text = fs.readFileSync(filePath, 'utf8');
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
	return JSON.parse(text);
}

function writeJson(filePath, value) {
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function listenWss(host, port) {
	return await new Promise((resolve, reject) => {
		const wss = new WebSocketServer({ host, port });
		const onListening = () => {
			cleanup();
			resolve(wss);
		};
		const onError = (err) => {
			cleanup();
			reject(err);
		};
		const cleanup = () => {
			wss.off('listening', onListening);
			wss.off('error', onError);
		};
		wss.on('listening', onListening);
		wss.on('error', onError);
	});
}

async function waitForFirstConnection(servers, timeoutMs) {
	return await new Promise((resolve, reject) => {
		let done = false;
		const timer = setTimeout(() => {
			if (done) return;
			done = true;
			reject(new Error(`Timeout after ${timeoutMs}ms waiting for JLCEDA extension to connect.`));
		}, timeoutMs);

		for (const s of servers) {
			s.wss.on('connection', (ws) => {
				if (done) {
					try {
						ws.close(1000, 'busy');
					} catch {
						// ignore
					}
					return;
				}
				done = true;
				clearTimeout(timer);
				resolve({ ws, port: s.port, wss: s.wss });
			});
		}
	});
}

function selectPin(pins, sel) {
	const wantNumber = typeof sel.pinNumber === 'string' && sel.pinNumber.trim() ? sel.pinNumber.trim() : undefined;
	const wantName = typeof sel.pinName === 'string' && sel.pinName.trim() ? sel.pinName.trim() : undefined;
	if (!wantNumber && !wantName) throw new Error('Pin selector missing pinNumber/pinName');

	if (wantNumber) {
		const matches = pins.filter((p) => String(p?.pinNumber) === wantNumber);
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) throw new Error(`Ambiguous pinNumber=${wantNumber}`);
	}
	if (wantName) {
		const matches = pins.filter((p) => String(p?.pinName) === wantName);
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) throw new Error(`Ambiguous pinName=${wantName}`);
	}
	throw new Error(`Pin not found (pinNumber=${wantNumber || ''} pinName=${wantName || ''})`);
}

function bboxOfPins(pins) {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of pins) {
		const x = Number(p?.x);
		const y = Number(p?.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;
	return { minX, maxX, minY, maxY };
}

function chooseAutoDirection(pin, bbox) {
	if (!bbox) return 'right';
	const x = Number(pin?.x);
	const y = Number(pin?.y);
	const dLeft = Math.abs(x - bbox.minX);
	const dRight = Math.abs(bbox.maxX - x);
	const dUp = Math.abs(y - bbox.minY);
	const dDown = Math.abs(bbox.maxY - y);
	const min = Math.min(dLeft, dRight, dUp, dDown);
	if (min === dLeft) return 'left';
	if (min === dRight) return 'right';
	if (min === dUp) return 'up';
	return 'down';
}

function stepVector(dir, length) {
	const len = Number(length);
	if (!Number.isFinite(len) || len <= 0) return { dx: 40, dy: 0 };
	if (dir === 'left') return { dx: -len, dy: 0 };
	if (dir === 'right') return { dx: len, dy: 0 };
	if (dir === 'up') return { dx: 0, dy: -len };
	if (dir === 'down') return { dx: 0, dy: len };
	return { dx: len, dy: 0 };
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}
	if (!args.placePath || !args.planPath || !args.outDir) {
		usage('Missing required args.');
		return;
	}

	const placePath = path.resolve(args.placePath);
	const planPath = path.resolve(args.planPath);
	const outDir = path.resolve(args.outDir);
	fs.mkdirSync(outDir, { recursive: true });

	const placeIr = readJson(placePath);
	const plan = readJson(planPath);

	const host = '127.0.0.1';
	const servers = [];
	for (let port = args.ports.start; port <= args.ports.end; port++) {
		try {
			const wss = await listenWss(host, port);
			servers.push({ port, wss });
		} catch (err) {
			const code = err?.code ? String(err.code) : '';
			if (code === 'EADDRINUSE') continue;
			console.error(`[warn] failed to listen on ${host}:${port}: ${err?.message ? String(err.message) : String(err)}`);
		}
	}
	if (!servers.length) throw new Error(`No available ports in ${args.ports.start}-${args.ports.end}`);

	console.log(`[runner] listening on ws://${host}:{${servers.map((s) => s.port).join(',')}}`);
	console.log(`[runner] outDir: ${outDir}`);
	console.log('[runner] waiting for JLCEDA extension connection...');

	const { ws, port: connectedPort, wss: connectedServer } = await waitForFirstConnection(servers, args.timeoutMs);
	for (const s of servers) {
		if (s.wss === connectedServer) continue;
		try {
			s.wss.close();
		} catch {
			// ignore
		}
	}

	const session = {
		connectedAt: new Date().toISOString(),
		listenHost: host,
		listenPort: connectedPort,
		hello: undefined,
	};

	const pending = new Map(); // id -> {resolve,reject,timer}
	let nextId = 1;

	ws.on('message', (data) => {
		let msg;
		try {
			msg = JSON.parse(String(data));
		} catch {
			return;
		}
		if (msg?.type === 'hello') {
			session.hello = msg;
			return;
		}
		if (msg?.type === 'response' && typeof msg.id === 'string') {
			const p = pending.get(msg.id);
			if (!p) return;
			pending.delete(msg.id);
			clearTimeout(p.timer);
			if (msg.error) {
				const e = new Error(`${msg.error.code || 'ERROR'}: ${msg.error.message || 'unknown error'}`);
				e.code = msg.error.code;
				e.data = msg.error.data;
				p.reject(e);
				return;
			}
			p.resolve(msg.result);
		}
	});

	function rpcCall(method, params, timeoutMs = 60_000) {
		const id = String(nextId++);
		const req = { type: 'request', id, method, params };
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`RPC timeout after ${timeoutMs}ms: ${method}`));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
			ws.send(JSON.stringify(req));
		});
	}

	const result = { ok: true, session, inputs: { placePath, planPath }, calls: {}, files: {}, warnings: [] };

	try {
		// 1) Place components
		const placeRes = await rpcCall('schematic.applyIr', placeIr, 180_000);
		result.calls.apply_place = placeRes;

		const appliedComponents = placeRes?.applied?.components || {};
		const primitiveIdByComponentId = new Map();
		for (const [id, v] of Object.entries(appliedComponents)) {
			if (v?.primitiveId) primitiveIdByComponentId.set(id, String(v.primitiveId));
		}

		// 2) Query pins for components referenced by plan
		const needComponentIds = new Set();
		for (const nl of Array.isArray(plan?.netlabels) ? plan.netlabels : []) needComponentIds.add(String(nl?.componentId || ''));
		for (const c of Array.isArray(plan?.connections) ? plan.connections : []) {
			needComponentIds.add(String(c?.from?.componentId || ''));
			needComponentIds.add(String(c?.to?.componentId || ''));
		}
		needComponentIds.delete('');

		const pinsByComponentId = new Map();
		const bboxByComponentId = new Map();
		for (const componentId of needComponentIds) {
			const primitiveId = primitiveIdByComponentId.get(componentId);
			if (!primitiveId) throw new Error(`Missing primitiveId for componentId=${componentId} (did place.ir include it?)`);
			const pinsRes = await rpcCall('schematic.getComponentPins', { primitiveId }, 60_000);
			const pins = Array.isArray(pinsRes?.pins) ? pinsRes.pins : [];
			if (!pins.length) throw new Error(`No pins for componentId=${componentId} primitiveId=${primitiveId}`);
			pinsByComponentId.set(componentId, pins);
			bboxByComponentId.set(componentId, bboxOfPins(pins));
		}

		// 3) Build wiring IR (netlabels -> wires with NET, connections -> IR.connections)
		const wires = [];
		for (const nl of Array.isArray(plan?.netlabels) ? plan.netlabels : []) {
			const id = String(nl?.id || '').trim();
			const componentId = String(nl?.componentId || '').trim();
			const net = String(nl?.net || '').trim();
			if (!id || !componentId || !net) continue;

			const pins = pinsByComponentId.get(componentId);
			if (!pins) throw new Error(`Pins not loaded for componentId=${componentId}`);

			const pin = selectPin(pins, { pinNumber: nl?.pinNumber ?? undefined, pinName: nl?.pinName ?? undefined });
			const x1 = Number(pin?.x);
			const y1 = Number(pin?.y);
			if (!Number.isFinite(x1) || !Number.isFinite(y1)) throw new Error(`Invalid pin coords for ${componentId}`);

			let dir = String(nl?.direction || 'auto');
			if (dir === 'auto') dir = chooseAutoDirection(pin, bboxByComponentId.get(componentId));
			const { dx, dy } = stepVector(dir, nl?.length ?? 40);
			const x2 = x1 + dx;
			const y2 = y1 + dy;

			wires.push({ id, net, line: [x1, y1, x2, y2] });
		}

		const connections = [];
		for (const c of Array.isArray(plan?.connections) ? plan.connections : []) {
			const id = String(c?.id || '').trim();
			if (!id) continue;
			const from = c?.from || {};
			const to = c?.to || {};
			const net = typeof c?.net === 'string' ? c.net : undefined;
			const style = c?.style === 'straight' ? 'straight' : 'manhattan';
			const midX = typeof c?.midX === 'number' && Number.isFinite(c.midX) ? c.midX : undefined;
			connections.push({
				id,
				from: { componentId: String(from.componentId), pinNumber: from.pinNumber, pinName: from.pinName },
				to: { componentId: String(to.componentId), pinNumber: to.pinNumber, pinName: to.pinName },
				net,
				style,
				midX,
			});
		}

		const wiringIr = {
			version: 1,
			units: typeof placeIr?.units === 'string' ? placeIr.units : 'sch',
			page: { ensure: false },
			components: [],
			netFlags: [],
			netPorts: [],
			texts: [],
			wires,
			connections,
			post: {
				zoomToAll: true,
				drc: args.drc ? { strict: Boolean(args.drcStrict), userInterface: false } : undefined,
				save: Boolean(args.save),
			},
		};

		const wiringRes = await rpcCall('schematic.applyIr', wiringIr, 180_000);
		result.calls.apply_wiring = wiringRes;

		// 4) Capture image + export netlist + document source (best-effort)
		try {
			const cap = await rpcCall(
				'captureRenderedAreaImage',
				{ zoomToAll: true, returnBase64: true, fileName: 'rendered.png' },
				60_000,
			);
			if (cap?.base64) {
				const pngPath = path.join(outDir, cap.fileName || 'rendered.png');
				fs.writeFileSync(pngPath, Buffer.from(String(cap.base64), 'base64'));
				result.files.renderedPng = pngPath;
			} else {
				result.warnings.push('captureRenderedAreaImage returned no base64');
				result.calls.captureRenderedAreaImage = cap;
			}
		} catch (e) {
			result.warnings.push(`captureRenderedAreaImage failed: ${e?.message || e}`);
		}

		try {
			const netFile = await rpcCall(
				'exportSchematicNetlistFile',
				{ netlistType: 'JLCEDA', returnBase64: true, fileName: 'netlist.net' },
				120_000,
			);
			if (netFile?.base64) {
				const netPath = path.join(outDir, netFile.fileName || 'netlist.net');
				fs.writeFileSync(netPath, Buffer.from(String(netFile.base64), 'base64'));
				result.files.netlistFile = netPath;
			} else {
				result.warnings.push('exportSchematicNetlistFile returned no base64');
				result.calls.exportSchematicNetlistFile = netFile;
			}
		} catch (e) {
			result.warnings.push(`exportSchematicNetlistFile failed: ${e?.message || e}`);
		}

		try {
			const src = await rpcCall('getDocumentSource', { maxChars: 2_000_000 }, 120_000);
			if (typeof src?.source === 'string') {
				const srcPath = path.join(outDir, 'document_source.txt');
				fs.writeFileSync(srcPath, `${src.source}\n`, 'utf8');
				result.files.documentSource = srcPath;
				result.calls.getDocumentSource = { truncated: Boolean(src.truncated), totalChars: Number(src.totalChars ?? 0) };
			} else {
				result.warnings.push('getDocumentSource returned no source');
				result.calls.getDocumentSource = src;
			}
		} catch (e) {
			result.warnings.push(`getDocumentSource failed: ${e?.message || e}`);
		}
	} catch (err) {
		result.ok = false;
		result.error = String(err?.message || err);
		result.errorStack = err?.stack ? String(err.stack) : undefined;
	} finally {
		const resultPath = path.join(outDir, 'runner_results.json');
		writeJson(resultPath, result);
		console.log(`[runner] wrote: ${resultPath}`);
		try {
			ws.close(1000, 'done');
		} catch {
			// ignore
		}
		try {
			connectedServer.close();
		} catch {
			// ignore
		}
	}
}

main().catch((err) => {
	usage(err?.message ? String(err.message) : String(err));
	process.exitCode = 1;
});

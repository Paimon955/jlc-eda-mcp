#!/usr/bin/env node
/**
 * Export the currently active JLCEDA Pro document via jlceda-mcp-bridge WebSocket RPC.
 *
 * This script starts a WebSocket server on 127.0.0.1:9050-9059 (configurable) and waits for
 * the JLCEDA extension to connect (the extension acts as a WS client). Then it issues RPC calls:
 * - getCurrentDocumentInfo
 * - exportDocumentFile (.epro2)
 * - captureRenderedAreaImage (png)
 * - exportSchematicNetlistFile (JLCEDA) [best-effort; requires schematic page]
 * - getDocumentSource (truncated)
 *
 * Usage:
 *   node scripts/export-open-document.mjs --out "G:\\path\\to\\folder"
 *
 * Optional:
 *   --ports 9050-9059
 *   --timeout 60000
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
			'  node scripts/export-open-document.mjs --out "<folder>" [--ports 9050-9059] [--timeout 60000]',
			'',
			'Prereqs in JLCEDA:',
			'- Extension "JLCEDA MCP Bridge" enabled',
			'- Extension configured to ws://127.0.0.1:9050 (port pool 9050-9059 auto-used)',
			'- External interaction permission enabled (for file export/save)',
		].join('\n'),
	);
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
	const out = { outDir: undefined, ports: { start: 9050, end: 9059 }, timeoutMs: 60_000 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--out') out.outDir = argv[++i];
		else if (a === '--ports') out.ports = parsePortRange(argv[++i]);
		else if (a === '--timeout') out.timeoutMs = Math.max(1_000, Number(argv[++i] ?? 60_000));
		else if (a === '-h' || a === '--help') return { ...out, help: true };
		else throw new Error(`Unknown arg: ${a}`);
	}
	if (!out.outDir) throw new Error('Missing required --out "<folder>"');
	return out;
}

function ensureFolderUri(p) {
	const s = String(p ?? '').trim();
	if (!s) throw new Error('Empty outDir');
	if (s.endsWith('/') || s.endsWith('\\')) return s;
	return `${s}${path.sep}`;
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

function writeJson(filePath, data) {
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		usage();
		return;
	}

	const outDir = path.resolve(args.outDir);
	fs.mkdirSync(outDir, { recursive: true });
	const folderUri = ensureFolderUri(outDir);

	const host = '127.0.0.1';
	const servers = [];
	for (let port = args.ports.start; port <= args.ports.end; port++) {
		try {
			const wss = await listenWss(host, port);
			servers.push({ port, wss });
		} catch (err) {
			const code = err?.code ? String(err.code) : '';
			if (code === 'EADDRINUSE') continue;
			// If one port fails for other reasons, keep trying other ports, but note it.
			console.error(`[warn] failed to listen on ${host}:${port}: ${err?.message ? String(err.message) : String(err)}`);
		}
	}

	if (!servers.length) {
		throw new Error(`No available ports to listen on in ${args.ports.start}-${args.ports.end}`);
	}

	console.log(`[export] listening on ws://${host}:{${servers.map((s) => s.port).join(',')}}`);
	console.log(`[export] output dir: ${folderUri}`);
	console.log('[export] waiting for JLCEDA extension connection...');

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
		outDir: folderUri,
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

	const results = { ok: true, session, calls: {}, files: {}, warnings: [] };

	try {
		results.calls.getCurrentDocumentInfo = await rpcCall('getCurrentDocumentInfo', undefined, 30_000);

		// Prefer "returnBase64" to avoid SYS_FileSystem permission issues (saveFileToFileSystem may throw "Failed to fetch").
		const capture = await rpcCall(
			'captureRenderedAreaImage',
			{ zoomToAll: true, returnBase64: true, fileName: 'rendered.png' },
			60_000,
		);
		if (capture?.base64) {
			const pngPath = path.join(outDir, capture.fileName || 'rendered.png');
			fs.writeFileSync(pngPath, Buffer.from(String(capture.base64), 'base64'));
			results.files.renderedPng = pngPath;
		} else {
			results.warnings.push('captureRenderedAreaImage returned no base64');
			results.calls.captureRenderedAreaImage = capture;
		}

		try {
			const netlist = await rpcCall(
				'exportSchematicNetlistFile',
				{ netlistType: 'JLCEDA', returnBase64: true, fileName: 'netlist.net' },
				120_000,
			);
			if (netlist?.base64) {
				const netPath = path.join(outDir, netlist.fileName || 'netlist.net');
				fs.writeFileSync(netPath, Buffer.from(String(netlist.base64), 'base64'));
				results.files.netlistFile = netPath;
				results.calls.exportSchematicNetlistFile = { ok: true, fileName: netlist.fileName, netlistType: netlist.netlistType };
			} else {
				results.calls.exportSchematicNetlistFile = netlist;
				results.warnings.push('exportSchematicNetlistFile returned no base64');
			}
		} catch (err) {
			results.calls.exportSchematicNetlistFile = { ok: false, error: String(err?.message || err) };
		}

		const docSource = await rpcCall('getDocumentSource', { maxChars: 2_000_000 }, 120_000);
		results.calls.getDocumentSource = { truncated: Boolean(docSource?.truncated), totalChars: Number(docSource?.totalChars ?? 0) };
		if (typeof docSource?.source === 'string') {
			const srcPath = path.join(outDir, 'document_source.txt');
			fs.writeFileSync(srcPath, `${docSource.source}\n`, 'utf8');
			results.files.documentSource = srcPath;
		} else {
			results.warnings.push('getDocumentSource returned no source');
		}

		// Best-effort: export full document file (.epro2) directly to filesystem (requires permissions).
		try {
			results.calls.exportDocumentFile = await rpcCall(
				'exportDocumentFile',
				{ fileType: '.epro2', savePath: folderUri, force: true },
				120_000,
			);
		} catch (err) {
			results.calls.exportDocumentFile = { ok: false, error: String(err?.message || err) };
			results.warnings.push('exportDocumentFile failed (likely missing SYS_FileSystem / 文件导出 permissions)');
		}
	} catch (err) {
		results.ok = false;
		results.error = String(err?.message || err);
		results.errorStack = err?.stack ? String(err.stack) : undefined;
	} finally {
		const resultPath = path.join(outDir, 'export_rpc_results.json');
		writeJson(resultPath, results);

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

	console.log(`[export] wrote: ${path.join(outDir, 'export_rpc_results.json')}`);
	if (results.ok) console.log('[export] done');
	else console.log('[export] finished with errors; see export_rpc_results.json');
}

main().catch((err) => {
	usage(err?.message ? String(err.message) : String(err));
	process.exitCode = 1;
});

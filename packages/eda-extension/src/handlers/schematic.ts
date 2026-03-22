import {
	asNumber,
	asObject,
	asOptionalBoolean,
	asOptionalNumber,
	asOptionalString,
	asOptionalUuid32,
	asString,
	asUuid32,
	endsWithPathSeparator,
	rpcError,
	safeFileName,
} from '../bridge/validate';

function encodeBase64(bytes: Uint8Array): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const out: Array<string> = [];
	for (let i = 0; i < bytes.length; i += 3) {
		const b1 = bytes[i] ?? 0;
		const hasB2 = i + 1 < bytes.length;
		const hasB3 = i + 2 < bytes.length;
		const b2 = hasB2 ? bytes[i + 1]! : 0;
		const b3 = hasB3 ? bytes[i + 2]! : 0;
		const triple = (b1 << 16) | (b2 << 8) | b3;
		out.push(
			alphabet[(triple >> 18) & 63]!,
			alphabet[(triple >> 12) & 63]!,
			hasB2 ? alphabet[(triple >> 6) & 63]! : '=',
			hasB3 ? alphabet[triple & 63]! : '=',
		);
	}
	return out.join('');
}

async function blobToBase64(blob: Blob): Promise<{ base64: string; sizeBytes: number; mimeType?: string }> {
	const buf = await blob.arrayBuffer();
	const bytes = new Uint8Array(buf);
	return { base64: encodeBase64(bytes), sizeBytes: bytes.byteLength, mimeType: blob.type || undefined };
}

async function requireSchematicPage(): Promise<{ tabId: string; uuid: string }> {
	const info = await eda.dmt_SelectControl.getCurrentDocumentInfo();
	if (!info) throw rpcError('NO_ACTIVE_DOCUMENT', 'No active document');
	if (info.documentType !== 1 /* SCHEMATIC_PAGE */) {
		throw rpcError('NOT_IN_SCHEMATIC_PAGE', 'Current document is not a schematic page');
	}
	return { tabId: info.tabId, uuid: info.uuid };
}

function getTimestampForFileName(): string {
	return safeFileName(new Date().toISOString());
}

function joinPath(folderOrFile: string, fileName: string): string {
	if (endsWithPathSeparator(folderOrFile)) return `${folderOrFile}${fileName}`;
	return folderOrFile;
}

function looksLikeFilePath(savePath: string): boolean {
	const trimmed = savePath.trim();
	if (!trimmed) return false;
	if (endsWithPathSeparator(trimmed)) return false;
	const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	const base = lastSep >= 0 ? trimmed.slice(lastSep + 1) : trimmed;
	return base.length >= 3 && base.includes('.') && !base.startsWith('.') && !base.endsWith('.');
}

function ensureFolderUri(savePath: string): string {
	const trimmed = savePath.trim();
	if (endsWithPathSeparator(trimmed)) return trimmed;
	if (looksLikeFilePath(trimmed)) return trimmed;
	const sep = trimmed.includes('/') && !trimmed.includes('\\') ? '/' : '\\';
	return `${trimmed}${sep}`;
}

export async function exportNetlistFile(
	params: unknown,
): Promise<
	| { savedTo?: string; fileName: string; netlistType: string; downloadTriggered?: boolean }
	| { fileName: string; netlistType: string; base64: string; sizeBytes: number; mimeType?: string }
> {
	await requireSchematicPage();

	const input = params ? asObject(params, 'params') : {};
	const netlistType = asOptionalString(input.netlistType, 'netlistType') ?? 'JLCEDA';
	const savePath = asOptionalString(input.savePath, 'savePath');
	const fileNameInput = asOptionalString(input.fileName, 'fileName');
	const returnBase64 = asOptionalBoolean(input.returnBase64, 'returnBase64') ?? false;
	const force = asOptionalBoolean(input.force, 'force') ?? true;

	const defaultExt = netlistType === 'EasyEDA' ? '.enet' : '.net';
	const fileName = safeFileName(fileNameInput || `jlceda_mcp_netlist_${getTimestampForFileName()}${defaultExt}`);

	let file: File | undefined;
	try {
		file = await eda.sch_ManufactureData.getNetlistFile(fileName, netlistType as any);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw rpcError('EXPORT_FAILED', `eda.sch_ManufactureData.getNetlistFile threw: ${msg}`);
	}
	if (!file) throw rpcError('EXPORT_FAILED', 'Failed to get netlist file');

	if (returnBase64) {
		try {
			const { base64, sizeBytes, mimeType } = await blobToBase64(file);
			return { fileName, netlistType, base64, sizeBytes, mimeType };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			throw rpcError('EXPORT_FAILED', `Failed to read exported netlist file content: ${msg}`);
		}
	}

	let resolvedSavePath = savePath;
	if (!resolvedSavePath) {
		try {
			const edaPath = await eda.sys_FileSystem.getEdaPath();
			resolvedSavePath = endsWithPathSeparator(edaPath) ? edaPath : `${edaPath}\\`;
		} catch {
			// fallback to saveFile below
		}
	}

	if (resolvedSavePath) {
		const userProvidedSavePath = Boolean(savePath);
		const uri = ensureFolderUri(resolvedSavePath);
		try {
			const ok = await eda.sys_FileSystem.saveFileToFileSystem(uri, file, fileName, force);
			if (!ok) throw rpcError('SAVE_FILE_FAILED', 'Failed to save netlist file to file system');
			return { savedTo: joinPath(uri, fileName), fileName, netlistType };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!userProvidedSavePath) {
				// Best-effort fallback: trigger a download when direct filesystem write is unavailable.
				await eda.sys_FileSystem.saveFile(file, fileName);
				return { fileName, netlistType, downloadTriggered: true };
			}
			throw rpcError(
				'SAVE_FILE_FAILED',
				`sys_FileSystem.saveFileToFileSystem threw: ${msg}. Note: savePath must be an absolute path; if it's a folder, end it with \\\\ or /.`,
			);
		}
	}

	await eda.sys_FileSystem.saveFile(file, fileName);
	return { fileName, netlistType, downloadTriggered: true };
}

export async function getNetlist(params: unknown): Promise<{ netlistType: string; netlist: string; truncated: boolean; totalChars: number }> {
	await requireSchematicPage();

	const input = params ? asObject(params, 'params') : {};
	const netlistType = asOptionalString(input.netlistType, 'netlistType') ?? 'JLCEDA';
	const maxChars = asOptionalNumber(input.maxChars, 'maxChars');
	const timeoutMs = asOptionalNumber(input.timeoutMs, 'timeoutMs') ?? 30_000;

	const netlistApi = (eda as any)?.sch_Netlist;
	const getNetlistFn = netlistApi?.getNetlist;
	if (!netlistApi || typeof getNetlistFn !== 'function') {
		throw rpcError('NOT_SUPPORTED', 'eda.sch_Netlist.getNetlist is not available in this EDA version');
	}

	const netlist = String(
		await Promise.race([
			Promise.resolve().then(() => getNetlistFn.call(netlistApi, netlistType as any)),
			new Promise((_, reject) =>
				setTimeout(() => reject(rpcError('TIMEOUT', `Timed out getting netlist after ${timeoutMs}ms`)), timeoutMs),
			),
		]),
	);
	const totalChars = netlist.length;

	if (maxChars && Number.isFinite(maxChars) && maxChars > 0 && totalChars > maxChars) {
		return { netlistType, netlist: netlist.slice(0, Math.floor(maxChars)), truncated: true, totalChars };
	}

	return { netlistType, netlist, truncated: false, totalChars };
}

export async function placeDevice(params: unknown): Promise<{ primitiveId: string }> {
	await requireSchematicPage();

	const input = params ? asObject(params, 'params') : {};
	const deviceUuid = asUuid32(input.deviceUuid, 'deviceUuid');
	const libraryUuid = asOptionalUuid32(input.libraryUuid, 'libraryUuid');
	const x = asNumber(input.x, 'x');
	const y = asNumber(input.y, 'y');
	const subPartName = asOptionalString(input.subPartName, 'subPartName');
	const rotation = asOptionalNumber(input.rotation, 'rotation');
	const mirror = asOptionalBoolean(input.mirror, 'mirror');
	const addIntoBom = asOptionalBoolean(input.addIntoBom, 'addIntoBom');
	const addIntoPcb = asOptionalBoolean(input.addIntoPcb, 'addIntoPcb');

	const designator = asOptionalString(input.designator, 'designator');
	const name = input.name === null ? null : asOptionalString(input.name, 'name');

	let deviceRef: any;
	if (libraryUuid) {
		deviceRef = { uuid: deviceUuid, libraryUuid };
	} else {
		const item = await eda.lib_Device.get(deviceUuid);
		if (!item) throw rpcError('NOT_FOUND', 'Device not found');
		deviceRef = item;
	}

	const primitive = await (eda.sch_PrimitiveComponent as any).create(deviceRef, x, y, subPartName, rotation, mirror, addIntoBom, addIntoPcb);
	if (!primitive) throw rpcError('PLACE_FAILED', 'Failed to place device');
	const primitiveId = primitive.getState_PrimitiveId();

	if (designator !== undefined || name !== undefined) {
		await (eda.sch_PrimitiveComponent as any).modify(primitiveId, { designator, name });
	}

	return { primitiveId };
}

export async function getComponentPins(params: unknown): Promise<{ primitiveId: string; pins: Array<any> }> {
	await requireSchematicPage();

	const input = params ? asObject(params, 'params') : {};
	const primitiveId = asString(input.primitiveId, 'primitiveId');

	const pins = await (eda.sch_PrimitiveComponent as any).getAllPinsByPrimitiveId(primitiveId);
	if (!pins) throw rpcError('NOT_FOUND', 'No pins found for component');

	return {
		primitiveId,
		pins: pins.map((p: any) => ({
			primitiveId: p.getState_PrimitiveId(),
			x: p.getState_X(),
			y: p.getState_Y(),
			pinNumber: p.getState_PinNumber(),
			pinName: p.getState_PinName(),
			rotation: p.getState_Rotation(),
			pinLength: p.getState_PinLength(),
		})),
	};
}

function findPin(pins: Array<any>, selector: { pinNumber?: string; pinName?: string }): any {
	if (selector.pinNumber) {
		const matches = pins.filter((p) => String(p.getState_PinNumber()) === selector.pinNumber);
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) throw rpcError('AMBIGUOUS_PIN', `Multiple pins match pinNumber=${selector.pinNumber}`);
	}
	if (selector.pinName) {
		const matches = pins.filter((p) => String(p.getState_PinName()) === selector.pinName);
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) throw rpcError('AMBIGUOUS_PIN', `Multiple pins match pinName=${selector.pinName}`);
	}
	throw rpcError('PIN_NOT_FOUND', 'Pin not found (provide pinNumber or pinName)');
}

	export async function connectPins(params: unknown): Promise<{ wirePrimitiveId: string; line: Array<number> }> {
		await requireSchematicPage();

	const input = params ? asObject(params, 'params') : {};
	const fromPrimitiveId = asString(input.fromPrimitiveId, 'fromPrimitiveId');
	const fromPinNumber = asOptionalString(input.fromPinNumber, 'fromPinNumber');
	const fromPinName = asOptionalString(input.fromPinName, 'fromPinName');
	const toPrimitiveId = asString(input.toPrimitiveId, 'toPrimitiveId');
	const toPinNumber = asOptionalString(input.toPinNumber, 'toPinNumber');
	const toPinName = asOptionalString(input.toPinName, 'toPinName');
	const net = asOptionalString(input.net, 'net');
	const style = asOptionalString(input.style, 'style') ?? 'manhattan';
	const midX = asOptionalNumber(input.midX, 'midX');

	const fromPins = await (eda.sch_PrimitiveComponent as any).getAllPinsByPrimitiveId(fromPrimitiveId);
	const toPins = await (eda.sch_PrimitiveComponent as any).getAllPinsByPrimitiveId(toPrimitiveId);
	if (!fromPins) throw rpcError('NOT_FOUND', 'fromPrimitiveId pins not found');
	if (!toPins) throw rpcError('NOT_FOUND', 'toPrimitiveId pins not found');

	const fromPin = findPin(fromPins, { pinNumber: fromPinNumber, pinName: fromPinName });
	const toPin = findPin(toPins, { pinNumber: toPinNumber, pinName: toPinName });

	const x1 = fromPin.getState_X();
	const y1 = fromPin.getState_Y();
	const x2 = toPin.getState_X();
	const y2 = toPin.getState_Y();

		let line: Array<number>;
		if (style === 'straight') {
			line = [x1, y1, x2, y2];
		} else {
			const mx = midX ?? (x1 + x2) / 2;
			line = [x1, y1, mx, y1, mx, y2, x2, y2];
		}

		const netName = typeof net === 'string' && net.trim() ? net.trim() : undefined;
		const wire = netName ? await eda.sch_PrimitiveWire.create(line, netName) : await eda.sch_PrimitiveWire.create(line);
		if (!wire) throw rpcError('WIRE_CREATE_FAILED', 'Failed to create wire');

		return { wirePrimitiveId: wire.getState_PrimitiveId(), line };
	}

	export async function createWire(params: unknown): Promise<{ wirePrimitiveId: string }> {
		await requireSchematicPage();

	const input = params ? asObject(params, 'params') : {};
	const line = input.line;
	const net = asOptionalString(input.net, 'net');

	if (!Array.isArray(line)) throw rpcError('INVALID_PARAMS', 'Expected line to be an array');

	const normalizeSegment = (seg: any): Array<number> => {
		if (!Array.isArray(seg)) throw rpcError('INVALID_PARAMS', 'Expected line segment to be an array of numbers');
		if (seg.length < 4 || seg.length % 2 !== 0) throw rpcError('INVALID_PARAMS', 'Line segment must have even length >= 4');
		for (const n of seg) {
			if (typeof n !== 'number' || Number.isNaN(n)) throw rpcError('INVALID_PARAMS', 'Line coordinates must be numbers');
		}
		return seg as Array<number>;
	};

		let normalized: Array<number> | Array<Array<number>>;
		if (line.length === 0) throw rpcError('INVALID_PARAMS', 'Line must not be empty');
		if (typeof line[0] === 'number') {
			normalized = normalizeSegment(line);
		} else {
			normalized = (line as Array<any>).map(normalizeSegment);
		}

		const netName = typeof net === 'string' && net.trim() ? net.trim() : undefined;
		const wire = netName
			? await eda.sch_PrimitiveWire.create(normalized as any, netName)
			: await eda.sch_PrimitiveWire.create(normalized as any);
		if (!wire) throw rpcError('WIRE_CREATE_FAILED', 'Failed to create wire');

		return { wirePrimitiveId: wire.getState_PrimitiveId() };
	}

export async function runDrc(params: unknown): Promise<{ ok: boolean }> {
	await requireSchematicPage();

	const input = params ? asObject(params, 'params') : {};
	const strict = asOptionalBoolean(input.strict, 'strict') ?? false;
	const userInterface = asOptionalBoolean(input.userInterface, 'userInterface') ?? false;

	const ok = await eda.sch_Drc.check(strict, userInterface);
	return { ok };
}

export async function saveSchematic(): Promise<{ ok: boolean }> {
	await requireSchematicPage();
	const ok = await eda.sch_Document.save();
	return { ok };
}

/**
 * Bambu Lab cloud REST client (login + verification + device bind).
 * Protocol per OpenBambuAPI, ha-bambulab/pybambu, ClusterM/open-bamboo-networking.
 *
 * Login can return one of three outcomes, keyed by `loginType`:
 *   - token present            → success
 *   - loginType == 'verifyCode'→ email/SMS code required (request code, re-login w/ code)
 *   - loginType == 'tfa'       → authenticator 2FA required (separate web flow, tfaKey)
 */
import { REGIONS, region as normRegion, type Region } from './config';
import type { BambuDeviceModel, DiscoveredPrinter } from './index';

const UA = 'SparkPrint/0.1';

function api(r: Region) {
	return REGIONS[r].api;
}

async function post(r: Region, path: string, body: unknown, token?: string) {
	const res = await fetch(api(r) + path, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'user-agent': UA,
			...(token ? { authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify(body)
	});
	return res;
}

export type LoginResult =
	| { status: 'ok'; accessToken: string; refreshToken: string | null; expiresAt: Date | null; uid: string }
	| { status: 'needCode' }
	| { status: 'needTfa'; tfaKey: string }
	| { status: 'error'; message: string };

/** Decode the `username` (u_<uid>) and `exp` from the access-token JWT. */
function decodeToken(token: string): { uid: string; expiresAt: Date | null } {
	try {
		const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
		const uid = typeof payload.username === 'string' ? payload.username : `u_${payload.uid ?? ''}`;
		const expiresAt = typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
		return { uid, expiresAt };
	} catch {
		return { uid: '', expiresAt: null };
	}
}

function fromLoginJson(json: any): LoginResult {
	if (json?.accessToken) {
		const { uid, expiresAt } = decodeToken(json.accessToken);
		return {
			status: 'ok',
			accessToken: json.accessToken,
			refreshToken: json.refreshToken ?? null,
			expiresAt: expiresAt ?? (json.expiresIn ? new Date(Date.now() + json.expiresIn * 1000) : null),
			uid
		};
	}
	if (json?.loginType === 'verifyCode') return { status: 'needCode' };
	if (json?.loginType === 'tfa') return { status: 'needTfa', tfaKey: json.tfaKey ?? '' };
	return { status: 'error', message: json?.error ?? 'Unexpected login response' };
}

/** Step 1: attempt password login. */
export async function login(email: string, password: string, r: string): Promise<LoginResult> {
	const reg = normRegion(r);
	const res = await post(reg, '/v1/user-service/user/login', { account: email, password, apiError: '' });
	if (res.status === 429) return { status: 'error', message: 'Bambu rate-limited the login. Wait a minute and retry.' };
	if (!res.ok && res.status !== 200) return { status: 'error', message: `Login failed (HTTP ${res.status})` };
	return fromLoginJson(await res.json().catch(() => ({})));
}

/** Request an email verification code be sent (codeLogin). */
export async function sendEmailCode(email: string, r: string): Promise<boolean> {
	const res = await post(normRegion(r), '/v1/user-service/user/sendemail/code', { email, type: 'codeLogin' });
	return res.ok;
}

/** Step 2 (code path): complete login with the emailed code. */
export async function loginWithCode(email: string, code: string, r: string): Promise<LoginResult> {
	const reg = normRegion(r);
	const res = await post(reg, '/v1/user-service/user/login', { account: email, code });
	if (res.status === 400) {
		const j = await res.json().catch(() => ({}));
		return { status: 'error', message: j?.code === 1 ? 'That code expired — request a new one.' : 'Incorrect code.' };
	}
	if (!res.ok) return { status: 'error', message: `Verification failed (HTTP ${res.status})` };
	return fromLoginJson(await res.json().catch(() => ({})));
}

const MODEL_MAP: Record<string, BambuDeviceModel> = {
	'X1 Carbon': 'X1C',
	'X1C': 'X1C',
	'X1E': 'X1E',
	'X1': 'X1',
	'P1S': 'P1S',
	'P1P': 'P1P',
	'A1': 'A1',
	'A1 mini': 'A1M',
	'A1M': 'A1M',
	'H2D': 'H2D',
	'H2': 'H2D'
};

/** List devices bound to the authenticated account. AMS is filled later by MQTT reports. */
export async function listDevices(token: string, r: string): Promise<DiscoveredPrinter[]> {
	const reg = normRegion(r);
	const res = await fetch(api(reg) + '/v1/iot-service/api/user/bind', {
		headers: { authorization: `Bearer ${token}`, 'user-agent': UA }
	});
	if (!res.ok) throw new Error(`Device list failed (HTTP ${res.status})`);
	const json: any = await res.json();
	const devices: any[] = json?.devices ?? [];
	return devices.map((d) => ({
		devId: d.dev_id,
		name: d.name || d.dev_id,
		model: MODEL_MAP[d.dev_product_name] ?? MODEL_MAP[d.dev_model_name] ?? 'X1C',
		online: !!d.online,
		nozzleDiameter: parseFloat(d.nozzle_diameter ?? '0.4') || 0.4,
		accessCode: d.dev_access_code ?? null,
		ams: [] // populated from MQTT report
	}));
}

export { decodeToken };

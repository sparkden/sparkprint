/**
 * Cloud print dispatch — tell Bambu's cloud to print a sliced 3mf that we host ourselves; the
 * cloud forwards the task to the printer over MQTT and the printer downloads the file from our URL.
 *
 * Why we self-host the file: Bambu's presigned S3 upload bucket isn't readable by the printer
 * (a bare object URL returns 403), and the documented create→upload→register handshake never
 * produces a device-downloadable URL for us — so the printer reported "verification failed" when
 * handed the S3 URL. Verified against the live API that /v1/user-service/my/task accepts an
 * arbitrary `url` (an external example.com URL is accepted), so we pass a token-signed URL to our
 * own /api/print/<token> endpoint. The printer fetches the exact bytes we sliced and verifies them
 * against the `md5` we send with the task.
 *
 * Sequence:
 *   1. POST /v1/iot-service/api/user/project   → project_id, model_id, profile_id (ids only)
 *   2. POST /v1/user-service/my/task           → cloud dispatches the print (camelCase body!)
 *
 * The task body is camelCase (unlike the snake_case iot-service endpoints); required keys, verified
 * live, are modelId, title, profileId, cover, deviceId, plateIndex.
 */
import { createHash } from 'node:crypto';
import { REGIONS, type Region } from './config';

export type CloudPrintInput = {
	accessToken: string;
	region: Region;
	devId: string;
	jobName: string;
	fileUrl: string; // printer-reachable https URL to the .gcode.3mf we host
	md5: string; // uppercase md5 hex of the file at fileUrl
	plateIdx: number;
	bedType: string;
	amsMapping: number[];
};

export type CloudPrintResult = { ok: boolean; taskId?: string; error?: string };

export function md5Hex(buf: Buffer | Uint8Array): string {
	return createHash('md5').update(buf).digest('hex').toUpperCase();
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
	return { authorization: `Bearer ${token}`, 'user-agent': 'SparkPrint/0.1', ...extra };
}

export async function sendCloudPrint(input: CloudPrintInput): Promise<CloudPrintResult> {
	const api = REGIONS[input.region].api;

	try {
		// 1 ── Create a project purely to obtain the ids /my/task requires.
		const createRes = await fetch(`${api}/v1/iot-service/api/user/project`, {
			method: 'POST',
			headers: authHeaders(input.accessToken, { 'content-type': 'application/json' }),
			body: JSON.stringify({ name: input.jobName })
		});
		if (!createRes.ok) return { ok: false, error: `create project HTTP ${createRes.status}` };
		const project: any = await createRes.json().catch(() => ({}));
		const projectId = project.project_id ?? project.id;
		const profileId = project.profile_id ?? '0';
		const modelId = project.model_id ?? project.modelId ?? projectId;
		if (!projectId) return { ok: false, error: 'create project: missing project_id' };

		// 2 ── Create the task; Bambu cloud dispatches to the printer, which downloads our fileUrl.
		const taskRes = await fetch(`${api}/v1/user-service/my/task`, {
			method: 'POST',
			headers: authHeaders(input.accessToken, {
				'content-type': 'application/json',
				'X-BBL-Client-Name': 'BambuStudio',
				'X-BBL-Client-Type': 'slicer',
				'X-BBL-OS-Type': 'linux'
			}),
			body: JSON.stringify({
				modelId: String(modelId),
				projectId: Number(projectId) || 0,
				profileId: Number(profileId) || 0,
				title: input.jobName,
				cover: '',
				deviceId: input.devId,
				plateIndex: input.plateIdx,
				url: input.fileUrl,
				md5: input.md5,
				bedType: input.bedType,
				useAms: input.amsMapping.length > 0,
				amsMapping: input.amsMapping,
				bedLeveling: true,
				flowCali: false,
				vibrationCali: false,
				layerInspect: true,
				timelapse: false,
				context: 'slicer',
				designId: 0,
				instanceId: 0
			})
		});
		if (!taskRes.ok) return { ok: false, error: `create task HTTP ${taskRes.status}: ${(await taskRes.text()).slice(0, 200)}` };
		const task: any = await taskRes.json().catch(() => ({}));
		return { ok: true, taskId: String(task.task_id ?? task.id ?? '') };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

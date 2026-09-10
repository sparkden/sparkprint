/**
 * Cloud print dispatch — upload a sliced 3mf to Bambu's cloud and create a print task;
 * Bambu's cloud then forwards the `project_file` command to the printer over MQTT.
 *
 * Sequence (per ClusterM/open-bamboo-networking MITM of the official networking plugin):
 *   1. POST /v1/iot-service/api/user/project            → project_id, profile_id, model_id, upload_url
 *   2. PUT  <upload_url>  (the 3mf)   ⚠ send NO Content-Type header (presign signed empty)
 *   3. PATCH /v1/iot-service/api/user/project/<id>       → register {md5, plate_idx, https url}
 *   4. POST /v1/user-service/my/task  (headers: X-BBL-Client-Name: BambuStudio,
 *                                      X-BBL-OS-Type: linux)  → cloud dispatches the print
 *
 * ⚠ VALIDATION STATUS: built to the documented protocol but not yet confirmed against real
 * hardware. Secured (non-Developer-Mode) firmware additionally requires request signing
 * (`url_enc` RSA + HTTP PoP headers) which is undocumented; put the printer in Developer
 * Mode for the first runs. Every step returns a precise error string so dispatch() can log
 * it and the job can be retried after a fix. See docs/BAMBU.md.
 */
import { createHash } from 'node:crypto';
import { REGIONS, type Region } from './config';

export type CloudPrintInput = {
	accessToken: string;
	region: Region;
	devId: string;
	jobName: string;
	threeMfBytes: Buffer;
	plateIdx: number;
	bedType: string;
	amsMapping: number[];
	amsMapping2: { ams_id: number; slot_id: number }[];
};

export type CloudPrintResult = { ok: boolean; taskId?: string; error?: string };

export function md5Hex(buf: Buffer): string {
	return createHash('md5').update(buf).digest('hex').toUpperCase();
}

function authHeaders(token: string, extra: Record<string, string> = {}) {
	return { authorization: `Bearer ${token}`, 'user-agent': 'SparkPrint/0.1', ...extra };
}

export async function sendCloudPrint(input: CloudPrintInput): Promise<CloudPrintResult> {
	const api = REGIONS[input.region].api;
	const fileName = `${input.jobName.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'print'}.gcode.3mf`;

	try {
		// 1 ── Create a project (cloud file task).
		const createRes = await fetch(`${api}/v1/iot-service/api/user/project`, {
			method: 'POST',
			headers: authHeaders(input.accessToken, { 'content-type': 'application/json' }),
			body: JSON.stringify({ name: input.jobName })
		});
		if (!createRes.ok) return { ok: false, error: `create project HTTP ${createRes.status}` };
		const project: any = await createRes.json().catch(() => ({}));
		const projectId = project.project_id ?? project.id;
		const profileId = project.profile_id ?? '0';
		// Cloud model id assigned to the project; /my/task requires it ("field modelId is not set").
		const modelId = project.model_id ?? project.modelId ?? projectId;
		const uploadUrl: string | undefined = project.upload_url ?? project.url;
		if (!projectId) return { ok: false, error: 'create project: missing project_id' };
		if (!uploadUrl) return { ok: false, error: 'create project: no presigned upload_url returned' };

		// 2 ── Upload the 3mf to the presigned URL. No Content-Type (presign signed empty).
		const putRes = await fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(input.threeMfBytes) });
		if (!putRes.ok) return { ok: false, error: `upload 3mf HTTP ${putRes.status}` };
		const httpsUrl = uploadUrl.split('?')[0]; // object URL without the signed query

		// 3 ── Register the uploaded file on the project.
		const md5 = md5Hex(input.threeMfBytes);
		const patchRes = await fetch(`${api}/v1/iot-service/api/user/project/${projectId}`, {
			method: 'PATCH',
			headers: authHeaders(input.accessToken, { 'content-type': 'application/json' }),
			body: JSON.stringify({
				profile_id: profileId,
				profile_print_3mf: [{ md5, plate_idx: input.plateIdx, url: httpsUrl }]
			})
		});
		if (!patchRes.ok) return { ok: false, error: `register file HTTP ${patchRes.status}` };

		// 4 ── Create the task; Bambu cloud dispatches `project_file` to the printer.
		const taskRes = await fetch(`${api}/v1/user-service/my/task`, {
			method: 'POST',
			headers: authHeaders(input.accessToken, {
				'content-type': 'application/json',
				'X-BBL-Client-Name': 'BambuStudio',
				'X-BBL-Client-Type': 'slicer',
				'X-BBL-OS-Type': 'linux'
			}),
			body: JSON.stringify({
				mode: 'cloud_file',
				dev_id: input.devId,
				project_id: String(projectId),
				profile_id: String(profileId),
				model_id: String(modelId),
				task_name: input.jobName,
				subtask_name: input.jobName,
				url: httpsUrl,
				file: fileName,
				plate_idx: input.plateIdx,
				bed_type: input.bedType,
				md5,
				use_ams: input.amsMapping.length > 0,
				ams_mapping: input.amsMapping,
				ams_mapping2: input.amsMapping2,
				timelapse: false,
				bed_leveling: true,
				flow_cali: false,
				vibration_cali: false,
				layer_inspect: true
			})
		});
		if (!taskRes.ok) return { ok: false, error: `create task HTTP ${taskRes.status}: ${(await taskRes.text()).slice(0, 200)}` };
		const task: any = await taskRes.json().catch(() => ({}));
		return { ok: true, taskId: String(task.task_id ?? task.id ?? '') };
	} catch (e) {
		return { ok: false, error: (e as Error).message };
	}
}

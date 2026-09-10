/**
 * SparkPrint Bambu bridge
 * =======================
 * Keeps the database in sync with real Bambu Lab hardware and dispatches prints.
 *
 * Two responsibilities:
 *
 *  1. TELEMETRY (printer → DB)
 *     Subscribe to each printer's MQTT report topic and upsert live state into
 *     `printers` (status, nozzle/bed temp, progress %, remaining time) and `ams_slots`
 *     (filament type, color, remaining %, tray UUID). Works in two modes:
 *       • Cloud:  wss://<region>.mqtt.bambulab.com  (auth with the account token in
 *                 `bambu_accounts.access_token`). Topic: device/<dev_id>/report
 *       • LAN:    mqtts://<printer-ip>:8883  (user "bblp", password = access code).
 *
 *  2. DISPATCH (DB → printer)
 *     Consume `dispatch` jobs: upload the sliced 3MF to the printer over FTPS
 *     (ftps://<ip>:990, user "bblp") or via the cloud, then publish a
 *     `print.project_file` command on device/<dev_id>/request with the resolved AMS
 *     slot → filament mapping (print_jobs.color_mapping). Flip the job to `printing`.
 *
 * Reference protocol: BambuStudio source (https://github.com/bambulab/BambuStudio),
 * `bambu-connect`, and the community pybambu project document the MQTT payloads.
 *
 * Until credentials/hardware are present, the web app's MockBambuProvider provisions
 * demo devices and the inline pipeline marks prints printing/complete, so the whole
 * product works. Implementing the two handlers below makes it live — no web changes.
 */
import PgBoss from 'pg-boss';
import postgres from 'postgres';
// import mqtt from 'mqtt';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = postgres(DATABASE_URL);

/** Map a Bambu MQTT `print` report into a printers-table update. */
function mapReportToPrinter(report) {
	const p = report?.print ?? {};
	const statusMap = { RUNNING: 'printing', PAUSE: 'paused', FINISH: 'finished', FAILED: 'error', IDLE: 'idle' };
	return {
		status: statusMap[p.gcode_state] ?? 'idle',
		progressPct: p.mc_percent ?? null,
		nozzleTemp: p.nozzle_temper ?? null,
		bedTemp: p.bed_temper ?? null,
		remainingTimeMin: p.mc_remaining_time ?? null
	};
}

async function startTelemetry() {
	const accounts = await sql`select * from bambu_accounts where status = 'connected'`;
	for (const acct of accounts) {
		// const client = mqtt.connect(`wss://${acct.region}.mqtt.bambulab.com`, {
		//   username: `u_${acct.bambu_user_id}`, password: acct.access_token
		// });
		// client.on('message', async (topic, buf) => {
		//   const devId = topic.split('/')[1];
		//   const upd = mapReportToPrinter(JSON.parse(buf.toString()));
		//   await sql`update printers set status=${upd.status}, progress_pct=${upd.progressPct},
		//            nozzle_temp=${upd.nozzleTemp}, bed_temp=${upd.bedTemp},
		//            remaining_time_min=${upd.remainingTimeMin}, online=true, last_seen_at=now()
		//            where dev_id=${devId} and bambu_account_id=${acct.id}`;
		//   // also sync AMS slots from report.print.ams.ams[].tray[]
		// });
		console.log(`[bridge] (stub) would subscribe to telemetry for account ${acct.email}`);
	}
}

async function main() {
	const boss = new PgBoss({ connectionString: DATABASE_URL });
	await boss.start();
	console.log('[bridge] started');

	await boss.work('dispatch', async ([job]) => {
		const { jobId } = job.data;
		// 1. load job + printer + color_mapping
		// 2. upload sliced 3mf over FTPS / cloud
		// 3. publish print command with ams_mapping
		// 4. update print_jobs.status = 'printing', printers.current_job_id
		console.log(`[bridge] (stub) would dispatch job ${jobId} to its printer`);
	});

	await startTelemetry();
	void mapReportToPrinter; // referenced above; keeps intent clear
}

main().catch((e) => {
	console.error('[bridge] fatal', e);
	process.exit(1);
});

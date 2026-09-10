import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { models, printers, amsUnits, amsSlots } from '$lib/server/db/schema';
import { putBuffer } from '$lib/server/storage';
import { submitJob, CLOUD_PRINTABLE_MODELS } from '$lib/server/jobs';
import { getUsage } from '$lib/server/quota';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;

	// Distinct colors currently loaded across the lab's enabled printers.
	const rows = await db
		.select({
			colorHex: amsSlots.colorHex,
			colorName: amsSlots.colorName,
			filamentType: amsSlots.filamentType,
			online: printers.online,
			model: printers.model
		})
		.from(amsSlots)
		.innerJoin(amsUnits, eq(amsSlots.amsUnitId, amsUnits.id))
		.innerJoin(printers, eq(amsSlots.printerId, printers.id))
		// Only offer colors loaded on printers we can actually cloud-print to (excludes the
		// H2C/laser combo machines), so students never pick a color that can't be printed.
		.where(
			and(
				eq(printers.orgId, user.orgId),
				eq(printers.enabled, true),
				eq(amsSlots.empty, false),
				inArray(printers.model, [...CLOUD_PRINTABLE_MODELS])
			)
		);

	// Group unique color+type, tracking availability + which models can print it.
	const map = new Map<string, { colorHex: string; colorName: string | null; filamentType: string; available: boolean; models: Set<string> }>();
	for (const r of rows) {
		if (!r.colorHex) continue;
		const key = `${r.filamentType}|${r.colorHex.toLowerCase()}`;
		const e = map.get(key) ?? {
			colorHex: r.colorHex,
			colorName: r.colorName,
			filamentType: r.filamentType ?? 'PLA',
			available: false,
			models: new Set<string>()
		};
		if (r.online) e.available = true;
		if (r.model) e.models.add(r.model);
		map.set(key, e);
	}
	const colors = [...map.values()].map((c) => ({ ...c, models: [...c.models] }));

	const models_ = await db
		.select({ model: printers.model })
		.from(printers)
		.where(and(eq(printers.orgId, user.orgId), eq(printers.enabled, true), inArray(printers.model, [...CLOUD_PRINTABLE_MODELS])));
	const printerModels = [...new Set(models_.map((m) => m.model))];

	return {
		colors,
		printerModels,
		approvalMode: user.approvalMode,
		queueEnabled: user.queueEnabled,
		usage: await getUsage(user.id)
	};
};

const metaSchema = z.object({
	bbox: z.object({ x: z.number(), y: z.number(), z: z.number() }),
	volumeMm3: z.number().nonnegative(),
	triangles: z.number().nonnegative()
});

export const actions: Actions = {
	submit: async ({ request, locals }) => {
		const user = locals.user!;
		const fd = await request.formData();
		const file = fd.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Please choose a model file.' });
		if (file.size > 80 * 1024 * 1024) return fail(400, { error: 'Model is too large (80 MB max).' });

		const parsed = z
			.object({
				name: z.string().min(1).max(80),
				meta: z.string(),
				colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
				colorName: z.string().max(60).optional(),
				filamentType: z.string().max(20),
				layerHeightMm: z.coerce.number().min(0.06).max(0.4),
				infillPct: z.coerce.number().int().min(0).max(100),
				supports: z.coerce.boolean(),
				copies: z.coerce.number().int().min(1).max(20),
				printerModelTarget: z.preprocess((v) => (v && v !== 'auto' ? String(v) : null), z.string().nullable()),
				process: z.string().optional(),
				colorRequest: z.string().optional()
			})
			.safeParse({
				name: fd.get('name'),
				meta: fd.get('meta'),
				colorHex: fd.get('colorHex'),
				colorName: fd.get('colorName') ?? undefined,
				filamentType: fd.get('filamentType'),
				layerHeightMm: fd.get('layerHeightMm'),
				infillPct: fd.get('infillPct'),
				supports: fd.get('supports') === 'true',
				copies: fd.get('copies'),
				printerModelTarget: fd.get('printerModelTarget'),
				process: fd.get('process') ?? undefined,
				colorRequest: fd.get('colorRequest') ?? undefined
			});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const d = parsed.data;

		let meta: z.infer<typeof metaSchema>;
		try {
			meta = metaSchema.parse(JSON.parse(d.meta));
		} catch {
			return fail(400, { error: 'Model measurement failed — try re-uploading.' });
		}

		const format = (file.name.split('.').pop() ?? 'stl').toLowerCase();
		const buf = Buffer.from(await file.arrayBuffer());

		// Persist model + optional thumbnail.
		const [model] = await db
			.insert(models)
			.values({
				orgId: user.orgId,
				userId: user.id,
				name: d.name,
				format,
				fileKey: 'pending',
				sizeBytes: buf.length,
				meta: { bbox: meta.bbox, volumeMm3: meta.volumeMm3, triangles: meta.triangles }
			})
			.returning();

		const fileKey = `org/${user.orgId}/models/${model.id}.${format}`;
		await putBuffer(fileKey, buf);
		let thumbnailKey: string | null = null;
		const thumb = fd.get('thumbnail');
		if (typeof thumb === 'string' && thumb.startsWith('data:image/png;base64,')) {
			const b64 = thumb.slice('data:image/png;base64,'.length);
			thumbnailKey = `org/${user.orgId}/models/${model.id}.png`;
			await putBuffer(thumbnailKey, Buffer.from(b64, 'base64'));
		}
		await db.update(models).set({ fileKey, thumbnailKey }).where(eq(models.id, model.id));

		let process: Record<string, unknown> = {};
		try {
			if (d.process) process = JSON.parse(d.process);
		} catch {
			process = {};
		}

		// Color request: multi-color from the painted filament list, else the single picked color.
		const colorItem = z.object({ filamentType: z.string(), colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/), colorName: z.string().optional() });
		let colorRequest: { filamentType: string; colorHex: string; colorName?: string }[] = [
			{ filamentType: d.filamentType, colorHex: d.colorHex, colorName: d.colorName }
		];
		if (d.colorRequest) {
			let raw: unknown = null;
			try { raw = JSON.parse(d.colorRequest); } catch { raw = null; }
			const parsedColors = z.array(colorItem).min(1).max(16).safeParse(raw);
			if (parsedColors.success) colorRequest = parsedColors.data;
		}

		const result = await submitJob({
			orgId: user.orgId,
			userId: user.id,
			modelId: model.id,
			name: d.name,
			colorRequest,
			layerHeightMm: d.layerHeightMm,
			infillPct: d.infillPct,
			supports: d.supports,
			copies: d.copies,
			printerModelTarget: d.printerModelTarget,
			process
		});

		if (!result.ok) return fail(400, { error: result.error });
		return { success: true, jobId: result.jobId, status: result.status, printerName: result.printerName ?? null };
	}
};

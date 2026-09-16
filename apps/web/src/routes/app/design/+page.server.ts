import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { models, printers, amsUnits, amsSlots } from '$lib/server/db/schema';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { putBuffer, objectFsPath, objectExists } from '$lib/server/storage';
import { submitJob, CLOUD_PRINTABLE_MODELS } from '$lib/server/jobs';
import { realSlice } from '$lib/server/slicer-cli';
import { metricsFrom3mf, isSliced3mf, thumbnailFrom3mf } from '$lib/server/threemf-metrics';
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

const colorItem = z.object({ filamentType: z.string(), colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/), colorName: z.string().optional(), any: z.boolean().optional() });

export const actions: Actions = {
	// Slice the design now and return a preview (rendered plate image + time / filament / layers),
	// WITHOUT queuing a print. The sliced file is stashed so "Send to print" reuses it as-is.
	slice: async ({ request, locals }) => {
		const user = locals.user!;
		const fd = await request.formData();
		const file = fd.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Please choose a model file.' });
		if (file.size > 80 * 1024 * 1024) return fail(400, { error: 'Model is too large (80 MB max).' });

		const parsed = z
			.object({
				layerHeightMm: z.coerce.number().min(0.06).max(0.4),
				infillPct: z.coerce.number().int().min(0).max(100),
				supports: z.coerce.boolean(),
				raft: z.coerce.boolean().optional(),
				printerModelTarget: z.preprocess((v) => (v && v !== 'auto' ? String(v) : null), z.string().nullable()),
				colorRequest: z.string().optional()
			})
			.safeParse({
				layerHeightMm: fd.get('layerHeightMm'),
				infillPct: fd.get('infillPct'),
				supports: fd.get('supports') === 'true',
				raft: fd.get('raft') === 'true',
				printerModelTarget: fd.get('printerModelTarget'),
				colorRequest: fd.get('colorRequest') ?? undefined
			});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const d = parsed.data;

		// Filament types — one per requested color (multicolor via AMS).
		let filamentTypes = ['PLA'];
		if (d.colorRequest) {
			let raw: unknown = null;
			try { raw = JSON.parse(d.colorRequest); } catch { raw = null; }
			const pc = z.array(colorItem).min(1).max(16).safeParse(raw);
			if (pc.success) filamentTypes = pc.data.map((c) => c.filamentType || 'PLA');
		}

		const format = (file.name.split('.').pop() ?? 'stl').toLowerCase();
		const buf = Buffer.from(await file.arrayBuffer());
		const srcKey = `org/${user.orgId}/previews/${randomUUID()}.${format}`;
		await putBuffer(srcKey, buf);

		let out;
		try {
			out = await realSlice(objectFsPath(srcKey), {
				layerHeightMm: d.layerHeightMm,
				infillPct: d.infillPct,
				supports: d.supports,
				raft: d.raft,
				printerModel: d.printerModelTarget ?? undefined,
				filamentType: filamentTypes[0],
				filamentTypes: filamentTypes.length > 1 ? filamentTypes : undefined
			});
		} catch (e) {
			return fail(422, { sliceError: (e as Error).message || 'Slicing failed. Check the model and try again.' });
		}

		// No slicer configured, or it produced a non-Bambu file → no toolpath preview available.
		if (!out || !out.gcodePath.endsWith('.3mf')) {
			return { sliced: true as const, preview: null };
		}

		const gbuf = await readFile(out.gcodePath);
		const preslicedKey = `org/${user.orgId}/previews/${randomUUID()}.gcode.3mf`;
		await putBuffer(preslicedKey, gbuf);
		const m = metricsFrom3mf(gbuf);
		return {
			sliced: true as const,
			preview: {
				preslicedKey,
				thumbnail: thumbnailFrom3mf(gbuf),
				grams: out.grams || m.grams,
				timeSec: out.timeSec || m.timeSec,
				layers: m.layers
			}
		};
	},

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
				speedLevel: z.coerce.number().int().min(1).max(4).default(2),
				supports: z.coerce.boolean(),
				copies: z.coerce.number().int().min(1).max(20),
				printerModelTarget: z.preprocess((v) => (v && v !== 'auto' ? String(v) : null), z.string().nullable()),
				process: z.string().optional(),
				colorRequest: z.string().optional(),
				// If the design was already sliced for preview, reuse that exact file (no re-slice).
				preslicedKey: z.string().optional(),
				preslicedGrams: z.coerce.number().optional(),
				preslicedTimeSec: z.coerce.number().optional()
			})
			.safeParse({
				name: fd.get('name'),
				meta: fd.get('meta'),
				colorHex: fd.get('colorHex'),
				colorName: fd.get('colorName') ?? undefined,
				filamentType: fd.get('filamentType'),
				layerHeightMm: fd.get('layerHeightMm'),
				infillPct: fd.get('infillPct'),
				speedLevel: fd.get('speedLevel') ?? undefined,
				supports: fd.get('supports') === 'true',
				copies: fd.get('copies'),
				printerModelTarget: fd.get('printerModelTarget'),
				process: fd.get('process') ?? undefined,
				colorRequest: fd.get('colorRequest') ?? undefined,
				preslicedKey: fd.get('preslicedKey') ?? undefined,
				preslicedGrams: fd.get('preslicedGrams') ?? undefined,
				preslicedTimeSec: fd.get('preslicedTimeSec') ?? undefined
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
		let colorRequest: { filamentType: string; colorHex: string; colorName?: string }[] = [
			{ filamentType: d.filamentType, colorHex: d.colorHex, colorName: d.colorName }
		];
		if (d.colorRequest) {
			let raw: unknown = null;
			try { raw = JSON.parse(d.colorRequest); } catch { raw = null; }
			const parsedColors = z.array(colorItem).min(1).max(16).safeParse(raw);
			if (parsedColors.success) colorRequest = parsedColors.data;
		}

		// Reuse the file sliced for the preview (same org, still present) so the print matches exactly
		// what the student saw — no second slice.
		const reuse = d.preslicedKey && d.preslicedKey.startsWith(`org/${user.orgId}/previews/`) && objectExists(d.preslicedKey);

		const result = await submitJob({
			orgId: user.orgId,
			userId: user.id,
			modelId: model.id,
			name: d.name,
			colorRequest,
			layerHeightMm: d.layerHeightMm,
			infillPct: d.infillPct,
			speedLevel: d.speedLevel,
			supports: d.supports,
			copies: d.copies,
			printerModelTarget: d.printerModelTarget,
			process,
			...(reuse
				? { preslicedKey: d.preslicedKey, preslicedGrams: d.preslicedGrams ?? 0, preslicedTimeSec: d.preslicedTimeSec ?? 0 }
				: {})
		});

		if (!result.ok) return fail(400, { error: result.error });
		return { success: true, jobId: result.jobId, status: result.status, printerName: result.printerName ?? null };
	},

	// Print a file already sliced in Bambu Studio / OrcaSlicer (a .gcode.3mf) — skips our slicer.
	uploadSliced: async ({ request, locals }) => {
		const user = locals.user!;
		const fd = await request.formData();
		const file = fd.get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a sliced .gcode.3mf file.' });
		if (file.size > 200 * 1024 * 1024) return fail(400, { error: 'File is too large (200 MB max).' });
		const buf = Buffer.from(await file.arrayBuffer());
		if (!isSliced3mf(buf)) {
			return fail(400, { error: 'That isn’t a sliced Bambu file. In Bambu Studio, slice your plate, then File → Export → Export plate sliced file (.gcode.3mf).' });
		}

		const parsed = z
			.object({
				name: z.string().min(1).max(80),
				colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
				colorName: z.string().max(60).optional(),
				filamentType: z.string().max(20),
				copies: z.coerce.number().int().min(1).max(20),
				printerModelTarget: z.preprocess((v) => (v && v !== 'auto' ? String(v) : null), z.string().nullable()),
				colorRequest: z.string().optional() // JSON array for multicolor prints
			})
			.safeParse({
				name: fd.get('name') || file.name.replace(/\.gcode\.3mf$/i, ''),
				colorHex: fd.get('colorHex'),
				colorName: fd.get('colorName') ?? undefined,
				filamentType: fd.get('filamentType') ?? 'PLA',
				copies: fd.get('copies') ?? 1,
				printerModelTarget: fd.get('printerModelTarget'),
				colorRequest: fd.get('colorRequest') ?? undefined
			});
		if (!parsed.success) return fail(400, { error: parsed.error.issues[0].message });
		const d = parsed.data;

		// One entry per filament in the sliced file (multicolor), else the single picked color.
		const colorItem = z.object({ filamentType: z.string(), colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/), colorName: z.string().optional(), any: z.boolean().optional() });
		let colorRequest: { filamentType: string; colorHex: string; colorName?: string }[] = [{ filamentType: d.filamentType, colorHex: d.colorHex, colorName: d.colorName }];
		if (d.colorRequest) {
			let raw: unknown = null;
			try { raw = JSON.parse(d.colorRequest); } catch { raw = null; }
			const pc = z.array(colorItem).min(1).max(16).safeParse(raw);
			if (pc.success) colorRequest = pc.data;
		}

		const key = `org/${user.orgId}/uploads/${randomUUID()}.gcode.3mf`;
		await putBuffer(key, buf);
		const { grams, timeSec } = metricsFrom3mf(buf);

		const result = await submitJob({
			orgId: user.orgId,
			userId: user.id,
			modelId: null,
			name: d.name,
			colorRequest,
			layerHeightMm: 0.2,
			infillPct: 15,
			supports: false,
			copies: d.copies,
			printerModelTarget: d.printerModelTarget,
			preslicedKey: key,
			preslicedGrams: grams,
			preslicedTimeSec: timeSec
		});
		if (!result.ok) return fail(400, { error: result.error });
		return { success: true, jobId: result.jobId, status: result.status, printerName: result.printerName ?? null };
	}
};

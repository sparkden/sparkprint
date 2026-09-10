import { zipSync, strToU8 } from 'fflate';

/**
 * Bambu/Orca-native ("BBS") 3MF writer with per-triangle paint attributes.
 * Geometry must already be baked into model-space (Z-up) world coordinates; all parts are
 * merged into one object/mesh (vertex indices are local to that mesh — BBS does not offset).
 *
 * Attribute names + value encoding verified against BambuStudio/OrcaSlicer source
 * (bbs_3mf.cpp, TriangleSelector.cpp, Model.cpp get_triangle_as_string). See docs/BAMBU.md.
 *   - paint_supports / paint_seam: state 1 = enforcer, 2 = blocker
 *   - paint_color: state = 1-based filament number (base/unpainted = no attr → extruder 1)
 */
export type Part = {
	positions: Float32Array; // 9 floats per triangle (3 verts × xyz), non-indexed
	support: Uint8Array; // per facet: 0 none | 1 enforcer | 2 blocker
	seam: Uint8Array; // per facet: 0 | 1
	colorIndex: Int16Array; // per facet: 0 base | 1..N painted (→ filament index+1)
};

/**
 * Encode an UN-SUBDIVIDED (whole-facet) paint state as the TriangleSelector hex string.
 * Mirrors get_triangle_as_string: bits are pushed split(2b, =00 here) then the leaf state,
 * chunked into nibbles (first bit = LSB) and front-inserted.
 *   n=1 → "4", n=2 → "8", n=3 → "0C", n=4 → "1C", …
 */
export function encodeState(n: number): string {
	if (n <= 0) return '';
	const bits: number[] = [0, 0]; // split_sides = 0 (unsplit)
	if (n < 3) {
		bits.push(n & 1, (n >> 1) & 1);
	} else {
		bits.push(1, 1); // leaf escape prefix 0b11
		let v = n - 3;
		while (v >= 15) {
			bits.push(1, 1, 1, 1);
			v -= 15;
		}
		bits.push(v & 1, (v >> 1) & 1, (v >> 2) & 1, (v >> 3) & 1);
	}
	let out = '';
	for (let i = 0; i < bits.length; i += 4) {
		const code = (bits[i] || 0) | ((bits[i + 1] || 0) << 1) | ((bits[i + 2] || 0) << 2) | ((bits[i + 3] || 0) << 3);
		out = code.toString(16).toUpperCase() + out; // front-insert
	}
	return out;
}

function f(n: number): string {
	return (Math.round(n * 1000) / 1000).toString();
}

export function build3MF(parts: Part[], _filamentCount: number): Uint8Array {
	const verts: string[] = [];
	const tris: string[] = [];
	let vi = 0;
	for (const part of parts) {
		const nTri = part.positions.length / 9;
		for (let t = 0; t < nTri; t++) {
			const b = t * 9;
			verts.push(
				`<vertex x="${f(part.positions[b])}" y="${f(part.positions[b + 1])}" z="${f(part.positions[b + 2])}"/>`,
				`<vertex x="${f(part.positions[b + 3])}" y="${f(part.positions[b + 4])}" z="${f(part.positions[b + 5])}"/>`,
				`<vertex x="${f(part.positions[b + 6])}" y="${f(part.positions[b + 7])}" z="${f(part.positions[b + 8])}"/>`
			);
			let attrs = `v1="${vi}" v2="${vi + 1}" v3="${vi + 2}"`;
			const sup = encodeState(part.support[t]);
			if (sup) attrs += ` paint_supports="${sup}"`;
			const seam = encodeState(part.seam[t]);
			if (seam) attrs += ` paint_seam="${seam}"`;
			if (part.colorIndex[t] > 0) {
				const col = encodeState(part.colorIndex[t] + 1); // painted color k → filament k+1 (base = 1)
				if (col) attrs += ` paint_color="${col}"`;
			}
			tris.push(`<triangle ${attrs}/>`);
			vi += 3;
		}
	}

	const model =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<model unit="millimeter" xml:lang="en-US" ` +
		`xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ` +
		`xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">\n` +
		`<resources>\n<object id="1" type="model">\n<mesh>\n` +
		`<vertices>\n${verts.join('\n')}\n</vertices>\n` +
		`<triangles>\n${tris.join('\n')}\n</triangles>\n` +
		`</mesh>\n</object>\n</resources>\n` +
		`<build>\n<item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n</build>\n` +
		`</model>\n`;

	// Exact BBS content types (bbs_3mf.cpp). Settings come from the slicer via --load-settings.
	const contentTypes =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
		`<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
		`<Default Extension="png" ContentType="image/png"/>` +
		`<Default Extension="gcode" ContentType="text/x.gcode"/>` +
		`</Types>`;

	const rels =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
		`</Relationships>`;

	return zipSync(
		{
			'[Content_Types].xml': strToU8(contentTypes),
			'_rels/.rels': strToU8(rels),
			'3D/3dmodel.model': strToU8(model)
		},
		{ level: 6 }
	);
}

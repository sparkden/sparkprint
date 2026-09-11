// Full Bambu Lab printer catalog — build volumes (mm), default AMS support, nozzle.
// Shared by manual add, the printer select, and the studio build-plate sizing.
export type BambuModel = 'X1' | 'X1C' | 'X1E' | 'P1P' | 'P1S' | 'A1' | 'A1M' | 'H2D' | 'H2C' | 'H2S';

export type BambuModelInfo = {
	id: BambuModel;
	label: string;
	series: string;
	bed: { x: number; y: number; z: number }; // build volume in mm
	ams: boolean; // typically sold/used with AMS
	nozzle: number;
	enclosed: boolean;
};

export const BAMBU_MODELS: BambuModelInfo[] = [
	{ id: 'X1C', label: 'X1 Carbon', series: 'X1', bed: { x: 256, y: 256, z: 256 }, ams: true, nozzle: 0.4, enclosed: true },
	{ id: 'X1', label: 'X1', series: 'X1', bed: { x: 256, y: 256, z: 256 }, ams: true, nozzle: 0.4, enclosed: true },
	{ id: 'X1E', label: 'X1E', series: 'X1', bed: { x: 256, y: 256, z: 256 }, ams: true, nozzle: 0.4, enclosed: true },
	{ id: 'P1S', label: 'P1S', series: 'P1', bed: { x: 256, y: 256, z: 256 }, ams: true, nozzle: 0.4, enclosed: true },
	{ id: 'P1P', label: 'P1P', series: 'P1', bed: { x: 256, y: 256, z: 256 }, ams: true, nozzle: 0.4, enclosed: false },
	{ id: 'A1', label: 'A1', series: 'A1', bed: { x: 256, y: 256, z: 256 }, ams: true, nozzle: 0.4, enclosed: false },
	{ id: 'A1M', label: 'A1 mini', series: 'A1', bed: { x: 180, y: 180, z: 180 }, ams: true, nozzle: 0.4, enclosed: false },
	{ id: 'H2D', label: 'H2D', series: 'H2', bed: { x: 325, y: 320, z: 325 }, ams: true, nozzle: 0.4, enclosed: true }
];

export const MODEL_IDS = BAMBU_MODELS.map((m) => m.id) as [BambuModel, ...BambuModel[]];

const BY_ID = new Map(BAMBU_MODELS.map((m) => [m.id, m]));
export function modelInfo(id: string | null | undefined): BambuModelInfo {
	return (id && BY_ID.get(id as BambuModel)) || BAMBU_MODELS[0];
}

// Map a Bambu SSDP/device model string (internal code or product name) to our model id.
// Unknown → P1S (a safe FDM default the admin can change).
export function ssdpModelToCode(model: string | null | undefined): BambuModel {
	const m = (model ?? '').toUpperCase();
	if (/O1C2|H2C/.test(m)) return 'H2C';
	if (/O1S|H2S/.test(m)) return 'H2S';
	if (/O1D|H2D/.test(m)) return 'H2D';
	if (/C13|X1E/.test(m)) return 'X1E';
	if (/BL-?P002|3DPRINTER-X1-CARBON|X1C|X1 CARBON/.test(m)) return 'X1C';
	if (/BL-?P001|3DPRINTER-X1|\bX1\b/.test(m)) return 'X1';
	if (/C11|P1P/.test(m)) return 'P1P';
	if (/C12|P1S/.test(m)) return 'P1S';
	if (/N1|A1 ?MINI|A1M/.test(m)) return 'A1M';
	if (/N2S|\bA1\b/.test(m)) return 'A1';
	return 'P1S';
}

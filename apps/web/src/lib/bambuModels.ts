// Full Bambu Lab printer catalog — build volumes (mm), default AMS support, nozzle.
// Shared by manual add, the printer select, and the studio build-plate sizing.
export type BambuModel = 'X1' | 'X1C' | 'X1E' | 'P1P' | 'P1S' | 'A1' | 'A1M' | 'H2D';

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

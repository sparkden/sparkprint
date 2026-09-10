// Slicing "process" settings, mirroring Bambu Studio's common options. These flow to the
// server-side slicer (OrcaSlicer) which maps them to concrete settings/overrides.
export type Process = {
	layerHeightMm: number;
	wallLoops: number;
	topBottomLayers: number;
	infillPct: number;
	infillPattern: string;
	supports: boolean;
	supportType: 'normal' | 'tree';
	supportThreshold: number; // overhang angle °
	adhesion: 'none' | 'skirt' | 'brim';
	brimWidth: number;
	seam: 'aligned' | 'nearest' | 'back' | 'random';
	ironing: boolean;
	fuzzySkin: boolean;
	spiralVase: boolean;
	speed: 'silent' | 'standard' | 'sport' | 'ludicrous';
};

export const DEFAULT_PROCESS: Process = {
	layerHeightMm: 0.2,
	wallLoops: 2,
	topBottomLayers: 4,
	infillPct: 15,
	infillPattern: 'grid',
	supports: false,
	supportType: 'tree',
	supportThreshold: 30,
	adhesion: 'none',
	brimWidth: 5,
	seam: 'aligned',
	ironing: false,
	fuzzySkin: false,
	spiralVase: false,
	speed: 'standard'
};

export const QUALITY_PRESETS = [
	{ label: 'Draft', h: 0.28 },
	{ label: 'Standard', h: 0.2 },
	{ label: 'Fine', h: 0.12 },
	{ label: 'Extra fine', h: 0.08 }
];
export const INFILL_PATTERNS = ['grid', 'gyroid', 'honeycomb', 'cubic', 'lines', 'triangles', 'concentric'];
export const SEAM_OPTIONS = ['aligned', 'nearest', 'back', 'random'];
export const SPEED_OPTIONS = ['silent', 'standard', 'sport', 'ludicrous'];

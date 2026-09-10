/**
 * Shared Bambu types + the Bambu Basic color palette (used by the AMS color-mapping UI).
 * The live integration is in cloud.ts (REST), manager.ts (MQTT), report.ts (telemetry),
 * and cloudprint.ts (print dispatch).
 */

// H2C/H2S are combo (laser/cutter) machines: we identify them so they aren't mistaken for a
// plain FDM printer, but they can't be driven by the standard cloud FDM print task (see
// isCloudPrintable in jobs.ts).
export type BambuDeviceModel = 'X1' | 'X1C' | 'X1E' | 'P1S' | 'P1P' | 'A1' | 'A1M' | 'H2D' | 'H2C' | 'H2S';

export type DiscoveredSlot = {
	slotIndex: number;
	filamentType: string | null;
	filamentBrand: string | null;
	colorHex: string | null;
	colorName: string | null;
	remainingPct: number | null;
	empty: boolean;
};

export type DiscoveredAms = {
	amsIndex: number;
	humidity: number | null;
	temperature: number | null;
	slots: DiscoveredSlot[];
};

export type DiscoveredPrinter = {
	devId: string;
	name: string;
	model: BambuDeviceModel;
	online: boolean;
	nozzleDiameter: number;
	accessCode?: string | null;
	ams: DiscoveredAms[];
};

/** Bambu Basic PLA swatches — offered in the AMS color picker. */
export const BAMBU_BASIC: { name: string; hex: string }[] = [
	{ name: 'Black', hex: '#161616' },
	{ name: 'White', hex: '#F5F5F5' },
	{ name: 'Bambu Green', hex: '#00AE42' },
	{ name: 'Sunflower Yellow', hex: '#F5C211' },
	{ name: 'Orange', hex: '#FF6A13' },
	{ name: 'Red', hex: '#C12E1F' },
	{ name: 'Blue', hex: '#0A2CA5' },
	{ name: 'Cyan', hex: '#0086D6' },
	{ name: 'Magenta', hex: '#EC008C' },
	{ name: 'Gray', hex: '#8E8E8E' },
	{ name: 'Purple', hex: '#5E43B7' },
	{ name: 'Pink', hex: '#F55A74' }
];

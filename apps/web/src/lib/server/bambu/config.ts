import { env } from '$env/dynamic/private';

/**
 * BAMBU_MODE = 'cloud' (default) | 'mock'
 *   cloud — real Bambu cloud: account login (+verification code), device bind, a
 *           persistent MQTT manager for live telemetry + control, and cloud print dispatch.
 *   mock  — dev-only escape hatch (demo printers, no credentials). NOT for production.
 *
 * NOTE (firmware): since Jan-2025 "authorization control", raw third-party cloud MQTT is
 * blocked in Standard Mode. Each printer must be in **Developer Mode** for raw MQTT.
 * See docs/BAMBU.md.
 */
export const BAMBU_MODE = (env.BAMBU_MODE ?? 'cloud').toLowerCase() === 'mock' ? 'mock' : 'cloud';

export const REGIONS = {
	us: { api: 'https://api.bambulab.com', mqtt: 'mqtts://us.mqtt.bambulab.com:8883' },
	eu: { api: 'https://api.bambulab.com', mqtt: 'mqtts://us.mqtt.bambulab.com:8883' },
	cn: { api: 'https://api.bambulab.cn', mqtt: 'mqtts://cn.mqtt.bambulab.com:8883' }
} as const;

export type Region = keyof typeof REGIONS;
export function region(r: string | null | undefined): Region {
	return r === 'cn' ? 'cn' : r === 'eu' ? 'eu' : 'us';
}

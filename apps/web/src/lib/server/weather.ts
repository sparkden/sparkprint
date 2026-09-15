/**
 * Local weather for the lab board — geolocates the server's public IP (free ip-api.com) and pulls
 * the current conditions (free open-meteo.com, no key). Cached ~30 min so the 8s board poll doesn't
 * hammer the APIs. Best-effort: returns null if offline.
 */
export type Weather = { city: string; tempF: number; label: string; icon: string };

let cache: { at: number; data: Weather | null } = { at: 0, data: null };

// WMO weather codes → label + emoji.
function decode(code: number): { label: string; icon: string } {
	if (code === 0) return { label: 'Clear', icon: '☀️' };
	if (code <= 2) return { label: 'Partly cloudy', icon: '🌤️' };
	if (code === 3) return { label: 'Cloudy', icon: '☁️' };
	if (code <= 48) return { label: 'Fog', icon: '🌫️' };
	if (code <= 57) return { label: 'Drizzle', icon: '🌦️' };
	if (code <= 67) return { label: 'Rain', icon: '🌧️' };
	if (code <= 77) return { label: 'Snow', icon: '🌨️' };
	if (code <= 82) return { label: 'Showers', icon: '🌧️' };
	if (code <= 86) return { label: 'Snow showers', icon: '🌨️' };
	if (code <= 99) return { label: 'Thunderstorm', icon: '⛈️' };
	return { label: 'Weather', icon: '🌡️' };
}

export async function getWeather(): Promise<Weather | null> {
	if (Date.now() - cache.at < 30 * 60 * 1000) return cache.data;
	try {
		const geo = (await fetch('http://ip-api.com/json/?fields=status,city,lat,lon', { signal: AbortSignal.timeout(4000) }).then((r) => r.json())) as { status: string; city: string; lat: number; lon: number };
		if (geo.status !== 'success') throw new Error('geo');
		const w = (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json())) as { current: { temperature_2m: number; weather_code: number } };
		const d = decode(w.current.weather_code);
		cache = { at: Date.now(), data: { city: geo.city, tempF: Math.round(w.current.temperature_2m), ...d } };
	} catch {
		cache = { at: Date.now(), data: cache.data }; // keep last good value, retry in 30 min
	}
	return cache.data;
}

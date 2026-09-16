import QRCode from 'qrcode';

/** Fallback public app URL for the kiosk QR when a lab hasn't set its own in Settings. */
export const DEFAULT_APP_URL = 'https://print.ethans.app';

/**
 * Generate a crisp, inline SVG QR code for a URL or text. Returned as an SVG string to drop into a
 * page with {@html} — no external requests, no <canvas>, so it works under our CSP and on the kiosk.
 * The SVG has no fixed size (viewBox only); size it with CSS on a wrapper element.
 */
export async function qrSvg(text: string, opts: { margin?: number } = {}): Promise<string> {
	return QRCode.toString(text, {
		type: 'svg',
		margin: opts.margin ?? 1,
		errorCorrectionLevel: 'M'
	});
}

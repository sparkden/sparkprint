// Minimal, safe bridge between the renderer (web app) and the desktop shell.
// Expand this to expose LAN printer discovery / local bridge controls to the web UI.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('sparkprint', {
	desktop: true,
	platform: process.platform,
	version: process.versions.electron
});

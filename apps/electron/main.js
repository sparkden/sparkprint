// SparkPrint desktop wrapper.
// Loads the SparkPrint web app in a native window. Point it at your deployment with
// SPARKPRINT_URL (defaults to the local dev server). Because the desktop app runs on
// the school's network, it's also the natural home for the LAN Bambu bridge later.
const { app, BrowserWindow, Menu, shell, Notification } = require('electron');

const APP_URL = process.env.SPARKPRINT_URL || 'http://localhost:5173';

function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 960,
		minHeight: 640,
		backgroundColor: '#FFFDF9',
		title: 'SparkPrint',
		autoHideMenuBar: true,
		webPreferences: {
			preload: require('path').join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	win.loadURL(APP_URL);

	// Open external links (e.g. docs) in the system browser, keep app nav in-window.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (!url.startsWith(APP_URL)) {
			shell.openExternal(url);
			return { action: 'deny' };
		}
		return { action: 'allow' };
	});

	return win;
}

app.whenReady().then(() => {
	createWindow();

	const template = [
		{ label: 'SparkPrint', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit' }] },
		{ label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
		{ label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));

	if (Notification.isSupported()) {
		new Notification({ title: 'SparkPrint', body: 'Connected to your print lab.' }).show();
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

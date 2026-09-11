# SparkPrint — LAN Printing Setup Guide

SparkPrint prints to your Bambu printers over your **local network** (LAN): it uploads the
sliced file straight to the printer and tells it to print — exactly how Bambu Studio's "LAN mode"
works. This is the reliable path and works for **every** Bambu model (including the H2 combo
machines), with **no developer mode** required.

> **Why LAN and not cloud?** Bambu's cloud only lets *their own* app hand a custom-sliced file to a
> printer (the "commit upload → signed CDN URL" step lives inside Bambu's closed networking
> plugin). The public cloud API can create a task but the printer then has nothing it's allowed to
> download. LAN printing sidesteps all of that. The trade-off: **SparkPrint must run on the same
> network as the printers.**

---

## 1. Requirements

- A machine to run SparkPrint **on the same LAN/VLAN as the printers** — a mini-PC, an old
  laptop, a NUC, or a Raspberry Pi 4/5. It stays on and serves the web app to your students.
- The printers powered on and connected to that same network (Wi‑Fi or Ethernet).
- Network rules that let the SparkPrint machine reach each printer on:
  - **TCP 990** (FTPS — file upload)
  - **TCP 8883** (MQTTS — the print command + live status)
  - **UDP 2021 / 1990** multicast (optional — only for the "Discover on network" button)

If the printers and the server are on **different VLANs** (e.g. an "IoT" VLAN), either put the
server on that VLAN or open the ports above between them.

---

## 2. Run SparkPrint on-site

On the on-site machine (Docker is easiest — see `DEPLOY.md` for the full compose file):

```bash
# with Docker
docker run -d --name sparkprint \
  -e DATABASE_URL="postgres://…" \
  -e APP_SECRET="<a long random string>" \
  -p 3000:3000 \
  ghcr.io/sparkden/sparkprint:latest

# or from source
npm install && npm run build -w @sparkprint/web
node apps/web/build            # serves on :3000
```

Use **host networking** (or a macvlan) if Docker's default bridge blocks multicast discovery:
`docker run --network host …`. Manual IP entry (below) works without host networking.

Open `http://<server-ip>:3000` from a school computer and finish the first-run admin setup.

---

## 3. Get each printer's Access Code + IP

On the **printer's touchscreen** (or the Bambu Handy app):

- **X1 / X1C / X1E:** `Settings (gear) → General → LAN Mode`. You'll see the **Access Code**
  (8 characters) and the printer's **IP address**.
- **P1P / P1S:** `Settings (gear) → WLAN` (or `Network`). Shows the **IP**; the **Access Code**
  is under `Settings → General → LAN Mode` (or the same WLAN screen on newer firmware).
- **A1 / A1 mini:** `Settings → Network` for the IP and Access Code.

> The **Access Code** is *not* your Bambu account password and does **not** require developer mode.
> If SparkPrint imported your printers from the Bambu account, the access code is usually already
> filled in — you only need to add the **IP**.

**Tip:** give each printer a **static IP / DHCP reservation** in your router so it doesn't change.

---

## 4. Configure in SparkPrint

**Admin → Printers.** For each printer, in the **LAN printing** box:

1. Enter the **Local IP** (e.g. `192.168.1.50`).
2. Enter the **Access code** if it isn't already saved.
3. Click **Save**, then **Test** — you should see *"Connected … LAN printing is ready."*

Or click **Discover on network** at the top to auto-fill IPs for printers it finds via SSDP
(server must be on the same segment; multicast must be allowed).

A printer shows **LAN: Ready** once it has both an IP and an access code. Only ready printers are
used for prints.

---

## 5. Live camera

Once a printer has its IP + access code, its **camera** shows up too:

- **Admins** see a *Live camera* toggle on every printer (Admin → Printers).
- **Students** get a *Watch your print* view on their job page **only while their print is running
  on that printer**.

Turn on **LAN Live View** on the printer (`Settings → General → LAN Mode`, or the camera settings)
and keep it on. P1P/P1S/A1 stream over the chamber protocol (port 6000); X1/H2 stream over RTSPS
(port 322) and need `ffmpeg` on the server (the Pi installer includes it). The P1P has no camera.

## 6. How a print flows

1. A student uploads a model and picks a color → SparkPrint slices it (OrcaSlicer, real Bambu
   G-code) into a `.gcode.3mf`.
2. Dispatch picks a compatible, ready printer that has the requested color loaded.
3. SparkPrint **FTPS-uploads** the file to that printer and sends the **MQTT `project_file`**
   command; the printer verifies and starts printing.
4. Live status (progress, temps, stage) streams back over MQTT to the dashboard.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| **Test** fails / `ECONNREFUSED` / timeout | Wrong IP, or server not on the same network/VLAN as the printer. Ping the printer from the server. |
| `530 Login incorrect` on upload | Wrong **Access Code**. Re-read it from the printer screen (it can rotate if you toggle LAN mode). |
| Job stuck "waiting for a printer with the right color" | Load the requested filament color into that printer's AMS, or map colors in **Admin → Printers → Map colors**. |
| **Discover on network** finds nothing | Multicast blocked or different VLAN. Enter the IP manually instead. |
| Printer prints but wrong color/slot | Check the AMS color mapping for that printer. |
| Print won't start on an **H2C/H2D** | These are dual-extruder machines and need an H2-series slicing profile — in progress; standard P1/X1/A1 printers work today. |

---

## 8. Security notes

- Access codes are stored encrypted and never sent to the browser (the admin UI only shows
  whether one is set).
- LAN traffic to the printer uses the printer's self-signed TLS cert (standard for Bambu LAN mode).
- Keep the SparkPrint machine on a trusted network; it holds the keys to start prints.

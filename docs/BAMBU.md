# Bambu Lab cloud integration

How SparkPrint talks to Bambu Lab printers, and what's real vs. next.

## Architecture

The web app runs on **adapter-node** — a persistent Node process. The Bambu **MQTT
manager** lives *inside* that process (`apps/web/src/lib/server/bambu/manager.ts`), so the
"website is the server" and also the central controller. It holds **one persistent MQTT
connection per connected Bambu account**, streams telemetry into Postgres, and publishes
control commands. No separate daemon to deploy (the `services/bridge` scaffold remains if
you later want to split it into its own process).

```
Web UI / Electron ──HTTP──▶ SvelteKit server ──(in-process)──▶ Bambu MQTT manager ──MQTT/TLS──▶ Bambu Cloud ──▶ printers
                                   └── Postgres (printers, ams_slots, print_jobs) ◀── telemetry
```

## Modes (`BAMBU_MODE`)

- **`cloud`** (default) — real Bambu cloud end-to-end.
- **`mock`** — dev-only escape hatch (simulated printers, inline "print"); never in prod.

## The real pipeline (cloud)

```
submit ─▶ web: quota pre-estimate ─▶ enqueue `slice` (pg-boss)
                                         │
                          services/slicer │ OrcaSlicer CLI → real grams/time + .gcode.3mf
                                         ▼
             job `ready` ─▶ enqueue `dispatch`
                                         │
                        web dispatch worker │ color-match a free printer → cloudprint.sendCloudPrint
                                         ▼
                 Bambu cloud (S3 upload + /my/task) ─▶ printer starts ─▶ MQTT telemetry → progress/complete
```

## Connect flow (cloud)

1. Admin → Printers → **Connect Bambu**: email + password + region.
2. Bambu usually responds "verification code required" → we email a code → admin enters it.
   (Authenticator-app 2FA accounts aren't supported yet — use email-code or a dedicated account.)
3. On success we store the access token (JWT, ~90-day `exp`), enumerate bound devices
   (`/v1/iot-service/api/user/bind`), and open the MQTT connection. AMS colors/levels fill
   in from the first telemetry report.

## What works in cloud mode today

- ✅ Account login incl. the email verification-code step; token persistence.
- ✅ Device import (printers + models) from the bind endpoint.
- ✅ **Live telemetry**: `device/<id>/report` → printer status, progress, temps, and full
  **AMS slot sync** (type, color, remaining %, tray UUID). `pushall` on connect.
- ✅ Controls: **pause / resume / stop** (published to `device/<id>/request`, QoS 1).
- ✅ Job completion auto-detected from `gcode_state: FINISH`.

## Built, pending hardware validation

- 🟡 **Server-side slicing** (`services/slicer`) — OrcaSlicer CLI, wired via the `slice`
  queue. Needs the binary + machine/process/filament **profile JSONs** provisioned in
  `/opt/orca/profiles` (copy from OrcaSlicer `resources/profiles/BBL`). The CLI invocation
  is configurable via `SLICER_CMD`; tune it for your OrcaSlicer version.
- 🟡 **Cloud print dispatch** (`bambu/cloudprint.ts`) — create project → presigned S3
  upload → `PATCH` → `POST /my/task`, fully wired into `dispatch()`. Built to the
  documented protocol; **validate on a Developer-Mode printer first** — secured firmware
  may additionally require request signing (`url_enc` RSA, HTTP PoP headers), which isn't
  implemented. Each step returns a precise error that's logged to the job timeline, so
  you can iterate quickly against real responses.

## Painted supports / seam / multi-color (3MF)

The studio paints per-triangle state (support enforcer/blocker, seam, color) and, when any
paint is present, submits a **Bambu-format 3MF** (`lib/threemf.ts`) instead of an STL —
triangles carry `paint_supports` / `paint_seam` / `mmu_segmentation` attributes encoded
via the OrcaSlicer TriangleSelector serialization. The slicer worker slices the 3MF so the
paint is honored; painted multi-color becomes a multi-entry `colorRequest`, and dispatch
maps each color to an AMS slot (needs those colors loaded). Painted supports set the
process support type to "manual/painted-only" in the slicer. Encoding details + the exact
attribute spec live next to the code and in the research notes.

## Hard constraints (from protocol research — read before production)

- **Jan-2025 "authorization control":** raw third-party cloud MQTT is blocked in
  **Standard Mode**. Each printer must be in **Developer Mode** for raw MQTT, or traffic
  must go through Bambu Connect. Plan for per-printer Developer Mode.
- **One active session per account:** connecting here can sign the account out of the
  Bambu Handy app. Use a **dedicated lab account**. We warn admins in the connect dialog.
- **No working token refresh:** the refresh endpoint 401s; re-login re-triggers an email
  code. So: log in once, persist the token, reuse until `exp`.
- **Connection cap:** >50 concurrent MQTT connections/account → ban. We keep exactly one
  per account and never churn (singleton manager, reconnect with backoff, fatal on rc=5).
- **Rate limits:** login is Cloudflare-fronted (HTTP 429). Back off.

Sources: OpenBambuAPI (Doridian), ha-bambulab/pybambu (greghesp), open-bamboo-networking
(ClusterM), BambuStudio source.

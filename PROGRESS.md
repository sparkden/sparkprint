# SparkPrint — Cloud 3D Printing for Schools

> Multi-tenant platform that lets schools run a fleet of Bambu Lab printers from the
> cloud: import & design models, pick colors, and print to the next available machine —
> with quotas, a shared queue, approval workflows, and full usage tracking. No more
> sharing one Bambu account.

**Owner:** jamey@zeroth.technology · **Started:** 2026-09-10

---

## Architecture

```
apps/
  web/            SvelteKit 2 + Svelte 5 (runes) — UI, API routes, auth, DB access
  electron/       Electron wrapper (desktop app) — [planned]
services/
  slicer/         Headless slicing worker (BambuStudio/OrcaSlicer CLI) via pg-boss   — [planned]
  bridge/         Bambu Cloud/MQTT bridge — device status, AMS, send prints          — [planned]
packages/
  shared/         Shared types / constants                                           — [planned]
```

- **DB:** PostgreSQL 18 (Drizzle ORM + SQL migrations). Connection via `DATABASE_URL`.
- **Queue:** pg-boss (Postgres-backed) — slicing jobs, print dispatch, status polling.
- **Auth:** cookie sessions (argon2 password hashing), org-scoped RBAC.
- **Storage:** object storage abstraction (local disk now → S3-compatible later) for
  models, thumbnails, sliced gcode/3mf.

## Key decisions (flagged — tell me to change any of these)

- **Bambu connectivity = Cloud API** (school binds one Bambu account; we enumerate
  printers & AMS and dispatch prints over Bambu cloud MQTT). LAN mode is a later add.
- **Slicing = server-side headless CLI** (BambuStudio/OrcaSlicer `--slice`), run in the
  `slicer` worker. A mock adapter is used until the real binary is provisioned, behind a
  stable interface so nothing else changes when it's swapped in.

## Roles

`owner` → `admin` → `teacher` → `student`. Owners/admins manage printers, inventory,
quotas, invites, approvals. Teachers can approve/monitor. Students import, design, print.

---

## Status log

### 2026-09-10
- Recon: DB reachable (PostgreSQL 18.4, empty). Branding fetched from sparkden.org/branding.
- Captured Sparkden design tokens (Spark Orange #FF5B14, warm paper/ink neutrals,
  Space Grotesk / Instrument Serif / Inter).
- Built the full foundation **and core product** in one pass:
  - Monorepo (npm workspaces) + SvelteKit 2 / Svelte 5 + Tailwind v4 design system.
  - 12-table Drizzle schema, generated + migrated to the live DB.
  - Cookie-session auth (scrypt), org-scoped RBAC, route guards.
  - Landing page, signup (creates org), login, logout, invite redeem (`/join/:token`).
  - Admin: overview, printers (Bambu connect via mock provider + manual add + refresh),
    per-printer **AMS color mapping**, members (roles + per-person quota overrides +
    suspend/remove), invites (links with role/quota/uses/expiry), filament inventory,
    settings (queue, approval, default quotas, material cost), approvals, queue.
  - Student: dashboard (live quota), **3D design studio** (Three.js import/arrange/scale
    + color pick + settings), my prints, job detail w/ timeline, printers view.
  - Job pipeline: quota enforcement → mock slice (grams/time/cost from geometry) →
    **AMS color matching** → auto-dispatch to next compatible online printer → queue
    fallback → approval routing → completion + queue promotion.
  - Worker scaffolds: `services/slicer` (BambuStudio CLI seam) + `services/bridge`
    (cloud/LAN MQTT + dispatch seam). Electron desktop wrapper (`apps/electron`).
- **Verified end-to-end against the live DB:** signup→session→admin; Bambu connect
  imported 6 printers w/ AMS colors; a submitted print sliced (7.5 g / 8 min / $0.19),
  matched Bambu Green to an AMS slot, and dispatched to "P1S #4" (status → printing).
- Demo login: `jamey@zeroth.technology` / `superprint123` (org "Demo Robotics Lab").

### 2026-09-10 — Bambu Cloud API (real integration)
- Decision locked: **Cloud Bambu API**. Architecture = the adapter-node server *is* the
  central controller; the **MQTT manager runs in-process** (one persistent connection per
  account). Web + Electron are thin clients. `services/bridge` stays as an optional split-out.
- Researched the real protocol (OpenBambuAPI, ha-bambulab/pybambu, open-bamboo-networking,
  BambuStudio). See `docs/BAMBU.md`.
- Built, gated behind `BAMBU_MODE=mock|cloud` (mock stays default):
  - `bambu/cloud.ts` — real login incl. **email verification-code** + 2FA detection,
    token/JWT decode (base64url), device bind enumeration.
  - `bambu/manager.ts` — in-process **MQTT manager**: one connection/account, subscribe
    `report`, `pushall` on connect, pause/resume/stop (QoS 1), auth-reject handling,
    globalThis singleton (HMR-safe), boot from `hooks.server.ts`.
  - `bambu/report.ts` — parse `device/<id>/report` → printer telemetry + **AMS slot sync**
    (type/color RRGGBBAA→#RRGGBB/remaining/uuid); auto-complete job on `FINISH`.
  - Printers UI: real **2-step connect** (credentials → emailed code), dedicated-account
    warning, live-status badges, mode-aware refresh + printer controls.
  - `bambu/cloudprint.ts` — documented scaffold for the cloud 3mf-upload + `/my/task`
    dispatch pipeline (next milestone; needs real-hardware iteration + request signing).
- Honest cloud behavior: `dispatch()` assigns printer + maps colors + marks `ready`
  (doesn't fake "printing"); real start lands when `cloudprint` is wired + telemetry confirms.
- Type-checks clean (0 errors). Mock demo path re-verified unaffected.

### 2026-09-10 — Production hardening (deploy-ready)
- **Docker**: multi-stage `Dockerfile` (adapter-node, workspace-aware, non-root, tini,
  `/healthz` HEALTHCHECK, migrations-on-boot via `docker/entrypoint.sh`), `.dockerignore`,
  `docker-compose.yml` (Postgres + web + volumes). Handles `BODY_SIZE_LIMIT` (100 MB
  uploads), `PROTOCOL_HEADER`/`HOST_HEADER` (CSRF behind proxy), `ELECTRON_SKIP_BINARY_DOWNLOAD`.
- **CI/CD**: `.github/workflows/ci.yml` (type-check + unit tests + build) and
  `docker.yml` (build + push to GHCR on main/tags, buildx cache).
- **Security**: session tokens **hashed at rest** (sha256); Bambu tokens **AES-256-GCM
  encrypted** (`crypto.ts`, key from `APP_SECRET`); security headers + prod CSP/HSTS in
  hooks; in-memory **rate limiting** on login/signup; APP_SECRET enforced in prod.
- **UX/ops**: styled `+error.svelte` (404/500), `/healthz` DB probe, **account settings**
  page (name + change password), OG/meta tags, avatar → account link.
- **Tests**: vitest + 14 passing unit tests (color match, slicer estimate, slug/date);
  extracted pure `lib/color.ts`. Wired into CI.
- **Docs**: `DEPLOY.md` (Coolify guide + env table), `apps/web/.env.example`, README deploy
  section. Type-check clean, full build green, prod build smoke-tested.

### 2026-09-10 — Real pipeline, mock removed (pure cloud)
- **Mock mode removed as default.** `BAMBU_MODE=cloud` is now the default; the mock
  provider, mock connect action, demo-mode UI, and the 6 demo printers are gone. A tiny
  `mock` dev flag remains for offline work only. DB cleaned to a real starting state
  (4 users, 4 filaments, 0 printers awaiting a real Bambu connect).
- **Real job queue (pg-boss)** on the shared Postgres: web enqueues `slice` on submit and
  runs the `dispatch` worker in-process; `services/slicer` runs the `slice` worker.
  Verified end-to-end against the live DB: submit → `slicing` + `slice` enqueued; manual
  `dispatch` → consumed in ~1s → correct `queued` ("waiting for a compatible printer").
- **Real server-side slicer** (`services/slicer`): OrcaSlicer CLI headless, parses real
  grams/time, stores the printable `.gcode.3mf`, sets job `ready`, enqueues `dispatch`.
  Dockerfile provisions OrcaSlicer (AppImage + xvfb). Needs profile JSONs + tuning.
- **Real cloud dispatch** (`bambu/cloudprint.ts`): create project → presigned S3 upload →
  PATCH → `POST /my/task`, wired into `dispatch()` with color→AMS mapping. Heuristic
  estimate is now only the instant quota pre-check (renamed `HeuristicEstimator`).
- Both hardware/binary-gated paths are built to the documented protocol and flagged for
  validation on the school's Developer-Mode printer (see docs/BAMBU.md). Type-check clean,
  tests green, build green.

### 2026-09-10 — Onboarding, full model support, Studio-style studio
- **First-run setup wizard** (`/setup`): hooks funnel a fresh instance into a friendly
  4-step wizard — welcome + create owner/lab → lab policies → connect Bambu (or skip) →
  invite link + finish. Once a lab exists, `/setup` is owner-only and the rest of the app
  opens up. Verified: `/` & `/login` → `/setup` when empty; createLab makes owner+session;
  policies/invite steps work; gating flips after init.
- **All Bambu models**: shared `bambuModels.ts` catalog (X1, X1C, X1E, P1P, P1S, A1,
  A1 mini, H2D) with build volumes/AMS/nozzle; wired into manual-add, device mapping,
  printer select, and the studio plate sizing.
- **Bambu Studio-style studio**: dark warm build-plate scene sized to the chosen printer,
  spark-orange plate outline, object toolbar (rotate X/Y/Z, lay flat), live dimensions +
  plate-size chip, grouped slicing settings — all in the Sparkden palette.
- Type-check clean, build green. Instance reset to pristine first-run for live walkthrough.

### 2026-09-10 — Studio tools + full slicing settings
- **Transform tools** (Bambu-Studio-style left rail): Move, Rotate (per-axis + 90° + lay
  flat), Scale (uniform + per-axis + live mm readout), Mirror, Reset. Viewer uses nested
  groups (model-space transforms vs display orientation); on submit it **exports a baked
  STL** (STLExporter) so scale/rotate/mirror actually affect the slice.
- **Full slicing panel**: layer height (4 presets), walls, top/bottom, infill % + pattern
  (grid/gyroid/honeycomb/…), supports (tree/normal + overhang °), adhesion + brim, seam,
  speed, ironing, fuzzy skin, vase mode, copies, printer target. Stored as `process` jsonb
  on the job (migration 0001) and passed to the slicer. Verified end-to-end: a submit
  persisted the complete process object + legacy columns.
- Honest scope note: paint-on (support/seam/color), cut, boolean, text, and multi-object
  auto-arrange are NOT in this pass (heavy mesh editing) — listed as future.

### 2026-09-10 — Advanced studio: multi-object editor + CSG + paint
- New `StudioEditor.svelte` replaces the single-object viewer. Tools (Bambu-Studio-style
  left rail + per-tool panel + object list):
  - **Multi-import** (STL/OBJ/3MF, many at once), object list with select/duplicate/delete,
    **auto-arrange** (grid bin-pack to the plate), per-object Move/Rotate/Scale/Mirror/Reset.
  - **Plane cut** (splits a part into top + bottom at a Z height) — three-bvh-csg.
  - **Boolean** union / difference / intersection between the selected object and another.
  - **3D text** (TextGeometry + bundled helvetiker font) added as an object; merge via Boolean
    to emboss/engrave.
  - **Paint** brush (raycast): color, support-enforcer, and seam regions, visualized live.
  - Export bakes all objects (transforms + CSG results) into one binary STL for the slicer;
    combined bbox/volume/tri stats feed the quota + summary.
- Added deps `three-bvh-csg` + `three-mesh-bvh`; bundled `static/fonts/helvetiker_*.json`.
- Type-check 0 errors, build green. ⚠ Interactive 3D — needs in-browser QA (no browser in
  the build env). Honest gaps: support/seam **paint is visual only** until the slicer gets
  Bambu 3MF paint-attribute export (color/MMU segmentation, support_enforcers); per-object
  multi-color maps to one AMS color per print for now.

### 2026-09-10 — Paint actually affects the slice (Bambu 3MF export)
- Researched the authoritative BambuStudio/Orca paint format (bbs_3mf.cpp, TriangleSelector,
  Model.cpp). Built `lib/threemf.ts`: native BBS 3MF (fflate zip) with unprefixed
  `paint_supports` / `paint_seam` / `paint_color` per-triangle attributes, value-encoded via
  the exact TriangleSelector serialization (state 1→"4", 2→"8", 3→"0C"…). 7 unit tests lock
  the encoding.
- Editor tracks per-facet paint (support enforcer/blocker, seam, color) and, when any paint
  exists, submits a **.3mf** (geometry + paint) instead of STL. Painted colors become a
  multi-entry `colorRequest` (dispatch maps each to an AMS slot); painted enforcers auto-
  enable support. Color brush now picks from the lab's AMS palette.
- 21/21 tests pass, type-check clean, build green. Remaining tuning (flagged): the slicer
  container must supply process/filament profiles via --load-settings, and multi-color needs
  N filament profiles + those colors loaded in an AMS; support/seam work with defaults.
- Prod: added root `.gitignore` (excludes node_modules/.env/build/.data); `start.sh`
  configured (PORT 5173, dev). Committing + pushing the whole project for CI/deploy.

## Roadmap / checklist

- [x] Monorepo + SvelteKit app scaffold
- [x] Design system (Tailwind v4 + Sparkden tokens, base components)
- [x] DB schema + migrations (orgs, users, sessions, invites, printers, AMS, inventory,
      models, print jobs, queue, approvals, usage)
- [x] Auth: signup (create org), login, sessions, RBAC guards
- [x] Invites: generate links, role + quota presets, redeem flow
- [x] Admin: printer management, AMS & color mapping, filament inventory
- [x] Quotas: per-user monthly gram/job limits + live usage tracking
- [x] Student: model import, 3D design/arrange viewer, color selection
- [x] Slicing adapter + worker scaffold for real CLI
- [x] Print queue + auto-assign to next available compatible printer
- [x] Approval mode (admin sign-off before print starts)
- [x] Usage dashboards + cost accounting (basic)
- [x] Electron desktop wrapper (scaffold)
- [x] **Real slicing**: in-process OrcaSlicer (Bambu profiles) → real Bambu-printable G-code.
      Auto-detected (bundled AppRun / `$ORCA_APPRUN` + xvfb); picks the machine/process/filament
      system profile per target printer and layers a generated override preset so the student's
      supports/raft/infill/quality choices apply. Falls back to bundled Slic3r, then size estimate.
      Docker image ships OrcaSlicer v2.4.2 + xvfb (amd64).
- [x] **Bambu cloud connect + live telemetry + pause/resume/stop** (MQTT manager, `cloud` mode)
- [x] **LAN print dispatch**: FTPS upload + MQTT `project_file` straight to the printer
      (`bambu/lan.ts`), the reliable open path — works for all models, no developer mode. Set each
      printer's IP + access code (Admin → Printers), or auto-fill via SSDP "Discover on network".
      Requires the server on the printers' LAN. See `docs/LAN.md`.
- [ ] **Cloud print dispatch** — not viable via the public API: `/my/task` only records a task and
      the printer can't download a custom file without Bambu's closed networking plugin. Superseded
      by LAN. (`cloudprint.ts`/`/api/print` kept but unused.)
- [ ] **H2-series (H2D/H2C) slicing**: dual-extruder profiles + filament→extruder mapping so those
      models can print (currently auto-excluded).
- [ ] Bambu 2FA (authenticator) login flow; token refresh/expiry UX
- [ ] Live progress via SSE/websockets (currently refresh-based)
- [ ] Richer usage analytics (per-student/-month charts, exports)
- [ ] S3-compatible object storage (currently local disk)
- [ ] Multi-material / multi-color mapping UI in the design studio

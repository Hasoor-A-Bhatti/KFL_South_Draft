# KFL South Draft — Live

The KFL South player-draft dashboard, with a live **spectator view** so people at home see exactly what the venue projector shows, including SOLD, UNSOLD and other animations.

| URL | Who | What |
|---|---|---|
| `https://<your-site>.vercel.app/` | Everyone | Spectator view (read-only, follows the projector) |
| `https://<your-site>.vercel.app/organiser` | Organiser laptop only | The original draft console + a **Go live** button |

The draft engine (`source/KFL_South_Draft_FINAL_187_Players.html`) is **not modified**. It works exactly as before, fully offline, with the same autosave, undo, backups and exports. A small add-on watches the draft and sends a compact copy of it to spectators. If the internet drops, the draft carries on, and broadcasting resumes by itself when the connection returns.

```
Organiser laptop ──POST /api/publish (organiser key)──▶ Vercel function ──▶ Supabase (kfl_live table)
                                                                               │ Realtime
Spectators ◀───────────────────────────────────────────────────────────────────┘
           ◀── /api/state (Vercel CDN, 1-second cache) — backup feed if Realtime is unavailable
```

---

## Setup (about 15 minutes)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com) (or open your existing one. Free projects pause when idle, so open it today to wake it).
2. **SQL Editor → New query**, paste the contents of [`supabase/setup.sql`](supabase/setup.sql), click **Run**.
3. **Project Settings → API / API Keys** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` *or* `publishable` key → `SUPABASE_ANON_KEY`
   - `service_role` *or* `secret` key → `SUPABASE_SERVICE_ROLE_KEY` (**secret**, never share it)

### 2. Local check (recommended)
```bash
npm install
cp .env.example .env.local     # fill in the 4 values
npm run check                  # tests database, permissions and Realtime end to end
npm run dev                    # http://localhost:3000 and http://localhost:3000/organiser
```
`npm run check` must end with **All checks passed**. `npm run dev` works without Supabase keys too (in-memory test mode, organiser key `test`), which is handy for a rehearsal.

### 3. GitHub
```bash
git remote add origin https://github.com/<you>/kfl-south-draft.git
git push -u origin main
```
Use a **private** repository. `.env.local` is git-ignored, so keys are never committed.

### 4. Vercel
1. **Add New → Project**, import the GitHub repo. Framework preset: **Other** (`vercel.json` sets everything else).
2. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
   | `ORGANISER_PUBLISH_KEY` | your organiser password (10+ characters) |

3. **Deploy.** If you add or change variables later, go to **Deployments → ⋯ → Redeploy**, because variables only apply to new deployments.

### 5. Go live
1. On the organiser laptop open `https://<your-site>.vercel.app/organiser`.
2. Bottom-right panel → **Go live** → enter `ORGANISER_PUBLISH_KEY`. It turns green: **● LIVE TO SPECTATORS**.
3. Open `https://<your-site>.vercel.app/` on your phone to confirm, then share that link.
4. Run the draft exactly as normal, including opening the projector window with **Open audience screen**.

The key is remembered on that laptop; after a page reload broadcasting resumes automatically.

---

## On the night

- **Use one organiser tab on one laptop.** Two broadcasting tabs would fight over what spectators see.
- **First visit to `/organiser` starts a fresh draft**, because it is a different web address from the old local file, so it has its own browser storage. If you prepared anything in the local file (photo crops, team edits), export a JSON backup there and import it in `/organiser` (⋯ More → ↑ Restore a saved backup). Or use **Official slides** for a clean start.
- **Internet drops:** the panel shows *RECONNECTING*; keep drafting. Spectators see the last update and catch up automatically.
- **Backup plan:** **Save updated dashboard** downloads a self-contained HTML copy that still works offline and can still broadcast to your Vercel site.
- **Panel ⋯ menu:** resend everything, change the key, or forget the key on this laptop.

## What spectators see
- The same scene as the projector: live auction, budgets, squads, top signings, statistics, intermission, with SOLD / UNSOLD / FREE PICK / NEW RECORD / SALE REVERSED animations and bid pulses.
- The view scales to any screen; phones get a "rotate for a bigger view" hint in portrait.
- Organiser controls, keyboard shortcuts and data editing are not available on the spectator page.
- **Limitations:**
  - The random-draw spinner isn't shown; the new player simply appears.
  - Photos **uploaded on the night** show the KFL logo for spectators. Built-in photos and photo framing do sync.

## Capacity and cost
- Updates are compact (around 5–15 KB) and only sent when something changes.
- Supabase's free plan allows **200 simultaneous Realtime connections**. Beyond that, extra viewers automatically use the backup feed, which Vercel's CDN serves at about one database read per second however many people are watching. Upgrade Supabase if you expect a much larger audience.
- Vercel Hobby is for non-commercial use.

## Privacy
The roster includes players under 18. Every page sends `noindex`, and `robots.txt` blocks search engines, but anyone with the link can view it. Share the link within the community only, and make sure you have consent to show players' names and photos online.

## Project layout
```
source/        Original dashboard (unchanged), logo, player CSV, original README
live/          publisher.js (organiser add-on), spectator-boot.js + spectator.js (viewer)
api/           Vercel functions: publish.js (organiser → database), state.js (backup feed)
scripts/       build.mjs (generates public/), dev-server.mjs, check-config.mjs
supabase/      setup.sql
public/        Build output (generated, git-ignored)
```
To update the player list or dashboard, replace the HTML in `source/` (keep the file name) and push; Vercel rebuilds automatically.

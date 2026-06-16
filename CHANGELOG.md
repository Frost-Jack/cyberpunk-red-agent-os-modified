# Agent OS — Changelog

## Beta 5.5.28 — Mac/Safari NC Mart cart-row buttons restored

Game-night report from Mac users: NC Mart cart was visible but the -/+/trash buttons inside cart rows weren't (or were laid out broken). Windows/Linux users saw them fine.

### Root cause

The `.store-qty-btn` class had ZERO matching CSS rules — the buttons relied entirely on inline `style="cursor:pointer; background:#1a1a1a; ..."`. Foundry's default `form button { width: 100%; }` rule was clobbering them. On Mac, Safari's user-agent Aqua button styling layered on top, expanding each button to consume the full row width and shoving siblings off-screen. Same `form button` battle the `.app-access-tab` rule already fights for the access-tabs strip.

### Fix

Added explicit CSS for `.store-qty-btn` with the proven defeat-Foundry pattern:

```css
.AgentDevice-form .store-qty-btn {
  flex: 0 0 auto !important;
  width: auto !important;
  -webkit-appearance: none !important;
  appearance: none !important;
  ...
}
```

`-webkit-appearance: none` neutralizes Safari's Aqua native button rendering. `flex: 0 0 auto + width: auto !important` overrides Foundry's `width: 100%`. Mac/Safari users will now see compact -/+/trash buttons inline with the qty number, same as Windows/Linux.

### Verification

Pure CSS addition — no JS changes. Existing inline styles still work as fallbacks. No data migration. Sandbox check: rule is scoped to `.AgentDevice-form .store-qty-btn` so it only affects the NC Mart cart rows, nothing else.

Drop-in over 5.5.27.

---


---

## Beta 5.5.27 — GM-reply avatar resolves cross-user

5.5.22's display fallback and 5.5.24's IMPORT button got the avatar into the PLAYER's `customContacts` flag. 5.5.25 / 5.5.26 made BROWSE work for them at the right permission. But when the GM replied in the same thread, the bubble was still showing a default icon — the player's uploaded avatar wasn't carrying through.

### Root cause

`_getContacts()` builds the GM's view of NPC threads two ways:

1. From the GM's own `customContacts` flag — entries here have full data (name, avatar, etc.)
2. Auto-built switchboard entries for NPC threads the GM doesn't have in their own flag — these are scraped from message metadata and only carry `{ id, name, isSwitchboard, ownerId, originalName, active }`. No avatar field.

When a PLAYER creates an NPC contact and uploads the avatar, the avatar lives in the PLAYER's flag, not the GM's. The GM only sees the thread via the switchboard auto-build, so `threadContact.avatar` is `undefined`. At send time, `npcOverrideAvatar` got set to `undefined`, and the message went out with no avatar override. Player's bubble fell back to the default icon despite the upload.

### Fix

At send time (both regular text-send and attachment-send paths), if the GM is in an NPC thread and `threadContact.avatar` is missing, scan every user's `customContacts` for an entry with the matching `npc_*` id and use that entry's avatar. Preserves the existing `groupNpcOverride` pathway for GM-voiced custom group threads.

```js
let _resolvedNpcAvatar = (game.user.isGM && isNpcThread && threadContact?.avatar)
    ? threadContact.avatar : null;
if (!_resolvedNpcAvatar && game.user.isGM && isNpcThread) {
    for (const u of game.users) {
        const lst = u.getFlag("AgentDevice", "customContacts") || [];
        const m = lst.find(c => c.id === this.activeContactId);
        if (m?.avatar) { _resolvedNpcAvatar = m.avatar; break; }
    }
}
const npcOverrideAvatar = _resolvedNpcAvatar || (groupNpcOverride?.avatar || undefined);
```

O(users × customContacts) at send time only — runs once per message dispatched by the GM, not per render.

Verified with a 13-case behavior smoke covering: GM uses own avatar when present, switchboard reply pulls from player's flag, no-avatar-anywhere returns undefined, players don't trigger the scan, non-NPC threads skip the scan, groupNpcOverride still wins as legacy fallback. Both send paths (text + attachment) covered.

Drop-in over 5.5.26. No migration. No setting changes.


## Beta 5.5.26 — BROWSE gated on actual FILES_BROWSE permission

5.5.25 unconditionally showed BROWSE to non-GMs assuming Foundry's FilePicker would just work for them. It doesn't — Foundry V12's `FILES_BROWSE` permission defaults to Assistant GM, not Player. Players clicking BROWSE got silence (or a broken picker, depending on Foundry version). Two-part fix:

### Real permission check

- `getData` now computes `data.canBrowseFiles = !!game.user.can("FILES_BROWSE")`. Wrapped in try/catch with a fallback to `isGM` so weird user-shape edge cases don't crash render.
- Template gates the BROWSE button on `{{#if canBrowseFiles}}`. Users without the permission only see IMPORT.
- Hint text adapts: when BROWSE is visible, "BROWSE opens Foundry's FilePicker"; when hidden, "(BROWSE is hidden — needs Foundry's FILES_BROWSE permission; GM can grant it in Configure Permissions.)"

### Handler hardening

- Hard re-check on click. Even if the button somehow survives the template gate, the click handler refuses to open the FilePicker without `FILES_BROWSE`. Warning toast names the exact permission and points at IMPORT as the alternative.
- Dropped the 5.5.25 `activeSource: "public"` bias. It was sometimes causing the picker to fail for non-GMs even on tables that DID have FILES_BROWSE granted, because the public source doesn't always resolve `icons/` cleanly.

### How the GM enables BROWSE for players

Foundry Core → Configure Permissions → File Browser. Set Player to enabled (or move the threshold down). Players then see BROWSE on next render. To keep BROWSE GM-only, leave it at the default. IMPORT remains available either way.

Drop-in over 5.5.25. No migration. No setting changes.


## Beta 5.5.25 — BROWSE button also available to players, safe default landing

5.5.24 kept BROWSE GM-only on the theory that Foundry's FilePicker was permission-locked for players. It isn't — Foundry's `FILES_BROWSE` permission defaults to the Player role, so players can open the FilePicker fine. The right answer is to show BROWSE to everyone and bias the default landing so players don't open onto the world Data folder where GM art lives.

### Changes

- Template: BROWSE button no longer wrapped in `{{#if isGM}}`. Both BROWSE and IMPORT show for players.
- Handler: when `!game.user.isGM`, the FilePicker opens with `activeSource: "public"` and `current: "icons/"`. Foundry's "Core Data" source is the bundled icon library — no world content, no spoiler surface. Players still have access to Foundry's stock art for picking a portrait.
- Existing path is preserved on re-edit (if the avatar field already has a value, FilePicker opens at that path).
- Hint text updated: "BROWSE opens Foundry's FilePicker; non-GMs land in the Core Data / icons folder by default."

### Spoiler note

`activeSource: "public"` biases the INITIAL landing only. If a GM hasn't tightened Foundry's `FILES_BROWSE` permission, players can still switch tabs to the Data source and navigate the world folder. To fully lock that down: Foundry Core → Configure Permissions → File Browser → set Player to disabled (or set to TRUSTED PLAYER+ and don't promote players). That's a Foundry core setting, not something the module can override. IMPORT remains the truly-locked path: it's gated on `actor.testUserPermission(LIMITED)` so only GM-shared NPCs are exposed.

Drop-in over 5.5.24. No migration. No setting changes.


## Beta 5.5.24 — Player-facing IMPORT button on Add Contact (spoiler-safe)

5.5.22 promised players a way to import portraits and shipped only half of it — the display-side fallback and the auto-pre-fill when opening from the Fixers app. Missing piece: the explicit button on the Add Contact modal that players could press themselves to import. This patch adds it.

### What's new

The Add Contact modal's avatar row is no longer hidden from non-GMs. Players see an avatar input + an IMPORT button (gold, `fa-download`). The GM-only BROWSE button (FilePicker) is still gated to GM because Foundry's FilePicker requires permission flags players don't have.

Press IMPORT → the handler reads the current name field, strips any "(via Bob)" switchboard suffix, looks up a world Actor whose name matches exactly, and drops that actor's `img` into the avatar field. Player can still edit or clear before saving.

### Spoiler safety — only GM-shared actors are visible to player import

The lookup is scoped via `actor.testUserPermission(game.user, "LIMITED")`. Non-GMs can ONLY import portraits from actors the GM has explicitly shared (default ownership ≥ LIMITED). Hidden boss NPCs, encounter actors, and unannounced reveals stay at ownership NONE and are invisible to player import — typing the name returns "No portrait found" rather than confirming the actor exists.

GM workflow to expose a portrait: open the actor → Permissions → set Default to LIMITED. At LIMITED, players see only the actor's name and image, stat blocks and biography stay hidden. To re-hide later, set Default back to NONE.

GMs themselves bypass the permission gate (they own everything anyway). They keep BROWSE as the primary path; IMPORT is also useful as a quick "use the actor's portrait" shortcut.

### Failure messages

Empty name → "Enter a handle first, then IMPORT to pull a matching world Actor's portrait."
No matching actor (or actor is hidden) → "No portrait found for "<name>". The GM controls which NPCs are visible — ask them to set the actor's Default Permission to LIMITED if they want to share this portrait, or paste an image URL/path manually."
Actor exists but has no portrait set (img is `mystery-man.svg`) → "<name> exists but has no portrait set on the actor sheet."
Multiple actors with same name → uses the first match + warns.

Drop-in over 5.5.23. No migration. No setting changes.


## Beta 5.5.23 — Messages home sorts by latest activity + "CitiNet Messages" header

Noticed two small UX things while testing the 5.5.22 drop.

### Feature — Messages home sorts newest-thread-on-top

The Messages home view (the contact list) was using stable insertion order — Party / Group Net first, then players, then custom NPCs, then GM switchboard. That order never changed regardless of activity, which meant a thread that just received a new message stayed in its original slot. Hard to scan in a busy party.

Now sorted by most-recent message timestamp, descending. Matches iOS / WhatsApp / Signal — the contact with the freshest activity bubbles to the top.

Implementation: single O(messages) pass that buckets each AgentDevice message into the contact it belongs to from THIS user's perspective. The bucketing mirrors the in-thread filter so the privacy fix in 5.5.22 is preserved — uninvolved third parties don't pick up activity from DMs they aren't in:

- Party / pcgroup / npc threads bucket on threadId
- 1-to-1 PC DM, my outgoing message → bucket = recipient (threadId)
- 1-to-1 PC DM, incoming whispered to me → bucket = sender (author.id)
- GM monitoring → bucket on threadId (recipient)

Then `Array.sort` (stable in V8 / SpiderMonkey, which is what Foundry runs) sorts by descending timestamp. Ties — including the no-activity default — preserve original insertion order, so a fresh world still reads as Party first → players → NPCs.

### Tweak — Header renamed "CitiNet Contacts" → "CitiNet Messages"

The Messages app header said "CitiNet Contacts" which collided with the Fixers app (which is the actual contacts/relationships app). Renamed the Messages home header to "CitiNet Messages" so the two apps don't visually overlap.

In-thread message ordering (newest at bottom, auto-scroll-to-bottom) was already correct and left alone — that matches IRL inside an open conversation.

Drop-in over 5.5.22. No migration. No setting changes.


## Beta 5.5.22 — PC→PC DM privacy bug + NPC portrait fallback (CommanderCrunch69)

Two fixes from a live-session report.

### Bug — PC→PC DMs leaked to every other player

When PC A messaged PC B from the default contacts listing, every other PC's view of "their thread with PC B" was also showing the same messages. Functionally every PC-to-PC DM became a public party chat. The workaround the table found — making a 1-PC "group chat" — worked by accident: pcgroup_* threadIds don't appear in third-party contact lists, so the leak couldn't trigger.

Root cause was at the message filter in agent-app.js. Senders set `threadId = recipient.user.id`, and the filter matched `flags.threadId === this.activeContactId` with no author or whisper check. Every player has every other player in their contacts (`game.users.forEach` in `_getContacts`), so PC C clicking on PC B set `activeContactId = PCB.id`, the threadId on PC A's message also equalled PCB.id, and the filter happily returned `true` for the uninvolved third party.

This worked silently because Foundry V12 delivers ChatMessage documents to every connected client regardless of whisper visibility — the core chat log filters them by permission, but `game.messages.filter()` reads everything in memory.

Fix (two parts):

- agent-app.js filter restricted to outgoing messages (author === self) for the threadId match. The whisper fallback below it already gated the incoming branch with proper author + whisper-list checks, so adding `&& m.author?.id === game.user.id` to the threadId branch closes the leak without affecting either participant's view.
- main.js `createChatMessage` hook now bails out on uninvolved clients when the message is whispered and the user isn't in the whisper list. Before the gate, PC C also got unread badges and "Incoming from PC A" toast notifications for DMs they shouldn't even know existed. GMs continue to process every message (monitoring).

Verified with `_v5_5_22_privacy_smoke.js`: 17 cases covering all (PC A sender / PC B recipient / PC C uninvolved / GM) × (thread with each of the three) combinations plus the hook gate. PC C is correctly filtered out on every leak vector; PC A and PC B both see the message via their respective branches; GM still processes for moderation.

### Feature — NPC contact portraits fall back to a same-named world Actor

Players can't use Foundry's FilePicker (no permission), so contacts they create themselves — including new NPC threads spawned from the Fixers app — couldn't get a portrait. Bubbles fell through to the GM's character image or the mystery-man default.

Display-side fallback added: when a chat bubble has an `overrideName` but no `overrideAvatar`, look up `game.actors.find(a => a.name === cleanName)` and use that actor's portrait. The "(via Bob)" switchboard suffix is stripped before the lookup so e.g. "Rogue (via Bob)" still matches a world actor named "Rogue". Actors whose `img` is itself the mystery-man placeholder are treated as no match, so we don't replace one default with another.

Also pre-fills the avatar field on the Add Contact modal when it opens from the Fixers app's "Open Messenger" button — if a same-named actor exists, its portrait drops in automatically. Player can still edit or clear before saving.

Cheap O(N actors) lookup short-circuited by the overrideAvatar precedence — only runs on bubbles that wouldn't otherwise have an image.

### Triage — Sequencer error on one player's Call animation

One player at CommanderCrunch69's table was getting a Sequencer error during the Holo Call animation; the other three were fine. Existing defensive coding here is already comprehensive — `_holophoneEnabled()` guards on Sequencer presence, every JB2A file path is probed against `Sequencer.Database.entryExists` with a fallback chain, the full sequence is wrapped in try/catch, and both socket handlers wrap their calls in try/catch as well. A single-player failure means a per-client JB2A/Sequencer install issue. The GM-side `enableCallAnimation` world setting is the documented escape valve — toggle it off for the world or fix the JB2A install on that machine. No code change this ship.

Drop-in over 5.5.21. No migration. No setting changes.


## Beta 5.5.21 — Wallet Identity tab now also drives the Agent ID view

Patreon ask: a GM had figured out the Sys Admin → Wallet Identity tab and wanted to know whether anything besides the wallet could link to a player character. Honest answer is "right now, mostly no" — message authoring, social posts, and auction bids all run off the real Foundry user identity on purpose (security, anti-impersonation, sender attribution). So those aren't going to swap.

But one thing was easy to extend and made the existing setup cleaner: the Agent ID viewer.

### What linked

When the GM clicks a player tab in Sys Admin → Wallet Identity, the Agent ID viewer now also defaults to that player's Foundry user. Before, the wallet and the ID viewer had separate dropdowns — the GM had to pick the same player twice. Now one click moves both. The ID-viewer dropdown still works independently after that (if you want to view player A's ID while keeping the wallet tab on player B, pick A in the ID-viewer dropdown and that override sticks until the next wallet-tab click).

Clicking the System Fund / Virtual Wallet tab does NOT touch the ID viewer — the GM may have it intentionally parked on a specific player and the System Fund tab isn't a player selection.

### What didn't link (and why)

Added a small hint line under the Sys Admin → Wallet Identity tabs spelling it out: Wallet + Agent ID are linked to the active tab; Messenger, Social Net, and Contacts still send/post as the GM regardless.

The authoring surfaces are intentionally separate. If GM-as-player message authoring ever lands it'll be a much bigger feature with its own opt-in toggle and clear in-UI "Acting As" indicator, because letting the GM ghost-post as a player from the same window is a privacy/sender-attribution surface I don't want to accidentally regress.

Drop-in over 5.5.20. No migration. No setting changes. Behavior delta is one extra default-binding on a click handler.


## Beta 5.5.20 — Sat Map path: Browse button + hidden from Configure Settings (Praise Jaheebus)

Patreon report: GMs trying to change the satellite-map background were typing absolute Windows paths (`C:/Users/...`) into Foundry's Configure Game Settings → Module Settings → "Sat Map Image Path" entry, which Foundry's image renderer can't resolve — it only accepts paths relative to the Foundry user-data root.

Two changes in this drop:

### Hidden from Configure Game Settings

The `mapImagePath` registration was `config: true` so the setting appeared in Foundry's core Configure Game Settings menu with a default text-only input. That UI has no FilePicker, no helper text, no validation — typing an absolute path silently saves it and the map fails to load with no useful feedback. Set `config: false` so the entry no longer shows up there. Existing saved values still load; the setting just isn't exposed in that menu anymore.

### Sat Map path moved to the agent's Sys Admin (with Browse)

Sys Admin → Visual → "Sat Map Image Path" now has a folder-icon Browse button between the input and the SAVE button. Click Browse → Foundry's native FilePicker opens (Forge-compatible) → pick the image → input populates with the correct Foundry-relative path automatically. SAVE writes it. No typing required.

Also added a safety check on the save handler — if the path you submit looks like an absolute filesystem path (`C:/Users/...`, `/Users/...`, `/home/...`, `/Volumes/...`), a warning toast fires explaining the format. The path is still saved (in case you're intentionally testing something), but you get the heads-up.

Helper text under the input was rewritten too — clearer format example, explicit "NOT C:/Users/..." callout, points at the Browse button.

Drop-in over 5.5.19. No migration. Existing custom map paths keep working.


## Beta 5.5.19 — Multi-feature fix bundle from real-Foundry playtest

Playtest catches from the 5.5.18 round + community feedback rolled in. Five things, all verified in real Foundry before ship.

### Bug — Application Access toggle wouldn't turn apps OFF for players

5.5.2 added a union of the saved `unlockedApps` flag with `defaultApps` so existing players auto-saw the new 5.5 apps on upgrade. The flip side: that union also re-added any app the GM later toggled OFF, because the missing app looked indistinguishable from a pre-5.5 user who hadn't been migrated yet. GM-side worked because the GM's tabs wrote to specific player flags, but the per-player read path kept resurrecting the toggle.

**Fix.** Replaced the heuristic with a one-time `unlockedAppsMigrated5_5` per-owner marker. First post-5.5 render does the merge AND writes the marker. After that the saved flag is fully authoritative — toggling OFF removes from saved, marker stays, no more re-adding.

### Bug — NCPD FILE button hung on click

The handler referenced `mugshot` in the record push but never declared `const mugshot = ...`. The 5.5.12 patch that was supposed to add it never landed. JS threw a silent ReferenceError; Foundry's event wrapper swallowed the throw; the button appeared to do nothing.

**Fix.** Added the missing const declaration. Also reset `_ncpdActiveId = null` and `_ncpdSearch = ""` after save so the GM definitively lands on the unfiltered list with the new record visible — no more "I clicked FILE and nothing seems to have happened" because of a leftover search or detail view from earlier.

### Bug — Pin "Hover only" label mode didn't trigger

The CSS rule for `.agent-map-pin .pin-label-hover { opacity: 0 }` lived inside a `<style>` block that was scoped to the pin placement modal's `{{#if showMapPinModal}}` conditional. When the modal closed, the `<style>` element left the DOM and the rule disappeared along with it. Pins on the map still had the `pin-label-hover` class but no CSS targeted them.

**Fix.** Moved the rule to `styles/agent.css`. Then real-Foundry testing showed it still didn't fire reliably (specificity / cache / who knows). Switched to pure JS: each pin gets a `data-label-mode` attribute; on `activateListeners`, JS reads the attribute, sets `label.style.opacity = '0'` on hover-only pins, and binds `mouseenter` / `mouseleave` handlers that flip it to `'1'` and back. Inline transition keeps the fade smooth. No CSS dependency — bulletproof against any theme override.

### Bug — Tester1's rent-only housing didn't appear on the ID card

The Bio → ID card housing block was gated on `{{#if housingStatus}}`. Players with rent set but status empty (Phil Sweet's table had this) got nothing on their card.

**Fix.** Gate changed to `{{#if housingHasAny}}` where the getData side sets `housingHasAny = !!(housingStatus || housingRent)`. When only rent is set, the block renders with `(no address on file)` as the placeholder status line and the rent shown in gold underneath.

### Feature — Housing per-character (Phil Sweet via Patreon)

Up to 5.5.18, housing was stored on the User flag — so a player running two characters saw the same housing on both. Phil pointed out that different characters often have different rent / living situations.

**Fix.** Storage migrated from `user.flag` to `actor.flag`. Sys Admin → Housing Roster now iterates each player's owned character actors and shows one row per `(player → character)` pair. Legacy user-level housing falls back as a default when the actor flag is empty, so existing data isn't lost — on first save per character the value gets re-written to the actor flag and from then on each character is independent. Sys Admin section text cleaned up (patch-note language removed from the UI; that belongs here in the changelog, not in the GM panel).

### Bug — Save Housing snapped the Sys Admin scroll back to top

The `save-housing` handler awaited `setFlag` per row, each of which fired hook events that triggered intermediate renders racing with the explicit `this.render(true)` at the end. Each intermediate render captured then restored the wrong scroll position.

**Fix.** Adopted the existing rep-toggle scroll-pin pattern: capture `_pinScroll` before the awaits, kick off a `requestAnimationFrame` loop that re-asserts the saved scrollTop for ~400ms regardless of intervening renders. Save now stays where you saved.

### Pin label and pin glyph (Sleepingmann on Reddit)

Folded in this drop: per-pin label mode (Always / Hover only / Off) on the placement modal + default pin icon shrunk from 1.4rem to 1.1rem. Hover only now works via JS (see above).

Drop-in over 5.5.18. No migration. Existing pin data defaults to "always" label mode (matching previous behavior). Existing user-level housing data is preserved as a fallback until the GM saves per-character.


## Beta 5.5.18 — App-access toggle stuck on + NCPD FILE button hanging + per-pin label mode

Two real-Foundry bugs from the 5.5.17 playtest + a community suggestion folded in.

### Bug — Application Access can't turn apps OFF

The 5.5.2 fix that auto-merged new default apps into a returning player's `unlockedApps` flag had a flip side: every render after the merge re-added apps that the GM had since toggled OFF. End result was that the toggle UI showed the OFF state visually, but the next render put the app back. Apps the GM disabled (Fixers, NC Mart, Bio Monitor, etc.) reappeared on the player view.

**Fix.** Detect whether the GM has already seen the 5.5 new apps — if any of `ncpd / ziggurat / garden` is present in the saved `unlockedApps` set, the saved set is treated as authoritative going forward and the union no longer fires on every render. Upgraders from pre-5.5 still get the one-time merge; everyone else's toggles stick.

### Bug — NCPD FILE button hung silently

The `ncpd-add-record` handler pushed a `mugshot` field into the record object but never declared `const mugshot = ...` to read it from the modal input. JS threw a ReferenceError on the push line; Foundry's event-handler wrapper swallows uncaught exceptions without surfacing a UI notification, so the button just appeared to do nothing. Records were never saved.

**Fix.** Added the missing `const mugshot` declaration alongside the other field reads. FILE now actually files the rap sheet, the modal closes, and the new record shows up in the list.

### Community suggestion (Sleepingmann on Reddit) — pin labels + smaller default glyph

Two adjustments to make pins read better on custom large maps:

- **Default pin icon shrunk** from `1.4rem` to `1.1rem` — less map clutter at the default zoom.
- **Per-pin label display mode.** The pin placement modal now has a three-button toggle: **Always · Hover only · Off**. "Always" matches the previous behavior. "Hover only" hides the label until you mouse over the pin, then it fades in (CSS opacity transition). "Off" shows just the icon, no label at all — the title attribute still surfaces the label on browser hover for accessibility.

Drop-in over 5.5.17. No migration. Existing pins default to "Always" label mode (matching previous behavior).


## Beta 5.5.17 — Pin click + palette + scrollbar + image row layout

Real-Foundry playtest catches from the 5.5.16 audit:

### Map pin clicks weren't landing

The map image had `pointer-events: none` in its inline style (so the browser's default image-drag behavior wouldn't fight with the pan gesture). My 5.5.3 click handler bound to `.agent-map-img` — which was unreachable because of that very style. Cursor swapped to crosshair correctly but the click never fired.

**Fix.** Rebind the click handler to `.map-container` (the parent), which always catches clicks regardless of the image's pointer-events. The image's bounding rect is still resolvable for coordinate math even when pointer-events is off — `getBoundingClientRect` doesn't care about event-capture state. Bonus: skip clicks that bubble up from existing pins or zoom controls (so clicking an existing pin doesn't drop a new one on top), and skip clicks that land outside the image bounds.

### Pin color/icon palette didn't respond to clicks

Every radio input in the color palette had `id="map-pin-modal-color"` — same id repeated for every swatch. Same in the icon palette. HTML ids must be unique. `html.find('#map-pin-modal-color').val()` only returned the first swatch's value (NCPD blue), so every pin came out blue regardless of what the GM clicked.

**Fix.** Removed the duplicate `id` attributes — radio buttons only need a shared `name` for grouping. Switched the handler to read `input[name="map-pin-modal-color"]:checked` (selects the actually-chosen swatch). Added visual selected-state via CSS `:checked + sibling` selectors — picked color gets a white border + yellow ring; picked icon swatch gets an amber background + amber icon tint. You can now see which option is selected.

### Chat input scrollbar arrows

The chat input textarea had a 3px cyan webkit scrollbar with up/down arrow buttons rendering in the space between "Encrypt message…" and the send icon. Set scrollbar-width to none (Firefox), `::-webkit-scrollbar { width: 0; display: none }` (Chrome/Edge), and `-ms-overflow-style: none` (legacy Edge). Long messages still scroll internally up to the 120px max-height; the scrollbar just doesn't render visually.

### Image row layout collapse on Garden / NCPD / Ziggurat modals

The mugshot / photo / image input rows used flex (`flex: 1 1 auto` for the input + `flex: 0 0 auto` for the Browse button). Under Foundry's CSS overrides on `<input type="text">` and `<button>`, flex math could collapse the input to almost nothing while the button stretched past the modal edge.

**Fix.** Switched all three rows from flex to CSS grid (`grid-template-columns: 1fr auto`). Grid doesn't collapse the input column when the row is narrow; the Browse button takes its natural content width without growing. Bonus padding bump on the button (6px 12px) so it doesn't read as cramped.

Drop-in over 5.5.16. No migration. All changes are display/event-layer fixes; saved data unchanged.


## Beta 5.5.16 — Visual-audit fix pass (8 bugs caught by render harness)

Built a sandbox Handlebars render harness this cycle that renders every new-app view + modal + state and inspects the output for visual / UX / wiring issues. First pass found 8 real bugs that the static parse-check + handlebars-balance preflight couldn't catch. All fixed in this drop.

### Bugs caught + fixed

- **NCPD empty state copy.** When zero records exist and no search is active, the empty-state read "No matching records." — implies records exist but none match a search the user never typed. Now branches: `No rap sheets on file. Tap + to file one.` when truly empty; `No matching records.` only when search has a value.
- **Ziggurat empty state copy.** Same class of bug — said "No listings in this category yet" even when filter was set to All. Now: "No city listings yet. Tap + to add one." when truly empty + All filter; "No matching listings." when searching; "No `<Category>` listings yet." when a specific filter is active.
- **Garden empty state copy.** Read "No matches yet. The Garden will surface compatible profiles soon" — sounded like a passive system message. GM-facing copy now: "No Garden profiles yet. Tap + to plant one." Player-facing copy unchanged.
- **Garden image fallback inconsistent with NCPD.** Garden + Ziggurat images used `onerror="this.style.display='none'"` while NCPD used `onerror="this.src='icons/svg/mystery-man.svg'"`. Bad image paths just disappeared on Garden/Ziggurat, leaving an awkward gap. Now all three apps fall back to the mystery-man placeholder consistently.
- **Ziggurat row heights inconsistent.** List rows with images were ~44px tall; rows without images collapsed shorter, breaking the rhythm of the list. Always render an image element with the mystery-man fallback so every row is the same height.
- **Map pin label could push off-screen.** A long pin label (50+ chars) used `white-space:nowrap` with no max-width and would visually extend past the viewport, breaking the map layout. Now caps at 140px with text-overflow ellipsis; the full label still shows on hover via the existing `title=` attribute.
- **Modal close X had no keyboard tab-stop.** The X icon to close NCPD / Ziggurat / Garden modals + the map pin manage modal was a bare `<i>` with `cursor:pointer` and a click handler. Worked for mouse but keyboard-only users couldn't tab to it. Now wrapped in `<button type="button" aria-label="Close">` — proper button semantics, tabbable, screen-reader friendly.
- **Mugshot / photo placeholder text too long.** Placeholders read "icons/svg/mystery-man.svg or modules/AgentDevice/..." which visually truncated mid-string on a narrow phone-frame modal. Replaced with "Image path (optional)" — short, clear, fits.

### Sandbox render harness committed

Audit harness now lives at `.sandbox/render-verify/` with a `run.sh` wrapper that installs handlebars once in `/tmp/render-deps` and runs all three scripts:
- `render.js` — 12 view × state combinations across NCPD / Ziggurat / Garden
- `render-more.js` — Bio with/without TT coverage, Map with/without pin mode
- `round-trip.js` — pure JS simulation of filter/search logic across all new apps

Every future ship now runs this before tag-push as the audit ceiling, alongside the existing `ship.js` preflight as the floor.

Drop-in over 5.5.15. No migration.


## Beta 5.5.15 — Ziggurat filter / add-dropdown unification

Playtest catch: the player-facing Ziggurat filter chips used one category list (Venues / Bars / Food / Fixers / Black Market / Services / Other) and the GM-facing add dropdown used a different one (Venue / Fixer / Ripperdoc / Vendor / Safehouse / Gang Turf / Corp / Other). Saved entries carried the GM list; the filter chips were testing exact-match against the player list. End result: entries either never matched any filter or appeared under the wrong one.

**Fix.** Unified on the GM list (richer + Cyberpunk-flavored). Filter chip strip now reads: `All · Venue · Fixer · Ripperdoc · Vendor · Safehouse · Gang Turf · Corp · Other` — same as the add dropdown. Exact-match filtering works as intended. Existing entries are unaffected — they already carry the canonical values.

Drop-in over 5.5.14. No migration.


## Beta 5.5.14 — Pin mode cursor + click pipeline

The PIN-MODE banner said "click map to place" but the cursor stayed as the grab/drag hand from the pan handler, and a mousedown was still arming the pan logic — the click went through but the visual was misleading.

**Fix.** In pin mode, the map container's cursor is now `crosshair` (matches the "drop a pin here" semantic), and the pan mousedown handler bails out early when pin mode is on — no pan setup, no momentary "grabbing" cursor, no race between pan release and click. The pin-placement click goes straight from mousedown → click → modal open.

Drop-in over 5.5.13.


## Beta 5.5.13 — NC Mart "All" category, set as default landing view

Quick playtest follow-up. The NC Mart catalog defaulted to **Weapons**, which surfaces a category-filtered view before the player has any chance to scan the full inventory. Added an **All** virtual category at the front of the tab strip and made it the default.

- Tab strip now reads: `All · Ammo · Armor · Clothing · Cyberware · Drugs · Gear · ...` with All highlighted by default on first open.
- "All" flattens every category into one scrollable list. Search, price-tier filter, affordability toggle, and Fixer-rank gate all still apply on top of it the same way they do per-category.
- Default category state changed from "Weapons" to "All" — affects fresh installs only; existing players' last-viewed category sticks until they switch.

Drop-in over 5.5.12. No migration.


## Beta 5.5.12 — New-app polish: mugshots, photos, Night Market price override + catalog import

Playtest round on the 5.5.x new apps. Five real issues + one visual artifact, all fixed.

### NCPD mugshot field

Rap sheets now carry an optional mugshot image. GM fills the new "Mugshot" field in the FILE RAP SHEET modal (with a Browse button using Foundry's FilePicker, Forge-compatible). The detail view now lays out as a horizontal split — mugshot on the left, the rap-sheet text on the right — with a SUBJECT label under the photo. Player-side list rows also pick up a small thumbnail for at-a-glance recognition. Falls back to the generic `mystery-man.svg` icon when no mugshot is set.

### Garden photo Browse button

The Garden modal already had a photo-path input, but it required typing the path. Added a Browse button next to it (same FilePicker pattern as NCPD), so the GM picks the image visually. Data flow was already wired through to the detail + list views — this just fills in the missing UI.

### Ziggurat optional image field

Audit catch: Ziggurat had no image surface at all. Added an optional image field to the modal (with Browse) and a small thumbnail to each list row. Lets the GM attach a venue photo, fixer headshot, gang sigil, or corp logo to each city directory entry. Skipped on entries without an image — no placeholder clutter.

### Night Market — LOAD CATALOG button

The "Add from current catalog" picker was rendering blank because the NC Mart catalog only lazy-loads when a player opens the NC Mart app. If the GM went straight to Sys Admin → Night Market without anyone hitting NC Mart first, there was nothing to add from. Added an explicit **LOAD CATALOG** button at the top of the picker that triggers the same loader. Shows item count once loaded. Becomes **REFRESH CATALOG** after first load. Empty-state message points the GM at the button.

### Night Market — price override per item

The whole point of a Night Market is that prices aren't the same as the regular catalog — markup for scarcity, markdown for "fell off a Militech truck." Added an optional price-override input next to the flavor field on each catalog-picker row. Blank uses the catalog price. Any positive number wins. The curated-list display now shows the active price in purple and a small grey "(was Xeb)" hint when the GM overrode it. Stored alongside the catalog price so changes are visible.

### Modal textarea resize-handle artifact

The notes textareas on NCPD / Ziggurat / Garden modals were rendering with a diagonal-stripe resize grip in the bottom-right corner that bleeds visually against the dark modal background and red phone frame. Set `resize: none` on all three (same pattern the chat input uses). The rows= setting still controls default height; users can't drag-resize but the autoreflow is fine for the field sizes involved.

### Audit results

Full pre-ship sweep clean: parse + handlebars balance OK, all template-→handler actions bidirectional, all four FilePicker hooks (`pick-contact-avatar`, `pick-custom-item-img`, `pick-ncpd-mugshot`, `pick-garden-photo`, `pick-ziggurat-image`) have matching template Browse buttons, modal input IDs (6 per app for NCPD/Ziggurat/Garden) match 1:1 between template and handler, GM permission guards present on all new writes.

Drop-in over 5.5.11. No migration. Existing rap sheets / Garden profiles / city listings stay intact (new fields are optional + default to empty).


## Beta 5.5.11 — README banner: don't use Code → Download ZIP

GitHub's "Code → Download ZIP" button on the main repo page produces `Agent-OS-main.zip` extracting to `Agent-OS-main/` — named after the repo, not the module. That folder name doesn't match `AgentDevice/` where Foundry installs the module, so dropping it into a modules directory leaves the GM with two folders side by side.

GitHub controls that filename and folder structure entirely — there's no workflow setting or repo config that overrides it. The actual fix is for users to grab the **release zip** from the Releases page instead (which the workflow wraps in `AgentDevice/` correctly), not the auto-generated source archive from the main repo page.

Added a prominent banner block at the top of the README so anyone landing on the repo's main page sees the install instruction before they click the green Code button. Same content also gets rendered when GitHub previews the README in search results, on the Releases page sidebar, etc.

No code or gameplay changes.


## Beta 5.5.10 — README accuracy pass

Docs-only drop. README was documenting the pre-5.5.8 workflow (module.json at zip root, no AgentDevice/ wrapper). Rewrote it to match what actually ships:

- The release zip is `AgentDevice-<version>.zip` with all module content wrapped inside an `AgentDevice/` folder so it extracts to the same path Foundry installs already use.
- The GitHub release page also auto-attaches `Source code (zip)` and `Source code (tar.gz)` — those are GitHub's auto-generated source archives, named `Agent-OS-<tag>.zip` (matches the repo name, extracts to `Agent-OS-<tag>/`). Don't use those for installs. Always grab the workflow-built `AgentDevice-*.zip` from the Assets section.
- ship.js now includes a preflight that parse-checks every tracked source file before commit. Documented in the README so future maintainers know what to expect.
- ship.js is no longer in the repo's source archive (untracked since 5.5.9). Documented.

No code changes. No gameplay changes.


## Beta 5.5.8 — Release zip wraps in AgentDevice/ folder + ship.js untracked

Two install-side fixes. No gameplay changes.

### Release zip extracts to `AgentDevice/` again

The PowerShell shipping pipeline that the module used through 5.0.x produced a zip whose contents were wrapped in an `AgentDevice/` folder, so Patreon users dropped that folder straight into their Foundry modules directory and existing installs were overwritten cleanly. The GitHub Actions workflow that replaced it (added in 5.0.3) zipped the module's contents at the archive root instead, so the new zip extracted as a bare `module.json` + `scripts/` + `templates/` + ... directly — different folder name, breaks the drag-into-modules-folder muscle memory for existing tables.

**Fix.** Workflow now stages the runtime content inside `staging/AgentDevice/` first, then zips that. The resulting archive contains a single top-level `AgentDevice/` folder so the extract behavior matches every previous Patreon zip back through 4.x. Foundry's manifest-URL install path also still works — it walks the archive to find module.json wherever it lives.

### `ship.js` no longer in the GitHub source archive

`ship.js` is maintainer-side dev tooling — it shouldn't be in the source tree someone downloads via "Download ZIP" from the repo. Untracked from git and added to `.gitignore`. Stays on the maintainer's local working tree (where it has to live for the shipping workflow to work) but no longer ships in the source archive.

Drop-in over 5.5.7. No gameplay changes; the module behaves identically.


## Beta 5.5.7 — Scroll snap-back fix on every new app

Playtest report: clicking a Ziggurat category (Venue / Fixer / Ripperdoc) snapped the view back to the top; scrolling down a long list and triggering any re-render did the same. Confirmed the same class of bug across NCPD, The Garden, and the map pin manage modal — none of the new 5.5 app scroll containers were tagged for preservation.

### Fix — self-discovering preservation attribute

The existing scroll-preservation system tracked a small hard-coded list of class selectors (`.admin-console`, `.rep-view`, etc.). Adding the new 5.5 views would have meant updating that list every time a new app shipped. Instead, added a self-discovering variant: any element with `data-preserve-scroll-container="<key>"` is captured before render and restored after, no JS array maintenance.

Tagged six scroll containers in this drop:

- NCPD: list view (rap sheet grid) + record-detail view
- Ziggurat: city directory list (the one with the category-snap-back report)
- The Garden: matches grid + profile-detail view
- Map pin manage modal: pin list

Category clicks, search input, pin visibility toggles, and any other render-triggering action now preserves the current scroll position across the re-render. Existing class-keyed selectors stayed in place — the attribute is additive, not a rewrite.

Future apps just add `data-preserve-scroll-container="<unique-key>"` to their scrollable element and it works automatically.

Drop-in over 5.5.6. No migration.


## Beta 5.5.6 — Night Market START button

Tiny gap noticed by playtesting: Sys Admin → NC Mart → Night Market only had END NIGHT MARKET. Adding the first item was the implicit "start" and the GM had no way to open a market with a chosen name before stocking it, and no clear status when it was closed.

**Fix.** Sys Admin → Night Market now shows two states:

- **Closed** — a name input ("e.g. Maelstrom Black Drop") + a **START NIGHT MARKET** button. Click START and the market opens under that name with an empty curated list. Blank input defaults to "Night Market".
- **Open** — the previous END NIGHT MARKET button + a status pill ("Live · 'Maelstrom Black Drop' · 4 item(s)" or "Open (empty) · 'Maelstrom Black Drop' — add items below to surface the tab"). Catalog picker becomes available for adding items.

Players still only see the Night Market tab in NC Mart when the market is open AND has at least one item, so the GM can stage an empty drop without players seeing a confusing empty tab. END resets the market to closed.

Drop-in over 5.5.5. No migration. Existing markets keep working — `nm-add-from-catalog` still creates the market object if one isn't there, so the implicit-start path stays as a fallback.


## Beta 5.5.5 — + buttons on new apps, REO Meatwagon panic, Ziggurat ID-mismatch fix

Three changes addressing direct community feedback from the 5.5.4 playtest.

### + buttons on NCPD / Ziggurat / Garden — add content from the app, not Sys Admin

The Sys Admin tab was getting bloated, and adding content meant tabbing out of the app you were looking at. Each of the three new apps now has a GM-only **+** button on the header. Click it and a modal opens with the same fields the Sys Admin inline form used to host — name, charges, bio, whatever the app needs. Save closes the modal and the new entry shows up in the list immediately. No more round trips through Sys Admin every time the GM wants to file a rap sheet or seed a Garden profile.

The Sys Admin inline add-forms are still there for now (they don't hurt, and existing muscle memory keeps working), but the + button modal is the new path going forward.

### REO Meatwagon panic for players with no TT coverage

Before: players without Trauma Team coverage saw a dimmed dead block on the Bio screen — "Call REO Meatwagon and hope for the best" — that couldn't be clicked. The community feedback was direct: that's a wasted GM hook, give them a real button. Now it's a fully clickable orange dashed panic frame styled the same way Trauma Team's is styled, just routed under the "REO Meatwagon" alias. Click it and the GM gets a whispered chat card with a "scrap-grade ambulance dispatched, narrate accordingly — ETA, cost, and competence at your discretion" prompt. Same alert pipeline as the TT panic button, just a different brand of cavalry.

### Pre-existing Ziggurat ID-mismatch bug — fixed

Audit catch: the Ziggurat Sys Admin form was already broken in 5.5. The add handler read inputs with the prefix `#zig-add-*` but the template inputs were `#ziggurat-add-*`. Every "ADD LISTING" click read empty values from non-existent IDs, so nothing ever got saved. Hadn't been reported yet because nobody had tried to use it before. Handler now reads the IDs the template actually has. Old shipped data is unaffected (there was none to be affected — the form never wrote anything).

### Audit notes

Full audit pass per the public-beta bar: parse + handlebars balance clean, all 23+ actions bidirectional (no orphan template references, no dead handlers other than legacy `map-pin-add` which is kept harmless for back-compat), modal input IDs match between template and handler 1:1 across all three apps, GM permission guards on every modal open, settings.set, and add path.

Drop-in over 5.5.4. No migration. Existing world data untouched.


## Beta 5.5.4 — Audit hotfix: voice-override-without-avatar tagging, map pin click-after-pan race

Full code audit per the "bug free as much as possible for public beta" bar. Two bugs caught that escaped the 5.5.3 ship.

### Bug — voice-override-only NPC bubbles still showed without per-bubble speaker tag

5.5.3 fixed the multi-NPC chat readability regression by switching consecutive-message detection to `personaKey` (instead of the GM's user id) and adding an `isMultiPersonaThread` flag that forces speaker tags on every bubble in any thread that used a voice override. The detection of "is this a roleplay bubble" keyed on `flags.overrideAvatar` — which works when the GM has set a custom avatar for the NPC. But for a GM voicing an NPC using only a custom voice **name** (no avatar swap), `overrideAvatar` is absent, so the bubble was flagged `isNpcRoleplay: false`, `isMultiPersonaThread` for the whole thread came up false, and the per-bubble speaker tag never rendered. The exact case from the screenshot reports.

**Fix.** `isNpcRoleplayMsg` now triggers on either `flags.overrideAvatar` OR `flags.overrideName` — any persona override signals "treat this as an NPC bubble." Combined with the existing 5.5.3 fixes, name-only voice overrides now render with per-bubble speaker tags + persona-hashed colors + correct left-aligned layout. No avatar required.

### Bug — map pin click-after-pan race

5.5.3 added click-to-place map pins. The click handler bailed when `_panState.isPanning` was true so panning the map wouldn't drop a phantom pin — except browsers fire `click` on mouseup, and `_onWindowMouseUp` resets `isPanning` to false **before** the click event runs. End result: pan-release lands a phantom pin modal at the mouse-up position.

**Fix.** Track `_panState.moved` explicitly: reset to false on every mousedown, set to true the first time mousemove fires during a pan, checked in the click handler. If the mouse moved during the press, the click is a drag-release and the modal stays closed. Pure click (no motion) still places the pin normally.

### Audit findings (clean)

- Parse + handlebars balance: clean. Preflight passes.
- Template ↔ handler wire-check: 23 new 5.5/5.5.3 actions, all bidirectional.
- 50 `game.settings.set` calls: all GM-guarded (15 of them deeper than a 15-line window, so the initial scan flagged false positives; manual recheck confirmed every write path has `isGM` upstream).
- Window-level listeners: both map-pan and window-drag sets have their own once-per-instance bind guards (`_windowEventsBound` and `_onWindowDragMove` ref check respectively); both clean up in `close()`.
- Sticky-flag upgrade paths: only `unlockedApps` had the defaults-change issue and that was already fixed in 5.5.2. All other `getFlag || []` patterns are user-curated data, not new-default merges.
- Settings registered but unread: 5 settings register but read only once or in different code paths (`enableCallAnimation`, `storeFixerGatePrice`, `storeFixerGateRank`, `styleTrend`, `styleTrendDesc`). Verified — all are world settings tuned via Configure Settings and read at the point of effect. No dead settings.

Drop-in over 5.5.3. No migration.


## Beta 5.5.3 — Multi-NPC chat fix + click-to-place map pins + canon color pass

Three changes from the first 5.5 playtest round. Two are bug fixes, one is a UX move.

### Bug — multi-NPC chat bubbles were unreadable

In a thread where the GM was voicing two or more NPCs back-to-back, every bubble looked identical: no avatar, no speaker tag, same cyan color. You couldn't tell NPC1 from NPC2. The "consecutive message" logic that hides repeat avatars / names was keyed on the underlying chat author's user id — and for GM-puppeted NPCs that's always the GM, regardless of which persona was speaking. So NPC1 → NPC2 → NPC1 all collapsed into one "consecutive run" and the system hid every distinguishing element after the first bubble.

**Fix.** Consecutive detection now uses a `personaKey` derived from the voice-override name (or the raw user id when no override is set), so two different NPC voices read as two different runs even when the same GM authored both. Avatars come back. Speaker tags come back. And for any thread where a voice override has been used at all ("multi-persona thread"), the speaker name is now stamped on **every** non-self bubble — not just first-of-run — so you can scan a long back-and-forth without scrolling up to find the last name change. The community feedback was specific: "tag speaker every chat, if you're not going to make it obvious who it's from." Done.

### UX — map pins moved out of Sys Admin into the Maps app, click-to-place

Pin curation in 5.5 was buried inside Sys Admin with manual x/y percent inputs. Nobody knows the coordinate of a spot on Night City off the top of their head. Moved the whole thing to the Maps app:

- New GM-only **PIN** button in the map's bottom-right control stack. Toggle it on, a yellow "PIN MODE — CLICK MAP TO PLACE" banner pops up, and the next click anywhere on the map captures that exact position.
- A placement modal opens pre-filled with the click coordinates (locked, no typing), plus a label field, optional notes, an 8-color faction-coded palette (NCPD blue · Trauma Team red · Arasaka red · Tyger Claws gold · Net cyan · Voodoo Boys violet · Mox pink · Aldecaldos green), a 12-icon palette, and a "visible to players" checkbox.
- Second GM button: **MANAGE PINS** opens a modal that lists every pin with eye-toggle for visibility and a delete button — same curation surface that used to live in Sys Admin, just one tap away from where you're actually looking.
- The corresponding Sys Admin section is now a stub that points to the Maps app.

The GM never has to think about x/y again.

### Visual — canon-leaning color + icon tune on the new 5.5 apps

Minor tune to make the new 5.5 apps read closer to recognizable Cyberpunk RED / 2077 visual ID:

- **NCPD DB**: shifted from generic sky blue to a deeper neon-cyber blue (`#3a86ff`) with a thin Tyger-yellow underline strip on the header for the NCPD patrol-stripe feel.
- **Ziggurat**: deeper Arasaka data-tower violet (`#7c4dff`) instead of the lavender of 5.5. Icon swapped from `fa-city` to `fa-database` — Ziggurat in 2077 lore is a Net data fortress, the database icon reads more accurately than the city skyline.
- **The Garden**: deeper Cyberpunk neon magenta (`#ff1493`) instead of the pastel pink — closer to the Black Chrome / Edgerunner dating-app palette.
- **Night Market**: brightened violet for more neon-punch.
- **Map pin palette**: relabeled with faction names (NCPD / Trauma Team / Arasaka / Tyger Claws / Net / Voodoo Boys / Mox / Aldecaldos) so the GM can color-code intent at a glance instead of picking from "Red / Yellow / Cyan."

Drop-in over 5.5.2. No migration. Existing pins keep their original colors.


## Beta 5.5.2 — Hotfix: new 5.5 apps invisible after upgrade

5.5 shipped three new apps (NCPD Crime Database, Ziggurat City Database, The Garden) but tables upgrading from 5.0.x reported the apps didn't appear on the Agent home grid — even after re-uploading the module and relaunching the world. Same for the Night Market mode and the new Sys Admin sections (those only render when the underlying app is unlocked for the active view).

**Root cause.** The home grid filters by a sticky per-actor / per-user `unlockedApps` flag. The render path read `getFlag("unlockedApps") || defaultApps`. On a fresh install the flag is undefined so `defaultApps` (which 5.5 extended to include the three new apps) was used and everything appeared. On an upgrade from 5.0.x the flag is already populated with the old 11-app list — that's truthy, the `||` fallback never fires, and the new apps stay hidden forever. The toggle handler had the same out-of-sync fallback list, so manually toggling any app off would reset the player to the old 11-app list and re-hide the new ones.

**Fix.** Render path now unions the saved `unlockedApps` with `defaultApps`: every app the GM previously turned ON stays on, every app newly added to defaults is auto-merged into the view. GM can still toggle the new apps off from Sys Admin → Application Access if they don't want them in this campaign. Toggle handler's fallback list synced with `defaultApps` so first-toggle on a brand-new player can't roll back to the old set either.

No data migration needed — the fix is read-side. The first re-render after upgrade picks up the new apps automatically; saved flags get written through on the next GM toggle as normal.

Drop-in over 5.5.1. No migration.


## Beta 5.5.1 — Folder cleanup + fuse-safe tooling

Internal hygiene drop. No gameplay changes; the module behaves identically to 5.5.

- **AgentDevice/ is now game-only.** Moved internal QA notes (`TESTING_PATCH3.md`, `TESTING_PATCH4.md`) and superseded release notes (`RELEASE_NOTES_PATCH.2.1.md`, `RELEASE_NOTES_PATCH.3.md`) out of the module folder into the parent project's `_archive/` directory — they were excluded from the release zip already, but they didn't belong in the module's working tree where they'd show up if you symlinked AgentDevice/ into Foundry's modules directory for live debugging.
- **Removed sandbox probe artifact.** Deleted `.git-probe-test`, a one-byte file left behind by an earlier session diagnosing fuse-mount filesystem behavior. Added probe-artifact patterns to `.gitignore` so future investigation leftovers can't re-leak into the module dir.
- **safe-edit.sh + ship.js preflight.** Tooling-side change that doesn't ship to players but protects future releases. The Cowork fuse mount was silently truncating Edit-tool output on large source files (~1500+ lines) — node --check catches the mid-statement cuts in ~100ms but text-pattern smoke tests miss them. `ship.js` now runs a preflight that parse-checks every tracked .js file and handlebars-balance-checks every .hbs file before committing; refuses to push if anything's broken. The matching `.sandbox/safe-edit.sh` helper routes edits through `/tmp` with verification, so dev-time edits don't hit the truncation path in the first place.

Drop-in over 5.5. No migration. Foundry doesn't see any of this.


## Beta 5.5 — App pack drop: NCPD, Ziggurat, The Garden, Night Market, map pins, housing, MedScan, Screamsheets

Big one. Eight community-requested features bundled into a single drop instead of dribbling them out across point releases. The Agent now ships with five new in-fiction apps and three quality-of-life additions to existing ones. All new data lives in world-scoped settings; the GM curates everything from Sys Admin. No migration — old worlds boot clean.

### New apps

- **NCPD Crime Database** (`fa-fingerprint`, sky blue). Lookup app for rap sheets. GM files records via Sys Admin → NCPD Crime Database (name, charges, bounty, status, notes). Players search by name / charges / notes and tap a row to read the full sheet. Useful for bounty boards, wanted-poster handouts, and "is this Burnpunks gang member the one we're after?" cross-references.
- **Ziggurat City Database** (`fa-city`, violet). Player-facing directory of venues, fixers, ripperdocs, safehouses, gang turf — anything you'd want a Night-City-savvy edgerunner to be able to look up. GM files entries with a category (Venue / Fixer / Ripperdoc / Vendor / Safehouse / Gang Turf / Corp / Other), address, hours, freeform notes. Players filter by category and search by keyword. Cleaner than dropping locations into journal entries the players never re-open.
- **The Garden** (`fa-seedling`, pink). The dating-app concept from the Black Chrome / Edgerunner-era setting. GM plants NPC profiles (name, age, photo, bio, interests, availability). Players see the matches as a card stack and can tap MESSAGE to start a Messenger thread with the profile — the thread auto-routes back to the GM-controlled NPC the same way the existing NPC-contact flow does. Hooks for cross-pollination with Reputation later (gating who shows up by Fixer rank, etc.); 5.5 just ships the social surface.
- **Night Market mode in NC Mart** (community ask). Curated limited-time drop that lives alongside the regular catalog. GM curates via Sys Admin → NC Mart → Night Market: browse the live catalog, click + ADD on each item you want in the drop, add an optional flavor blurb ("fell off a Militech truck"), and players see a NIGHT MARKET tab in NC Mart while the drop is live. Items use catalog prices so the GM doesn't fight the price-tier filter. END NIGHT MARKET clears the drop in one click.
- **Map indicators / GM pins** (Ryouhi request). Pin overlay on the Agent satmap. GM places pins via Sys Admin → Map Indicators (label, x/y as percent, color, FontAwesome icon, optional notes shown on hover). Visibility toggle lets you draft pins without leaking them to players, then flip them visible at the right table moment. Pins render with a stylized icon-plus-label glyph on the map; hover surfaces the notes.

### Quality-of-life on existing apps

- **Rent / housing status on the Bio → ID card** (Gotto request, long-standing backlog). GM sets per-player housing-status + rent string via Sys Admin → Housing Roster ("Cargo container — Watson", "Megabuilding H8 — apt 117", "Owes 3 weeks"). When set, the player's ID card grows a Housing block under the SIN / Clearance grid. Separate SAVE HOUSING write so an edit there can't clobber TT-coverage + Fixer-rank config.
- **Trauma Team MedScan request button** (Gotto request). New non-emergency First-Aid / Paramedic / Medical Tech consult button below the Panic Signal. Tap it and the GM gets a whispered chat card with your coverage tier and handle. Lets the GM rule narratively on whether the corp doc is willing to fly out for a stabilize-not-evacuate scenario. Only shows for players with TT coverage on file.
- **Screamsheet posts in Lifestyle → NetStatus** (Black-Chrome flavor ask). New GM-only "Publish as Screamsheet" toggle on the social composer. When checked, the post renders in the feed as a yellowed broadsheet card (Georgia serif headline, red category stamp, dashed underline, signoff in italic) instead of the regular feed item. Lets the GM drop styled in-fiction news bulletins without leaving the Agent to make a journal entry.

### Internals

- Five new world settings registered (`ncpdRapSheets`, `cityDirectoryEntries`, `gardenProfiles`, `mapIndicators`, `nightMarketActive`), all JSON-encoded arrays, GM-restricted, hidden from the Configure Settings list. Existing settings untouched.
- The Garden's MESSAGE button reuses the existing custom-contact pipeline: it materializes a contact card with `isPlayer:false` keyed by `garden_<profileId>`, drops the player into the new Messenger thread, and the GM gets a fresh NPC voice to puppet from their side.
- The Night Market tab is gated on `nightMarketActive` — when no drop is live, the tab is hidden and the catalog view is the only mode. Closing a drop in Sys Admin instantly snaps every player back to the catalog mode.
- Map pins are filtered server-side to visible-only before reaching the player view; the GM gets full visibility.
- All new action handlers are GM-only on writes, world-scoped on reads, and bus their state changes through the existing `_queueAgentRender` debounce so they don't multiply renders on rapid edits.

Drop-in over 5.0.3. No migration.


## Beta 5.0.2 — Pop Out! module compatibility (Ryouhi request)

The Agent's Application class already had `popOut: true` and would in principle work with the Pop Out! module (the popular module for moving Foundry windows into a separate browser window — handy for multi-monitor setups), but three `document.activeElement` references in the render path were silently broken when the app's DOM lived in a detached window. The script's top-level `document` is the main page; the agent's elements live in `popoutWindow.document` once popped. Focus checks against the wrong document = always false = restoration logic doesn't fire.

**Fix.** Switched all three call sites to use `element.ownerDocument.activeElement` instead, which resolves to whichever document the agent currently lives in. Now:

- Store-search focus restoration works popped out
- Chat-input focus tracking (`_chatInputHadFocus`) works popped out
- Composer-draft focus capture (the `data-preserve-draft` system) works popped out

No new dependencies — Pop Out! remains an optional module. If you don't use it, nothing changes. If you do, the Agent now behaves correctly when dragged into a second window.

Drop-in over 5.0.1. No migration.

---

## Beta 5.0.1 — Messages hotfix (Gotto Goho playtest round 4)

Eight bugs from the first public-5.0 playtest, all in the Messenger area. Most of these landed because 5.0 was the first time the new group/voice/attachment features met real-table use.

### Bugs

- **Typing indicator showed "Gamemaster is writing" instead of the NPC persona.** The typing socket event was always sending the GM's user name and token even when the GM was in an NPC thread or had a voice override picked in a group. Now the indicator mirrors the same persona resolution the send-message path uses — recipients see the NPC's name and avatar, matching what the actual message will look like.
- **Privacy leak: empty `targetUserIds` still routed NPC messages to players.** Root cause was the 4.8 NPC thread auto-resurrect. `createChatMessage` fires on EVERY client (Foundry syncs the document to all sessions regardless of whisper visibility), so the resurrect path was materialising the NPC contact on every player's device even when the GM had ticked no boxes during creation. Hard gate added: the auto-resurrect now only runs if the current user is actually on the message's whisper list.
- **Multi-PC single-NPC contacts looked private but weren't.** When the GM ticked multiple players during contact creation, all of them received the NPC's messages via the same thread — but the privacy indicator read "ONLY YOU + GM · NPC CHANNEL," giving the wrong impression of a 1-to-1 conversation. New label for multi-recipient NPC threads: `NPC CHANNEL · YOU + <co-recipient names> + GM`. No ambiguity.
- **Custom group threads bled into "Global Net" (party_group_chat) view.** Thread-matching filter had a whisper-based fallback that could accidentally match `pcgroup_*` / `party_group_chat` / `npc_*` messages into 1-to-1 DM threads. Tightened so each thread type uses exact `threadId` match only — no whisper fallback for group/NPC/party views.
- **Players couldn't create groups ("authorization" error).** `confirm-new-group` was calling `setFlag` on other users' customContacts, which non-GMs can't do. Player creation now emits a `groupInviteRelay` socket event; the GM-side socket handler distributes the group to every member's device.
- **Avatar circles distorted by non-square JPGs.** Added a defensive `object-fit: cover` default on every img inside the agent content tree. Inline overrides (NC Mart icons that need `contain`) still win via specificity. Circles stay circular regardless of source-image aspect ratio.
- **Voice switching in multi-NPC groups felt indistinct.** Visual ambiguity made it hard to tell which NPC just spoke. Now every non-self message bubble in a group thread shows the sender name in a stable hashed color (deterministic per persona name), so each NPC voice has its own visually distinct tint. Self-bubble dark-on-cyan styling preserved for legibility.
- **Existing groups appeared in the group-builder candidate list.** When creating a new group, previously-created groups (`pcgroup_*`) showed up alongside individual NPC contacts as if they could be group members. Filter excludes anything tagged `isGroup` / `isCustomGroup` / id starting with `pcgroup_` / `party_group_chat`.

Drop-in over 5.0. No migration.

---

## Beta 5.0 — The public-beta rollup

Consolidating everything from the 4.5 → 4.8.3 patch chain into one release. This is the "if you haven't installed yet, install this" cut. Drop-in over any 4.x build, no migration, no setting wipes. Full 4.x patch history is preserved below for anyone who wants the per-patch context.

### Messages — the biggest area of change

- **Categorized emoji synthesizer.** Tab strip across the top — REACT 😎 · HANDS 🤘 · CYBER 🤖 · COMBAT 🔫 · VIBES 🔥 · NSFW 🍆. ~150 emojis total, all curated for the setting. Icon-only tabs fit on every phone-frame width without horizontal scroll.
- **PC-initiated group threads + GM multi-NPC groups.** Players can start their own group chats with any mix of player handles + NPCs they have in contacts. GMs can do the same across every NPC across every player device. Whispers route to all members + GMs automatically.
- **GM voice switcher in multi-NPC groups.** When a group has ≥2 NPCs, a `VOICE:` dropdown appears in the chat header (GM-only). Default GM (self); pick any NPC member and subsequent messages go out attributed to that NPC. Per-thread state.
- **Attachment template cards.** 📎 button next to the emoji button. Pick PHOTO / VIDEO / AUDIO, type a description, send. Renders as a styled bordered card in the thread with high-contrast readable text on any bubble color. Pure RP — no file upload.
- **Privacy indicators tightened.** No more ambiguity about who's reading: `PARTY CHAT · EVERYONE READS`, `ONLY YOU + recipient + GM`, `ONLY YOU + GM · NPC CHANNEL`, or `GROUP CHAT · N MEMBERS + GM` depending on thread type.
- **Edit Agent ID moved in-phone.** No more Foundry Dialog popping out of the frame — the edit form is a full-screen overlay inside the phone, matching the Add Contact modal style. Stale-data leak between players fixed (each open re-seeds the form to the target's saved overrides).
- **Messenger header surfaces "TO:" + "SPEAKING AS:".** GM-only — see at a glance which player(s) an NPC thread is targeting and which persona you're sending as.
- **NPC thread auto-resurrect.** Player accidentally deletes an NPC contact, GM sends them another message → thread comes back automatically with the right name + avatar. No more "wait, I deleted that, can you re-send?"
- **GM persona override on Social posts.** Optional "Post AS" field for the GM on the social composer. Blank → posts as Gamemaster. Filled → posts as that NPC name.
- **Ghost messenger notifications fixed.** Home-screen badge no longer counts orphan threadIds from deleted contacts.
- **Avatar resolution fixed.** GM-side bubbles now show PC portraits correctly. NPC avatars show on both sides of the conversation symmetrically.
- **Bubble cropping fixed.** Long messages grow the bubble vertically instead of clipping descenders.

### NC Mart

- **GM gates that actually save.** Max Price / Source Filter / Locked Categories now persist via a SAVE GATES button with a "CURRENTLY IN EFFECT" readout. Clear-all button included.
- **Custom-item builder rebuilt.** Form-based inputs (Name / Category with autocomplete / Price / Description / Image with FilePicker) replace the raw JSON textarea. Raw JSON editor still available under a disclosure for power users. Added items show in a removable list below the form.
- **Compendium pack discovery.** Expandable "Available packs in this world" list shows every Item-type pack with a one-click "+ ADD" button that appends to the custom packs setting.
- **Price-tier bucket filter.** Player-side dropdown: Cheap (0-100eb) / Everyday (100-500) / Costly (500-1k) / Premium (1k-5k) / Expensive (5k-10k) / Luxury (10k+). Status line under the strip shows what's actually filtering.
- **Fixer Rank gate.** World-level "items above X eb require Fixer rank ≥Y" setting. Per-player Fixer rank (0–10) lives in Sys Admin → Player Profile. GM bypasses the gate.
- **Search bar reclaimed.** Affordability filter shrunk to a single wallet-icon toggle; search input gets the rest of the row.

### Sys Admin

- **Per-player Application Access tabs.** Folder-style tab strip above the app-lock frame. Each tab scopes the toggles to that player only — nothing else in Sys Admin moves.
- **Per-player Wallet Identity tabs.** Same pattern — pick which wallet view Sys Admin reads/acts on. System Fund (Master) is the default; any player tab surfaces that player's wallet.
- **Trauma Team Coverage + Fixer Rank roster.** Sys Admin → Player Profile lets the GM set both per-player. Coverage tier gates the bio-monitor panic button; Fixer rank gates NC Mart items above the world Fixer Rank threshold.
- **Datapool inject explainer.** In-modal panel explains what a shard is and where it shows up for the player — no more "how do I use this?"
- **GM no longer logs in as the first player's identity.** Defaults to Virtual Wallet on fresh open.
- **All Foundry Dialog popups moved in-phone.** Edit Agent ID, Pay All Players, NPC Bid name prompt, Purge Record, Purge Endpoint — zero `Dialog.confirm` calls remain. The phone owns its own UI.

### Auctions

- **NPC bid path.** GM-only "NPC" button next to BID — record a bid attributed to an off-screen NPC. Settlement aware of NPC winners (skips transfer, manual handoff note).
- **GM-as-winner no longer errors.** Auction settlement correctly skips the eb transfer when the GM wins, marks settled with "(GM win — house keeps it)".
- **Bid input legibility.** No longer crushed to ~10px by the BID + NPC buttons.

### Style / Fixers / Social

- **Style: Night City trend + wardrobe modifiers.** GM sets a world-level trend label + flavor (e.g. "Asia Pop"). Per-actor wardrobe modifier list ("+5 Iconic Jacket", "-3 Visible Cyberware") renders as a breakdown card.
- **Fixer cards: edit + jump-to-messenger.** Pencil icon (GM) pre-fills the add row for in-place editing. Chat icon (everyone) opens the new-message picker pre-filled with the fixer's name.
- **Fixer attitude pills no longer snap to top.** Reasserts scroll across multiple frames so the list holds position no matter how many renders fire.
- **Social feed: newest-first + category filter chips.** ALL chip + one per category — Gig Board, DataPool, Rumor, etc.

### Reliability / performance

- **Render-on-hook throttle.** Coalesces bursts of `createChatMessage` and Simple-Calendar `date-time-change` hooks into ≤4 renders/sec so click handlers stay responsive while the game is unpaused.
- **Listener-leak guards.** Scroll-drag handlers use namespaced jQuery handlers so renders don't stack listeners. Fixes the "mouse is constantly clicking" / "can't type in fields" report.
- **Item Piles compatibility.** Pay Contact no longer routes payments to Item Piles shop actors (drink menus, vault containers, etc.). Filters owned actors by type=character with an Item Piles flag-block exclusion.
- **Holophone permission spam squashed.** Removed Tagger-flag tracking that was firing permission errors on every client when any player opened their phone.
- **Sync holophone animation across clients.** Routed through socket emit with `.locally(true)` so the call effect lands on everyone simultaneously.

### Credits

This release synthesizes feedback from **Gotto Goho**, **Ley**, **CommanderCrunch69**, **Ryouhi**, **kieraboom**, **Aeroshifter**, **BubbleMushroom**, and the rest of the playtest community. Most of what shipped came directly from bug reports and feature asks. Keep them coming.

### Install

Drop-in over any 4.x build. No save migration, no setting wipes, no compat shifts.

---

## Beta 4 — Patch 4.8.3 (GM voice switcher in multi-NPC group chats)

Playtest gap from 4.8: when the GM created a group thread with multiple NPCs, every GM message went out as the GM's own identity — no way to actually speak AS one of the NPCs. Single-NPC threads worked fine (implicit "always that NPC"), but a group with two or more NPCs left the GM voiceless.

**Fix.** When a custom group thread has **2 or more NPC members**, a `VOICE:` dropdown appears in the chat header (GM-only). Options: **GM (self)** (default) plus every NPC in the group. Pick one → subsequent GM messages and attachments in that thread go out attributed to that NPC (correct speaker alias + override name + override avatar on the message flags, so it renders to all clients as if the NPC sent it).

The choice is per-thread and persists while the app is open — switch into one thread, voice resets to GM by default; pick an NPC, send a few lines as them, switch threads, voice for the new thread defaults back to GM. Clean state.

Single-NPC threads and party_group_chat are unchanged — the picker only renders when there are ≥2 distinct NPCs in the group's `members` list.

---

## Beta 4 — Patch 4.8.2 (Emoji tab strip fits)

4.8's category tabs were emoji + uppercase label + padding per tab, which pushed the strip wider than the phone frame and forced horizontal scroll arrows. Reworked: icon-only tabs, equal-width flex split (1/6 each), all 6 categories fit on one row regardless of phone-frame width. Label still surfaces as a hover tooltip. Active tab gets a cyan ring + inset glow so it reads as "selected" at a glance.

---

## Beta 4 — Patch 4.8.1 (Attachment card readability)

Playtest immediately surfaced the issue — the attachment card's cyan tint disappeared into the sent bubble (which is also cyan). Card now uses a near-black backing regardless of which bubble it sits in, with the type label in high-contrast yellow ("AUDIO ATTACHMENT" etc.) and the description body bumped to 0.85rem in pure white. Readable on every bubble color now.

---

## Beta 4 — Patch 4.8 (THE MESSAGES UPGRADE)

The big messaging drop. Five things land at once — all from the recent feedback waves, plus a few that were always going to need doing.

### Emoji synthesizer rebuilt — categorized, ~150 emojis

The cyberpunk-themed flat list became six tabs across the top of the picker: **REACT 😎** (faces, vibes) · **HANDS 🤘** (gestures including the requested 🖕) · **CYBER 🤖** (tech, body mods, netrunner kit) · **COMBAT 🔫** (weapons, hazards, blood) · **VIBES 🔥** (money, party, Night City glow) · **NSFW 🍆** (the requested adult set — eggplant, peach, water droplets, the works). Click a tab → grid swaps to that set. About 150 total, all curated for the setting.

### PC-initiated group threads + GM multi-NPC groups

Players can finally start their own group chats. New 👥 icon in the Contacts header opens a builder modal — name the group, check the participants you want (other player handles, NPCs you've got in your contacts), hit CREATE. The thread shows up under that name in everyone's contacts list and whispers route to all member players plus all GMs.

GMs see the same modal but with the union of every NPC contact across all player devices, so they can pull any mix of players + NPCs into a thread. Custom group threads get a `GROUP CHAT · N MEMBERS + GM` privacy label so there's no ambiguity about who can read.

### NPC thread auto-resurrect

Reported by a playtester: a player deletes an NPC thread (accidentally or on purpose), GM later sends another message to that NPC → message arrives in the chat log but the thread doesn't re-appear in the player's contacts. They had to re-add the NPC manually. Now `createChatMessage` checks if the recipient has the contact, and if not, materialises it from the message's `overrideName` / `overrideAvatar` flags. Notification fires: "Agent: '\<NPC name\>' reconnected to your CitiNet directory." Threads survive accidental deletes.

### Attachment template cards (RP-only)

New 📎 button in the chat composer opens a small picker with **PHOTO** / **VIDEO** / **AUDIO**. Pick a type, type a description, hit SEND — the message renders in the thread as a styled bordered card with the icon and your description, instead of as plain text. Pure RP — no actual file uploaded — but visually distinct so "I send Goro a video of the warehouse out back" actually looks like an attachment in the chat.

### What this all rolls back to

Every backlog item from the Gotto / playtest feedback round that touched messaging is in this drop. Group threads were the biggest ask, attachments the most-requested RP utility, emojis the loudest, and the NPC auto-resurrect was a small but recurring papercut. All shipped.

Drop-in over 4.7.x. No migration, no setting changes.

---

## Beta 4 — Patch 4.7.4 (Emoji additions)

Player request from the last feedback round (the eggplant + middle finger ask). Added both to the emoji synthesizer alongside the existing cyberpunk-themed set. No code changes beyond extending the curated list.

---

## Beta 4 — Patch 4.7.3 (Fixer scroll snap — actual fix)

4.7.2's scroll preservation didn't work. Player confirmed: clicking ALLIED / FRIENDLY / NEUTRAL / HOSTILE still snaps the Fixer list back to the top. Re-investigated.

**Root cause.** The `rep-set-standing` handler was calling `await game.settings.set("npcReputations", ...)` and THEN trying to capture scrollTop. But the settings onChange (registered in main.js) fires `ui.render(true)` synchronously inside that await — so by the time the await resolved and my code ran, the DOM had already been rebuilt and scrollTop reset to 0. I was saving 0 and "restoring" 0 four times.

**Fix.**

1. **Capture scrollTop BEFORE the await**, not after. Pin it directly into `_scrollPositions['.rep-view']` so the existing render-lifecycle restore in `activateListeners` can read it on every render that fires.
2. **Aggressive reassert loop:** before kicking off the settings save, start a `requestAnimationFrame` loop that reasserts the pinned scrollTop every frame for ~400ms. Doesn't matter how many renders fire in the gap — every frame, the loop checks if scrollTop drifted and snaps it back. Stops the moment scroll is stable.
3. **Render after the save** is still explicit, but now harmless — the reassert loop catches whatever renders happen.

Per the user's "never happens again" directive, the reassert pattern is deliberately overkill: it doesn't matter what renders or how many, the scroll holds.

---

## Beta 4 — Patch 4.7.2 (Two Fixer/ID bugs)

Two small but annoying ones from playtest:

- **Fixer attitude pill click was snapping the list back to the top.** Clicking ALLIED / FRIENDLY / NEUTRAL / HOSTILE on a fixer card triggered a render and Foundry's post-render focus pass reset `scrollTop`. Same class of bug as the Sys Admin tab snap-back from 4.4. Applied the same scroll-preservation pattern (capture before render, restore across rAF + 0ms + 50ms + 150ms timers).
- **Edit Agent ID stale-data leak between players (Gotto).** GM opens edit on player A, types stuff, saves. GM opens edit on player B → form shows A's values until the app is fully closed and reopened. Root cause: the form fields use `data-preserve-draft`, which stashes typed values in `_composerDrafts` so a stray re-render doesn't blow away the GM's work. But this preservation was applying across different EDIT TARGETS too, not just across re-renders of the same edit session. Fix: opening edit now **re-seeds the drafts to the new target's current saved overrides** before render. Saving or cancelling **scrubs the drafts** so the next open starts clean. Each player's edit form now shows that player's data, always.

### Known issue (deferred to 4.8)

- If a player deletes an NPC contact thread and the GM later sends another message to that NPC, the player's contact doesn't auto-recreate — they have to add it back manually. Worth noting per player report; queued for a proper auto-resurrect-on-incoming-message fix.

---

## Beta 4 — Patch 4.7.1 (Urgent hotfix: clicks dead while unpaused)

**Hotfix for 4.7.** Player report: after installing 4.7, the Agent UI was constantly refreshing and clicks were unregistered — but only when the game was unpaused. Reproduced on a Simple Calendar setup; same fingerprint as the kieraboom render-thrash from 4.4 but with a different trigger.

**Root cause — two interacting paths:**

1. The 4.7 ghost-notification cleanup called `setFlag("unreads", ...)` from inside `getData` whenever it detected an orphan threadId. `setFlag` is async and fires the `updateUser` hook on completion, which can trigger more renders. While paused, this self-terminated harmlessly; once unpaused with Simple Calendar emitting `date-time-change` every in-game second, every SC tick triggered a render, which triggered a setFlag, which triggered an updateUser, which triggered another render — render loop.
2. The 4.7 `_queueAgentRender` rAF coalesce wasn't aggressive enough — at 60 fps, even one render per frame saturates the click-event budget. A click on a button got its `mousedown` registered, then the DOM was replaced by the next render before `mouseup` could fire, so the click never completed.

**Fixes:**

- **Removed the in-render setFlag.** Orphan unreads stay in the flag (invisible to the user — the display filter already excludes them from the badge). Actual flag cleanup still runs explicitly on the contact-delete path.
- **Render throttle bumped from rAF (~60/s) to leading+trailing with a 250ms floor (~4/s).** Click handlers now have a stable DOM between renders. Clock still updates promptly — 4 ticks per second is below human-perceivable lag for a wall clock.
- **Routed the Simple Calendar `date-time-change` hook through the throttle** instead of calling `ui.render(true)` directly. Same for `userConnected`.

No new features, no behavior changes outside the loop fix. Drop-in over 4.7.

---

## Beta 4 — Patch 4.7 (Community feedback round 3)

Big follow-up driven by **Gotto Goho**, **BubbleMushroom**, and **kieraboom**. Four bugs, eight features, all rolled together.

### Bugs

- **Ghost messenger notifications.** Gotto reported a red "4" stuck on the messenger app icon with no visible conversation to clear it. Root cause: the home-screen badge summed `Object.values(unreads)` from a flag keyed by threadId — when a contact (or one-off NPC thread) was deleted, its unread count was left orphaned in the flag forever. Fixed by filtering unreads against the current contacts list before summing, AND opportunistically garbage-collecting orphan keys when a render notices them. Deleting a contact now also explicitly clears its unread entry.
- **GM sees generic tokens for PCs in chat (Gotto).** The 4.5 fix for PC avatars used `User#character`, which is Foundry's user-management "Assigned Actor" field. Most groups never set it — they switch into their PC via the in-phone identity switcher instead. So the avatar lookup fell through to `user.avatar` (also blank) and finally the mystery-man default. Now the resolver also checks the sender's `lastActorUuid` AgentDevice flag and uses that actor's portrait as a fallback. Fallback order: NPC override → `user.character.img` → in-app PC identity → user profile pic → default icon.
- **Social posts always showed "Gamemaster".** No GM persona override existed for the social composer (the messenger had it, social didn't). Added an optional "Post AS" field that only appears for the GM — blank posts as Gamemaster, filled posts as that NPC name.
- **App "kept refreshing" (BubbleMushroom).** The `createChatMessage` hook was calling `app.render(true)` synchronously on every Agent message. Bulk operations (auction settlements, blast messages, NPC switchboard pushes) could land N messages in the same tick, each one triggering a full re-render, and the post-render path sometimes triggered more messages → visible refresh loop after enough chained activity. Coalesced all render requests through a single `requestAnimationFrame` tick so a burst of N messages costs one render.

### Privacy indicator wording tightened (Gotto)

The previous wording — "PRIVATE · X only (GMs can read)" — left players unsure whether OTHER players could read messages or just the recipient + GM. Now reads:

- Party group chat → **PARTY CHAT · EVERYONE READS**
- 1-1 player thread → **ONLY YOU + \<recipient\> + GM**
- NPC thread → **ONLY YOU + GM · NPC CHANNEL**

No more ambiguity.

### 4.7 in-flight fixes (post first-pass test)

- **NC Mart custom-item editor was a raw JSON textarea — hostile and error-prone.** Internal QA hit it; a Reddit user reported the same friction ("how do I add custom items? Core+Custom is on but nothing shows up"). Replaced with a form-based builder: separate inputs for Name / Category (with datalist suggestions: Weapons, Ammo, Armor, Clothing, Cyberware, Drugs, Gear, Vehicle, Pet, Program) / Price / Description / Image path, plus a FilePicker button for the image. ADD ITEM saves immediately to the backing setting, busts the catalog cache, and lists each added item below with one-click remove. Raw JSON editor is still available, hidden behind a `<details>` disclosure for power users.
- **Custom Compendium Packs section: added a pack-discovery list.** Compendium packs from world or other modules weren't loading because the GM didn't know the exact pack IDs to type. Added an expandable "Available packs in this world (N)" section showing every Item-type pack with label + ID + a one-click "+ ADD" button that appends the ID to the custom packs setting and refreshes the catalog. Solves the Reddit report — items from imported packs now show up the moment a pack is added.


- **NC Mart price-tier looked like it did nothing.** Original implementation was a max-cap filter ("≤ 1000 eb") which, on a category where every item was cheap (e.g. Drugs at 10-50eb), filtered out zero items regardless of which tier you picked — read as "the dropdown doesn't work." Rebuilt as proper price BUCKETS — selecting "500–1k eb (Costly)" now actually hides cheap items and shows only items in that range. Added a SHOWING X · \<tier label\> status line under the dropdown so the user can see at a glance what's filtering.
- **Affordability wallet icon "did nothing".** Same root cause — for a GM viewing VirtualWallet (unlimited eb), every item passes the affordability check, so toggling looked identical. The toggle was working all along (icon background flips cyan), but with no visible result the GM read it as broken. Status line now shows "AFFORDABLE ONLY (your balance: Xeb)" when the filter is on, making the active state unambiguous.
- **Social composer placeholder was being truncated to "Broadcast something t…".** Phone-frame width forced select + input + POST button to compete for ~280px. Restructured into stacked rows: row 1 is category select + text input (input gets all remaining space), row 2 (GM-only) is the persona override, row 3 is the full-width POST button. No more truncation on phone-frame width.
- **Fixer chat icon now opens a new-message picker (Gotto).** First pass dropped the user directly into a 1-1 thread with that fixer. Expected behavior: act like creating a new message — open the ADD CONTACT modal pre-filled with the fixer's name so the user (especially the GM) can pick which player device(s) the contact targets before the thread is created. Now does exactly that.

### Features

- **Sys Admin: Wallet Identity tabs (Gotto).** GM can now swap the active wallet view into any player's identity directly from Sys Admin (or back to System Fund). Mirrors the existing Application Access tab layout. The previously-orphaned `selectedAdminActorUuid` state finally has a UI control.
- **Trauma Team coverage gating (Gotto).** The bio-monitor "TRANSMIT PANIC SIGNAL" button now only appears for players the GM has marked as Trauma Team clients. Everyone else sees a dimmed "No Trauma Team Coverage — call REO Meatwagon and hope for the best" panel. GM sets each player's coverage tier (Bronze / Silver / Gold / Platinum / custom string) in Sys Admin → Player Profile.
- **NC Mart price-tier filter + fixer-rank gate (Gotto).** Players can now filter the catalog by price bucket (≤100 / ≤500 / ≤1k / ≤5k / ≤10k / all). Separately, a world-level "Fixer Rank Gate" pairs a price threshold with a minimum Fixer rank — items above the threshold are hidden from players below the rank. Each player's Fixer rank (0–10) is set in Sys Admin → Player Profile. GM bypasses the gate.
- **Style: Night City trend + wardrobe modifiers (Gotto).** GM-settable world-level trend label (e.g. "Asia Pop", "Nomad Leathers") with optional flavor line — shows on every player's Style screen. Per-actor wardrobe modifier list (label + signed value) renders as a small breakdown card under the score (e.g. "+5 Iconic Jacket", "-3 Visible Cyberware").
- **Fixer tab: edit-in-place + jump-to-messenger (Gotto).** Each fixer card now has a pencil icon (GM-only) that pre-fills the add row with the existing values for in-place editing, and a chat-bubble icon (everyone) that materialises a Messenger contact for that fixer and jumps straight to the thread.
- **Social feed: single-category filter (Gotto).** Filter chips at the top of the feed — click ALL to see everything, or click any category (Gig Board, DataPool, Rumor, etc.) to scope to that one. Categories list is built dynamically from posts that exist.
- **Datapool inject: in-modal explainer (Gotto).** Added a one-paragraph "What this does" panel inside the Data Injection modal so first-time GMs immediately understand what a shard is and where it shows up.

---

## Beta 4 — Patch 4.6 (Immersion polish + auction fix)

Hot follow-up to 4.5. Every Foundry Dialog popup is now an in-phone modal, the Add Contact row finally fits the frame, and the GM can win their own auctions without the eb deduction blowing up.

### Every Foundry Dialog popup moved in-phone
- **Edit Agent ID**, **Pay All Players**, **NPC Bid name prompt**, **Purge Record** (chat message), and **Purge Endpoint** (contact delete) no longer pop out of the phone — they all render as full-screen overlays inside the agent screen itself, matching the ADD CONTACT / MANUAL LEDGER modal style. Flag-driven (`showIdEditModal`, `showPayAllModal`, `showNpcBidModal`, generic `_pendingConfirm`), markup in `agent-ui.hbs`, drafts preserved across re-renders via `data-preserve-draft`. Net result: zero `new Dialog(...)` and zero `Dialog.confirm(...)` calls left in the module. Foundry stops barging in over the phone frame.
- The generic confirm modal supports red/cyan/gold accent themes and a custom confirm button label — future "are you sure?" prompts in the module reuse this single in-phone modal instead of pulling Foundry's again.

### Add Contact: BROWSE button overflowing the frame
- **Avatar field crushed, BROWSE button overflowing into the phone bezel.** Same root cause as every other "button eats the row" bug in this module — Foundry's `form button { display: block; width: 100% }` was overriding the inline `flex-shrink: 0`. Pinned the BROWSE button with `flex: 0 0 auto !important; width: auto !important; display: inline-flex !important; white-space: nowrap;`, and the Avatar input with `flex: 1 1 auto !important; min-width: 0 !important; box-sizing: border-box;` so it can shrink without forcing the row wider than the modal.

### Auction settlement: GM-as-winner no longer fails
- **"Payment failed — winner may lack funds" when the GM was the winning bidder.** Root cause: settlement was calling `_getIdentity(GM)` then `_executeTransfer` against whatever owned actor that resolved to — usually a 0-balance test NPC, occasionally an Item Piles shop, and the transfer rightly bounced. The GM runs the house and shouldn't be paying themselves anyway. Now: GM winners are treated the same as NPC winners — skip the eb deduction, mark settled, surface a "(GM win — house keeps it)" note in the settlement notification. Player winners still get debited as normal.

### Agent ID edit dialog: input sizing
- **"Registered" was rendering with its bottom half cut off** in the SIN Status dropdown. Dialog inputs had `padding:6px` and no explicit height, so Foundry's default form styling clipped the descenders. Bumped all inputs in the form to `height: 36px; line-height: normal; font-size: 0.85rem; padding: 8px` so the full text is visible on every field. (Carried into the new in-phone modal too.)

---

## Beta 4 — Patch 4.5 (Community feedback round 2)

Big drop driven by community reports. Credits: **Gotto Goho** (GM identity / messenger TO indicator / social feed sort / auction NPC bidders), **Ley** (text-box sizing / privacy indicators), **CommanderCrunch69** (NC Mart Save button / NPC + PC avatars / Pay Contact filter), **Ryouhi** (Item Piles identity bug), **kieraboom** (listener-leak guard), **Aeroshifter** (Agent ID display name).

### NC Mart GM gates: SAVE button + "Currently in effect" display
- **Max Price / Source Filter / Locked Categories now actually save.** CommanderCrunch69 noticed expensive items still showing in NC Mart even after setting a Max Price cap — root cause was the GM Controls inputs had no commit path, so edits never wrote back to the settings. Added a **SAVE GATES** button (and a **CLEAR** button to reset all three at once) plus a "Currently in effect" readout panel showing what's actually saved server-side. Pattern now matches the blacklist's ADD-and-display flow.

### Agent ID: separate Display Name + Display Handle
- **Aeroshifter request** (r/cyberpunkred): netrunners want to keep their handle as the public-facing identity that other players see in contacts and chat, while showing their character's real name on their own Agent ID's "Global Registry" view. Added a `displayName` field to the GM-side ID edit dialog (alongside the existing handle). The OWNER's own ID card uses `displayName → actor name → user name` for the big name on the card; OTHER players still see the handle in contacts / messenger / group chat / everywhere else. GM's view of the player's card mirrors the owner's view so the GM sees what the player sees.

### Pay Contact no longer routes payments to Item Piles shops
- **Item Piles drink-menus and other shop actors no longer hijack identity.** Ryouhi caught that Pay Contact was sending payment to the wrong character — players with Item Piles shop ownership (e.g., a "drink menu" character they bought from at a bar) got the shop targeted instead of their PC. Root cause: `_getIdentity` fallback picked the FIRST owned actor with no filtering, and Item Piles managed actors are often returned first by Foundry's actor index.
- Fix: the fallback now filters owned actors by `type === "character"` AND excludes any actor with an `item-piles` flag block (covers Item Piles vaults, merchants, containers, drink menus, etc.). If multiple PCs are still in scope, picks the most-recently-modified one as a sensible default. Players with multiple PCs can still switch explicitly via the multi-character dropdown.

### Defensive listener-leak guards (kieraboom "constantly clicking" report)
- Tightened the scroll-drag handlers in chat / contact / transaction lists so jQuery listeners use `.off()` then `.on()` with a namespace (`.agentScrollDrag`). On most renders the DOM is fresh and this didn't matter, but in the rare case where a stray render fires during an active scroll-drag the handlers could stack — and after enough stacks the cumulative `mousemove` events ate input and stole focus from fields, which read as "the mouse is constantly clicking" / "can't type in fields." Off-before-on prevents accumulation regardless of render edge cases. Window-level listeners (map pan, window drag) already had this guard from beta 4.

### Avatars actually show now (NPCs on GM side + PCs everywhere)
- **GM and player see the same conversation.** CommanderCrunch69 caught that NPC contact avatars only rendered on player-side message bubbles, never on the GM's view. Root cause: GM-as-NPC messages have `m.author === game.user`, so they hit `isSelf: true`, and the template only renders avatars on non-self bubbles. GM saw their NPC bubbles on the right with no avatar; player saw the same messages on the left with the NPC avatar.
- Fix: when a message has `overrideAvatar` set (roleplay-as-NPC), treat it as "from the NPC" for layout — left-aligned, NPC avatar next to the bubble, NPC name as sender. Both sides now render identically. Persona-style framing. Delete permission still tracks the real author.
- **PC avatars now show in group chat + PC↔NPC threads.** Same report — players' avatars weren't appearing. Root cause: fallback used `User.avatar` (Foundry profile pic) which most players never set, so all bubbles fell to the default mystery-man icon. Now prefers the assigned **character's portrait** (`actor.img`) — falls back through NPC override → character portrait → user profile pic → default. Applied to message bubbles, the group-participants header avatar stack, AND the typing indicator avatar.

### Auction bid input legibility
- **The bid amount input was being crushed.** On the auction detail screen, the input field was getting flex-squeezed to ~10px wide because BID + NPC buttons (both with icon + text labels) ate the row on the phone-frame width. Restructured to put input + BID on the main row (input forced to `min-width: 80px`), and moved the GM-only NPC button to its own row underneath so it can never compress the bid input again.

### NC Mart search bar reclaimed the row
- **Search input no longer crushed by the affordability filter button.** The "ALL / CAN BUY" toggle was eating ~70% of the search-row width because Foundry's `form button` rule was forcing it full-width and the label was padded. Filter is now a single 32px wallet-icon toggle (cyan when active, dim when off) pinned to natural size; search field flex-shares the rest of the row. Same behaviour, less than a quarter of the footprint.

### Holophone permission spam fixed
- **"User X lacks permission to update Token Y" no longer spams every client whenever any player opens their phone.** Patch 3.3's multi-client sync had every client call `Tagger.addTags` on the originator's token, which writes a token flag — and non-owner clients can't write flags on tokens they don't own. Each phone open produced 3+ permission-error toasts on every other player's screen plus the GM's. Replaced the Tagger-flag tracking with a local `globalThis.__AgentDeviceCalling` Set keyed by token id; each client now tracks its own animation state without persisting anything. Tagger is no longer a required module — only Sequencer + JB2A.

### Scroll preservation hardened
- **Tab clicks and toggle clicks in Sys Admin no longer snap to top.** The patch 3.3 generic scroll preserver worked for most cases but missed some timing edge cases where Foundry's post-render focus pass reset scroll. Stacked targeted captures + 4 restore passes (sync, rAF, setTimeout 50ms, setTimeout 150ms) on both `admin-tab-select` and `toggle-app-lock` handlers. Holds scroll regardless of what else fires after render.

### Gotto Goho-reported
- **GM no longer logs in as the first player's identity.** Auto-default on initial open was silently setting the GM's "Active System Target" to whatever the first listed player's character was — which meant the GM's own wallet view showed the first player's balance, not theirs. Now defaults to GM Virtual Wallet; GM explicitly switches into a player when they need to act as one.
- **Messenger header now shows "TO:" alongside "SPEAKING AS:" (GM-only, NPC threads).** Previously you only saw which persona you were speaking AS — recipients were invisible unless you'd renamed the thread by hand. Now the header reads "SPEAKING AS: \<persona\>" + "TO: \<player handles\>" so you can tell at a glance which player the conversation is with.
- **Social feed is newest-first.** Was bottom-up; now sorted by timestamp descending like every other social platform.
- **Auction: NPC bid path.** GM-only "NPC" button next to the BID button on an auction detail. Click it → prompt for an NPC name → bid lands attributed to that NPC ("Mr. Suzuki +50eb on…"). Lets the GM run off-screen bidders during a live auction.
  - **Settlement aware of NPC winners.** When an NPC ends up winning an auction, the settlement path no longer errors out trying to find a user record. Instead it skips the eb transfer (the GM handles off-screen NPC bookkeeping however they like), marks the auction settled, and surfaces a "(NPC — manual handoff)" note in the GM's settlement notification.

### Sys Admin Application Access rework (user directive)
- **Folder-style tabs sit on top of the Application Access frame.** Tabs are now scoped to **Application Access only** — they do not affect GM identity, wallet view, transfer source, NC Mart settings, or anything else in Sys Admin. First tab is "GM (self)" (the GM's own app-lock flags); each non-GM user gets their own tab. Clicking a tab switches just the toggle list below to that player. The active tab visually joins the frame underneath (file-folder look). The yellow "AFFECTING:" banner from patch 3 is gone — the active tab IS the indicator.

### Ley-reported
- **Text boxes tiny + filter buttons huge: generic fix.** Same class of bug as the NC Mart search input — the global `width: 100% !important` rule made inputs greedy while buttons stayed at natural width, so inputs got crushed to nothing under flex shrink. Added a generic `.agent-flex-row` layout helper for future rows, and explicitly fixed the social composer.
- **Social composer dropdown sized properly.** The category dropdown was getting flex-squeezed; pinned to 110px so the label is always readable. The input next to it now uses flex-share instead of `width: 100%`.
- **Message privacy indicator.** Players were unclear whether their messages were private or visible to the whole party. The messenger header now shows one of three modes under the contact name:
  - **VISIBLE TO PARTY** (yellow, party group chat)
  - **PRIVATE · \<recipient\> only (GMs can read)** (cyan lock, 1-1 DM)
  - **PRIVATE · NPC channel (GMs can read)** (cyan lock, NPC thread)
- Underlying whisper logic was already correct (player→player whispers go to recipient + sender + GMs only, just like Foundry's normal DM behaviour) — this is purely a clarity fix.

### Deferred to next patch
- Rent/housing status display (Gotto Goho idea) — feature, not bug, lower priority.

---

## Beta 4 — Patch 3.5 (Fixers row overflow)

- **Fixers / Contacts: + button was running off the right edge of the phone frame.** Inputs shrunk to fit truncated placeholders ("NPC Na", "Factio") and the button got flex-stretched into a huge empty slab ending past the chassis. Root cause: the row's children were getting cascading flex-grow from somewhere, and the row itself had no width cap or `box-sizing: border-box`. Fix: locked the row to `width: 100%; box-sizing: border-box; min-width: 0`, hard-pinned the button to `flex: 0 0 auto; width: 36px`, and gave both inputs `flex: 1 1 0; min-width: 0` so they share the remaining space evenly. Also added `overflow-x: hidden` on `.rep-view` so any future overflow gets clipped instead of pushing the phone shell.

---

## Beta 4 — Patch 3.4 (Scroll-position preservation)

- **Toggling items in Sys Admin (and similar lists) no longer jumps to the top.** `render(true)` rebuilds the DOM and `scrollTop` resets to 0; that's why every app-lock toggle, GM-controls edit, custom-item remove, etc. snapped the view back. Added a generic scroll-position preserver that captures `scrollTop` of `.admin-console`, `.rep-view`, `.style-view`, `.contact-list`, `.feed-list`, and `.transaction-list` before each render and restores it after. Scoped to the current view so a stored position from Sys Admin can't be applied to Fixers, etc.

---

## Beta 4 — Patch 3.3 (Holophone multi-client sync)

Ryouhi's follow-up: animation worked on the player's own client but the GM saw a static or broken animation. Two compounding causes, both fixed:

- **Cross-client asset mismatch.** The originating client probed `Sequencer.Database.entryExists()` and picked the best JB2A asset *they* had. Sequencer then broadcast that exact filename to other clients — if the GM had JB2A Free but the player had JB2A Patreon, the GM's Sequencer couldn't render the Patreon asset and silently dropped that layer. Fix: instead of relying on Sequencer's auto-broadcast, the originator now **emits a socket event with the token id**, and every connected client runs its own local sequence using **its own asset probe**. Each client picks the JB2A variant available to them.
- **Rapid-fire socket throttling.** The symbol-scroll loop fired ~100 effects per second. Broadcast under that load got dropped or arrived staggered, producing the "slow" symbol cascade on remote clients. Loop interval slowed from 10ms to 200ms (5 chars/sec) — still visually a cascade, but stable under real network conditions. Every effect in the sequence now calls `.locally(true)` since each client handles its own copy via socket — no more N×N broadcast spam.
- **Cleanup symmetry.** Close also emits a socket stop event so every client tears down its local effects on the right token.
- **Default `enableCallAnimation` setting is now ON** (was off — caught people unaware that the feature exists).

---

## Beta 4 — Patch 3.2 (Holophone JB2A fallback + NC Mart GM controls + search fix)

### Holophone
- **Default is now ON.** `enableCallAnimation` ships at `true` — was throwing people off when nothing happened after install. New worlds get it active out of the box.
- **JB2A asset-missing toast fixed.** Ryouhi hit `Sequencer | Effect | Play - Could not find file: jb2a.token_stage.round.red.01.05`. That `token_stage.round.red` variant is JB2A Patreon-only; JB2A Free doesn't have it. Each effect file is now probed against `Sequencer.Database.entryExists()` before being added to the chain, with a fallback ladder (`token_stage.round.red` → `token_border_circle.static.red` → `markers.circle_of_stars.red` → `energy_field.02.below.red`). If none of those exist either, the ring layer is skipped and the rest of the animation still plays (phone icon + "CALL" label + eye glints).

### NC Mart
- **Search input layout fixed.** A global `.AgentDevice .agent-content input[type="text"] { width: 100% !important }` rule was crushing the search field down to ~30px next to the CAN BUY button. Search input now uses `.datapool-input` (which is excluded from the global rule) plus inline overrides, so it gets the proper flex stretch.
- **GM controls panel** in Sys Admin → NC Mart:
  - **Max price cap** — hide anything priced above N eb. `0` = no cap. Useful for "nothing over 500 tonight" rules.
  - **Source filter** — choose between *all*, *core/compendium only*, or *custom items only*.
  - **Locked categories** — comma-separated category names to hide entirely from the tab bar.
  - **Item blacklist** — paste a UUID or name, click ADD, item disappears from the shop. Chip-style removal. Backed by a world setting.
- **Server-side checkout enforcement.** Even if a player has a stale cached catalog or a hand-crafted socket payload, the GM client re-checks the price cap and blacklist against each cart item before processing the purchase. Cap-violating or blacklisted items error out with a clear notification.

---

## Beta 4 — Patch 3.1 (Holophone macro full port)

Ryouhi tested the patch 3 holophone integration and it didn't engage — my first pass was a tiny subset of the macro (one effect, fired only from the boot timer). Fixed:

- **Full macro ported, not the abridged version.** All five effect layers now fire: phone icon (imgur), red `jb2a.token_stage` ring, "CALL" text label, and two orange `jb2a.twinkling_stars` eye-glints with the same hue/blur filters as Eskie's original. The symbol-scroll while-loop is also wired up — random unicode characters trail off the phone icon while the Agent is open, exactly like the macro.
- **Trigger moved from boot timer to render lifecycle.** Old version only kicked off after the boot screen finished — if the app was reopened without going through boot, nothing happened. Now hooked into `_render`'s closed→open transition, so the animation fires every time the Agent actually appears on screen.
- **Token resolution falls back through three paths.** Controlled token → assigned-character's token on the active scene → single owned token. Players rarely have their token selected when they pop the phone, so the fallback path matters.
- **Cleanup is symmetrical.** Closing the Agent removes the `AgentCalling` tag (which exits the while loop on its next iteration) and explicitly ends both `AgentCall` and `AgentCallText` persisted effects. Safety cap on the while loop at ~60min worth of iterations so a stuck tag can't loop forever.

---

## Beta 4 — Patch 3 (Community feedback round)

Triggered by CommanderCrunch69's playtest report + Ryouhi's holophone-macro request, plus a sweep of the remaining items on my own punch list.

### CommanderCrunch69-reported
- **NPC contact visibility leak fixed.** Targeted NPC contacts sometimes appeared for players who weren't targeted. Two changes:
  - `_getContacts` now treats `targetUserIds` as authoritative at read time — if the contact has a target list and the current user isn't on it (and isn't the contact owner), it's filtered out even if a stale copy is still in their flag.
  - On contact creation, GM also actively purges the contact id from any non-target user's flag (belt-and-suspenders against legacy state).
- **Forge VTT-compatible avatar entry.** Replaced the raw "paste a path" input with a BROWSE button that launches Foundry's FilePicker. Resolves paths correctly across Forge, The Bazaar, and local servers — no more guessing where the file path originates from.
- **NC Mart: one-click item removal.** Admin panel now shows a parsed list of custom store items with a × button next to each. JSON textarea still works for bulk edits.
- **Fixers / Contacts sort.** Added a SORT dropdown above the rep list: Default order, A→Z, By attitude (allied → friendly → neutral → hostile), By faction.
- **Style rating: tooltip.** Tap the (i) icon on the Style app header to see the formula: clothing/armor × 15 (cap 60) + cyberware × 10 (cap 30) + fixer rep bonus (cap 10), with the tier breakpoints (ICONIC / EDGERUNNER / STREETWISE / BASIC / GONK).

### Ryouhi-requested
- **Optional holophone call animation (Sequencer + JB2A + Tagger).** New GM setting "Holophone Call Animation" — when enabled, a calling VFX (red call ring) appears on the controlled token while the Agent device is open and clears when the device closes. Off by default; silently no-ops if any of the three modules isn't installed. Adapted from EskieMoh's macro.

### Hardening & polish from my punch list
- **Auction bidder identity check.** Server-side handler now rejects bid payloads where `bidderId` ≠ `requesterId` or the claimed bidder isn't an active user. Stops trivial impersonation.
- **All transfers serialized.** `_executeTransfer` is now wrapped in a global promise lock — VirtualWallet (User flags) and non-CPR actor paths are read-modify-write and could lose balance on concurrent calls. Queued now.
- **Transfer memo length capped at 200 chars** before chat-HTML interpolation, so a 50KB memo can't bloat every settlement card.
- **Transfer dedup tracker is now self-pruning.** Was a global `Set` that grew forever; now a `Map<requestId, timestamp>` with a 5-minute TTL.
- **XSS audit completed on remaining chat cards.** Panic Button and NC Mart Receipt cards were still interpolating `game.user.name`, `actor.name`, and `requesterName` raw; now escaped through a shared `_agentEscHTML` helper.
- **Drafts are scoped per-view.** Switching to a different auction or contact no longer carries the previous view's draft into the new input (drafts are dropped when the view key changes).
- **NC Mart category slider snap-back fixed.** After a re-render the category bar's horizontal scroll reset, sometimes hiding the active tab. The active category is now scrolled into view after every render.
- **Sysadmin "Application Access" target clarity.** Added an "AFFECTING: <player name>" banner above the app-lock toggles so the GM can't mistakenly toggle a lock on the wrong player.

---

## Beta 4 — Patch 2 round 3 (Live playtest follow-up)

### Messenger fixes (round 3)
- **Sender label on own bubbles is now readable.** `.chat-sender-name` is cyan, which on the cyan-gradient SENT bubble was nearly invisible (the "GAMEMASTER (AGENT) (YOU)" label disappeared into the background). Added a specific override: dark text + soft white text-shadow for sent bubbles only. Received bubbles keep their cyan-on-dark label unchanged.
- **Bubbles now grow with content.** Round-2 used `width: fit-content` for intrinsic sizing, but in some flex-row contexts that prevented the bubble from expanding vertically when content wrapped — tall messages got cropped before reaching their final height. Switched to plain `display: inline-block` + `max-width: 78%`, forced `height: auto !important`, `max-height: none !important`, and locked `flex-shrink: 0` / `flex-grow: 0` so the row-flex parent can't squeeze the bubble. Same belt-and-suspenders applied to `.chat-row` and its inner div.
- **`.chat-window` bottom padding bumped 180 → 200px** to give tall multi-line bubbles a bit more clearance above the input area.

---

## Beta 4 — Patch 2 (Playtest Bug Sweep)

### Playtester-reported (beta4)
- **Social post no longer wipes other clients' drafts.** Posting broadcast a setting change that triggered a full re-render on every connected client, destroying any in-progress input. Added a generic `[data-preserve-draft]` system so tagged inputs (Social composer, admin feed, auction bid, auction creation) survive cross-client re-renders.
- **Messenger bubble cropping/positioning rewritten.** First pass changed `overflow:hidden`→`visible` and added `min-width:0` but the bottom of long messages was still slipping behind the input area and bubbles drifted off-center because of the asymmetric `margin-left/right: 20%`. Patch2:
  - Bubbles now use `width: fit-content` + `max-width: 78%` and rely on `justify-content` for left/right placement — no more 20% margins fighting the flex layout.
  - `.chat-row` gets `flex-shrink: 0` so the row can't be squeezed shorter than its bubble's intrinsic height.
  - `.chat-window` bottom padding bumped to 180px (max input height + offset + buffer).
  - Auto-scroll now runs inside a double `requestAnimationFrame` so it reads `scrollHeight` *after* layout, instead of before the new bubbles have measured.
- **Group chat participant header + per-message attribution.** Header on `party_group_chat` renders an avatar stack + comma-joined label, live-refreshed on `userConnected`. Additionally, every first-of-run bubble in a group chat now shows the sender label (your own messages get a `(you)` suffix) so the party can attribute who said what at a glance. Typing indicator now shows the typer's name next to the dots.

### Robustness
- **Auction bids serialized.** Concurrent bids were read-modify-write on a JSON setting; bursts could lose increments. Bids now chain through a single Promise lock so each one sees the post-save state.
- **Bid amount coerced to Number.** Old `||` fallback let string bids through (`100 + "50" = "10050"`). Now uses `Number(...)` + `Number.isFinite`.
- **Transfer dedup.** Player transfers go via socket AND a chat-fallback AUTHORIZE button. Both paths now share a `requestId` set so the transfer can't fire twice (also blocks two GMs from double-authorizing the same card).
- **Social post integrity.** Server-side handler now validates text length, whitelists fields, and stamps `authorId` / `authorName` from a verified active user instead of trusting the client payload.

### Security
- **XSS hardening on chat cards.** The CITY BANK settlement card, the AGENT BANK REQUEST card, and the transfer-trace whisper all interpolated user-controlled strings (memo, actor names, display names) into HTML without escaping. Now run through `foundry.utils.escapeHTML`. Amounts coerced to `Number()` before interpolation.

### Hygiene
- **Listener cleanup.** Added `_storeSearchDebounce` to `close()` cleanup so closing/reopening the app no longer leaves an orphaned debounce timer.
- **Removed dead code.** A pre-existing accidental duplicate of the auction socket handler (introduced during a corrupted edit session) has been removed.
- **Restored truncated files.** `scripts/agent-app.js` and `scripts/main.js` were truncated mid-statement on disk — would have prevented the module from loading at all. Tails restored from `AgentDevice-beta4.zip` and verified.

---

## Beta 4 — Auction Overhaul + Multiplayer Fix

**Multiplayer socket fix** — module config was missing `socket: true`, which meant Foundry was silently dropping every player→GM message. Bids, chat, transfers, typing indicators — none of it was reaching the GM. This was likely behind most "works for GM but not players" issues in beta 3. Fixed.

### Black Market / Auction House
- Bids are now increments — bid of 15 on a 100eb item makes it 115eb
- GM "END NOW" button to close auctions early
- Auction duration supports minutes (not just hours) for quick mid-session auctions
- Timer shows minutes + seconds for auctions under 1 hour
- Fixed bid input text clipping and LIST button overflowing phone frame
- Optimistic UI — bids update instantly instead of waiting for settings save

### Wallet / Transfers
- P2P payments working — PAY CONTACT and BILL CONTACT from wallet
- Transfers write to character sheet ledger (Wealth tab)
- GM pay-all-players edge cases cleaned up

### Fixers / Contacts
- Fixed NPC Name and Faction input boxes collapsing (CSS rule split from auction inputs)

### Under the Hood
- Removed orphan `.app-header h3` style leak
- Consolidated duplicate `.agent-app-view` CSS rules
- Better error handling on bid validation and fund checks

---

## Beta 3 — NC Mart, Style Checker, Social Feed

Initial public beta. Shopping, style system, social media feed, messaging, wallet, data pool.

---

## Beta 2 — Internal Testing

Messaging, wallet, data pool, base UI.

---

## Beta 1 — Proof of Concept

Phone shell + navigation.

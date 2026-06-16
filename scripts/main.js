/**
 * Cyberpunk Agent OS — module entry hooks.
 * Socket handling lives in agent-app.js (single canonical listener).
 */

const DEFAULT_MAP_PATH = "modules/cyberpunk-red-agent-os-modified/assets/night-city-map-red-final-v2.png";

/* =====================================================================
 * Modified build (П12): lightweight WebAudio sound helper. Synthesises
 * short UI tones so the module needs no audio asset files. Respects a
 * per-user "agentSounds" toggle (default on). Exposed globally so both the
 * app instance and the createChatMessage hook can trigger sounds.
 * ===================================================================== */
const AgentOSAudio = {
    _ctx: null,
    _enabled() {
        try { return game.settings.get("cyberpunk-red-agent-os-modified", "soundsEnabled") !== false; }
        catch (e) { return true; }
    },
    _ac() {
        if (this._ctx) return this._ctx;
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            this._ctx = AC ? new AC() : null;
        } catch (e) { this._ctx = null; }
        return this._ctx;
    },
    /** Play a short tone. type: 'tap' | 'message' | 'error' */
    play(type = 'tap') {
        if (!this._enabled()) return;
        const ctx = this._ac();
        if (!ctx) return;
        try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
        const now = ctx.currentTime;
        // Tone presets: [frequency(s), duration, peak gain, waveform]
        const make = (freq, start, dur, peak, wave = 'sine') => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = wave;
            osc.frequency.setValueAtTime(freq, now + start);
            gain.gain.setValueAtTime(0.0001, now + start);
            gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(now + start); osc.stop(now + start + dur + 0.02);
        };
        if (type === 'message') {
            // Soft two-note chime.
            make(660, 0, 0.18, 0.06, 'sine');
            make(880, 0.10, 0.22, 0.05, 'sine');
        } else if (type === 'error') {
            make(220, 0, 0.22, 0.05, 'square');
        } else {
            // Quiet interaction blip.
            make(520, 0, 0.07, 0.035, 'sine');
        }
    }
};
globalThis.AgentOSAudio = AgentOSAudio;

Hooks.once('init', function () {
    console.log('Agent OS | Initializing...');

    // --- Per-client settings (Modified build) ---
    // Sound toggle — each player can mute the phone's UI/notification sounds.
    game.settings.register("cyberpunk-red-agent-os-modified", "soundsEnabled", {
        name: game.i18n.localize("AGENTOS.Settings.SoundsName"),
        hint: game.i18n.localize("AGENTOS.Settings.SoundsHint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });
    // New-message on-screen indicator toggle.
    game.settings.register("cyberpunk-red-agent-os-modified", "messageIndicatorEnabled", {
        name: game.i18n.localize("AGENTOS.Settings.IndicatorName"),
        hint: game.i18n.localize("AGENTOS.Settings.IndicatorHint"),
        scope: "client",
        config: true,
        type: Boolean,
        default: true
    });

    // --- World settings (GM-only, sync to all clients automatically) ---

    game.settings.register("cyberpunk-red-agent-os-modified", "uiSkin", {
        name: "UI Skin",
        hint: "Visual theme applied to all players' Agent devices. RED is the default Cyberpunk RED aesthetic; 2077 is a yellow/holographic variant.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        choices: { "red": "Cyberpunk RED", "2077": "Cyberpunk 2077" },
        default: "red",
        onChange: () => {
            try { game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "refreshSkin" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "mapImagePath", {
        name: "Sat Map Image Path",
        hint: "Managed via the Agent's Sys Admin -> Visual section (with Browse). This entry is hidden to keep the FilePicker-equipped UI as the single source of truth.",
        scope: "world",
        // Patch5.5.20: hidden from Foundry's Configure Game Settings menu — that UI
        // is text-only (no FilePicker), and GMs typing absolute Windows paths in
        // there got broken results (Praise Jaheebus issue). The agent's Sys Admin
        // Visual section has the Browse button + warning toast. Single source of truth.
        config: false,
        restricted: true,
        type: String,
        default: DEFAULT_MAP_PATH,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "partyGroupChatName", {
        name: "Party / Group Chat Name",
        hint: "Display name for the permanent group chat channel visible to all players.",
        scope: "world",
        config: false,
        type: String,
        default: "Party / Group Net",
        onChange: () => {
            try { game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "refreshOnlineStatus" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "socialFeedArticles", {
        name: "Social Feed Articles (JSON)",
        hint: 'Optional JSON array of social-feed entries. Each entry: { "category": "Trending in Night City", "text": "..." }. Leave blank to use defaults.',
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "npcReputations", {
        name: "NPC Reputations (JSON)",
        hint: 'JSON array of NPC reputation entries. Managed via the FIXERS app in-device.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            try { game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "auctionListings", {
        name: "Auction Listings (JSON)",
        hint: 'JSON array of active auction listings. Managed via the BLACK MKT app in-device.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            try { game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "customStoreItems", {
        name: "Custom NC Mart Items (JSON)",
        hint: 'JSON array of custom store items. Each: { name, category, price, img (optional), description (optional) }. Managed via Sys Admin.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            // Invalidate store cache so items refresh
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "inGameClock", {
        name: "In-Game Clock",
        hint: 'Manual in-game time (HH:MM format). Overridden by Simple Calendar if installed. Set via Sys Admin.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            try { game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "clockUpdate" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "customStorePacks", {
        name: "Custom Compendium Packs for NC Mart",
        hint: 'Comma-separated compendium pack IDs to include in NC Mart (e.g., "world.my-gear,world.my-weapons").',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    // Patch3 (Ryouhi request): optional Sequencer/JB2A/Tagger-powered
    // "holophone calling" VFX on the controlled token while the Agent is open.
    // Off by default — only useful at tables that have those modules installed.
    game.settings.register("cyberpunk-red-agent-os-modified", "enableCallAnimation", {
        name: "Holophone Call Animation (Sequencer)",
        hint: "Plays a 'calling' VFX over the controlled token while the Agent device is open. Requires Sequencer + Tagger + JB2A. No-op if those modules aren't installed.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: true
    });

    // Patch3.2 (CommanderCrunch69-class GM control request): NC Mart gates.
    // These are read in agent-app.js getData / catalog assembly and the cart
    // checkout path so even a cached catalog can't sneak past them.
    game.settings.register("cyberpunk-red-agent-os-modified", "storeMaxPrice", {
        name: "NC Mart — Max Item Price (eb)",
        hint: "Hide any items priced strictly above this value. 0 = no cap. Use this to enforce 'nothing over 500eb tonight' rules.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 0,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    // Patch4.7 (Gotto): Night City style trend. GM sets a short label that
    // appears on every player's Style screen, plus an optional flavor blurb.
    game.settings.register("cyberpunk-red-agent-os-modified", "styleTrend", {
        name: "Style — Current Trend Label",
        hint: "Short label shown on every player's Style screen (e.g. 'Asia Pop', 'Nomad Leathers', 'Chromatic Glitch'). Empty = no trend banner.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });
    game.settings.register("cyberpunk-red-agent-os-modified", "styleTrendDesc", {
        name: "Style — Current Trend Flavor",
        hint: "Optional sentence under the trend label (e.g. 'Corpo execs in monochrome neon').",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    // Patch4.7 (Gotto): fixer-rank availability gates. Items priced strictly
    // above `storeFixerGatePrice` are hidden from players whose `fixerRank`
    // user-flag is below `storeFixerGateRank`. Both at 0 = gate disabled.
    game.settings.register("cyberpunk-red-agent-os-modified", "storeFixerGatePrice", {
        name: "NC Mart — Fixer Rank Gate · Price Threshold (eb)",
        hint: "Items priced strictly above this value require a minimum Fixer rank to appear. 0 = gate disabled.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 0,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "storeFixerGateRank", {
        name: "NC Mart — Fixer Rank Gate · Minimum Rank",
        hint: "Minimum Fixer rank required for a player to see items above the price threshold. Each player's rank is set per-user in Sys Admin.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 0,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    // ════════════════════════════════════════════════════════════════════════
    // Patch5.5 — Black Chrome / All About Agents app data stores.
    // All world-scope JSON-encoded arrays of objects. GM-authored content
    // (rap sheets, city listings, dating profiles, map indicators, the
    // current night market). Players read; GM writes via Sys Admin panels.
    // ════════════════════════════════════════════════════════════════════════

    game.settings.register("cyberpunk-red-agent-os-modified", "ncpdRapSheets", {
        name: "NCPD Crime Database — Rap Sheets (JSON)",
        hint: "GM-authored crime records. Managed via the NCPD DB Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "cityDirectoryEntries", {
        name: "Ziggurat City Database — Listings (JSON)",
        hint: "GM-authored city directory. Managed via the Ziggurat Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "gardenProfiles", {
        name: "The Garden — Dating Profiles (JSON)",
        hint: "GM-authored dating profiles. Managed via the Garden Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "mapIndicators", {
        name: "Sat Map — Indicators / Pins (JSON)",
        hint: "GM-placed map indicators. Managed via the Map Indicators Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "nightMarketActive", {
        name: "NC Mart — Active Night Market (JSON)",
        hint: "Curated current Night Market — { name, openedAt, items:[{uuid, name, price, flavor, img}] }. GM authors via Sys Admin.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "storeSourceFilter", {
        name: "NC Mart — Source Filter",
        hint: "Restrict which items appear: 'all' includes both compendium/core packs and your custom items; 'core' shows only compendium-sourced items; 'custom' shows only items you added via Sys Admin.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        choices: { "all": "All (core + custom)", "core": "Core/compendium only", "custom": "Custom items only" },
        default: "all",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "storeLockedCategories", {
        name: "NC Mart — Locked Categories",
        hint: "Comma-separated list of category names that should be hidden from the shop entirely. Example: \"Cyberware, Drugs\". Useful when a vendor only stocks certain stuff.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("cyberpunk-red-agent-os-modified", "storeBlacklistIds", {
        name: "NC Mart — Blacklisted Item UUIDs / Names",
        hint: "Comma- or newline-separated list of item UUIDs or names to hide from the shop. Use Sys Admin's blacklist UI to manage this list interactively.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });
});

Hooks.once('ready', async function () {
    console.log('Agent OS | CitiNet wired.');

    // Modified build: sweep any leftover holophone "call" effects that survived a
    // crash / reload / session that ended mid-call. Sequencer persists effects
    // with a long duration across reloads, so without this a stray symbol or ring
    // could be stuck next to a token on world load. Deferred so the canvas and
    // Sequencer are fully ready first.
    Hooks.once('canvasReady', () => {
        setTimeout(async () => {
            try {
                const EM = globalThis.Sequencer?.EffectManager;
                if (!EM) return;
                await EM.endEffects({ name: "AgentCall" });
                await EM.endEffects({ name: "AgentCallText" });
                globalThis.__AgentDeviceCalling?.clear?.();
            } catch (e) { /* Sequencer not installed or nothing to clean */ }
        }, 800);
    });

    // Patch4.7.1 (urgent): Simple Calendar integration was firing
    // `simple-calendar-date-time-change` every in-game second while the
    // game was unpaused — each fire ran a full Agent re-render which
    // unbound click handlers faster than users could click them. Route
    // through the throttled render helper (4 renders/sec ceiling) so the
    // clock still updates promptly but clicks stay responsive.
    Hooks.on("simple-calendar-date-time-change", () => {
        _queueAgentRender();
    });

    // Keep group-chat participants accurate when players connect/disconnect.
    // Throttled for the same reason — bulk reconnect bursts can chain hooks.
    Hooks.on("userConnected", () => {
        const ui = globalThis.AgentDeviceApp?.ui;
        if (ui?.rendered && ui.currentView === 'chat-thread' && ui.activeContactId === 'party_group_chat') {
            _queueAgentRender();
        }
    });

    // --- MIGRATION: ensure new apps are unlocked for existing users ---
    // When new apps are added, users who already have an unlockedApps flag
    // won't pick up the new defaults. This patches them in automatically.
    const REQUIRED_APPS = ['style', 'rep', 'auction'];
    const migrateUnlocked = async (flagOwner) => {
        const existing = flagOwner.getFlag("cyberpunk-red-agent-os-modified", "unlockedApps");
        if (!existing || !Array.isArray(existing)) return; // no flag = will use defaults
        const missing = REQUIRED_APPS.filter(a => !existing.includes(a));
        if (missing.length > 0) {
            console.log(`Agent OS | Migration: adding [${missing.join(',')}] to ${flagOwner.name || flagOwner.id}`);
            await flagOwner.setFlag("cyberpunk-red-agent-os-modified", "unlockedApps", [...existing, ...missing]);
        }
    };

    // GM migrates all users + all actors that have the flag
    if (game.user.isGM) {
        for (const user of game.users) {
            await migrateUnlocked(user);
        }
        for (const actor of game.actors) {
            if (actor.getFlag("cyberpunk-red-agent-os-modified", "unlockedApps")) {
                await migrateUnlocked(actor);
            }
        }
    } else {
        // Players migrate only themselves
        await migrateUnlocked(game.user);
    }
});

// Scene-controls button (consistent name + tooltip)
Hooks.on('getSceneControlButtons', (controls) => {
    let tokenControls = controls.find(c => c.name === "token");
    if (tokenControls) {
        tokenControls.tools.push({
            name: "agent-device-app",
            title: "Open Cyberpunk Agent OS",
            icon: "fas fa-mobile-alt",
            button: true,
            onClick: () => {
                if (globalThis.AgentDeviceApp && globalThis.AgentDeviceApp.ui) {
                    globalThis.AgentDeviceApp.ui.render(true);
                }
            }
        });
    }
});

// Patch4.7 (BubbleMushroom) + Patch4.7.1 (urgent unpause fix):
// The createChatMessage hook used to call app.render(true) synchronously
// for every Agent message; Simple Calendar's date-time-change hook did the
// same on every tick. With an unpaused game + SC running, that's many
// renders per second — click handlers get unbound by the next render
// before the user's click event fires (reported as "clicks unregistered
// while unpaused"). 4.7's rAF coalesce wasn't enough — 60 renders/sec
// still saturates the click budget. Switched to a leading+trailing
// throttle with a 250ms floor: render immediately on the first request in
// a quiet window, then ignore subsequent requests until 250ms has passed,
// then schedule one trailing render to catch the latest state. Caps at
// ~4 renders/sec regardless of how chatty the source is.
let _agentRenderTimer = null;
let _agentLastRenderTs = 0;
const _AGENT_RENDER_MIN_INTERVAL_MS = 250;
function _queueAgentRender() {
    const app = globalThis.AgentDeviceApp?.ui;
    if (!app?.rendered) return;
    const now = Date.now();
    const since = now - _agentLastRenderTs;
    if (since >= _AGENT_RENDER_MIN_INTERVAL_MS) {
        // Leading edge — quiet window, fire now. Clear any stale trailing
        // timer from a prior burst so we don't double-render.
        if (_agentRenderTimer) { clearTimeout(_agentRenderTimer); _agentRenderTimer = null; }
        _agentLastRenderTs = now;
        app.render(true);
        return;
    }
    // Inside the throttle window — schedule one trailing render.
    if (_agentRenderTimer) return;
    _agentRenderTimer = setTimeout(() => {
        _agentRenderTimer = null;
        _agentLastRenderTs = Date.now();
        const a = globalThis.AgentDeviceApp?.ui;
        if (a?.rendered) a.render(true);
    }, _AGENT_RENDER_MIN_INTERVAL_MS - since);
}

// Refresh the UI on new Agent messages and track unreads
Hooks.on('createChatMessage', async (message, options, userId) => {
    if (!message.flags?.["cyberpunk-red-agent-os-modified"]?.isAgentMessage) return;

    let threadId = message.flags["cyberpunk-red-agent-os-modified"].threadId;
    const authorId = message.author?.id;
    const isAuthor = authorId === game.user.id;

    if (threadId && !threadId.startsWith("npc_") && message.whisper && message.whisper.length > 0 && message.whisper.includes(game.user.id)) {
        threadId = authorId;
    }

    // 5.5.22 (CommanderCrunch69 privacy bug): Foundry delivers ChatMessage
    // documents to every connected client, not just the whisper recipients
    // — `createChatMessage` therefore fires on uninvolved clients too.
    // Without a gate, PC C gets unread badges, auto-resurrected contacts,
    // and "Incoming from PC A" toast notifications for DMs between PC A
    // and PC B. Hard gate: bail out when this is a whispered message
    // whose whisper list excludes the current user (GMs always process
    // for monitoring; authors fall through to the existing !isAuthor
    // gate below).
    if (!isAuthor && !game.user.isGM
        && Array.isArray(message.whisper)
        && message.whisper.length > 0
        && !message.whisper.includes(game.user.id)) {
        return;
    }

    if (threadId && !isAuthor) {
        let unreads = game.user.getFlag("cyberpunk-red-agent-os-modified", "unreads") || {};
        let app = globalThis.AgentDeviceApp?.ui;

        if (!(app?.rendered && app.currentView === 'chat-thread' && app.activeContactId === threadId)) {
            unreads[threadId] = (unreads[threadId] || 0) + 1;
            await game.user.setFlag("cyberpunk-red-agent-os-modified", "unreads", unreads);
        }

        // Patch4.8 (player report): if the recipient deleted this NPC thread
        // and the GM later sends another message to it, the thread didn't
        // re-appear — the player had to manually re-add the contact. Now we
        // auto-resurrect: if the message is for an NPC thread (`npc_*` ids)
        // AND the receiving user doesn't have a matching customContact, push
        // one back in using the metadata embedded on the chat message.
        //
        // Patch5.0.1 (Gotto, "players read NPC messages they shouldn't"):
        // `createChatMessage` fires on EVERY client regardless of whisper
        // visibility. Foundry syncs the document to all sessions; whisper
        // only controls what's rendered in the chat log. The earlier
        // auto-resurrect was running on every client, so an NPC message
        // whispered only to GMs still materialised the contact on every
        // player's device — they then saw the thread + message even though
        // the GM never targeted them. Hard gate: only resurrect if THIS
        // user is in the whisper list (or no whisper = public, which
        // shouldn't happen for npc_* threads but covered defensively).
        try {
            if (threadId.startsWith("npc_")) {
                const hasWhisper = Array.isArray(message.whisper) && message.whisper.length > 0;
                const userIsRecipient = hasWhisper
                    ? message.whisper.includes(game.user.id)
                    : true; // public message — everyone is implicit recipient
                if (userIsRecipient && !game.user.isGM) {
                    const myContacts = game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                    if (!myContacts.some(c => c.id === threadId)) {
                        const flags = message.flags["cyberpunk-red-agent-os-modified"];
                        const restored = {
                            id: threadId,
                            name: flags.overrideName || flags.targetName || "Resurrected Contact",
                            avatar: flags.overrideAvatar || "",
                            isPlayer: false,
                            targetUserIds: [game.user.id]
                        };
                        await game.user.setFlag("cyberpunk-red-agent-os-modified", "customContacts", [...myContacts, restored]);
                        ui.notifications?.info?.(`Agent: "${restored.name}" reconnected to your CitiNet directory.`);
                    }
                }
            }
        } catch (e) {
            console.warn("AgentDevice | NPC thread auto-resurrect failed:", e);
        }
    }

    const app = globalThis.AgentDeviceApp?.ui;

    // Modified build (П12): play the incoming-message chime for recipients.
    // (The whisper/recipient gate above already returned for uninvolved users.)
    if (!isAuthor) {
        try { globalThis.AgentOSAudio?.play('message'); } catch (e) {}
    }

    if (app?.rendered) {
        _queueAgentRender();
    } else if (!isAuthor) {
        const senderName = message.author?.name || "Unknown";
        const override = message.flags["cyberpunk-red-agent-os-modified"].overrideName;
        const target = message.flags["cyberpunk-red-agent-os-modified"].targetName;
        let displaySender = override || senderName;
        if (target && !override && game.user.isGM) displaySender = `${senderName} » ${target}`;
        // Modified build (П12): on-screen, clickable new-message indicator that
        // opens the phone. Falls back to the original notification toast.
        showAgentMessageIndicator(displaySender, threadId);
    }
});

/**
 * Modified build (П12): floating on-screen indicator for a new Agent message.
 * Clicking it opens the player's Agent phone (jumping to the thread when known).
 * Honors the per-client "messageIndicatorEnabled" setting; when disabled, shows
 * the plain notification toast instead.
 */
function showAgentMessageIndicator(displaySender, threadId) {
    let enabled = true;
    try { enabled = game.settings.get("cyberpunk-red-agent-os-modified", "messageIndicatorEnabled") !== false; } catch (e) {}
    if (!enabled) {
        ui.notifications.info(game.i18n.format("AGENTOS.Notify.Incoming", { sender: displaySender }));
        return;
    }
    try {
        // Remove any existing indicator first (avoid stacking).
        document.getElementById("agent-os-msg-indicator")?.remove();
        const el = document.createElement("div");
        el.id = "agent-os-msg-indicator";
        el.className = "agent-os-msg-indicator";
        el.innerHTML = `
            <i class="fas fa-comment-dots"></i>
            <div class="agent-os-msg-indicator-text">
                <div class="agent-os-msg-indicator-title">${game.i18n.localize("AGENTOS.Notify.NewMessage")}</div>
                <div class="agent-os-msg-indicator-sub">${foundry.utils.escapeHTML?.(displaySender) ?? displaySender}</div>
            </div>
            <i class="fas fa-times agent-os-msg-indicator-close" title="${game.i18n.localize("AGENTOS.Common.Dismiss")}"></i>
        `;
        el.addEventListener("click", (ev) => {
            if (ev.target.classList.contains("agent-os-msg-indicator-close")) { el.remove(); return; }
            const ui2 = globalThis.AgentDeviceApp?.ui;
            if (ui2) {
                if (threadId) { ui2.currentView = 'chat'; ui2.activeContactId = threadId; }
                ui2.render(true);
            }
            el.remove();
        });
        document.body.appendChild(el);
        // Auto-dismiss after a while so it doesn't linger forever.
        setTimeout(() => { try { el.classList.add("agent-os-msg-indicator-out"); } catch (e) {} }, 7000);
        setTimeout(() => { try { el.remove(); } catch (e) {} }, 7600);
    } catch (e) {
        console.warn("Agent OS | message indicator failed:", e);
        ui.notifications.info(game.i18n.format("AGENTOS.Notify.Incoming", { sender: displaySender }));
    }
}

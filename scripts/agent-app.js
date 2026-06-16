/**
 * Cyberpunk Agent OS — Agent Device for Foundry VTT (Cyberpunk RED)
 * Target: Foundry V12
 * Version: 1.0.0-beta.1
 */

// Patch3: single shared HTML escape helper used by every ChatMessage.create
// that interpolates user-controlled content. Falls back to a manual escape
// if Foundry's util isn't available.
function _agentEscHTML(s) {
    const v = String(s ?? "");
    if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(v);
    return v.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

class AgentOSApplication extends Application {
    constructor(options = {}) {
        super(options);
        // Start with the boot sequence every time it's physically opened to feel real
        this.currentView = "boot";
        this.bootTimer = null;
        this.activeContactId = null;
        this.showAddContact = false;
        this.searchQuery = "";
        this.editContactId = null;
        this.editContactName = "";
        this.shardSearchQuery = "";
        this.activeShardId = null;
        this.showPayoutModal = false;
        this.showLedgerModal = false;
        this.showShardModal = false;
        this.showEmojiPicker = false;
        // Patch4.5: in-phone modal for editing Agent ID (replaces the
        // immersion-breaking Foundry Dialog popup).
        this.showIdEditModal = false;
        // Patch4.5: in-phone modal for Pay All Players (same reason).
        this.showPayAllModal = false;
        // Patch4.6: in-phone modal for NPC bid name prompt + generic confirm.
        this.showNpcBidModal = false;
        this._pendingNpcBid = null;
        this._pendingConfirm = null; // {kind, payload, title, message}
        // Patch4.8: new-group modal flag.
        this.showNewGroup = false;
        // Patch5.5.5: GM-side add modals for new apps. + button in the app
        // header opens a modal with the same form fields the Sys Admin section
        // used to host. Sys Admin add-forms removed (lists stay in Sys Admin
        // for review; add UI moved to where the GM is actually looking).
        this.showNcpdAddModal = false;
        this.showZigguratAddModal = false;
        this.showGardenAddModal = false;
        // Modified build (П9): id of the directory entry currently being edited
        // (null = the modal adds a new record instead).
        this._ncpdEditId = null;
        this._zigguratEditId = null;
        this._gardenEditId = null;
        // Modified build (П4): personal CONTACTS state.
        this.showContactModal = false;
        this._contactEditId = null;
        this._contactsOpenFolder = null; // GM: which player folder is expanded
        // Modified build: an uploaded-but-not-yet-sent chat attachment awaiting a caption.
        this._stagedAttachment = null;
        // Patch5.5.3: map pin placement state (moved out of Sys Admin to Maps).
        this._mapPinMode = false;
        this._pendingPinX = 50;
        this._pendingPinY = 50;
        this.showMapPinModal = false;
        this.showMapPinManageModal = false;
        // Patch4.8: attachment template picker state.
        this.showAttachPicker = false;
        this._attachKind = "photo"; // photo | video | audio
        this.actorId = null;       // Hardware identity for financial transactions
        this.actorUuid = null;     // UUID for sidebar & synthetic actor detection

        // Map State
        this.mapZoom = 1;
        this.mapX = 0;
        this.mapY = 0;

        // Admin State
        this.selectedAdminActorUuid = null;
        // Patch4 round 2: separate tab state ONLY for the Application Access
        // section in Sys Admin. Decoupled from `selectedAdminActorUuid` so
        // flipping a player tab here doesn't also change the GM's wallet view,
        // transfer source, or any other admin context. "VirtualWallet" = GM's
        // own app-lock flags.
        this._appLockPlayerUuid = "VirtualWallet";

        // Realistic-texting state
        this.typingPeers = {};
        this._typingEmitting = false;
        this._typingStopTimer = null;
        this._typingExpireTimer = null;
        this._chatNearBottom = true;
        this._forceScrollOnNextRender = false;
        this._chatInputDraft = "";
        this._chatInputHadFocus = false;
        // Generic composer drafts — survive cross-client re-renders (e.g. Social post).
        // Keyed by element id so we can extend without changing call sites.
        // Patch3: also tracked per-view so switching to a different auction /
        // contact doesn't carry the previous view's draft into the new one.
        this._composerDrafts = {};
        this._composerFocusId = null;
        this._composerDraftsView = null;

        // Lifecycle: tracks window-level listeners so we can detach on close()
        this._windowEventsBound = false;
        this._onWindowMouseMove = null;
        this._onWindowMouseUp = null;

        // Map pan state — instance-scoped so window mousemove handler sees mousedown writes
        this._panState = { isPanning: false, startX: 0, startY: 0 };

        // NC MART store state
        this._storeCatalog = null;       // { Weapons: [...], Ammo: [...], ... }
        this._storeLoading = null;       // in-flight Promise during initial load
        this._storeCategory = "All"; // active category in the list view; "All" = flatten every category
        this._storeSearch = "";          // search filter
        this._storeView = "list";        // "list" | "cart" | "loading"
        this._storeSearchDebounce = null;
        this._storeScrollPositions = {};  // { "Weapons": 120, "Ammo": 0, ... }
        this._storeFilterAffordable = false; // true = show only items player can afford
        // Patch4.7 (Gotto): price-tier dropdown ("all" | "100" | "500" | ...)
        this._storePriceTier = "all";
        // Patch5.5: NC Mart mode toggle ("catalog" | "nightmarket"). Players can flip
        // between the regular catalog and the GM-curated Night Market drop.
        this._storeMode = "catalog";
        // Patch4.7 (Gotto): social feed single-category filter ("all" or a category label)
        this._socialFilter = "all";

        // Window-drag state (custom impl — V12's Draggable was unreliable for our V1 setup)
        this._dragState = { isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 };
        this._onWindowDragMove = null;
        this._onWindowDragUp = null;

        // Style Checker state
        this._styleTab = "outfit"; // "outfit" | "gear"

        // Auction House state
        this._auctionView = "list"; // "list" | "detail"
        this._auctionDetailId = null;
        this._pendingAuctionData = null; // optimistic UI: holds mutated auction array until settings.set resolves
    }

    static _formatDayDivider(ts) {
        const d = new Date(ts);
        const today = new Date(); today.setHours(0,0,0,0);
        const day = new Date(d); day.setHours(0,0,0,0);
        const diff = Math.round((today - day) / 86400000);
        if (diff === 0) return "Today";
        if (diff === 1) return "Yesterday";
        if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: today.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "AgentDevice-app",
            template: "modules/cyberpunk-red-agent-os-modified/templates/agent-ui.hbs",
            title: "Agent Device",
            classes: ["AgentDevice", "agent-popup"],
            // Sized to the phone chassis + the 26px glow gutter so the soft halo
            // around the device isn't clipped by the window content box.
            width: 440,
            height: 720,
            resizable: false,
            popOut: true,
            minimizable: false
        });
    }

    _getContacts() {
        let contacts = [];

        // 0. The Permanent Party / Group Chat (Seen by everyone)
        let partyName = "Party / Group Net";
        try { partyName = game.settings.get("cyberpunk-red-agent-os-modified", "partyGroupChatName") || partyName; } catch (e) {}
        contacts.push({
            id: "party_group_chat",
            name: partyName,
            isPlayer: false,
            isGroup: true,
            active: true
        });

        // 1. Add other users as contacts
        game.users.forEach(u => {
            if (u.id === game.user.id) return;

            let isHidden = u.getFlag("cyberpunk-red-agent-os-modified", "hideOnlineStatus") || false;
            let isJammed = u.getFlag("cyberpunk-red-agent-os-modified", "isJammed") || false;

            let isUserActive = false;
            let isGhost = false;

            if (game.user.isGM) {
                isUserActive = u.active;
                if (isHidden && u.active) isGhost = true;
            } else {
                isUserActive = u.active && !isHidden && !isJammed;
            }

            // Use custom handle from Agent ID if set, fallback to Foundry name
            const idOver = u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides") || {};
            const displayName = idOver.handle || u.name;
            contacts.push({
                id: u.id,
                name: u.isGM ? `${displayName} (Global Net)` : displayName,
                isPlayer: true,
                active: isUserActive,
                isGhost: isGhost,
                isJammed: isJammed
            });
        });

        let gmUser = game.users.find(u => u.isGM);
        let npcStatuses = gmUser ? (gmUser.getFlag("cyberpunk-red-agent-os-modified", "npcStatuses") || {}) : {};

        // 2. Add custom endpoints
        // Patch3 (CommanderCrunch69 bug): NPC contacts targeted at specific players
        // were sometimes appearing for everyone. Defensive filter — for non-GMs,
        // honour the contact's `targetUserIds` field as authoritative. If the
        // contact has a target list and the current user isn't on it (and isn't
        // the contact owner), drop it. GM always sees all their own contacts.
        let customContacts = game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
        customContacts.forEach(c => {
            if (!game.user.isGM
                && Array.isArray(c.targetUserIds)
                && c.targetUserIds.length > 0
                && !c.targetUserIds.includes(game.user.id)
                && c.ownerId !== game.user.id) {
                // Leaked into this user's flag from a previous targeting; ignore.
                return;
            }
            c.active = npcStatuses[c.id] !== false;
            contacts.push(c);
        });

        // 3. GM ONLY: Dynamic Switchboard
        if (game.user.isGM) {
            let agentMessages = game.messages.filter(m => m.flags["cyberpunk-red-agent-os-modified"]?.isAgentMessage && m.flags["cyberpunk-red-agent-os-modified"].threadId?.startsWith('npc_'));
            agentMessages.forEach(m => {
                let tid = m.flags["cyberpunk-red-agent-os-modified"].threadId;
                let exists = contacts.find(c => c.id === tid);

                let npcName = m.flags["cyberpunk-red-agent-os-modified"].targetName || m.flags["cyberpunk-red-agent-os-modified"].overrideName || "Unknown NPC";
                let ownerUsr = m.author?.isGM ? null : m.author;

                if (m.author?.isGM && m.whisper && m.whisper.length === 1) {
                    ownerUsr = game.users.get(m.whisper[0]);
                }

                if (!exists) {
                    contacts.push({
                        id: tid,
                        name: `${npcName} (via ${ownerUsr ? ownerUsr.name : 'Multi-Sync'})`,
                        isPlayer: false,
                        isSwitchboard: true,
                        ownerId: ownerUsr ? ownerUsr.id : null,
                        originalName: npcName,
                        active: npcStatuses[tid] !== false
                    });
                } else if (!exists.ownerId && ownerUsr) {
                    exists.ownerId = ownerUsr.id;
                    // Use originalName when available; otherwise strip any prior "(via X)" suffix
                    // off the current name so we never produce "undefined (via X)".
                    const baseName = exists.originalName
                        || (exists.name || "Unknown NPC").replace(/\s*\(via\s+[^)]+\)\s*$/i, "").trim()
                        || "Unknown NPC";
                    exists.name = `${baseName} (via ${ownerUsr.name})`;
                    if (!exists.originalName) exists.originalName = baseName;
                }
            });
        }

        // 4. Filter by search query if present (single source of truth)
        if (this.searchQuery) {
            let q = this.searchQuery.toLowerCase();
            contacts = contacts.filter(c => c.name.toLowerCase().includes(q));
        }

        return contacts;
    }

    /**
     * Authoritative Hardware Identity Resolution
     * Ensures GM and Player always agree on where the wallet is located.
     */
    _getIdentity(user) {
        if (!user) return null;
        if (user.isGM && (!this.selectedAdminActorUuid || this.selectedAdminActorUuid === "VirtualWallet")) return "VirtualWallet";

        const targetId = (user.isGM && this.selectedAdminActorUuid) ? this.selectedAdminActorUuid : user.getFlag("cyberpunk-red-agent-os-modified", "lastActorUuid");
        if (targetId) {
            const obj = fromUuidSync(targetId);
            if (obj) return targetId;
        }

        if (user.character) return user.character.uuid;

        // Patch4 round 6 (Ryouhi bug): the old fallback picked the FIRST owned
        // actor, which let Item Piles shop/inventory actors (drink menus, etc.)
        // hijack the player's identity — payments via Pay Contact landed on
        // the shop instead of the PC. Filter to:
        //  - character-type actors only (skip NPCs, vehicles, containers)
        //  - exclude actors with item-piles flags (managed shop containers)
        //  - exclude actors flagged as merchant/vault/auction types
        // Picks the most-recently-modified character to give the multi-PC case
        // a sensible default until the player picks one explicitly via the
        // multi-character dropdown.
        const isItemPilesManaged = (a) => {
            const ip = a.flags?.["item-piles"];
            if (!ip) return false;
            // Some Item Piles versions store the toggle as flags['item-piles'].data.enabled
            // or just by the presence of `data.type`. Treat any populated
            // item-piles flag block as "managed" — players rarely want to
            // identify AS an Item Piles container regardless of subtype.
            return !!(ip.data || ip.enabled || ip.type);
        };
        const candidates = game.actors.filter(a =>
            a.testUserPermission(user, "OWNER") &&
            (a.type === "character") &&
            !isItemPilesManaged(a)
        );
        if (candidates.length > 0) {
            // Multi-PC fallback: prefer the most recently modified character.
            // Stable: same actor wins on every render until the player
            // explicitly switches via the multi-character selector.
            candidates.sort((a, b) => (b._stats?.modifiedTime || 0) - (a._stats?.modifiedTime || 0));
            return candidates[0].uuid;
        }

        return "User." + user.id;
    }

    _getVirtualBalance(user) {
        if (!user) return { balance: 0, path: "flags.cyberpunk-red-agent-os-modified.virtualWalletBalance" };
        const balance = user.getFlag("cyberpunk-red-agent-os-modified", "virtualWalletBalance") ?? (user.isGM ? 1000000 : 0);
        return {
            balance: Number(balance) || 0,
            path: "flags.cyberpunk-red-agent-os-modified.virtualWalletBalance"
        };
    }

    _getActorEurobucks(actor) {
        // Modified build: `system.wealth.value` is the canonical CPR v0.9x path
        // (verified against the cyberpunk-red-core LedgerSchema). The legacy
        // `.eb` / `.currency.eb` paths are kept as fallbacks for older data.
        if (!actor) return { balance: 0, path: "system.wealth.value" };
        let paths = ["system.wealth.value", "system.wealth.eb", "system.currency.eb"];
        for (let path of paths) {
            let val = foundry.utils.getProperty(actor, path);
            if (val !== undefined) return { balance: typeof val === 'number' ? val : 0, path: path };
        }
        return { balance: 0, path: "system.wealth.value" };
    }

    /**
     * Resolve a UUID-like identifier into an Actor (or null for User/Virtual cases).
     */
    // Patch4.7 (Gotto): NC Mart price-bucket bounds. Returns {min,max} for a
    // dropdown value, or null for "all" / unknown.
    _priceBucketBounds(value) {
        switch (String(value || "").toLowerCase()) {
            case "cheap":     return { min: 0,     max: 100 };
            case "everyday":  return { min: 100,   max: 500 };
            case "costly":    return { min: 500,   max: 1000 };
            case "premium":   return { min: 1000,  max: 5000 };
            case "expensive": return { min: 5000,  max: 10000 };
            case "luxury":    return { min: 10000, max: Number.POSITIVE_INFINITY };
            default:          return null;
        }
    }

    _resolveActor(uuid) {
        if (!uuid || uuid === "VirtualWallet" || uuid.startsWith("User.")) return null;
        const obj = fromUuidSync(uuid);
        return (obj instanceof Actor) ? obj : null;
    }

    /**
     * Modified build (П6): pick the player's "current" character actor for the
     * biomonitor / wallet sync. Resolution order:
     *   1. The actor of a token the player currently controls on the canvas.
     *   2. The user's assigned character (User → character).
     *   3. The most-recently-modified owned character actor.
     * Returns an Actor or null.
     */
    _getCurrentPlayerActor() {
        // 1. Controlled token's actor (character only).
        try {
            const controlled = canvas?.tokens?.controlled || [];
            for (const t of controlled) {
                const a = t.actor;
                if (a instanceof Actor && a.type === "character"
                    && a.testUserPermission(game.user, "OWNER")) return a;
            }
        } catch (e) { /* canvas not ready — fall through */ }

        // 2. Assigned character.
        if (game.user.character instanceof Actor) return game.user.character;

        // 3. Most-recently-modified owned character (mirrors _getIdentity's logic).
        const candidates = game.actors.filter(a =>
            a.testUserPermission(game.user, "OWNER") && a.type === "character"
        );
        if (candidates.length) {
            candidates.sort((a, b) => (b._stats?.modifiedTime || 0) - (a._stats?.modifiedTime || 0));
            return candidates[0];
        }
        return null;
    }

    /**
     * Modified build (П6): bind the Agent to the current player Actor and refresh.
     * Because the biomonitor (HP / humanity) and the wallet (balance + CPR
     * transaction ledger at system.wealth.value / system.wealth.transactions)
     * are both read live from the resolved actor on every render, persisting the
     * actor UUID as `lastActorUuid` and re-rendering is all that's needed to pull
     * the freshest Actor data into the phone.
     */
    async _syncToCurrentActor() {
        const actor = this._getCurrentPlayerActor();
        if (!actor) {
            ui.notifications?.warn(game.i18n.localize("AGENTOS.Sync.NoActor"));
            return false;
        }
        try {
            await game.user.setFlag("cyberpunk-red-agent-os-modified", "lastActorUuid", actor.uuid);
        } catch (e) {
            console.warn("[Agent OS] sync setFlag failed:", e);
        }
        // Drop any GM admin override so the player sees their own actor.
        if (!game.user.isGM) this.selectedAdminActorUuid = null;
        this._playUiSound?.('tap');
        ui.notifications?.info(
            game.i18n.format("AGENTOS.Sync.Done", { name: actor.name })
        );
        this.render(true);
        return true;
    }

    async getData() {
        const data = await super.getData();

        // --- IDENTITY RESOLUTION (authoritative, runs every render) ---
        this.actorUuid = this._getIdentity(game.user);
        const actor = this._resolveActor(this.actorUuid);
        const isVirtualWallet = !actor;

        // Build list of owned actors for multi-character selector (non-GM only)
        if (!game.user.isGM) {
            data.ownedActors = game.actors
                .filter(a => a.testUserPermission(game.user, "OWNER") && a.type === "character")
                .map(a => ({ uuid: a.uuid, name: a.name, img: a.img || "icons/svg/mystery-man.svg", isActive: a.uuid === this.actorUuid }));
            data.hasMultipleActors = data.ownedActors.length > 1;
        } else {
            data.ownedActors = [];
            data.hasMultipleActors = false;
        }

        // --- MASTER DATA CONTRACT ---
        data.isGM = game.user.isGM;
        // 5.5.26: BROWSE on the Add Contact modal needs to be gated on
        // Foundry's actual FILES_BROWSE permission, not on isGM. In V12 the
        // default for FILES_BROWSE is Assistant GM (role 3) — Players don't
        // have it unless the GM has explicitly granted it in Configure
        // Permissions. Without the permission, opening the FilePicker either
        // silently fails or shows an empty picker. We gate the button on
        // game.user.can("FILES_BROWSE") so players whose GM has granted
        // file browsing see it, and the rest see only IMPORT.
        try { data.canBrowseFiles = !!game.user.can?.("FILES_BROWSE"); }
        catch (e) { data.canBrowseFiles = game.user.isGM; }
        data.currentView = this.currentView || "boot";
        data.activeContactId = this.activeContactId;
        data.showAddContact = this.showAddContact || false;
        data.showPayoutModal = this.showPayoutModal || false;
        data.showLedgerModal = this.showLedgerModal || false;
        data.showShardModal = this.showShardModal || false;
        data.showEmojiPicker = this.showEmojiPicker || false;
        data.selectedAdminActorUuid = this.selectedAdminActorUuid;
        data.editContactId = this.editContactId;
        data.editContactName = this.editContactName;
        data.editContactAvatar = this.editContactAvatar || "";
        data.searchQuery = this.searchQuery;
        data.shardSearchQuery = this.shardSearchQuery;
        // In-game clock: try Simple Calendar API → GM-set manual clock → real time fallback
        let igTime = null;
        try {
            if (globalThis.SimpleCalendar?.api) {
                const dt = SimpleCalendar.api.currentDateTime();
                if (dt) {
                    const hh = String(dt.hour).padStart(2, '0');
                    const mm = String(dt.minute).padStart(2, '0');
                    igTime = `${hh}:${mm}`;
                }
            }
        } catch (e) {}
        if (!igTime) {
            try {
                const manualClock = game.settings.get("cyberpunk-red-agent-os-modified", "inGameClock");
                if (manualClock) igTime = manualClock;
            } catch (e) {}
        }
        data.time = igTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        data.hasSimpleCalendar = !!globalThis.SimpleCalendar?.api;
        data.isIngameClock = !!igTime;
        // Modified build: mirror onto the instance so the live clock ticker knows
        // whether the displayed time is real-world (auto-tick) or in-game (don't).
        this._isIngameClock = !!igTime;
        data.gameUserId = game.user.id;

        // World settings (uiSkin, mapImagePath, socialFeedArticles) — defaults if registration missed
        try { data.uiSkin = game.settings.get("cyberpunk-red-agent-os-modified", "uiSkin") || "red"; } catch (e) { data.uiSkin = "red"; }

        // Modified build (П10/П11): per-USER colour theme and device mode.
        // These are stored on the player's User document so every player can pick
        // their own look independently of the GM world skin (`uiSkin`, which still
        // drives the SAT map art / 2077 icon sprites).
        //   agentTheme: red | cyber2077 | green | blue | purple | orange |
        //               magenta | chrome   (default 'red')
        //   agentMode:  'phone' | 'tablet'                       (default 'phone')
        const VALID_THEMES = ['red', 'cyber2077', 'green', 'blue', 'purple', 'orange', 'magenta', 'chrome'];
        const VALID_MODES = ['phone', 'tablet'];
        let _theme = game.user.getFlag("cyberpunk-red-agent-os-modified", "agentTheme");
        let _mode = game.user.getFlag("cyberpunk-red-agent-os-modified", "agentMode");
        data.agentTheme = VALID_THEMES.includes(_theme) ? _theme : 'red';
        data.agentMode = VALID_MODES.includes(_mode) ? _mode : 'phone';
        // Modified build (П12): sound on/off for the settings toggle.
        try { data.agentSoundsOn = game.settings.get("cyberpunk-red-agent-os-modified", "soundsEnabled") !== false; }
        catch (e) { data.agentSoundsOn = true; }
        const REDMAP = "modules/cyberpunk-red-agent-os-modified/assets/night-city-map-red-final-v2.png";
        const HOLOMAP = "modules/cyberpunk-red-agent-os-modified/assets/cyberpunk-holophone/night-city-sat-map.png";
        try {
            const cfgMap = game.settings.get("cyberpunk-red-agent-os-modified", "mapImagePath");
            // Auto-swap to the 2077 map when skin is 2077 and the GM hasn't overridden the default.
            data.mapImagePath = (cfgMap && cfgMap !== REDMAP) ? cfgMap
                : (data.uiSkin === "2077" ? HOLOMAP : REDMAP);
        } catch (e) { data.mapImagePath = REDMAP; }
        try {
            const raw = game.settings.get("cyberpunk-red-agent-os-modified", "socialFeedArticles");
            const parsed = Array.isArray(raw) ? raw : (typeof raw === "string" && raw.trim() ? JSON.parse(raw) : []);
            // Decorate each entry with display-time fields.
            // Patch4 (Gotto Goho): newest-first ordering, matches actual social
            // media UX where the latest post is the most visible.
            let articles = parsed.map((a, i) => ({
                id: a.id || `feed_${i}`,
                category: a.category || "Feed",
                text: a.text || "",
                authorId: a.authorId || null,
                authorName: a.authorName || "",
                // Patch5.5: Screamsheet flag flows through so the template can
                // pick the styled card layout. Defaults to false for legacy posts.
                isScreamsheet: !!a.isScreamsheet,
                timestamp: a.timestamp || 0,
                canDelete: game.user.isGM || (a.authorId === game.user.id)
            })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            // Patch4.7 (Gotto): single-category filter. `_socialFilter` is
            // "all" by default or one of the visible category labels.
            const socialFilter = this._socialFilter || "all";
            // Build the unique category set for the filter chip strip.
            const catSet = new Set();
            articles.forEach(a => { if (a.category) catSet.add(a.category); });
            data.socialFilterCategories = Array.from(catSet).sort();
            data.socialFilter = socialFilter;
            if (socialFilter !== "all") {
                articles = articles.filter(a => a.category === socialFilter);
            }
            data.socialFeedArticles = articles;
        } catch (e) {
            data.socialFeedArticles = [];
            data.socialFilterCategories = [];
            data.socialFilter = "all";
        }
        // GM editor uses "Category | Text" lines view of the JSON
        data.socialFeedRaw = (data.socialFeedArticles || [])
            .map(a => `${a.category || ""} | ${a.text || ""}`)
            .join("\n");

        // Custom NC Mart settings (GM only)
        try {
            data.customStoreItemsRaw = game.settings.get("cyberpunk-red-agent-os-modified", "customStoreItems") || "[]";
            data.customStorePacks = game.settings.get("cyberpunk-red-agent-os-modified", "customStorePacks") || "";
            // Patch4.7 follow-up: list available Item-type packs in this world
            // so the GM can copy the exact pack ID into the custom-packs list
            // instead of guessing the namespace. Filters out the system's core
            // compendiums (already pulled by default) and non-Item packs.
            try {
                // Modified build: set of currently-selected pack IDs, so the
                // picker can render a stylized checkbox per pack.
                const selectedPacks = new Set(
                    String(data.customStorePacks || "")
                        .split(",").map(s => s.trim()).filter(Boolean)
                );
                data.availableStorePacks = Array.from(game.packs || [])
                    .filter(p => {
                        if (!p?.metadata) return false;
                        if (p.metadata.type !== "Item") return false;
                        // Hide the system's own pre-baked CPR packs — already in the catalog.
                        if (p.metadata.packageType === "system") return false;
                        return true;
                    })
                    .map(p => {
                        const id = p.metadata.id || p.collection;
                        return {
                            id,
                            label: p.metadata.label || id,
                            packageType: p.metadata.packageType || "",
                            packageName: p.metadata.packageName || "",
                            selected: selectedPacks.has(id)
                        };
                    })
                    .sort((a, b) => a.label.localeCompare(b.label));
                data.selectedStorePackCount = selectedPacks.size;
            } catch (e) {
                data.availableStorePacks = [];
                data.selectedStorePackCount = 0;
            }
            // Patch3 (CommanderCrunch69): parsed view for one-click removal in admin UI.
            try {
                const _parsed = JSON.parse(data.customStoreItemsRaw);
                data.customStoreItemsParsed = Array.isArray(_parsed) ? _parsed : [];
            } catch (e) { data.customStoreItemsParsed = []; }
            // Patch3.2: GM gates surfaced for the admin UI.
            data.storeMaxPrice        = Number(game.settings.get("cyberpunk-red-agent-os-modified", "storeMaxPrice")) || 0;
            data.storeSourceFilter    = game.settings.get("cyberpunk-red-agent-os-modified", "storeSourceFilter") || "all";
            data.storeLockedCategories = game.settings.get("cyberpunk-red-agent-os-modified", "storeLockedCategories") || "";
            data.storeBlacklist       = game.settings.get("cyberpunk-red-agent-os-modified", "storeBlacklistIds") || "";
            data.storeSourceOptions = [
                { id: "all",    label: "All (core + custom)" },
                { id: "core",   label: "Core / compendium only" },
                { id: "custom", label: "Custom items only" }
            ];
            // Parse blacklist as a list of entries for chip-style removal.
            data.storeBlacklistEntries = data.storeBlacklist
                .split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        } catch (e) {
            data.customStoreItemsRaw = "[]";
            data.customStorePacks = "";
            data.customStoreItemsParsed = [];
            data.availableStorePacks = [];
            data.storeMaxPrice = 0;
            data.storeSourceFilter = "all";
            data.storeLockedCategories = "";
            data.storeBlacklist = "";
            data.storeBlacklistEntries = [];
            data.storeSourceOptions = [];
        }

        // --- HARDWARE IDENTITY & BALANCES ---
        data.actorId = actor?.id || "VIRTUAL";
        data.actorUuid = this.actorUuid || "User." + game.user.id;
        data.actorRole = actor?.system?.externalData?.role || "Citizen";
        data.actorHandle = actor?.system?.externalData?.handle || game.user.name;
        data.actorIdShort = (actor?.id || game.user.id).substring(0, 8).toUpperCase();
        data.isVirtualWallet = isVirtualWallet;

        // Custom ID fields (user-editable overrides)
        const idOverrides = game.user.getFlag("cyberpunk-red-agent-os-modified", "idOverrides") || {};
        data.idSinStatus = idOverrides.sinStatus || "Registered";
        data.idClearance = idOverrides.clearance || "Verified";
        data.idSubtitle = idOverrides.subtitle || "Citizen Priority A+";
        data.idCustomHandle = idOverrides.handle || "";
        data.displayHandle = data.idCustomHandle || data.actorHandle;

        // --- AGENT ID VIEW: GM sees all players' cards, players see read-only own card ---
        data.canEditId = game.user.isGM;
        if (game.user.isGM) {
            // Build player list for GM's ID selector
            const idPlayers = game.users.filter(u => !u.isGM).map(u => {
                const uIdentity = this._getIdentity(u);
                const uActor = this._resolveActor(uIdentity);
                return { id: u.id, name: u.name, actorName: uActor?.name || u.name, img: uActor?.img || "icons/svg/mystery-man.svg" };
            });
            data.idPlayerList = idPlayers;
            // Default to first player if no target selected
            if (!this._idViewTargetUserId && idPlayers.length > 0) {
                this._idViewTargetUserId = idPlayers[0].id;
            }
            data.idTargetUserId = this._idViewTargetUserId;
            // Resolve target user's ID card data
            const targetUser = game.users.get(this._idViewTargetUserId);
            if (targetUser) {
                const tIdentity = this._getIdentity(targetUser);
                const tActor = this._resolveActor(tIdentity);
                const tOverrides = targetUser.getFlag("cyberpunk-red-agent-os-modified", "idOverrides") || {};
                // Patch4.5 (Aeroshifter): GM also sees the player's customised
                // displayName when reviewing their card, so the GM panel
                // matches what the player sees on their own device.
                data.idViewName = tOverrides.displayName || tActor?.name || targetUser.name;
                data.idViewRole = tActor?.system?.externalData?.role || "Citizen";
                data.idViewHandle = tOverrides.handle || tActor?.system?.externalData?.handle || targetUser.name;
                data.idViewIdShort = (tActor?.id || targetUser.id).substring(0, 8).toUpperCase();
                data.idViewSinStatus = tOverrides.sinStatus || "Registered";
                data.idViewClearance = tOverrides.clearance || "Verified";
                data.idViewSubtitle = tOverrides.subtitle || "Citizen Priority A+";
                data.idViewImg = tActor?.img || "icons/svg/mystery-man.svg";
            }
        } else {
            // Player sees own card — resolve directly from actor (actorName isn't set yet).
            // Patch4.5 (Aeroshifter request): owner can override the displayed
            // real name on their OWN ID card via idOverrides.displayName.
            // Public handle (what other players see in contacts / chat) is
            // unchanged — it uses idOverrides.handle separately. This lets a
            // netrunner show "Vincent Cross" on their own Global Registry
            // while still appearing as "GhostRunner" to everyone else.
            data.idViewName = idOverrides.displayName || actor?.name || game.user.name;
            data.idViewRole = data.actorRole;
            data.idViewHandle = data.displayHandle;
            data.idViewIdShort = data.actorIdShort;
            data.idViewSinStatus = data.idSinStatus;
            data.idViewClearance = data.idClearance;
            data.idViewSubtitle = data.idSubtitle;
            data.idViewImg = actor?.img || "icons/svg/mystery-man.svg";
        }

        // Patch4.5: in-phone modal state for Pay All Players (replaces
        // the immersion-breaking Foundry Dialog popup).
        data.showPayAllModal = !!this.showPayAllModal;

        // Patch4.8: attachment template picker state.
        data.showAttachPicker = !!this.showAttachPicker;
        data.attachKind = this._attachKind || "photo";
        // Modified build: staged (uploaded, not-yet-sent) attachment awaiting a
        // caption. Drives the preview chip above the composer.
        data.stagedAttachment = this._stagedAttachment
            ? {
                kind: this._stagedAttachment.kind,
                src: this._stagedAttachment.src,
                name: this._stagedAttachment.name,
                isImage: this._stagedAttachment.kind === 'photo',
                isAudio: this._stagedAttachment.kind === 'audio'
              }
            : null;

        // Patch4.8: new-group modal state + candidate lists.
        data.showNewGroup = !!this.showNewGroup;
        if (this.showNewGroup) {
            // Players visible to the current user (everyone but self).
            data.groupCandidatePlayers = game.users.filter(u => u.id !== game.user.id).map(u => ({
                id: u.id,
                name: (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name
            }));
            // NPC contacts the current user has on their device. GMs get the
            // union of their own NPCs plus any NPCs in other users' contact
            // lists (so they can pull anyone into a group).
            // Patch5.0.1 (Gotto): filter out existing groups (`isGroup` /
            // `isCustomGroup` / id starting with `pcgroup_`) from the
            // candidate list — only individual NPC contacts should appear
            // as group members.
            const isPickableNpc = (c) => c
                && !c.isPlayer
                && !c.isGroup
                && !c.isCustomGroup
                && !String(c.id || "").startsWith("pcgroup_")
                && c.id !== "party_group_chat";
            const myNpcs = (game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || []).filter(isPickableNpc);
            const seen = new Set(myNpcs.map(c => c.id));
            const npcs = myNpcs.map(c => ({ id: c.id, name: c.name }));
            if (game.user.isGM) {
                for (const u of game.users) {
                    if (u.id === game.user.id) continue;
                    const theirs = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                    for (const c of theirs) {
                        if (!isPickableNpc(c)) continue;
                        if (seen.has(c.id)) continue;
                        seen.add(c.id);
                        npcs.push({ id: c.id, name: c.name });
                    }
                }
            }
            data.groupCandidateNpcs = npcs;
        } else {
            data.groupCandidatePlayers = [];
            data.groupCandidateNpcs = [];
        }

        // Patch4.6: in-phone NPC-bid name prompt + generic confirm modal.
        data.showNpcBidModal = !!this.showNpcBidModal;
        data.showConfirmModal = !!this._pendingConfirm;
        if (this._pendingConfirm) {
            data.confirmModal = {
                title: this._pendingConfirm.title || "Confirm",
                message: this._pendingConfirm.message || "Are you sure?",
                confirmLabel: this._pendingConfirm.confirmLabel || "CONFIRM",
                accent: this._pendingConfirm.accent || "red" // red | cyan | gold
            };
        }

        // Patch4.5: in-phone modal state for the Edit Agent ID dialog.
        // Pre-populates the form with the currently-viewed target's overrides
        // so opening the modal mirrors what's currently saved.
        data.showIdEditModal = !!this.showIdEditModal;
        if (this.showIdEditModal) {
            const editTargetId = game.user.isGM ? this._idViewTargetUserId : game.user.id;
            const editTarget = game.users.get(editTargetId);
            const eOver = editTarget?.getFlag("cyberpunk-red-agent-os-modified", "idOverrides") || {};
            data.idEdit = {
                targetName: editTarget?.name || "—",
                displayName: eOver.displayName || "",
                handle: eOver.handle || "",
                subtitle: eOver.subtitle || "Citizen Priority A+",
                clearance: eOver.clearance || "Verified",
                sinStatus: eOver.sinStatus || "Registered"
            };
            data.idEditSinOptions = ["Registered", "No SIN", "Forged", "Nomad", "Corporate", "Classified"];
        }

        let actorCurrency = 0;
        let transactions = [];
        if (isVirtualWallet) {
            actorCurrency = this._getVirtualBalance(game.user).balance;
            transactions = game.user.getFlag("cyberpunk-red-agent-os-modified", "virtualWalletTransactions") || [];
            data.actorName = (this.actorUuid === "VirtualWallet") ? "System Fund (Master)" : (game.user.name + " (Digital)");
        } else {
            actorCurrency = this._getActorEurobucks(actor).balance;
            // CPR stores wealth transactions as [sentence, reason] tuples at
            // system.wealth.transactions (written by deltaLedgerProperty).
            // Fall back to our legacy AgentDevice.transactions flag for any
            // pre-CPR-sync entries.
            const cprLedger = foundry.utils.getProperty(actor, "system.wealth.transactions");
            if (Array.isArray(cprLedger) && cprLedger.length) {
                transactions = cprLedger.map((entry) => {
                    const sentence = Array.isArray(entry) ? (entry[0] || "") : String(entry);
                    const reason   = Array.isArray(entry) ? (entry[1] || "") : "";
                    const numMatch = sentence.match(/(-?\d+)/);
                    const amount   = numMatch ? Math.abs(Number(numMatch[1])) : 0;
                    // Direction priority: 1) our Agent reason 2) CPR keywords 3) numeric sign
                    let isPositive = null;
                    if (/^Agent:\s*To\b/i.test(reason)) isPositive = false;
                    else if (/^Agent:\s*From\b/i.test(reason)) isPositive = true;
                    if (isPositive === null) {
                        if (/decreased\s+by/i.test(sentence)) isPositive = false;
                        else if (/increased\s+by/i.test(sentence)) isPositive = true;
                    }
                    if (isPositive === null) {
                        isPositive = !!(numMatch && Number(numMatch[1]) > 0);
                    }
                    return { label: reason || sentence, amount, isPositive, date: "" };
                });
            } else {
                transactions = actor.getFlag("cyberpunk-red-agent-os-modified", "transactions") || [];
            }
            data.actorName = actor.name;
        }
        data.actorCurrencyRaw = Number(actorCurrency) || 0;
        data.actorCurrency = data.actorCurrencyRaw.toLocaleString();
        data.transactions = transactions.slice().reverse().slice(0, 10);

        // --- BIOMONITOR (TRAUMA TEAM) — Actor only ---
        if (actor instanceof Actor) {
            const hp = actor.system?.derivedStats?.hp || { value: 0, max: 0 };
            data.hpCurrent = hp.value;
            data.hpMax = hp.max;
            const clamp = Math.clamp ?? Math.clamped ?? ((v, lo, hi) => Math.max(lo, Math.min(hi, v)));
            data.hpPercent = clamp((hp.value / (hp.max || 1)) * 100, 0, 100);
            data.hpColor = data.hpPercent > 50 ? "#00ffcc" : (data.hpPercent > 25 ? "#ffcc00" : "#ff3333");
            data.woundState = data.hpPercent === 100 ? "Stable" : (data.hpPercent > 0 ? "Wounded" : "Critical");

            // Modified build: realistic pulse model. The body answers blood loss
            // and pain with tachycardia, so the lower the HP and the more critical
            // injuries, the faster the heart races. At 0 HP the heart has stopped
            // (flatline → 0 BPM).
            //   - resting baseline ~72 BPM at full HP
            //   - shock response: up to +90 BPM as HP falls toward (but above) 0
            //   - each critical injury: +7 BPM (pain/adrenaline), capped at +35
            //   - small live jitter so the readout breathes
            //   - clamped to a plausible 45–190 BPM band
            const critCount = (actor.itemTypes?.criticalInjury?.length)
                ?? actor.items?.filter?.(i => i.type === "criticalInjury").length
                ?? 0;
            data.criticalInjuryCount = critCount;
            if (data.hpCurrent <= 0) {
                data.pulseRate = 0;
            } else {
                const baseline = 72;
                const shock = (100 - data.hpPercent) * 0.9;        // 0 → +90 as HP drops
                const critBump = Math.min(critCount * 7, 35);      // pain/adrenaline, capped
                const jitter = Math.floor(Math.random() * 7) - 3;  // ±3 live wobble
                data.pulseRate = Math.round(clamp(baseline + shock + critBump + jitter, 45, 190));
            }

            // Humanity (cyberpsychosis tracker)
            const humanity = actor.system?.derivedStats?.humanity || { value: 0, max: 0 };
            data.humanityCurrent = humanity.value ?? 0;
            data.humanityMax = humanity.max ?? 0;
            data.humanityPercent = clamp((data.humanityCurrent / (data.humanityMax || 1)) * 100, 0, 100);
            data.humanityColor = data.humanityPercent > 50 ? "#e040fb" : (data.humanityPercent > 25 ? "#ffcc00" : "#ff3333");
            data.humanityStatus = data.humanityPercent > 75 ? "Stable" : (data.humanityPercent > 50 ? "Stressed" : (data.humanityPercent > 25 ? "Unstable" : "CYBERPSYCHOSIS RISK"));
        } else {
            data.hpCurrent = 100; data.hpMax = 100; data.hpPercent = 100;
            data.hpColor = "#00ffcc"; data.woundState = "System Stable"; data.pulseRate = 72;
            data.criticalInjuryCount = 0;
            data.humanityCurrent = 40; data.humanityMax = 40; data.humanityPercent = 100;
            data.humanityColor = "#e040fb"; data.humanityStatus = "Stable";
        }

        // Patch4.7 (Gotto): Trauma Team coverage. Per-user flag (`ttCoverage`).
        // Empty / falsy = no coverage (panic button hidden, REO Meatwagon note).
        // Non-empty = coverage active, the value is the tier label shown on the
        // button (Bronze / Silver / Gold / Platinum / custom string).
        const ttRaw = game.user.getFlag("cyberpunk-red-agent-os-modified", "ttCoverage");
        data.isTraumaTeamClient = !!(ttRaw && String(ttRaw).trim().length);
        data.traumaTeamTier = data.isTraumaTeamClient ? String(ttRaw).trim() : "NONE";

        // --- REPUTATION (NetStatus) ---
        // Reads from a flag for portability across CPR sheet versions.
        // Falls back to system.reputation.value if the system exposes it.
        const repFlag = (actor instanceof Actor)
            ? actor.getFlag("cyberpunk-red-agent-os-modified", "repScore")
            : game.user.getFlag("cyberpunk-red-agent-os-modified", "repScore");
        const repSys = (actor instanceof Actor)
            ? foundry.utils.getProperty(actor, "system.reputation.value")
            : undefined;
        const repScore = Number(repFlag ?? repSys ?? 0) || 0;
        data.repScore = repScore;
        data.repRank = repScore >= 80 ? "Legend"
            : repScore >= 50 ? "Rep+"
            : repScore >= 20 ? "Streetwise"
            : repScore >= 5  ? "Known"
            : "Nobody";

        // --- APPS & PERMISSIONS ---
        const ICON_BASE = "modules/cyberpunk-red-agent-os-modified/assets/cyberpunk-holophone/icons";
        const is2077 = (data.uiSkin === "2077");
        data.allApps = [
            { id: 'chat',   label: 'MESSENGER', icon: 'fas fa-comment-dots',   color: 'var(--neon-cyan)',   iconImg: is2077 ? `${ICON_BASE}/chat.png`   : null },
            { id: 'data',   label: 'DATAPOOL',  icon: 'fas fa-database',       color: 'var(--neon-cyan)',   iconImg: is2077 ? `${ICON_BASE}/data.png`   : null },
            { id: 'creds',  label: 'WALLET',    icon: 'fas fa-wallet',         color: 'var(--creds-gold)',  iconImg: is2077 ? `${ICON_BASE}/creds.png`  : null },
            { id: 'map',    label: 'SAT MAP',   icon: 'fas fa-map-marked-alt', color: 'var(--neon-yellow)', iconImg: is2077 ? `${ICON_BASE}/map.png`    : null },
            { id: 'bio',    label: 'BIOMON',    icon: 'fas fa-heartbeat',      color: '#ff3333',            iconImg: is2077 ? `${ICON_BASE}/bio.png`    : null },
            { id: 'store',  label: 'NC MART',   icon: 'fas fa-shopping-cart',  color: '#00ffcc',            iconImg: is2077 ? `${ICON_BASE}/optics.png` : null },
            { id: 'id',     label: 'AGENT ID',  icon: 'fas fa-id-card',        color: '#4488ff',            iconImg: is2077 ? `${ICON_BASE}/id.png`     : null },
            // Modified build (П4): personal CONTACTS app — every player keeps their
            // own contact list; the GM sees everyone's, grouped per player.
            { id: 'contacts', label: 'CONTACTS', icon: 'fas fa-address-book',   color: '#39d98a',            iconImg: null },
            // Modified build: SOCIAL and BLACK MKT (auction) tabs removed from the
            // home screen per request. The view templates and handlers are left
            // intact (dead-but-harmless) so they can be re-enabled by adding the
            // entries back here.
            // { id: 'social', label: 'SOCIAL',    icon: 'fas fa-share-alt',      color: '#ff9900',            iconImg: is2077 ? `${ICON_BASE}/social.png` : null },
            { id: 'style',  label: 'STYLE',     icon: 'fas fa-tshirt',         color: '#e040fb',            iconImg: is2077 ? `${ICON_BASE}/style.png`  : null },
            { id: 'rep',    label: 'FIXERS',    icon: 'fas fa-handshake',      color: '#64ffda',            iconImg: is2077 ? `${ICON_BASE}/rep.png`    : null },
            // { id: 'auction',label: 'BLACK MKT', icon: 'fas fa-gavel',          color: '#ff6e40',            iconImg: is2077 ? `${ICON_BASE}/auction.png`: null },
            // Patch5.5 apps (Black Chrome / All About Agents inspired)
            // Patch5.5.3 canon tune: NCPD law-enforcement neon blue (matches in-fiction
            //   NCPD database UI hue), Ziggurat deep Arasaka-tower violet + data-fortress
            //   icon (Ziggurat is a Net data tower in 2077 lore, not a city skyline),
            //   The Garden Cyberpunk neon magenta (Black Chrome / Edgerunner dating palette).
            { id: 'ncpd',   label: 'NCPD DB',   icon: 'fas fa-fingerprint',    color: '#3a86ff',            iconImg: null },
            { id: 'ziggurat', label: 'ZIGGURAT', icon: 'fas fa-database',      color: '#7c4dff',            iconImg: null },
            { id: 'garden', label: 'THE GARDEN',icon: 'fas fa-seedling',       color: '#ff1493',            iconImg: null }
        ];
        // Modified build (П3): localize app labels. Falls back to the built-in
        // English label when a translation key is missing for the active language.
        for (const a of data.allApps) {
            const key = `AGENTOS.App.${a.id}`;
            const loc = game.i18n.localize(key);
            if (loc && loc !== key) a.label = loc;
        }
        data.adminIconImg = is2077 ? `${ICON_BASE}/admin.png` : null;
        // Patch5.5: new apps default to ON for new tables. GM can toggle off via Sys Admin → Application Access.
        // Modified build: 'social' and 'auction' removed from defaults (tabs hidden).
        const defaultApps = ['chat', 'data', 'creds', 'map', 'id', 'contacts', 'bio', 'store', 'style', 'rep', 'ncpd', 'ziggurat', 'garden'];

        // Patch4 round 2: app-lock toggles use their OWN flag owner derived
        // from `_appLockPlayerUuid`, NOT the GM's `actorUuid`. This is the key
        // scope fix — tabs only affect Application Access, nothing else.
        let appLockFlagOwner = null;
        if (game.user.isGM) {
            const tabUuid = this._appLockPlayerUuid || "VirtualWallet";
            if (tabUuid === "VirtualWallet") {
                appLockFlagOwner = game.user; // GM's own flags
            } else if (tabUuid.startsWith("User.")) {
                appLockFlagOwner = game.users.get(tabUuid.split(".")[1]) || game.user;
            } else {
                appLockFlagOwner = this._resolveActor(tabUuid) || game.user;
            }
        } else {
            // Player view — they see their own character's app-locks
            appLockFlagOwner = (actor instanceof Actor) ? actor : game.user;
        }
        // Patch5.5.19: use a one-time migration marker instead of the previous
        // heuristic. The 5.5.18 logic (detect new-5.5 app in saved set → trust
        // saved) had its own bug: when GM toggled a new app OFF, saved no longer
        // contained it, the heuristic thought the user was pre-5.5, and the
        // union re-added the app. End result was the toggle off didn't stick.
        //
        // New approach: per-owner `unlockedAppsMigrated5_5` flag. The first
        // time this code runs for an owner with a saved set, merge new defaults
        // in AND set the flag. From then on, saved set is always authoritative.
        // Both the "off after upgrade" and "fresh post-5.5" cases work right.
        const savedUnlocked = appLockFlagOwner.getFlag("cyberpunk-red-agent-os-modified", "unlockedApps");
        const hasMigrated = !!appLockFlagOwner.getFlag("cyberpunk-red-agent-os-modified", "unlockedAppsMigrated5_5");
        if (Array.isArray(savedUnlocked) && savedUnlocked.length > 0) {
            if (hasMigrated) {
                // Saved is canonical — respect GM toggles in both directions.
                data.unlockedApps = savedUnlocked;
            } else {
                // First post-5.5 render — merge new defaults, write back, set marker.
                const missing = defaultApps.filter(a => !savedUnlocked.includes(a));
                const merged = missing.length > 0 ? [...savedUnlocked, ...missing] : savedUnlocked;
                data.unlockedApps = merged;
                // Persist the merged set + migration marker. Fire-and-forget;
                // any error here doesn't block the render.
                if (game.user.isGM || appLockFlagOwner.id === game.user.id) {
                    try {
                        appLockFlagOwner.setFlag("cyberpunk-red-agent-os-modified", "unlockedApps", merged);
                        appLockFlagOwner.setFlag("cyberpunk-red-agent-os-modified", "unlockedAppsMigrated5_5", true);
                    } catch (e) { /* read-only render context — fine */ }
                }
            }
        } else {
            data.unlockedApps = defaultApps;
        }
        data.appLockOwnerName = (appLockFlagOwner instanceof Actor)
            ? appLockFlagOwner.name
            : (appLockFlagOwner.id === game.user.id ? "GM (self)" : appLockFlagOwner.name);

        // Patch4 round 2: tabs are now scoped to the Application Access section
        // only — they drive `_appLockPlayerUuid`, NOT `selectedAdminActorUuid`.
        // GM identity / wallet view / transfer source are not affected by tab
        // clicks here. First tab is always "GM (self)" (the GM's own flags);
        // remaining tabs are each non-GM user.
        if (game.user.isGM) {
            const _adminTabs = [];
            _adminTabs.push({
                uuid: "VirtualWallet",
                name: "GM (self)",
                actorName: null,
                isGM: true,
                isActive: (this._appLockPlayerUuid === "VirtualWallet" || !this._appLockPlayerUuid)
            });
            for (const u of game.users.filter(x => !x.isGM)) {
                const identity = this._getIdentity(u);
                if (!identity || identity === "VirtualWallet" || identity.startsWith("User.")) {
                    _adminTabs.push({
                        uuid: `User.${u.id}`,
                        name: (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name,
                        actorName: null,
                        isGM: false,
                        noActor: true,
                        isActive: this._appLockPlayerUuid === `User.${u.id}`
                    });
                    continue;
                }
                const playerActor = this._resolveActor(identity);
                _adminTabs.push({
                    uuid: identity,
                    name: (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name,
                    actorName: playerActor?.name || null,
                    isGM: false,
                    isActive: this._appLockPlayerUuid === identity
                });
            }
            data.adminAppLockTabs = _adminTabs;

            // Patch4.7 (Gotto): wallet identity tabs. Lets the GM swap into a
            // player's wallet view from Sys Admin (the previous tabs only
            // scoped Application Access, not wallet). Same shape as the
            // app-access tabs so the existing CSS layout reuses cleanly.
            const _walletTabs = [];
            const activeWalletUuid = this.selectedAdminActorUuid || "VirtualWallet";
            _walletTabs.push({
                uuid: "VirtualWallet",
                name: "System Fund (Master)",
                actorName: null,
                isGM: true,
                isActive: activeWalletUuid === "VirtualWallet"
            });
            for (const u of game.users.filter(x => !x.isGM)) {
                const identity = this._getIdentity(u);
                if (!identity || identity === "VirtualWallet" || identity.startsWith("User.")) continue;
                const playerActor = this._resolveActor(identity);
                _walletTabs.push({
                    uuid: identity,
                    name: (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name,
                    actorName: playerActor?.name || null,
                    isGM: false,
                    isActive: activeWalletUuid === identity
                });
            }
            data.adminWalletTabs = _walletTabs;

            // Patch4.7 (Gotto): per-player Trauma Team coverage + Fixer rank.
            // Patch5.5.19 (Phil Sweet): housing is now per-CHARACTER. The roster
            // iterates each player's owned character actors so a player running
            // multiple chars gets one row per character. TT coverage + Fixer rank
            // stay per-user.
            data.adminTtCoverage = [];
            data.adminHousingRoster = [];
            for (const u of game.users.filter(uu => !uu.isGM)) {
                const handle = (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name;
                data.adminTtCoverage.push({
                    userId: u.id,
                    name: handle,
                    tier: u.getFlag("cyberpunk-red-agent-os-modified", "ttCoverage") || "",
                    fixerRank: Number(u.getFlag("cyberpunk-red-agent-os-modified", "fixerRank")) || 0
                });
                // Find this user's character actors. Foundry: ownership.<userId> >= 3 = owner.
                const ownedActors = game.actors.filter(a => {
                    const lvl = a.ownership?.[u.id];
                    return lvl !== undefined && lvl >= 3 && a.type !== 'mook' && a.type !== 'blackIce';
                });
                if (ownedActors.length === 0) {
                    // No character — legacy user-level housing only
                    data.adminHousingRoster.push({
                        ownerKind: 'user', ownerId: u.id, userId: u.id,
                        name: handle,
                        housingStatus: u.getFlag("cyberpunk-red-agent-os-modified", "housingStatus") || "",
                        housingRent: u.getFlag("cyberpunk-red-agent-os-modified", "housingRent") || ""
                    });
                } else {
                    for (const a of ownedActors) {
                        data.adminHousingRoster.push({
                            ownerKind: 'actor', ownerId: a.id, userId: u.id, actorUuid: a.uuid,
                            name: `${handle} → ${a.name}`,
                            housingStatus: a.getFlag("cyberpunk-red-agent-os-modified", "housingStatus")
                                || u.getFlag("cyberpunk-red-agent-os-modified", "housingStatus") || "",
                            housingRent: a.getFlag("cyberpunk-red-agent-os-modified", "housingRent")
                                || u.getFlag("cyberpunk-red-agent-os-modified", "housingRent") || ""
                        });
                    }
                }
            }
        } else {
            data.adminAppLockTabs = [];
            data.adminWalletTabs = [];
            data.adminTtCoverage = [];
        }

        const rawUnreads = game.user.getFlag("cyberpunk-red-agent-os-modified", "unreads") || {};
        data.hideOnlineStatus = game.user.getFlag("cyberpunk-red-agent-os-modified", "hideOnlineStatus") || false;

        // --- CONTACTS & MESSAGING ---
        data.contacts = this._getContacts();
        // 5.5.23: sort the Messages home list by most-recent activity
        // (newest thread on top), matching iOS / WhatsApp / Signal etc. Old
        // order was stable-by-insertion which made it hard to spot which
        // thread had a new message in a busy party. Computed via a single
        // O(messages) pass that buckets each AgentDevice message into the
        // contact it belongs to *from this user's perspective*. Ties (same
        // timestamp or both at 0) preserve original insertion order — keeps
        // the no-activity default reading as Party first, players next,
        // custom NPCs after.
        const _lastActivityByContact = {};
        try {
            const selfId = game.user.id;
            const isGmUser = game.user.isGM;
            for (const m of game.messages) {
                const f = m.flags?.["cyberpunk-red-agent-os-modified"];
                if (!f?.isAgentMessage) continue;
                const tid = f.threadId;
                if (!tid) continue;
                const ts = m.timestamp || 0;
                let bucket = null;
                if (tid === "party_group_chat") {
                    bucket = "party_group_chat";
                } else if (String(tid).startsWith("pcgroup_") || String(tid).startsWith("npc_")) {
                    bucket = tid;
                } else {
                    // 1-to-1 PC DM: threadId is the recipient's user id.
                    // Bucket from this client's perspective:
                    //  - my outgoing message -> bucket = the other PC (threadId)
                    //  - incoming whispered to me -> bucket = the sender (author.id)
                    //  - GM monitoring -> bucket on threadId (the recipient PC)
                    const authorId = m.author?.id;
                    const w = Array.isArray(m.whisper) ? m.whisper : [];
                    if (authorId === selfId) {
                        bucket = tid;
                    } else if (w.includes(selfId)) {
                        bucket = authorId;
                    } else if (isGmUser) {
                        bucket = tid;
                    }
                }
                if (bucket && ts > (_lastActivityByContact[bucket] || 0)) {
                    _lastActivityByContact[bucket] = ts;
                }
            }
        } catch (e) {
            console.warn("[Agent OS] Messages home activity-sort scan failed:", e);
        }
        // Stable sort by descending activity (Array.sort is stable in V8/SM).
        data.contacts.sort((a, b) => {
            const ta = _lastActivityByContact[a.id] || 0;
            const tb = _lastActivityByContact[b.id] || 0;
            return tb - ta;
        });
        // Patch4.7 (Gotto Goho ghost-notification fix): the home-screen badge
        // used to sum Object.values(unreads), which includes orphan threadIds
        // left behind when a contact was deleted. Now we filter against the
        // current contacts list before summing — orphans contribute 0.
        // Patch4.7.1 (urgent): previously this also wrote a cleaned `unreads`
        // flag back via `setFlag` from inside getData. With Simple Calendar
        // running on an unpaused game, the SC `date-time-change` hook re-
        // renders the Agent multiple times per second, each render fired
        // a setFlag, which fired updateUser, which fired more renders. The
        // resulting thrash unbound click handlers faster than the user could
        // click them ("clicks unregistered while unpaused"). Display filter
        // is enough — orphans staying in the flag are invisible to the user.
        // Actual cleanup runs in the contact-delete handler (line ~1924).
        const validIds = new Set(data.contacts.map(c => c.id));
        const unreads = {};
        for (const [tid, n] of Object.entries(rawUnreads)) {
            if (validIds.has(tid)) unreads[tid] = n;
        }
        data.totalUnreads = Object.values(unreads).reduce((a, b) => a + b, 0);
        data.contacts.forEach(c => { c.unreads = unreads[c.id] || 0; });
        data.partyPlayers = game.users.filter(u => u.id !== game.user.id).map(u => {
            const identity = this._getIdentity(u);
            const actor = this._resolveActor(identity);
            return { id: u.id, name: (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name, actorUuid: identity, actorName: actor?.name || null };
        });

        // Patch4 (Gotto Goho bug): GM used to auto-default to the FIRST PLAYER's
        // identity on initial open — which meant the GM's own wallet view showed
        // the first player's balance, not their own. Removed. GM now starts as
        // themselves (VirtualWallet) and explicitly switches into a player via
        // the new Sys Admin per-player tabs when they need to act as that player.
        if (game.user.isGM && this.selectedAdminActorUuid === null) {
            this.selectedAdminActorUuid = "VirtualWallet";
            data.selectedAdminActorUuid = "VirtualWallet";
        }

        const activeContact = data.contacts.find(c => c.id === this.activeContactId);
        data.activeContactName = activeContact ? activeContact.name : "Unknown Endpoint";
        // Patch2: surface group-chat flag so the template can show sender names
        // on every bubble (including the user's own), which players asked for
        // when reviewing the party feed.
        data.isGroupChat = !!(activeContact?.isGroup);

        // GM NPC identity indicator — show which NPC persona the GM is speaking as
        const isNpcThread = this.activeContactId?.startsWith("npc_");
        const isCustomGroupThread = !!(activeContact?.isCustomGroup);

        // Patch4.8.3 (player request): in a custom group thread with multiple
        // NPC members, the GM had no way to pick which NPC their messages came
        // from. They always sent as GM. Build a "speak as" picker option list
        // here — for single-NPC threads we keep the existing implicit behavior
        // (always that NPC). For multi-NPC group threads we expose every NPC
        // member plus a "GM (self)" entry. The picker writes to
        // `_gmSpeakingAsInThread[threadId]` so the choice sticks per-thread
        // while the app is open.
        this._gmSpeakingAsInThread = this._gmSpeakingAsInThread || {};
        data.gmGroupNpcVoices = [];
        if (game.user.isGM && isCustomGroupThread) {
            const members = Array.isArray(activeContact?.members) ? activeContact.members : [];
            // Look up each NPC member's contact metadata from any user's customContacts.
            const allCustomContacts = [];
            for (const u of game.users) {
                const list = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                for (const c of list) allCustomContacts.push(c);
            }
            const npcMembers = members
                .filter(m => m.startsWith("npc:"))
                .map(m => m.slice("npc:".length));
            const seen = new Set();
            const voices = [{ id: "gm", name: "GM (self)", avatar: "" }];
            for (const npcId of npcMembers) {
                if (seen.has(npcId)) continue;
                seen.add(npcId);
                const contact = allCustomContacts.find(c => c.id === npcId);
                voices.push({
                    id: npcId,
                    name: contact?.originalName || contact?.name || "Unknown NPC",
                    avatar: contact?.avatar || ""
                });
            }
            // Only meaningful if there are ≥2 NPCs (otherwise the single-NPC
            // path already implicitly speaks as that NPC).
            if (npcMembers.length >= 2) {
                data.gmGroupNpcVoices = voices;
                data.gmCurrentVoice = this._gmSpeakingAsInThread[this.activeContactId] || "gm";
            }
        }

        // SPEAKING AS label — for single-NPC threads (existing 4.7 behavior),
        // and for multi-NPC group threads when the GM has picked an NPC voice.
        if (game.user.isGM && isNpcThread && activeContact) {
            data.gmSpeakingAs = activeContact.originalName || activeContact.name;
        } else if (game.user.isGM && isCustomGroupThread && data.gmGroupNpcVoices.length > 0) {
            const cur = this._gmSpeakingAsInThread[this.activeContactId] || "gm";
            if (cur !== "gm") {
                const match = data.gmGroupNpcVoices.find(v => v.id === cur);
                data.gmSpeakingAs = match?.name || null;
            } else {
                data.gmSpeakingAs = null;
            }
        } else {
            data.gmSpeakingAs = null;
        }

        // Patch4 (Gotto Goho): when the GM is in an NPC thread, also surface
        // WHO the NPC is speaking TO. Previously only "SPEAKING AS: <persona>"
        // was shown, so the GM had to manually rename threads to remember the
        // intended recipient. Now we read the contact's `targetUserIds` and
        // resolve them to display names. Players don't need this (their POV
        // is implicit — the recipient is themselves).
        data.gmSpeakingTo = null;
        if (game.user.isGM && isNpcThread && activeContact) {
            const tList = Array.isArray(activeContact.targetUserIds) ? activeContact.targetUserIds : [];
            const owner = activeContact.ownerId ? [activeContact.ownerId] : [];
            const recipientIds = Array.from(new Set([...tList, ...owner]));
            const names = recipientIds
                .map(id => game.users.get(id))
                .filter(u => u && !u.isGM)
                .map(u => (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name);
            if (names.length) data.gmSpeakingTo = names.join(", ");
        }

        // Patch4 (Ley): privacy indicator. Players were confused whether their
        // messages were private or visible to the whole table. Surface the
        // privacy mode clearly in the header so the user can tell at a glance.
        //   group         → visible to everyone (party chat)
        //   private       → 1-1 with another user (whisper only)
        //   npc-private   → player↔NPC (whispered to GMs, hidden from other players)
        //   npc-group     → GM acting as NPC, sent to multiple targets
        data.privacyMode = null;
        data.privacyLabel = null;
        if (this.activeContactId === 'party_group_chat') {
            data.privacyMode = "group";
            data.privacyLabel = "PARTY CHAT · EVERYONE READS";
        } else if (this.activeContactId?.startsWith("pcgroup_") || activeContact?.isCustomGroup) {
            // Patch4.8: custom group thread — readable by every member + GMs.
            data.privacyMode = "group";
            const memberCount = (activeContact?.members?.length || 0) + 1; // +1 for the creator
            data.privacyLabel = `GROUP CHAT · ${memberCount} MEMBERS + GM`;
        } else if (this.activeContactId && game.users.get(this.activeContactId)) {
            data.privacyMode = "private";
            const targetU = game.users.get(this.activeContactId);
            const targetName = (targetU?.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || targetU?.name || "recipient";
            // Patch4.7 (Gotto): tighten wording. Players were unsure whether
            // "PRIVATE · X only (GMs can read)" meant "ONLY X+GM can read" or
            // "X+GM plus maybe others". Explicit "ONLY YOU + " + recipient + " + GM" leaves no room.
            data.privacyLabel = `ONLY YOU + ${targetName} + GM`;
        } else if (isNpcThread) {
            // Patch5.0.1 (Gotto): if the NPC contact was distributed to
            // multiple PCs (GM ticked >1 box when creating), the thread
            // looks "private" but isn't — every other PC on `targetUserIds`
            // also receives the messages. Surface the co-recipients in the
            // label so nobody believes they're 1-to-1 when they aren't.
            const tList = Array.isArray(activeContact?.targetUserIds) ? activeContact.targetUserIds : [];
            const coRecipientIds = tList.filter(uid => uid !== game.user.id && !game.users.get(uid)?.isGM);
            const coNames = coRecipientIds
                .map(uid => game.users.get(uid))
                .filter(u => u)
                .map(u => (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name);
            data.privacyMode = "npc-private";
            if (coNames.length > 0) {
                data.privacyLabel = `NPC CHANNEL · YOU + ${coNames.join(", ")} + GM`;
            } else {
                data.privacyLabel = "ONLY YOU + GM · NPC CHANNEL";
            }
        }

        // Group participants — surface who's actually on the channel so players
        // know who they're writing to. Beta4 feedback: group chat felt anonymous.
        data.activeParticipants = null;
        data.activeParticipantsLabel = null;
        if (activeContact?.isGroup && this.activeContactId === 'party_group_chat') {
            const participants = game.users
                .filter(u => u.active)
                .map(u => {
                    const idOver = u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides") || {};
                    // Patch4 round 6: same avatar fix as message bubbles —
                    // prefer character portrait over user profile pic.
                    const avatar = u.character?.img || u.avatar || "icons/svg/mystery-man.svg";
                    return {
                        id: u.id,
                        name: idOver.handle || u.name,
                        isSelf: u.id === game.user.id,
                        isGM: u.isGM,
                        avatar: avatar,
                        color: u.color || null
                    };
                })
                // Stable order: self first, then GMs, then alphabetical.
                .sort((a, b) => {
                    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
                    if (a.isGM !== b.isGM) return a.isGM ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
            data.activeParticipants = participants;
            data.activeParticipantsLabel = participants.map(p => p.name).join(", ");
        }

        // Message Thread Resolution
        if (this.activeContactId) {
            // Patch5.0.1 (Gotto): tightened thread matching to prevent bleed
            // between threads. Custom group threads, NPC threads, and party
            // chat now use EXACT threadId match only — no whisper-based
            // fallback. The whisper fallback is only for 1-to-1 DM threads
            // (legacy compat) and is gated so it can't bleed pcgroup_*,
            // npc_*, or 'party_group_chat' messages into the wrong view.
            const isPcGroupThread = this.activeContactId.startsWith("pcgroup_");
            const isNpcThreadView = this.activeContactId.startsWith("npc_");
            const isPartyChatView = this.activeContactId === 'party_group_chat';
            data.messages = game.messages.filter(m => {
                const flags = m.flags?.["cyberpunk-red-agent-os-modified"];
                if (!flags?.isAgentMessage) return false;
                // Strict-match views: exact threadId only.
                if (isPartyChatView)  return flags.threadId === 'party_group_chat';
                if (isPcGroupThread)  return flags.threadId === this.activeContactId;
                if (isNpcThreadView)  return flags.threadId === this.activeContactId;
                // 1-to-1 DM view: activeContactId is a user id.
                // 5.5.22 (CommanderCrunch69 privacy bug): the threadId match
                // used to be `flags.threadId === this.activeContactId` with
                // no author/whisper gate. Senders set threadId = recipient's
                // user.id, so any third-party PC viewing their own thread
                // with the same recipient matched here and leaked the DM.
                // Foundry pushes ChatMessage docs to every client regardless
                // of whisper visibility, so `game.messages.filter()` saw
                // them on uninvolved clients. Restricted to outgoing (author
                // === self) only. The whisper fallback below handles the
                // incoming branch with proper visibility checks.
                if (flags.threadId === this.activeContactId && m.author?.id === game.user.id) return true;
                if (m.whisper && m.whisper.length > 0) {
                    if (flags.threadId && flags.threadId.startsWith('npc_')) return false;
                    if (flags.threadId && flags.threadId.startsWith('pcgroup_')) return false;
                    if (flags.threadId === 'party_group_chat') return false;
                    if (m.whisper.includes(this.activeContactId) && m.author?.id === game.user.id) return true;
                    if (m.whisper.includes(game.user.id) && m.author?.id === this.activeContactId) return true;
                }
                return false;
            }).map(m => {
                const realAuthorIsSelf = m.author?.id === game.user.id;
                const sender = m.author || game.users.find(u => u.name === m.alias);
                const flags = m.flags?.["cyberpunk-red-agent-os-modified"] || {};
                // NPC identity override — show NPC name + avatar instead of GM's
                // For player messages, prefer custom handle from Agent ID
                const authorHandleOverride = m.author ? (m.author.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle || "") : "";
                const displayName = flags.overrideName || authorHandleOverride || m.alias || m.author?.name || "Unknown";
                // Patch4 round 6 (CommanderCrunch69): PC avatars weren't showing
                // in group chat or PC→NPC threads because the fallback used
                // `User.avatar` (Foundry profile pic) which most players never
                // bother setting — so all bubbles fell to the default icon.
                // Now prefers the player's assigned CHARACTER portrait, which
                // is what the player actually identifies with at the table.
                // Patch4.7 (Gotto Goho follow-up): even with that fix, GMs were
                // STILL seeing default tokens for PCs. Root cause: `User#character`
                // returns the actor assigned in Foundry's user-management dialog,
                // which most groups never bother setting — they switch into their
                // PC in the agent's in-phone switcher instead. So `sender.character`
                // was null and we fell through to `user.avatar` (also unset) and
                // ended at the mystery-man default. Fix: also check the sender's
                // last-used Agent identity (`lastActorUuid` flag) and resolve that
                // actor's portrait. Fallback order: NPC override → user.character
                // → in-app PC identity → user profile pic → default icon.
                let senderCharImg = sender?.character?.img || "";
                if (!senderCharImg && sender) {
                    const senderAgentUuid = sender.getFlag?.("cyberpunk-red-agent-os-modified", "lastActorUuid");
                    if (senderAgentUuid && senderAgentUuid !== "VirtualWallet") {
                        try {
                            const senderActor = this._resolveActor(senderAgentUuid);
                            if (senderActor?.img) senderCharImg = senderActor.img;
                        } catch (e) {}
                    }
                }
                // 5.5.22 (CommanderCrunch69): when an NPC bubble has no
                // overrideAvatar (player started the thread, GM's switchboard
                // contact has no image, etc.), try to resolve a same-named
                // world Actor's portrait before falling through to the
                // generic mystery-man icon. Cheap O(N actors) lookup; the
                // result is short-circuited if overrideAvatar already exists.
                let npcActorImg = "";
                if (!flags.overrideAvatar && flags.overrideName) {
                    const cleanNpcName = String(flags.overrideName)
                        .replace(/\s*\(via\s+[^)]+\)\s*$/i, "")
                        .trim();
                    if (cleanNpcName) {
                        try {
                            const npcActorMatch = game.actors?.find?.(a => a.name === cleanNpcName);
                            if (npcActorMatch?.img && npcActorMatch.img !== "icons/svg/mystery-man.svg") {
                                npcActorImg = npcActorMatch.img;
                            }
                        } catch (e) { /* lookup failed, fall through */ }
                    }
                }
                const displayAvatar = flags.overrideAvatar
                    || npcActorImg
                    || senderCharImg
                    || sender?.avatar
                    || "icons/svg/mystery-man.svg";

                // Patch4 round 6 (CommanderCrunch69 NPC avatar bug):
                // When the GM is in an NPC thread and sees their own NPC-mode
                // messages, those messages have `overrideAvatar` set to the
                // NPC's avatar. The old logic flagged them as `isSelf: true`
                // (because the real author IS the GM), and the template only
                // renders avatars on non-self bubbles — so the GM saw their
                // NPC bubbles on the right with no avatar, while players saw
                // them on the left WITH the NPC avatar. Two different views
                // of the same conversation.
                // Fix: when a message has `overrideAvatar` (i.e. it's a GM
                // roleplay message), treat it as "from the NPC" for layout
                // purposes — left-aligned, NPC avatar, NPC name. Persona-style
                // dialogue, matches what the player sees, makes the
                // conversation read correctly on both sides.
                // Patch5.5.4 audit catch: overrideName alone (voice override
                // with no avatar swap) was missed by the original check, so
                // the 5.5.3 isMultiPersonaThread flag never fired for those
                // threads. Broaden to either flag — any persona override
                // signals "this is an NPC bubble, treat as roleplay."
                const isNpcRoleplayMsg = !!(flags.overrideAvatar || flags.overrideName);
                const isSelf = isNpcRoleplayMsg ? false : realAuthorIsSelf;

                // Patch4.8: surface attachment metadata so the bubble template
                // can render the styled card instead of raw placeholder text.
                // Modified build (П4): an attachment may now carry a real file
                // `src` (image / gif / audio). When present the template renders
                // the actual media; otherwise it falls back to the RP card.
                const att = flags.attachment;
                let attachment = null;
                if (att && typeof att === 'object' && att.kind) {
                    const kind = String(att.kind);
                    attachment = {
                        kind,
                        desc: String(att.desc || ""),
                        icon: kind === 'photo' ? 'fa-camera' : kind === 'video' ? 'fa-video' : 'fa-microphone',
                        src: att.src ? String(att.src) : null,
                        isImage: kind === 'photo' && !!att.src,
                        isAudio: kind === 'audio' && !!att.src
                    };
                    // An attachment with neither a description nor a file is noise — drop it.
                    if (!attachment.desc && !attachment.src) attachment = null;
                }

                // Patch5.0.1 (Gotto): voice-hash color for the sender name.
                // In multi-NPC group threads, players need to tell at a glance
                // which NPC just spoke. Hash the override name (or sender id)
                // to a stable hue and tint the sender label that color, so
                // each NPC voice reads visually distinct even when several
                // are rapid-fire texting in the same thread.
                let senderHue = 0;
                const hueSrc = String(flags.overrideName || displayName || "Unknown");
                for (let i = 0; i < hueSrc.length; i++) senderHue = (senderHue * 31 + hueSrc.charCodeAt(i)) % 360;
                const senderColor = `hsl(${senderHue}, 70%, 65%)`;

                // Patch5.5.3: personaKey distinguishes GM-puppeted NPCs from
                // each other. Without this, NPC1 / NPC2 / NPC1 all share the
                // GM's senderId, so the consecutive-message logic collapses
                // them into one run and hides avatars + speaker tags. The
                // key is "npc:<overrideName>" when a voice override is set,
                // otherwise it's the raw user id.
                const personaKey = flags.overrideName
                    ? `npc:${flags.overrideName}`
                    : `user:${m.author?.id}`;

                return {
                    id: m.id,
                    content: m.content,
                    sender: displayName,
                    senderColor,
                    senderId: m.author?.id,
                    personaKey,
                    isNpcRoleplay: isNpcRoleplayMsg,
                    isSelf: isSelf,
                    // Delete permission still tracks the real author so the
                    // GM can clean up their own NPC messages.
                    canDelete: realAuthorIsSelf || game.user.isGM,
                    timestamp: m.timestamp,
                    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    avatar: displayAvatar,
                    attachment
                };
            });

            if (data.messages.length > 0) {
                const TWO_MIN = 2 * 60 * 1000;
                const FIVE_MIN = 5 * 60 * 1000;
                // Patch5.5.3: a thread is "multi-persona" if any message in it
                // used a GM voice override. Force-tag the speaker on every
                // bubble in multi-persona threads so players can attribute
                // each line without scrolling up to find the last name change.
                const isMultiPersonaThread = data.messages.some(m => m.isNpcRoleplay);
                let prevDayKey = null;
                for (let i = 0; i < data.messages.length; i++) {
                    const cur = data.messages[i];
                    const prev = i > 0 ? data.messages[i - 1] : null;
                    const next = data.messages[i + 1];
                    const dayKey = new Date(cur.timestamp).toDateString();
                    if (dayKey !== prevDayKey) {
                        cur.dayDivider = AgentOSApplication._formatDayDivider(cur.timestamp);
                        prevDayKey = dayKey;
                    }
                    // Patch5.5.3: consecutive checks personaKey, not senderId.
                    // GM-puppeted NPC1 → NPC2 → NPC1 used to collapse into one
                    // run (same GM senderId) and hide every avatar + speaker
                    // tag. personaKey differentiates them by override name.
                    cur.consecutive = !!prev
                        && prev.personaKey === cur.personaKey
                        && (cur.timestamp - prev.timestamp) < TWO_MIN
                        && !cur.dayDivider;
                    const isLastOfRun = !next
                        || next.personaKey !== cur.personaKey
                        || (next.timestamp - cur.timestamp) >= TWO_MIN;
                    const bigGapAfter = !next || (next.timestamp - cur.timestamp) >= FIVE_MIN;
                    cur.showTime = isLastOfRun || bigGapAfter;
                    // Patch2 + Patch5.5.3: show sender on every first-of-run
                    // bubble in group chats AND on EVERY bubble in multi-
                    // persona NPC threads (community feedback: "tag speaker
                    // every chat, if you're not going to make it obvious who
                    // it's from"). Self bubbles in solo threads stay clean.
                    cur.showSender = (data.isGroupChat && !cur.consecutive)
                        || (isMultiPersonaThread && !cur.isSelf);
                }
            }
        }

        data.typingPeer = this._currentTypingPeer();
        // Patch4.8 (player requests + "make it epic"): emoji picker rebuilt
        // into 6 categories with ~150 total. Cyberpunk-themed where possible,
        // explicit category for adult/rude reactions players were asking for.
        // Click a category tab → grid swaps to that category.
        data.emojiCategories = [
            { id: "react",  label: "REACT",  icon: "😎" },
            { id: "hands",  label: "HANDS",  icon: "🤘" },
            { id: "cyber",  label: "CYBER",  icon: "🤖" },
            { id: "combat", label: "COMBAT", icon: "🔫" },
            { id: "vibes",  label: "VIBES",  icon: "🔥" },
            { id: "nsfw",   label: "NSFW",   icon: "🍆" }
        ];
        data.emojiSets = {
            react:  ["😎","🤖","💀","😈","👿","🤡","🤢","🤮","💩","😱","😤","🥶","🥵","🤯","🫡","🫥","🤬","😡","🥲","😭","😏","🤤","🥴","🤐","🤫","🙄","😬","🥱","🫠","🫨","😵","💯","✅","❌","❗","❓"],
            hands:  ["👍","👎","✊","👊","🤜","🤛","🤞","🤟","🤘","✌️","🫰","🫵","🫴","🫳","🫲","🫱","🖕","🖖","🤙","👌","🤌","👏","🙌","🙏","💅","💪","🦾"],
            cyber:  ["🤖","💻","📱","📡","🛰️","🏙️","🌉","🚁","🛸","👾","🕹️","🎮","📟","💾","🔋","⚡","🦾","🦿","🧬","🧠","👁️","👁️‍🗨️","🩻","💉","🩸","🩼","🕶️","🥽","⚙️","🔧","🔨","🛠️","⚒️","⛓️","🪝","🪪","🔌","💿","📀"],
            combat: ["🔫","🔪","⚔️","🛡️","💣","🧨","🎯","🚔","🚨","🛎️","🥊","🥷","🦴","☠️","💀","🩸","🔥","💥","💢","☢️","☣️","⚠️","🚧"],
            vibes:  ["🔥","💯","💸","💰","💵","💴","💶","💷","💳","🪙","💎","🏧","🎰","🎲","🥃","🍾","🍻","🍺","🚬","💊","🌃","🌆","🌇","🌌","🎆","🎇","🎶","🎵","🎤","📸","✨","💫","⭐","🌟","💥","💣","🌀"],
            nsfw:   ["🍆","🍑","🥒","🌭","🍌","🍒","🍓","💦","👅","🫦","🖕","🍷","🥃","🚬","🩸","💀","🔥","😈","🥵","😏","💋","💍"]
        };
        // Default to "react"; user can click tabs to switch.
        this._emojiCategory = this._emojiCategory || "react";
        data.emojiCategory = this._emojiCategory;
        data.curatedEmojis = data.emojiSets[this._emojiCategory] || data.emojiSets.react;

        // --- NC MART (Store) ---
        data.storeView = this._storeView || 'list';
        const cart = this._getCart();
        data.storeCart = cart;
        data.storeCartCount = cart.reduce((s, e) => s + (Number(e.qty) || 0), 0);
        data.storeCartTotal = this._cartTotal(cart);
        const _storeQ = (this._storeSearch || "").toLowerCase();
        data.storeSearch = this._storeSearch || "";
        if (this._storeCatalog) {
            data.storeLoaded = true;
            // Patch5.5.13: prepend "All" as a virtual category at the front of the
            // tab strip. Default landing view shows every item across categories.
            data.storeCategories = ["All", ...Object.keys(this._storeCatalog).sort()];
            data.storeCategory = this._storeCategory || "All";
            const allItems = Object.values(this._storeCatalog).flat();
            const raw = (data.storeCategory === "All")
                ? allItems
                : (this._storeCatalog[data.storeCategory] || []);
            // When a search is active, broaden the result across ALL categories so
            // typing "ammo" while looking at Weapons still surfaces matches.
            const source = _storeQ ? allItems : raw;
            let storeResult = _storeQ
                ? source.filter(it => (it.name || "").toLowerCase().includes(_storeQ))
                : raw;
            // Affordability filter — compare against raw numeric balance
            if (this._storeFilterAffordable && data.actorCurrencyRaw !== undefined) {
                storeResult = storeResult.filter(it => it.price <= data.actorCurrencyRaw);
            }
            // Patch4.7 (Gotto): price-tier filter. Player picks a price BUCKET
            // (min..max range), not a max cap. The bucket model makes the
            // filter visibly change the result no matter the category — a max
            // cap of "≤1000 eb" on a Drugs page (all items 10-50eb) looked
            // identical to "all prices" and read as "the filter does nothing."
            // Now selecting "Costly" actually hides cheap items and only shows
            // 500-1000eb items.
            const priceTier = this._storePriceTier || "all";
            if (priceTier !== "all") {
                const bucket = this._priceBucketBounds(priceTier);
                if (bucket) {
                    storeResult = storeResult.filter(it => {
                        const p = Number(it.price) || 0;
                        return p >= bucket.min && p <= bucket.max;
                    });
                }
            }
            // Patch4.7 (Gotto): fixer-rank gate. GM sets a global "items above
            // X eb require Fixer rank ≥Y" pair. Each player has a `fixerRank`
            // flag. Items above the price threshold are hidden if the player
            // doesn't meet the rank threshold. GM bypasses the gate.
            if (!game.user.isGM) {
                const gatePrice = Number(game.settings.get("cyberpunk-red-agent-os-modified", "storeFixerGatePrice")) || 0;
                const gateRank  = Number(game.settings.get("cyberpunk-red-agent-os-modified", "storeFixerGateRank"))  || 0;
                const playerRank = Number(game.user.getFlag("cyberpunk-red-agent-os-modified", "fixerRank")) || 0;
                if (gatePrice > 0 && gateRank > 0 && playerRank < gateRank) {
                    storeResult = storeResult.filter(it => Number(it.price) <= gatePrice);
                }
            }
            data.storeItems = storeResult;
            data.storeFilterAffordable = this._storeFilterAffordable;
            data.storePriceTier = priceTier;
            data.storePriceTiers = [
                { value: "all",     label: "All prices" },
                { value: "cheap",   label: "0–100 eb (Cheap)" },
                { value: "everyday",label: "100–500 eb (Everyday)" },
                { value: "costly",  label: "500–1,000 eb (Costly)" },
                { value: "premium", label: "1k–5k eb (Premium)" },
                { value: "expensive",label:"5k–10k eb (Expensive)" },
                { value: "luxury",  label: "10k+ eb (Luxury)" }
            ];
            const tierLabel = data.storePriceTiers.find(t => t.value === priceTier)?.label || priceTier;
            data.storePriceTierLabel = tierLabel;
        } else {
            data.storeLoaded = false;
            data.storeCategories = [];
            data.storeCategory = this._storeCategory;
            data.storeItems = [];
        }

        // --- ZIGGURAT DATAPOOL ---
        if (game.user.isGM) {
            // GM sees all shards across all users, tagged with owner info
            const allShards = [];
            for (const user of game.users) {
                const userShards = user.getFlag("cyberpunk-red-agent-os-modified", "shards") || [];
                for (const s of userShards) {
                    allShards.push({ ...s, _ownerId: user.id, _ownerName: (user.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || user.name });
                }
            }
            // Deduplicate by shard id (GM copy + player copy share same id)
            const seen = new Set();
            const deduped = [];
            for (const s of allShards) {
                const key = s.id + "_" + s._ownerId;
                if (!seen.has(key)) { seen.add(key); deduped.push(s); }
            }
            data.shards = deduped.filter(s =>
                s.name.toLowerCase().includes((this.shardSearchQuery || "").toLowerCase())
            ).sort((a,b) => b.timestamp - a.timestamp);
        } else {
            data.shards = (game.user.getFlag("cyberpunk-red-agent-os-modified", "shards") || []).filter(s =>
                s.name.toLowerCase().includes((this.shardSearchQuery || "").toLowerCase())
            ).sort((a,b) => b.timestamp - a.timestamp);
        }

        data.activeShardName = this.activeShardName;
        data.activeShardContent = this.activeShardContent;

        // --- SATELLITE ENGINE SYNC ---
        data.mapZoom = this.mapZoom || 1;
        data.mapX = this.mapX || 0;
        data.mapY = this.mapY || 0;

        // --- STYLE CHECKER ---
        data.styleTab = this._styleTab || "outfit";
        if (actor instanceof Actor) {
            // Pull equipped items from CPR actor
            // CPR stores equipped state as a string: "equipped", "owned", or "carried".
            // Cyberware uses "installed" when slotted into the body.
            const items = actor.items?.contents || [];
            const _isEquipped = (i) => {
                const eq = String(i.system?.equipped || "").toLowerCase();
                return eq === "equipped" || eq === "installed" || i.system?.isEquipped === true;
            };
            // Gear tab — weapons, cyberware, armor, gear
            data.styleGear = items.filter(i => {
                const t = i.type?.toLowerCase() || "";
                return _isEquipped(i) && ['weapon', 'cyberware', 'armor', 'gear', 'clothing'].includes(t);
            }).map(i => ({
                name: i.name,
                type: i.type,
                img: i.img || "icons/svg/item-bag.svg",
                description: i.system?.description?.value || i.system?.description || "",
                equipped: true
            }));
            // Outfit tab — clothing + armor that's actually equipped
            data.styleOutfit = items.filter(i => {
                const t = i.type?.toLowerCase() || "";
                return _isEquipped(i) && ['clothing', 'armor'].includes(t);
            }).map(i => ({
                name: i.name,
                type: i.type,
                img: i.img || "icons/svg/item-bag.svg",
                style: i.system?.style || i.system?.description?.value || ""
            }));
            // Fashion score — based on equipped clothing count + cyberware
            const clothingCount = data.styleOutfit.length;
            const cyberCount = items.filter(i => i.type?.toLowerCase() === 'cyberware' && _isEquipped(i)).length;
            const baseScore = Math.min(clothingCount * 15, 60) + Math.min(cyberCount * 10, 30);
            const repBonus = Math.min(Math.floor(repScore / 10), 10);
            data.styleScore = Math.min(baseScore + repBonus, 100);
            data.styleRating = data.styleScore >= 80 ? "ICONIC" : data.styleScore >= 60 ? "EDGERUNNER" : data.styleScore >= 40 ? "STREETWISE" : data.styleScore >= 20 ? "BASIC" : "GONK";
            data.styleColor = data.styleScore >= 80 ? "#e040fb" : data.styleScore >= 60 ? "#64ffda" : data.styleScore >= 40 ? "#ffcc00" : "#ff5555";

            // Patch4.7 (Gotto): current trend + wardrobe modifier display.
            // Trend is world-level (set by GM via setting). Modifiers are
            // per-actor flag (`AgentDevice.wardrobeModifiers` = [{label, value}]).
            try {
                data.styleTrend = game.settings.get("cyberpunk-red-agent-os-modified", "styleTrend") || "";
                data.styleTrendDesc = game.settings.get("cyberpunk-red-agent-os-modified", "styleTrendDesc") || "";
            } catch (e) { data.styleTrend = ""; data.styleTrendDesc = ""; }
            const wm = (actor && actor.getFlag) ? (actor.getFlag("cyberpunk-red-agent-os-modified", "wardrobeModifiers") || []) : [];
            data.styleWardrobeModifiers = Array.isArray(wm)
                ? wm.map(m => ({
                    label: String(m.label || m.name || "Modifier"),
                    value: Number(m.value) || 0,
                    positive: (Number(m.value) || 0) >= 0
                }))
                : [];
            data.showStyleInfo = !!this._showStyleInfo;
        } else {
            data.styleGear = [];
            data.styleOutfit = [];
            data.styleScore = 0;
            data.styleRating = "N/A";
            data.styleColor = "#555";
        }

        // --- NPC REPUTATION TRACKER ---
        try {
            const rawRep = game.settings.get("cyberpunk-red-agent-os-modified", "npcReputations");
            data.npcReputations = Array.isArray(rawRep) ? rawRep : (typeof rawRep === "string" && rawRep.trim() ? JSON.parse(rawRep) : []);
        } catch (e) { data.npcReputations = []; }
        // Each entry: { id, name, faction, standing: "friendly"|"neutral"|"hostile"|"allied", description, img }

        // Patch3 (CommanderCrunch69): sort option for the Fixers app.
        // Standing → numeric weight so the "by attitude" sort groups allied first,
        // then friendly, neutral, hostile.
        const STANDING_WEIGHT = { allied: 0, friendly: 1, neutral: 2, hostile: 3 };
        const STANDING_LABEL  = { allied: "ALLIED", friendly: "FRIENDLY", neutral: "NEUTRAL", hostile: "HOSTILE" };
        const sortMode = this._repSort || "default";
        data.repSort = sortMode;
        if (Array.isArray(data.npcReputations) && data.npcReputations.length) {
            const arr = data.npcReputations.slice();
            if (sortMode === "alpha") {
                arr.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
            } else if (sortMode === "standing") {
                arr.sort((a, b) => {
                    const wa = STANDING_WEIGHT[a.standing] ?? 99;
                    const wb = STANDING_WEIGHT[b.standing] ?? 99;
                    if (wa !== wb) return wa - wb;
                    return String(a.name || "").localeCompare(String(b.name || ""));
                });
            } else if (sortMode === "faction") {
                arr.sort((a, b) => {
                    const fa = String(a.faction || "").toLowerCase();
                    const fb = String(b.faction || "").toLowerCase();
                    if (fa !== fb) return fa.localeCompare(fb);
                    return String(a.name || "").localeCompare(String(b.name || ""));
                });
            }
            data.npcReputations = arr;
        }
        data.repSortOptions = [
            { id: "default",  label: "Default order" },
            { id: "alpha",    label: "A → Z" },
            { id: "standing", label: "By attitude" },
            { id: "faction",  label: "By faction" }
        ];

        // ════════════════════════════════════════════════════════════════════
        // Patch5.5: Black Chrome / All About Agents app data
        // ════════════════════════════════════════════════════════════════════

        // --- NCPD CRIME DATABASE (Black Chrome) ---
        try {
            const rawNcpd = game.settings.get("cyberpunk-red-agent-os-modified", "ncpdRapSheets") || "[]";
            data.ncpdRapSheets = JSON.parse(rawNcpd);
            if (!Array.isArray(data.ncpdRapSheets)) data.ncpdRapSheets = [];
        } catch (e) { data.ncpdRapSheets = []; }
        // Search filter for the player-side list
        data.ncpdSearch = this._ncpdSearch || "";
        if (data.ncpdSearch) {
            const q = data.ncpdSearch.toLowerCase();
            data.ncpdRapSheetsView = data.ncpdRapSheets.filter(s =>
                String(s.name || "").toLowerCase().includes(q) ||
                String(s.charges || "").toLowerCase().includes(q) ||
                String(s.notes || "").toLowerCase().includes(q)
            );
        } else {
            data.ncpdRapSheetsView = data.ncpdRapSheets;
        }
        data.ncpdActiveId = this._ncpdActiveId || null;
        data.ncpdActiveRecord = data.ncpdActiveId
            ? data.ncpdRapSheets.find(s => s.id === data.ncpdActiveId) || null
            : null;
        // Modified build (П9): record being edited (pre-fills the add/edit modal).
        data.ncpdEditRecord = this._ncpdEditId
            ? data.ncpdRapSheets.find(s => s.id === this._ncpdEditId) || null
            : null;

        // --- ZIGGURAT CITY DATABASE (Black Chrome) ---
        try {
            const rawZig = game.settings.get("cyberpunk-red-agent-os-modified", "cityDirectoryEntries") || "[]";
            data.cityDirectory = JSON.parse(rawZig);
            if (!Array.isArray(data.cityDirectory)) data.cityDirectory = [];
        } catch (e) { data.cityDirectory = []; }
        // Patch5.5.15: unify filter categories with the add-dropdown list. Previously
        // these were two disjoint vocabularies (filter had "Venues/Bars/Food/Fixers/Black
        // Market/Services/Other"; add had "Venue/Fixer/Ripperdoc/Vendor/Safehouse/Gang
        // Turf/Corp/Other"), so saved entries never matched the filter chips. One list now.
        data.zigguratCategories = ["All", "Venue", "Fixer", "Ripperdoc", "Vendor", "Safehouse", "Gang Turf", "Corp", "Other"];
        data.zigguratCategory = this._zigguratCategory || "All";
        data.zigguratSearch = this._zigguratSearch || "";
        {
            let entries = data.cityDirectory;
            if (data.zigguratCategory && data.zigguratCategory !== "All") {
                entries = entries.filter(e => (e.category || "Other") === data.zigguratCategory);
            }
            if (data.zigguratSearch) {
                const q = data.zigguratSearch.toLowerCase();
                entries = entries.filter(e =>
                    String(e.name || "").toLowerCase().includes(q) ||
                    String(e.notes || "").toLowerCase().includes(q) ||
                    String(e.address || "").toLowerCase().includes(q)
                );
            }
            data.cityDirectoryView = entries;
        }
        // Modified build (П9): entry being edited (pre-fills the add/edit modal).
        data.zigguratEditEntry = this._zigguratEditId
            ? (data.cityDirectory || []).find(e => e.id === this._zigguratEditId) || null
            : null;

        // --- THE GARDEN (All About Agents) ---
        try {
            const rawGarden = game.settings.get("cyberpunk-red-agent-os-modified", "gardenProfiles") || "[]";
            data.gardenProfiles = JSON.parse(rawGarden);
            if (!Array.isArray(data.gardenProfiles)) data.gardenProfiles = [];
        } catch (e) { data.gardenProfiles = []; }
        // Filter to profiles the GM has scoped to this player (or all if no scoping).
        if (!game.user.isGM) {
            data.gardenProfilesView = data.gardenProfiles.filter(p => {
                const targets = Array.isArray(p.targetUserIds) ? p.targetUserIds : [];
                return targets.length === 0 || targets.includes(game.user.id);
            });
        } else {
            data.gardenProfilesView = data.gardenProfiles;
        }
        data.gardenActiveId = this._gardenActiveId || null;
        data.gardenActiveProfile = data.gardenActiveId
            ? data.gardenProfiles.find(p => p.id === data.gardenActiveId) || null
            : null;
        // Modified build (П9): profile being edited (pre-fills the add/edit modal).
        data.gardenEditProfile = this._gardenEditId
            ? data.gardenProfiles.find(p => p.id === this._gardenEditId) || null
            : null;

        // --- MAP INDICATORS (Ryouhi request) ---
        try {
            const rawPins = game.settings.get("cyberpunk-red-agent-os-modified", "mapIndicators") || "[]";
            data.mapIndicators = JSON.parse(rawPins);
            if (!Array.isArray(data.mapIndicators)) data.mapIndicators = [];
        } catch (e) { data.mapIndicators = []; }
        // Only show indicators flagged visible (GM can hide while drafting).
        // GM always sees all pins (so they can manage hidden ones); players see only visible.
        data.mapIndicatorsView = game.user.isGM ? data.mapIndicators : data.mapIndicators.filter(p => p.isVisible !== false);

        // --- PERSONAL CONTACTS (Modified build П4) ---
        // Each player keeps their own contact list (User flag). Players see only
        // their own; the GM sees everyone's, grouped into per-player folders.
        const DEFAULT_CONTACT_COLOR = "#39d98a";
        {
            // The viewer's own contacts (always editable by them).
            const own = this._getPersonalContacts(game.user).map(c => this._decorateContact(c));
            data.myContacts = own;
            data.contactColor = DEFAULT_CONTACT_COLOR;

            if (game.user.isGM) {
                // Folders: one per non-GM user that has any contacts.
                const folders = [];
                for (const u of game.users.filter(x => !x.isGM)) {
                    const list = this._getPersonalContacts(u).map(c => this._decorateContact(c));
                    folders.push({
                        userId: u.id,
                        userName: (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name,
                        count: list.length,
                        open: this._contactsOpenFolder === u.id,
                        contacts: list
                    });
                }
                // Plus the GM's own contacts as a folder.
                folders.unshift({
                    userId: game.user.id,
                    userName: game.user.name + " (GM)",
                    count: own.length,
                    open: this._contactsOpenFolder === game.user.id || !this._contactsOpenFolder,
                    contacts: own,
                    isSelf: true
                });
                data.contactFolders = folders;
            }

            // Map pins for personal contacts (those that carry a location).
            // Players see their own; the GM sees everyone's. Rendered in a distinct
            // contact colour so they read separately from GM map indicators.
            const pinSources = game.user.isGM
                ? game.users.map(u => ({ user: u, contacts: this._getPersonalContacts(u) }))
                : [{ user: game.user, contacts: this._getPersonalContacts(game.user) }];
            const contactPins = [];
            for (const src of pinSources) {
                for (const c of src.contacts) {
                    if (c.hasLocation && typeof c.mapX === "number" && typeof c.mapY === "number") {
                        contactPins.push({
                            x: c.mapX, y: c.mapY,
                            label: c.name,
                            owner: game.user.isGM ? src.user.name : "",
                            color: c.color || DEFAULT_CONTACT_COLOR
                        });
                    }
                }
            }
            data.contactPinsView = contactPins;
        }
        // Patch5.5.5: GM add-content modal visibility (only ever true if GM).
        data.showNcpdAddModal = !!this.showNcpdAddModal && game.user.isGM;
        data.showZigguratAddModal = !!this.showZigguratAddModal && game.user.isGM;
        data.showGardenAddModal = !!this.showGardenAddModal && game.user.isGM;
        // Modified build (П4): personal contacts modal + edit target.
        data.showContactModal = !!this.showContactModal;
        data.contactEdit = this._contactEditId
            ? (this._getPersonalContacts(game.user).find(c => c.id === this._contactEditId) || null)
            : null;
        // Patch5.5.3: Maps app pin curation state (moved from Sys Admin).
        data.mapPinMode = !!this._mapPinMode && game.user.isGM;
        data.showMapPinModal = !!this.showMapPinModal && game.user.isGM;
        data.showMapPinManageModal = !!this.showMapPinManageModal && game.user.isGM;
        data.pendingPinX = Number(this._pendingPinX || 50).toFixed(1);
        data.pendingPinY = Number(this._pendingPinY || 50).toFixed(1);
        // Patch5.5.3 canon palette: pin colors map to recognizable CP RED factions
        // / threat tiers so the GM can color-code intent at a glance.
        data.mapPinColorPalette = [
            { value: '#3a86ff', label: 'NCPD' },        // law enforcement
            { value: '#ff003c', label: 'Trauma Team' }, // medical
            { value: '#cc0000', label: 'Arasaka' },     // corp red
            { value: '#ffcc00', label: 'Tyger Claws' }, // gang gold
            { value: '#00ffcc', label: 'Net / Data' },  // datapool cyan
            { value: '#7c4dff', label: 'Voodoo Boys' }, // gang violet
            { value: '#ff1493', label: 'Mox' },         // gang pink
            { value: '#44ff44', label: 'Aldecaldos' }   // nomad green
        ];
        data.mapPinIconPalette = [
            { value: 'fa-map-pin', label: 'Pin' }, { value: 'fa-skull', label: 'Skull' },
            { value: 'fa-biohazard', label: 'Bio' }, { value: 'fa-fire', label: 'Fire' },
            { value: 'fa-bolt', label: 'Bolt' }, { value: 'fa-crosshairs', label: 'Crosshairs' },
            { value: 'fa-star', label: 'Star' }, { value: 'fa-shield-alt', label: 'Shield' },
            { value: 'fa-question', label: 'Unknown' }, { value: 'fa-flag', label: 'Flag' },
            { value: 'fa-eye', label: 'Watcher' }, { value: 'fa-home', label: 'Safehouse' }
        ];

        // --- NIGHT MARKET (Gotto request) ---
        try {
            const rawNm = game.settings.get("cyberpunk-red-agent-os-modified", "nightMarketActive") || "";
            data.nightMarket = rawNm ? JSON.parse(rawNm) : null;
            if (data.nightMarket && !Array.isArray(data.nightMarket.items)) data.nightMarket.items = [];
        } catch (e) { data.nightMarket = null; }
        data.nightMarketActive = !!(data.nightMarket && Array.isArray(data.nightMarket.items) && data.nightMarket.items.length > 0);
        // Patch5.5.6: "open" = market object exists (even if empty). "active" = has
        // items and shows the player tab. Splitting these lets the GM START an
        // empty market with a name before adding items, instead of the previous
        // implicit-start where adding the first item created the market.
        data.nightMarketOpen = !!data.nightMarket;
        // Player-side store mode. If Night Market closed, force back to catalog so the tab vanishes.
        if (!data.nightMarketActive && this._storeMode === "nightmarket") this._storeMode = "catalog";
        data.storeMode = this._storeMode || "catalog";
        // Patch5.5.12: surface catalog-loaded state so the Sys Admin picker can
        // render an explicit LOAD button when the catalog hasn't been imported yet
        // (NC Mart catalog only auto-loads when the GM opens the NC Mart app — Sys
        // Admin needs its own trigger).
        data.nmCatalogLoaded = !!this._storeCatalog;
        data.nmCatalogLoading = !!this._storeLoading;
        // GM-side curation picker: flatten the live catalog so the admin can browse + add.
        if (game.user.isGM && this._storeCatalog) {
            const picker = [];
            for (const cat of Object.keys(this._storeCatalog)) {
                for (const it of this._storeCatalog[cat]) {
                    picker.push({ uuid: it.uuid, name: it.name, price: it.price, img: it.img, category: cat });
                }
            }
            picker.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
            data.nmCatalogPicker = picker.slice(0, 300); // hard cap to keep the panel lean
        } else {
            data.nmCatalogPicker = [];
        }

        // --- RENT / HOUSING (Gotto, old; Patch5.5.19 per-character per Phil Sweet) ---
        // Stored as actor flag now. Migration: if the actor flag is empty and
        // the user flag has a legacy value, fall through to the user flag.
        // Players with multiple characters can have different housing per char.
        const housingActor = (game.user.isGM && this._idViewTargetUserId)
            ? game.users.get(this._idViewTargetUserId)?.character
            : (actor instanceof Actor ? actor : game.user.character);
        const housingUser = (game.user.isGM && this._idViewTargetUserId)
            ? game.users.get(this._idViewTargetUserId)
            : game.user;
        data.housingStatus = housingActor?.getFlag?.("cyberpunk-red-agent-os-modified", "housingStatus")
            || housingUser?.getFlag?.("cyberpunk-red-agent-os-modified", "housingStatus") || "";
        data.housingRent = housingActor?.getFlag?.("cyberpunk-red-agent-os-modified", "housingRent")
            || housingUser?.getFlag?.("cyberpunk-red-agent-os-modified", "housingRent") || "";
        // Patch5.5.20: render block when EITHER field is set (was: only housingStatus).
        data.housingHasAny = !!(data.housingStatus || data.housingRent);

        // --- AUCTION HOUSE ---
        data.auctionView = this._auctionView || "list";
        data.auctionDetailId = this._auctionDetailId;
        try {
            // Optimistic UI: use pending data if available (avoids stale settings cache)
            let allAuctions;
            if (this._pendingAuctionData) {
                allAuctions = this._pendingAuctionData;
            } else {
                const rawAuctions = game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings");
                allAuctions = Array.isArray(rawAuctions) ? rawAuctions : (typeof rawAuctions === "string" && rawAuctions.trim() ? JSON.parse(rawAuctions) : []);
            }
            const now = Date.now();
            data.auctionListings = allAuctions.map(a => {
                const endTime = a.endTime || (a.createdAt + 86400000);
                const remaining = Math.max(0, endTime - now);
                const hours = Math.floor(remaining / 3600000);
                const minutes = Math.floor((remaining % 3600000) / 60000);
                const expired = remaining <= 0;
                const isHighBidder = a.highBidderId === game.user.id;
                return {
                    ...a,
                    timeLeft: expired ? "EXPIRED" : (hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${Math.floor((remaining % 60000) / 1000)}s`),
                    expired,
                    isHighBidder,
                    bidCount: a.bidCount || 0,
                    currentBid: a.currentBid || a.startingBid || 0
                };
            });
            if (this._auctionDetailId) {
                data.auctionDetail = data.auctionListings.find(a => a.id === this._auctionDetailId) || null;
            }
        } catch (e) { data.auctionListings = []; data.auctionDetail = null; }

        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        console.log(`[Agent OS] V1.0.0-beta.3.0.5 Kernel active.`);

        // --- AUTHORITATIVE [DATA-ACTION] LISTENERS ---
        html.on('click', '[data-action]', async ev => {
            ev.preventDefault(); ev.stopPropagation();
            const action = $(ev.currentTarget).data('action');

            switch(action) {
                case 'cancel-transfer':
                    this.showPayoutModal = false; this.render(true);
                    break;

                case 'confirm-transfer': {
                    ui.notifications.info("Agent Bank: Financial Handshake Initialized...");

                    const amount = parseInt(html.find('#transfer-amount').val());
                    const targetVal = html.find('#transfer-target').val();
                    const memo = html.find('#transfer-memo').val() || "Agent Transaction";

                    if (isNaN(amount) || amount <= 0 || !targetVal) {
                        ui.notifications.warn("Agent Error: Amount and target required.");
                        return;
                    }

                    this.showPayoutModal = false;
                    let finalFrom = this.actorUuid, finalTo = targetVal;
                    if (this.transferMode === 'bill') {
                        if (!game.user.isGM) {
                            ui.notifications.warn("Agent Error: Billing restricted to System Admin.");
                            this.render(true);
                            return;
                        }
                        finalFrom = targetVal; finalTo = this.actorUuid;
                    }

                    if (game.user.isGM) {
                        const success = await this._executeTransfer(finalFrom, finalTo, amount, memo);
                        if (success) ui.notifications.info("Agent Bank: Settlement authorized.");
                    } else {
                        // Player: route through the GM client via socket
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) {
                            ui.notifications.error("Agent Bank: No System Admin online to authorize this transfer.");
                            this.render(true);
                            return;
                        }
                        const senderActor = this._resolveActor(this.actorUuid);
                        const senderBalance = senderActor
                            ? Number(this._getActorEurobucks(senderActor).balance)
                            : Number(this._getVirtualBalance(game.user).balance);
                        if (senderBalance < amount) {
                            ui.notifications.warn("Agent Bank: Insufficient funds.");
                            this.render(true);
                            return;
                        }
                        const reqId = "agtreq_" + foundry.utils.randomID();
                        const payload = {
                            action: "transferRequest",
                            fromUuid: finalFrom,
                            toUuid: finalTo,
                            amount, memo,
                            requesterId: game.user.id,
                            requestId: reqId
                        };
                        console.log("[Agent OS] Emitting transferRequest:", payload);
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", payload);

                        // FALLBACK: also post a GM-whispered chat message with an inline
                        // AUTHORIZE button. Guarantees the GM sees the request even if
                        // the socket is dropped. Button is wired in a renderChatMessage hook.
                        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                        const _esc = (s) => (foundry.utils.escapeHTML
                            ? foundry.utils.escapeHTML(String(s ?? ""))
                            : String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
                        ChatMessage.create({
                            content: `
                                <div style="border:1px solid #ffcc00; background:#1a1300; padding:8px 10px; border-radius:4px; font-family:monospace; color:#ffcc00;">
                                    <b style="color:#fff;">AGENT BANK REQUEST</b><br>
                                    <span style="color:#ccc;">From:</span> ${_esc(game.user.name)}<br>
                                    <span style="color:#ccc;">To:</span> ${_esc(finalTo)}<br>
                                    <span style="color:#ccc;">Amount:</span> ${Number(amount)}eb<br>
                                    <span style="color:#888;">Memo:</span> ${_esc(memo)}<br>
                                    <button type="button" class="agent-transfer-authorize"
                                        data-from-uuid="${_esc(finalFrom)}" data-to-uuid="${_esc(finalTo)}"
                                        data-amount="${Number(amount)}" data-memo="${_esc(memo)}"
                                        data-requester-id="${_esc(game.user.id)}" data-request-id="${_esc(reqId)}"
                                        style="margin-top:6px; padding:4px 10px; background:rgba(255,204,0,0.15); border:1px solid #ffcc00; color:#ffcc00; cursor:pointer; font-family:monospace;">
                                        <i class="fas fa-check"></i> AUTHORIZE
                                    </button>
                                </div>`,
                            whisper: gmIds,
                            flags: { "cyberpunk-red-agent-os-modified": { isAgentMessage: false, isTransferRequest: true, requestId: reqId } }
                        });

                        ui.notifications.info("Agent Bank: Request transmitted to System Admin...");
                    }
                    this.render(true);
                    break;
                }

                case 'open-transfer-modal':
                    this.transferMode = $(ev.currentTarget).data('mode') || "give";
                    this.showPayoutModal = true;
                    this.render(true);
                    break;

                case 'app-icon': {
                    const app = $(ev.currentTarget).data('app');
                    if (['chat', 'data', 'creds', 'map', 'id', 'social', 'bio', 'admin', 'store', 'style', 'rep', 'auction', 'ncpd', 'ziggurat', 'garden', 'contacts'].includes(app)) {
                        this._playUiSound('tap'); // Modified build (П12): icon tap blip
                        this.currentView = app;
                        if (app === 'store' && !this._storeCatalog && !this._storeLoading) {
                            this._loadStoreCatalog().then(() => this.render(true));
                        }
                        if (app === 'auction') {
                            this._auctionView = 'list';
                            this._auctionDetailId = null;
                        }
                        // Modified build (П1): the token "call" holophone effect is
                        // tied to MESSENGER. Start it when entering chat; stop when
                        // entering any other app.
                        if (app === 'chat') {
                            setTimeout(() => { try { this._playHolophoneCallAnim?.(); } catch (e) {} }, 150);
                        } else {
                            try { this._stopHolophoneCallAnim?.(); } catch (e) {}
                        }
                        this.render(true);
                    }
                    break;
                }

                case 'back-to-home':
                    // Modified build (П1): leaving chat stops the token call effect.
                    try { this._stopHolophoneCallAnim?.(); } catch (e) {}
                    this.currentView = 'home'; this.activeContactId = null; this.render(true);
                    break;

                // Modified build (П10): open / close the per-user settings panel
                // (theme + device mode picker). Stored on the instance, not a flag.
                case 'open-agent-settings':
                    this.currentView = 'agentsettings';
                    this.render(true);
                    break;

                // Modified build (П10): pick a colour theme. Persists on the User.
                case 'agent-set-theme': {
                    const theme = String($(ev.currentTarget).data('theme') || 'red');
                    const VALID = ['red', 'cyber2077', 'green', 'blue', 'purple', 'orange', 'magenta', 'chrome'];
                    if (VALID.includes(theme)) {
                        await game.user.setFlag("cyberpunk-red-agent-os-modified", "agentTheme", theme);
                        this._playUiSound?.('tap');
                        this.render(true);
                    }
                    break;
                }

                // Modified build (П12): toggle UI/notification sounds (client setting).
                case 'agent-toggle-sound': {
                    let cur = true;
                    try { cur = game.settings.get("cyberpunk-red-agent-os-modified", "soundsEnabled") !== false; } catch (e) {}
                    try { await game.settings.set("cyberpunk-red-agent-os-modified", "soundsEnabled", !cur); } catch (e) {}
                    if (!cur) this._playUiSound('tap'); // play a blip when turning ON
                    this.render(true);
                    break;
                }

                // Modified build (П11): pick a device mode (phone / tablet).
                case 'agent-set-mode': {
                    const mode = String($(ev.currentTarget).data('mode') || 'phone');
                    const VALID = ['phone', 'tablet'];
                    if (VALID.includes(mode)) {
                        await game.user.setFlag("cyberpunk-red-agent-os-modified", "agentMode", mode);
                        this._playUiSound?.('tap');
                        // Mode changes the window footprint — resize to match.
                        this._applyDeviceModeSize?.(mode);
                        this.render(true);
                    }
                    break;
                }

                case 'back-to-contacts':
                    this.currentView = 'chat'; this.activeContactId = null; this.showEmojiPicker = false; this.render(true);
                    break;

                case 'toggle-emoji-picker':
                    this.showEmojiPicker = !this.showEmojiPicker;
                    this.render(true);
                    break;

                case 'insert-emoji': {
                    const emoji = $(ev.currentTarget).data('emoji');
                    const cInput = html.find('#agent-chat-input');
                    cInput.val(cInput.val() + emoji);
                    cInput.focus();
                    break;
                }

                case 'emoji-set-category': {
                    // Patch4.8: switch emoji picker category. Click a tab,
                    // the grid below swaps to that category's set.
                    const cat = $(ev.currentTarget).data('category');
                    this._emojiCategory = String(cat || "react");
                    this.render(true);
                    break;
                }

                case 'gm-group-voice-set': {
                    // Patch4.8.3: GM picks which voice to speak as inside a
                    // multi-NPC group thread. "gm" = default (GM's own
                    // identity); otherwise the value is the NPC contact id.
                    if (!game.user.isGM) return;
                    if (!this.activeContactId) return;
                    const voice = String($(ev.currentTarget).val() || "gm");
                    this._gmSpeakingAsInThread = this._gmSpeakingAsInThread || {};
                    this._gmSpeakingAsInThread[this.activeContactId] = voice;
                    this.render(true);
                    break;
                }

                case 'toggle-attach-picker': {
                    // Patch4.8: show/hide the attachment template picker.
                    this.showAttachPicker = !this.showAttachPicker;
                    this.render(true);
                    break;
                }

                // Modified build (П4): open the native file picker to upload a
                // real image/gif/audio attachment.
                case 'attach-file-pick': {
                    if (!this.activeContactId) { ui.notifications.warn(game.i18n.localize("AGENTOS.Attach.OpenThread")); break; }
                    const input = html.find('#agent-attach-file-input')[0];
                    if (input) input.click();
                    break;
                }

                // Modified build (П4): open an uploaded image full-size.
                case 'open-attachment': {
                    const src = String($(ev.currentTarget).data('src') || "");
                    if (src) {
                        try {
                            const IP = foundry.applications?.apps?.ImagePopout
                                ?? ImagePopout;
                            new IP(src, { title: "Agent OS", shareable: true }).render(true);
                        } catch (e) {
                            window.open(src, "_blank");
                        }
                    }
                    break;
                }

                case 'set-attach-kind': {
                    // Patch4.8: switch attachment type (photo/video/audio).
                    const kind = String($(ev.currentTarget).data('kind') || "photo");
                    this._attachKind = kind;
                    this.render(true);
                    break;
                }

                case 'send-attachment': {
                    // Patch4.8: post an attachment-template card into the
                    // current thread. Stored as a normal Agent message with a
                    // `attachment: {kind, desc}` flag block; the chat
                    // decoration path reads it and renders the styled card.
                    if (!this.activeContactId) { ui.notifications.warn("Agent: Open a thread first."); return; }
                    const desc = (html.find('#attach-desc').val() || "").trim();
                    if (!desc) { ui.notifications.warn("Agent: Add a description for the attachment."); return; }
                    const kind = this._attachKind || "photo";
                    const contacts = this._getContacts();
                    const threadContact = contacts.find(c => c.id === this.activeContactId);
                    const isNpcThread = this.activeContactId?.startsWith("npc_");
                    const speakerAlias = (game.user.isGM && isNpcThread && threadContact)
                        ? (threadContact.originalName || threadContact.name)
                        : (game.user.name + " (Agent)");
                    const npcOverrideName = (game.user.isGM && isNpcThread && threadContact) ? (threadContact.originalName || threadContact.name) : undefined;
                    // 5.5.27 (live-Foundry screenshot): cross-user avatar resolution.
                    // When a PLAYER creates an NPC contact and uploads its
                    // avatar, the GM only sees the contact via the switchboard
                    // auto-build path in _getContacts() (no avatar field). The
                    // GM's outgoing attachment then went out with overrideAvatar
                    // undefined and the player's bubble fell back to the
                    // default icon. Scan every user's customContacts for the
                    // matching npc_* id and prefer the entry that has an
                    // avatar set.
                    let _resolvedNpcAvatar = (game.user.isGM && isNpcThread && threadContact?.avatar) ? threadContact.avatar : null;
                    if (!_resolvedNpcAvatar && game.user.isGM && isNpcThread) {
                        for (const u of game.users) {
                            const lst = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                            const m = lst.find(c => c.id === this.activeContactId);
                            if (m?.avatar) { _resolvedNpcAvatar = m.avatar; break; }
                        }
                    }
                    const npcOverrideAvatar = _resolvedNpcAvatar || undefined;
                    // Content is a placeholder string; the real render comes
                    // from the attachment flag block in getData chat-decoration.
                    const placeholderText = `[${kind.toUpperCase()}] ${desc}`;
                    const messageData = {
                        content: placeholderText,
                        speaker: { alias: speakerAlias },
                        flags: {
                            "cyberpunk-red-agent-os-modified": {
                                isAgentMessage: true,
                                threadId: this.activeContactId,
                                overrideName: npcOverrideName,
                                overrideAvatar: npcOverrideAvatar,
                                targetName: threadContact?.name,
                                attachment: { kind, desc: desc.slice(0, 500) }
                            }
                        }
                    };
                    // Same whisper routing as a regular message.
                    if (this.activeContactId !== 'party_group_chat') {
                        if (this.activeContactId?.startsWith("pcgroup_") || threadContact?.isCustomGroup) {
                            const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                            const targets = new Set(gmIds);
                            targets.add(game.user.id);
                            const members = Array.isArray(threadContact?.members) ? threadContact.members : [];
                            for (const m of members) {
                                if (m.startsWith("player:")) targets.add(m.slice("player:".length));
                            }
                            messageData.whisper = Array.from(targets);
                        } else if (game.users.get(this.activeContactId)) {
                            messageData.whisper = [this.activeContactId];
                        } else if (isNpcThread) {
                            if (game.user.isGM) {
                                const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                                const targets = new Set(gmIds);
                                const tList = Array.isArray(threadContact?.targetUserIds) ? threadContact.targetUserIds : [];
                                for (const uid of tList) targets.add(uid);
                                if (threadContact?.ownerId) targets.add(threadContact.ownerId);
                                messageData.whisper = Array.from(targets);
                            } else {
                                messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                            }
                        } else if (!game.user.isGM) {
                            messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                        }
                    }
                    this.showAttachPicker = false;
                    html.find('#attach-desc').val("");
                    if (this._composerDrafts) delete this._composerDrafts['attach-desc'];
                    await ChatMessage.create(messageData);
                    this.render(true);
                    break;
                }

                case 'open-new-group': {
                    // Patch4.8: open the new-group modal.
                    this.showNewGroup = true;
                    this.render(true);
                    break;
                }

                case 'cancel-new-group': {
                    this.showNewGroup = false;
                    if (this._composerDrafts) delete this._composerDrafts['new-group-name'];
                    this.render(true);
                    break;
                }

                case 'confirm-new-group': {
                    // Patch4.8: build the group. Members are tagged "player:USERID"
                    // or "npc:NPCID" via the checkbox values. We store the group
                    // as a customContact with `isGroup: true` and a `members`
                    // array. Messages sent into this thread route to all member
                    // users via whisper (the chat handler reads `members` to
                    // build the whisper list).
                    const name = (html.find('#new-group-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("Agent: Group name required."); return; }
                    const members = [];
                    html.find('.new-group-member:checked').each((_, el) => members.push(String(el.value || "")));
                    if (members.length < 1) { ui.notifications.warn("Agent: Pick at least one participant."); return; }
                    const groupId = `pcgroup_${foundry.utils.randomID()}`;
                    const newGroup = {
                        id: groupId,
                        name,
                        isPlayer: false,
                        isGroup: true,
                        isCustomGroup: true,
                        members,           // ["player:abc","npc:npc_xyz",...]
                        ownerUserId: game.user.id,
                        avatar: ""
                    };
                    // Push to creator's contacts (always own-user — no perms issue).
                    const mine = game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                    mine.push(newGroup);
                    await game.user.setFlag("cyberpunk-red-agent-os-modified", "customContacts", mine);
                    // Patch5.0.1 (Gotto): if creator is the GM, push the group
                    // entry directly onto every player member's customContacts.
                    // If creator is a PLAYER, they don't have permission to
                    // setFlag on other users — emit a socket event so the GM
                    // does it on their behalf. Same flow as the existing NPC
                    // contact distribution.
                    if (game.user.isGM) {
                        for (const m of members) {
                            if (!m.startsWith("player:")) continue;
                            const uid = m.slice("player:".length);
                            const u = game.users.get(uid);
                            if (!u || u.id === game.user.id) continue;
                            const theirs = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                            if (!theirs.some(c => c.id === groupId)) {
                                theirs.push({ ...newGroup });
                                await u.setFlag("cyberpunk-red-agent-os-modified", "customContacts", theirs);
                            }
                        }
                    } else {
                        // Player path — request GM relay.
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) {
                            ui.notifications.warn("Agent: No GM online to authorize the group invitation — group created for you only.");
                        } else {
                            game.socket.emit("module.cyberpunk-red-agent-os-modified", {
                                action: "groupInviteRelay",
                                group: newGroup,
                                requestingUserId: game.user.id
                            });
                        }
                    }
                    this.showNewGroup = false;
                    this.activeContactId = groupId;
                    this.currentView = 'chat-thread';
                    if (this._composerDrafts) delete this._composerDrafts['new-group-name'];
                    ui.notifications.info(`Agent: Group "${name}" created with ${members.length} member(s).`);
                    this.render(true);
                    break;
                }

                case 'post-social': {
                    const category = (html.find('#social-post-category').val() || "Post").trim() || "Post";
                    const text = (html.find('#social-post-text').val() || "").trim();
                    if (!text) { ui.notifications.warn("Agent OS: Post text required."); return; }
                    // Patch4.7 (Gotto Goho): GM persona override — when the GM fills
                    // in the optional "Post AS" field, the post is attributed to
                    // that NPC name instead of "Gamemaster". Players still post
                    // under their handle as before.
                    const personaAs = game.user.isGM ? (html.find('#social-post-as').val() || "").trim() : "";
                    // Patch5.5: GM-only Screamsheet toggle. When checked, the post
                    // renders as a styled card (RED-era pirate broadsheet) instead
                    // of a regular feed item. Flag is set false by default so
                    // existing posts are unaffected.
                    const isScreamsheet = game.user.isGM ? !!html.find('#social-screamsheet-toggle').is(':checked') : false;
                    const defaultName = (game.user.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || game.user.name;
                    const entry = {
                        id: "feed_" + foundry.utils.randomID(),
                        category, text,
                        authorId: game.user.id,
                        authorName: personaAs || defaultName,
                        isGmPersona: !!personaAs,
                        isScreamsheet,
                        timestamp: Date.now()
                    };
                    if (game.user.isGM) {
                        // GM writes directly
                        const raw = game.settings.get("cyberpunk-red-agent-os-modified", "socialFeedArticles");
                        let list = [];
                        try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
                        list.push(entry);
                        await game.settings.set("cyberpunk-red-agent-os-modified", "socialFeedArticles", JSON.stringify(list));
                        ui.notifications.info("Agent OS: Post published.");
                    } else {
                        // Players route through GM
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) {
                            ui.notifications.error("Agent OS: No System Admin online to publish your post.");
                            return;
                        }
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "socialFeedAppend", entry });
                        ui.notifications.info("Agent OS: Post transmitted.");
                    }
                    html.find('#social-post-text').val("");
                    html.find('#social-post-as').val("");
                    // Clear preserved drafts so the next re-render doesn't refill them.
                    if (this._composerDrafts) {
                        this._composerDrafts['social-post-text'] = "";
                        this._composerDrafts['social-post-as'] = "";
                    }
                    this.render(true);
                    break;
                }

                case 'delete-social-post': {
                    const postId = $(ev.currentTarget).data('post-id');
                    if (!postId) return;
                    const raw = game.settings.get("cyberpunk-red-agent-os-modified", "socialFeedArticles");
                    let list = [];
                    try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
                    const entry = list.find(e => e.id === postId);
                    if (!entry) { return; }
                    const canDel = game.user.isGM || (entry.authorId === game.user.id);
                    if (!canDel) { ui.notifications.warn("Agent OS: You can only delete your own posts."); return; }
                    if (game.user.isGM) {
                        const next = list.filter(e => e.id !== postId);
                        await game.settings.set("cyberpunk-red-agent-os-modified", "socialFeedArticles", JSON.stringify(next));
                        // setting onChange will trigger a render
                    } else {
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) { ui.notifications.error("Agent OS: No System Admin online to remove this post."); return; }
                        console.log("[Agent OS] Emitting socialFeedDelete:", { postId, requesterId: game.user.id });
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "socialFeedDelete", postId, requesterId: game.user.id });
                        // Don't local-render: wait for the GM's setting change to broadcast a fresh value.
                    }
                    break;
                }

                case 'save-social-feed': {
                    if (!game.user.isGM) return;
                    const raw = html.find('#admin-social-feed-input').val() || "";
                    let parsed = [];
                    // Accept JSON array OR "Category | Text" lines
                    const trimmed = raw.trim();
                    if (trimmed.startsWith("[")) {
                        try {
                            const j = JSON.parse(trimmed);
                            if (Array.isArray(j)) parsed = j.filter(e => e && (e.category || e.text));
                        } catch (e) {
                            ui.notifications.error("Agent OS: Invalid JSON in feed.");
                            return;
                        }
                    } else {
                        parsed = raw.split(/\r?\n/)
                            .map(line => line.trim())
                            .filter(Boolean)
                            .map(line => {
                                const idx = line.indexOf("|");
                                if (idx < 0) return { category: "Feed", text: line };
                                return { category: line.slice(0, idx).trim() || "Feed", text: line.slice(idx + 1).trim() };
                            })
                            .filter(e => e.text);
                    }
                    await game.settings.set("cyberpunk-red-agent-os-modified", "socialFeedArticles", JSON.stringify(parsed));
                    ui.notifications.info(`Agent OS: NetStatus feed saved (${parsed.length} article${parsed.length === 1 ? "" : "s"}).`);
                    this.render(true);
                    break;
                }

                case 'reset-social-feed': {
                    if (!game.user.isGM) return;
                    await game.settings.set("cyberpunk-red-agent-os-modified", "socialFeedArticles", "");
                    ui.notifications.info("Agent OS: NetStatus feed reset to defaults.");
                    this.render(true);
                    break;
                }

                case 'save-map-path': {
                    if (!game.user.isGM) return;
                    const val = (html.find('#admin-map-path-input').val() || "").trim() || "modules/cyberpunk-red-agent-os-modified/assets/night-city-map-red-final-v2.png";
                    // Patch5.5.20: catch absolute filesystem paths (Windows C:/...,
                    // macOS/Linux /Users/... or /home/...) before they get saved to a
                    // setting that won't load. Image src needs a Foundry-relative
                    // path (worlds/, modules/, systems/, etc.). Warn but still save
                    // — the GM might be intentionally testing something.
                    if (/^[a-zA-Z]:[\\/]/.test(val) || /^\/(?:Users|home|Volumes)\//.test(val)) {
                        ui.notifications.warn("Map path looks like an absolute filesystem path. Foundry needs a path relative to the user-data root (e.g. 'worlds/MyWorld/maps/img.png'). Use the BROWSE button to pick the image correctly.");
                    }
                    await game.settings.set("cyberpunk-red-agent-os-modified", "mapImagePath", val);
                    ui.notifications.info("Agent OS: Sat Map path saved.");
                    this.render(true);
                    break;
                }

                case 'reset-map-path': {
                    if (!game.user.isGM) return;
                    await game.settings.set("cyberpunk-red-agent-os-modified", "mapImagePath", "modules/cyberpunk-red-agent-os-modified/assets/night-city-map-red-final-v2.png");
                    ui.notifications.info("Agent OS: Sat Map reset to default.");
                    this.render(true);
                    break;
                }

                case 'save-ingame-clock': {
                    if (!game.user.isGM) return;
                    const clockVal = (html.find('#admin-clock-input').val() || "").trim();
                    // Validate HH:MM format
                    if (clockVal && !/^\d{1,2}:\d{2}$/.test(clockVal)) {
                        ui.notifications.warn("Agent OS: Invalid time format. Use HH:MM (e.g. 21:30)");
                        return;
                    }
                    await game.settings.set("cyberpunk-red-agent-os-modified", "inGameClock", clockVal);
                    ui.notifications.info(clockVal ? `Agent OS: In-game clock set to ${clockVal}` : "Agent OS: Clock cleared — using real time.");
                    this.render(true);
                    break;
                }

                case 'clear-ingame-clock': {
                    if (!game.user.isGM) return;
                    await game.settings.set("cyberpunk-red-agent-os-modified", "inGameClock", "");
                    ui.notifications.info("Agent OS: In-game clock cleared. Showing real time.");
                    this.render(true);
                    break;
                }

                case 'save-custom-store': {
                    if (!game.user.isGM) return;
                    const rawJson = (html.find('#admin-custom-store-input').val() || "[]").trim();
                    // Validate JSON
                    try {
                        const parsed = JSON.parse(rawJson);
                        if (!Array.isArray(parsed)) throw new Error("Must be a JSON array");
                        for (const it of parsed) {
                            if (!it.name || !it.category || !it.price) {
                                throw new Error(`Item missing required fields (name, category, price): ${JSON.stringify(it)}`);
                            }
                        }
                        await game.settings.set("cyberpunk-red-agent-os-modified", "customStoreItems", rawJson);
                        this._storeCatalog = null; this._storeLoading = null; // invalidate cache
                        ui.notifications.info(`Agent OS: ${parsed.length} custom store item(s) saved.`);
                    } catch (e) {
                        ui.notifications.error(`Agent OS: Invalid JSON — ${e.message}`);
                        return;
                    }
                    this.render(true);
                    break;
                }

                case 'add-custom-store-template': {
                    if (!game.user.isGM) return;
                    const textarea = html.find('#admin-custom-store-input');
                    let existing = [];
                    try { existing = JSON.parse(textarea.val() || "[]"); } catch (e) { existing = []; }
                    existing.push({ name: "New Item", category: "Gear", price: 100, description: "" });
                    textarea.val(JSON.stringify(existing, null, 2));
                    break;
                }

                case 'add-custom-store-item': {
                    // Patch4.7 follow-up: form-based custom item builder. Reads
                    // the field inputs, validates, appends to the existing
                    // customStoreItems setting, busts the catalog cache. No
                    // JSON typing required.
                    if (!game.user.isGM) return;
                    const name = (html.find('#custom-item-name').val() || "").trim();
                    const category = (html.find('#custom-item-category').val() || "").trim();
                    const priceRaw = html.find('#custom-item-price').val();
                    const price = Number(priceRaw);
                    const description = (html.find('#custom-item-description').val() || "").trim();
                    const img = (html.find('#custom-item-img').val() || "").trim();
                    if (!name) { ui.notifications.warn("Agent OS: Item name required."); return; }
                    if (!category) { ui.notifications.warn("Agent OS: Category required."); return; }
                    if (!Number.isFinite(price) || price <= 0) { ui.notifications.warn("Agent OS: Price must be a positive number."); return; }
                    let existing = [];
                    try { existing = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "customStoreItems") || "[]"); } catch(e) { existing = []; }
                    if (!Array.isArray(existing)) existing = [];
                    const newItem = { name, category, price };
                    if (description) newItem.description = description;
                    if (img) newItem.img = img;
                    existing.push(newItem);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "customStoreItems", JSON.stringify(existing));
                    this._storeCatalog = null; this._storeLoading = null;
                    // Clear the form fields + their preserved drafts
                    ["custom-item-name","custom-item-category","custom-item-price","custom-item-description","custom-item-img"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Agent OS: Added "${name}" (${category}, ${price}eb) to NC Mart.`);
                    this.render(true);
                    break;
                }

                // Modified build (П3): toggle a compendium pack via stylized
                // checkbox WITHOUT a full re-render — that was what bounced the
                // Sys Admin scroll to the top. We update the setting and patch the
                // affected DOM (row class + count pill) in place; the catalog cache
                // is invalidated so the change still takes effect on next store open.
                case 'toggle-store-pack': {
                    if (!game.user.isGM) return;
                    const cb = ev.currentTarget;
                    const packId = String($(cb).data('pack-id') || "");
                    if (!packId) break;
                    const cur = String(game.settings.get("cyberpunk-red-agent-os-modified", "customStorePacks") || "");
                    const entries = cur.split(",").map(s => s.trim()).filter(Boolean);
                    const idx = entries.indexOf(packId);
                    const nowOn = idx < 0;
                    if (idx >= 0) entries.splice(idx, 1);
                    else entries.push(packId);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "customStorePacks", entries.join(", "));
                    // Invalidate the cached catalog so the change takes effect.
                    this._storeCatalog = null; this._storeLoading = null;
                    this._playUiSound?.('tap');
                    // In-place DOM update (no render → no scroll jump).
                    $(cb).closest('.admin-pack-row').toggleClass('is-on', nowOn);
                    cb.checked = nowOn;
                    html.find('.admin-count-pill').first().text(entries.length);
                    // Keep the hidden manual-entry input in sync if it's present.
                    html.find('#admin-custom-packs-input').val(entries.join(", "));
                    break;
                }

                case 'copy-pack-id': {
                    // Patch4.7 follow-up: append the picked pack ID to the
                    // custom packs list (avoids the user having to remember /
                    // type the exact namespace). Saves immediately.
                    if (!game.user.isGM) return;
                    const packId = String($(ev.currentTarget).data('pack-id') || "");
                    if (!packId) return;
                    const cur = String(game.settings.get("cyberpunk-red-agent-os-modified", "customStorePacks") || "");
                    const entries = cur.split(",").map(s => s.trim()).filter(Boolean);
                    if (entries.includes(packId)) {
                        ui.notifications.info(`Agent OS: ${packId} already in the custom packs list.`);
                        return;
                    }
                    entries.push(packId);
                    const next = entries.join(", ");
                    await game.settings.set("cyberpunk-red-agent-os-modified", "customStorePacks", next);
                    this._storeCatalog = null; this._storeLoading = null;
                    ui.notifications.info(`Agent OS: Added ${packId} — items will load on next NC Mart open.`);
                    this.render(true);
                    break;
                }

                case 'save-store-gates': {
                    // Patch4 round 6 (CommanderCrunch69): Max Price / Source
                    // Filter / Locked Categories inputs had no save action —
                    // edits never wrote back. This commits all three to their
                    // world settings and busts the catalog cache so the shop
                    // re-renders with the new gates.
                    if (!game.user.isGM) return;
                    const rawPrice = html.find('#store-max-price-input').val();
                    const maxPrice = Math.max(0, Number(rawPrice) || 0);
                    const sourceFilter = html.find('#store-source-filter-select').val() || "all";
                    const locked = (html.find('#store-locked-categories-input').val() || "").trim();
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeMaxPrice", maxPrice);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeSourceFilter", sourceFilter);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeLockedCategories", locked);
                    this._storeCatalog = null; this._storeLoading = null;
                    const summary = [];
                    summary.push(maxPrice > 0 ? `cap ${maxPrice}eb` : "no cap");
                    summary.push(`source=${sourceFilter}`);
                    if (locked) summary.push(`locked: ${locked}`);
                    ui.notifications.info(`Agent OS: NC Mart gates saved — ${summary.join(", ")}.`);
                    this.render(true);
                    break;
                }

                case 'reset-store-gates': {
                    if (!game.user.isGM) return;
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeMaxPrice", 0);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeSourceFilter", "all");
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeLockedCategories", "");
                    this._storeCatalog = null; this._storeLoading = null;
                    ui.notifications.info("Agent OS: NC Mart gates cleared (no cap, all sources, no locked categories).");
                    this.render(true);
                    break;
                }

                case 'store-blacklist-add': {
                    if (!game.user.isGM) return;
                    const val = (html.find('#store-blacklist-input').val() || "").trim();
                    if (!val) return;
                    const cur = String(game.settings.get("cyberpunk-red-agent-os-modified", "storeBlacklistIds") || "");
                    const entries = cur.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                    if (!entries.includes(val)) entries.push(val);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeBlacklistIds", entries.join(", "));
                    html.find('#store-blacklist-input').val("");
                    this._storeCatalog = null; this._storeLoading = null;
                    this.render(true);
                    break;
                }

                case 'store-blacklist-remove': {
                    if (!game.user.isGM) return;
                    const entry = $(ev.currentTarget).data('entry');
                    if (!entry) return;
                    const cur = String(game.settings.get("cyberpunk-red-agent-os-modified", "storeBlacklistIds") || "");
                    const entries = cur.split(/[,\n]/).map(s => s.trim()).filter(Boolean).filter(e => e !== String(entry));
                    await game.settings.set("cyberpunk-red-agent-os-modified", "storeBlacklistIds", entries.join(", "));
                    this._storeCatalog = null; this._storeLoading = null;
                    this.render(true);
                    break;
                }

                case 'remove-custom-store-item': {
                    // Patch3 (CommanderCrunch69): one-click removal from the parsed list.
                    if (!game.user.isGM) return;
                    const idx = Number($(ev.currentTarget).data('item-index'));
                    if (!Number.isFinite(idx)) return;
                    let raw = game.settings.get("cyberpunk-red-agent-os-modified", "customStoreItems") || "[]";
                    let list = [];
                    try { list = JSON.parse(raw); } catch (e) { list = []; }
                    if (!Array.isArray(list) || idx < 0 || idx >= list.length) return;
                    const removed = list[idx];
                    list.splice(idx, 1);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "customStoreItems", JSON.stringify(list));
                    this._storeCatalog = null; this._storeLoading = null;
                    ui.notifications.info(`Agent OS: Removed "${removed?.name || 'item'}" from NC Mart.`);
                    this.render(true);
                    break;
                }

                case 'save-custom-packs': {
                    if (!game.user.isGM) return;
                    const packsVal = (html.find('#admin-custom-packs-input').val() || "").trim();
                    await game.settings.set("cyberpunk-red-agent-os-modified", "customStorePacks", packsVal);
                    this._storeCatalog = null; this._storeLoading = null; // invalidate cache
                    ui.notifications.info("Agent OS: Custom compendium packs saved.");
                    this.render(true);
                    break;
                }

                case 'toggle-ui-skin': {
                    if (!game.user.isGM) return;
                    const cur = game.settings.get("cyberpunk-red-agent-os-modified", "uiSkin") || "red";
                    const next = cur === "red" ? "2077" : "red";
                    await game.settings.set("cyberpunk-red-agent-os-modified", "uiSkin", next);
                    ui.notifications.info(`Agent OS: UI skin set to ${next.toUpperCase()}`);
                    // onChange in main.js broadcasts refreshSkin to clients
                    this.render(true);
                    break;
                }

                case 'save-tt-coverage': {
                    // Patch4.7 (Gotto): GM writes TT coverage tier + Fixer rank
                    // to each player's user flag.
                    if (!game.user.isGM) return;
                    for (const u of game.users.filter(x => !x.isGM)) {
                        const val = (html.find(`#tt-coverage-${u.id}`).val() || "").trim();
                        const prev = u.getFlag("cyberpunk-red-agent-os-modified", "ttCoverage") || "";
                        if (val !== prev) await u.setFlag("cyberpunk-red-agent-os-modified", "ttCoverage", val);
                        const rankRaw = html.find(`#fixer-rank-${u.id}`).val();
                        const rank = parseInt(rankRaw, 10);
                        const rankSafe = isNaN(rank) ? 0 : Math.max(0, Math.min(10, rank));
                        const rankPrev = Number(u.getFlag("cyberpunk-red-agent-os-modified", "fixerRank")) || 0;
                        if (rankSafe !== rankPrev) await u.setFlag("cyberpunk-red-agent-os-modified", "fixerRank", rankSafe);
                    }
                    ui.notifications.info("Agent Bio: TT coverage + Fixer rank updated.");
                    this.render(true);
                    break;
                }

                case 'admin-wallet-select': {
                    // Patch4.7 (Gotto): GM picks which wallet identity Sys Admin
                    // is acting against. Writes to `selectedAdminActorUuid` only —
                    // does NOT affect app-lock tabs (those use `_appLockPlayerUuid`).
                    if (!game.user.isGM) return;
                    const newTarget = $(ev.currentTarget).data('target-uuid');
                    if (!newTarget) break;
                    const _adminConsole = this.element.find('.admin-console')[0];
                    const _savedAdminScroll = _adminConsole ? _adminConsole.scrollTop : 0;
                    this.selectedAdminActorUuid = newTarget;

                    // 5.5.21: Wallet Identity tab now also drives the Agent ID
                    // view target. When GM picks a PC tab, the Agent ID card
                    // swaps to that PC's owner-user too — so wallet + ID stay
                    // in sync without the GM having to pick the same player
                    // twice. VirtualWallet leaves _idViewTargetUserId alone
                    // (GM may have it parked on a specific player already).
                    // DISPLAY-ONLY SYNC — message authoring, social posts,
                    // and auction bids still use real game.user identity.
                    if (newTarget && newTarget !== "VirtualWallet") {
                        const targetActor = this._resolveActor(newTarget);
                        if (targetActor) {
                            const ownerUser = game.users.find(u => !u.isGM && targetActor.testUserPermission(u, "OWNER"));
                            if (ownerUser) this._idViewTargetUserId = ownerUser.id;
                        }
                    }

                    this.render(true);
                    if (_savedAdminScroll > 0) {
                        const _restoreAdminScroll = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el) el.scrollTop = _savedAdminScroll;
                        };
                        requestAnimationFrame(_restoreAdminScroll);
                        setTimeout(_restoreAdminScroll, 0);
                        setTimeout(_restoreAdminScroll, 50);
                        setTimeout(_restoreAdminScroll, 150);
                    }
                    break;
                }

                case 'admin-tab-select': {
                    // Patch4 round 2: tabs now scope ONLY the Application
                    // Access toggles. GM identity / wallet view / transfers
                    // are unchanged. Writes to `_appLockPlayerUuid` only.
                    if (!game.user.isGM) return;
                    const newTarget = $(ev.currentTarget).data('target-uuid');
                    if (!newTarget) break;
                    // Patch4 round 4 (snap-to-top fix v2): the generic scroll
                    // preserver wasn't enough — capture and restore directly
                    // on this specific action, since tab clicks are the most
                    // common trigger for the bug. Save the admin-console
                    // scroll position synchronously here, render, then push
                    // the restore through multiple frames to defeat whatever
                    // is resetting it (likely the focus-management pass).
                    const _adminConsole = this.element.find('.admin-console')[0];
                    const _savedAdminScroll = _adminConsole ? _adminConsole.scrollTop : 0;
                    this._appLockPlayerUuid = newTarget;
                    this.render(true);
                    if (_savedAdminScroll > 0) {
                        const _restoreAdminScroll = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el) el.scrollTop = _savedAdminScroll;
                        };
                        // Stack multiple restore attempts at different times so
                        // we catch the final post-layout state regardless of
                        // when Foundry stops messing with scroll.
                        requestAnimationFrame(_restoreAdminScroll);
                        setTimeout(_restoreAdminScroll, 0);
                        setTimeout(_restoreAdminScroll, 50);
                        setTimeout(_restoreAdminScroll, 150);
                    }
                    break;
                }

                case 'toggle-app-lock': {
                    if (!game.user.isGM) return;
                    const appId = $(ev.currentTarget).data('app-id');
                    // Patch4 round 2: app-lock toggles are now driven by the
                    // dedicated `_appLockPlayerUuid` tab state. "VirtualWallet"
                    // means GM's own flags. "User.<id>" means a player with
                    // no assigned character (write to the user flag). Anything
                    // else is an actor uuid (write to the actor's flag).
                    const lockTargetUuid = this._appLockPlayerUuid || "VirtualWallet";
                    let targetObj = null;
                    if (lockTargetUuid === "VirtualWallet") {
                        targetObj = game.user; // GM
                    } else if (lockTargetUuid.startsWith("User.")) {
                        targetObj = game.users.get(lockTargetUuid.split(".")[1]);
                    } else {
                        targetObj = fromUuidSync(lockTargetUuid);
                    }
                    if (!targetObj) return;

                    // Patch4 round 5 (scroll-snap fix): same pattern as the
                    // admin-tab-select handler — snapshot the admin-console
                    // scroll BEFORE the render, restore via stacked timers.
                    const _adminConsoleT = this.element.find('.admin-console')[0];
                    const _savedAdminScrollT = _adminConsoleT ? _adminConsoleT.scrollTop : 0;

                    // Patch5.5.2: fallback list must match `defaultApps` above
                    // (5.5 added ncpd / ziggurat / garden). Out-of-sync fallback
                    // here would reset a player's unlockedApps to the old 11-app
                    // list on first toggle, effectively re-hiding the new apps.
                    let unlocked = targetObj.getFlag("cyberpunk-red-agent-os-modified", "unlockedApps") || ['chat', 'data', 'creds', 'map', 'id', 'social', 'bio', 'store', 'style', 'rep', 'auction', 'ncpd', 'ziggurat', 'garden'];
                    unlocked = unlocked.includes(appId) ? unlocked.filter(a => a !== appId) : [...unlocked, appId];
                    await targetObj.setFlag("cyberpunk-red-agent-os-modified", "unlockedApps", unlocked);
                    game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "refreshApps", actorUuid: lockTargetUuid });
                    this.render(true);

                    if (_savedAdminScrollT > 0) {
                        const _restoreAdminScrollT = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el) el.scrollTop = _savedAdminScrollT;
                        };
                        requestAnimationFrame(_restoreAdminScrollT);
                        setTimeout(_restoreAdminScrollT, 0);
                        setTimeout(_restoreAdminScrollT, 50);
                        setTimeout(_restoreAdminScrollT, 150);
                    }
                    break;
                }

                case 'pay-all-players': {
                    // Patch4.5: open in-phone modal instead of Foundry Dialog
                    // (consistent with Edit Agent ID / Ledger modals).
                    if (!game.user.isGM) return;
                    this.showPayAllModal = true;
                    this.render(true);
                    break;
                }

                case 'cancel-pay-all': {
                    this.showPayAllModal = false;
                    this.render(true);
                    break;
                }

                case 'confirm-pay-all': {
                    if (!game.user.isGM) return;
                    const amount = parseInt(html.find('#pay-all-amount').val());
                    const memo   = (html.find('#pay-all-memo').val() || "").trim() || "Gig Payout";
                    if (isNaN(amount) || amount <= 0) {
                        ui.notifications.warn("Agent Bank: Enter a positive amount.");
                        return;
                    }
                    this.showPayAllModal = false;
                    const fromUuid = this._getIdentity(game.user);
                    let paidCount = 0;
                    for (const player of this._getPartyPlayers()) {
                        if (!player.actorUuid) continue;
                        const ok = await this._executeTransfer(fromUuid, player.actorUuid, amount, memo);
                        if (ok) paidCount++;
                    }
                    ui.notifications.info(`Agent Bank: Paid ${amount}eb to ${paidCount} player(s). Memo: ${memo}`);
                    this.render(true);
                    break;
                }

                case 'add-manual-tx':
                    if (!game.user.isGM) return ui.notifications.warn("Agent: Ledger entries restricted to System Admin.");
                    this.showLedgerModal = true; this.render(true);
                    break;

                case 'cancel-ledger':
                    this.showLedgerModal = false; this.render(true);
                    break;

                case 'confirm-ledger': {
                    if (!game.user.isGM) return;
                    const lAmount = parseInt(html.find('#ledger-amount').val());
                    const lMemo = html.find('#ledger-memo').val() || "Manual Entry";
                    if (isNaN(lAmount) || lAmount === 0) {
                        ui.notifications.warn("Agent Bank: Enter a non-zero amount.");
                        return;
                    }
                    this.showLedgerModal = false;
                    if (lAmount > 0) {
                        await this._executeTransfer("VirtualWallet", this.actorUuid, lAmount, lMemo);
                    } else {
                        // Negative = deduction from target account
                        await this._executeTransfer(this.actorUuid, "VirtualWallet", Math.abs(lAmount), `[DEBIT] ${lMemo}`);
                    }
                    this.render(true);
                    break;
                }

                case 'map-zoom-in': {
                    this.mapZoom = Math.min((this.mapZoom || 1) * 1.2, 4);
                    this.render(true);
                    break;
                }

                case 'map-zoom-out': {
                    this.mapZoom = Math.max((this.mapZoom || 1) / 1.2, 0.4);
                    this.render(true);
                    break;
                }

                case 'refresh-creds': {
                    // Force-resolve the live actor, re-read flags from the DB,
                    // and re-render the wallet. Works in V12 where local caches
                    // can lag behind remote setFlag() writes from other clients.
                    this.actorUuid = this._getIdentity(game.user);
                    const liveActor = this._resolveActor(this.actorUuid);
                    if (liveActor) {
                        // Touch the actor to force a fresh read from the world DB.
                        try { liveActor.reset?.(); } catch (e) { /* non-fatal */ }
                    }
                    ui.notifications.info("Agent Bank: Ledger synced.");
                    this.render(true);
                    break;
                }

                case 'confirm-shard': {
                    if (!game.user.isGM) return;
                    const sTitle = html.find('#shard-title-input').val() || "ENCRYPTED_SHARD";
                    const sBody = html.find('#shard-content-input').val() || "SYSTEM_EMPTY";
                    const sTarget = html.find('#shard-target-selector').val();
                    this.showShardModal = false;
                    await this._pushShard(sTarget, sTitle, sBody);
                    this.render(true);
                    break;
                }

                case 'delete-shard': {
                    if (!game.user.isGM) return;
                    const delId = $(ev.currentTarget).data('shard-id');
                    const delOwnerId = $(ev.currentTarget).data('shard-owner');
                    await this._deleteShard(delId, delOwnerId);
                    this.render(true);
                    break;
                }

                case 'back-to-datapool':
                    this.currentView = 'data'; this.activeShardId = null; this.render(true);
                    break;

                case 'toggle-store-affordable': {
                    this._storeFilterAffordable = !this._storeFilterAffordable;
                    this.render(true);
                    break;
                }

                case 'social-set-filter': {
                    // Patch4.7 (Gotto): click a category chip in the Social
                    // feed header to filter to just that category.
                    const cat = $(ev.currentTarget).data('cat');
                    this._socialFilter = cat ? String(cat) : "all";
                    this.render(true);
                    break;
                }

                case 'store-set-category': {
                    // Save current scroll position before switching
                    const oldCat = this._storeCategory;
                    const storeList = html.find('.store-item-list')[0];
                    if (storeList && oldCat) this._storeScrollPositions[oldCat] = storeList.scrollTop;
                    this._storeCategory = $(ev.currentTarget).data('category') || "All";
                    this._storeSearch = "";
                    this._storeView = 'list';
                    this._storeMode = 'catalog';
                    this.render(true);
                    break;
                }

                case 'store-set-mode': {
                    // Patch5.5: flip between regular catalog and the GM-curated Night Market.
                    const mode = String($(ev.currentTarget).data('mode') || "catalog");
                    this._storeMode = (mode === "nightmarket") ? "nightmarket" : "catalog";
                    this._storeSearch = "";
                    this._storeView = 'list';
                    this.render(true);
                    break;
                }

                case 'store-view-cart': {
                    this._storeView = 'cart';
                    this.render(true);
                    break;
                }

                case 'store-back-to-list': {
                    this._storeView = 'list';
                    this.render(true);
                    break;
                }

                case 'store-add-to-cart': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    if (!uuid || !this._storeCatalog) return;
                    let found = null;
                    for (const cat of Object.keys(this._storeCatalog)) {
                        const m = this._storeCatalog[cat].find(i => i.uuid === uuid);
                        if (m) { found = m; break; }
                    }
                    if (!found) return;
                    await this._addToCart(uuid, found);
                    ui.notifications.info(`NC MART: ${found.name} added to cart.`);
                    this.render(false);
                    break;
                }

                case 'store-qty-inc': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    const cur = (this._getCart().find(e => e.itemUuid === uuid)?.qty) || 0;
                    await this._setCartQty(uuid, cur + 1);
                    this.render(true);
                    break;
                }

                case 'store-qty-dec': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    const cur = (this._getCart().find(e => e.itemUuid === uuid)?.qty) || 0;
                    await this._setCartQty(uuid, cur - 1);
                    this.render(true);
                    break;
                }

                case 'store-remove-item': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    await this._setCartQty(uuid, 0);
                    this.render(true);
                    break;
                }

                case 'store-checkout': {
                    await this._checkout();
                    break;
                }

                // --- STYLE CHECKER ---
                case 'style-tab': {
                    this._styleTab = $(ev.currentTarget).data('tab') || "outfit";
                    this.render(true);
                    break;
                }

                case 'toggle-style-info': {
                    // Patch3 (CommanderCrunch69 question): surface the Style formula.
                    this._showStyleInfo = !this._showStyleInfo;
                    this.render(false);
                    break;
                }

                // --- REPUTATION TRACKER ---
                case 'rep-set-standing': {
                    // Patch4.7.3 (Gotto, "fix it never happens again"): 4.7.2's
                    // capture-then-render pattern was racing the settings
                    // onChange render. The onChange in main.js fires a render
                    // synchronously during `await game.settings.set(...)`,
                    // BEFORE my code below ran — by the time I captured
                    // scrollTop, the DOM had already been rebuilt and scroll
                    // reset to 0, so I was saving 0 and restoring nothing.
                    //
                    // Fix: capture scrollTop BEFORE the await, stuff it
                    // directly into `_scrollPositions` (which the existing
                    // render-lifecycle restore in activateListeners reads),
                    // and pin it for several frames after the await so the
                    // chain of renders all converge on the same target value.
                    if (!game.user.isGM) return;
                    const npcId = $(ev.currentTarget).data('npc-id');
                    const standing = $(ev.currentTarget).data('standing');
                    // Step 1 — capture BEFORE any await.
                    const _repViewBefore = this.element.find('.rep-view')[0];
                    const _pinnedRepScroll = _repViewBefore ? _repViewBefore.scrollTop : 0;
                    this._scrollPositions = this._scrollPositions || {};
                    if (_pinnedRepScroll > 0) {
                        this._scrollPositions['.rep-view'] = _pinnedRepScroll;
                    }
                    // Step 2 — start an aggressive restoration loop NOW, before
                    // the settings save even fires. It re-asserts the scroll on
                    // every frame for ~400ms regardless of which renders fire
                    // in between. Stops the moment the scroll matches and stays.
                    if (_pinnedRepScroll > 0) {
                        const startedAt = Date.now();
                        const reassert = () => {
                            const el = this.element?.find?.('.rep-view')?.[0];
                            if (el && el.scrollTop !== _pinnedRepScroll) {
                                el.scrollTop = _pinnedRepScroll;
                            }
                            if (Date.now() - startedAt < 400) requestAnimationFrame(reassert);
                        };
                        requestAnimationFrame(reassert);
                    }
                    // Step 3 — do the actual write. The settings onChange will
                    // fire renders during this await; the reassert loop above
                    // catches them all.
                    let reps = [];
                    try { reps = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "npcReputations") || "[]"); } catch(e) {}
                    reps = reps.map(r => r.id === npcId ? { ...r, standing } : r);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "npcReputations", JSON.stringify(reps));
                    // Step 4 — explicit render is harmless; onChange already
                    // queued one, but call it to be sure the standing-pill
                    // visual state reflects the new value.
                    this.render(true);
                    break;
                }

                case 'rep-add-npc': {
                    if (!game.user.isGM) return;
                    const rName = html.find('#rep-npc-name').val()?.trim();
                    const rFaction = html.find('#rep-npc-faction').val()?.trim() || "Independent";
                    if (!rName) { ui.notifications.warn("Agent: Enter a name."); break; }
                    let reps = [];
                    try { reps = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "npcReputations") || "[]"); } catch(e) {}
                    // Patch4.7 (Gotto): if an edit is in progress, update in
                    // place instead of pushing a new entry.
                    if (this._repEditingId) {
                        const idx = reps.findIndex(r => r.id === this._repEditingId);
                        if (idx >= 0) {
                            reps[idx] = { ...reps[idx], name: rName, faction: rFaction };
                        } else {
                            reps.push({
                                id: "rep_" + foundry.utils.randomID(),
                                name: rName, faction: rFaction,
                                standing: "neutral", description: ""
                            });
                        }
                        this._repEditingId = null;
                    } else {
                        reps.push({
                            id: "rep_" + foundry.utils.randomID(),
                            name: rName,
                            faction: rFaction,
                            standing: "neutral",
                            description: ""
                        });
                    }
                    await game.settings.set("cyberpunk-red-agent-os-modified", "npcReputations", JSON.stringify(reps));
                    // Clear the input + draft so the row resets visibly.
                    html.find('#rep-npc-name').val("");
                    html.find('#rep-npc-faction').val("");
                    if (this._composerDrafts) {
                        this._composerDrafts['rep-npc-name'] = "";
                        this._composerDrafts['rep-npc-faction'] = "";
                    }
                    this.render(true);
                    break;
                }

                case 'rep-delete-npc': {
                    if (!game.user.isGM) return;
                    const delNpcId = $(ev.currentTarget).data('npc-id');
                    let reps = [];
                    try { reps = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "npcReputations") || "[]"); } catch(e) {}
                    reps = reps.filter(r => r.id !== delNpcId);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "npcReputations", JSON.stringify(reps));
                    this.render(true);
                    break;
                }

                // ════════════════════════════════════════════════════════════
                // Patch5.5 — Black Chrome / All About Agents app actions
                // ════════════════════════════════════════════════════════════

                // --- NCPD CRIME DATABASE ---
                case 'ncpd-modal-open': {
                    if (!game.user.isGM) return;
                    this._ncpdEditId = null; // + always adds a fresh record
                    this.showNcpdAddModal = true; this.render(true); break;
                }
                case 'ncpd-modal-close': {
                    this._ncpdEditId = null;
                    this.showNcpdAddModal = false; this.render(true); break;
                }
                // Modified build (П9): open the modal pre-filled to edit a record.
                case 'ncpd-edit-record': {
                    if (!game.user.isGM) return;
                    this._ncpdEditId = String($(ev.currentTarget).data('record-id') || "");
                    this.showNcpdAddModal = true; this.render(true); break;
                }
                case 'ziggurat-modal-open': {
                    if (!game.user.isGM) return;
                    this._zigguratEditId = null;
                    this.showZigguratAddModal = true; this.render(true); break;
                }
                case 'ziggurat-modal-close': {
                    this._zigguratEditId = null;
                    this.showZigguratAddModal = false; this.render(true); break;
                }
                case 'ziggurat-edit-entry-open': {
                    if (!game.user.isGM) return;
                    this._zigguratEditId = String($(ev.currentTarget).data('entry-id') || "");
                    this.showZigguratAddModal = true; this.render(true); break;
                }
                case 'garden-modal-open': {
                    if (!game.user.isGM) return;
                    this._gardenEditId = null;
                    this.showGardenAddModal = true; this.render(true); break;
                }
                case 'garden-modal-close': {
                    this._gardenEditId = null;
                    this.showGardenAddModal = false; this.render(true); break;
                }
                case 'garden-edit-profile-open': {
                    if (!game.user.isGM) return;
                    this._gardenEditId = String($(ev.currentTarget).data('profile-id') || "");
                    this.showGardenAddModal = true; this.render(true); break;
                }
                case 'ncpd-search': {
                    this._ncpdSearch = String($(ev.currentTarget).val() || "");
                    this.render(false);
                    break;
                }
                case 'ncpd-open-record': {
                    this._ncpdActiveId = String($(ev.currentTarget).data('record-id') || "");
                    this.render(true);
                    break;
                }
                case 'ncpd-close-record': {
                    this._ncpdActiveId = null;
                    this.render(true);
                    break;
                }
                case 'ncpd-add-record': {
                    if (!game.user.isGM) return;
                    // Patch5.5.5: prefer the modal-prefixed inputs when the modal is open
                    const useModal = this.showNcpdAddModal && html.find('#ncpd-modal-name').length > 0;
                    const name = useModal
                        ? (html.find('#ncpd-modal-name').val() || "").trim()
                        : (html.find('#ncpd-add-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("NCPD: Suspect name required."); return; }
                    const charges = useModal ? (html.find('#ncpd-modal-charges').val() || "").trim() : (html.find('#ncpd-add-charges').val() || "").trim();
                    const bounty  = useModal ? (html.find('#ncpd-modal-bounty').val()  || "").trim() : (html.find('#ncpd-add-bounty').val()  || "").trim();
                    const status  = useModal ? (html.find('#ncpd-modal-status').val()  || "Known to police").trim() : (html.find('#ncpd-add-status').val() || "Known to police").trim();
                    const notes   = useModal ? (html.find('#ncpd-modal-notes').val()   || "").trim() : (html.find('#ncpd-add-notes').val()   || "").trim();
                    // Patch5.5.18: the const mugshot declaration was missing — list.push later
                    // referenced an undefined `mugshot` symbol → ReferenceError swallowed by
                    // Foundry's event-handler wrapper → FILE button appeared to hang.
                    const mugshot = useModal ? (html.find('#ncpd-modal-mugshot').val() || "").trim() : "";
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "ncpdRapSheets") || "[]"); } catch(e) {}
                    // Modified build (П9): editing an existing record updates it
                    // in place instead of adding a new one.
                    if (this._ncpdEditId) {
                        const idx = list.findIndex(r => r.id === this._ncpdEditId);
                        if (idx >= 0) {
                            list[idx] = { ...list[idx], name, charges, bounty, status, notes, mugshot };
                        }
                        this._ncpdEditId = null;
                    } else {
                        list.push({
                            id: "rap_" + foundry.utils.randomID(),
                            name, charges, bounty, status, notes, mugshot,
                            createdAt: Date.now()
                        });
                    }
                    await game.settings.set("cyberpunk-red-agent-os-modified", "ncpdRapSheets", JSON.stringify(list));
                    if (useModal) this.showNcpdAddModal = false;
                    // Patch5.5.19: reset list-view state so the GM definitively
                    // lands on the unfiltered list with the new record visible.
                    // Previously, if a search was active or a detail view was
                    // open, the post-save render still respected those states
                    // and the new card appeared not to land. Now: clear search,
                    // close detail view, force list mode.
                    this._ncpdActiveId = null;
                    this._ncpdSearch = "";
                    ["ncpd-add-name","ncpd-add-charges","ncpd-add-bounty","ncpd-add-status","ncpd-add-notes",
                     "ncpd-modal-name","ncpd-modal-charges","ncpd-modal-bounty","ncpd-modal-status","ncpd-modal-notes","ncpd-modal-mugshot"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`NCPD: Filed rap sheet for "${name}".`);
                    this.render(true);
                    break;
                }
                case 'ncpd-delete-record': {
                    if (!game.user.isGM) return;
                    const rid = String($(ev.currentTarget).data('record-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "ncpdRapSheets") || "[]"); } catch(e) {}
                    const target = list.find(r => r.id === rid);
                    const ok = await this._confirmDelete(target?.name);
                    if (!ok) break;
                    list = list.filter(r => r.id !== rid);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "ncpdRapSheets", JSON.stringify(list));
                    // Modified build: close the detail view if we just deleted the open record.
                    if (this._ncpdActiveId === rid) this._ncpdActiveId = null;
                    this._ncpdEditId = null;
                    this._playUiSound?.('tap');
                    this.render(true);
                    break;
                }

                // --- ZIGGURAT CITY DATABASE ---
                case 'ziggurat-search': {
                    this._zigguratSearch = String($(ev.currentTarget).val() || "");
                    this.render(false);
                    break;
                }
                case 'ziggurat-set-category': {
                    this._zigguratCategory = String($(ev.currentTarget).data('category') || "All");
                    this.render(true);
                    break;
                }
                case 'ziggurat-add-entry': {
                    if (!game.user.isGM) return;
                    const useZigModal = this.showZigguratAddModal && html.find('#ziggurat-modal-name').length > 0;
                    const name = useZigModal
                        ? (html.find('#ziggurat-modal-name').val() || "").trim()
                        : (html.find('#ziggurat-add-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("Ziggurat: Entry name required."); return; }
                    const category = useZigModal ? (html.find('#ziggurat-modal-category').val() || "Other").trim() : (html.find('#ziggurat-add-category').val() || "Other").trim();
                    const address  = useZigModal ? (html.find('#ziggurat-modal-address').val()  || "").trim() : (html.find('#ziggurat-add-address').val()  || "").trim();
                    const hours    = useZigModal ? (html.find('#ziggurat-modal-hours').val()    || "").trim() : (html.find('#ziggurat-add-hours').val()    || "").trim();
                    const notes    = useZigModal ? (html.find('#ziggurat-modal-notes').val()    || "").trim() : (html.find('#ziggurat-add-notes').val()    || "").trim();
                    // Patch5.5.12: optional venue/fixer image. Renders next to name in detail + list views.
                    const image = useZigModal ? (html.find('#ziggurat-modal-image').val() || "").trim() : "";
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "cityDirectoryEntries") || "[]"); } catch(e) {}
                    // Modified build (П9): edit-in-place when editing.
                    if (this._zigguratEditId) {
                        const idx = list.findIndex(r => r.id === this._zigguratEditId);
                        if (idx >= 0) list[idx] = { ...list[idx], name, category, address, hours, notes, image };
                        this._zigguratEditId = null;
                    } else {
                        list.push({
                            id: "city_" + foundry.utils.randomID(),
                            name, category, address, hours, notes, image
                        });
                    }
                    await game.settings.set("cyberpunk-red-agent-os-modified", "cityDirectoryEntries", JSON.stringify(list));
                    if (useZigModal) this.showZigguratAddModal = false;
                    ["ziggurat-add-name","ziggurat-add-category","ziggurat-add-address","ziggurat-add-hours","ziggurat-add-notes","ziggurat-modal-image",
                     "ziggurat-modal-name","ziggurat-modal-category","ziggurat-modal-address","ziggurat-modal-hours","ziggurat-modal-notes"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Ziggurat: Added "${name}" to the city directory.`);
                    this.render(true);
                    break;
                }
                case 'ziggurat-delete-entry': {
                    if (!game.user.isGM) return;
                    const eid = String($(ev.currentTarget).data('entry-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "cityDirectoryEntries") || "[]"); } catch(e) {}
                    list = list.filter(r => r.id !== eid);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "cityDirectoryEntries", JSON.stringify(list));
                    this.render(true);
                    break;
                }

                // --- THE GARDEN ---
                case 'garden-open-profile': {
                    this._gardenActiveId = String($(ev.currentTarget).data('profile-id') || "");
                    this.render(true);
                    break;
                }
                case 'garden-close-profile': {
                    this._gardenActiveId = null;
                    this.render(true);
                    break;
                }
                case 'garden-message-profile': {
                    // Player taps "Message" on a profile → materialise an NPC
                    // contact + open a Messenger thread with them.
                    const pid = String($(ev.currentTarget).data('profile-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "gardenProfiles") || "[]"); } catch(e) {}
                    const profile = list.find(p => p.id === pid);
                    if (!profile) { ui.notifications.warn("The Garden: profile not found."); return; }
                    const contactId = `npc_garden_${pid}`;
                    let mine = game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                    if (!mine.some(c => c.id === contactId)) {
                        mine = mine.concat([{
                            id: contactId,
                            name: profile.name || "Garden match",
                            originalName: profile.name || "Garden match",
                            avatar: profile.photo || "",
                            isPlayer: false,
                            targetUserIds: [game.user.id]
                        }]);
                        await game.user.setFlag("cyberpunk-red-agent-os-modified", "customContacts", mine);
                    }
                    this.activeContactId = contactId;
                    this.currentView = 'chat-thread';
                    this._gardenActiveId = null;
                    this.render(true);
                    break;
                }
                case 'garden-add-profile': {
                    if (!game.user.isGM) return;
                    const useGarModal = this.showGardenAddModal && html.find('#garden-modal-name').length > 0;
                    const name = useGarModal
                        ? (html.find('#garden-modal-name').val() || "").trim()
                        : (html.find('#garden-add-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("Garden: Name required."); return; }
                    const age          = useGarModal ? (html.find('#garden-modal-age').val()          || "").trim() : (html.find('#garden-add-age').val()          || "").trim();
                    const photo        = useGarModal ? (html.find('#garden-modal-photo').val()        || "").trim() : (html.find('#garden-add-photo').val()        || "").trim();
                    const bio          = useGarModal ? (html.find('#garden-modal-bio').val()          || "").trim() : (html.find('#garden-add-bio').val()          || "").trim();
                    const interests    = useGarModal ? (html.find('#garden-modal-interests').val()    || "").trim() : (html.find('#garden-add-interests').val()    || "").trim();
                    const availability = useGarModal ? (html.find('#garden-modal-availability').val() || "Active").trim() : (html.find('#garden-add-availability').val() || "Active").trim();
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "gardenProfiles") || "[]"); } catch(e) {}
                    // Modified build (П9): edit-in-place when editing (preserve targetUserIds).
                    if (this._gardenEditId) {
                        const idx = list.findIndex(p => p.id === this._gardenEditId);
                        if (idx >= 0) list[idx] = { ...list[idx], name, age, photo, bio, interests, availability };
                        this._gardenEditId = null;
                    } else {
                        list.push({
                            id: "g_" + foundry.utils.randomID(),
                            name, age, photo, bio, interests, availability,
                            targetUserIds: []
                        });
                    }
                    await game.settings.set("cyberpunk-red-agent-os-modified", "gardenProfiles", JSON.stringify(list));
                    if (useGarModal) this.showGardenAddModal = false;
                    ["garden-add-name","garden-add-age","garden-add-photo","garden-add-bio","garden-add-interests","garden-add-availability",
                     "garden-modal-name","garden-modal-age","garden-modal-photo","garden-modal-bio","garden-modal-interests","garden-modal-availability"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Garden: Added profile for "${name}".`);
                    this.render(true);
                    break;
                }
                case 'garden-delete-profile': {
                    if (!game.user.isGM) return;
                    const pid = String($(ev.currentTarget).data('profile-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "gardenProfiles") || "[]"); } catch(e) {}
                    const target = list.find(p => p.id === pid);
                    const ok = await this._confirmDelete(target?.name);
                    if (!ok) break;
                    list = list.filter(p => p.id !== pid);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "gardenProfiles", JSON.stringify(list));
                    // Modified build: close the detail view if we just deleted the open profile.
                    if (this._gardenActiveId === pid) this._gardenActiveId = null;
                    this._gardenEditId = null;
                    this._playUiSound?.('tap');
                    this.render(true);
                    break;
                }

                // --- PERSONAL CONTACTS (Modified build П4) ---
                case 'contacts-add-open': {
                    this._contactEditId = null;
                    this.showContactModal = true;
                    this.render(true);
                    break;
                }
                case 'contacts-edit-open': {
                    this._contactEditId = String($(ev.currentTarget).data('contact-id') || "");
                    this.showContactModal = true;
                    this.render(true);
                    break;
                }
                case 'contacts-modal-close': {
                    this._contactEditId = null;
                    this.showContactModal = false;
                    this.render(true);
                    break;
                }
                case 'contacts-toggle-folder': {
                    if (!game.user.isGM) return;
                    const uid = String($(ev.currentTarget).data('user-id') || "");
                    this._contactsOpenFolder = (this._contactsOpenFolder === uid) ? null : uid;
                    this.render(true);
                    break;
                }
                case 'contacts-save': {
                    // Players (and the GM) save their OWN contacts. The GM editing a
                    // player's contact in a folder isn't supported here — folders are
                    // read-only review; players own their data.
                    const name = (html.find('#contact-modal-name').val() || "").trim();
                    if (!name) { ui.notifications.warn(game.i18n.localize("AGENTOS.Contacts.NameReq")); break; }
                    const note    = (html.find('#contact-modal-note').val() || "").trim();
                    const address = (html.find('#contact-modal-address').val() || "").trim();
                    const color   = (html.find('#contact-modal-color').val() || "#39d98a").trim();
                    const useLoc  = html.find('#contact-modal-haslocation').is(':checked');
                    const mapX = Number(html.find('#contact-modal-mapx').val());
                    const mapY = Number(html.find('#contact-modal-mapy').val());
                    let list = this._getPersonalContacts(game.user).slice();
                    const payload = {
                        name, note, address, color,
                        hasLocation: !!useLoc,
                        mapX: (useLoc && Number.isFinite(mapX)) ? mapX : null,
                        mapY: (useLoc && Number.isFinite(mapY)) ? mapY : null
                    };
                    if (this._contactEditId) {
                        const idx = list.findIndex(c => c.id === this._contactEditId);
                        if (idx >= 0) list[idx] = { ...list[idx], ...payload };
                    } else {
                        list.push({ id: "ct_" + foundry.utils.randomID(), ...payload });
                    }
                    await game.user.setFlag("cyberpunk-red-agent-os-modified", "personalContacts", list);
                    this.showContactModal = false;
                    this._contactEditId = null;
                    this._playUiSound?.('tap');
                    this.render(true);
                    break;
                }
                case 'contacts-delete': {
                    const cid = String($(ev.currentTarget).data('contact-id') || "");
                    let list = this._getPersonalContacts(game.user).slice();
                    const target = list.find(c => c.id === cid);
                    const ok = await this._confirmDelete(target?.name);
                    if (!ok) break;
                    list = list.filter(c => c.id !== cid);
                    await game.user.setFlag("cyberpunk-red-agent-os-modified", "personalContacts", list);
                    this._playUiSound?.('tap');
                    this.render(true);
                    break;
                }

                // --- MAP INDICATORS ---
                case 'map-toggle-pin-mode': {
                    if (!game.user.isGM) return;
                    this._mapPinMode = !this._mapPinMode;
                    this.render(true);
                    break;
                }
                case 'map-pin-modal-cancel': {
                    this.showMapPinModal = false;
                    this.render(true);
                    break;
                }
                case 'map-pin-modal-save': {
                    if (!game.user.isGM) return;
                    const label = (html.find('#map-pin-modal-label').val() || "").trim();
                    if (!label) { ui.notifications.warn("Map: pin needs a label."); return; }
                    // Patch5.5.17: read selected radio by name (not by id — the swatches all
                    // shared the same id, which made jQuery #map-pin-modal-color match only
                    // the first entry and every pin came out blue regardless of click).
                    const color = (html.find('input[name="map-pin-modal-color"]:checked').val() || "#ffcc00").trim();
                    const icon = (html.find('input[name="map-pin-modal-icon"]:checked').val() || "fa-map-pin").trim();
                    const notes = (html.find('#map-pin-modal-notes').val() || "").trim();
                    const visible = !!html.find('#map-pin-modal-visible').is(':checked');
                    // Patch5.5.18 (Sleepingmann): per-pin label display mode.
                    // 'always' = label always visible (default), 'hover' = only on hover,
                    // 'off' = no label, just the icon.
                    const labelMode = String(html.find('input[name="map-pin-modal-label-mode"]:checked').val() || 'always');
                    let pins = [];
                    try { pins = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "mapIndicators") || "[]"); } catch (e) {}
                    if (!Array.isArray(pins)) pins = [];
                    pins.push({
                        id: "pin_" + foundry.utils.randomID(),
                        label, color, icon, notes, labelMode,
                        x: Number(this._pendingPinX) || 50,
                        y: Number(this._pendingPinY) || 50,
                        isVisible: visible,
                        createdAt: Date.now()
                    });
                    await game.settings.set("cyberpunk-red-agent-os-modified", "mapIndicators", JSON.stringify(pins));
                    this.showMapPinModal = false;
                    ui.notifications.info(`Map: Pin "${label}" placed.`);
                    this.render(true);
                    break;
                }
                case 'map-pin-manage-open': {
                    if (!game.user.isGM) return;
                    this.showMapPinManageModal = true;
                    this.render(true);
                    break;
                }
                case 'map-pin-manage-close': {
                    this.showMapPinManageModal = false;
                    this.render(true);
                    break;
                }
                case 'map-pin-add': {
                    if (!game.user.isGM) return;
                    const label = (html.find('#map-pin-label').val() || "").trim();
                    if (!label) { ui.notifications.warn("Map: Pin label required."); return; }
                    const xRaw = Number(html.find('#map-pin-x').val());
                    const yRaw = Number(html.find('#map-pin-y').val());
                    const x = Number.isFinite(xRaw) ? Math.max(0, Math.min(100, xRaw)) : 50;
                    const y = Number.isFinite(yRaw) ? Math.max(0, Math.min(100, yRaw)) : 50;
                    const color = (html.find('#map-pin-color').val() || "#ffcc00").trim();
                    const icon = (html.find('#map-pin-icon').val() || "fa-map-pin").trim();
                    const notes = (html.find('#map-pin-notes').val() || "").trim();
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "mapIndicators") || "[]"); } catch(e) {}
                    list.push({
                        id: "pin_" + foundry.utils.randomID(),
                        label, x, y, color, icon, notes, isVisible: true
                    });
                    await game.settings.set("cyberpunk-red-agent-os-modified", "mapIndicators", JSON.stringify(list));
                    ["map-pin-label","map-pin-x","map-pin-y","map-pin-color","map-pin-icon","map-pin-notes"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Map: Pin "${label}" placed.`);
                    this.render(true);
                    break;
                }
                case 'map-pin-toggle': {
                    if (!game.user.isGM) return;
                    const pid = String($(ev.currentTarget).data('pin-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "mapIndicators") || "[]"); } catch(e) {}
                    list = list.map(p => p.id === pid ? { ...p, isVisible: !p.isVisible } : p);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "mapIndicators", JSON.stringify(list));
                    this.render(true);
                    break;
                }
                case 'map-pin-delete': {
                    if (!game.user.isGM) return;
                    const pid = String($(ev.currentTarget).data('pin-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "mapIndicators") || "[]"); } catch(e) {}
                    list = list.filter(p => p.id !== pid);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "mapIndicators", JSON.stringify(list));
                    this.render(true);
                    break;
                }

                // --- HOUSING / RENT (per-user flag, set via Sys Admin) ---
                case 'save-housing': {
                    if (!game.user.isGM) return;
                    // Patch5.5.20: snap-back defense (rep-toggle pattern). setFlag fires
                    // onChange hooks that may trigger intermediate renders before the
                    // manual render(true) below. Pin the admin-console scroll for ~400ms
                    // via rAF so all intermediate renders converge on the saved value.
                    const _adminEl = this.element.find('.admin-console')[0];
                    const _pinScroll = _adminEl ? _adminEl.scrollTop : 0;
                    this._scrollPositions = this._scrollPositions || {};
                    if (_pinScroll > 0) this._scrollPositions['.admin-console'] = _pinScroll;
                    if (_pinScroll > 0) {
                        const startedAt = Date.now();
                        const reassert = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el && el.scrollTop !== _pinScroll) el.scrollTop = _pinScroll;
                            if (Date.now() - startedAt < 400) requestAnimationFrame(reassert);
                        };
                        requestAnimationFrame(reassert);
                    }
                    const inputs = html.find('[data-housing-row]');
                    for (const el of inputs.toArray()) {
                        const $row = $(el);
                        const ownerKind = $row.data('owner-kind');
                        const ownerId = String($row.data('owner-id') || "");
                        if (!ownerId) continue;
                        const status = (html.find(`#housing-status-${ownerKind}-${ownerId}`).val() || "").trim();
                        const rent = (html.find(`#housing-rent-${ownerKind}-${ownerId}`).val() || "").trim();
                        const target = (ownerKind === 'actor') ? game.actors.get(ownerId) : game.users.get(ownerId);
                        if (!target) continue;
                        const prevS = target.getFlag("cyberpunk-red-agent-os-modified", "housingStatus") || "";
                        const prevR = target.getFlag("cyberpunk-red-agent-os-modified", "housingRent") || "";
                        if (status !== prevS) await target.setFlag("cyberpunk-red-agent-os-modified", "housingStatus", status);
                        if (rent !== prevR) await target.setFlag("cyberpunk-red-agent-os-modified", "housingRent", rent);
                    }
                    ui.notifications.info("Housing: roster updated.");
                    this.render(true);
                    break;
                }

                // --- NIGHT MARKET ---
                case 'nm-load-catalog': {
                    // Patch5.5.12: explicit Sys Admin trigger for loading the NC
                    // Mart catalog so the Night Market picker can populate without
                    // the GM having to open NC Mart first. Re-runs the same lazy
                    // loader the player-side NC Mart uses; cached on the instance.
                    if (!game.user.isGM) return;
                    if (this._storeCatalog) {
                        ui.notifications.info("NC Mart catalog: refreshing...");
                        this._storeCatalog = null;
                    } else {
                        ui.notifications.info("NC Mart catalog: importing (one moment)...");
                    }
                    try {
                        await this._loadStoreCatalog();
                        ui.notifications.info("NC Mart catalog: loaded.");
                    } catch (e) {
                        console.error(e);
                        ui.notifications.error("NC Mart catalog: load failed — see console.");
                    }
                    this.render(true);
                    break;
                }
                case 'nm-start': {
                    // Patch5.5.6: explicit START NIGHT MARKET — creates an empty
                    // market with a GM-chosen name. END clears it back to null.
                    if (!game.user.isGM) return;
                    const name = (html.find('#nm-start-name').val() || "Night Market").trim() || "Night Market";
                    const nm = { name, openedAt: Date.now(), items: [] };
                    await game.settings.set("cyberpunk-red-agent-os-modified", "nightMarketActive", JSON.stringify(nm));
                    if (this._composerDrafts) this._composerDrafts['nm-start-name'] = "";
                    html.find('#nm-start-name').val("");
                    ui.notifications.info(`Night Market: "${name}" is now open. Add items to make it visible to players.`);
                    this.render(true);
                    break;
                }
                case 'nm-clear': {
                    if (!game.user.isGM) return;
                    await game.settings.set("cyberpunk-red-agent-os-modified", "nightMarketActive", "");
                    ui.notifications.info("Night Market: cleared.");
                    this.render(true);
                    break;
                }
                case 'nm-add-from-catalog': {
                    if (!game.user.isGM) return;
                    const uuid = String($(ev.currentTarget).data('item-uuid') || "");
                    if (!uuid || !this._storeCatalog) return;
                    let found = null;
                    for (const cat of Object.keys(this._storeCatalog)) {
                        const m = this._storeCatalog[cat].find(i => i.uuid === uuid);
                        if (m) { found = m; break; }
                    }
                    if (!found) return;
                    const flavor = (html.find(`#nm-flavor-${uuid}`).val() || "").trim();
                    // Patch5.5.12: optional price override. Blank/0/non-numeric falls
                    // back to catalog price; any positive number wins. Lets the GM
                    // mark stuff up ("scarcity tax") or down ("fell off the truck").
                    const priceOverrideRaw = (html.find(`#nm-price-${uuid}`).val() || "").trim();
                    const priceOverride = Number(priceOverrideRaw);
                    const finalPrice = (priceOverrideRaw !== "" && Number.isFinite(priceOverride) && priceOverride >= 0)
                        ? priceOverride
                        : (Number(found.price) || 0);
                    let nm = null;
                    try { const raw = game.settings.get("cyberpunk-red-agent-os-modified", "nightMarketActive") || ""; nm = raw ? JSON.parse(raw) : null; } catch(e) {}
                    if (!nm) nm = { name: "Night Market", openedAt: Date.now(), items: [] };
                    if (nm.items.some(it => it.uuid === uuid)) {
                        ui.notifications.warn("Night Market: item already in the curated list.");
                        return;
                    }
                    nm.items.push({
                        uuid: found.uuid,
                        name: found.name,
                        price: finalPrice,
                        catalogPrice: Number(found.price) || 0,
                        img: found.img || "",
                        flavor
                    });
                    await game.settings.set("cyberpunk-red-agent-os-modified", "nightMarketActive", JSON.stringify(nm));
                    ui.notifications.info(`Night Market: Added "${found.name}".`);
                    this.render(true);
                    break;
                }
                case 'nm-remove-item': {
                    if (!game.user.isGM) return;
                    const uuid = String($(ev.currentTarget).data('item-uuid') || "");
                    let nm = null;
                    try { const raw = game.settings.get("cyberpunk-red-agent-os-modified", "nightMarketActive") || ""; nm = raw ? JSON.parse(raw) : null; } catch(e) {}
                    if (!nm) return;
                    nm.items = (nm.items || []).filter(it => it.uuid !== uuid);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "nightMarketActive", JSON.stringify(nm));
                    this.render(true);
                    break;
                }

                // --- TT MEDSCAN REQUEST ---
                // Modified build (П6): sync the phone to the current player Actor —
                // refreshes biomonitor (HP/humanity) AND wallet (balance + CPR
                // transaction history) from the live Actor data.
                case 'sync-biomonitor': {
                    await this._syncToCurrentActor();
                    break;
                }

                case 'request-medscan': {
                    // Player taps "Request MedScan" on Bio. Posts a chat message
                    // whispered to GMs so they can narratively rule on the
                    // First Aid / Paramedic or Medical Tech / Surgery bonus.
                    const ttCoverage = game.user.getFlag("cyberpunk-red-agent-os-modified", "ttCoverage") || "";
                    if (!ttCoverage) {
                        ui.notifications.warn("Trauma Team: No active coverage on file.");
                        return;
                    }
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    if (gmIds.length === 0) {
                        ui.notifications.warn("Trauma Team: No System Admin online to take the request.");
                        return;
                    }
                    const userHandle = (game.user.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || game.user.name;
                    const body = `<div style="border:1px solid #ff3333; padding:8px; border-radius:6px; background:rgba(255,51,51,0.06);"><strong style="color:#ff3333;">TRAUMA TEAM MEDSCAN REQUEST</strong><br><span style="color:#aaa; font-size:0.85em;">Coverage tier:</span> <strong>${ttCoverage}</strong><br><span style="color:#aaa; font-size:0.85em;">From:</span> <strong>${userHandle}</strong><br><em style="color:#888; font-size:0.85em;">GM: rule on First Aid / Paramedic or Medical Tech / Surgery bonus narratively.</em></div>`;
                    await ChatMessage.create({
                        content: body,
                        speaker: { alias: `${userHandle} → Trauma Team` },
                        whisper: gmIds,
                        flags: { "cyberpunk-red-agent-os-modified": { isAgentMessage: false, medScanRequest: true } }
                    });
                    ui.notifications.info("Trauma Team: MedScan request sent to GM.");
                    break;
                }

                case 'rep-edit-npc': {
                    // Patch4.7 (Gotto): pre-fill the add row with the existing
                    // values, mark as edit-in-progress, and let the GM save
                    // back by clicking the + button. Simple in-place edit.
                    if (!game.user.isGM) return;
                    const editId = $(ev.currentTarget).data('npc-id');
                    const editName = String($(ev.currentTarget).data('npc-name') || "");
                    const editFaction = String($(ev.currentTarget).data('npc-faction') || "");
                    html.find('#rep-npc-name').val(editName).focus();
                    html.find('#rep-npc-faction').val(editFaction);
                    if (this._composerDrafts) {
                        this._composerDrafts['rep-npc-name'] = editName;
                        this._composerDrafts['rep-npc-faction'] = editFaction;
                    }
                    this._repEditingId = editId; // checked by rep-add-npc
                    ui.notifications.info(`Agent: Editing "${editName}" — change fields and press +.`);
                    break;
                }

                case 'rep-open-messenger': {
                    // Patch4.7 follow-up (Gotto): previously this jumped
                    // straight into a 1-1 thread with the fixer. Expected
                    // behavior: act like starting a NEW message — open the
                    // ADD CONTACT modal pre-filled with the fixer's name so
                    // the user (especially GM) can pick which player
                    // device(s) the contact targets before the thread opens.
                    const npcName = String($(ev.currentTarget).data('npc-name') || "");
                    // Navigate to the Contacts view so the modal renders
                    // against the right background, then open the modal with
                    // the name pre-filled. For non-GMs the modal still works —
                    // it's just a simpler add-to-own-contacts flow.
                    this.currentView = 'chat';
                    this.activeContactId = null;
                    this.editContactId = null;
                    this.editContactName = npcName;
                    // 5.5.22 (CommanderCrunch69): players can't use the FilePicker
                    // (no Foundry permission). Pre-fill the avatar from a same-
                    // named world Actor's portrait if one exists, so the player
                    // can just hit SAVE and get a real picture instead of the
                    // mystery-man default. They can still clear/override the
                    // field before saving.
                    const _npcActorMatch = game.actors?.find?.(a => a.name === npcName);
                    const _npcActorImg = _npcActorMatch?.img && _npcActorMatch.img !== "icons/svg/mystery-man.svg"
                        ? _npcActorMatch.img : "";
                    this.editContactAvatar = _npcActorImg;
                    this.showAddContact = true;
                    if (this._composerDrafts) {
                        this._composerDrafts['new-contact-name'] = npcName;
                        this._composerDrafts['new-contact-avatar'] = _npcActorImg;
                    }
                    this.render(true);
                    break;
                }

                // --- AUCTION HOUSE ---
                case 'auction-view-detail': {
                    this._auctionDetailId = $(ev.currentTarget).data('auction-id');
                    this._auctionView = 'detail';
                    this.render(true);
                    break;
                }

                case 'auction-back-to-list': {
                    this._auctionView = 'list';
                    this._auctionDetailId = null;
                    this.render(true);
                    break;
                }

                case 'auction-place-npc-bid': {
                    // Patch4 (Gotto Goho): GM-only path to record a bid placed
                    // by an off-screen NPC (a fixer, a corp agent, a rival fixer
                    // running in absentia). Player UX is unchanged; this just
                    // adds an explicit "NPC bid" button that prompts for a name.
                    // Patch4.6: open in-phone modal instead of Foundry Dialog.
                    if (!game.user.isGM) return;
                    const aId = $(ev.currentTarget).data('auction-id');
                    const bidInput = html.find('#auction-bid-amount');
                    const bidIncrement = parseInt(bidInput.val());
                    if (isNaN(bidIncrement) || bidIncrement <= 0) {
                        ui.notifications.warn("Agent Auction: Enter a valid bid amount before placing the NPC bid.");
                        break;
                    }
                    this._pendingNpcBid = { auctionId: aId, increment: bidIncrement };
                    this.showNpcBidModal = true;
                    this.render(true);
                    break;
                }

                case 'cancel-npc-bid': {
                    this.showNpcBidModal = false;
                    this._pendingNpcBid = null;
                    this.render(true);
                    break;
                }

                case 'cancel-pending': {
                    // Patch4.6: dismiss the generic in-phone confirm modal.
                    this._pendingConfirm = null;
                    this.render(true);
                    break;
                }

                case 'confirm-pending': {
                    // Patch4.6: dispatch the generic confirm modal's "yes" path.
                    const pending = this._pendingConfirm;
                    if (!pending) { this.render(true); break; }
                    this._pendingConfirm = null;
                    try {
                        if (pending.kind === 'delete-message') {
                            const msg = game.messages.get(pending.payload?.msgId);
                            if (msg) await msg.delete();
                        } else if (pending.kind === 'delete-contact') {
                            const id = pending.payload?.contactId;
                            if (id) {
                                // Remove from customContacts (stored NPC contacts)
                                let mine = game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                                if (mine.some(c => c.id === id)) {
                                    mine = mine.filter(c => c.id !== id);
                                    await game.user.setFlag("cyberpunk-red-agent-os-modified", "customContacts", mine);
                                }
                                // Patch4.7: clear any orphan unreads for this thread so
                                // the home-screen badge doesn't keep ringing.
                                const cur = game.user.getFlag("cyberpunk-red-agent-os-modified", "unreads") || {};
                                if (Object.prototype.hasOwnProperty.call(cur, id)) {
                                    const next = { ...cur };
                                    delete next[id];
                                    await game.user.setFlag("cyberpunk-red-agent-os-modified", "unreads", next);
                                }
                                // GM: also nuke switchboard-generated NPC threads + push removal to players
                                if (game.user.isGM && String(id).startsWith("npc_")) {
                                    const threadMsgs = game.messages.filter(m =>
                                        m.flags?.["cyberpunk-red-agent-os-modified"]?.isAgentMessage && m.flags["cyberpunk-red-agent-os-modified"].threadId === id
                                    );
                                    if (threadMsgs.length > 0) {
                                        await ChatMessage.deleteDocuments(threadMsgs.map(m => m.id));
                                    }
                                    for (const u of game.users) {
                                        if (u.id === game.user.id) continue;
                                        let playerContacts = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                                        if (playerContacts.some(c => c.id === id)) {
                                            playerContacts = playerContacts.filter(c => c.id !== id);
                                            await u.setFlag("cyberpunk-red-agent-os-modified", "customContacts", playerContacts);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error("AgentDevice | confirm-pending dispatch failed:", err);
                        ui.notifications.error("Agent: Action failed — see console.");
                    }
                    this.render(true);
                    break;
                }

                case 'confirm-npc-bid': {
                    if (!game.user.isGM) return;
                    const npcName = (html.find('#npc-bidder-name').val() || "").trim();
                    if (!npcName) {
                        ui.notifications.warn("Agent Auction: NPC bidder name required.");
                        return;
                    }
                    const pending = this._pendingNpcBid;
                    if (!pending) { this.showNpcBidModal = false; this.render(true); break; }
                    const aId = pending.auctionId;
                    const bidIncrement = pending.increment;
                    this.showNpcBidModal = false;
                    this._pendingNpcBid = null;
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings") || "[]"); } catch(e) {}
                    const auc = auctions.find(a => a.id === aId);
                    if (!auc) { ui.notifications.warn("Agent Auction: Listing not found."); this.render(true); break; }
                    if (auc.settled || (auc.endTime && Date.now() > auc.endTime)) {
                        ui.notifications.warn("Agent Auction: This auction has ended.");
                        this.render(true);
                        break;
                    }
                    const newTotal = (auc.currentBid || 0) + bidIncrement;
                    auc.currentBid = newTotal;
                    auc.highBidderId = `npc:${foundry.utils.randomID()}`;
                    auc.highBidderName = npcName.slice(0, 60);
                    auc.bidCount = (auc.bidCount || 0) + 1;
                    auc.isNpcBid = true;
                    this._pendingAuctionData = auctions;
                    ui.notifications.info(`Agent Auction: NPC bid recorded — ${npcName} +${bidIncrement}eb (new total ${newTotal}eb).`);
                    this.render(true);
                    game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", JSON.stringify(auctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
                    }).catch(err => {
                        console.error("Agent Auction | npc-bid save failed:", err);
                        this._pendingAuctionData = null;
                        ui.notifications.error("Agent Auction: Failed to save NPC bid.");
                        this.render(true);
                    });
                    break;
                }

                case 'auction-place-bid': {
                    const aId = $(ev.currentTarget).data('auction-id');
                    const bidInput = html.find('#auction-bid-amount');
                    const bidIncrement = parseInt(bidInput.val());
                    if (isNaN(bidIncrement) || bidIncrement <= 0) {
                        ui.notifications.warn("Agent Auction: Enter a valid bid amount.");
                        break;
                    }
                    const bidPayload = {
                        action: "auctionBid",
                        auctionId: aId,
                        bidderId: game.user.id,
                        // Patch3: requesterId == bidderId is the integrity check; GM-side
                        // rejects payloads where the two disagree. Stops trivial impersonation.
                        requesterId: game.user.id,
                        bidderName: (game.user.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || game.user.name,
                        bidIncrement: bidIncrement,
                        actorUuid: this.actorUuid
                    };
                    if (game.user.isGM) {
                        // GM bids process locally — socket.emit doesn't loop back to sender
                        let auctions = [];
                        try { auctions = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings") || "[]"); } catch(e) {}
                        const auc = auctions.find(a => a.id === aId);
                        if (!auc) { ui.notifications.warn("Agent Auction: Listing not found."); break; }
                        if (auc.settled || (auc.endTime && Date.now() > auc.endTime)) {
                            ui.notifications.warn("Agent Auction: This auction has ended.");
                            break;
                        }
                        // Bid is an increment: current 100 + bid 10 = new total 110
                        const newTotal = (auc.currentBid || 0) + bidIncrement;
                        auc.currentBid = newTotal;
                        auc.highBidderId = game.user.id;
                        auc.highBidderName = bidPayload.bidderName;
                        auc.bidCount = (auc.bidCount || 0) + 1;
                        const updatedJSON = JSON.stringify(auctions);
                        // Optimistic UI: render with local data immediately, then persist
                        this._pendingAuctionData = auctions;
                        ui.notifications.info(`Agent Auction: +${bidIncrement}eb — new total ${newTotal}eb.`);
                        this.render(true);
                        game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", updatedJSON).then(() => {
                            this._pendingAuctionData = null;
                            game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
                        }).catch(err => {
                            console.error("Agent Auction | settings.set FAILED:", err);
                            this._pendingAuctionData = null;
                            ui.notifications.error("Agent Auction: Failed to save bid.");
                            this.render(true);
                        });
                    } else {
                        // Players send bid to GM for processing
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", bidPayload);
                        ui.notifications.info(`Agent Auction: Bid of +${bidIncrement}eb sent.`);
                    }
                    break;
                }

                case 'auction-create': {
                    if (!game.user.isGM) return;
                    const aName = html.find('#auction-item-name').val()?.trim();
                    const aDesc = html.find('#auction-item-desc').val()?.trim() || "";
                    const aStart = parseInt(html.find('#auction-start-bid').val()) || 100;
                    const aHrs = parseInt(html.find('#auction-duration-hrs').val()) || 0;
                    const aMins = parseInt(html.find('#auction-duration-min').val()) || 0;
                    const totalMs = (aHrs * 3600000) + (aMins * 60000);
                    if (!aName) { ui.notifications.warn("Agent Auction: Enter an item name."); break; }
                    if (totalMs <= 0) { ui.notifications.warn("Agent Auction: Duration must be at least 1 minute."); break; }
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings") || "[]"); } catch(e) {}
                    auctions.push({
                        id: "auc_" + foundry.utils.randomID(),
                        name: aName,
                        description: aDesc,
                        startingBid: aStart,
                        currentBid: aStart,
                        highBidderId: null,
                        highBidderName: null,
                        bidCount: 0,
                        createdAt: Date.now(),
                        endTime: Date.now() + totalMs,
                        settled: false
                    });
                    // Format display string
                    const dispParts = [];
                    if (aHrs > 0) dispParts.push(`${aHrs}h`);
                    if (aMins > 0) dispParts.push(`${aMins}m`);
                    // Optimistic UI: render with local data immediately, then persist
                    this._pendingAuctionData = auctions;
                    ui.notifications.info(`Agent Auction: "${aName}" listed for ${dispParts.join(' ')}.`);
                    this.render(true);
                    game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", JSON.stringify(auctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
                    });
                    break;
                }

                case 'auction-end-now': {
                    if (!game.user.isGM) return;
                    const endId = $(ev.currentTarget).data('auction-id');
                    let endAuctions = [];
                    try { endAuctions = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings") || "[]"); } catch(e) {}
                    const endAuc = endAuctions.find(a => a.id === endId);
                    if (!endAuc) break;
                    endAuc.endTime = Date.now() - 1; // force expired
                    this._pendingAuctionData = endAuctions;
                    ui.notifications.info(`Agent Auction: "${endAuc.name}" ended by GM.`);
                    this.render(true);
                    game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", JSON.stringify(endAuctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
                    });
                    break;
                }

                case 'auction-settle': {
                    if (!game.user.isGM) return;
                    const settleId = $(ev.currentTarget).data('auction-id');
                    await this._settleAuction(settleId);
                    break;
                }

                case 'auction-cancel': {
                    if (!game.user.isGM) return;
                    const cancelId = $(ev.currentTarget).data('auction-id');
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings") || "[]"); } catch(e) {}
                    auctions = auctions.filter(a => a.id !== cancelId);
                    // Optimistic UI: render with local data immediately, then persist
                    this._pendingAuctionData = auctions;
                    this._auctionView = 'list'; this._auctionDetailId = null;
                    ui.notifications.info("Agent Auction: Listing removed.");
                    this.render(true);
                    game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", JSON.stringify(auctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
                    });
                    break;
                }

                case 'panic-alert': {
                    // Whisper to GMs only to avoid leaking IC distress to all players
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    ChatMessage.create({
                        content: `<b>EMERGENCY SIGNAL</b>: ${_agentEscHTML(game.user.name)} activated Panic Button!`,
                        speaker: { alias: "Trauma Team" },
                        whisper: gmIds,
                        flags: { "cyberpunk-red-agent-os-modified": { isAgentMessage: false, isPanic: true } }
                    });
                    ui.notifications.warn("Agent: Trauma Team alerted.");
                    break;
                }

                case 'panic-meatwagon': {
                    // Patch5.5.5: REO Meatwagon button — same alert pipeline as
                    // Trauma Team, just routed under the "Meatwagon" alias.
                    // Players without TT coverage still get a panic option, and
                    // it's a fat hook for the GM to roleplay a scrap-grade
                    // ambulance call instead of leaving them with no out.
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    const handle = (game.user.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || game.user.name;
                    ChatMessage.create({
                        content: `<div style="border:1px solid #aa6600; padding:8px; border-radius:6px; background:rgba(255,153,0,0.08);"><b style="color:#ff9900;">REO MEATWAGON CALL</b><br><span style="color:#aaa; font-size:0.85em;">No TT coverage on file.</span><br><span style="color:#aaa; font-size:0.85em;">From:</span> <b>${_agentEscHTML(handle)}</b><br><em style="color:#888; font-size:0.85em;">GM: a beat-up scrap-grade ambulance is dispatched — narrate accordingly. ETA, cost, and competence are at your discretion.</em></div>`,
                        speaker: { alias: `${handle} → REO Meatwagon` },
                        whisper: gmIds,
                        flags: { "cyberpunk-red-agent-os-modified": { isAgentMessage: false, isPanic: true, isMeatwagon: true } }
                    });
                    ui.notifications.warn("Agent: REO Meatwagon dispatched. Cross your fingers.");
                    break;
                }

                case 'switch-actor': {
                    const newUuid = $(ev.currentTarget).data('actor-uuid');
                    if (!newUuid || newUuid === this.actorUuid) break;
                    await game.user.setFlag("cyberpunk-red-agent-os-modified", "lastActorUuid", newUuid);
                    this.actorUuid = newUuid;
                    ui.notifications.info(`Agent OS: Identity switched to ${this._resolveActor(newUuid)?.name || "unknown"}`);
                    this.render(true);
                    break;
                }

                case 'edit-agent-id': {
                    // Patch4.5: open the in-phone modal instead of the
                    // immersion-breaking Foundry Dialog popup.
                    if (!game.user.isGM) {
                        ui.notifications.warn("Agent ID: Only the GM can edit ID cards.");
                        break;
                    }
                    const targetUserId = this._idViewTargetUserId;
                    const targetUser = targetUserId ? game.users.get(targetUserId) : null;
                    if (!targetUser) {
                        ui.notifications.warn("Agent ID: No player selected.");
                        break;
                    }
                    // Patch4.7.2 (Gotto): the form fields use data-preserve-draft,
                    // which stashes user input in `_composerDrafts` so a stray
                    // re-render doesn't wipe what the GM just typed. Side effect:
                    // opening edit on player A, then on player B, restored A's
                    // typed values into B's form. Reset the drafts to the target
                    // player's CURRENT saved overrides every time edit is opened
                    // so each open starts fresh against the right player.
                    const eOver = targetUser.getFlag("cyberpunk-red-agent-os-modified", "idOverrides") || {};
                    if (!this._composerDrafts) this._composerDrafts = {};
                    this._composerDrafts['id-edit-display-name'] = eOver.displayName || "";
                    this._composerDrafts['id-edit-handle']       = eOver.handle      || "";
                    this._composerDrafts['id-edit-subtitle']     = eOver.subtitle    || "";
                    this._composerDrafts['id-edit-sin']          = eOver.sinStatus   || "Registered";
                    this._composerDrafts['id-edit-clearance']    = eOver.clearance   || "";
                    this.showIdEditModal = true;
                    this.render(true);
                    break;
                }

                case 'save-agent-id': {
                    if (!game.user.isGM) return;
                    const targetUserId = this._idViewTargetUserId;
                    const targetUser = targetUserId ? game.users.get(targetUserId) : null;
                    if (!targetUser) {
                        ui.notifications.warn("Agent ID: No player selected.");
                        break;
                    }
                    const result = {
                        displayName: (html.find('#id-edit-display-name').val() || "").trim(),
                        handle:      (html.find('#id-edit-handle').val() || "").trim(),
                        subtitle:    (html.find('#id-edit-subtitle').val() || "").trim() || "Citizen Priority A+",
                        sinStatus:   html.find('#id-edit-sin').val() || "Registered",
                        clearance:   (html.find('#id-edit-clearance').val() || "").trim() || "Verified"
                    };
                    await targetUser.setFlag("cyberpunk-red-agent-os-modified", "idOverrides", result);
                    this.showIdEditModal = false;
                    // Patch4.7.2: scrub the form drafts so the next open is clean.
                    if (this._composerDrafts) {
                        ['id-edit-display-name','id-edit-handle','id-edit-subtitle','id-edit-sin','id-edit-clearance']
                            .forEach(k => delete this._composerDrafts[k]);
                    }
                    ui.notifications.info(`Agent ID: Saved for ${targetUser.name}.`);
                    this.render(true);
                    break;
                }

                case 'cancel-agent-id': {
                    this.showIdEditModal = false;
                    // Patch4.7.2: scrub drafts so the next open of edit on a
                    // different player doesn't carry over the cancelled values.
                    if (this._composerDrafts) {
                        ['id-edit-display-name','id-edit-handle','id-edit-subtitle','id-edit-sin','id-edit-clearance']
                            .forEach(k => delete this._composerDrafts[k]);
                    }
                    this.render(true);
                    break;
                }

                case 'id-select-player': {
                    const playerId = ev.currentTarget.dataset.playerId;
                    if (playerId) {
                        this._idViewTargetUserId = playerId;
                        this.render(true);
                    }
                    break;
                }

                case 'open-shard-modal':
                    if (!game.user.isGM) return;
                    this.showShardModal = true; this.render(true);
                    break;

                case 'cancel-shard':
                    this.showShardModal = false; this.render(true);
                    break;
            }
        });

        // Store search — debounced re-render so getData does the actual filter.
        // Server-side filter is what's verified working; DOM toggle was unreliable.
        html.on('input', '#store-search-input', (ev) => {
            const raw = ev.currentTarget.value || "";
            this._storeSearch = raw;
            console.log("[Agent OS] store-search input:", JSON.stringify(raw));
            clearTimeout(this._storeSearchDebounce);
            this._storeSearchDebounce = setTimeout(() => {
                if (this.rendered && this.currentView === 'store' && this._storeView === 'list') {
                    this.render(false);
                }
            }, 180);
        });

        // Bind via keyup too (some browser/Foundry combos don't bubble input events here)
        html.on('keyup', '#store-search-input', (ev) => {
            const raw = ev.currentTarget.value || "";
            if (raw === this._storeSearch) return;
            this._storeSearch = raw;
            clearTimeout(this._storeSearchDebounce);
            this._storeSearchDebounce = setTimeout(() => {
                if (this.rendered && this.currentView === 'store' && this._storeView === 'list') {
                    this.render(false);
                }
            }, 180);
        });

        // Restore focus + cursor to end after a search-triggered render so typing flow continues.
        // Patch5.0.2 (Ryouhi): use `el.ownerDocument.activeElement` not the
        // top-level `document` so this works correctly when the app is
        // popped out into a second browser window via the Pop Out! module.
        const _ss = html.find('#store-search-input')[0];
        if (_ss && this._storeSearch && _ss.ownerDocument?.activeElement !== _ss) {
            _ss.focus();
            try { _ss.setSelectionRange(_ss.value.length, _ss.value.length); } catch (e) {}
        }

        // Restore NC Mart scroll position for the current category
        const _storeListEl = html.find('.store-item-list')[0];
        if (_storeListEl && this._storeCategory && this._storeScrollPositions[this._storeCategory]) {
            _storeListEl.scrollTop = this._storeScrollPositions[this._storeCategory];
        }

        // Patch3.3: restore scroll positions of long admin/list containers so
        // toggling items (e.g. Sys Admin app-lock toggles, NC Mart GM-controls
        // edits) doesn't snap the view back to the top.
        // Patch4 round 2: do this BOTH synchronously and again on the next
        // animation frame. The synchronous pass handles content that already
        // measured; the rAF pass catches flex children whose final height
        // wasn't known until layout completed (which is why tab clicks were
        // still snapping to the top even though the restore code existed).
        const _restoreScroll = () => {
            if (!this._scrollPositions) return;
            for (const [sel, top] of Object.entries(this._scrollPositions)) {
                const el = html.find(sel)[0];
                if (el && top > 0) el.scrollTop = top;
            }
        };
        _restoreScroll();
        requestAnimationFrame(() => { _restoreScroll(); requestAnimationFrame(_restoreScroll); });
        setTimeout(_restoreScroll, 50);
        setTimeout(_restoreScroll, 150);

        // Patch3 (your own list): NC Mart category bar "snap-back" — after a
        // re-render the bar's horizontal scroll resets to 0, hiding the active
        // tab if it was off-screen. Bring the active category into view.
        const _catBar = html.find('.store-category-bar')[0];
        const _catActive = _catBar && _catBar.querySelector('.store-cat-btn.active');
        if (_catBar && _catActive) {
            const barRect = _catBar.getBoundingClientRect();
            const btnRect = _catActive.getBoundingClientRect();
            if (btnRect.right > barRect.right || btnRect.left < barRect.left) {
                _catBar.scrollTo({
                    left: _catActive.offsetLeft - (_catBar.clientWidth / 2) + (_catActive.offsetWidth / 2),
                    behavior: 'auto'
                });
            }
        }

        // Datapool Search — client-side filter, no re-render (preserves input focus)
        html.on('input', '#shard-search-input', ev => {
            this.shardSearchQuery = ev.target.value || "";
            const q = this.shardSearchQuery.toLowerCase();
            html.find('.shard-item').each(function () {
                const name = ($(this).find('.shard-title').text() || "").toLowerCase();
                $(this).toggle(!q || name.includes(q));
            });
        });

        // Clicking a Shard to Read
        html.on('click', '.shard-item', ev => {
            if ($(ev.target).closest('[data-action="delete-shard"]').length) return;
            const sid = $(ev.currentTarget).data('shard-id');
            let shard = null;
            if (game.user.isGM) {
                // GM: search all users' shards
                for (const user of game.users) {
                    const userShards = user.getFlag("cyberpunk-red-agent-os-modified", "shards") || [];
                    shard = userShards.find(s => s.id === sid);
                    if (shard) break;
                }
            } else {
                const shards = game.user.getFlag("cyberpunk-red-agent-os-modified", "shards") || [];
                shard = shards.find(s => s.id === sid);
            }
            if (shard) {
                this.activeShardId = sid;
                this.activeShardName = shard.name;
                this.activeShardContent = shard.content;
                this.currentView = 'reader';
                this.render(true);
            }
        });

        // Messaging
        html.on('click', '.contact-card', async ev => {
            ev.preventDefault(); ev.stopPropagation();
            this.activeContactId = $(ev.currentTarget).data('contact-id');
            let unreads = game.user.getFlag("cyberpunk-red-agent-os-modified", "unreads") || {};
            if (unreads[this.activeContactId]) {
                unreads[this.activeContactId] = 0;
                await game.user.setFlag("cyberpunk-red-agent-os-modified", "unreads", unreads);
            }
            this.currentView = 'chat-thread';
            this.render(true);
        });

        html.on('click', '#agent-chat-send', async ev => {
            ev.preventDefault(); ev.stopPropagation();
            let input = html.find('#agent-chat-input');
            let raw = (input.val() || "").trim();
            // Modified build: if a file is staged, the SEND button posts it with
            // whatever the user typed as the caption (caption may be empty).
            if (this._stagedAttachment && this.activeContactId) {
                input.val("");
                this._chatInputDraft = "";
                await this._sendStagedAttachment(raw);
                return;
            }
            if (!raw || !this.activeContactId) return;
            const content = foundry.utils.escapeHTML
                ? foundry.utils.escapeHTML(raw).replace(/\n/g, '<br>')
                : raw.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\n/g, '<br>');
            // Resolve display name + routing for the current thread
            const contacts = this._getContacts();
            const threadContact = contacts.find(c => c.id === this.activeContactId);
            const isNpcThread = this.activeContactId?.startsWith("npc_");

            // Patch4.8.3: if GM is in a custom group thread AND has picked an
            // NPC voice via the speak-as switcher, override the speaker to
            // that NPC. Picker stores the raw NPC id ("npc_abc..."), with the
            // sentinel "gm" meaning "speak as GM (default)".
            let groupNpcOverride = null;
            const _isCustomGroup = !!threadContact?.isCustomGroup;
            if (game.user.isGM && _isCustomGroup && this._gmSpeakingAsInThread) {
                const cur = this._gmSpeakingAsInThread[this.activeContactId];
                if (cur && cur !== "gm") {
                    // Lookup the picked NPC contact across all user lists
                    // (any GM-authored NPC can be voiced even if it lives on
                    // a player's device).
                    for (const u of game.users) {
                        const lst = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                        const match = lst.find(c => c.id === cur);
                        if (match) { groupNpcOverride = match; break; }
                    }
                }
            }

            const speakerAlias = (game.user.isGM && isNpcThread && threadContact)
                ? (threadContact.originalName || threadContact.name)
                : (groupNpcOverride
                    ? (groupNpcOverride.originalName || groupNpcOverride.name)
                    : (game.user.name + " (Agent)"));

            const npcOverrideName = (game.user.isGM && isNpcThread && threadContact)
                ? (threadContact.originalName || threadContact.name)
                : (groupNpcOverride ? (groupNpcOverride.originalName || groupNpcOverride.name) : undefined);
            // 5.5.27 (live-Foundry screenshot): cross-user avatar resolution. See
            // attachment-send block for the full reasoning — same lookup applies
            // to the regular text-send path. Preserves the existing
            // groupNpcOverride pathway for GM-voiced custom group threads.
            let _resolvedNpcAvatar = (game.user.isGM && isNpcThread && threadContact?.avatar) ? threadContact.avatar : null;
            if (!_resolvedNpcAvatar && game.user.isGM && isNpcThread) {
                for (const u of game.users) {
                    const lst = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                    const m = lst.find(c => c.id === this.activeContactId);
                    if (m?.avatar) { _resolvedNpcAvatar = m.avatar; break; }
                }
            }
            const npcOverrideAvatar = _resolvedNpcAvatar
                || (groupNpcOverride?.avatar || undefined);
            let messageData = {
                content: content,
                speaker: { alias: speakerAlias },
                flags: {
                    "cyberpunk-red-agent-os-modified": {
                        isAgentMessage: true,
                        threadId: this.activeContactId,
                        overrideName: npcOverrideName,
                        overrideAvatar: npcOverrideAvatar,
                        targetName: threadContact?.name
                    }
                }
            };
            if (this.activeContactId !== 'party_group_chat') {
                // Patch4.8: custom group threads (pcgroup_* id, isCustomGroup:true)
                // route the whisper to every player member + all GMs. NPC
                // members are conceptually part of the group but have no user
                // record — their "voice" is the GM's, who's already covered.
                if (this.activeContactId?.startsWith("pcgroup_") || threadContact?.isCustomGroup) {
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    const targets = new Set(gmIds);
                    targets.add(game.user.id); // include self for loopback render
                    const members = Array.isArray(threadContact?.members) ? threadContact.members : [];
                    for (const m of members) {
                        if (m.startsWith("player:")) targets.add(m.slice("player:".length));
                    }
                    messageData.whisper = Array.from(targets);
                } else if (game.users.get(this.activeContactId)) {
                    // DM to another user
                    messageData.whisper = [this.activeContactId];
                } else if (isNpcThread) {
                    // NPC thread routing
                    if (game.user.isGM) {
                        // GM replying as NPC: whisper to every player the contact is targeted to,
                        // any prior owner detected by the dynamic switchboard, plus other GMs.
                        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                        const targets = new Set(gmIds);
                        const tList = Array.isArray(threadContact?.targetUserIds) ? threadContact.targetUserIds : [];
                        for (const uid of tList) targets.add(uid);
                        if (threadContact?.ownerId) targets.add(threadContact.ownerId);
                        messageData.whisper = Array.from(targets);
                    } else {
                        // Player messaging an NPC: whisper to all GMs
                        messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                    }
                } else if (!game.user.isGM) {
                    messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                }
            }
            this._emitTypingStop();
            this._chatNearBottom = true;
            this._forceScrollOnNextRender = true;
            this._chatInputDraft = "";
            input.val('');
            this._autoGrowInput(input[0]);
            await ChatMessage.create(messageData);
        });

        // --- Realistic-texting wiring ---
        html.on('keydown', '#agent-chat-input', (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
                ev.preventDefault();
                html.find('#agent-chat-send').trigger('click');
            }
        });
        html.on('input', '#agent-chat-input', (ev) => {
            this._autoGrowInput(ev.currentTarget);
            this._chatInputDraft = ev.currentTarget.value || "";
            if ((ev.currentTarget.value || "").trim().length > 0) this._emitTyping();
            else this._emitTypingStop();
        });
        html.on('blur', '#agent-chat-input', () => this._emitTypingStop());

        // Modified build (П4): when a file is chosen via the upload buttons,
        // stage it in the composer so the user can add a caption before sending.
        html.on('change', '#agent-attach-file-input, #agent-attach-picker-input', async (ev) => {
            const file = ev.currentTarget.files?.[0];
            // Reset so picking the same file twice still fires `change`.
            ev.currentTarget.value = "";
            if (!file) return;
            this.showAttachPicker = false;
            await this._stageAttachment(file);
        });

        // Modified build: cancel a staged (not-yet-sent) attachment.
        html.on('click', '[data-action="cancel-staged-attachment"]', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            this._stagedAttachment = null;
            this.render(true);
        });

        // --- Delete chat message ---
        html.on('click', '.delete-chat-msg', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const msgId = $(ev.currentTarget).data('msg-id');
            if (!msgId) return;
            const msg = game.messages.get(msgId);
            if (!msg) return;
            const canDelete = msg.author?.id === game.user.id || game.user.isGM;
            if (!canDelete) { ui.notifications.warn("Agent: Cannot purge this record."); return; }
            // Patch4.6: in-phone confirm modal instead of Foundry Dialog.
            this._pendingConfirm = {
                kind: 'delete-message',
                payload: { msgId },
                title: "PURGE RECORD",
                message: "Delete this message permanently?",
                confirmLabel: "PURGE",
                accent: "red"
            };
            this.render(true);
        });

        // Close button
        html.on('mousedown click', '.agent-close-btn', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (ev.type !== 'click') return;
            this._emitTypingStop?.();
            this.close();
        });

        // --- Contact Management ---
        // Patch3 (CommanderCrunch69): Fixers app sort dropdown.
        html.on('change', '#rep-sort-select', (ev) => {
            this._repSort = ev.currentTarget.value || "default";
            this.render(false);
        });

        // Patch4.7 (Gotto): NC Mart price-tier dropdown. Bound on `change`
        // because the global data-action switch only listens for clicks.
        html.on('change', '#store-price-tier-select', (ev) => {
            this._storePriceTier = String(ev.currentTarget.value || "all");
            this.render(true);
        });

        // Patch4.8.3: GM speak-as switcher in multi-NPC group threads.
        html.on('change', '#gm-group-voice-select', (ev) => {
            if (!game.user.isGM || !this.activeContactId) return;
            const voice = String(ev.currentTarget.value || "gm");
            this._gmSpeakingAsInThread = this._gmSpeakingAsInThread || {};
            this._gmSpeakingAsInThread[this.activeContactId] = voice;
            this.render(true);
        });

        // Patch3 (CommanderCrunch69 / Forge VTT): launch Foundry's FilePicker for the
        // contact avatar so paths resolve correctly across Forge / Bazaar / local servers
        // instead of relying on the user pasting a copy-pasted folder path.
        html.on('click', '.pick-contact-avatar', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            // 5.5.26: hard permission gate — even if the button somehow
            // survives the template gate, refuse to render the FilePicker
            // when the user doesn't have FILES_BROWSE. Stops the "click does
            // nothing / silent fail" we saw in 5.5.25.
            let canBrowse = false;
            try { canBrowse = !!game.user.can?.("FILES_BROWSE"); }
            catch (e) { canBrowse = game.user.isGM; }
            if (!canBrowse) {
                ui.notifications.warn("Agent OS: BROWSE needs Foundry's FILES_BROWSE permission. Ask your GM to enable it in Configure Permissions, or use IMPORT to pull a portrait from a world Actor instead.");
                return;
            }
            const input = html.find('#new-contact-avatar')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/",
                    callback: (path) => { if (input) input.value = path; }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Agent OS: FilePicker unavailable — paste the path manually, or use IMPORT to pull a portrait from a world Actor.");
                console.error(e);
            }
        });

        // 5.5.24 (CommanderCrunch69 follow-up): player-facing import button.
        // Players can't open Foundry's FilePicker — it's gated by permission
        // flags they don't have — so Browse only ever worked for the GM.
        // IMPORT looks up a world Actor by the name the player typed and
        // pulls that actor's portrait into the avatar field. Works for any
        // actor the player has at least LIMITED permission on. If the GM's
        // NPCs are set to NONE for players the import won't find them; ask
        // the GM to bump default actor permission to LIMITED, or share the
        // path manually.
        html.on('click', '.import-contact-avatar', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const nameInput = html.find('#new-contact-name')[0];
            const avatarInput = html.find('#new-contact-avatar')[0];
            const rawName = (nameInput?.value || "").trim();
            if (!rawName) {
                ui.notifications.warn("Agent: Enter a handle first, then IMPORT to pull a matching world Actor's portrait.");
                return;
            }
            // Strip switchboard '(via Bob)' suffix so "Rogue (via Bob)" still
            // matches a plain "Rogue" actor.
            const cleanName = rawName.replace(/\s*\(via\s+[^)]+\)\s*$/i, "").trim();
            // 5.5.24 follow-up: spoiler-safe scope. Players shouldn't
            // fish for hidden NPC art by typing names — restrict non-GM lookups
            // to actors that have at least LIMITED ownership for the requesting
            // user. GMs see everything (they own it). GM workflow to expose a
            // portrait: open the actor → Permissions → set Default to LIMITED
            // (just the name + image is shared, stats stay hidden). Encounter
            // NPCs and unannounced bosses stay at NONE → invisible to player
            // import → no spoilers.
            const _canSeeForImport = (a) => {
                if (game.user.isGM) return true;
                try { return a.testUserPermission(game.user, "LIMITED"); }
                catch (e) { return false; }
            };
            const matches = (game.actors?.filter?.(a => a.name === cleanName && _canSeeForImport(a))) || [];
            if (matches.length === 0) {
                ui.notifications.warn(`Agent: No portrait found for "${cleanName}". The GM controls which NPCs are visible — ask them to set the actor's Default Permission to LIMITED if they want to share this portrait, or paste an image URL/path manually.`);
                return;
            }
            if (matches.length > 1) {
                ui.notifications.warn(`Agent: Multiple actors named "${cleanName}" — using the first match.`);
            }
            const match = matches[0];
            if (!match.img || match.img === "icons/svg/mystery-man.svg") {
                ui.notifications.warn(`Agent: "${cleanName}" exists but has no portrait set on the actor sheet.`);
                return;
            }
            if (avatarInput) avatarInput.value = match.img;
            if (this._composerDrafts) this._composerDrafts['new-contact-avatar'] = match.img;
            ui.notifications.info(`Agent: Imported portrait for "${cleanName}".`);
        });

        // Patch5.5.20 (Praise Jaheebus): FilePicker hook for the Sys Admin map path
        // input. Users were typing absolute Windows paths (C:/Users/...) which
        // Foundry's <img src> can't resolve — Foundry only serves paths relative
        // to the user-data root. FilePicker returns the right format every time.
        html.on('click', '.pick-map-path', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#admin-map-path-input')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "modules/cyberpunk-red-agent-os-modified/assets/night-city-map-red-final-v2.png",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['admin-map-path-input'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Agent OS: FilePicker unavailable — paste the Foundry-relative path manually (e.g. worlds/MyWorld/maps/file.png).");
                console.error(e);
            }
        });

        // Patch5.5.12: FilePicker hook for the Garden photo field on the modal.
        html.on('click', '.pick-garden-photo', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#garden-modal-photo')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/svg/mystery-man.svg",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['garden-modal-photo'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Agent OS: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        // Patch5.5.12: FilePicker hook for the Ziggurat image field on the modal.
        html.on('click', '.pick-ziggurat-image', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#ziggurat-modal-image')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['ziggurat-modal-image'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Agent OS: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        // Patch5.5.12: FilePicker hook for the NCPD mugshot field on the new modal.
        html.on('click', '.pick-ncpd-mugshot', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#ncpd-modal-mugshot')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/svg/mystery-man.svg",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['ncpd-modal-mugshot'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Agent OS: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        // Patch4.7 follow-up: same FilePicker hook for the custom-item image field.
        html.on('click', '.pick-custom-item-img', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#custom-item-img')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['custom-item-img'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Agent OS: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        html.on('click', '.open-add-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            this.editContactId = null;
            this.editContactName = "";
            this.showAddContact = true;
            this.render(true);
        });

        html.on('click', '.cancel-add-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            this.showAddContact = false;
            this.editContactId = null;
            this.editContactName = "";
            this.render(true);
        });

        html.on('click', '.confirm-add-contact', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const name = (html.find('#new-contact-name').val() || "").trim();
            if (!name) { ui.notifications.warn("Agent: Contact handle required."); return; }

            if (this.editContactId) {
                if (this.editContactId === "party_group_chat") {
                    // Party/Group chat rename — world setting (GM only)
                    if (game.user.isGM) {
                        await game.settings.set("cyberpunk-red-agent-os-modified", "partyGroupChatName", name);
                    } else {
                        ui.notifications.warn("Agent: Only the GM can rename the group channel.");
                    }
                } else {
                    const editAvatar = html.find('#new-contact-avatar').val()?.trim() || "";
                    let mine = game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                    mine = mine.map(c => c.id === this.editContactId ? { ...c, name, avatar: editAvatar || c.avatar || null } : c);
                    await game.user.setFlag("cyberpunk-red-agent-os-modified", "customContacts", mine);
                }
            } else {
                // GM may target specific players when creating the NPC contact.
                // We persist that on the contact itself so future GM-sends route correctly.
                const targets = game.user.isGM
                    ? html.find('.new-contact-target-check:checked').map(function () { return this.value; }).get()
                    : [];
                const avatarPath = html.find('#new-contact-avatar').val()?.trim() || "";
                const newContact = {
                    id: "npc_" + foundry.utils.randomID(),
                    name,
                    originalName: name,
                    isPlayer: false,
                    avatar: avatarPath || null,
                    targetUserIds: targets.slice()
                };
                const self = game.user.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                self.push(newContact);
                await game.user.setFlag("cyberpunk-red-agent-os-modified", "customContacts", self);

                if (game.user.isGM && targets.length > 0) {
                    for (const uid of targets) {
                        const u = game.users.get(uid);
                        if (!u || u.id === game.user.id) continue;
                        const lst = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                        // Patch3: guard against double-push if a previous create-and-undo
                        // left this contact id in the player's flag.
                        if (!lst.some(c => c.id === newContact.id)) {
                            lst.push(newContact);
                            await u.setFlag("cyberpunk-red-agent-os-modified", "customContacts", lst);
                        }
                    }
                    game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "refreshOnlineStatus" });
                }
                // Patch3: ALSO purge this contact from any NON-target users who may
                // have a stale copy from an earlier targeting. Belt-and-suspenders
                // alongside the read-time filter in _getContacts.
                if (game.user.isGM) {
                    const targetSet = new Set(targets);
                    for (const u of game.users) {
                        if (u.id === game.user.id || u.isGM || targetSet.has(u.id)) continue;
                        let lst = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                        const before = lst.length;
                        lst = lst.filter(c => c.id !== newContact.id);
                        if (lst.length !== before) {
                            await u.setFlag("cyberpunk-red-agent-os-modified", "customContacts", lst);
                        }
                    }
                }
            }

            this.showAddContact = false;
            this.editContactId = null;
            this.editContactName = "";
            this.render(true);
        });

        html.on('click', '.edit-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            this.editContactId = $(ev.currentTarget).data('contact-id');
            this.editContactName = $(ev.currentTarget).data('contact-name') || "";
            this.editContactAvatar = $(ev.currentTarget).data('contact-avatar') || "";
            this.showAddContact = true;
            this.render(true);
        });

        html.on('click', '.delete-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const id = $(ev.currentTarget).data('contact-id');
            // Patch4.6: in-phone confirm modal instead of Foundry Dialog.
            this._pendingConfirm = {
                kind: 'delete-contact',
                payload: { contactId: id },
                title: "PURGE ENDPOINT",
                message: "Remove this contact and all associated messages from your CitiNet directory?",
                confirmLabel: "PURGE",
                accent: "red"
            };
            this.render(true);
        });

        html.on('input', '#contact-search-input', (ev) => {
            this.searchQuery = ev.currentTarget.value || "";
            const q = this.searchQuery.toLowerCase();
            html.find('.contact-card').each(function () {
                const name = ($(this).find('[data-search-name]').text() || $(this).text() || "").toLowerCase();
                $(this).toggle(!q || name.includes(q));
            });
        });

        html.on('click', '.toggle-online-status', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const cur = game.user.getFlag("cyberpunk-red-agent-os-modified", "hideOnlineStatus") || false;
            await game.user.setFlag("cyberpunk-red-agent-os-modified", "hideOnlineStatus", !cur);
            game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "refreshOnlineStatus" });
            this.render(true);
        });

        html.on('click', '.toggle-npc-status', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (!game.user.isGM) return;
            const cid = $(ev.currentTarget).data('contact-id');
            const gm = game.users.find(u => u.isGM);
            if (!gm) return;
            const statuses = gm.getFlag("cyberpunk-red-agent-os-modified", "npcStatuses") || {};
            statuses[cid] = (statuses[cid] === false);
            await gm.setFlag("cyberpunk-red-agent-os-modified", "npcStatuses", statuses);
            game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "refreshOnlineStatus" });
            this.render(true);
        });

        // Patch4: #admin-target-selector dropdown was removed in favour of the
        // per-player tab strip; the click handler for that lives in the main
        // data-action switch as 'admin-tab-select'. Old handler deleted here.

        // Boot timer
        // Patch3 round 2: holophone animation is now wired through _render's
        // closed→open transition (see _render), so we no longer fire it here.
        if (this.currentView === 'boot' && !this.bootTimer) {
            this.bootTimer = setTimeout(() => {
                this.currentView = 'home'; this.bootTimer = null; this.render(true);
            }, 1800);
        }

        // Scroll containers (delegated, no leak — element-local listeners die with re-render)
        this._setupScrollDrag(html.find('.chat-window'));
        this._setupScrollDrag(html.find('.contact-list'));
        this._setupScrollDrag(html.find('.transaction-list'));

        // Sticky-to-bottom auto-scroll.
        // Patch2: wrap in rAF so the scroll runs AFTER the browser has laid out
        // the new bubbles. Doing it synchronously here used to read scrollHeight
        // before tall bubbles had measured, leaving the last message visually
        // cropped behind the input area.
        let chatWindow = html.find('.chat-window');
        if (chatWindow.length && (this._forceScrollOnNextRender || this._chatNearBottom !== false)) {
            const el = chatWindow[0];
            const doScroll = () => { el.scrollTop = el.scrollHeight; };
            requestAnimationFrame(() => { doScroll(); requestAnimationFrame(doScroll); });
            this._forceScrollOnNextRender = false;
        }

        // Restore textarea draft + focus
        const taEl = html.find('#agent-chat-input')[0];
        if (taEl) {
            if (this._chatInputDraft) taEl.value = this._chatInputDraft;
            this._autoGrowInput(taEl);
            const freshOpen = (this.currentView === 'chat-thread' && !this._chatInputHadFocus && !this._chatInputDraft);
            if (this._chatInputHadFocus || freshOpen) {
                taEl.focus();
                const len = taEl.value.length;
                try { taEl.setSelectionRange(len, len); } catch (e) {}
            }
        }

        // Restore generic composer drafts (Social post, etc.). Anything tagged
        // [data-preserve-draft] with an id gets its value put back, and focus
        // restored if it was active before the render.
        html.find('[data-preserve-draft]').each((_, el) => {
            if (!el.id) return;
            const draft = this._composerDrafts[el.id];
            if (draft !== undefined && draft !== "") el.value = draft;
            if (this._composerFocusId === el.id) {
                try { el.focus(); } catch (e) {}
                if (typeof el.value === 'string' && typeof el.setSelectionRange === 'function') {
                    const len = el.value.length;
                    try { el.setSelectionRange(len, len); } catch (e) {}
                }
            }
        });

        // --- HANDSET MOBILITY ---
        // Custom drag implementation. V12's global Draggable wasn't reliably
        // driving the V1 window for this app, so we own the lifecycle directly.
        this._setupWindowDrag(html);

        this._setupMapPanning(html);

        // Modified build (П9): drop an Actor/Token onto the phone to add it to
        // NCPD DB / ZIGGURAT / THE GARDEN. (П4): drop image/audio files onto the
        // chat to attach them.
        this._setupAgentDrop(html);

        // Modified build: keep the status-bar clock ticking in real time without
        // re-rendering the whole phone.
        this._startClockTicker();
    }

    /**
     * Modified build: live status-bar clock. When the phone is showing real-world
     * time (no in-game / Simple Calendar clock active), update the `.agent-clock`
     * text every 15s in place. In-game time is driven by the GM's clock-update
     * sockets / Simple Calendar hooks, so we don't auto-tick it here.
     */
    _startClockTicker() {
        clearInterval(this._clockTimer);
        const tick = () => {
            if (!this.rendered || !this.element) return;
            // Only auto-update when the displayed time is real-world (not in-game).
            if (this._isIngameClock) return;
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            try { this.element.find('.agent-clock').text(now); } catch (e) {}
        };
        // Align so the minute flips reasonably promptly, then run every 15s.
        tick();
        this._clockTimer = setInterval(tick, 15000);
    }

    /**
     * Lifecycle: clean up all global listeners and timers when the app closes.
     * Prevents leaking $(window) handlers, typing timers, and boot timers across opens.
     */
    async close(options = {}) {
        // Stop any in-flight typing emission
        this._emitTypingStop?.();
        clearTimeout(this._typingStopTimer);
        clearTimeout(this._typingExpireTimer);
        clearTimeout(this.bootTimer);
        clearTimeout(this._storeSearchDebounce);
        // Modified build: stop the live clock ticker.
        clearInterval(this._clockTimer);
        this._clockTimer = null;
        this._storeSearchDebounce = null;
        this.bootTimer = null;
        // Patch3 (Ryouhi): tear down call animation if it was running.
        // _wasOpen reset here so the next open re-triggers the start hook in _render.
        this._wasOpen = false;
        try { await this._stopHolophoneCallAnim?.(); } catch (e) {}

        // Detach window-level map panning listeners (namespaced)
        $(window).off('.agentMap');
        if (this._onWindowMouseMove) window.removeEventListener('mousemove', this._onWindowMouseMove);
        if (this._onWindowMouseUp)   window.removeEventListener('mouseup',   this._onWindowMouseUp);
        this._onWindowMouseMove = null;
        this._onWindowMouseUp = null;
        this._windowEventsBound = false;

        // Window-drag listeners
        if (this._onWindowDragMove) window.removeEventListener('mousemove', this._onWindowDragMove);
        if (this._onWindowDragUp)   window.removeEventListener('mouseup',   this._onWindowDragUp);
        this._onWindowDragMove = null;
        this._onWindowDragUp = null;

        // Modified build (П4): detach the clipboard-paste listener.
        if (this._onAgentPaste) document.removeEventListener('paste', this._onAgentPaste);
        this._onAgentPaste = null;
        this._dragState = { isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 };
        this._panState = { isPanning: false, startX: 0, startY: 0 };

        // Reset transient UI flags so re-opens start clean
        this.currentView = "boot";
        this.activeContactId = null;
        this.activeShardId = null;
        this.showPayoutModal = false;
        this.showLedgerModal = false;
        this.showShardModal = false;
        this.showEmojiPicker = false;
        this.showAddContact = false;
        // Modified build (П4): reset personal-contacts modal state on close.
        this.showContactModal = false;
        this._contactEditId = null;
        this._contactsOpenFolder = null;
        // Modified build: drop any staged-but-unsent attachment on close.
        this._stagedAttachment = null;
        this.showIdEditModal = false;
        this.showPayAllModal = false;
        this.showNpcBidModal = false;
        this._pendingNpcBid = null;
        this._pendingConfirm = null;
        // Patch4.7 cleanup so re-opens start fresh.
        this._repEditingId = null;
        this._socialFilter = "all";
        this._storePriceTier = "all";
        // Patch4.8 cleanup
        this.showNewGroup = false;
        this._emojiCategory = "react";
        this.showAttachPicker = false;
        this._attachKind = "photo";
        // Patch4.8.3 cleanup — GM per-thread voice map.
        this._gmSpeakingAsInThread = {};
        this._chatInputDraft = "";
        this._chatInputHadFocus = false;
        this._composerDrafts = {};
        this._composerFocusId = null;

        return super.close(options);
    }

    /**
     * Patch3 (Ryouhi request): optional Sequencer/JB2A/Tagger calling animation.
     * Direct port of EskieMoh's holophone macro — all five effect layers
     * (phone icon, red ring, "CALL" label, two eye-glints) plus the random
     * symbol scroll loop. Toggled by the GM via the `enableCallAnimation`
     * world setting. Silently no-ops if the setting is off or any of the
     * three supporting modules isn't present.
     */
    _holophoneEnabled() {
        try {
            if (!game.settings.get("cyberpunk-red-agent-os-modified", "enableCallAnimation")) return false;
        } catch (e) { return false; }
        // Patch4 round 5: Tagger is no longer required (we use a local Set
        // for animation state instead of writing token flags). Only Sequencer
        // is needed for the actual VFX playback.
        return !!(globalThis.Sequencer && typeof globalThis.Sequence === "function");
    }

    _holophoneToken() {
        // Resolution order: currently-controlled token → assigned-character's
        // token on the active scene → single owned token on the active scene.
        // Patch3 round 2: players rarely have their token selected when they
        // pop open the phone, so we fall back to assigned-character lookup.
        const c = canvas?.tokens?.controlled?.[0];
        if (c) return c;
        const charId = game.user?.character?.id;
        if (charId && canvas?.tokens?.placeables) {
            const byChar = canvas.tokens.placeables.find(t => t.actor?.id === charId);
            if (byChar) return byChar;
        }
        const owned = canvas?.tokens?.placeables?.filter(t => t.actor?.isOwner) || [];
        return owned.length === 1 ? owned[0] : null;
    }

    async _playHolophoneCallAnim() {
        // Patch3.2 round 2 (sync fix): instead of running the animation locally
        // and relying on Sequencer's auto-broadcast (which fails when the
        // originator and other clients have different JB2A versions installed,
        // and throttles under our rapid-fire text loop), we emit a socket event
        // and EVERY client (including this one) runs its own local copy. Each
        // client probes its own asset availability and renders accordingly.
        if (!this._holophoneEnabled()) return;
        const tok = this._holophoneToken();
        if (!tok) {
            console.log("[Agent OS] Holophone animation: no token to attach to (select your token or assign a character).");
            return;
        }
        // Remember the token so close() knows which one to clean up.
        this._callAnimTokenId = tok.id;
        this._callAnimActive = true;
        // Tell every client (including us) to start their own local animation.
        try {
            game.socket.emit("module.cyberpunk-red-agent-os-modified", {
                action: "holophoneStart",
                tokenId: tok.id,
                sceneId: canvas?.scene?.id || null
            });
        } catch (e) { console.warn("[Agent OS] holophoneStart emit failed:", e); }
        // And kick it off locally right now (socket.emit doesn't loop back to sender).
        try { await this._runHolophoneCallAnimLocal(tok.id); } catch (e) { console.warn("[Agent OS] local holophone start failed:", e); }
    }

    /**
     * Actual VFX runner — called locally on every connected client via socket.
     * Uses the local Sequencer/JB2A install for asset probing, so each client
     * renders with whatever they have available (no cross-client asset drift).
     */
    async _runHolophoneCallAnimLocal(tokenId) {
        if (!this._holophoneEnabled()) return;
        const tok = canvas?.tokens?.get?.(tokenId);
        if (!tok) {
            // Token not on this client's canvas — silent skip. This is normal
            // for clients viewing a different scene than the originator.
            return;
        }
        try {
            // Patch4 round 5 (Gotto Goho's spam bug): we used to call
            //   Tagger.addTags(tok, "AgentCalling")
            // on every client to mark "this token is currently calling". Tagger
            // persists the tag as a token flag, which means every NON-OWNER
            // client that received the holophoneStart socket message was trying
            // to update someone else's token — Foundry blocked the write and
            // spammed "User X lacks permission to update Token Y" toasts on
            // every client when any phone opened.
            // Fix: track per-client animation state in a local Map keyed by
            // token id. No more flag writes, no more permission spam.
            globalThis.__AgentDeviceCalling = globalThis.__AgentDeviceCalling || new Set();
            if (globalThis.__AgentDeviceCalling.has(tok.id)) return; // already running locally
            globalThis.__AgentDeviceCalling.add(tok.id);

            const style = {
                fill: "white", fontFamily: "Impact", fontSize: 10,
                dropShadow: true, dropShadowAlpha: 0.5, dropShadowBlur: 5, dropShadowDistance: 3
            };
            const textstyle = {
                fill: "#00FCD0", fontFamily: "Impact", fontSize: 6,
                dropShadow: true, dropShadowAlpha: 0.5, dropShadowBlur: 5, dropShadowDistance: 3
            };

            // Patch3.2 (Ryouhi error report): the user hit
            //   "Sequencer | Effect | Play - Could not find file: jb2a.token_stage.round.red.01.05"
            // because that specific token_stage variant ships with JB2A Patreon, not the
            // Free pack. Check each entry against Sequencer.Database before adding it;
            // pick a fallback ring asset that exists in JB2A Free if the Patreon one is
            // missing, so the animation degrades gracefully instead of erroring out.
            const _hasFile = (p) => {
                try { return !!globalThis.Sequencer?.Database?.entryExists?.(p); }
                catch (e) { return true; } // older Sequencer — assume yes, let Sequencer surface its own error
            };
            const _firstAvailable = (...candidates) => candidates.find(_hasFile) || null;

            // Ring asset: prefer the Patreon round.red, fall back through Free options.
            const ringFile = _firstAvailable(
                "jb2a.token_stage.round.red.01.05",
                "jb2a.token_border_circle.static.red.011",
                "jb2a.markers.circle_of_stars.red",
                "jb2a.energy_field.02.below.red"
            );
            // Eye-glint asset
            const glintFile = _firstAvailable(
                "jb2a.twinkling_stars.points04.orange",
                "jb2a.twinkling_stars.points02.orange",
                "jb2a.twinkling_stars.points06.orange"
            );

            // Build the sequence conditionally so a missing optional layer doesn't
            // throw "Could not find file:" toasts.
            // Patch3.2 round 2: every effect is `.locally(true)` because we're
            // running this sequence on EVERY client via socket — if Sequencer
            // also auto-broadcast it we'd get N×N effect spam across the network.
            const seq = new globalThis.Sequence();

            // Layer 1 — phone icon (imgur, always available unless network blocked)
            seq.effect()
                .file("https://i.imgur.com/Vif3lSd.png")
                .name("AgentCall")
                .atLocation(tok)
                .locally(true)
                .scaleIn({ x: 0.75, y: 0 }, 50)
                .scaleOut({ x: 0.75, y: 0 }, 50)
                .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: -0.18, y: 0.18 }, gridUnits: true, bindRotation: false })
                .size(0.47, { gridUnits: true })
                .aboveLighting()
                .persist()
                .zIndex(0);

            // Layer 2 — red ring (JB2A, may be Patreon-only — try fallbacks)
            if (ringFile) {
                seq.effect()
                    .file(ringFile)
                    .name("AgentCall")
                    .atLocation(tok)
                    .locally(true)
                    .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: -0.2, y: 0.2 }, gridUnits: true, bindRotation: false })
                    .size(0.5, { gridUnits: true })
                    .aboveLighting()
                    .persist()
                    .zIndex(1);
            } else {
                console.log("[Agent OS] Holophone: no compatible JB2A ring asset found — skipping ring layer.");
            }

            // Layer 3 — "CALL" text label (always works, Sequencer renders text natively)
            seq.effect()
                .text("CALL", style)
                .name("AgentCall")
                .atLocation(tok)
                .locally(true)
                .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: 0.057, y: -0.025 }, gridUnits: true, bindRotation: false })
                .size(0.015, { gridUnits: true })
                .aboveLighting()
                .persist()
                .zIndex(2);

            // Layers 4 & 5 — eye glints (JB2A)
            if (glintFile) {
                seq.effect()
                    .file(glintFile)
                    .name("AgentCall")
                    .atLocation(tok, { offset: { x: -0.2, y: -0.16 }, gridUnits: true, local: true })
                    .locally(true)
                    .size({ width: 0.4, height: 0.1 }, { gridUnits: true })
                    .aboveLighting()
                    .persist()
                    .zIndex(0)
                    .filter("ColorMatrix", { hue: 25 })
                    .filter("Blur", { blurX: 30, blurY: 0 })
                    .playbackRate(5)
                    .attachTo(tok);
                seq.effect()
                    .file(glintFile)
                    .name("AgentCall")
                    .atLocation(tok, { offset: { x: 0.12, y: -0.225 }, gridUnits: true, local: true })
                    .locally(true)
                    .size({ width: 0.4, height: 0.1 }, { gridUnits: true })
                    .aboveLighting()
                    .persist()
                    .zIndex(0)
                    .filter("ColorMatrix", { hue: 25 })
                    .filter("Blur", { blurX: 30, blurY: 0 })
                    .playbackRate(5)
                    .attachTo(tok);
            } else {
                console.log("[Agent OS] Holophone: no compatible JB2A twinkling_stars asset found — skipping eye-glints.");
            }

            await seq.play();

            await globalThis.Sequencer.Helpers.wait(750);

            // Symbol-scroll loop — keep firing CallText effects while the tag
            // is present. Tag removal (in _stopHolophoneCallAnim) exits the loop.
            const symbols = ['⍰','⍱','⍲','⍽','⍾','⍿','░','▒','▓','≡','║','⎀','⎃','⎅','⎆','⎉','⌷','⌸','⌹','⌻','⌼','⌽','☰','☱','☲','☳','☴','☵','☶','☷','⣹','⣺','⣻','⣼','⣽','⣾','⣿'];
            let i = 1, e = 1, safety = 0;
            this._callAnimToken = tok;
            // Patch3.2 round 2: the original macro fires ~100 effects/sec which
            // overwhelms Sequencer's socket when broadcast. Now that every client
            // runs its own local loop (we explicitly .locally(true) below) the
            // network isn't the bottleneck — but the visual cascade is the same
            // at ~5 chars/sec, so we slow the loop to 200ms.
            const LOOP_INTERVAL_MS = 200;
            // Safety cap: ~30 min worth of iterations at this rate.
            const MAX_ITER = (30 * 60 * 1000) / LOOP_INTERVAL_MS;
            while (globalThis.__AgentDeviceCalling?.has(tok.id) && safety++ < MAX_ITER) {
                if (i === 12 || i === 24) e = 1;
                if (i > 36) {
                    i = 1; e = 1;
                    await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
                }
                const word = globalThis.Sequencer.Helpers.random_array_element(symbols, false);
                await new globalThis.Sequence()
                    .wait(LOOP_INTERVAL_MS)
                    .effect()
                        .text(`${word}`, textstyle)
                        .name("AgentCallText")
                        .atLocation(tok)
                        .locally(true)
                        .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: 0.3 + (e * 0.075), y: -0.21 + (Math.floor(i / 12) * 0.13) }, gridUnits: true, bindRotation: false })
                        .size(0.015, { gridUnits: true })
                        .aboveLighting()
                        .duration(10000)
                        .zIndex(2)
                    .play();
                i++;
                e++;
            }
            // Modified build: the loop has exited (stop signal, scene change or
            // safety cap). The most recent effect it created still has a 10s
            // lifetime, so tear down BOTH effect layers here too — this is what
            // prevents a symbol from being left stuck next to the token when the
            // call is interrupted (e.g. the phone closing mid-loop). A short wait
            // lets the very last in-flight `.play()` register before we sweep.
            globalThis.__AgentDeviceCalling?.delete?.(tok.id);
            try { await globalThis.Sequencer.Helpers.wait(260); } catch (_) {}
            try {
                await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCall", object: tok });
                await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
            } catch (_) {}
        } catch (err) {
            console.warn("[Agent OS] Holophone animation failed:", err);
            // Defensive cleanup so we don't leave anything stuck on the token.
            try { globalThis.__AgentDeviceCalling?.delete?.(tok.id); } catch (_) {}
            try {
                await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCall", object: tok });
                await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
            } catch (_) {}
            this._callAnimActive = false;
        }
    }

    async _stopHolophoneCallAnim() {
        // Patch3.2 round 2: broadcast stop to every client (like start).
        let tokenId = this._callAnimTokenId || this._callAnimToken?.id;
        this._callAnimActive = false;

        // Modified build: if we somehow lost the tracked token id (e.g. the
        // instance state was reset while a call was still visible), fall back to
        // every token we know is currently calling on this client so nothing is
        // left stuck. This is the set _runHolophoneCallAnimLocal populated.
        const tracked = [];
        if (tokenId) tracked.push(tokenId);
        try {
            const set = globalThis.__AgentDeviceCalling;
            if (set && set.size) for (const id of set) if (!tracked.includes(id)) tracked.push(id);
        } catch (e) {}

        for (const id of (tracked.length ? tracked : [tokenId])) {
            try {
                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "holophoneStop", tokenId: id });
            } catch (e) { console.warn("[Agent OS] holophoneStop emit failed:", e); }
            // Local cleanup ourselves (emit doesn't loop back to the sender).
            try { await this._runHolophoneCallAnimStopLocal(id); } catch (e) {}
        }
        this._callAnimToken = null;
        this._callAnimTokenId = null;
    }

    async _runHolophoneCallAnimStopLocal(tokenId) {
        // Modified build: bullet-proof teardown. The symbol-scroll loop in
        // _runHolophoneCallAnimLocal is `await`-ing a Sequence when the stop
        // arrives, so the very last AgentCallText effect can be created AFTER a
        // single endEffects() pass — leaving one symbol stuck next to the token.
        // To kill it reliably we:
        //   1. flip the local Set bit so the loop exits at its next check,
        //   2. run endEffects by name (object-scoped when we have the token,
        //      otherwise a global name sweep),
        //   3. wait a beat (longer than one loop interval) and sweep AGAIN to
        //      catch the in-flight effect that landed after the first pass.
        if (!globalThis.Sequencer) {
            if (tokenId) globalThis.__AgentDeviceCalling?.delete?.(tokenId);
            return;
        }
        // Stop the loop immediately on this client.
        if (tokenId) globalThis.__AgentDeviceCalling?.delete?.(tokenId);

        const tok = tokenId ? canvas?.tokens?.get?.(tokenId) : null;
        const EM = globalThis.Sequencer.EffectManager;

        // Are any OTHER tokens still mid-call on this client? If so, we must NOT
        // do a blanket name sweep (it would kill their effects too) — stick to
        // the token-scoped teardown. Only when this is the last/only call do we
        // allow the broad name sweep that guarantees no straggler survives.
        const othersCalling = (() => {
            try {
                const set = globalThis.__AgentDeviceCalling;
                if (!set || set.size === 0) return false;
                // tokenId was already removed above; any remaining ids are others.
                return set.size > 0;
            } catch (e) { return false; }
        })();

        const sweep = async () => {
            try {
                if (tok) {
                    await EM.endEffects({ name: "AgentCall", object: tok });
                    await EM.endEffects({ name: "AgentCallText", object: tok });
                }
                // Broad name sweep — only safe when no other token is still
                // calling on this client. Catches the straggler effect whose
                // object binding is stale or whose token isn't resolvable.
                if (!othersCalling) {
                    await EM.endEffects({ name: "AgentCall" });
                    await EM.endEffects({ name: "AgentCallText" });
                }
            } catch (e) {
                console.warn("[Agent OS] Holophone cleanup sweep failed:", e);
            }
        };

        // First sweep now.
        await sweep();
        // Second sweep after the loop's interval (200ms) + margin, to remove the
        // straggler effect that may have been created just after the first sweep.
        try { await globalThis.Sequencer.Helpers.wait(320); } catch (e) {}
        await sweep();
    }

    /* ---------- Realistic-texting helpers ---------- */

    async _render(force, options) {
        if (this.element && this.element.length) {
            const cw = this.element.find('.chat-window');
            if (cw.length) {
                const el = cw[0];
                const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                this._chatNearBottom = dist < 80;
            }
            const ta = this.element.find('#agent-chat-input');
            if (ta.length) {
                this._chatInputDraft = ta.val() || "";
                // Patch5.0.2 (Ryouhi/Pop Out!): read activeElement from the
                // element's owning document so popped-out windows work.
                this._chatInputHadFocus = (ta[0].ownerDocument?.activeElement === ta[0]);
            }
            // Capture generic composer drafts (Social post, future inline composers).
            // Any input/textarea/select tagged with [data-preserve-draft] is preserved
            // across renders so cross-client re-renders don't wipe in-progress text.
            // Patch3: if the user navigated to a different view (or sub-view like
            // a different auction), drop the previous view's drafts so old values
            // don't leak into freshly-rendered inputs that share an id.
            const _viewKey = `${this.currentView}|${this.activeContactId || ''}|${this._auctionDetailId || ''}`;
            if (this._composerDraftsView !== _viewKey) {
                this._composerDrafts = {};
                this._composerDraftsView = _viewKey;
                // Patch3.3: scroll positions are scoped to a view too, so a
                // stale position from Sys Admin doesn't get applied to Fixers etc.
                this._scrollPositions = {};
            }
            this._composerFocusId = null;
            // Patch5.0.2 (Ryouhi/Pop Out!): pull activeElement from the agent's
            // owning document so the popped-out window's focused element is
            // detected correctly. `this.element[0]?.ownerDocument` is the
            // popout window's document when popped out, the main page's
            // document otherwise.
            const active = this.element[0]?.ownerDocument?.activeElement || null;
            this.element.find('[data-preserve-draft]').each((_, el) => {
                if (!el.id) return;
                this._composerDrafts[el.id] = (typeof el.value === 'string') ? el.value : '';
                if (active === el) this._composerFocusId = el.id;
            });

            // Patch3.3: capture scroll positions of long scroll containers so
            // toggling items in Sys Admin (or other render(true) triggers) doesn't
            // jump back to the top. Keyed by class for stability across re-renders.
            this._scrollPositions = this._scrollPositions || {};
            const _scrollSelectors = ['.admin-console', '.rep-view', '.style-view', '.contact-list', '.feed-list', '.transaction-list'];
            for (const sel of _scrollSelectors) {
                const el = this.element.find(sel)[0];
                if (el && el.scrollTop > 0) this._scrollPositions[sel] = el.scrollTop;
            }
            // Patch5.5.7: self-discovering scroll preservation. Any element with
            // `data-preserve-scroll-container="<key>"` has its scrollTop captured
            // before render and restored after. Lets new app views opt in by
            // adding the attribute, no JS array maintenance. Used by the 5.5
            // app views (NCPD / Ziggurat / Garden) so category clicks and list
            // scrolling don't snap back to the top.
            this.element.find('[data-preserve-scroll-container]').each((_, el) => {
                const key = el.getAttribute('data-preserve-scroll-container');
                if (key && el.scrollTop > 0) {
                    this._scrollPositions[`[data-preserve-scroll-container="${key}"]`] = el.scrollTop;
                }
            });
        }
        // Modified build (П1): the holophone "call" effect on the token no longer
        // fires on every phone open. It is now tied to the MESSENGER (chat) view
        // only — triggered when the user opens Messages (see the 'chat' app-icon
        // handler) and stopped when they leave it. This block only handles the
        // first-open device-mode sizing now.
        const _prevOpen = this._wasOpen;
        const _ret = await super._render(force, options);
        if (this.rendered && !_prevOpen) {
            this._wasOpen = true;
            // Apply the saved device mode size when the phone first opens.
            try {
                const mode = game.user.getFlag("cyberpunk-red-agent-os-modified", "agentMode") || 'phone';
                this._applyDeviceModeSize(mode);
            } catch (e) { /* non-fatal */ }
        }
        return _ret;
    }

    /**
     * Modified build (П11): resize the Foundry window to fit the current device
     * mode. Phone is the original 380×680 footprint; tablet is wider/taller to
     * accommodate the larger fonts and roomier tablet layout. The chassis CSS
     * (`.mode-tablet`) drives the visual size; here we only keep the OS window
     * big enough to contain it.
     */
    _applyDeviceModeSize(mode) {
        const isTablet = (mode === 'tablet');
        // Window is sized to the chassis plus the 26px glow gutter on each side
        // (added to .window-content) so the soft halo isn't clipped.
        const w = isTablet ? 740 : 440;
        const h = isTablet ? 860 : 720;
        try { this.setPosition({ width: w, height: h }); } catch (e) { /* ignore */ }
    }

    _autoGrowInput(el) {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    _emitTyping() {
        if (!this.activeContactId) return;
        // Patch5.0.1 (Gotto): typing indicator was always sending the GM's
        // name and token even when speaking as an NPC — recipients saw
        // "Gamemaster is writing" + the generic GM avatar. Mirror the same
        // persona resolution the message-send path uses so the indicator
        // matches what the message will actually look like.
        let fromName = game.user.name;
        let fromAvatar = "";
        if (game.user.isGM) {
            const contacts = this._getContacts();
            const threadContact = contacts.find(c => c.id === this.activeContactId);
            const isNpcThread = this.activeContactId?.startsWith("npc_");
            if (isNpcThread && threadContact) {
                fromName = threadContact.originalName || threadContact.name;
                fromAvatar = threadContact.avatar || "";
            } else if (threadContact?.isCustomGroup && this._gmSpeakingAsInThread) {
                const cur = this._gmSpeakingAsInThread[this.activeContactId];
                if (cur && cur !== "gm") {
                    // Lookup the NPC contact across all user lists.
                    for (const u of game.users) {
                        const lst = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                        const match = lst.find(c => c.id === cur);
                        if (match) {
                            fromName = match.originalName || match.name;
                            fromAvatar = match.avatar || "";
                            break;
                        }
                    }
                }
            }
        }
        if (!this._typingEmitting) {
            this._typingEmitting = true;
            game.socket.emit("module.cyberpunk-red-agent-os-modified", {
                action: "agentTyping",
                threadId: this.activeContactId,
                fromUserId: game.user.id,
                fromName,
                fromAvatar
            });
        }
        clearTimeout(this._typingStopTimer);
        this._typingStopTimer = setTimeout(() => this._emitTypingStop(), 2500);
    }

    _emitTypingStop() {
        clearTimeout(this._typingStopTimer);
        if (!this._typingEmitting) return;
        this._typingEmitting = false;
        game.socket.emit("module.cyberpunk-red-agent-os-modified", {
            action: "agentTypingStop",
            threadId: this.activeContactId,
            fromUserId: game.user.id
        });
    }

    _handleTypingEvent(data, isStop) {
        if (!data || data.fromUserId === game.user.id) return;
        if (isStop) {
            delete this.typingPeers[data.fromUserId];
        } else {
            const user = game.users.get(data.fromUserId);
            // Patch5.0.1: prefer the persona name+avatar the sender computed
            // (NPC voice or NPC-thread override). Falls back to the sender's
            // user profile if no override was carried on the event.
            const displayName = data.fromName || user?.name || "Someone";
            const displayAvatar = data.fromAvatar
                || user?.character?.img
                || user?.avatar
                || "icons/svg/mystery-man.svg";
            this.typingPeers[data.fromUserId] = {
                userId: data.fromUserId,
                threadId: data.threadId,
                name: displayName,
                avatar: displayAvatar,
                expiresAt: Date.now() + 3500
            };
            clearTimeout(this._typingExpireTimer);
            this._typingExpireTimer = setTimeout(() => {
                this._cleanupTypingPeers();
            }, 3600);
        }
        if (this.rendered && this.currentView === 'chat-thread') this.render(false);
    }

    _cleanupTypingPeers() {
        const now = Date.now();
        let changed = false;
        for (const k of Object.keys(this.typingPeers)) {
            if (this.typingPeers[k].expiresAt <= now) { delete this.typingPeers[k]; changed = true; }
        }
        if (changed && this.rendered && this.currentView === 'chat-thread') this.render(false);
    }

    _currentTypingPeer() {
        const now = Date.now();
        for (const k of Object.keys(this.typingPeers)) {
            const p = this.typingPeers[k];
            if (p.expiresAt <= now) continue;
            if (this.activeContactId === p.userId || this.activeContactId === p.threadId) return p;
        }
        return null;
    }

    /**
     * Scroll-by-drag for internal lists. Listeners are bound on the element
     * (not window), so they die naturally when the element is re-rendered.
     */
    _setupScrollDrag(el) {
        if (!el.length) return;
        const target = el[0];
        let isDown = false, startY, scrollTop;
        // Patch4 round 6 (kieraboom bug): jQuery handlers were bound with
        // `.on(...)` only, never `.off(...)`. On most renders this didn't
        // matter because the DOM element was fresh, but if Foundry happened
        // to re-use the same node across a partial render (or if a stray
        // re-render fired during an existing pan) the handlers stacked.
        // After enough stacks, the cumulative `mousemove` handlers chewed
        // input and made the device feel like it was "clicking on its own"
        // and stealing focus from fields. Namespace + off-before-on defeats
        // that completely.
        el.off('.agentScrollDrag');
        el.on('mousedown.agentScrollDrag', (e) => { isDown = true; startY = e.pageY - target.offsetTop; scrollTop = target.scrollTop; });
        el.on('mouseleave.agentScrollDrag', () => isDown = false);
        el.on('mouseup.agentScrollDrag', () => isDown = false);
        el.on('mousemove.agentScrollDrag', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const y = e.pageY - target.offsetTop;
            const walk = (y - startY) * 2;
            target.scrollTop = scrollTop - walk;
        });
    }

    /**
     * Map panning: bind window mousemove/mouseup ONCE per app instance.
     * Cleaned up in close(). Prevents the stacked-listener bug on re-render.
     */
    _setupMapPanning(html) {
        const viewport = html.find('.map-viewport');
        const container = html.find('.map-container');
        if (!viewport.length || !container.length) return;

        // ----- Element-scoped listeners (rebind each render is fine; they die with the element) -----

        viewport.off('mousedown.agentMap').on('mousedown.agentMap', (e) => {
            // Don't start a pan if the user is clicking the zoom buttons
            if ($(e.target).closest('.map-controls').length) return;
            // Patch5.5.14: in pin-placement mode, skip pan entirely — the cursor
            // should stay crosshair and clicks go straight to the pin handler.
            if (this._mapPinMode) return;
            e.preventDefault();
            this._panState.isPanning = true;
            this._panState.moved = false;
            this._panState.startX = e.pageX - (this.mapX || 0);
            this._panState.startY = e.pageY - (this.mapY || 0);
            container.css('cursor', 'grabbing');
        });

        viewport.off('wheel.agentMap').on('wheel.agentMap', (e) => {
            const native = e.originalEvent || e;
            // Only intercept when the map view is visible
            if (this.currentView !== 'map') return;
            native.preventDefault?.();
            e.preventDefault();
            const delta = native.deltaY ?? 0;
            const factor = delta < 0 ? 1.1 : 1 / 1.1;
            this.mapZoom = Math.min(Math.max((this.mapZoom || 1) * factor, 0.4), 4);
            container.css('transform',
                `translate(-50%, -50%) translate(${this.mapX}px, ${this.mapY}px) scale(${this.mapZoom})`);
        });

        // Patch5.5.20: pure-JS hover control for pin labels. CSS-only kept failing
        // (specificity / Foundry cache / something), so this owns the inline opacity
        // directly. On bind: read data-label-mode, hide labels of hover-only pins.
        // On mouseenter: show the label. On mouseleave: hide it. No CSS dependency.
        const mapPins = html.find('.agent-map-pin');
        mapPins.each(function() {
            const mode = this.dataset.labelMode || 'always';
            const label = this.querySelector('.pin-label');
            if (!label) return;
            if (mode === 'hover') {
                label.style.opacity = '0';
            } else {
                label.style.opacity = '1';
            }
        });
        mapPins.off('mouseenter.agentPinHover mouseleave.agentPinHover')
            .on('mouseenter.agentPinHover', function() {
                if ((this.dataset.labelMode || 'always') !== 'hover') return;
                const lbl = this.querySelector('.pin-label');
                if (lbl) lbl.style.opacity = '1';
            })
            .on('mouseleave.agentPinHover', function() {
                if ((this.dataset.labelMode || 'always') !== 'hover') return;
                const lbl = this.querySelector('.pin-label');
                if (lbl) lbl.style.opacity = '0';
            });

        // Patch5.5.3: click-to-place pin handler. Only active when the GM has
        // pin mode on. The user did the math complaint ("GMs don't know x and y")
        // — now the GM just clicks where the pin should go and a modal opens
        // with the click position pre-filled. Coordinates are stored as %
        // of the map image so they survive zoom + pan + map-image swaps.
        // Patch5.5.17: bind click on .map-container instead of .agent-map-img.
        // The img element has pointer-events:none baked into its style (so the
        // browser's default drag-an-image behavior doesn't interfere with pan
        // gestures). Only the container catches clicks. The img's bounding rect
        // is still resolvable for coord math even when pointer-events is none —
        // getBoundingClientRect works regardless. We resolve the img inside the
        // handler instead of relying on e.currentTarget being the img.
        const mapContainer = html.find('.map-container');
        mapContainer.off('click.agentPin').on('click.agentPin', (e) => {
            if (!game.user.isGM) return;
            if (!this._mapPinMode) return;
            if (this._panState?.isPanning) return;
            // Audit catch (5.5.4): browsers fire `click` on mouseup, and mouseup
            // resets isPanning to false before click runs. Without this guard,
            // a drag-pan would pop a phantom pin modal at the release point.
            if (this._panState?.moved) { this._panState.moved = false; return; }
            // Don't fire on clicks that bubble up from the zoom buttons / pin
            // controls / placed pins. Only the bare map should drop a pin.
            if ($(e.target).closest('.map-controls, .agent-map-pin').length) return;
            const img = mapContainer.find('.agent-map-img')[0];
            if (!img) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = img.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            // If the click landed outside the image (in the viewport padding),
            // skip — don't drop a pin off the map.
            if (x < 0 || x > 100 || y < 0 || y > 100) return;
            this._pendingPinX = Math.max(0, Math.min(100, x));
            this._pendingPinY = Math.max(0, Math.min(100, y));
            this.showMapPinModal = true;
            this.render(true);
        });

        // ----- Window-level listeners (bind ONCE per instance, detach in close()) -----

        if (this._windowEventsBound) return;
        this._windowEventsBound = true;

        this._onWindowMouseMove = (e) => {
            if (!this._panState?.isPanning) return;
            this._panState.moved = true;
            this.mapX = e.pageX - this._panState.startX;
            this.mapY = e.pageY - this._panState.startY;
            const liveContainer = this.element?.find?.('.map-container');
            if (liveContainer?.length) {
                liveContainer.css('transform',
                    `translate(-50%, -50%) translate(${this.mapX}px, ${this.mapY}px) scale(${this.mapZoom})`);
            }
        };
        this._onWindowMouseUp = () => {
            if (this._panState?.isPanning) {
                this._panState.isPanning = false;
                const liveContainer = this.element?.find?.('.map-container');
                if (liveContainer?.length) liveContainer.css('cursor', this._mapPinMode ? 'crosshair' : 'grab');
            }
        };
        window.addEventListener('mousemove', this._onWindowMouseMove);
        window.addEventListener('mouseup',   this._onWindowMouseUp);
    }

    /**
     * Custom window drag implementation. Binds mousedown on the top-bar
     * .drag-handle; window mousemove/mouseup are bound ONCE per instance and
     * detached in close(). State lives on this._dragState so handlers always
     * see the latest mousedown values.
     */
    _setupWindowDrag(html) {
        // Modified build (П2): the whole phone "frame" is a drag handle, not just
        // the thin top bar. We bind mousedown on the chassis itself and start a
        // drag whenever the press lands on the bezel/frame (chassis border,
        // speaker grille, top bar) rather than on interactive screen content
        // (anything with data-action, inputs, buttons, links, or a scrollable
        // list). This makes the phone easy to reposition by grabbing its body.
        const chassis = html.find('.agent-chassis').first();
        const handle = html.find('.drag-handle').first();
        const dragRoot = chassis.length ? chassis : handle;
        if (!dragRoot.length) return;

        // The actual window element (the app frame Foundry wraps around our template).
        const appEl = this.element?.[0] || dragRoot.closest('.app')[0] || html.closest('.app')[0];
        if (!appEl) return;

        // Per-render: rebind mousedown on the whole chassis (element-scoped,
        // dies with re-render).
        dragRoot.off('mousedown.agentDrag').on('mousedown.agentDrag', (e) => {
            if (e.button !== 0) return; // left button only
            const $t = $(e.target);
            // Only the phone "frame" starts a drag: the chassis body itself, the
            // speaker grille, or the OS top bar. Everything inside `.agent-content`
            // (all scrollable app views, buttons, inputs, the map, chat, etc.)
            // keeps its own pointer behaviour. The close button is never a handle.
            const onFrame = $t.is('.agent-chassis, .agent-speaker, .agent-top-bar, .agent-screen')
                || $t.closest('.agent-top-bar').length > 0;
            const onContent = $t.closest('.agent-content').length > 0;
            const onClose = $t.closest('.agent-close-btn, [data-action]').length > 0;
            if (!onFrame || onContent || onClose) return;
            e.preventDefault();
            const rect = appEl.getBoundingClientRect();
            this._dragState.isDragging = true;
            this._dragState.startX = e.clientX;
            this._dragState.startY = e.clientY;
            this._dragState.origX = rect.left;
            this._dragState.origY = rect.top;
            dragRoot.addClass('agent-dragging');
        });

        // Once per instance: global mousemove/up. Cleaned up in close().
        if (this._onWindowDragMove) return;

        this._onWindowDragMove = (e) => {
            if (!this._dragState?.isDragging) return;
            const nx = this._dragState.origX + (e.clientX - this._dragState.startX);
            const ny = this._dragState.origY + (e.clientY - this._dragState.startY);
            // Use Foundry's positioning API so the app's internal position state stays in sync
            this.setPosition({ left: nx, top: ny });
        };
        this._onWindowDragUp = () => {
            if (this._dragState?.isDragging) {
                this._dragState.isDragging = false;
                this.element?.find?.('.agent-chassis, .drag-handle').removeClass('agent-dragging');
            }
        };
        window.addEventListener('mousemove', this._onWindowDragMove);
        window.addEventListener('mouseup',   this._onWindowDragUp);
    }

    /**
     * Modified build (П9 + П4): unified drop handler on the phone chassis.
     *  - Dropping an Actor or canvas Token while the NCPD / ZIGGURAT / GARDEN
     *    view is open (GM only) creates a pre-filled entry (name + portrait).
     *  - Dropping image/gif/audio files while a chat thread is open attaches
     *    them to the message composer (handled by _handleChatFileDrop).
     */
    _setupAgentDrop(html) {
        const root = html.find('.agent-chassis')[0] || html[0];
        if (!root) return;

        const onDragOver = (ev) => {
            ev.preventDefault();
            try { ev.dataTransfer.dropEffect = 'copy'; } catch (e) {}
            root.classList.add('agent-drop-active');
        };
        const onDragLeave = (ev) => {
            // Only clear when actually leaving the chassis (not entering a child).
            if (ev.target === root) root.classList.remove('agent-drop-active');
        };
        const onDrop = async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            root.classList.remove('agent-drop-active');

            // 1) File drops → chat attachments (П4).
            const files = ev.dataTransfer?.files;
            if (files && files.length) {
                await this._handleChatFileDrop(Array.from(files));
                return;
            }

            // 2) Foundry document drops (Actor / Token) → directory apps (П9).
            let data = null;
            try {
                data = foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData?.(ev)
                    ?? TextEditor.getDragEventData(ev);
            } catch (e) {
                try { data = JSON.parse(ev.dataTransfer.getData('text/plain') || '{}'); } catch (e2) { data = null; }
            }
            if (!data || !data.type) return;
            await this._handleActorDrop(data);
        };

        // Bind native listeners (jQuery's normalized events drop dataTransfer).
        root.addEventListener('dragover', onDragOver);
        root.addEventListener('dragleave', onDragLeave);
        root.addEventListener('drop', onDrop);

        // Modified build (П4): clipboard paste of an image into an open chat
        // thread. Bound once per instance on the document; cleaned up in close().
        if (!this._onAgentPaste) {
            this._onAgentPaste = async (ev) => {
                if (!this.rendered) return;
                if (!this._isChatThreadOpen()) return;
                const items = ev.clipboardData?.items;
                if (!items) return;
                for (const it of items) {
                    if (it.kind === 'file') {
                        const file = it.getAsFile();
                        if (file && this._classifyAttachmentFile(file)) {
                            ev.preventDefault();
                            // Stage for a caption instead of sending immediately.
                            await this._stageAttachment(file);
                            return;
                        }
                    }
                }
            };
            document.addEventListener('paste', this._onAgentPaste);
        }
    }

    /**
     * Modified build (П9): resolve a drag-drop payload to an Actor and add it to
     * whichever directory app is currently open. GM only.
     */
    async _handleActorDrop(data) {
        const view = this.currentView;
        const DIRECTORY_VIEWS = ['ncpd', 'ziggurat', 'garden'];
        if (!DIRECTORY_VIEWS.includes(view)) {
            // Not on a directory app — ignore silently (an actor drop elsewhere
            // isn't meaningful for the phone).
            return;
        }
        if (!game.user.isGM) {
            ui.notifications?.warn(game.i18n.localize("AGENTOS.Drop.GMOnly"));
            return;
        }

        // Resolve the dropped payload to an Actor.
        let actor = null;
        try {
            if (data.type === 'Actor') {
                actor = data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
            } else if (data.type === 'Token') {
                const scene = data.sceneId ? game.scenes.get(data.sceneId) : canvas?.scene;
                const tokenDoc = data.uuid ? await fromUuid(data.uuid)
                    : (scene?.tokens?.get(data.tokenId || data.id));
                actor = tokenDoc?.actor ?? tokenDoc?.baseActor ?? null;
            }
        } catch (e) {
            console.warn("[Agent OS] actor drop resolve failed:", e);
        }
        if (!(actor instanceof Actor)) {
            ui.notifications?.warn(game.i18n.localize("AGENTOS.Drop.NoActor"));
            return;
        }

        const name = actor.name || "Unknown";
        // Prefer the actor portrait; fall back to the prototype token image.
        const img = actor.img
            || actor.prototypeToken?.texture?.src
            || "icons/svg/mystery-man.svg";

        if (view === 'ncpd') {
            await this._addDirectoryEntry("ncpdRapSheets", {
                id: "rap_" + foundry.utils.randomID(),
                name, charges: "", bounty: "", status: "Known to police",
                notes: "", mugshot: img, createdAt: Date.now()
            });
            this._ncpdActiveId = null; this._ncpdSearch = "";
            ui.notifications?.info(game.i18n.format("AGENTOS.Drop.NcpdAdded", { name }));
        } else if (view === 'ziggurat') {
            await this._addDirectoryEntry("cityDirectoryEntries", {
                id: "city_" + foundry.utils.randomID(),
                name, category: "Other", address: "", hours: "", notes: "", image: img
            });
            ui.notifications?.info(game.i18n.format("AGENTOS.Drop.ZigguratAdded", { name }));
        } else if (view === 'garden') {
            await this._addDirectoryEntry("gardenProfiles", {
                id: "g_" + foundry.utils.randomID(),
                name, age: "", photo: img, bio: "", interests: "",
                availability: "Active", targetUserIds: []
            });
            this._gardenActiveId = null;
            ui.notifications?.info(game.i18n.format("AGENTOS.Drop.GardenAdded", { name }));
        }
        this._playUiSound?.('tap');
        this.render(true);
    }

    /**
     * Modified build (П12): play a short UI sound via the global WebAudio helper.
     * type: 'tap' | 'message' | 'error'. No-op if the helper isn't loaded.
     */
    _playUiSound(type = 'tap') {
        try { globalThis.AgentOSAudio?.play(type); } catch (e) { /* never block UI */ }
    }

    /**
     * Modified build: confirm a destructive delete. Returns true if confirmed.
     * Uses Foundry's DialogV2/Dialog.confirm so it works across v12 builds.
     */
    async _confirmDelete(name) {
        const content = game.i18n.format("AGENTOS.Confirm.DeleteBody", { name: name || "—" });
        try {
            const DV2 = foundry.applications?.api?.DialogV2;
            if (DV2?.confirm) {
                return await DV2.confirm({
                    window: { title: game.i18n.localize("AGENTOS.Confirm.DeleteTitle") },
                    content: `<p>${content}</p>`,
                    rejectClose: false,
                    modal: true
                });
            }
        } catch (e) { /* fall through to legacy */ }
        try {
            return await Dialog.confirm({
                title: game.i18n.localize("AGENTOS.Confirm.DeleteTitle"),
                content: `<p>${content}</p>`,
                defaultYes: false
            });
        } catch (e) {
            return true; // dialog unavailable — don't block the GM
        }
    }

    /* ===== Modified build (П4): personal CONTACTS app ==================== */

    /**
     * Deterministic SVG avatar for a contact, returned as a data-URI.
     * Derives a stable hue + initials from the name so each contact gets a
     * distinct, generated portrait without any uploaded image.
     */
    _contactAvatarSvg(name, colorHint) {
        const str = String(name || "?").trim() || "?";
        // Stable hash → hue.
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
        const hue = h;
        const c1 = colorHint || `hsl(${hue}, 65%, 42%)`;
        const c2 = colorHint ? colorHint : `hsl(${(hue + 40) % 360}, 70%, 28%)`;
        // Initials (up to 2 letters).
        const parts = str.split(/\s+/).filter(Boolean);
        let initials = (parts[0]?.[0] || "?");
        if (parts.length > 1) initials += parts[parts.length - 1][0];
        initials = initials.toUpperCase();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="96" height="96" rx="14" fill="#0a0d10"/>
  <rect x="3" y="3" width="90" height="90" rx="12" fill="url(#g)" opacity="0.92"/>
  <rect x="3" y="3" width="90" height="90" rx="12" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/>
  <text x="48" y="58" font-family="monospace" font-size="38" font-weight="bold" fill="#0a0d10" text-anchor="middle" opacity="0.85">${initials}</text>
  <text x="48" y="56" font-family="monospace" font-size="38" font-weight="bold" fill="#ffffff" text-anchor="middle">${initials}</text>
</svg>`;
        return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
    }

    /** Read a user's personal contacts array (always returns an array). */
    _getPersonalContacts(user) {
        const raw = user?.getFlag?.("cyberpunk-red-agent-os-modified", "personalContacts");
        return Array.isArray(raw) ? raw : [];
    }

    /** Decorate a stored contact with its display avatar (generated if none). */
    _decorateContact(c) {
        return {
            ...c,
            avatar: c.avatar || this._contactAvatarSvg(c.name, c.color),
            hasLocation: !!(c.hasLocation && typeof c.mapX === "number" && typeof c.mapY === "number")
        };
    }

    /** Append an entry to one of the JSON-array world settings. */
    async _addDirectoryEntry(settingKey, entry) {
        let list = [];
        try { list = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", settingKey) || "[]"); } catch (e) {}
        if (!Array.isArray(list)) list = [];
        list.push(entry);
        await game.settings.set("cyberpunk-red-agent-os-modified", settingKey, JSON.stringify(list));
    }

    /* ===== Modified build (П4): file attachments in chat ================= */

    /**
     * Classify a File into an attachment kind, or null if unsupported.
     * Supports images (incl. gif) and audio.
     */
    _classifyAttachmentFile(file) {
        const mime = (file.type || "").toLowerCase();
        const name = (file.name || "").toLowerCase();
        const isImg = mime.startsWith("image/")
            || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
        const isAudio = mime.startsWith("audio/")
            || /\.(mp3|ogg|wav|m4a|flac|webm)$/.test(name);
        if (isImg) return 'photo';
        if (isAudio) return 'audio';
        return null;
    }

    /**
     * Upload a File to the module's user-upload folder and return its path.
     * Uses Foundry's FilePicker.upload (data source). Creates the folder lazily.
     */
    async _uploadAttachmentFile(file) {
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
        const baseDir = "agent-os-uploads";
        // Ensure the upload folder exists (ignore "already exists" errors).
        try { await FP.createDirectory("data", baseDir, {}); } catch (e) { /* exists */ }
        // Namespace by user id so players don't clobber each other.
        const userDir = `${baseDir}/${game.user.id}`;
        try { await FP.createDirectory("data", userDir, {}); } catch (e) { /* exists */ }
        // Sanitise the filename and prefix with a random id to avoid collisions.
        const safe = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
        const fname = `${foundry.utils.randomID(8)}_${safe}`;
        const renamed = new File([file], fname, { type: file.type });
        const result = await FP.upload("data", userDir, renamed, {}, { notify: false });
        return result?.path || null;
    }

    /**
     * Handle one or more dropped files: upload the first supported image/audio
     * and post it as a chat attachment. Requires an open thread.
     */
    async _handleChatFileDrop(files) {
        // Modified build fix: an open conversation is `currentView === 'chat-thread'`
        // (the contacts list is 'chat'). The real requirement is simply that a
        // thread is active, so gate on `activeContactId`, not the exact view name.
        if (!this._isChatThreadOpen()) {
            ui.notifications?.warn(game.i18n.localize("AGENTOS.Attach.OpenThread"));
            return;
        }
        const file = files.find(f => this._classifyAttachmentFile(f));
        if (!file) {
            ui.notifications?.warn(game.i18n.localize("AGENTOS.Attach.Unsupported"));
            return;
        }
        // Stage the file for a caption instead of sending immediately.
        await this._stageAttachment(file);
    }

    /** True when a chat conversation is open (thread view with an active contact). */
    _isChatThreadOpen() {
        return !!this.activeContactId
            && (this.currentView === 'chat' || this.currentView === 'chat-thread');
    }

    /**
     * Modified build: stage a File for sending — upload it now, but hold it in
     * the composer with a preview so the user can type a caption before sending.
     * Replaces the old "send immediately" behaviour.
     */
    async _stageAttachment(file) {
        const kind = this._classifyAttachmentFile(file);
        if (!kind) {
            ui.notifications?.warn(game.i18n.localize("AGENTOS.Attach.Unsupported"));
            return;
        }
        let src = null;
        try {
            ui.notifications?.info(game.i18n.localize("AGENTOS.Attach.Uploading"));
            src = await this._uploadAttachmentFile(file);
        } catch (e) {
            console.error("[Agent OS] attachment upload failed:", e);
            ui.notifications?.error(game.i18n.localize("AGENTOS.Attach.UploadFailed"));
            return;
        }
        if (!src) {
            ui.notifications?.error(game.i18n.localize("AGENTOS.Attach.UploadFailed"));
            return;
        }
        // Hold it in the composer; the chat-send button (or its own send action)
        // posts it with whatever caption the user typed.
        this._stagedAttachment = { kind, src, name: file.name || "" };
        this.showAttachPicker = false;
        this._playUiSound?.('tap');
        this.render(true);
    }

    /** Send the currently-staged attachment with an optional caption, then clear. */
    async _sendStagedAttachment(caption) {
        const staged = this._stagedAttachment;
        if (!staged) return;
        this._stagedAttachment = null;
        await this._postAttachmentMessage({
            kind: staged.kind,
            src: staged.src,
            desc: (caption || "").trim()
        });
        this._playUiSound?.('tap');
        this.render(true);
    }

    /**
     * Legacy direct send (still used by the RP attachment card path). Uploads a
     * File and posts it immediately with the filename as the description.
     */
    async _sendFileAttachment(file) {
        const kind = this._classifyAttachmentFile(file);
        if (!kind) {
            ui.notifications?.warn(game.i18n.localize("AGENTOS.Attach.Unsupported"));
            return;
        }
        let src = null;
        try {
            ui.notifications?.info(game.i18n.localize("AGENTOS.Attach.Uploading"));
            src = await this._uploadAttachmentFile(file);
        } catch (e) {
            console.error("[Agent OS] attachment upload failed:", e);
            ui.notifications?.error(game.i18n.localize("AGENTOS.Attach.UploadFailed"));
            return;
        }
        if (!src) {
            ui.notifications?.error(game.i18n.localize("AGENTOS.Attach.UploadFailed"));
            return;
        }
        await this._postAttachmentMessage({ kind, src, desc: file.name || "" });
        this._playUiSound?.('tap');
        this.render(true);
    }

    /**
     * Post an attachment message into the active thread. Shared by the RP
     * attachment-card path (send-attachment) and the file-upload path. Mirrors
     * the whisper routing used for ordinary Agent messages.
     */
    async _postAttachmentMessage({ kind, src = null, desc = "" }) {
        if (!this.activeContactId) return;
        const contacts = this._getContacts();
        const threadContact = contacts.find(c => c.id === this.activeContactId);
        const isNpcThread = this.activeContactId?.startsWith("npc_");
        const speakerAlias = (game.user.isGM && isNpcThread && threadContact)
            ? (threadContact.originalName || threadContact.name)
            : (game.user.name + " (Agent)");
        const npcOverrideName = (game.user.isGM && isNpcThread && threadContact)
            ? (threadContact.originalName || threadContact.name) : undefined;
        let _resolvedNpcAvatar = (game.user.isGM && isNpcThread && threadContact?.avatar) ? threadContact.avatar : null;
        if (!_resolvedNpcAvatar && game.user.isGM && isNpcThread) {
            for (const u of game.users) {
                const lst = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                const m = lst.find(c => c.id === this.activeContactId);
                if (m?.avatar) { _resolvedNpcAvatar = m.avatar; break; }
            }
        }
        const npcOverrideAvatar = _resolvedNpcAvatar || undefined;
        const label = src ? (kind === 'audio' ? 'AUDIO' : 'IMAGE') : kind.toUpperCase();
        const messageData = {
            content: `[${label}] ${desc}`.trim(),
            speaker: { alias: speakerAlias },
            flags: {
                "cyberpunk-red-agent-os-modified": {
                    isAgentMessage: true,
                    threadId: this.activeContactId,
                    overrideName: npcOverrideName,
                    overrideAvatar: npcOverrideAvatar,
                    targetName: threadContact?.name,
                    attachment: { kind, desc: String(desc).slice(0, 500), src: src || undefined }
                }
            }
        };
        // Whisper routing — identical to the normal message path.
        if (this.activeContactId !== 'party_group_chat') {
            if (this.activeContactId?.startsWith("pcgroup_") || threadContact?.isCustomGroup) {
                const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                const targets = new Set(gmIds);
                targets.add(game.user.id);
                const members = Array.isArray(threadContact?.members) ? threadContact.members : [];
                for (const m of members) {
                    if (m.startsWith("player:")) targets.add(m.slice("player:".length));
                }
                messageData.whisper = Array.from(targets);
            } else if (game.users.get(this.activeContactId)) {
                messageData.whisper = [this.activeContactId];
            } else if (isNpcThread) {
                if (game.user.isGM) {
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    const targets = new Set(gmIds);
                    const tList = Array.isArray(threadContact?.targetUserIds) ? threadContact.targetUserIds : [];
                    for (const uid of tList) targets.add(uid);
                    if (threadContact?.ownerId) targets.add(threadContact.ownerId);
                    messageData.whisper = Array.from(targets);
                } else {
                    messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                }
            } else if (!game.user.isGM) {
                messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
            }
        }
        await ChatMessage.create(messageData);
    }

    /**
     * Lazy-load every priced item from the CPR compendiums. Cached on the
     * instance until close(). Returns a categorized catalog object.
     */
    async _loadStoreCatalog() {
        if (this._storeCatalog) return this._storeCatalog;
        if (this._storeLoading) return this._storeLoading;
        const PACK_TO_CATEGORY = {
            "cyberpunk-red-core.core_weapons":          "Weapons",
            "cyberpunk-red-core.core_weapons-branded":  "Weapons",
            "cyberpunk-red-core.core_ammo":             "Ammo",
            "cyberpunk-red-core.core_armor":            "Armor",
            "cyberpunk-red-core.core_clothing":         "Clothing",
            "cyberpunk-red-core.core_gear":             "Gear",
            "cyberpunk-red-core.core_cyberware":        "Cyberware",
            "cyberpunk-red-core.core_drugs":            "Drugs",
            "cyberpunk-red-core.core_programs":         "Programs",
            "cyberpunk-red-core.core_vehicles":         "Vehicles",
            "cyberpunk-red-core.core_upgrades":         "Upgrades",
            // Black Chrome DLC packs auto-included if present
            "cyberpunk-red-core.black-chrome_weapons":   "Weapons",
            "cyberpunk-red-core.black-chrome_ammo":      "Ammo",
            "cyberpunk-red-core.black-chrome_armor":     "Armor",
            "cyberpunk-red-core.black-chrome_clothing":  "Clothing",
            "cyberpunk-red-core.black-chrome_gear":      "Gear",
            "cyberpunk-red-core.black-chrome_cyberware": "Cyberware",
            "cyberpunk-red-core.black-chrome_vehicles":  "Vehicles",
            "cyberpunk-red-core.black-chrome_upgrades":  "Upgrades"
        };
        this._storeLoading = (async () => {
            const catalog = {};
            for (const [packId, cat] of Object.entries(PACK_TO_CATEGORY)) {
                const pack = game.packs.get(packId);
                if (!pack) continue;
                try {
                    const docs = await pack.getDocuments();
                    for (const d of docs) {
                        const price = foundry.utils.getProperty(d, "system.price.market");
                        if (typeof price !== "number" || price <= 0) continue;
                        catalog[cat] = catalog[cat] || [];
                        catalog[cat].push({
                            uuid: d.uuid,
                            name: d.name,
                            img: d.img || "icons/svg/mystery-man.svg",
                            price: price,
                            type: d.type,
                            isCustom: false
                        });
                    }
                } catch (e) {
                    console.warn(`[Agent OS] Store: pack ${packId} load failed`, e);
                }
            }
            // Load custom compendium packs (GM-configured)
            try {
                const customPackStr = game.settings.get("cyberpunk-red-agent-os-modified", "customStorePacks") || "";
                const customPackIds = customPackStr.split(",").map(s => s.trim()).filter(Boolean);
                for (const packId of customPackIds) {
                    const pack = game.packs.get(packId);
                    if (!pack) { console.warn(`[Agent OS] Store: custom pack ${packId} not found`); continue; }
                    try {
                        const docs = await pack.getDocuments();
                        // Derive category from pack name or use "Custom"
                        const packLabel = pack.metadata?.label || "Custom";
                        for (const d of docs) {
                            const price = foundry.utils.getProperty(d, "system.price.market");
                            const cat = (typeof price === "number" && price > 0) ? packLabel : null;
                            if (!cat) continue;
                            catalog[cat] = catalog[cat] || [];
                            catalog[cat].push({
                                uuid: d.uuid,
                                name: d.name,
                                img: d.img || "icons/svg/mystery-man.svg",
                                price: price,
                                type: d.type,
                                isCustom: true
                            });
                        }
                    } catch (e) {
                        console.warn(`[Agent OS] Store: custom pack ${packId} load failed`, e);
                    }
                }
            } catch (e) { console.warn("[Agent OS] Store: custom packs setting not found"); }

            // Merge in manually-added custom items (GM JSON setting)
            try {
                const rawCustom = game.settings.get("cyberpunk-red-agent-os-modified", "customStoreItems") || "[]";
                let customItems = [];
                try { customItems = JSON.parse(rawCustom); } catch (e) {}
                if (Array.isArray(customItems)) {
                    for (const ci of customItems) {
                        if (!ci.name || !ci.category || !ci.price) continue;
                        const cat = ci.category;
                        catalog[cat] = catalog[cat] || [];
                        catalog[cat].push({
                            uuid: "custom_" + btoa(ci.name + "|" + ci.category + "|" + ci.price).replace(/[^a-zA-Z0-9]/g, ''),
                            name: ci.name,
                            img: ci.img || "modules/cyberpunk-red-agent-os-modified/assets/cyberpunk-holophone/icons/optics.png",
                            price: Number(ci.price) || 0,
                            type: ci.type || "item",
                            description: ci.description || "",
                            isCustom: true
                        });
                    }
                }
            } catch (e) { console.warn("[Agent OS] Store: custom items setting not found"); }

            // Patch3.2: apply GM controls — max price cap, source filter,
            // locked categories, blacklist. Filters are applied AFTER catalog
            // assembly so cache invalidation just bumps the setting onChange.
            let maxPrice = 0, srcFilter = "all", lockedCats = "", blacklist = "";
            try { maxPrice  = Number(game.settings.get("cyberpunk-red-agent-os-modified", "storeMaxPrice")) || 0; } catch (e) {}
            try { srcFilter = game.settings.get("cyberpunk-red-agent-os-modified", "storeSourceFilter") || "all"; } catch (e) {}
            try { lockedCats = game.settings.get("cyberpunk-red-agent-os-modified", "storeLockedCategories") || ""; } catch (e) {}
            try { blacklist = game.settings.get("cyberpunk-red-agent-os-modified", "storeBlacklistIds") || ""; } catch (e) {}
            const lockedSet = new Set(lockedCats.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
            const blockedSet = new Set(blacklist.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean));
            for (const cat of Object.keys(catalog)) {
                if (lockedSet.has(cat.toLowerCase())) { delete catalog[cat]; continue; }
                catalog[cat] = catalog[cat].filter(item => {
                    if (maxPrice > 0 && Number(item.price) > maxPrice) return false;
                    if (srcFilter === "core"   && item.isCustom) return false;
                    if (srcFilter === "custom" && !item.isCustom) return false;
                    if (blockedSet.size) {
                        const uuidLc = String(item.uuid || "").toLowerCase();
                        const nameLc = String(item.name || "").toLowerCase();
                        if (blockedSet.has(uuidLc) || blockedSet.has(nameLc)) return false;
                    }
                    return true;
                });
                // Drop now-empty categories so the tab bar doesn't show ghost tabs.
                if (catalog[cat].length === 0) delete catalog[cat];
            }

            // Sort each category alphabetically
            for (const cat of Object.keys(catalog)) {
                catalog[cat].sort((a, b) => a.name.localeCompare(b.name));
            }
            this._storeCatalog = catalog;
            this._storeLoading = null;
            return catalog;
        })();
        return this._storeLoading;
    }

    _getCart() {
        return game.user.getFlag("cyberpunk-red-agent-os-modified", "cart") || [];
    }

    async _addToCart(itemUuid, item) {
        const cart = this._getCart();
        const existing = cart.find(e => e.itemUuid === itemUuid);
        if (existing) {
            existing.qty = (existing.qty || 1) + 1;
        } else {
            cart.push({ itemUuid, name: item.name, img: item.img, price: item.price, type: item.type, qty: 1 });
        }
        await game.user.setFlag("cyberpunk-red-agent-os-modified", "cart", cart);
    }

    async _setCartQty(itemUuid, qty) {
        let cart = this._getCart();
        if (qty <= 0) {
            cart = cart.filter(e => e.itemUuid !== itemUuid);
        } else {
            const e = cart.find(e => e.itemUuid === itemUuid);
            if (e) e.qty = qty;
        }
        await game.user.setFlag("cyberpunk-red-agent-os-modified", "cart", cart);
    }

    async _clearCart() {
        await game.user.setFlag("cyberpunk-red-agent-os-modified", "cart", []);
    }

    _cartTotal(cart) {
        return (cart || this._getCart()).reduce((s, e) => s + (Number(e.price) || 0) * (Number(e.qty) || 0), 0);
    }

    /**
     * Run a NC MART checkout. Validates balance + permission, deducts wealth
     * via deltaLedgerProperty, and adds the items to the actor's inventory.
     * Players without OWNER on the target actor route via socket to the GM.
     */
    async _checkout() {
        const cart = this._getCart();
        if (!cart.length) { ui.notifications.warn("Agent Store: Cart is empty."); return; }
        const total = this._cartTotal(cart);
        const actor = this._resolveActor(this.actorUuid);
        if (!(actor instanceof Actor)) {
            ui.notifications.error("Agent Store: No character sheet to deliver to.");
            return;
        }
        const balance = this._getActorEurobucks(actor).balance;
        if (balance < total) {
            ui.notifications.warn(`Agent Store: Insufficient funds. ${total - balance}eb short.`);
            return;
        }
        const canWriteLocally = game.user.isGM || actor.testUserPermission(game.user, "OWNER");
        if (canWriteLocally) {
            await this._processCheckout(actor, cart, total, game.user.name);
        } else {
            if (!game.users.some(u => u.isGM && u.active)) {
                ui.notifications.error("Agent Store: No System Admin online to process order.");
                return;
            }
            console.log("[Agent OS] Emitting storeCheckout:", { actorUuid: actor.uuid, total, cart });
            game.socket.emit("module.cyberpunk-red-agent-os-modified", {
                action: "storeCheckout",
                actorUuid: actor.uuid,
                cart, total,
                requesterId: game.user.id
            });
            ui.notifications.info("Agent Store: Order transmitted to System Admin...");
        }
        this.render(true);
    }

    async _processCheckout(actor, cart, total, requesterName) {
        // Deduct wealth via CPR ledger
        if (typeof actor.deltaLedgerProperty === "function") {
            await actor.deltaLedgerProperty("wealth", -total, `Agent: NC MART order (${cart.length} item${cart.length===1?'':'s'})`);
        } else {
            const ebPath = this._getActorEurobucks(actor).path;
            await actor.update({ [ebPath]: Math.max(0, this._getActorEurobucks(actor).balance - total) });
        }
        // Expand cart into individual item docs (respecting qty)
        const itemDocs = [];
        let customItemCount = 0;
        for (const entry of cart) {
            for (let i = 0; i < entry.qty; i++) {
                // Custom items have synthetic UUIDs — create a basic item directly
                if (entry.itemUuid && entry.itemUuid.startsWith("custom_")) {
                    itemDocs.push({
                        name: entry.name || "Custom Item",
                        type: entry.type || "gear",
                        img: entry.img || "icons/svg/mystery-man.svg",
                        system: { description: { value: entry.description || `Purchased from NC MART for ${entry.price}eb.` } }
                    });
                    customItemCount++;
                    continue;
                }
                try {
                    const item = await fromUuid(entry.itemUuid);
                    if (item) itemDocs.push(item.toObject());
                } catch (e) {
                    console.warn("[Agent OS] Store: could not resolve", entry.itemUuid, e);
                }
            }
        }
        if (itemDocs.length) {
            try { await actor.createEmbeddedDocuments("Item", itemDocs); }
            catch (e) { console.warn("[Agent OS] Store: createEmbeddedDocuments failed", e); }
        }
        await this._clearCart();
        ui.notifications.info(`Agent Store: Delivered ${itemDocs.length} item${itemDocs.length===1?'':'s'} (${total}eb).`);

        // Receipt chat (whispered to actor owners + GMs)
        const owners = game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id);
        const gms = game.users.filter(u => u.isGM).map(u => u.id);
        const whisper = Array.from(new Set([...owners, ...gms]));
        ChatMessage.create({
            content: `<div style="border:1px solid #00ffcc; background:#0a1a1a; padding:10px; font-family:monospace; color:#fff;">
                <b style="color:#00ffcc;">NC MART :: ORDER RECEIPT</b><br>
                <span style="color:#888;">CUSTOMER:</span> ${_agentEscHTML(actor.name)}<br>
                <span style="color:#888;">ITEMS:</span> ${Number(itemDocs.length)}<br>
                <span style="color:#888;">TOTAL:</span> ${Number(total)}eb<br>
                ${requesterName ? `<span style="color:#888;">PLACED BY:</span> ${_agentEscHTML(requesterName)}` : ""}
            </div>`,
            whisper,
            flags: { "cyberpunk-red-agent-os-modified": { isAgentMessage: false } }
        });
    }

    async _executeTransfer(fromUuid, toUuid, amount, memo) {
        // Patch3: serialize all transfers through a global lock. CPR's
        // `deltaLedgerProperty` is atomic, but VirtualWallet (User flags) and
        // the fallback `actor.update(path, newValue)` path are read-modify-write
        // and can lose balance on concurrent calls. Cheap fix: queue them.
        globalThis.__AgentDeviceXferLock = (globalThis.__AgentDeviceXferLock || Promise.resolve())
            .then(() => this._executeTransferInner(fromUuid, toUuid, amount, memo))
            .catch(err => { console.error("[Agent OS] _executeTransfer chain error:", err); return false; });
        return globalThis.__AgentDeviceXferLock;
    }

    async _executeTransferInner(fromUuid, toUuid, amount, memo) {
        if (!game.user.isGM) return false;

        // Hard input validation — must be a finite positive integer
        amount = Number(amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            console.warn("[Agent OS] _executeTransfer rejected — invalid amount:", amount);
            return false;
        }
        // Patch3: memo length cap — chat HTML payload safety
        memo = String(memo || "").slice(0, 200);
        if (!fromUuid || !toUuid) {
            console.warn("[Agent OS] _executeTransfer rejected — missing uuid:", { fromUuid, toUuid });
            return false;
        }
        if (fromUuid === toUuid) {
            console.warn("[Agent OS] _executeTransfer rejected — sender and receiver match");
            return false;
        }

        const resolveTarget = (uuid) => {
            if (!uuid || uuid === "VirtualWallet") return "VirtualWallet";
            if (!uuid.startsWith("User.")) return uuid;
            const user = game.users.get(uuid.split(".")[1]);
            return this._getIdentity(user);
        };

        const sourceId = resolveTarget(fromUuid);
        const targetId = resolveTarget(toUuid);

        const fromIsVirtual = sourceId === "VirtualWallet" || sourceId.startsWith("User.");
        const toIsVirtual = targetId === "VirtualWallet" || targetId.startsWith("User.");

        let fromObj = null;
        if (fromIsVirtual) {
            fromObj = (sourceId === "VirtualWallet") ? game.user : game.users.get(sourceId.split(".")[1]);
        } else {
            fromObj = fromUuidSync(sourceId);
        }

        let toObj = null;
        if (toIsVirtual) {
            toObj = (targetId === "VirtualWallet") ? game.user : game.users.get(targetId.split(".")[1]);
        } else {
            toObj = fromUuidSync(targetId);
        }

        if (!fromObj || !toObj) {
            console.error(`[Agent OS] Transfer Fault: ${fromObj ? "Target" : "Source"} identified but not found.`);
            return false;
        }

        const fromEB = fromIsVirtual ? this._getVirtualBalance(fromObj) : this._getActorEurobucks(fromObj);
        const toEB = toIsVirtual ? this._getVirtualBalance(toObj) : this._getActorEurobucks(toObj);

        const fromName = fromIsVirtual ? (sourceId === "VirtualWallet" ? "System Fund" : fromObj.name) : fromObj.name;
        const toName = toIsVirtual ? (targetId === "VirtualWallet" ? "System Fund" : toObj.name) : toObj.name;

        const newSenderBalance = Number(fromEB.balance) - amount;
        const newReceiverBalance = Number(toEB.balance) + amount;

        console.log(`[Agent OS] Settling: ${fromName} -> ${toName} (${amount}eb)`);

        // Payer write
        if (fromIsVirtual) {
            await fromObj.setFlag("cyberpunk-red-agent-os-modified", "virtualWalletBalance", newSenderBalance);
            let txs = fromObj.getFlag("cyberpunk-red-agent-os-modified", "virtualWalletTransactions") || [];
            txs.push({ label: `To ${toName}: ${memo}`, amount, isPositive: false, date: new Date().toLocaleString() });
            await fromObj.setFlag("cyberpunk-red-agent-os-modified", "virtualWalletTransactions", JSON.parse(JSON.stringify(txs)));
        } else if (typeof fromObj.deltaLedgerProperty === 'function') {
            // CPR-aware path: writes value + pushes to system.wealth.transactions
            // (visible on the character sheet's Wealth tab).
            await fromObj.deltaLedgerProperty("wealth", -amount, `Agent: To ${toName} - ${memo}`);
        } else {
            // Fallback for non-CPR systems
            await fromObj.update({ [fromEB.path]: newSenderBalance });
            let txs = fromObj.getFlag("cyberpunk-red-agent-os-modified", "transactions") || [];
            txs.push({ label: `To ${toName}: ${memo}`, amount, isPositive: false, date: new Date().toLocaleString() });
            await fromObj.setFlag("cyberpunk-red-agent-os-modified", "transactions", txs);
        }

        // Receiver write
        if (toIsVirtual) {
            await toObj.setFlag("cyberpunk-red-agent-os-modified", "virtualWalletBalance", newReceiverBalance);
            let txs = toObj.getFlag("cyberpunk-red-agent-os-modified", "virtualWalletTransactions") || [];
            txs.push({ label: `From ${fromName}: ${memo}`, amount, isPositive: true, date: new Date().toLocaleString() });
            await toObj.setFlag("cyberpunk-red-agent-os-modified", "virtualWalletTransactions", JSON.parse(JSON.stringify(txs)));
        } else if (typeof toObj.deltaLedgerProperty === 'function') {
            await toObj.deltaLedgerProperty("wealth", amount, `Agent: From ${fromName} - ${memo}`);
        } else {
            await toObj.update({ [toEB.path]: newReceiverBalance });
            let txs = toObj.getFlag("cyberpunk-red-agent-os-modified", "transactions") || [];
            txs.push({ label: `From ${fromName}: ${memo}`, amount, isPositive: true, date: new Date().toLocaleString() });
            await toObj.setFlag("cyberpunk-red-agent-os-modified", "transactions", txs);
        }

        // Broadcast Sync — now includes balances so consumers don't see `undefined`
        game.socket.emit("module.cyberpunk-red-agent-os-modified", {
            action: "transferConfirmed",
            senderUuid: sourceId,
            receiverUuid: targetId,
            amount,
            senderBalance: newSenderBalance,
            receiverBalance: newReceiverBalance
        });

        // Whisper targets
        const getWhisperIds = (obj) => {
            if (obj instanceof User) return [obj.id];
            if (obj instanceof Actor) return game.users.filter(u => obj.testUserPermission(u, "OWNER")).map(u => u.id);
            return [];
        };
        const whisperTargets = new Set([...getWhisperIds(fromObj), ...getWhisperIds(toObj), ...game.users.filter(u => u.isGM).map(u => u.id)]);

        // HTML-escape user-controllable strings before interpolating into chat HTML.
        const esc = (s) => (foundry.utils.escapeHTML
            ? foundry.utils.escapeHTML(String(s ?? ""))
            : String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        ChatMessage.create({
            content: `
                <div style="border: 2px solid #00ff9f; background: #111; padding:10px; border-radius: 4px; color: #fff; font-family: monospace;">
                    <b style="color:#00ff9f">CITY BANK: SETTLEMENT</b><br>
                    <div style="margin-top:5px; border-top:1px solid #333; padding-top:5px;">
                        <span style="color:#ff3355">DEBIT</span>: ${esc(fromName)}<br>
                        <span style="color:#00ff9f">CREDIT</span>: ${esc(toName)}<br>
                        <span>AMOUNT</span>: ${Number(amount)}eb<br>
                        <span style="color:#888; font-size:0.75rem;">MEMO: ${esc(memo)}</span>
                    </div>
                </div>`,
            whisper: Array.from(whisperTargets),
            flags: { "cyberpunk-red-agent-os-modified": { isAgentMessage: false } }
        });

        return true;
    }

    _getPartyPlayers() {
        return game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: (u.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || u.name, actorUuid: this._getIdentity(u) }));
    }

    async _pushShard(targetId, title, content) {
        const newShard = {
            id: foundry.utils.randomID(),
            name: title,
            content: content,
            source: "ZIGGURAT_GM_INJECTION",
            date: new Date().toLocaleDateString(),
            timestamp: Date.now()
        };

        if (targetId === "broadcast") {
            const targetIds = [];
            for (let player of this._getPartyPlayers()) {
                const user = game.users.get(player.id);
                if (!user) continue;
                let shards = user.getFlag("cyberpunk-red-agent-os-modified", "shards") || [];
                shards.push(newShard);
                await user.setFlag("cyberpunk-red-agent-os-modified", "shards", shards);
                targetIds.push(player.id);
            }
            // Notify all players so their UI refreshes immediately
            game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "shardDelivered", targetUserIds: targetIds });
            ui.notifications.info("Agent Data: Broadcast complete.");
        } else {
            const user = game.users.get(targetId);
            if (!user) return;
            let shards = user.getFlag("cyberpunk-red-agent-os-modified", "shards") || [];
            shards.push(newShard);
            await user.setFlag("cyberpunk-red-agent-os-modified", "shards", shards);
            // Notify the target player so their UI refreshes immediately
            game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "shardDelivered", targetUserIds: [targetId] });
            ui.notifications.info(`Agent Data: Shard injected to ${user.name}.`);
        }

    }

    async _deleteShard(shardId, ownerId) {
        if (game.user.isGM && ownerId) {
            // GM deleting from a specific user's shards
            const targetUser = game.users.get(ownerId);
            if (targetUser) {
                let shards = targetUser.getFlag("cyberpunk-red-agent-os-modified", "shards") || [];
                shards = shards.filter(s => s.id !== shardId);
                await targetUser.setFlag("cyberpunk-red-agent-os-modified", "shards", shards);
            }
        } else {
            // Player (or GM with no ownerId) deleting from own shards
            let shards = game.user.getFlag("cyberpunk-red-agent-os-modified", "shards") || [];
            shards = shards.filter(s => s.id !== shardId);
            await game.user.setFlag("cyberpunk-red-agent-os-modified", "shards", shards);
        }
        ui.notifications.warn("Agent Data: Record purged from buffer.");
    }

    // --- AUCTION HOUSE: Settle winner ---
    async _settleAuction(auctionId) {
        let auctions = [];
        try { auctions = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings") || "[]"); } catch(e) {}
        const auction = auctions.find(a => a.id === auctionId);
        if (!auction) return;

        if (!auction.highBidderId) {
            ui.notifications.warn("Agent Auction: No bids placed — removing listing.");
            auctions = auctions.filter(a => a.id !== auctionId);
            this._pendingAuctionData = auctions;
            this.render(true);
            game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", JSON.stringify(auctions)).then(() => {
                this._pendingAuctionData = null;
                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
            });
            return;
        }

        // Patch4 (Gotto Goho NPC bidder follow-up): if the winning bid was
        // placed via the GM-only NPC bid path, the "winner" isn't a real user.
        // Skip the transfer (no real wallet to deduct from — the GM handles
        // off-screen NPC bookkeeping however they like), mark settled, and
        // notify only the GMs since there's no player on the other side.
        const isNpcWinner = String(auction.highBidderId || "").startsWith("npc:") || auction.isNpcBid;

        // Patch4.6: GM-as-winner — the GM runs the house, doesn't pay itself.
        // Previously `_getIdentity(GM)` resolved to whatever owned actor was
        // around (often a 0-balance test NPC) and the transfer failed with
        // "winner may lack funds." Treat GM-winner same as NPC-winner: skip
        // the deduction, mark settled with a manual-handoff note.
        const winnerUser = isNpcWinner ? null : game.users.get(auction.highBidderId);
        const isGmWinner = !!(winnerUser && winnerUser.isGM);

        if (!isNpcWinner && !isGmWinner) {
            // Real player winner: deduct eb from them.
            if (!winnerUser) { ui.notifications.error("Agent Auction: Winner not found."); return; }
            const winnerIdentity = this._getIdentity(winnerUser);
            const success = await this._executeTransfer(winnerIdentity, "VirtualWallet", auction.currentBid, `Auction: ${auction.name}`);
            if (!success) { ui.notifications.error("Agent Auction: Payment failed — winner may lack funds."); return; }
        }

        // Mark as settled
        auction.settled = true;
        this._pendingAuctionData = auctions;

        // Notify (skip the auctionWon socket for NPC/GM winners — no player to alert)
        if (!isNpcWinner && !isGmWinner) {
            game.socket.emit("module.cyberpunk-red-agent-os-modified", {
                action: "auctionWon",
                auctionId: auctionId,
                winnerId: auction.highBidderId,
                itemName: auction.name,
                amount: auction.currentBid
            });
        }

        const settlementSuffix = isNpcWinner
            ? " (NPC — manual handoff)"
            : (isGmWinner ? " (GM win — house keeps it)" : "");
        ui.notifications.info(`Agent Auction: "${auction.name}" sold to ${auction.highBidderName} for ${auction.currentBid}eb!${settlementSuffix}`);
        this._auctionView = 'list'; this._auctionDetailId = null;
        this.render(true);
        game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", JSON.stringify(auctions)).then(() => {
            this._pendingAuctionData = null;
            game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
        });
    }
}

globalThis.AgentDeviceApp = globalThis.AgentDeviceApp || {};

Hooks.once('init', async function() {
    globalThis.AgentOSApplication = AgentOSApplication;
    globalThis.AgentDeviceApp.ui = new AgentOSApplication();

    // Preload templates to avoid first-render flash
    await loadTemplates(["modules/cyberpunk-red-agent-os-modified/templates/agent-ui.hbs"]);

    Handlebars.registerHelper('eq', function (a, b) {
        return a === b;
    });

    Handlebars.registerHelper('contains', function (list, item) {
        if (!list || !Array.isArray(list)) return false;
        return list.includes(item);
    });
});

// Auto-refresh when our user's flags change (e.g. GM pushed a shard via setFlag)
Hooks.on('updateUser', (user, changes, options, userId) => {
    if (user.id !== game.user.id) return;
    if (!foundry.utils.hasProperty(changes, "flags.cyberpunk-red-agent-os-modified")) return;
    const app = globalThis.AgentDeviceApp?.ui;
    if (app?.rendered) app.render(true);
});

// Auto-refresh wallet when the actor's eb / flags change (sheet edits, other modules, etc.)
Hooks.on('updateActor', (actor, changes, options, userId) => {
    const app = globalThis.AgentDeviceApp?.ui;
    if (!app?.rendered) return;
    if (actor.uuid !== app.actorUuid) return;
    // Only re-render if something we display actually changed
    const touchesWallet = foundry.utils.hasProperty(changes, "system.wealth")
        || foundry.utils.hasProperty(changes, "system.currency")
        || foundry.utils.hasProperty(changes, "system.derivedStats.hp")
        || foundry.utils.hasProperty(changes, "flags.cyberpunk-red-agent-os-modified");
    if (touchesWallet) app.render(false);
});

// Wire the AUTHORIZE button injected by the chat-fallback. Runs only on GM clients.
// Dedupe via requestId so that (a) the socket-path and the chat-fallback don't
// both execute the same transfer, and (b) two GMs clicking the same card can't
// double-spend.
// Patch3: dedup tracker is now a Map<requestId, timestamp> with a 5-min TTL
// (helpers below) so it can't grow unbounded across long sessions.
globalThis.__AgentDeviceTransfersHandled = globalThis.__AgentDeviceTransfersHandled instanceof Map
    ? globalThis.__AgentDeviceTransfersHandled
    : new Map();
const __XFER_DEDUP_TTL_MS = 5 * 60 * 1000;
function __xferHasHandled(id) {
    if (!id) return false;
    const m = globalThis.__AgentDeviceTransfersHandled;
    const ts = m.get(id);
    if (!ts) return false;
    if (Date.now() - ts > __XFER_DEDUP_TTL_MS) { m.delete(id); return false; }
    return true;
}
function __xferMarkHandled(id) {
    if (!id) return;
    const m = globalThis.__AgentDeviceTransfersHandled;
    m.set(id, Date.now());
    const cutoff = Date.now() - __XFER_DEDUP_TTL_MS;
    for (const [k, v] of m) { if (v < cutoff) m.delete(k); }
}
function __xferUnmark(id) {
    if (!id) return;
    globalThis.__AgentDeviceTransfersHandled.delete(id);
}
Hooks.on('renderChatMessage', (message, html) => {
    if (!game.user.isGM) return;
    if (!message.flags?.["cyberpunk-red-agent-os-modified"]?.isTransferRequest) return;
    html.find('.agent-transfer-authorize').off('click.agentAuth').on('click.agentAuth', async (ev) => {
        ev.preventDefault();
        const btn = $(ev.currentTarget);
        if (btn.prop('disabled')) return;
        const requestId   = String(btn.data('request-id') || "");
        if (__xferHasHandled(requestId)) {
            btn.prop('disabled', true).text("ALREADY AUTHORIZED");
            return;
        }
        btn.prop('disabled', true).text("PROCESSING...");
        const fromUuid    = btn.data('from-uuid');
        const toUuid      = btn.data('to-uuid');
        const amount      = parseInt(btn.data('amount'));
        const memo        = String(btn.data('memo') || "");
        const requesterId = btn.data('requester-id');
        console.log("[Agent OS] Chat-fallback AUTHORIZE clicked", { fromUuid, toUuid, amount, memo, requesterId, requestId });
        const app = globalThis.AgentDeviceApp?.ui;
        if (!app) { ui.notifications.error("Agent OS: app not ready"); btn.prop('disabled', false).text("AUTHORIZE"); return; }
        __xferMarkHandled(requestId);
        const ok = await app._executeTransfer(fromUuid, toUuid, amount, memo || "Player transfer (authorized)");
        if (ok) { btn.text("AUTHORIZED").css({ background: 'rgba(0,255,128,0.15)', color: '#0fa' }); }
        else    {
            __xferUnmark(requestId);
            btn.prop('disabled', false).text("RETRY");
            ui.notifications.error("Agent OS: transfer failed");
        }
    });
});

Hooks.once('ready', function() {
    // Single canonical socket listener for the Agent OS
    game.socket.on("module.cyberpunk-red-agent-os-modified", async (data) => {
        const app = globalThis.AgentDeviceApp?.ui;

        if (data.action === "agentTyping" || data.action === "agentTypingStop") {
            if (app) app._handleTypingEvent(data, data.action === "agentTypingStop");
            return;
        }
        // Patch3.2 round 2: holophone animation sync. Every client (including
        // non-GMs and observers) runs its own local sequence so each one uses
        // its own JB2A asset availability rather than the originator's.
        if (data.action === "holophoneStart") {
            if (app) {
                try { app._runHolophoneCallAnimLocal(data.tokenId); } catch (e) { console.warn("[Agent OS] holophone local start failed:", e); }
            }
            return;
        }
        if (data.action === "holophoneStop") {
            if (app) {
                try { app._runHolophoneCallAnimStopLocal(data.tokenId); } catch (e) { console.warn("[Agent OS] holophone local stop failed:", e); }
            }
            return;
        }
        if (data.action === "refreshOnlineStatus") {
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "refreshSkin") {
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "shardDelivered") {
            // GM pushed a shard — if this client is a target, re-render + notify.
            // Delay render to let Foundry's own flag update propagate first.
            if (Array.isArray(data.targetUserIds) && data.targetUserIds.includes(game.user.id)) {
                ui.notifications.info("Agent Data: New data shard received in your DataPool.");
                setTimeout(() => { if (app?.rendered) app.render(true); }, 1500);
            }
            return;
        }
        if (data.action === "refreshApps") {
            if (app?.rendered && (!data.actorUuid || app.actorUuid === data.actorUuid)) {
                app.render(true);
            }
            return;
        }
        if (data.action === "socialFeedAppend") {
            if (!game.user.isGM) return;
            console.log("[Agent OS] socialFeedAppend received:", data);
            const raw = game.settings.get("cyberpunk-red-agent-os-modified", "socialFeedArticles");
            let list = [];
            try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
            // Validate + whitelist the entry. Identity is taken from the entry's
            // claimed authorId but cross-checked against an active user; if the
            // claimed author isn't an active session the post is dropped.
            const e = data.entry || {};
            const text = String(e.text || "").slice(0, 2000).trim();
            const category = String(e.category || "Post").slice(0, 60).trim() || "Post";
            const claimedAuthor = game.users.get(e.authorId);
            if (!text || !claimedAuthor || !claimedAuthor.active) {
                console.warn("[Agent OS] socialFeedAppend dropped — invalid text or author");
                return;
            }
            const safeEntry = {
                id: "feed_" + foundry.utils.randomID(),
                category,
                text,
                authorId: claimedAuthor.id,
                authorName: (claimedAuthor.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || claimedAuthor.name,
                timestamp: Date.now()
            };
            list.push(safeEntry);
            await game.settings.set("cyberpunk-red-agent-os-modified", "socialFeedArticles", JSON.stringify(list));
            return;
        }
        if (data.action === "socialFeedDelete") {
            console.log("[Agent OS] socket received socialFeedDelete", data);
            if (!game.user.isGM) return;
            const raw = game.settings.get("cyberpunk-red-agent-os-modified", "socialFeedArticles");
            let list = [];
            try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
            const entry = list.find(e => e.id === data.postId);
            if (!entry) { console.warn("[Agent OS] socialFeedDelete: entry not found", data.postId); return; }
            // Author check: only the original poster or any GM can delete
            if (entry.authorId !== data.requesterId) {
                console.warn("[Agent OS] socialFeedDelete: requester is not the author", { requesterId: data.requesterId, authorId: entry.authorId });
                return;
            }
            const next = list.filter(e => e.id !== data.postId);
            await game.settings.set("cyberpunk-red-agent-os-modified", "socialFeedArticles", JSON.stringify(next));
            console.log("[Agent OS] socialFeedDelete: post removed", data.postId);
            return;
        }
        if (data.action === "storeCheckout") {
            if (!game.user.isGM) return;
            console.log("[Agent OS] storeCheckout received:", data);
            const actor = fromUuidSync(data.actorUuid);
            if (!(actor instanceof Actor)) {
                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: target actor not found." });
                return;
            }
            const senderUser = game.users.get(data.requesterId);
            if (!senderUser || !actor.testUserPermission(senderUser, "OWNER")) {
                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: requester does not own target actor." });
                return;
            }
            // Re-validate amount + balance on the server
            const total = Number(data.total);
            if (!Number.isFinite(total) || total <= 0) {
                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: invalid total." });
                return;
            }
            const balance = app._getActorEurobucks(actor).balance;
            if (balance < total) {
                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: insufficient funds on server." });
                return;
            }
            // Patch3.2: enforce GM gates server-side too — a stale cached
            // catalog or hand-crafted socket payload can't bypass the cap/blacklist.
            try {
                const maxPrice  = Number(game.settings.get("cyberpunk-red-agent-os-modified", "storeMaxPrice")) || 0;
                const blacklist = String(game.settings.get("cyberpunk-red-agent-os-modified", "storeBlacklistIds") || "");
                const blockedSet = new Set(blacklist.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean));
                const cart = Array.isArray(data.cart) ? data.cart : [];
                for (const ci of cart) {
                    if (maxPrice > 0 && Number(ci.price) > maxPrice) {
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: `Store: "${ci.name}" exceeds the GM's price cap (${maxPrice}eb).` });
                        return;
                    }
                    if (blockedSet.size) {
                        const uuidLc = String(ci.uuid || "").toLowerCase();
                        const nameLc = String(ci.name || "").toLowerCase();
                        if (blockedSet.has(uuidLc) || blockedSet.has(nameLc)) {
                            game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: `Store: "${ci.name}" is blacklisted by the GM.` });
                            return;
                        }
                    }
                }
            } catch (e) { console.warn("[Agent OS] Store gate enforcement failed:", e); }
            await app._processCheckout(actor, data.cart || [], total, (senderUser.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || senderUser.name);
            return;
        }
        if (data.action === "transferRequest") {
            console.log("[Agent OS] socket received transferRequest event (any client)", data);
            // Only the GM client validates and executes player-initiated transfers.
            if (!game.user.isGM) {
                console.log("[Agent OS] transferRequest ignored — not GM client");
                return;
            }
            // Dedup against chat-fallback path so we don't double-spend.
            // Patch3: uses TTL-backed helpers so the dedup map self-prunes.
            const _reqId = String(data.requestId || "");
            if (__xferHasHandled(_reqId)) {
                console.log("[Agent OS] transferRequest already handled — skipping", _reqId);
                return;
            }
            console.log("[Agent OS] transferRequest received on GM client:", data);
            const _amt = Number(data.amount);
            if (!Number.isFinite(_amt) || _amt <= 0) {
                console.warn("[Agent OS] transferRequest rejected — invalid amount");
                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.fromUuid, message: "Invalid transfer amount." });
                return;
            }
            __xferMarkHandled(_reqId);
            const senderUser = game.users.get(data.requesterId);
            if (!senderUser) {
                console.warn("[Agent OS] transferRequest: requester not found", data.requesterId);
                return;
            }
            // Verify the requester actually owns the source. Trust either:
            //   (a) their identity matches data.fromUuid (e.g., their character or virtual wallet), OR
            //   (b) explicit OWNER permission on the source actor.
            const claimedIdentity = app._getIdentity(senderUser);
            const srcActor = (data.fromUuid && !data.fromUuid.startsWith("User.") && data.fromUuid !== "VirtualWallet")
                ? fromUuidSync(data.fromUuid) : null;
            const identityMatches = (claimedIdentity === data.fromUuid);
            const hasOwnership = srcActor && srcActor.testUserPermission(senderUser, "OWNER");
            if (!identityMatches && !hasOwnership) {
                console.warn("[Agent OS] transferRequest denied — identity mismatch", { claimedIdentity, fromUuid: data.fromUuid });
                game.socket.emit("module.cyberpunk-red-agent-os-modified", {
                    action: "errorResult",
                    actorUuid: data.fromUuid,
                    message: "Transfer denied: requester does not own the source account."
                });
                return;
            }
            const senderDisplayName = (senderUser.getFlag("cyberpunk-red-agent-os-modified", "idOverrides")?.handle) || senderUser.name;
            const _escTr = (s) => (foundry.utils.escapeHTML
                ? foundry.utils.escapeHTML(String(s ?? ""))
                : String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
            ui.notifications.info(`Agent Bank: ${senderDisplayName} → ${Number(data.amount)}eb transfer authorizing...`);
            ChatMessage.create({
                content: `<i style="color:#888;">Agent OS: Routing transferRequest from ${_escTr(senderDisplayName)} (${Number(data.amount)}eb)</i>`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id),
                flags: { "cyberpunk-red-agent-os-modified": { isAgentMessage: false, isTransferTrace: true } }
            });
            const ok = await app._executeTransfer(data.fromUuid, data.toUuid, data.amount, data.memo || "Player transfer");
            console.log("[Agent OS] _executeTransfer result:", ok);
            if (!ok) {
                console.warn("[Agent OS] _executeTransfer returned false");
                game.socket.emit("module.cyberpunk-red-agent-os-modified", {
                    action: "errorResult",
                    actorUuid: data.fromUuid,
                    message: "Transfer failed on the server."
                });
            }
            return;
        }
        if (data.action === "transferConfirmed") {
            // Reset any 'PROCESSING' buttons in the chat log
            $('.p2p-confirm-transfer:contains("PROCESSING"), .nfc-confirm-deduct:contains("PROCESSING")')
                .text("HANDSHAKE COMPLETE").prop('disabled', true);

            if (app) {
                const myId = app.actorUuid;
                const isRecipient = (myId === data.receiverUuid);
                const isSender = (myId === data.senderUuid);
                if (isRecipient || isSender) {
                    ui.notifications.info(`Agent OS: Transaction Confirmed (${data.amount}eb).`);
                    console.log(`[Agent OS] Post-sync render for ${myId}. Balances: S:${data.senderBalance} R:${data.receiverBalance}`);
                    setTimeout(() => app.render(true), 800);
                }
            }
            return;
        }
        if (data.action === "errorResult") {
            $('.p2p-confirm-transfer:contains("PROCESSING"), .nfc-confirm-deduct:contains("PROCESSING")')
                .text("RETRY").prop('disabled', false);
            if (app && app.actorUuid === data.actorUuid) {
                ui.notifications.error(`Agent OS: ${data.message}`);
                if (app.rendered) app.render(true);
            }
            return;
        }
        // --- AUCTION SOCKET HANDLERS ---
        if (data.action === "auctionBid") {
            if (!game.user.isGM) return;
            // Patch3: bidder identity check. Foundry sockets don't carry a sender
            // userId, but the client includes both `bidderId` and `requesterId`.
            // Require them to match and to map to an active user. Stops a client
            // from impersonating another player on a bid.
            if (!data.bidderId || data.bidderId !== data.requesterId) {
                console.warn("[Agent OS] auctionBid rejected — bidderId/requesterId mismatch", data);
                return;
            }
            const _bidderUser = game.users.get(data.bidderId);
            if (!_bidderUser || !_bidderUser.active) {
                console.warn("[Agent OS] auctionBid rejected — bidder not an active user", data.bidderId);
                return;
            }
            // Serialize concurrent bids — read-modify-write on a JSON setting is
            // not atomic, so chain bids on a single promise to avoid losing them
            // when two players bid in the same tick.
            globalThis.__AgentDeviceBidLock = (globalThis.__AgentDeviceBidLock || Promise.resolve())
                .then(async () => {
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("cyberpunk-red-agent-os-modified", "auctionListings") || "[]"); } catch(e) {}
                    const auc = auctions.find(a => a.id === data.auctionId);
                    if (!auc) return;
                    if (auc.settled || (auc.endTime && Date.now() > auc.endTime)) {
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: "Auction has ended." });
                        return;
                    }
                    // Coerce + validate the bid increment. Earlier versions used `||`
                    // which let string "50" through and produced string concatenation
                    // ("100" + "50" = "10050") instead of an integer add.
                    const bidIncrement = Number(data.bidIncrement ?? data.bidAmount);
                    if (!Number.isFinite(bidIncrement) || bidIncrement <= 0) {
                        game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: "Invalid bid amount." });
                        return;
                    }
                    const currentBid = Number(auc.currentBid) || 0;
                    const newTotal = currentBid + bidIncrement;
                    // Validate bidder has funds for the NEW TOTAL (skip if app not open)
                    const bidder = game.users.get(data.bidderId);
                    if (!bidder) return;
                    if (app) {
                        const bidderIdentity = app._getIdentity(bidder);
                        const bidderActor = app._resolveActor(bidderIdentity);
                        if (bidderActor) {
                            const bal = Number(app._getActorEurobucks(bidderActor).balance) || 0;
                            if (bal < newTotal) {
                                game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "errorResult", actorUuid: data.actorUuid, message: `Insufficient funds. Need ${newTotal}eb, have ${bal}eb.` });
                                return;
                            }
                        }
                    }
                    auc.currentBid = newTotal;
                    auc.highBidderId = data.bidderId;
                    auc.highBidderName = String(data.bidderName || bidder.name).slice(0, 60);
                    auc.bidCount = (Number(auc.bidCount) || 0) + 1;
                    // Optimistic UI: render with local data immediately, then persist
                    if (app) app._pendingAuctionData = auctions;
                    ui.notifications.info(`Agent Auction: ${auc.highBidderName} +${bidIncrement}eb on "${auc.name}" — now ${newTotal}eb.`);
                    if (app?.rendered) app.render(true);
                    await game.settings.set("cyberpunk-red-agent-os-modified", "auctionListings", JSON.stringify(auctions));
                    if (app) app._pendingAuctionData = null;
                    game.socket.emit("module.cyberpunk-red-agent-os-modified", { action: "auctionRefresh" });
                })
                .catch(err => console.error("[Agent OS] auctionBid handler failed:", err));
            return;
        }
        if (data.action === "auctionRefresh") {
            if (app) app._pendingAuctionData = null; // clear optimistic cache, server is authoritative now
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "groupInviteRelay") {
            // Patch5.0.1: relay from a non-GM creator. GM has permission to
            // setFlag on other users' customContacts. Push the group entry
            // onto every player member's contact list, skipping anyone who
            // already has it.
            if (!game.user.isGM) return;
            try {
                const group = data.group;
                if (!group?.id || !Array.isArray(group.members)) return;
                for (const m of group.members) {
                    if (!m.startsWith("player:")) continue;
                    const uid = m.slice("player:".length);
                    const u = game.users.get(uid);
                    if (!u) continue;
                    if (u.id === data.requestingUserId) continue; // creator already has it
                    const theirs = u.getFlag("cyberpunk-red-agent-os-modified", "customContacts") || [];
                    if (!theirs.some(c => c.id === group.id)) {
                        theirs.push({ ...group });
                        await u.setFlag("cyberpunk-red-agent-os-modified", "customContacts", theirs);
                    }
                }
            } catch (err) {
                console.error("[Agent OS] groupInviteRelay failed:", err);
            }
            return;
        }
        if (data.action === "clockUpdate") {
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "auctionWon") {
            if (data.winnerId === game.user.id) {
                ui.notifications.info(`Agent Auction: You won "${data.itemName}" for ${data.amount}eb! Collect from the GM.`);
            }
            if (app?.rendered) app.render(true);
            return;
        }
    });
});

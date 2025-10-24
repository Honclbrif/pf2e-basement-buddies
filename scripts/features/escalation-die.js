import { MODULE_ID, SETTING_KEYS } from "../settings.js";
import { logger } from "../logger.js";

let _combatHookId = null;

// === CONSTANTS ===
const EFFECT_NAME = "Escalation Die!";
const MAX_BONUS = 5;
const SELECTORS = ["strike-attack-roll", "spell-attack-roll", "spell-dc"];
const STATE_KEY = "pf2eEscalation"; // namespace on game
const DEFAULT_SHOW_PLUS_LABELS = true; // if false, no badge shown at all
const FORMULA = (round) => Math.min(MAX_BONUS, Math.max(0, Math.max(1, round) - 1));

// Effect prototype (untyped FlatModifier; selectors in one rule)
const EFFECT_DATA = {
    name: EFFECT_NAME,
    type: "effect",
    img: "icons/magic/time/hourglass-yellow-green.webp",
    system: {
        duration: { unit: "encounter", value: null, sustained: false, expiry: "turn-start" },
        rules: [
            {
                key: "FlatModifier",
                selector: SELECTORS,
                value: 0 // overwritten by hook updates
            }
        ],
        badge: null, // set on install if showing labels
        tokenIcon: { show: false } // hide effect icon on tokens
    }
};

// === HOOKS ===
function registerHooks() {
    logger.debug("ED: registerHooks:start");
    const hooks = {};

    // Post-update guard: revert any non‑GM badge change that slips through
    hooks.updateItem = Hooks.on("updateItem", async (item, change, options, userId) => {
        // Only our effect
        const isEffect = item?.type === "effect" || item?.isOfType?.("effect");
        if (!isEffect || item?.name !== EFFECT_NAME) return;
        if (options?.[STATE_KEY]?.revert) return; // avoid loops from our own revert

        // Allow GMs; only guard players
        const user = game.users.get(userId);
        if (user?.isGM) return;

        // Did the change touch the badge?
        const flat = foundry.utils.flattenObject(change ?? {});
        const touchedBadge = (change?.system && Object.prototype.hasOwnProperty.call(change.system, "badge"))
            || Object.keys(flat).some(k => k.startsWith("system.badge"));
        if (!touchedBadge) return;

        // Snap back to the macro-controlled value
        const round = game.combat?.round ?? 1;
        const value = FORMULA(round);
        const newBadge = badgeObject(value); // null at 0 (Option A)
        try {
            await item.update({ "system.badge": newBadge }, { [STATE_KEY]: { revert: true } });
        } catch (e) { /* no-op */ }
    });

    // Prevent non‑GM deletion of this effect (but allow our own cleanup/uninstall)
    hooks.preDeleteItem = Hooks.on("preDeleteItem", (item, options, userId) => {
        const isEffect = item?.type === "effect" || item?.isOfType?.("effect");
        if (!isEffect || item?.name !== EFFECT_NAME) return;
        const user = game.users.get(userId);
        if (user?.isGM) return; // GM can delete
        if (options?.[STATE_KEY]?.cleanup) return; // our scripted cleanup
        return false; // block player deletion
    });

    hooks.createCombat = Hooks.on("createCombat", async (combat) => {
        const scene = getSceneById(combat.scene ?? combat.sceneId);
        await updateForScene(scene);
    });

    hooks.updateCombat = Hooks.on("updateCombat", async (combat, changed) => {
        if ("round" in changed || "turn" in changed) await updateForScene(getSceneById(combat.scene ?? combat.sceneId));
    });

    hooks.deleteCombat = Hooks.on("deleteCombat", async (combat) => {
        const scene = getSceneById(combat.scene ?? combat.sceneId);
        if (foundry?.utils?.sleep) { await foundry.utils.sleep(150); } else { await new Promise((r) => setTimeout(r, 150)); }
        await removeEffectsFromScene(scene, combat);
    });

    hooks.createToken = Hooks.on("createToken", () => updateForScene(canvas.scene));
    hooks.deleteToken = Hooks.on("deleteToken", () => updateForScene(canvas.scene));
    hooks.updateToken = Hooks.on("updateToken", () => updateForScene(canvas.scene));

    return hooks;
}

export async function installEscalationDie(showPlusLabels) {
    logger.debug("ED: installEscalationDie(" + showPlusLabels + ")");

    game[STATE_KEY] ??= {};
    game[STATE_KEY].settings = { showPlusLabels: !!showPlusLabels };
    EFFECT_DATA.system.badge = badgeObject(0); // initialize for new creations

    await updateForScene(canvas.scene);
    if (!game[STATE_KEY].hooks) game[STATE_KEY].hooks = registerHooks();

    if (!game[STATE_KEY].installed) {
        game[STATE_KEY].installed = true;
        ui.notifications?.info(game.i18n.localize("PF2EBB.Notif.ED.On"));
    }
}

export async function uninstallEscalationDie() {
    logger.debug("ED: uninstallEscalationDie(");

    const state = game[STATE_KEY];
    if (state?.hooks) { for (const [event, id] of Object.entries(state.hooks)) { Hooks.off(event, id); } }
    // Proactive removal outside of combat (safe; no PF2e expiry races)
    const scene = canvas.scene;
    for (const td of tokenDocsOnScene(scene)) {
        const actor = td.actor; if (!actor) continue;
        const ids = actor.items.filter(i => i.type === "effect" && i.name === EFFECT_NAME).map(i => i.id);
        if (ids.length) {
            try { await actor.deleteEmbeddedDocuments("Item", ids, { strict: false, [STATE_KEY]: { cleanup: true } }); } catch (e) {
                logger.debug("uninstall cleanup", e);
            }
        }
    }
    delete game[STATE_KEY];
    ui.notifications?.info(game.i18n.localize("PF2EBB.Notif.ED.Off"));
}

function migrateSettings(old) {
    if (!old) return { showPlusLabels: DEFAULT_SHOW_PLUS_LABELS };
    if ("showPlusLabels" in old) return old; // already new format
    if ("showBadge" in old) {                 // migrate from two-checkbox version
        const showPlusLabels = !!old.showBadge && !!old.plusBadge;
        return { showPlusLabels };
    }
    return { showPlusLabels: DEFAULT_SHOW_PLUS_LABELS };
}

function getSettings() {
    const raw = game[STATE_KEY]?.settings;
    return migrateSettings(raw);
}

function badgeObject(value) {
    logger.debug("ED: badgeObject:start");
    const { showPlusLabels } = getSettings();
    if (!showPlusLabels) return null;
    if (value <= 0) return null;                 // ← hide at 0 to avoid auto-remove
    return { type: "counter", value, labels: makeLabels() };
}

function isEligibleActor(actor) {
    if (!actor) return false;
    if (actor.type === "character" || actor.type === "eidolon") return true;
    const traits = actor.system?.traits?.value ?? [];
    return actor.type === "npc" && Array.isArray(traits) && traits.includes("eidolon");
}
function makeLabels() {
    // PF2e maps labels[0] → counter value 1, labels[1] → 2, etc.
    return Array.from({ length: MAX_BONUS }, (_, i) => `+${i + 1}`);
}
function getSceneById(sceneId) {
    logger.debug("ED: getSceneById:start"); return (typeof sceneId === "string") ? game.scenes.get(sceneId) : (sceneId ?? canvas.scene);
}
function tokenDocsOnScene(scene) {
    logger.debug("ED: tokenDocsOnScene:start"); return (scene?.tokens?.contents ?? []).filter(td => isEligibleActor(td.actor));
}
function tokenIdsInCombat(combat) {
    logger.debug("ED: tokenIdsInCombat:start"); return new Set((combat?.combatants ?? []).map(c => c?.token?.id ?? c?.tokenId).filter(Boolean));
}
async function ensureEffect(actor) {
    logger.debug("ED: ensureEffect:start");
    let effect = actor.items.find((i) => i.type === "effect" && i.name === EFFECT_NAME);
    if (effect) return effect;
    const created = await actor.createEmbeddedDocuments("Item", [EFFECT_DATA]);
    return created?.[0] ?? null;
}
async function applyBonus(actor, round) {
    logger.debug("ED: applyBonus:start");
    const effect = await ensureEffect(actor);
    if (!effect) return;

    const rules = foundry.utils.duplicate(effect.system.rules ?? []);
    let changed = false;

    for (const rule of rules) {
        if (rule.key !== "FlatModifier") continue;
        const sels = Array.isArray(rule.selector) ? rule.selector : [rule.selector];
        const hasAll = SELECTORS.every((s) => sels.includes(s));
        if (!hasAll) continue;
        const newVal = FORMULA(round);
        if (rule.value !== newVal) { rule.value = newVal; changed = true; }
    }

    const badgeVal = FORMULA(round);
    const desiredBadge = badgeObject(badgeVal); // null if disabled
    const currentBadge = effect.system.badge ?? null;

    const updateData = { "system.rules": rules };
    // Ensure the token overlay icon stays hidden even on existing effects
    if (effect.system?.tokenIcon?.show !== false) updateData["system.tokenIcon.show"] = false;
    if (JSON.stringify(currentBadge) !== JSON.stringify(desiredBadge)) updateData["system.badge"] = desiredBadge, changed = true;

    if (changed) await effect.update(updateData);
}
async function updateForScene(scene) {
    logger.debug("ED: updateForScene:start");
    if (!scene) return;
    const round = game.combat?.round ?? 1;
    for (const td of tokenDocsOnScene(scene)) {
        try { await applyBonus(td.actor, round); } catch (e) { logger.debug("applyBonus error", e); }
    }
}
async function removeEffectsFromScene(scene, combat) {
    logger.debug("ED: removeEffectsFromScene:start");
    if (!scene) return;
    const inTracker = tokenIdsInCombat(combat);
    for (const td of tokenDocsOnScene(scene)) {
        if (inTracker.has(td.id)) continue; // PF2e will expire these automatically
        const actor = td.actor; if (!actor) continue;
        const ids = actor.items.filter(i => i.type === "effect" && i.name === EFFECT_NAME).map(i => i.id);
        if (!ids.length) continue;
        try {
            logger.debug(`Cleanup removing ${ids.length} effect(s) from non-combatant`, actor.name, ids);
            await actor.deleteEmbeddedDocuments("Item", ids, { strict: false, [STATE_KEY]: { cleanup: true } });
        } catch (e) { logger.debug("removeEffectsFromScene (non-combatant) error", e); }
    }
}

export function setEscalationDieActive(enabled) {
    if (enabled) enableEscalationDieAuto();
    else disableEscalationDieAuto();
}

export function enableEscalationDieAuto() {
    logger.debug("ED: enableEscalationDieAuto:start");
    const show = game.settings.get(MODULE_ID, SETTING_KEYS.escalationDieShowBadge);
    return installEscalationDie(!!show);
}


export function disableEscalationDieAuto() {
    logger.debug("ED: disableEscalationDieAuto:start");
    return uninstallEscalationDie();
}

import { MODULE_ID, SETTING_KEYS } from "../settings.js";
import { logger } from "../logger.js";

// === CONSTANTS ===
const EFFECT_NAME = "Escalation Die!";
const MAX_BONUS = 5;
const SELECTORS = ["strike-attack-roll", "spell-attack-roll", "spell-dc"];
const STATE_KEY = "pf2eEscalation"; // namespace on game

let _edHooks = null;

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
                type: "untyped",
                value: "@item.badge.value"  // <-- reads directly from the badge counter
            }
        ],
        badge: null,                        // set/updated by the hook each round
        tokenIcon: { show: false }          // keep hidden on tokens
    }
};

// === HOOKS ===
function registerHooks() {
    logger.debug("ED: registerHooks:start");
    if (_edHooks) {
        logger.warn("ED: Hooks already installed");
        return;
    }

    _edHooks = {};

    // On combat creation (round starts at 1). Ensure no effect at start.
    _edHooks.createCombat = Hooks.on("createCombat", (combat) => {
        logger.debug("ED: createCombat");
        trySyncEscalationDieForCombat(combat, combat?.round ?? 1);
    });

    // On round change, adjust all combatants.
    _edHooks.updateCombat = Hooks.on("updateCombat", (combat, changed) => {
        logger.debug("ED: updateCombat", changed);
        if (Object.hasOwn(changed, "round")) {
            logger.debug("ED: updateCombat");
            trySyncEscalationDieForCombat(combat, combat.round ?? 1);
        }
    });

    // when a combatant is added mid-encounter, sync just that actor
    _edHooks.createCombatant = Hooks.on("createCombatant", (combatant, options, userId) => {
        const combat = combatant?.parent;
        const actor = combatant?.actor;
        if (!combat || !isEligibleActor(actor)) return;
        const value = escalationValueFromRound(combat.round ?? 1);
        logger.debug("ED: createCombatant → sync", actor?.name, "value", value);
        // no await (don’t block the hook), but safe to await if you prefer
        syncActorEscalationEffect(actor, value);
    });

    // when a combatant is removed, drop the effect only if that actor no longer appears in this combat
    _edHooks.deleteCombatant = Hooks.on("deleteCombatant", (combatant, options, userId) => {
        const combat = combatant?.parent;
        const actor = combatant?.actor;
        if (!combat || !isEligibleActor(actor)) return;

        // If the actor still has another token in this combat, keep the effect.
        const stillPresent = combat.combatants.some(c => c.actor?.id === actor.id);
        logger.debug("ED: deleteCombatant", actor?.name, "stillPresent?", stillPresent);

        if (!stillPresent) {
            // sync to 0 → our sync function will delete the effect
            syncActorEscalationEffect(actor, 0);
        }
    });

    // // On combat deletion, remove the effect from participants of that combat.
    // // pf2e delete the effect automatically on end of combat
    // Hooks.on("deleteCombat", (combat) => {
    //     logger.debug("ED: deleteCombat");
    //     trySyncEscalationDieForCombat(combat, 0);
    // });

    // Disallow manual edits of the badge by users; allow our own programmatic updates.
    _edHooks.preUpdateItem = Hooks.on("preUpdateItem", (item, change, options, userId) => {
        if (!(item?.parent instanceof Actor)) return;
        if (item.type !== "effect" || item.name !== EFFECT_NAME) return;
        logger.debug("ED: preUpdateItem");

        // Allow our own updates (we set this option when updating).
        if (options?.[MODULE_ID]?.edManaged === true) return;

        //  Allow GM to alter (for testing)
        const user = game.users.get(userId);
        if (user?.isGM) return;

        // If someone tries to change the badge or hide the icon, block it.
        const touchesBadge = "system" in change && "badge" in (change.system ?? {});
        const touchesIcon = "system" in change && "tokenIcon" in (change.system ?? {});
        if (touchesBadge || touchesIcon) {
            ui.notifications?.warn("Escalation Die is managed automatically.");
            return false;
        }
    });
}

export async function installEscalationDie() {
    logger.debug("ED: installEscalationDie");

    registerHooks();

    trySyncEscalationDieForCombat(game.combat, game.combat?.round ?? 1);

    //ui.notifications?.info(game.i18n.localize("PF2EBB.Notif.ED.On"));
}

export async function uninstallEscalationDie() {
    logger.debug("ED: uninstallEscalationDie");

    trySyncEscalationDieForCombat(game.combat, 0);

    if (_edHooks) {
        for (const [event, id] of Object.entries(_edHooks)) {
            Hooks.off(event, id);
        }
    }

    _edHooks = null;
    //ui.notifications?.info(game.i18n.localize("PF2EBB.Notif.ED.Off"));
}

/** Compute +N from round (0 at round 1, +1 at round 2, capped). */
function escalationValueFromRound(round) {
    const r = Math.max(0, Number(round) | 0);
    if (r <= 1) return 0;
    return Math.min(MAX_BONUS, r - 1);
}

function isEligibleActor(actor) {
    if (!actor) return false;
    if (actor.type === "character" || actor.type === "eidolon") return true;
    const traits = actor.system?.traits?.value ?? [];
    return actor.type === "npc" && Array.isArray(traits) && traits.includes("eidolon");
}

/** Core sync: enforce desired state for all combatants based on the current round. */
async function trySyncEscalationDieForCombat(combat, round) {
    if (!combat) return;
    const value = escalationValueFromRound(round); // 0 for r<=1, 1..MAX for r>=2
    const promises = [];

    for (const c of combat.combatants) {
        const actor = c?.actor;
        if (!isEligibleActor(actor)) continue;
        promises.push(syncActorEscalationEffect(actor, value));
    }

    try {
        await Promise.allSettled(promises);
    } catch (err) {
        console.error(`[${MODULE_ID}] Escalation sync error`, err);
    }
}

/** Ensure the actor has the correct effect state for the current value. */
async function syncActorEscalationEffect(actor, value) {
    const effect = findEscalationEffect(actor);

    // No effect in round 1 (value 0): remove if present.
    if (value === 0) {
        if (effect) {
            await effect.delete();
        }
        return;
    }

    if (!effect) {
        // Create new effect with the correct initial badge value.
        const data = buildEffectData(value);
        try {
            const created = await actor.createEmbeddedDocuments("Item", [data], { [MODULE_ID]: { edManaged: true } });
            return created?.[0];
        } catch (err) {
            console.error(`[${MODULE_ID}] Failed to create Escalation Die on ${actor.name}`, err);
            return;
        }
    }

    // Update existing effect's badge (and ensure token icon is visible).
    const currentVal = Number(effect.system?.badge?.value ?? 0);
    const showIcon = !!effect.system?.tokenIcon?.show;

    // Only update if something changed.
    if (currentVal !== value || !showIcon) {
        const updateData = {
            _id: effect.id,
            "system.badge": { type: "counter", value },
            "system.tokenIcon.show": true,
        };
        try {
            await actor.updateEmbeddedDocuments("Item", [updateData], { [MODULE_ID]: { edManaged: true } });
        } catch (err) {
            console.error(`[${MODULE_ID}] Failed to update Escalation Die on ${actor.name}`, err);
        }
    }
}

/** Find the escalation effect on an actor. */
function findEscalationEffect(actor) {
    return actor.items.find((i) => i.type === "effect" && i.name === EFFECT_NAME) ?? null;
}

/** Build a fresh effect document (badge visible + FlatModifier reads @item.badge.value). */
function buildEffectData(value) {
    return {
        name: EFFECT_NAME,
        type: "effect",
        img: "icons/magic/time/hourglass-yellow-green.webp",
        system: {
            level: { value: 0 },
            duration: { unit: "encounter", value: null, sustained: false, expiry: "turn-start" },
            start: { value: 0, initiative: null },
            // Always show the numeric counter; no labels / no plus prefix.
            badge: { type: "counter", value },
            tokenIcon: { show: true },
            rules: [
                {
                    key: "FlatModifier",
                    selector: SELECTORS,
                    type: "untyped",
                    // Pull directly from the visible counter badge
                    value: "@item.badge.value",
                },
            ],
        },
        flags: {
            core: { sourceId: null },
            [MODULE_ID]: { edManaged: true },
        },
    };
}

// scripts/features/nudge-fate.js
import { MODULE_ID } from "../settings.js";
import { logger } from "../logger.js";

const FEATURE_ID = "NF:";
const EFFECT_NAME = "Effect: Nudge Fate";
const EFFECT_ICON = "icons/magic/control/buff-luck-fortune-green.webp";

// Keep a handle so we can unhook cleanly
let _nfHooks = null;

export function installNudgeFate() {
    if (_nfHooks) return;

    _nfHooks = {};
    _nfHooks.renderChatMessage = Hooks.on("renderChatMessage", onRenderChatMessage);

    logger.log(FEATURE_ID, "installNudgeFate");
}

export function uninstallNudgeFate() {
    if (_nfHooks) {
        for (const [event, id] of Object.entries(_nfHooks)) {
            Hooks.off(event, id);
        }
    }
    _nfHooks = null;
    logger.log(FEATURE_ID, "uninstallNudgeFate");
}
async function markNudgeFateUsed(message, { actor, from, to }) {
    logger.debug(FEATURE_ID, "markNudgeFateUsed:", actor.name, from, to);
    const payload = {
        used: true,
        when: Date.now(),
        userId: game.user.id,
        actorUuid: actor?.uuid ?? null,
        from, to,
    };

    // Try to set the flag directly
    try {
        await message.setFlag(MODULE_ID, "nudgeFate", payload);
    } catch (err) {
        logger.error(FEATURE_ID, "setFlag fail:", err)
        // Non-author players often can’t update others’ messages: ask the GM to do it.
        game.socket.emit(`module.${MODULE_ID}`, {
            action: "setNudgeFateFlag",
            messageId: message.id,
            payload,
        });
    }
}
function bumpDegree(dos) {
    const order = ["criticalFailure", "failure", "success", "criticalSuccess"];
    const i = Math.max(0, order.indexOf(dos));
    return order[Math.min(order.length - 1, i + 1)];
}
function hasEffect(actor) {
    return !!actor?.items?.some(i => i.type === "effect" && i.name === EFFECT_NAME);
}
async function hasExistingStatusBonus(message) {
    const roll = message?.rolls?.[0];
    if (!roll) return false;

    // Try several places PF2e may expose modifiers in structured form
    const candidateArrays = [
        message?.flags?.pf2e?.modifiers,
        message?.flags?.pf2e?.context?.modifiers,
        roll?.options?.modifiers,
        roll?.modifiers,
    ].filter(Array.isArray);

    for (const arr of candidateArrays) {
        if (arr.some(m =>
            !m?.ignored &&
            m?.type === "status" &&
            Number(m.value ?? m.modifier ?? 0) > 0
        )) {
            return true;
        }
    }

    // Fallback: parse the tooltip for a "status" line with a +N
    try {
        const tip = await roll.getTooltip();
        const div = document.createElement("div");
        div.innerHTML = tip;

        // Common PF2e markup patterns for typed modifiers
        const statusElems = [
            ...div.querySelectorAll('[data-type="status"], [data-modifier-type="status"], .tag.status, .status')
        ];

        // Prefer explicit rows if we can find them…
        for (const el of statusElems) {
            const txt = (el.textContent || "").toLowerCase();
            if (/\+\s*\d+/.test(txt)) return true; // positive status bonus
        }

        // …otherwise, heuristic: any "status" mention with a +N somewhere in the tooltip
        const allTxt = (div.textContent || "").toLowerCase();
        if (allTxt.includes("status") && /\+\s*\d+/.test(allTxt)) return true;
    } catch {
        /* ignore */
    }

    return false;
}
function wouldImprove(total, dc, message) {
    if (!Number.isFinite(total) || !Number.isFinite(dc)) return false;

    // Guard: if this was a natural 1, +1 can't overcome the degree drop.
    // (Find the first d20 result on the first roll.)
    const r = message?.rolls?.[0];
    const nat = r?.dice?.find(d => d?.faces === 20)?.results?.[0]?.result;
    if (nat === 1) return false;

    const diff = total - dc;
    return diff === -1 || diff === -10; // fail→success or crit-fail→fail
}
async function consumeEffect(actor) {
    const eff = actor.items.find(i => i.type === "effect" && i.name === EFFECT_NAME);
    if (eff) await actor.deleteEmbeddedDocuments("Item", [eff.id]);
}


async function onRenderChatMessage(message, $html) {
    if ($html[0].querySelector("nudge-fate-controls")) return;

    const ctx = message?.flags?.pf2e?.context ?? {};
    const sel = ctx?.type;
    if (!["attack-roll", "skill-check", "saving-throw"].includes(sel)) return;

    const actor = game.actors?.get(ctx?.actorId) ?? message?.actor;
    if (!actor) return;

    // Only owners/GM can see and use the button
    if (!(game.user.isGM || actor.isOwner)) return;

    // Must currently have the effect
    if (!hasEffect(actor)) return;

    // Only show the button if it WOULD help on this roll
    const dc = ctx?.dc?.value ?? null;
    const total = Number(message?.rolls?.[0]?.total);
    if (!wouldImprove(total, dc, message)) return;

    //If there is a status bonus, nudge fate would not help
    if (await hasExistingStatusBonus(message)) {
        logger.debug(FEATURE_ID, "onRenderChatMessage, nudge fate would improve outcome, but roll already has a status bonus");
        return;
    }

    logger.debug(FEATURE_ID, "onRenderChatMessage, nudge fate would improve outcome, adding button");

    // Build button block (DOM-only)
    const controls = document.createElement("div");
    controls.className = "nudge-fate-controls";
    controls.style.marginTop = "6px";
    controls.innerHTML = `
        <div class="pf2e chat-card">
          <div class="card-buttons">
            <button type="button" class="nudge-fate-use">
              <img src="${EFFECT_ICON}" width="16" height="16" style="vertical-align:-3px; margin-right:6px;"/>
              Use Nudge Fate
            </button>
          </div>
        </div>`;

    // Click handler: consume and mark used
    controls.querySelector(".nudge-fate-use")?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;

        // Re-check eligibility at click time (in case something changed)
        const dcNow = ctx?.dc?.value ?? null;
        const totalNow = Number(message?.rolls?.[0]?.total);
        if (!wouldImprove(totalNow, dcNow)) {
            ui.notifications?.warn("Nudge Fate wouldn't change this result.");
            return;
        }

        const flags = message.flags?.pf2e ?? {};
        const current = flags?.context?.outcome ?? null;
        if (!current) return ui.notifications?.warn("Could not detect degree of success.");

        const bumped = bumpDegree(current);
        if (bumped === current) return ui.notifications?.info("Already at maximum degree.");

        const labels = {
            criticalFailure: "Critical Failure",
            failure: "Failure",
            success: "Success",
            criticalSuccess: "Critical Success",
        };

        const bumptext = `${labels[current]} -> ${labels[bumped]}`;

        try {
            await consumeEffect(actor);
            btn.disabled = true;
            btn.innerHTML = `<i class="fas fa-check"></i> Nudge Fate Used: ${bumptext}`;
            logger.debug(FEATURE_ID, "Nudge Fate Used:", bumptext, "effect removed");
        } catch (e) {
            logger.error(FEATURE_ID, "Nudge Fate (consume) error:", e.message);
        }
    });

    // Attach to the rendered card
    $html.append(controls);
}

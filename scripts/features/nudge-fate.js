// scripts/features/nudge-fate.js
import { MODULE_ID } from "../settings.js";
import { logger } from "../logger.js";

const FEATURE_ID = "NF:";
const EFFECT_NAME = "Effect: Nudge Fate";
const EFFECT_ICON = "icons/magic/control/buff-luck-fortune-green.webp";

// Keep a handle so we can unhook cleanly
let _nfHookId = null;

export function installNudgeFate() {
    if (_nfHookId) return;
    _nfHookId = Hooks.on("renderChatMessage", onRenderChatMessage);
    logger.log(FEATURE_ID, "installNudgeFate");
}

export function uninstallNudgeFate() {
    if (_nfHookId) {
        Hooks.off("renderChatMessage", _nfHookId);
        logger.log(FEATURE_ID, "uninstallNudgeFate");
        _nfHookId = null;
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
function wouldImprove(total, dc) {
    if (dc == null || !Number.isFinite(total)) return false;
    const diff = total - dc;
    return diff === -1 || diff === -10; // fail→success or crit-fail→fail
}
async function consumeEffect(actor) {
    const eff = actor.items.find(i => i.type === "effect" && i.name === EFFECT_NAME);
    if (eff) await actor.deleteEmbeddedDocuments("Item", [eff.id]);
}
async function onRenderChatMessage(message, $html, data) {
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
    if (!wouldImprove(total, dc)) return;

    logger.debug(FEATURE_ID, "onRenderChatMessage, nudge fate would improve outcome");

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
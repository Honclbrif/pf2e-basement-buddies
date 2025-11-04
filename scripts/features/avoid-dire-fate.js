// scripts/features/avoid-dire-fate.js
import { MODULE_ID } from "../settings.js";
import { logger } from "../logger.js";
const FEATURE_ID = "ADF:";
// Keep a handle so we can unhook cleanly
let _adfHookId = null;

export function installAvoidDireFate() {
    if (_adfHookId) return;
    _adfHookId = Hooks.on("renderChatMessage", onRenderChatMessage);
    logger.log(FEATURE_ID, "installAvoidDireFate");
}

export function uninstallAvoidDireFate() {
    if (_adfHookId) {
        Hooks.off("renderChatMessage", _adfHookId);
        logger.log(FEATURE_ID, "uninstallAvoidDireFate");
        _adfHookId = null;
    }
}

function bumpDegree(dos) {
    const order = ["criticalFailure", "failure", "success", "criticalSuccess"];
    const i = Math.max(0, order.indexOf(dos));
    return order[Math.min(order.length - 1, i + 1)];
}

async function onRenderChatMessage(message, $html /* jQuery | HTMLElement */, data) {
    try {
        const root = ($html?.[0]) ?? $html;
        if (!root) return;

        const contentEl = root.querySelector?.(".message-content") ?? root;

        // Re-apply banner if the flag is set (after refreshes/rerenders)
        const alreadyApplied = message.getFlag(MODULE_ID, "adf.applied") === true;
        const savedText = message.getFlag(MODULE_ID, "adf.text");
        if (alreadyApplied) {
            injectBanner(contentEl, savedText || "Avoid Dire Fate expended: degree of success improved.");
            disableADFButtons(root);
        }

        // Event delegation: bind once per message DOM
        if (root.dataset.adfBound === "1") return;
        root.dataset.adfBound = "1";

        // Accept any of these selectors (your current one is .harrow-bump-dos)
        const SELECTOR = [
            ".harrow-bump-dos",
            ".harrow-adjusted-dos button",
            ".harrow-adjusted-dos .adf-button",
            "button.harrow-adjusted-dos",
            "button[data-action='avoid-dire-fate']"
        ].join(", ");

        const handler = async (ev) => {
            const btn = ev.target.closest?.(SELECTOR);
            if (!btn) return;

            ev.preventDefault();
            ev.stopPropagation();

            logger.debug(FEATURE_ID, "button clicked", { mid: message.id, selectorHit: btn.className || btn.getAttribute("data-action") });

            const { actor } = await resolveSpeakerActor(message.speaker);
            if (!actor) {
                logger.warn(FEATURE_ID, "no actor resolved from speaker; aborting.");
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

            const bumptext = `Bump degree of success:\n${labels[current]} -> ${labels[bumped]}`;
            logger.debug(bumptext);

            // Prefer any text provided by the button; otherwise default
            const bannerText =
                btn.dataset.bannerText ||
                btn.getAttribute("data-banner-text") ||
                bumptext;

            // Persist flags so we can re-inject on future renders
            try {
                await message.setFlag(MODULE_ID, "adf.applied", true);
                await message.setFlag(MODULE_ID, "adf.text", bannerText);
            } catch (e) {
                logger.warn(FEATURE_ID, "setFlag failed; injecting DOM-only", e);
            }

            // Consume Harrow Omen effect(s)
            const removed = await consumeHarrowOmen(actor);
            logger.debug(FEATURE_ID, "removed Harrow Omen?", removed);

            // Update THIS rendered DOM non-destructively
            injectBanner(contentEl, bannerText);
            disableADFButtons(root);
        };

        root.addEventListener("click", handler, true);

    } catch (err) {
        logger.error(FEATURE_ID, "renderChatMessage error", err);
    }
}

/** Resolve the message speaker to an actor (with several fallbacks). */
async function resolveSpeakerActor(speaker = {}) {
    try {
        let actor = speaker.actor ? game.actors.get(speaker.actor) : null;
        let tokenDoc = null;

        if (!actor && speaker.token) {
            const scene = speaker.scene ? game.scenes.get(speaker.scene) : game.scenes.current;
            tokenDoc =
                scene?.tokens?.get(speaker.token) ??
                canvas?.scene?.tokens?.get(speaker.token) ??
                canvas?.tokens?.get(speaker.token)?.document ??
                null;
            actor = tokenDoc?.actor ?? actor;
        }

        if (!actor && speaker.alias) {
            const candidates = canvas?.scene?.tokens?.filter((t) => t.actor?.name === speaker.alias) ?? [];
            actor = candidates[0]?.actor ?? actor;
            tokenDoc = candidates[0] ?? tokenDoc;
        }

        return { actor, token: tokenDoc, scene: tokenDoc?.parent ?? game.scenes.get(speaker.scene) ?? null };
    } catch (e) {
        logger.error(FEATURE_ID, "resolveSpeakerActor error", e);
        return { actor: null, token: null, scene: null };
    }
}

/** Remove any Harrow Omen effect(s) on the actor. Adjust name/slug matches if needed. */
async function consumeHarrowOmen(actor) {
    try {
        const effects = actor?.itemTypes?.effect ?? actor?.items?.filter((i) => i.type === "effect") ?? [];
        const toRemove = effects.filter((e) => {
            const slug = e.slug ?? e.system?.slug ?? "";
            const name = (e.name ?? "").toLowerCase();
            return /harrow\s*omen/i.test(name) || /harrow-omen/.test(slug);
        });
        if (!toRemove.length) return false;
        await actor.deleteEmbeddedDocuments("Item", toRemove.map((e) => e.id));
        return true;
    } catch (e) {
        logger.error(FEATURE_ID, "consumeHarrowOmen error", e);
        return false;
    }
}

/** Insert a non-destructive banner at the top of the message content. */
function injectBanner(contentEl, text) {
    try {
        const host = contentEl?.querySelector?.(".message-content") ?? contentEl;
        if (!host) return;

        // Avoid duplicates
        if (host.querySelector(".pf2ebb-adf-banner")) return;

        const banner = document.createElement("div");
        banner.className = "pf2ebb-adf-banner";

        // Normalize newlines and render them as line breaks
        const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        banner.textContent = normalized;
        banner.style.whiteSpace = "pre-line"; // <-- key bit

        // A little styling (kept from your version)
        banner.style.border = "1px solid var(--color-border)";
        banner.style.borderRadius = "8px";
        banner.style.padding = "6px 10px";
        banner.style.marginBottom = "6px";
        banner.style.background = "var(--background)";
        banner.style.fontWeight = "600";
        banner.style.fontSize = "0.9rem";

        host.prepend(banner);
        logger.debug(FEATURE_ID, "banner injected");
    } catch (e) {
        logger.error(FEATURE_ID, "injectBanner error", e);
    }
}


/** Disable/hide all ADF buttons so the user can’t double-consume. */
function disableADFButtons(root) {
    try {
        const el = root?.querySelector ? root : root?.[0] ?? null;
        if (!el) return;

        const buttons = el.querySelectorAll(
            ".harrow-bump-dos, .harrow-adjusted-dos button, .harrow-adjusted-dos .adf-button, button.harrow-adjusted-dos, button[data-action='avoid-dire-fate']"
        );
        for (const btn of buttons) {
            btn.disabled = true;
            btn.classList.add("adf-used");
            if (!btn.dataset.preserveText) btn.textContent = btn.dataset.usedText || "Avoid Dire Fate used";
        }
        logger.debug(FEATURE_ID, "buttons disabled", { count: buttons.length });
    } catch (e) {
        logger.error(FEATURE_ID, "disableADFButtons error", e);
    }
}


import { MODULE_ID, SETTING_KEYS, registerSettings } from "./settings.js";
import { logger } from "./logger.js";
import { installAvoidDireFate, uninstallAvoidDireFate } from "./features/avoid-dire-fate.js";
import { installEscalationDie, uninstallEscalationDie } from "./features/escalation-die.js";
import { installNudgeFate, uninstallNudgeFate } from "./features/nudge-fate.js";

const onADF = (enabled) => {
    if (game.user.isGM) {
        enabled ? installAvoidDireFate() : uninstallAvoidDireFate();
    }
};
const onED = (enabled) => {
    if (game.user.isGM) {
        enabled ? installEscalationDie() : uninstallEscalationDie();
    }
};
const onNF = (enabled) => {
    if (game.user.isGM) {
        enabled ? installNudgeFate() : uninstallNudgeFate();
    }
};

Hooks.once("init", () => {
    console.log("[PF2e Basement Buddies] Init");
    try {
        registerSettings(onADF, onED, onNF);
        try { logger.setDebug(!!game.settings.get(MODULE_ID, SETTING_KEYS.debug)); } catch { }
        const mod = game.modules.get(MODULE_ID);
        if (mod) {
            mod.api = { onADF, onED, onNF, logger };
        }
    } catch (err) { logger.error("Init error", err); }
});

Hooks.once("ready", () => {
    if (!game.user.isGM) {
        logger.debug("GM-only: skipping feature installers on this client");
        return;
    }
    try {
        const adf = game.settings.get(MODULE_ID, SETTING_KEYS.avoidDireFate);
        const ed = game.settings.get(MODULE_ID, SETTING_KEYS.escalationDie);
        const nf = game.settings.get(MODULE_ID, SETTING_KEYS.nudgeFate);
        onADF(!!adf);
        onED(!!ed);
        onNF(!!nf);
        logger.log("Ready");
    } catch (err) {
        logger.error("Ready error:", err.message);
    }
});

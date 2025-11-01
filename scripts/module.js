
import { MODULE_ID, SETTING_KEYS, registerSettings } from "./settings.js";
import { logger } from "./logger.js";
import { installAvoidDireFate, uninstallAvoidDireFate } from "./features/avoid-dire-fate.js";
import { installEscalationDie, uninstallEscalationDie } from "./features/escalation-die.js";

const onADF = (enabled) => { enabled ? installAvoidDireFate() : uninstallAvoidDireFate(); };
const onED = (enabled) => { enabled ? installEscalationDie() : uninstallEscalationDie(); };

Hooks.once("init", () => {
    console.log("[PF2e Basement Buddies] Init");
    try {
        registerSettings(onADF, onED);
        try { logger.setDebug(!!game.settings.get(MODULE_ID, SETTING_KEYS.debug)); } catch { }
        const mod = game.modules.get(MODULE_ID);
        if (mod) {
            mod.api = { onADF, onED, logger };
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
        onADF(!!adf);
        onED(!!ed);
        logger.log("Ready");
    } catch (err) {
        logger.error("Ready error", err);
    }
});

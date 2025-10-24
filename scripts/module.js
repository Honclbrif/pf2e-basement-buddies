
import { MODULE_ID, SETTING_KEYS, registerSettings } from "./settings.js";
import { logger } from "./logger.js";
import { installAvoidDireFate, uninstallAvoidDireFate } from "./features/avoid-dire-fate.js";
import { enableEscalationDieAuto, disableEscalationDieAuto } from "./features/escalation-die.js";

const onADF = (enabled) => { enabled ? installAvoidDireFate() : uninstallAvoidDireFate(); };
const onED = (enabled) => { enabled ? enableEscalationDieAuto() : disableEscalationDieAuto(); };

Hooks.once("init", () => {
    console.log("[PF2e Basement Buddies] Init start", { module: MODULE_ID });
    try {
        registerSettings(onADF, onED);
        try { logger.setDebug(!!game.settings.get(MODULE_ID, SETTING_KEYS.debug)); } catch { }
        const mod = game.modules.get(MODULE_ID);
        if (mod) {
            mod.api = { onADF, onED, enableEscalationDieAuto, disableEscalationDieAuto, logger };
        }
    } catch (err) { logger.error("Init error", err); }
});

Hooks.once("ready", () => {
    logger.log("Ready");
    try {
        const adf = game.settings.get(MODULE_ID, SETTING_KEYS.avoidDireFate);
        const ed = game.settings.get(MODULE_ID, SETTING_KEYS.escalationDie);
        onADF(!!adf); onED(!!ed);
    } catch (err) { logger.error("Ready error", err); }
});

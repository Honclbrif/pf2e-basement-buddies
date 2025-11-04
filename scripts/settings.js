
import { logger } from "./logger.js";
export const MODULE_ID = "pf2e-basement-buddies";
export const SETTING_KEYS = { debug: "debug.enabled", avoidDireFate: "avoidDireFate.enabled", escalationDie: "escalationDie.enabled", nudgeFate: "nudgeFate.enabled" };

export function registerSettings(onAvoidToggle, onEscalationToggle, onNudgeFateToggle) {
    logger.debug("Registering settings...");
    game.settings.register(MODULE_ID, SETTING_KEYS.debug, {
        name: game.i18n.localize("PF2EBB.Settings.Debug.ToggleName"),
        hint: game.i18n.localize("PF2EBB.Settings.Debug.ToggleHint"),
        scope: "world", config: true, type: Boolean, default: false, restricted: true,
        onChange: (v) => { logger.setDebug(!!v); logger.log("Debug Mode changed:", !!v); },
    });
    game.settings.register(MODULE_ID, SETTING_KEYS.avoidDireFate, {
        name: game.i18n.localize("PF2EBB.Settings.ADF.ToggleName"),
        hint: game.i18n.localize("PF2EBB.Settings.ADF.ToggleHint"),
        scope: "world", config: true, type: Boolean, default: true, restricted: true,
        onChange: (v) => { logger.debug("ADF setting changed:", v); onAvoidToggle?.(!!v); },
    });
    game.settings.register(MODULE_ID, SETTING_KEYS.escalationDie, {
        name: game.i18n.localize("PF2EBB.Settings.ED.ToggleName"),
        hint: game.i18n.localize("PF2EBB.Settings.ED.ToggleHint"),
        scope: "world", config: true, type: Boolean, default: false, restricted: true,
        onChange: (v) => { logger.debug("ED setting changed:", v); onEscalationToggle?.(!!v); },
    });
    game.settings.register(MODULE_ID, SETTING_KEYS.nudgeFate, {
        name: game.i18n.localize("PF2EBB.Settings.NF.ToggleName"),
        hint: game.i18n.localize("PF2EBB.Settings.NF.ToggleHint"),
        scope: "world", config: true, type: Boolean, default: false, restricted: true,
        onChange: (v) => { logger.debug("NF setting changed:", v); onNudgeFateToggle?.(!!v); },
    });
    logger.debug("Finished registering settings.");
}

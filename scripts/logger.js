
export const MODULE_ID = "pf2e-basement-buddies";
const TAG = "[PF2e Basement Buddies]";
let DEBUG = false
const safe = (x) => { try { return typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); } };
export const logger = {
    setDebug: (enabled) => { DEBUG = !!enabled; },
    log: (...a) => console.log(TAG, ...a.map(safe)),
    warn: (...a) => console.warn(TAG, ...a.map(safe)),
    error: (...a) => console.error(TAG, ...a.map(safe)),
    debug: (...a) => { if (DEBUG) console.debug(TAG, ...a.map(safe)); }
};

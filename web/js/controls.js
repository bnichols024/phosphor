// Button layouts for the in-browser emulators, shared by Settings › Controls and the game player.
// A player's choices live in their profile (settings.controls) as overrides of EmulatorJS's
// defaults: { all: {...}, <console id>: {...} }, each { <action>: { value: keyCode, value2: pad } }.

// EmulatorJS's own defaults for player 1 (action index -> keyboard key, controller button).
export const DEFAULTS = {
  0: { value: "x", value2: "BUTTON_2" }, 1: { value: "s", value2: "BUTTON_4" }, 2: { value: "v", value2: "SELECT" }, 3: { value: "enter", value2: "START" },
  4: { value: "up arrow", value2: "DPAD_UP" }, 5: { value: "down arrow", value2: "DPAD_DOWN" }, 6: { value: "left arrow", value2: "DPAD_LEFT" }, 7: { value: "right arrow", value2: "DPAD_RIGHT" },
  8: { value: "z", value2: "BUTTON_1" }, 9: { value: "a", value2: "BUTTON_3" }, 10: { value: "q", value2: "LEFT_TOP_SHOULDER" }, 11: { value: "e", value2: "RIGHT_TOP_SHOULDER" },
  12: { value: "tab", value2: "LEFT_BOTTOM_SHOULDER" }, 13: { value: "r", value2: "RIGHT_BOTTOM_SHOULDER" }, 14: { value: "", value2: "LEFT_STICK" }, 15: { value: "", value2: "RIGHT_STICK" },
  16: { value: "h", value2: "LEFT_STICK_X:+1" }, 17: { value: "f", value2: "LEFT_STICK_X:-1" }, 18: { value: "g", value2: "LEFT_STICK_Y:+1" }, 19: { value: "t", value2: "LEFT_STICK_Y:-1" },
  20: { value: "l", value2: "RIGHT_STICK_X:+1" }, 21: { value: "j", value2: "RIGHT_STICK_X:-1" }, 22: { value: "k", value2: "RIGHT_STICK_Y:+1" }, 23: { value: "i", value2: "RIGHT_STICK_Y:-1" },
  24: { value: "1" }, 25: { value: "2" }, 26: { value: "3" },
};

// The rows shown in Settings, in the order a person thinks about them.
export const ACTIONS = [
  [8, "A"], [0, "B"], [9, "X"], [1, "Y"], [3, "Start"], [2, "Select"],
  [4, "D-pad up"], [5, "D-pad down"], [6, "D-pad left"], [7, "D-pad right"],
  [10, "L"], [11, "R"], [12, "L2 / Z"], [13, "R2"], [14, "L3 (stick click)"], [15, "R3 (stick click)"],
  [19, "Left stick up"], [18, "Left stick down"], [17, "Left stick left"], [16, "Left stick right"],
  [23, "Right stick up"], [22, "Right stick down"], [21, "Right stick left"], [20, "Right stick right"],
  [24, "Quick save"], [25, "Quick load"],
];

// Standard-layout controller button index -> EmulatorJS name, and friendly names for both.
export const PAD_BUTTONS = ["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER", "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "SELECT", "START", "LEFT_STICK", "RIGHT_STICK", "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT"];
const PAD_NAMES = {
  BUTTON_1: "A (bottom)", BUTTON_2: "B (right)", BUTTON_3: "X (left)", BUTTON_4: "Y (top)", LEFT_TOP_SHOULDER: "LB", RIGHT_TOP_SHOULDER: "RB",
  LEFT_BOTTOM_SHOULDER: "LT", RIGHT_BOTTOM_SHOULDER: "RT", SELECT: "Back / Select", START: "Start", LEFT_STICK: "Left stick click", RIGHT_STICK: "Right stick click",
  DPAD_UP: "D-pad up", DPAD_DOWN: "D-pad down", DPAD_LEFT: "D-pad left", DPAD_RIGHT: "D-pad right",
  "LEFT_STICK_X:+1": "Left stick →", "LEFT_STICK_X:-1": "Left stick ←", "LEFT_STICK_Y:+1": "Left stick ↓", "LEFT_STICK_Y:-1": "Left stick ↑",
  "RIGHT_STICK_X:+1": "Right stick →", "RIGHT_STICK_X:-1": "Right stick ←", "RIGHT_STICK_Y:+1": "Right stick ↓", "RIGHT_STICK_Y:-1": "Right stick ↑",
};
export const padName = (v) => (v ? PAD_NAMES[v] || v : "—");
const KEY_NAMES = { 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt", 27: "Esc", 32: "Space", 37: "←", 38: "↑", 39: "→", 40: "↓" };
export function keyName(v) {
  if (v === "" || v === undefined || v === null) return "—";
  if (typeof v === "number") return KEY_NAMES[v] || (v >= 48 && v <= 90 ? String.fromCharCode(v) : v >= 112 && v <= 123 ? `F${v - 111}` : `Key ${v}`);
  return { "up arrow": "↑", "down arrow": "↓", "left arrow": "←", "right arrow": "→", enter: "Enter", tab: "Tab" }[v] || v.toUpperCase();
}

// "Match positions": the bottom button is the original pad's bottom button (B on Nintendo pads),
// instead of matching the printed letter (A to A).
export const POSITIONAL = { 8: "BUTTON_2", 0: "BUTTON_1", 9: "BUTTON_4", 1: "BUTTON_3" };

// The layout for one console: defaults, then the player's "all consoles" choices, then this
// console's own. Passed to EmulatorJS as EJS_defaultControls (player 1).
export function layoutFor(controls = {}, systemId) {
  const out = {};
  for (const [k, v] of Object.entries(DEFAULTS)) out[k] = { ...v };
  for (const scope of [controls.all, controls[systemId]]) {
    if (!scope) continue;
    if (scope.positional) for (const [k, pad] of Object.entries(POSITIONAL)) out[k] = { ...out[k], value2: pad };
    for (const [k, v] of Object.entries(scope.map || {})) out[k] = { ...out[k], ...v };
  }
  return { 0: out, 1: {}, 2: {}, 3: {} };
}

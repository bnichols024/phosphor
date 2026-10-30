// Inline SVG icons. UI icons are 24px strokes; console icons are 64px silhouettes whose details
// are drawn as darker overlays so they read on any accent colour.
const s = (body, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
const f = (body) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  home: s('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h5v-6h4v6h5V9"/>'),
  library: s('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  layers: s('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/>'),
  chart: s('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
  settings: s('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  play: f('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/>'),
  resume: s('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5"/><path d="m10 9 5 3-5 3V9Z" fill="currentColor"/>'),
  heart: s('<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6Z"/>'),
  heartFill: f('<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6Z"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  upload: s('<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>'),
  download: s('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>'),
  refresh: s('<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
  check: s('<path d="M20 6 9 17l-5-5"/>'),
  x: s('<path d="M18 6 6 18M6 6l12 12"/>'),
  back: s('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>'),
  chevronRight: s('<path d="m9 18 6-6-6-6"/>'),
  more: f('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
  trash: s('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  edit: s('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  users: s('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>'),
  gamepad: s('<path d="M6 11h4M8 9v4"/><path d="M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 1.8L9 15h6l1.6 1.8A3 3 0 0 0 22 15l-.7-6.4A4 4 0 0 0 17.3 5Z"/>'),
  phone: s('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'),
  save: s('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
  load: s('<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M12 12v9"/><path d="m8 17 4 4 4-4"/>'),
  zap: s('<path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z"/>'),
  ff: f('<path d="M2 6.5v11a1 1 0 0 0 1.6.8L11 12.8V17.5a1 1 0 0 0 1.6.8l8.2-5.5a1 1 0 0 0 0-1.6L12.6 5.7A1 1 0 0 0 11 6.5v4.7L3.6 5.7A1 1 0 0 0 2 6.5Z"/>'),
  rewind: f('<path d="M22 6.5v11a1 1 0 0 1-1.6.8L13 12.8V17.5a1 1 0 0 1-1.6.8L3.2 12.8a1 1 0 0 1 0-1.6l8.2-5.5A1 1 0 0 1 13 6.5v4.7l7.4-5.5A1 1 0 0 1 22 6.5Z"/>'),
  video: s('<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8Z"/>'),
  camera: s('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>'),
  monitor: s('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>'),
  alert: s('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
  lock: s('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  sparkles: s('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>'),
  shuffle: s('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>'),
  power: s('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>'),
  maximize: s('<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  volume: s('<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>'),
  mute: s('<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>'),
  disc: s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/>'),
  sliders: s('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  history: s('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  folder: s('<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  qr: s('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>'),
  menu: s('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  palette: s('<circle cx="13.5" cy="6.5" r="1.2" fill="currentColor"/><circle cx="17.5" cy="10.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.2" fill="currentColor"/><circle cx="6.5" cy="12.5" r="1.2" fill="currentColor"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2c0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3a2 2 0 0 1 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2Z"/>'),
  cpu: s('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
  gift: s('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v9H5v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>'),
  star: f('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>'),
  restart: s('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  pause: f('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
};

// Console silhouettes: body in currentColor, details as translucent black.
const d = 'fill="#000" fill-opacity=".38"';
const l = 'fill="#fff" fill-opacity=".55"';
const c = (body) => `<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">${body}</svg>`;
export const CONSOLE_ICONS = {
  "pad-nes": c(`<rect x="4" y="20" width="56" height="25" rx="3"/><rect x="7" y="23" width="50" height="19" rx="2" ${d}/><path d="M13 30h4v-4h4v4h4v4h-4v4h-4v-4h-4z" ${l}/><rect x="27" y="33" width="5" height="2.6" rx="1.3" ${l}/><rect x="33.5" y="33" width="5" height="2.6" rx="1.3" ${l}/><circle cx="45" cy="34" r="3.2" fill="#e63946"/><circle cx="53" cy="34" r="3.2" fill="#e63946"/>`),
  "pad-snes": c(`<path d="M16 18h32a14 14 0 0 1 0 28c-5 0-8-3-11-6H27c-3 3-6 6-11 6a14 14 0 0 1 0-28z"/><path d="M12 29h4v-4h4v4h4v4h-4v4h-4v-4h-4z" ${d}/><rect x="27" y="31" width="4.5" height="2.4" rx="1.2" transform="rotate(-25 29 32)" ${d}/><rect x="33" y="31" width="4.5" height="2.4" rx="1.2" transform="rotate(-25 35 32)" ${d}/><circle cx="48" cy="25" r="3" fill="#2a9d8f"/><circle cx="54" cy="31" r="3" fill="#e63946"/><circle cx="42" cy="31" r="3" fill="#457b9d"/><circle cx="48" cy="37" r="3" fill="#f4a261"/>`),
  "pad-n64": c(`<path d="M8 22c0-4 4-6 8-6h32c4 0 8 2 8 6 0 6-2 14-6 22-2 4-7 4-8 0l-3-10h-4l-1 14c-1 5-7 5-8 0l-1-14h-4l-3 10c-1 4-6 4-8 0-4-8-6-16-6-22z"/><path d="M14 22h3v-3h3v3h3v3h-3v3h-3v-3h-3z" ${d}/><circle cx="32" cy="27" r="4" ${d}/><circle cx="47" cy="27" r="2.6" fill="#3a86ff"/><circle cx="43" cy="22" r="2.6" fill="#2a9d8f"/><circle cx="52" cy="21" r="1.8" fill="#ffbe0b"/><circle cx="49" cy="18" r="1.8" fill="#ffbe0b"/><circle cx="55" cy="18" r="1.8" fill="#ffbe0b"/>`),
  gb: c(`<path d="M16 4h32a4 4 0 0 1 4 4v42c0 6-6 10-12 10H16a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z"/><rect x="17" y="9" width="30" height="24" rx="2" ${d}/><rect x="21" y="12" width="22" height="18" fill="#9bbc0f" fill-opacity=".85"/><path d="M17 42h3v-3h3v3h3v3h-3v3h-3v-3h-3z" ${d}/><circle cx="44" cy="40" r="2.8" ${d}/><circle cx="38" cy="44" r="2.8" ${d}/><path d="M38 54l6-2M42 55l6-2" stroke="#000" stroke-opacity=".35" stroke-width="1.5"/>`),
  gba: c(`<path d="M14 18h36c6 0 10 6 10 14s-4 14-10 14H14C8 46 4 40 4 32s4-14 10-14z"/><rect x="19" y="21" width="26" height="21" rx="2" ${d}/><rect x="21" y="23" width="22" height="17" fill="#8ecae6" fill-opacity=".7"/><path d="M7 30h3v-3h3v3h3v3h-3v3h-3v-3H7z" ${d}/><circle cx="56" cy="29" r="2.6" ${d}/><circle cx="51" cy="34" r="2.6" ${d}/>`),
  nds: c(`<rect x="12" y="4" width="40" height="27" rx="4"/><rect x="17" y="8" width="30" height="20" rx="1" ${d}/><rect x="12" y="33" width="40" height="27" rx="4"/><rect x="21" y="37" width="22" height="17" rx="1" ${d}/><path d="M13 44h2.5v-2.5H18V44h2.5v2.5H18V49h-2.5v-2.5H13z" ${l}/><circle cx="48" cy="42" r="1.8" ${l}/><circle cx="48" cy="49" r="1.8" ${l}/><circle cx="45" cy="45.5" r="1.8" ${l}/><circle cx="51" cy="45.5" r="1.8" ${l}/>`),
  vb: c(`<path d="M6 16h52a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H40l-4-4h-8l-4 4H6a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4z"/><rect x="8" y="20" width="18" height="9" rx="3" fill="#ef4444" fill-opacity=".7"/><rect x="38" y="20" width="18" height="9" rx="3" fill="#ef4444" fill-opacity=".7"/><path d="M29 34h6l3 16h4v4H22v-4h4z"/>`),
  "pad-sms": c(`<rect x="4" y="20" width="56" height="25" rx="5"/><circle cx="17" cy="32.5" r="8" ${d}/><path d="M14 30.5h2v-2h2v2h2v2h-2v2h-2v-2h-2z" ${l}/><circle cx="43" cy="33" r="3.6" ${d}/><circle cx="52" cy="33" r="3.6" ${d}/>`),
  "pad-genesis": c(`<path d="M10 22c4-4 14-6 22-6s18 2 22 6c4 4 6 12 4 18-2 5-8 6-12 2-3-3-8-4-14-4s-11 1-14 4c-4 4-10 3-12-2-2-6 0-14 4-18z"/><circle cx="18" cy="29" r="7" ${d}/><path d="M15.5 27h2v-2h2v2h2v2h-2v2h-2v-2h-2z" ${l}/><circle cx="38" cy="32" r="2.8" ${d}/><circle cx="44.5" cy="29" r="2.8" ${d}/><circle cx="51" cy="26" r="2.8" ${d}/><rect x="29" y="22" width="6" height="2.4" rx="1.2" ${d}/>`),
  "pad-saturn": c(`<path d="M14 18h36c7 0 12 6 12 13s-5 13-12 13c-4 0-6-2-8-4H22c-2 2-4 4-8 4C7 44 2 38 2 31s5-13 12-13z"/><circle cx="15" cy="31" r="7" ${d}/><path d="M12.5 29h2v-2h2v2h2v2h-2v2h-2v-2h-2z" ${l}/><circle cx="41" cy="35" r="2.4" ${d}/><circle cx="47" cy="34" r="2.4" ${d}/><circle cx="53" cy="32" r="2.4" ${d}/><circle cx="41" cy="28" r="1.8" ${d}/><circle cx="47" cy="27" r="1.8" ${d}/><circle cx="53" cy="25" r="1.8" ${d}/>`),
  disc: c(`<circle cx="32" cy="32" r="27"/><path d="M32 5a27 27 0 0 1 22 11L40 26a10 10 0 0 0-8-4z" fill="#fff" fill-opacity=".25"/><circle cx="32" cy="32" r="9" ${d}/><circle cx="32" cy="32" r="4" fill="#0b0c12"/>`),
  "pad-ps": c(`<path d="M18 16h28c6 0 10 4 12 10l4 18c1 6-5 10-10 6l-6-6H18l-6 6c-5 4-11 0-10-6l4-18c2-6 6-10 12-10z"/><path d="M12 26h3.5v-3.5H19V26h3.5v3.5H19V33h-3.5v-3.5H12z" ${d}/><circle cx="48" cy="22.5" r="2.4" fill="#2a9d8f"/><circle cx="53" cy="27.5" r="2.4" fill="#e63946"/><circle cx="43" cy="27.5" r="2.4" fill="#ff8fab"/><circle cx="48" cy="32.5" r="2.4" fill="#4ea8de"/><circle cx="25" cy="38" r="4" ${d}/><circle cx="39" cy="38" r="4" ${d}/>`),
  psp: c(`<path d="M12 20h40c6 0 10 5 10 12s-4 12-10 12H12C6 44 2 39 2 32s4-12 10-12z"/><rect x="16" y="23" width="32" height="18" rx="1.5" ${d}/><path d="M5 28.5h2.5V26H10v2.5h2.5V31H10v2.5H7.5V31H5z" ${l}/><circle cx="8.5" cy="38" r="2" ${l}/><circle cx="56" cy="27" r="1.7" ${l}/><circle cx="56" cy="34" r="1.7" ${l}/><circle cx="52.5" cy="30.5" r="1.7" ${l}/><circle cx="59.5" cy="30.5" r="1.7" ${l}/>`),
  joystick: c(`<rect x="10" y="36" width="44" height="20" rx="4"/><rect x="13" y="39" width="38" height="3" rx="1.5" ${d}/><rect x="29" y="12" width="6" height="28" rx="3"/><circle cx="32" cy="12" r="7" fill="#ef4444"/><circle cx="17" cy="35" r="4" fill="#ef4444"/>`),
  "pad-jaguar": c(`<path d="M10 14h44c4 0 6 4 6 8v14c0 10-8 14-14 14H18C12 50 4 46 4 36V22c0-4 2-8 6-8z"/><circle cx="16" cy="24" r="6" ${d}/><circle cx="42" cy="26" r="2.6" ${d}/><circle cx="48" cy="22" r="2.6" ${d}/><circle cx="54" cy="18" r="2.6" ${d}/><g ${d}><rect x="25" y="32" width="4" height="3" rx="1"/><rect x="30" y="32" width="4" height="3" rx="1"/><rect x="35" y="32" width="4" height="3" rx="1"/><rect x="25" y="37" width="4" height="3" rx="1"/><rect x="30" y="37" width="4" height="3" rx="1"/><rect x="35" y="37" width="4" height="3" rx="1"/><rect x="25" y="42" width="4" height="3" rx="1"/><rect x="30" y="42" width="4" height="3" rx="1"/><rect x="35" y="42" width="4" height="3" rx="1"/></g>`),
  "handheld-wide": c(`<path d="M10 16h44c4 0 8 6 8 16s-4 16-8 16H10C6 48 2 42 2 32s4-16 8-16z"/><rect x="18" y="20" width="28" height="24" rx="2" ${d}/><rect x="21" y="23" width="22" height="18" fill="#7dd3fc" fill-opacity=".55"/><circle cx="10" cy="32" r="5" ${d}/><circle cx="53" cy="29" r="2.5" ${d}/><circle cx="56" cy="35" r="2.5" ${d}/>`),
  "pad-pce": c(`<path d="M8 20h48a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z"/><path d="M11 30.5h3.5V27H18v3.5h3.5V34H18v3.5h-3.5V34H11z" ${d}/><rect x="25" y="27" width="5" height="3" rx="1" ${d}/><rect x="25" y="32" width="5" height="3" rx="1" ${d}/><rect x="32" y="33" width="5" height="2.4" rx="1.2" ${d}/><circle cx="45" cy="34" r="3.4" ${d}/><circle cx="54" cy="34" r="3.4" ${d}/>`),
  arcade: c(`<path d="M18 4h28l2 10v46H16V14z"/><rect x="20" y="8" width="24" height="6" rx="1" fill="#ec4899" fill-opacity=".8"/><rect x="20" y="17" width="24" height="18" rx="2" ${d}/><path d="M14 38h36l2 6H12z"/><circle cx="24" cy="38" r="2.6" fill="#ef4444"/><rect x="23" y="34" width="2" height="4" ${d}/><circle cx="34" cy="40.5" r="1.8" fill="#38bdf8"/><circle cx="39" cy="40.5" r="1.8" fill="#facc15"/><circle cx="44" cy="40.5" r="1.8" fill="#22c55e"/><rect x="26" y="48" width="12" height="6" rx="1" ${d}/>`),
  computer: c(`<rect x="10" y="6" width="44" height="32" rx="4"/><rect x="14" y="10" width="36" height="24" rx="2" ${d}/><path d="M18 16h10M18 21h18M18 26h7" stroke="#34d399" stroke-opacity=".9" stroke-width="2.2" stroke-linecap="round"/><path d="M6 44h52l4 14H2z"/><g ${d}><rect x="9" y="47" width="5" height="3" rx="1"/><rect x="16" y="47" width="5" height="3" rx="1"/><rect x="23" y="47" width="5" height="3" rx="1"/><rect x="30" y="47" width="5" height="3" rx="1"/><rect x="37" y="47" width="5" height="3" rx="1"/><rect x="44" y="47" width="5" height="3" rx="1"/><rect x="51" y="47" width="5" height="3" rx="1"/><rect x="14" y="52" width="36" height="3" rx="1"/></g>`),
};

export const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9a6ff"/><stop offset=".5" stop-color="#7c5cff"/><stop offset="1" stop-color="#36e2c4"/></linearGradient></defs><rect x="4" y="8" width="40" height="32" rx="10" fill="none" stroke="url(#lg)" stroke-width="3.5"/><circle cx="24" cy="24" r="6.5" fill="url(#lg)"/><circle cx="24" cy="24" r="11" fill="none" stroke="url(#lg)" stroke-opacity=".35" stroke-width="2"/></svg>`;

export const icon = (name) => ICONS[name] || "";
export const consoleIcon = (name) => CONSOLE_ICONS[name] || CONSOLE_ICONS["pad-nes"];

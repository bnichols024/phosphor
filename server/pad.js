// Phone-as-controller relay. The game screen opens a room and shows a QR code; each phone that
// scans it joins as the next free player (up to 4) and streams button presses over a WebSocket.
import { WebSocketServer } from "ws";

export function attachPads(server, { log = console } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const rooms = new Map(); // code -> { host, pads: Map(player -> ws), pad: layout id, title }

  const newCode = () => {
    for (let i = 0; i < 50; i++) {
      const c = String(Math.floor(1000 + Math.random() * 9000));
      if (!rooms.has(c)) return c;
    }
    return String(Date.now()).slice(-6);
  };
  const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/ws/pad") return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, url));
  });

  wss.on("connection", (ws, url) => {
    const role = url.searchParams.get("role");
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    if (role === "host") {
      const code = newCode();
      const room = { host: ws, pads: new Map(), pad: url.searchParams.get("pad") || "snes", title: url.searchParams.get("title") || "", names: new Map() };
      rooms.set(code, room);
      send(ws, { type: "room", code });
      ws.on("message", (raw) => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.type === "layout") {
          room.pad = m.pad || room.pad;
          room.title = m.title ?? room.title;
          for (const p of room.pads.values()) send(p, { type: "layout", pad: room.pad, title: room.title });
        } else if (m.type === "rumble" && room.pads.has(m.player)) {
          send(room.pads.get(m.player), { type: "rumble", ms: m.ms || 40 });
        } else if (m.type === "kick" && room.pads.has(m.player)) {
          room.pads.get(m.player).close(4000, "removed");
        }
      });
      ws.on("close", () => {
        for (const p of room.pads.values()) { send(p, { type: "ended" }); p.close(1000); }
        rooms.delete(code);
      });
      return;
    }

    if (role === "pad") {
      const code = url.searchParams.get("room") || "";
      const room = rooms.get(code);
      if (!room) { send(ws, { type: "error", message: "That code didn't match a game. Check the number on the TV." }); return ws.close(4004); }
      const want = Number(url.searchParams.get("player"));
      let player = Number.isInteger(want) && want >= 0 && want < 4 && !room.pads.has(want) ? want : [0, 1, 2, 3].find((p) => !room.pads.has(p));
      if (player === undefined) { send(ws, { type: "error", message: "All four controller slots are taken." }); return ws.close(4009); }
      const name = String(url.searchParams.get("name") || `Phone ${player + 1}`).slice(0, 20);
      room.pads.set(player, ws);
      room.names.set(player, name);
      send(ws, { type: "joined", player, pad: room.pad, title: room.title });
      send(room.host, { type: "pad-joined", player, name });
      ws.on("message", (raw) => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        // Inputs are tiny arrays [index, value] (or many of them) to keep latency low.
        if (Array.isArray(m)) send(room.host, { type: "i", p: player, d: m });
        else if (m.type === "menu") send(room.host, { type: "menu", p: player });
        else if (m.type === "ping") send(ws, { type: "pong", t: m.t });
      });
      ws.on("close", () => {
        if (room.pads.get(player) === ws) {
          room.pads.delete(player);
          room.names.delete(player);
          send(room.host, { type: "pad-left", player });
        }
      });
      return;
    }
    ws.close(4000);
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* closed */ }
    }
  }, 20000);
  beat.unref();
  log.info?.("pads: phone controller relay ready on /ws/pad");
  return { rooms };
}

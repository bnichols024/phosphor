// Shared app state: systems, players, settings, emulator status. Views read from here.
import { api, setProfile, getProfile } from "./api.js";

export const store = {
  state: null,
  systems: {},
  systemList: [],
  profile: null,
  profiles: [],
  settings: {},
  go: (path) => location.assign(path), // replaced by the router
  listeners: new Set(),
};

export async function refreshState() {
  const st = await api.get("/api/state");
  store.state = st;
  store.systemList = st.systems;
  store.systems = Object.fromEntries(st.systems.map((s) => [s.id, s]));
  store.profile = st.profile;
  store.profiles = st.profiles;
  store.settings = st.settings;
  if (!getProfile() || !st.profiles.some((p) => p.id === getProfile())) setProfile(st.profile.id);
  for (const fn of store.listeners) fn(st);
  return st;
}

export const onState = (fn) => { store.listeners.add(fn); return () => store.listeners.delete(fn); };
export const go = (path) => store.go(path);

// Systems the player can actually use, in a sensible order.
export function visibleSystems({ includeEmpty = false } = {}) {
  return store.systemList.filter((s) => (includeEmpty || s.count > 0) && !(s.locked && !s.needs && s.count === 0));
}

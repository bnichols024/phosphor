// Fetch wrapper: JSON in/out, sends the current player's id, turns errors into readable messages.
let profileId = Number(localStorage.getItem("phosphor.profile")) || null;

export const setProfile = (id) => { profileId = id; localStorage.setItem("phosphor.profile", String(id)); };
export const getProfile = () => profileId;

async function request(method, url, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (profileId) headers["x-profile"] = String(profileId);
  let payload = body;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, keepalive: opts.keepalive });
  if (opts.raw) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (u, o) => request("GET", u, undefined, o),
  post: (u, b, o) => request("POST", u, b ?? {}, o),
  put: (u, b, o) => request("PUT", u, b, o),
  patch: (u, b, o) => request("PATCH", u, b, o),
  del: (u, o) => request("DELETE", u, undefined, o),
  raw: (method, u, b, o = {}) => request(method, u, b, { ...o, raw: true }),
};

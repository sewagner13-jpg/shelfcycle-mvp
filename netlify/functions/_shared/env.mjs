export function getEnv(name, fallback = "") {
  return process.env[name] || globalThis.Netlify?.env?.get?.(name) || fallback;
}

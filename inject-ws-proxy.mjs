import { createRequire } from "node:module";
import { HttpsProxyAgent } from "https-proxy-agent";

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (!proxyUrl) {
  console.log("ws_proxy=off");
} else {
  const require = createRequire(import.meta.url);
  const resolved = require.resolve("ws");
  const WS = require(resolved);
  const agent = new HttpsProxyAgent(proxyUrl);

  class ProxiedWebSocket extends WS {
    constructor(url, protocols, options) {
      const isOpts = protocols && typeof protocols === "object" && !Array.isArray(protocols);
      const extra = isOpts ? protocols : options && typeof options === "object" ? options : {};
      const opts = { agent, ...extra };
      if (!isOpts && Array.isArray(protocols) && protocols.length) super(url, protocols, opts);
      else super(url, opts);
    }
  }
  for (const key of Object.keys(WS)) {
    if (!(key in ProxiedWebSocket)) ProxiedWebSocket[key] = WS[key];
  }
  ProxiedWebSocket.WebSocket = ProxiedWebSocket;

  require.cache[resolved].exports = ProxiedWebSocket;
  console.log("ws_proxy=on", proxyUrl);
}

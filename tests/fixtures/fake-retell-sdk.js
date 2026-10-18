// Stand-in for retell-client-js-sdk's RetellWebClient in local development and browser tests.
// retell-web.js loads it only on localhost (?retellSdk=...). It opens no connection and uses no microphone.
export class RetellWebClient {
  constructor() {
    this.handlers = {};
  }
  on(name, fn) {
    (this.handlers[name] ||= []).push(fn);
    return this;
  }
  emit(name, ...args) {
    (this.handlers[name] || []).forEach((fn) => fn(...args));
  }
  removeAllListeners() {
    this.handlers = {};
  }
  async startCall({ accessToken }) {
    if (!String(accessToken).startsWith("dev-token-")) return this.emit("error", "fake SDK: unexpected token");
    globalThis.__fakeRetell = { accessToken, client: this };
    setTimeout(() => ((this.connected = true), this.emit("call_started")), 300);
    this.autoEnd = setTimeout(() => this.stopCall(), Number(globalThis.__fakeRetellSeconds || 4) * 1000);
  }
  async startAudioPlayback() {}
  stopCall() {
    clearTimeout(this.autoEnd);
    if (this.connected) (this.connected = false), this.emit("call_ended");
  }
}

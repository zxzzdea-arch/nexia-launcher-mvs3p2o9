const { contextBridge, ipcRenderer } = require("electron");
const INVOKE = ["auth:restore","auth:login","auth:logout","instances:list","instances:install","update:apply","custom:versions","custom:loaders","custom:list","custom:create","custom:delete","custom:open","app:version","library:search","library:install","library:cf-key:status","library:cf-key:set","library:open"];
const ON = ["progress","installed","update-available"];
contextBridge.exposeInMainWorld("nexia", {
  invoke: (ch, ...a) => INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error("blocked")),
  on: (ch, fn) => { if (!ON.includes(ch)) return; ipcRenderer.on(ch, (_e, d) => fn(d)); }
});

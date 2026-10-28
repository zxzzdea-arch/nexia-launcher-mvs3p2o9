const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage } = require("electron");
const path = require("path"), fs = require("fs"), os = require("os");
const { spawn } = require("child_process");
app.setPath("userData", path.join(app.getPath("appData"), "Nexia"));   // คงโฟลเดอร์ข้อมูลเดิม (session/config) แม้เปลี่ยนชื่อแอปเป็น Nexia Launcher
const cfg = { ...require("./config.json"), ...(() => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8")); } catch { return {}; } })() };   // ทดสอบได้โดยวาง config.json ที่ %APPDATA%\Nexia
const discord = require("./lib/discord");
const mc = require("./lib/mc");
const presence = require("./lib/presence");
const library = require("./lib/library");

let win, session = null, instances = [], launcherInfo = null;
const dataDir = () => app.getPath("userData");
const mcDir = () => path.join(app.getPath("appData"), ".minecraft");   // โฟลเดอร์ของ Minecraft Launcher ตัวทางการ
const nexiaDir = () => path.join(app.getPath("appData"), ".nexia");     // Java / instance / mod ของ Nexia
const isInstalledProfile = (id) => {
  if (!fs.existsSync(path.join(nexiaDir(), "instances", id))) return false;
  try { const d = JSON.parse(fs.readFileSync(path.join(mcDir(), "launcher_profiles.json"), "utf8")); return !!(d.profiles && d.profiles["nexia-" + id]); } catch { return false; }
};
const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
const emit = (label, done, total) => send("progress", { label, done, total });
const okStr = (s) => typeof s === "string" && /^[\w.+\-]{1,64}$/.test(s);
const idle = () => presence.set({ details: "Nexia Launcher", state: session ? "กำลังเลือก Instance" : "เปิดแอป" });
const pub = (s) => ({ id: s.id, name: s.name, avatar: s.avatar });

// ---- เก็บ session Discord แบบเข้ารหัส (Windows DPAPI) ----
const tokFile = () => path.join(dataDir(), "auth.bin");
const saveS = (s) => { try { if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(tokFile(), safeStorage.encryptString(JSON.stringify(s))); } catch {} };
const loadS = () => { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(tokFile()))); } catch { return null; } };
const needSession = () => { if (!session || session.expiresAt < Date.now()) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"); return session; };

ipcMain.handle("auth:restore", async () => {
  const s = loadS(); if (!s || s.expiresAt < Date.now()) return null;
  try { session = { ...s, ...(await discord.me(s.token)) }; idle(); return pub(session); } catch { return null; }
});
ipcMain.handle("auth:login", async () => {
  if (!/^\d{15,25}$/.test(String(cfg.discordClientId))) throw new Error("ยังไม่ได้ใส่ discordClientId ใน config.json");
  session = await discord.login(cfg.discordClientId, (u) => shell.openExternal(u)); saveS(session); idle(); return pub(session); });
ipcMain.handle("auth:logout", async () => { session = null; idle(); instances = []; try { fs.rmSync(tokFile(), { force: true }); } catch {} });

// ---- Instance: ดึงจากเว็บเท่านั้น (ต้องอยู่ใน whitelist ตาม Discord ID) ----
ipcMain.handle("instances:list", async () => {
  const s = needSession();
  const r = await fetch(cfg.apiBase + "/api/instances", { method: "POST", headers: { Authorization: "Bearer " + s.token } });
  if (r.status === 401) throw new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่");
  if (!r.ok) throw new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (" + r.status + ")");
  const d = await r.json();
  instances = (d.instances || []).filter((i) => okStr(i.id) && !/^custom-/.test(i.id) && okStr(i.mc) && ["vanilla", "fabric", "forge"].includes(i.loader) && (!i.loaderVersion || okStr(i.loaderVersion)));
  if (d.launcher) checkUpdate(d.launcher);
  const out = await Promise.all(instances.map(async (i) => ({
    id: i.id, name: i.name, mc: i.mc, loader: i.loader, loaderVersion: i.loaderVersion, description: i.description, ramMb: i.ramMb,
    iconUrl: i.iconUrl || i.icon || "", bannerUrl: i.bannerUrl || i.banner || "", coverUrl: i.coverUrl || i.cover || "", gameInstalled: isInstalledProfile(i.id),
    ...(await mc.packInfo(nexiaDir(), i.id, i.packUrl)),
  })));
  return { whitelisted: !!d.whitelisted, id: s.id, name: s.name, instances: out };
});
const profIcon = () => "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "assets", "profile-icon.png")).toString("base64");
async function doInstall(i, ramMb) {
  presence.set({ details: "กำลังติดตั้ง / อัปเดต", state: i.name });
  try { await mc.install({ mcDir: mcDir(), nexiaDir: nexiaDir(), inst: i, ramMb: ramMb || i.ramMb, icon: profIcon(), emit }); } catch (e) { idle(); throw e; }
  presence.set({ details: "พร้อมเล่น", state: i.name });
  send("installed", { name: i.name });
}
ipcMain.handle("instances:install", async (_e, id, ramMb) => {
  needSession();
  const c = loadC().find((x) => x.id === id);
  const i = c || instances.find((x) => x.id === id);        // ใช้เฉพาะ instance ที่ server ส่งมา หรือที่ผู้เล่นสร้างเอง
  if (!i) throw new Error("ไม่พบ instance");
  await doInstall(i, ramMb);
  if (c) saveC(loadC().map((x) => x.id === id ? { ...x, installed: true, ramMb: ramMb || x.ramMb } : x));
});

// ---- สร้าง Instance เอง (เก็บในเครื่อง %APPDATA%\.nexia\custom-instances.json) ----
const LOADERS = ["vanilla", "fabric", "forge"];
const custFile = () => path.join(nexiaDir(), "custom-instances.json");
const validImageUrl = (value) => !value || (typeof value === "string" && value.length <= 2048 && /^https:\/\//i.test(value));
const validC = (i) => i && /^custom-[a-f0-9]{8}$/.test(i.id) && typeof i.name === "string" && okStr(i.mc) && LOADERS.includes(i.loader) && (i.loader === "vanilla" || okStr(i.loaderVersion)) && validImageUrl(i.iconUrl) && validImageUrl(i.bannerUrl) && validImageUrl(i.coverUrl);
const loadC = () => { try { const a = JSON.parse(fs.readFileSync(custFile(), "utf8")); return Array.isArray(a) ? a.filter(validC) : []; } catch { return []; } };
const saveC = (a) => { fs.mkdirSync(nexiaDir(), { recursive: true }); fs.writeFileSync(custFile() + ".tmp", JSON.stringify(a, null, 2)); fs.renameSync(custFile() + ".tmp", custFile()); };

ipcMain.handle("custom:versions", async () => { needSession(); return mc.listMcVersions(); });
ipcMain.handle("custom:loaders", async (_e, mcv, loader) => {
  needSession();
  if (!okStr(mcv) || !LOADERS.includes(loader)) throw new Error("ข้อมูลไม่ถูกต้อง");
  return mc.listLoaderVersions(mcv, loader);
});
ipcMain.handle("custom:list", async () => loadC().map((i) => ({ id: i.id, name: i.name, mc: i.mc, loader: i.loader, loaderVersion: i.loaderVersion, ramMb: i.ramMb, custom: true,
  description: i.description || "Instance ที่สร้างเอง — ใส่ mod เพิ่มได้ที่ Library", iconUrl: i.iconUrl || "", bannerUrl: i.bannerUrl || "", coverUrl: i.coverUrl || "", gameInstalled: isInstalledProfile(i.id), local: i.installed ? "custom" : null, remote: null })));
ipcMain.handle("custom:create", async (_e, f) => {
  needSession();
  f = f || {};
  const name = String(f.name || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
  if (!name) throw new Error("กรุณาตั้งชื่อ Instance");
  if (!okStr(f.mc) || !LOADERS.includes(f.loader)) throw new Error("ข้อมูลไม่ถูกต้อง");
  if (!(await mc.listMcVersions()).includes(f.mc)) throw new Error("ไม่พบเวอร์ชัน Minecraft " + f.mc);
  let loaderVersion;
  if (f.loader !== "vanilla") {
    if (!okStr(f.loaderVersion) || !(await mc.listLoaderVersions(f.mc, f.loader)).includes(f.loaderVersion)) throw new Error("เวอร์ชันของ " + f.loader + " ไม่รองรับกับ Minecraft " + f.mc);
    loaderVersion = f.loaderVersion;
  }
  const all = loadC();
  if (all.length >= 50) throw new Error("สร้างได้สูงสุด 50 Instance");
  const id = "custom-" + require("crypto").randomBytes(4).toString("hex");
  const description = String(f.description || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400);
  const iconUrl = String(f.iconUrl || "").trim(), bannerUrl = String(f.bannerUrl || "").trim(), coverUrl = String(f.coverUrl || "").trim();
  if (![iconUrl, bannerUrl, coverUrl].every(validImageUrl)) throw new Error("Icon / Banner / Cover ต้องเป็นลิงก์ HTTPS ที่ถูกต้อง");
  const rec = { id, name, mc: f.mc, loader: f.loader, ...(loaderVersion ? { loaderVersion } : {}), ramMb: Math.min(Math.max(Math.round(+f.ramMb) || 4096, 1024), 32768), description, iconUrl, bannerUrl, coverUrl, installed: false };
  saveC([...all, rec]);
  return id;
});
ipcMain.handle("custom:delete", async (_e, id) => {
  needSession();
  if (!loadC().some((x) => x.id === id)) throw new Error("ไม่พบ instance");
  saveC(loadC().filter((x) => x.id !== id));
  try { mc.removeProfile(mcDir(), id); } catch {}        // ลบเฉพาะโปรไฟล์/รายการ ไม่ลบโฟลเดอร์เกม (กันโลกหาย)
});
ipcMain.handle("custom:open", async (_e, id) => {
  if (!loadC().some((x) => x.id === id)) throw new Error("ไม่พบ instance");
  const d = path.join(nexiaDir(), "instances", id); fs.mkdirSync(d, { recursive: true });
  const err = await shell.openPath(d); if (err) throw new Error(err);
});

// ---- Library: Modrinth + CurseForge ----
const userConfigFile = () => path.join(dataDir(), "config.json");
ipcMain.handle("library:search", async (_e, options) => {
  needSession();
  return library.search(options, cfg.curseforgeApiKey || "");
});
ipcMain.handle("library:install", async (_e, payload) => {
  needSession();
  const p = payload || {};
  const id = String(p.instanceId || "");
  const custom = loadC().find((x) => x.id === id);
  const inst = custom || instances.find((x) => x.id === id);
  if (!inst) throw new Error("ไม่พบ Instance เป้าหมาย กรุณารีเฟรชรายการก่อน");
  const gameDir = path.join(nexiaDir(), "instances", id);
  let profiles = {};
  try { profiles = JSON.parse(fs.readFileSync(path.join(mcDir(), "launcher_profiles.json"), "utf8")).profiles || {}; } catch {}
  if (!fs.existsSync(gameDir) || !profiles["nexia-" + id]) throw new Error("ต้องติดตั้ง Instance นี้ก่อน จึงจะเพิ่มมอด / Resource Pack / Shader ได้");
  const result = await library.install({ project: p.project, instance: inst, gameDir, apiKey: cfg.curseforgeApiKey || "", emit: (v) => send("progress", v) });
  if (custom) saveC(loadC().map((x) => x.id === id ? { ...x, installed: true } : x));
  return result;
});
ipcMain.handle("library:cf-key:status", async () => ({ configured: !!String(cfg.curseforgeApiKey || "").trim() }));
ipcMain.handle("library:cf-key:set", async (_e, value) => {
  needSession();
  const key = String(value || "").trim();
  if (key.length > 512 || (key && !/^[\x21-\x7E]{16,512}$/.test(key))) throw new Error("รูปแบบ API key ไม่ถูกต้อง");
  cfg.curseforgeApiKey = key;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(userConfigFile(), "utf8")); } catch {}
  if (key) saved.curseforgeApiKey = key; else delete saved.curseforgeApiKey;
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(userConfigFile(), JSON.stringify(saved, null, 2));
  return { configured: !!key };
});
ipcMain.handle("library:open", async (_e, url) => { await shell.openExternal(library.openableProjectUrl(String(url || ""))); });

// ---- อัปเดตตัว installer (portable exe) ----
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
function checkUpdate(info) {
  if (info && info.version && /^https:\/\//.test(info.url || "") && newer(info.version, app.getVersion())) { launcherInfo = info; send("update-available", { version: info.version, notes: info.notes || "" }); }
}
ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("update:apply", async () => {
  if (!launcherInfo) return;
  const tmp = path.join(os.tmpdir(), "Nexia-setup.exe");                       // ติดตั้งทับเวอร์ชันเดิม (setup เดียวกับที่แจกตอนแรก)
  const r = await fetch(launcherInfo.url);
  if (!r.ok) throw new Error("โหลดอัปเดตไม่ได้ (" + r.status + ")");
  fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
  spawn(tmp, [], { detached: true, stdio: "ignore" }).unref();
  app.quit();
});

// ---- window ----
function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 980, height: 640, minWidth: 820, minHeight: 560, title: "Nexia Launcher", backgroundColor: "#000000",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("context-menu", (e) => e.preventDefault());
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { createWindow(); if (cfg.presence !== false) { presence.init(cfg.discordClientId); idle(); } });
app.on("before-quit", () => presence.stop());
app.on("window-all-closed", () => app.quit());

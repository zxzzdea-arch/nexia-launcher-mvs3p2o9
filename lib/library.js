const fs = require('fs');
const path = require('path');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const CURSEFORGE_API = 'https://api.curseforge.com/v1';
const TYPES = {
  mods: { modrinth: 'mod', curseforge: 6, folder: 'mods' },
  resourcepacks: { modrinth: 'resourcepack', curseforge: 12, folder: 'resourcepacks' },
  shaders: { modrinth: 'shader', curseforge: 4546, folder: 'shaderpacks' },
};
const LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'liteloader']);
const safeHttps = (v) => typeof v === 'string' && /^https:\/\//i.test(v);
const apiJson = async (url, headers = {}) => {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'NexiaLauncher/0.4.0', ...headers } });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('API ปฏิเสธคำขอ (' + r.status + ') — ตรวจสอบ CurseForge API key หรือสิทธิ์การเข้าถึง');
    if (r.status === 404) throw new Error('ไม่พบข้อมูลหรือเวอร์ชันที่ร้องขอ');
    throw new Error('เชื่อมต่อคลังมอดไม่ได้ (' + r.status + ')');
  }
  return r.json();
};
const normalizeInput = (o = {}) => {
  const type = String(o.type || 'mods');
  const source = String(o.source || 'modrinth').toLowerCase();
  const query = String(o.query || '').trim().slice(0, 120);
  const gameVersion = String(o.gameVersion || '').trim();
  const loader = String(o.loader || '').toLowerCase();
  if (!TYPES[type]) throw new Error('ประเภท Library ไม่ถูกต้อง');
  if (!['modrinth', 'curseforge'].includes(source)) throw new Error('แหล่งข้อมูลไม่ถูกต้อง');
  if (gameVersion && !/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/.test(gameVersion)) throw new Error('รูปแบบเวอร์ชัน Minecraft ไม่ถูกต้อง');
  if (loader && loader !== 'any' && !LOADERS.has(loader)) throw new Error('Loader ไม่ถูกต้อง');
  return { type, source, query, gameVersion, loader: loader === 'any' ? '' : loader };
};

async function searchModrinth(o) {
  const facets = [[`project_type:${TYPES[o.type].modrinth}`]];
  if (o.gameVersion) facets.push([`versions:${o.gameVersion}`]);
  if (o.loader && o.type === 'mods') facets.push([`categories:${o.loader}`]);
  const p = new URLSearchParams({ query: o.query, facets: JSON.stringify(facets), limit: '24', index: 'downloads' });
  const d = await apiJson(`${MODRINTH_API}/search?${p}`);
  return (d.hits || []).map((x) => ({
    id: String(x.project_id), source: 'modrinth', type: o.type, title: x.title || 'Untitled',
    description: x.description || '', author: x.author || 'Unknown', downloads: Number(x.downloads) || 0,
    iconUrl: safeHttps(x.icon_url) ? x.icon_url : '',
    coverUrl: safeHttps(x.icon_url) ? x.icon_url : '',
    bannerUrl: safeHttps(x.featured_gallery) ? x.featured_gallery : (Array.isArray(x.gallery) && safeHttps(x.gallery[0]) ? x.gallery[0] : ''),
    url: `https://modrinth.com/${TYPES[o.type].modrinth}/${encodeURIComponent(x.slug || x.project_id)}`,
  }));
}

async function searchCurseForge(o, apiKey) {
  if (!apiKey) throw new Error('ต้องใส่ CurseForge API key ก่อนค้นหา CurseForge');
  const p = new URLSearchParams({ gameId: '432', classId: String(TYPES[o.type].curseforge), pageSize: '24', sortField: '2', sortOrder: 'desc' });
  if (o.query) p.set('searchFilter', o.query); else if (o.type === 'shaders') p.set('searchFilter', 'shader');
  if (o.gameVersion) p.set('gameVersion', o.gameVersion);
  const loaderIds = { forge: 1, fabric: 4, quilt: 5, neoforge: 6, liteloader: 3 };
  if (o.loader && o.type === 'mods' && loaderIds[o.loader]) p.set('modLoaderType', String(loaderIds[o.loader]));
  const d = await apiJson(`${CURSEFORGE_API}/mods/search?${p}`, { 'x-api-key': apiKey });
  return (d.data || []).map((x) => {
    const cats = Array.isArray(x.categories) ? x.categories.map((c) => String(c.name || '')) : [];
    return {
      id: String(x.id), source: 'curseforge', type: o.type, title: x.name || 'Untitled',
      description: x.summary || '', author: (x.authors || []).map((a) => a.name).filter(Boolean).join(', ') || 'Unknown',
      downloads: Number(x.downloadCount) || 0,
      iconUrl: safeHttps(x.logo && x.logo.url) ? x.logo.url : '',
      coverUrl: safeHttps(x.logo && x.logo.url) ? x.logo.url : '',
      bannerUrl: Array.isArray(x.screenshots) && safeHttps(x.screenshots[0] && x.screenshots[0].url) ? x.screenshots[0].url : '',
      url: safeHttps(x.links && x.links.websiteUrl) ? x.links.websiteUrl : `https://www.curseforge.com/minecraft/${o.type === 'mods' ? 'mc-mods' : o.type === 'resourcepacks' ? 'texture-packs' : 'customization'}/${encodeURIComponent(x.slug || x.id)}`,
      categories: cats,
    };
  }).filter((x) => {
    // CurseForge places shader packs in the broader Customization class.
    if (o.type !== 'shaders') return true;
    return x.categories.some((c) => /shader/i.test(c)) || /shader/i.test(x.title + ' ' + x.description);
  });
}

async function search(raw, apiKey) {
  const o = normalizeInput(raw);
  return o.source === 'modrinth' ? searchModrinth(o) : searchCurseForge(o, apiKey);
}

function fileNameSafe(name) {
  const base = path.basename(String(name || 'download.bin')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
  if (!base || base === '.' || base === '..') return 'download.bin';
  return base;
}
async function downloadTo(url, dest) {
  if (!safeHttps(url)) throw new Error('ลิงก์ดาวน์โหลดไม่ใช่ HTTPS');
  const r = await fetch(url, { headers: { 'User-Agent': 'NexiaLauncher/0.4.0' } });
  if (!r.ok || !safeHttps(r.url || url)) throw new Error('ดาวน์โหลดไฟล์ไม่ได้ (' + r.status + ')');
  const len = Number(r.headers.get('content-length') || 0);
  if (len > 500 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกินขีดจำกัด 500 MB');
  const data = Buffer.from(await r.arrayBuffer());
  if (!data.length || data.length > 500 * 1024 * 1024) throw new Error('ไฟล์ดาวน์โหลดว่างหรือมีขนาดเกิน 500 MB');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.nexia-tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}
function chooseModrinthFile(version) {
  const files = Array.isArray(version && version.files) ? version.files : [];
  return files.find((f) => f.primary && safeHttps(f.url)) || files.find((f) => safeHttps(f.url));
}
async function modrinthVersion(projectId, gameVersion, loader, forceType = 'mods') {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (loader && forceType === 'mods') params.set('loaders', JSON.stringify([loader]));
  const list = await apiJson(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version${params.size ? `?${params}` : ''}`);
  const compatible = (list || []).filter((v) => (v.version_type || 'release') === 'release' && chooseModrinthFile(v));
  return compatible[0] || (list || []).find((v) => chooseModrinthFile(v)) || null;
}
async function curseForgeFile(modId, gameVersion, loader, apiKey, type) {
  if (!apiKey) throw new Error('ต้องใส่ CurseForge API key ก่อนติดตั้งไฟล์จาก CurseForge');
  const p = new URLSearchParams({ gameVersion, pageSize: '50' });
  const loaderIds = { forge: 1, fabric: 4, quilt: 5, neoforge: 6, liteloader: 3 };
  if (loader && type === 'mods' && loaderIds[loader]) p.set('modLoaderType', String(loaderIds[loader]));
  const d = await apiJson(`${CURSEFORGE_API}/mods/${encodeURIComponent(modId)}/files?${p}`, { 'x-api-key': apiKey });
  const files = Array.isArray(d.data) ? d.data : [];
  return files.find((f) => (f.gameVersions || []).includes(gameVersion) && f.downloadUrl) || files.find((f) => f.downloadUrl) || null;
}
async function install({ project, instance, gameDir, apiKey, emit = () => {} }) {
  if (!project || !['modrinth', 'curseforge'].includes(project.source) || !TYPES[project.type]) throw new Error('ข้อมูล Project ไม่ถูกต้อง');
  const id = String(project.id || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('Project ID ไม่ถูกต้อง');
  if (!instance || !/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/.test(String(instance.mc || ''))) throw new Error('Instance ไม่มีเวอร์ชัน Minecraft ที่ถูกต้อง');
  const gameVersion = String(instance.mc);
  const loader = LOADERS.has(String(instance.loader || '').toLowerCase()) ? String(instance.loader).toLowerCase() : '';
  if ((project.type === 'mods' || project.type === 'shaders') && !loader) throw new Error(project.type === 'mods' ? 'มอดต้องใช้ Instance ที่มี Fabric / Forge / NeoForge / Quilt ไม่รองรับ Vanilla' : 'Shaders ต้องใช้ Instance ที่มีระบบ Loader ก่อน');
  const folder = path.join(gameDir, TYPES[project.type].folder);
  fs.mkdirSync(folder, { recursive: true });
  const installed = new Set();
  const maxFiles = 24;
  let count = 0;

  const installModrinthProject = async (projectId, type, depth = 0, forcedVersionId = '') => {
    if (depth > 6) return;
    const key = `mr:${projectId}`;
    if (installed.has(key)) return;
    installed.add(key);
    const version = forcedVersionId ? await apiJson(`${MODRINTH_API}/version/${encodeURIComponent(forcedVersionId)}`) : await modrinthVersion(projectId, gameVersion, loader, type);
    if (version && version.project_id && version.project_id !== projectId) throw new Error('Dependency version/project ID ไม่ตรงกัน');
    if (!version) throw new Error(`ไม่พบเวอร์ชันที่รองรับ Minecraft ${gameVersion} (${projectId})`);
    const f = chooseModrinthFile(version);
    if (!f) throw new Error('Project นี้ไม่มีไฟล์ดาวน์โหลด');
    if (++count > maxFiles) throw new Error('มีไฟล์หรือ Library ที่ต้องติดตั้งมากเกินขีดจำกัด');
    emit({ label: `กำลังโหลด ${f.filename || projectId}`, done: count - 1, total: maxFiles });
    await downloadTo(f.url, path.join(folder, fileNameSafe(f.filename || `${projectId}.jar`)));
    // Required dependencies are fetched only for mods; optional dependencies remain optional.
    if (type === 'mods') {
      for (const dep of (version.dependencies || []).filter((x) => x.dependency_type === 'required')) {
        if (dep.project_id) await installModrinthProject(dep.project_id, 'mods', depth + 1);
        else if (dep.version_id) {
          const depV = await apiJson(`${MODRINTH_API}/version/${encodeURIComponent(dep.version_id)}`);
          if (depV && depV.project_id) await installModrinthProject(depV.project_id, 'mods', depth + 1, dep.version_id);
        }
      }
    }
    return f.filename || `${projectId}.jar`;
  };

  const installCurseForgeProject = async (modId, type, depth = 0) => {
    if (depth > 6) return;
    const key = `cf:${modId}`;
    if (installed.has(key)) return;
    installed.add(key);
    const file = await curseForgeFile(modId, gameVersion, loader, apiKey, type);
    if (!file) throw new Error(`ไม่พบไฟล์ CurseForge ที่ดาวน์โหลดได้สำหรับ Minecraft ${gameVersion}; ลองเปิดหน้าโปรเจกต์เพื่อตรวจสอบไฟล์`);
    const url = file.downloadUrl;
    if (!safeHttps(url)) throw new Error('CurseForge ไม่ได้ให้ลิงก์ดาวน์โหลดโดยตรงสำหรับไฟล์นี้ โปรดใช้หน้าโปรเจกต์ของผู้สร้าง');
    if (++count > maxFiles) throw new Error('มีไฟล์หรือ Library ที่ต้องติดตั้งมากเกินขีดจำกัด');
    const name = file.fileName || file.displayName || `${modId}.jar`;
    emit({ label: `กำลังโหลด ${name}`, done: count - 1, total: maxFiles });
    await downloadTo(url, path.join(folder, fileNameSafe(name)));
    if (type === 'mods') {
      for (const dep of (file.dependencies || []).filter((x) => Number(x.relationType) === 3)) {
        if (dep.modId) await installCurseForgeProject(String(dep.modId), 'mods', depth + 1);
      }
    }
    return name;
  };

  const name = project.source === 'modrinth'
    ? await installModrinthProject(id, project.type)
    : await installCurseForgeProject(id, project.type);
  emit({ label: 'ติดตั้งไฟล์เสร็จแล้ว', done: count, total: Math.max(count, 1) });
  return { title: String(project.title || name || 'Project').slice(0, 150), fileName: name, type: project.type, count };
}

function openableProjectUrl(value) {
  if (!safeHttps(value)) throw new Error('ลิงก์ Project ไม่ถูกต้อง');
  const u = new URL(value);
  if (!['modrinth.com', 'www.modrinth.com', 'curseforge.com', 'www.curseforge.com'].includes(u.hostname)) throw new Error('อนุญาตให้เปิดได้เฉพาะหน้า Modrinth หรือ CurseForge');
  return u.toString();
}

module.exports = { search, install, openableProjectUrl };

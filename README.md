# Nexia Launcher

ตัวติดตั้ง Instance ลง **Minecraft Launcher ตัวทางการ** · Windows x64 · ธีมขาวดำ
Nexia ไม่ล็อกอิน Minecraft และไม่เปิดเกมเอง ทำแค่: ติดตั้ง Fabric/Forge → โหลด/อัปเดต mod → เพิ่มโปรไฟล์ `Nexia · <ชื่อ>` ลง `%APPDATA%\.minecraft\launcher_profiles.json` ผู้เล่นกด Play ในตัวทางการ

## 1) Discord login (ไม่ต้องรออนุมัติ)
1. https://discord.com/developers/applications → New Application
2. OAuth2 → Redirects → เพิ่ม `http://127.0.0.1:53682/callback` (ต้องตรงเป๊ะ)
3. คัดลอก **Client ID** ใส่ `config.json` → `discordClientId` (ไม่ต้องใช้ Client Secret)

### Discord Rich Presence (สถานะในดิสคอร์ด)
แอปตั้งสถานะผ่านแอป Discord บนเครื่อง (ต้องเปิด Discord อยู่) เช่น "Nexia · กำลังเลือก Instance", "กำลังติดตั้ง / อัปเดต · <ชื่อ>", "พร้อมเล่น"
อยากได้รูปในสถานะ: Developer Portal → Rich Presence → Art Assets → อัปโหลด `assets/icon.png` ตั้งชื่อ asset ว่า `nexia` (และตั้งชื่อ Application เป็น **Nexia Launcher** เพื่อให้สถานะขึ้นว่า "Playing Nexia Launcher")
ปิดได้ด้วย `"presence": false` ใน config.json

### สร้าง Instance เอง (ใหม่ใน 0.3.0)
กดปุ่ม **+ สร้าง Instance** ที่หน้าหลัก → ตั้งชื่อ, เลือกเวอร์ชัน Minecraft, Loader (Fabric / Forge / Vanilla) + เวอร์ชัน Loader, RAM → กด "ติดตั้ง" ที่การ์ด แล้วไปกด Play ใน Minecraft Launcher
- รายการเวอร์ชันดึงสดจาก Mojang / Fabric Meta / Forge Maven (Forge เฉพาะ MC 1.13+)
- เก็บรายการไว้ที่ `%APPDATA%\.nexia\custom-instances.json` · ไฟล์เกมอยู่ที่ `%APPDATA%\.nexia\instances\custom-xxxxxxxx`
- ปุ่ม "เปิดโฟลเดอร์" ใช้วาง mod / resourcepack เอง · ปุ่ม "ลบ" ลบแค่รายการ + โปรไฟล์ใน Launcher (โฟลเดอร์เกม/โลกไม่ถูกลบ)
- ต้องล็อกอิน Discord ก่อน แต่ไม่ต้องอยู่ใน whitelist

## Library (ใหม่ใน 0.4.0)
- หน้า Library ค้นหา **Mods / Libraries**, **Resource Packs** และ **Shaders** จาก Modrinth หรือ CurseForge
- เลือก Instance ที่ติดตั้งแล้ว แล้วกด **ติดตั้งทันที** เพื่อให้ไฟล์ลงโฟลเดอร์ `mods`, `resourcepacks` หรือ `shaderpacks` ที่ตรงประเภท
- สำหรับ Modrinth จะเลือกไฟล์เวอร์ชันที่รองรับ Minecraft/Loader ของ Instance และพยายามติดตั้ง dependencies ที่ระบุว่า Required
- CurseForge ต้องใช้ API key ที่ได้รับอนุญาตจาก CurseForge ก่อน คีย์ตั้งค่าได้ใน Library → “ตั้งค่า CurseForge API” และเก็บใน `%APPDATA%\Nexia\config.json` ของเครื่องนี้ อย่าแชร์ไฟล์ config นี้หากบันทึก API key ไว้
- ขอสิทธิ์ API จากเอกสารทางการ: https://support.curseforge.com/support/solutions/articles/9000208346 — หาก CurseForge ไม่ให้ลิงก์ดาวน์โหลดโดยตรง แอปจะไม่พยายามข้ามข้อจำกัด ให้เปิดหน้าโปรเจกต์เพื่อดูตัวเลือกจากผู้สร้าง
- ตอนสร้าง Instance สามารถตั้ง Description, Icon URL, Cover URL และ Banner URL ได้ รูปต้องเป็นลิงก์ `https://` ส่วน Instance ที่มาจาก backend สามารถส่งฟิลด์ `description`, `iconUrl`, `coverUrl`, `bannerUrl` มาด้วยได้

## 2) Backend (whitelist + instance)
`POST {apiBase}/api/instances` ส่ง `Authorization: Bearer <Discord access token>`
Backend เรียก `GET https://discord.com/api/v10/users/@me` เพื่อยืนยันตัวตน แล้วเช็ก whitelist ด้วย **Discord ID** ตอบ
`{ "whitelisted": true, "instances": [{id,name,mc,loader,loaderVersion,packUrl,ramMb,description}], "launcher": {version,url,notes} }`
(ฟอร์แมต pack เหมือนเดิม: `{version, files:[{path,url,sha1}], delete:[]}`)

## 3) Build เป็น setup
`npm i && npm run dist` → ได้ `dist/Nexia-Launcher_<version>_x64-setup.exe` (NSIS wizard ติดตั้งแบบ per-user ไม่ต้องใช้สิทธิ์ admin เลือกโฟลเดอร์ได้ มีทางลัด Desktop/Start Menu และตัวถอนการติดตั้ง)
ถ้า build ผ่านเว็บ html-to-exe ต้องตั้งให้รัน `electron-builder --win nsis --x64` ไม่ใช่ portable

## หมายเหตุ
- ให้ผู้เล่น **ปิด Minecraft Launcher ก่อนติดตั้ง** ไม่งั้นตัวทางการอาจเขียนทับ `launcher_profiles.json` (Nexia สำรองไว้ที่ `.nexia.bak`)
- Java/instance/mod เก็บที่ `%APPDATA%\.nexia` · mod ที่ Nexia เคยลงแต่ถูกถอดออกจาก pack จะถูกลบตอนอัปเดต ส่วนไฟล์ที่ผู้เล่นเพิ่มเองไม่ถูกแตะ
- Forge เฉพาะ MC 1.13+ · ยังไม่มี NeoForge · ยังไม่ได้ทดสอบบน Windows จริง

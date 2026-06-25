# คู่มือการติดตั้งและใช้งาน (แบบมีเซิร์ฟเวอร์)

เอกสารนี้สำหรับระบบ Toyota Follow-Up Service เวอร์ชัน `ProjectWithServer` (Flask + SQLite)

รองรับ 2 วิธีการรัน:
1. รันแบบปกติด้วย Python
2. รันด้วย Docker

---

## 1) ภาพรวมระบบ

โครงสร้างหลัก:
- `run.py` — ไฟล์เริ่มต้นสำหรับรันเซิร์ฟเวอร์
- `app/__init__.py` — สร้าง Flask app และลงทะเบียน routes
- `app/database.py` — การเชื่อมต่อ/สร้าง schema SQLite
- `app/routes/` — API และหน้าเว็บหลัก
- `app/templates/index.html` — หน้าเว็บหลัก
- `app/static/` — CSS/JavaScript ฝั่งหน้าเว็บ
- `tmt_database.db` — ไฟล์ฐานข้อมูลหลักของระบบ

---

## 2) ข้อกำหนดก่อนใช้งาน

### สำหรับการรันแบบ Python
- Python 3.11+
- pip

### สำหรับการรันแบบ Docker
- Docker Desktop หรือ Docker Engine

---

## 3) วิธีติดตั้งและรัน (Python ปกติ)

1. เปิด terminal ที่โฟลเดอร์ `ProjectWithServer`
2. สร้าง virtual environment

```bash
python -m venv .venv
```

3. เปิดใช้งาน virtual environment

**Windows (PowerShell):**
```powershell
.\.venv\Scripts\Activate.ps1
```

**Windows (cmd):**
```cmd
.\.venv\Scripts\activate.bat
```

**macOS/Linux:**
```bash
source .venv/bin/activate
```

4. ติดตั้ง dependencies

```bash
pip install -r requirements.txt
```

5. รันระบบ

```bash
python run.py
```

6. เปิดเบราว์เซอร์ที่:

```text
http://localhost:5000
```

---

## 4) วิธีติดตั้งและรัน (Docker)

1. เปิด terminal ที่โฟลเดอร์ `ProjectWithServer`
2. สร้าง image

```bash
docker build -t toyota-followup-server .
```

3. รัน container

```bash
docker run --rm -p 5000:5000 toyota-followup-server
```

4. เปิดเบราว์เซอร์ที่:

```text
http://localhost:5000
```

> ⚠️ **Warning:** หากพอร์ต `5000` ถูกใช้งานอยู่ ให้เปลี่ยนฝั่ง host เช่น `-p 5001:5000` แล้วเปิด `http://localhost:5001`

---

## 5) การใช้งานระบบ

### 5.1 เริ่มต้น
- เมื่อเปิดหน้าเว็บ ระบบอยู่ในสถานะ Online และบันทึกผ่านเซิร์ฟเวอร์
- สามารถนำเข้าข้อมูลได้จากแท็บ **System Management**

### 5.2 การทำงานหลัก
- **Sales Overview:** ดู KPI และสรุปผลงาน SA
- **SA Workspace:** ติดตามงาน, บันทึกวันติดต่อลูกค้า, อัปเดตสถานะรายการ
- **Promotion Jobs:** ติดตามงานที่เกี่ยวกับอะไหล่โปรโมชัน
- **Customer Appointments:** ดูรายการนัดหมายและ Export Excel
- **System Management:** Import ข้อมูลจากไฟล์ Excel/CSV

### 5.3 การบันทึกข้อมูล
- เวอร์ชันเซิร์ฟเวอร์จะบันทึกผ่าน API (`/api/save-followup`, `/api/bulk-save`, `/api/import-*`) ลง SQLite โดยตรง
- ไม่ต้องกด Save Database แบบเวอร์ชัน Local

---

## 6) การตั้งค่าและฐานข้อมูล

- ไฟล์ฐานข้อมูลหลัก: `tmt_database.db`
- การตั้งค่าอยู่ที่ `app/config.py`
- ระบบจะสร้างตารางที่จำเป็นอัตโนมัติเมื่อเริ่มรันแอป

---

## 7) ตรวจสอบการทำงานเบื้องต้น

1. เปิดหน้า `http://localhost:5000`
2. เข้าแท็บ **System Management** แล้วนำเข้าไฟล์ตัวอย่าง
3. กลับไปดู Dashboard ว่าข้อมูลแสดงผล
4. ลองบันทึก Follow-up หรือวันนัดหมายจากหน้า Workspace
5. รีเฟรชหน้าเว็บเพื่อตรวจว่าข้อมูลยังคงอยู่

---

## 8) ปัญหาที่พบบ่อย

### รันไม่ได้เพราะไม่พบ Flask
- ตรวจว่าเปิดใช้งาน virtual environment แล้ว
- รัน `pip install -r requirements.txt` ใหม่

### เปิดเว็บไม่ได้
- ตรวจว่าเซิร์ฟเวอร์ยังทำงานอยู่
- ตรวจพอร์ตที่ใช้ (`5000`)

### Docker รันแล้วชนพอร์ต
- เปลี่ยนพอร์ต host เช่น `-p 5001:5000`

### ข้อมูลไม่อัปเดตหลังกดบันทึก
- ตรวจ console log ของ backend และ browser developer tools
- ตรวจว่า API ตอบกลับ `status: success`

---

## 9) ข้อควรระวังด้านความปลอดภัย

- ควรใช้โหมด production เมื่อนำขึ้นใช้งานจริง
- ไม่ควรเปิด debug mode บน environment จริง
- จำกัดการเข้าถึงเซิร์ฟเวอร์และไฟล์ฐานข้อมูลให้เหมาะสม

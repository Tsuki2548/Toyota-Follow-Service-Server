import os
import sys

# เช็คว่ารันเป็น .exe หรือรันเป็นไฟล์ .py ปกติ
if getattr(sys, "frozen", False):
    # ถ้ารันเป็น .exe (โดย PyInstaller) ให้ดึง Path จากโฟลเดอร์ที่ตัว .exe วางอยู่
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # ถ้ารันโค้ดปกติ ให้ดึง Path แบบเดิมของคุณ
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "toyota-follow-up-secret-key-123")
    # นำ BASE_DIR มาต่อกับชื่อไฟล์ฐานข้อมูล
    DB_NAME = os.path.join(BASE_DIR, "tmt_database.db")
    DB_TIMEOUT = 10.0

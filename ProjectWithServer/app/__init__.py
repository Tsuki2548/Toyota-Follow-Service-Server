import os
import sys

from flask import Flask

from app.config import Config
from app.database import init_db


# 1. เพิ่มฟังก์ชัน resource_path สำหรับจัดการ Path ตอนเป็น .exe
def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)


def create_app():
    # 2. แก้ไขการประกาศ Flask ให้ชี้ไปที่โฟลเดอร์ผ่านฟังก์ชัน resource_path
    app = Flask(
        __name__,
        template_folder=resource_path("app/templates"),
        static_folder=resource_path("app/static"),
    )

    app.config.from_object(Config)

    # Initialize DB schemas safely
    init_db(app)

    # Register blueprints
    from app.routes.api_followup import followup_bp
    from app.routes.api_import import import_bp
    from app.routes.api_query import query_bp
    from app.routes.main import main_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(query_bp)
    app.register_blueprint(followup_bp)
    app.register_blueprint(import_bp)

    return app

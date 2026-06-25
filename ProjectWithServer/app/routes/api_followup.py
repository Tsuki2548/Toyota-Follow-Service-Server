from datetime import datetime

from flask import Blueprint, jsonify, request

from app.database import get_db_connection

followup_bp = Blueprint("api_followup", __name__)


@followup_bp.route("/api/save-followup", methods=["POST"])
def api_save_followup():
    data = request.json
    job_no = data.get("jobNo")
    attempt_no = data.get("attemptNo")
    appt_date = data.get("apptDate")
    next_date = data.get("nextDate")
    call_result = data.get("callResult", "")
    contact_person = data.get("contactPerson", "")
    contact_relation = data.get("contactRelation", "")
    notes = data.get("notes", "")
    items = data.get("items", [])

    call_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    today_str = datetime.now().strftime("%Y-%m-%d")

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()

            # ตรวจสอบว่า record การติดตามรอบนี้มีอยู่หรือไม่ (เพื่อรองรับการกดแก้ไขงานที่เสร็จสิ้นแล้ว)
            cursor.execute(
                "SELECT 1 FROM Follow_Ups WHERE job_order_no=? AND attempt_number=?",
                (job_no, attempt_no),
            )
            exists = cursor.fetchone()

            if exists:
                # ถ้ารอบติดตามมีอยู่แล้ว (เช่น งาน PENDING ปกติ) ให้ทำการอัปเดต
                cursor.execute(
                    """
                    UPDATE Follow_Ups
                    SET call_result=?, contact_person=?, contact_relation=?, notes=?, call_time=?, appointment_date=?
                    WHERE job_order_no=? AND attempt_number=?
                """,
                    (
                        call_result,
                        contact_person,
                        contact_relation,
                        notes,
                        call_time,
                        appt_date,
                        job_no,
                        attempt_no,
                    ),
                )
            else:
                # ถ้ารอบการติดตามยังไม่มี (เช่น กรณีใบงาน COMPLETED แล้วถูกแก้สถานะ) ให้สร้างเรคคอร์ดใหม่เก็บประวัติไว้
                cursor.execute(
                    """
                    INSERT INTO Follow_Ups (job_order_no, attempt_number, call_result, contact_person, contact_relation, notes, call_time, appointment_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        job_no,
                        attempt_no,
                        call_result,
                        contact_person,
                        contact_relation,
                        notes,
                        call_time,
                        appt_date,
                    ),
                )

            # หากมีแผนติดตามครั้งต่อไป ให้ตั้งค่ารอไว้
            if next_date:
                cursor.execute(
                    """
                    INSERT INTO Follow_Ups (job_order_no, attempt_number, next_contact_date, notes)
                    VALUES (?, ?, ?, ?)
                """,
                    (job_no, attempt_no + 1, next_date, ""),
                )

            # อัปเดตสถานะของไอเทมทีละรายการตามที่เลือกแบบ Checkbox
            for item in items:
                item_id = item["itemId"]
                new_status = item["newStatus"]
                old_status = item["oldStatus"]

                if new_status == "APPROVED" and old_status != "APPROVED":
                    cursor.execute(
                        "UPDATE Job_Order_Items SET sa_status=?, sa_approved_date=? WHERE item_id=?",
                        (new_status, today_str, item_id),
                    )
                elif new_status != "APPROVED":
                    cursor.execute(
                        "UPDATE Job_Order_Items SET sa_status=?, sa_approved_date=NULL WHERE item_id=?",
                        (new_status, item_id),
                    )
                else:
                    cursor.execute(
                        "UPDATE Job_Order_Items SET sa_status=? WHERE item_id=?",
                        (new_status, item_id),
                    )

            conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@followup_bp.route("/api/bulk-save", methods=["POST"])
def api_bulk_save():
    data = request.json
    jobs = data.get("jobs", [])
    next_date = data.get("nextDate")
    notes = data.get("notes", "")
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            for job in jobs:
                job_no = job["jobNo"]
                next_att = job["attemptNo"] + 1
                cursor.execute(
                    "INSERT INTO Follow_Ups (job_order_no, attempt_number, next_contact_date, notes) VALUES (?, ?, ?, ?)",
                    (job_no, next_att, next_date, notes),
                )
            conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

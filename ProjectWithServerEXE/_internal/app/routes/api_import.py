from flask import Blueprint, jsonify, request

from app.database import get_db_connection

import_bp = Blueprint("api_import", __name__)


@import_bp.route("/api/import-jobs", methods=["POST"])
def api_import_jobs():
    payload = request.get_json(silent=True) or {}
    rows = payload.get("rows", [])
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            # อ้างอิงตามลำดับคอลัมน์ (Index เริ่มจาก 0)
            COL = {
                "dealerCode": 0,  # A
                "dealerName": 1,  # B
                "jobOrderNo": 6,  # G
                "jobOrderDate": 7,  # H
                "vinNo": 9,  # J
                "vehicleRegNo": 10,  # K
                "model": 11,  # L
                "series": 12,  # M
                "mileageIn": 13,  # N
                "contactName": 17,  # R
                "telNo": 18,  # S
                "quotationDate": 20,  # U
                "quotationByName": 23,  # X
                "itemType": 25,  # Z (เก็บข้อมูล P หรือ O)
                "operationCode": 26,  # AA
                "operationDesc": 27,  # AB
                "flatRateQty": 28,  # AC
                "dealerUnitCost": 30,  # AE
                "invoiceAmount": 32,  # AG
                "statusByItem": 36,  # AK
                "status": 37,  # AL
                "technicianMessage": 38,  # AM
                "rejectReason": 40,  # AO
            }

            def get_cell(row, idx):
                try:
                    return row[idx] if idx < len(row) else ""
                except TypeError:
                    return ""

            for row in rows:
                # ตรวจสอบว่าเป็น list/tuple เท่านั้น (ทิ้งการอ่านแบบ Dict เพราะเราจะอ่านตาม Index)
                if isinstance(row, (list, tuple)):
                    if not row:
                        continue

                    jOrder = str(get_cell(row, COL["jobOrderNo"]) or "").strip()
                    if not jOrder:
                        continue

                    dCode = str(get_cell(row, COL["dealerCode"]) or "-").strip() or "-"
                    dName = str(get_cell(row, COL["dealerName"]) or "-").strip() or "-"
                    cName = str(get_cell(row, COL["contactName"]) or "-").strip() or "-"
                    cTel_raw = get_cell(row, COL["telNo"])
                    cTel = str(cTel_raw).strip() if cTel_raw not in (None, "") else "-"

                    vVin = str(get_cell(row, COL["vinNo"]) or "-").strip() or "-"
                    vReg = str(get_cell(row, COL["vehicleRegNo"]) or "-").strip() or "-"
                    vMod = str(get_cell(row, COL["model"]) or "-").strip() or "-"
                    vSer = str(get_cell(row, COL["series"]) or "-").strip() or "-"

                    eName = (
                        str(get_cell(row, COL["quotationByName"]) or "-").strip() or "-"
                    )

                    # ข้อมูลประเภทรายการอะไหล่/บริการ (P หรือ O)
                    iType = str(get_cell(row, COL["itemType"]) or "").strip()

                    pCodeRaw = (
                        str(get_cell(row, COL["operationCode"]) or "-").strip() or "-"
                    )
                    pDesc = (
                        str(get_cell(row, COL["operationDesc"]) or "-").strip() or "-"
                    )

                    jDate = get_cell(row, COL["jobOrderDate"]) or None
                    qDate = get_cell(row, COL["quotationDate"]) or None
                    jStat = get_cell(row, COL["status"]) or ""
                    iStat = get_cell(row, COL["statusByItem"]) or ""
                    rRea = get_cell(row, COL["rejectReason"]) or None
                    tMsg = get_cell(row, COL["technicianMessage"]) or None

                    try:
                        dCost = float(
                            str(get_cell(row, COL["dealerUnitCost"]) or "0").replace(
                                ",", ""
                            )
                        )
                    except (TypeError, ValueError):
                        dCost = 0.0
                    try:
                        fQty = float(
                            str(get_cell(row, COL["flatRateQty"]) or "0").replace(
                                ",", ""
                            )
                        )
                    except (TypeError, ValueError):
                        fQty = 0.0
                    try:
                        inv = float(
                            str(get_cell(row, COL["invoiceAmount"]) or "0").replace(
                                ",", ""
                            )
                        )
                    except (TypeError, ValueError):
                        inv = 0.0
                    try:
                        mil = int(get_cell(row, COL["mileageIn"]) or 0)
                    except (TypeError, ValueError):
                        mil = 0
                else:
                    continue

                # จัดการรูปแบบ Part No.
                pCodeNorm = pCodeRaw.strip()
                if pCodeNorm.startswith("A-") or pCodeNorm.startswith("a-"):
                    pCodeNorm = pCodeNorm[2:].replace("-", "")
                elif "-" in pCodeNorm and len(pCodeNorm.split("-")[0]) == 1:
                    pCodeNorm = pCodeNorm[2:].replace("-", "")

                cursor.execute(
                    "INSERT OR IGNORE INTO Dealers (dealer_code, dealer_name) VALUES (?,?)",
                    (dCode, dName),
                )
                cursor.execute(
                    "INSERT OR IGNORE INTO Customers (contact_name, tel_no) VALUES (?,?)",
                    (cName, cTel),
                )

                cursor.execute(
                    "SELECT customer_id FROM Customers WHERE contact_name=? AND tel_no=?",
                    (cName, cTel),
                )
                cId_row = cursor.fetchone()
                cId = cId_row[0] if cId_row else None

                cursor.execute(
                    "INSERT OR IGNORE INTO Vehicles (vin_no, vehicle_registration_no, model, series) VALUES (?,?,?,?)",
                    (vVin, vReg, vMod, vSer),
                )
                cursor.execute(
                    "INSERT OR IGNORE INTO Employees (employee_name) VALUES (?)",
                    (eName,),
                )

                cursor.execute(
                    "SELECT employee_id FROM Employees WHERE employee_name=?", (eName,)
                )
                eId_row = cursor.fetchone()
                eId = eId_row[0] if eId_row else None

                cursor.execute(
                    "INSERT OR IGNORE INTO Operations_Parts (operation_part_no, operation_part_no_raw, operation_description) VALUES (?,?,?)",
                    (pCodeNorm, pCodeRaw, pDesc),
                )
                cursor.execute(
                    "UPDATE Operations_Parts SET operation_part_no_raw=?, operation_description=? WHERE operation_part_no=?",
                    (pCodeRaw, pDesc, pCodeNorm),
                )

                cursor.execute(
                    "INSERT OR IGNORE INTO Job_Orders (job_order_no, dealer_code, vin_no, customer_id, employee_id, mileage_in, job_order_date, quotation_date, job_status) VALUES (?,?,?,?,?,?,?,?,?)",
                    (jOrder, dCode, vVin, cId, eId, mil, jDate, qDate, jStat),
                )
                cursor.execute(
                    "UPDATE Job_Orders SET job_order_date=?, quotation_date=?, job_status=?, mileage_in=? WHERE job_order_no=?",
                    (jDate, qDate, jStat, mil, jOrder),
                )

                cursor.execute(
                    "SELECT item_id FROM Job_Order_Items WHERE job_order_no=? AND operation_part_no=? AND technician_message IS ? AND dealer_cost IS ?",
                    (jOrder, pCodeNorm, tMsg, dCost),
                )
                isEx = cursor.fetchone()

                # บันทึกฟิลด์ item_type เพิ่มเติม (P หรือ O)
                if not isEx:
                    cursor.execute(
                        "INSERT INTO Job_Order_Items (job_order_no, operation_part_no, operation_part_no_raw, invoice_amount, dealer_cost, flat_rate_qty, item_status, reject_reason, technician_message, sa_status, item_type) VALUES (?,?,?,?,?,?,?,?,?, 'PENDING', ?)",
                        (
                            jOrder,
                            pCodeNorm,
                            pCodeRaw,
                            inv,
                            dCost,
                            fQty,
                            iStat,
                            rRea,
                            tMsg,
                            iType,
                        ),
                    )
                else:
                    cursor.execute(
                        "UPDATE Job_Order_Items SET operation_part_no_raw=?, invoice_amount=?, flat_rate_qty=?, item_status=?, reject_reason=?, item_type=? WHERE job_order_no=? AND operation_part_no=? AND technician_message IS ? AND dealer_cost IS ?",
                        (
                            pCodeRaw,
                            inv,
                            fQty,
                            iStat,
                            rRea,
                            iType,
                            jOrder,
                            pCodeNorm,
                            tMsg,
                            dCost,
                        ),
                    )
            conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@import_bp.route("/api/import-promos", methods=["POST"])
def api_import_promos():
    payload = request.get_json(silent=True) or {}
    parts = payload.get("parts", [])
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            for p in parts:
                cursor.execute(
                    "INSERT OR REPLACE INTO Promotion_Parts (part_no, part_name, source_sheet, is_substitution) VALUES (?,?,?,?)",
                    (p["part_no"], p["part_name"], p["sheet"], p["is_sub"]),
                )
            conn.commit()
        return jsonify({"status": "success", "count": len(parts)})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@import_bp.route("/api/clear-promos", methods=["POST"])
def api_clear_promos():
    try:
        with get_db_connection() as conn:
            conn.execute("DELETE FROM Promotion_Parts")
            conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

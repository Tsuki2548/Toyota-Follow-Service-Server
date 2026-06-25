import sqlite3

from flask import current_app


def get_db_connection():
    conn = sqlite3.connect(
        current_app.config["DB_NAME"], timeout=current_app.config["DB_TIMEOUT"]
    )
    return conn


def get_readonly_db_connection():
    db_path = current_app.config["DB_NAME"]
    conn = sqlite3.connect(
        f"file:{db_path}?mode=ro",
        timeout=current_app.config["DB_TIMEOUT"],
        uri=True,
    )
    return conn


def init_db(app):
    with app.app_context():
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.executescript("""
                CREATE TABLE IF NOT EXISTS Dealers (dealer_code TEXT PRIMARY KEY, dealer_name TEXT);
                CREATE TABLE IF NOT EXISTS Customers (customer_id INTEGER PRIMARY KEY AUTOINCREMENT, contact_name TEXT, tel_no TEXT, UNIQUE(contact_name, tel_no));
                CREATE TABLE IF NOT EXISTS Vehicles (vin_no TEXT PRIMARY KEY, vehicle_registration_no TEXT, model TEXT, series TEXT);
                CREATE TABLE IF NOT EXISTS Employees (employee_id INTEGER PRIMARY KEY AUTOINCREMENT, employee_name TEXT UNIQUE);
                CREATE TABLE IF NOT EXISTS Operations_Parts (operation_part_no TEXT PRIMARY KEY, operation_part_no_raw TEXT, operation_description TEXT);
                CREATE TABLE IF NOT EXISTS Job_Orders (
                    job_order_no TEXT PRIMARY KEY, dealer_code TEXT, vin_no TEXT, customer_id INTEGER, employee_id INTEGER,
                    mileage_in INTEGER, job_order_date TEXT, quotation_date TEXT, job_status TEXT,
                    FOREIGN KEY(dealer_code) REFERENCES Dealers(dealer_code), FOREIGN KEY(vin_no) REFERENCES Vehicles(vin_no),
                    FOREIGN KEY(customer_id) REFERENCES Customers(customer_id), FOREIGN KEY(employee_id) REFERENCES Employees(employee_id)
                );
                CREATE TABLE IF NOT EXISTS Job_Order_Items (
                    item_id INTEGER PRIMARY KEY AUTOINCREMENT, job_order_no TEXT, operation_part_no TEXT, operation_part_no_raw TEXT,
                    invoice_amount REAL, dealer_cost REAL, flat_rate_qty REAL, item_status TEXT, reject_reason TEXT,
                    technician_message TEXT, sa_status TEXT DEFAULT 'PENDING', sa_approved_date TEXT, item_type TEXT,
                    FOREIGN KEY(job_order_no) REFERENCES Job_Orders(job_order_no), FOREIGN KEY(operation_part_no) REFERENCES Operations_Parts(operation_part_no)
                );
                CREATE TABLE IF NOT EXISTS Follow_Ups (
                    follow_up_id INTEGER PRIMARY KEY AUTOINCREMENT, job_order_no TEXT, attempt_number INTEGER,
                    next_contact_date TEXT, notes TEXT, call_result TEXT, contact_person TEXT, contact_relation TEXT,
                    call_time TEXT, call_attempts INTEGER, appointment_date TEXT, UNIQUE(job_order_no, attempt_number),
                    FOREIGN KEY(job_order_no) REFERENCES Job_Orders(job_order_no)
                );
                CREATE TABLE IF NOT EXISTS Promotion_Parts (
                    part_no TEXT PRIMARY KEY, part_name TEXT, source_sheet TEXT, is_substitution INTEGER DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_jo_date ON Job_Orders (job_order_date);
                CREATE INDEX IF NOT EXISTS idx_ji_jo ON Job_Order_Items (job_order_no);
                CREATE INDEX IF NOT EXISTS idx_fu_jo ON Follow_Ups (job_order_no);
            """)
            conn.commit()

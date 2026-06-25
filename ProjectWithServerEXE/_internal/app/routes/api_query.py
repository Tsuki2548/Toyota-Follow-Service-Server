import re

from flask import Blueprint, jsonify, request

from app.database import get_readonly_db_connection

query_bp = Blueprint("api_query", __name__)

_WRITE_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX|TRUNCATE)\b",
    re.IGNORECASE,
)


@query_bp.route("/api/query", methods=["POST"])
def api_query():
    payload = request.get_json(silent=True) or {}
    sql = str(payload.get("sql", "")).strip()

    if not sql:
        return jsonify({"status": "error", "message": "SQL query is required."}), 400

    # Keep this endpoint read-only to avoid data modification through generic SQL.
    if ";" in sql or _WRITE_KEYWORDS.search(sql):
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Only read-only SELECT queries are allowed.",
                }
            ),
            400,
        )

    normalized = sql.lstrip().upper()
    if not (normalized.startswith("SELECT") or normalized.startswith("WITH")):
        return (
            jsonify(
                {
                    "status": "error",
                    "message": "Only SELECT/CTE read-only queries are allowed.",
                }
            ),
            400,
        )

    try:
        with get_readonly_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql)
            rows = cursor.fetchall()
            return jsonify({"status": "success", "values": [list(row) for row in rows]})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

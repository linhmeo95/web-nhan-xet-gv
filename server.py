#!/usr/bin/env python3
import http.server
import json
import os
import shutil
import tempfile
import urllib.parse
import zipfile
from xml.sax.saxutils import escape

PORT = 8686
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_JSON_PATH = os.path.join(BASE_DIR, "data", "reviews_db.json")
INIT_JS_PATH = os.path.join(BASE_DIR, "data", "initial_data.js")
STATIC_EXCEL_PATH = "/Users/phammylinh/Documents/Du-an-antigravity/Slide - thcs/TONG_HOP_NHAN_XET_3_BAI_TIEU_HOC.xlsx"

def col_letter(n):
    res = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        res = chr(65 + rem) + res
    return res

def build_live_excel(db):
    work_dir = tempfile.mkdtemp(prefix="novastars_xlsx_")
    os.makedirs(os.path.join(work_dir, "_rels"))
    os.makedirs(os.path.join(work_dir, "xl", "_rels"))
    os.makedirs(os.path.join(work_dir, "xl", "worksheets"))

    lessons = db.get("lessons", [])
    reviews = db.get("reviews", [])

    shared_strings = []
    ss_map = {}

    def get_ss_idx(text):
        text = str(text or "")
        if text not in ss_map:
            ss_map[text] = len(shared_strings)
            shared_strings.append(text)
        return ss_map[text]

    criteria_meta = [
        ("1", "1. Điểm ưng ý", "ung_y", 5),
        ("2", "2. Điểm cần làm rõ\n(Chưa hiểu)", "chua_hieu", 6),
        ("3", "3. Đề xuất bổ sung,\ncải tiến", "cai_tien", 7),
        ("4", "4. Khó khăn\nkhi giảng dạy", "kho_khan", 8),
    ]

    sheet_overrides = []
    sheets_tag = []
    wb_rels = [
        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    ]

    for s_idx, lesson in enumerate(lessons, start=1):
        sheet_overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{s_idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
        safe_name = f"Bài {lesson.get('code', s_idx)}"[:31]
        sheets_tag.append(f'<sheet name="{escape(safe_name)}" sheetId="{s_idx}" r:id="rId{s_idx}"/>')
        wb_rels.append(
            f'<Relationship Id="rId{s_idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{s_idx}.xml"/>'
        )

        rows_xml = []

        def make_row(r_num, height, cells):
            c_xml = []
            for c_idx, val, style_id in cells:
                ref = f"{col_letter(c_idx)}{r_num}"
                if val is None or val == "":
                    c_xml.append(f'<c r="{ref}" s="{style_id}"/>')
                else:
                    ss_i = get_ss_idx(val)
                    c_xml.append(f'<c r="{ref}" s="{style_id}" t="s"><v>{ss_i}</v></c>')
            return f'<row r="{r_num}" ht="{height}" customHeight="1">{"".join(c_xml)}</row>'

        rows_xml.append(make_row(1, 34, [
            (1, f"TỔNG HỢP NHẬN XÉT BÀI {lesson.get('code', '')}: {lesson.get('title', '').upper()} ({lesson.get('grade', '')})", 1),
            (2, "", 1), (3, "", 1), (4, "", 1)
        ]))
        rows_xml.append(make_row(2, 22, [
            (1, f"Link bài giảng: {lesson.get('editorUrl', '')}", 2),
            (2, "", 2), (3, "", 2), (4, "", 2)
        ]))
        rows_xml.append(make_row(3, 8, [(1, "", 0)]))
        rows_xml.append(make_row(4, 28, [
            (1, "STT", 4),
            (2, "Tiêu chí đánh giá", 4),
            (3, "Nội dung nhận xét tổng hợp từ Giáo viên", 4),
            (4, "Slide dẫn chứng", 4)
        ]))

        lesson_revs = [r for r in reviews if r.get("lessonId") == lesson.get("id")]

        for idx, (stt, label, key, s_style) in enumerate(criteria_meta):
            r_num = 5 + idx
            merged_texts = []
            merged_slides = set()
            for r in lesson_revs:
                c_obj = (r.get("criteria") or {}).get(key) or {}
                txt = (c_obj.get("text") or "").strip()
                if txt:
                    merged_texts.append(f"[{r.get('teacherName', 'GV')}]:\n{txt}")
                for sl_n in (c_obj.get("slides") or []):
                    merged_slides.add(int(sl_n))

            final_text = "\n\n".join(merged_texts) if merged_texts else "(Chưa có nhận xét)"
            final_slides = ", ".join([f"Slide {n}" for n in sorted(merged_slides)]) if merged_slides else "—"

            rows_xml.append(make_row(r_num, 140, [
                (1, stt, s_style),
                (2, label, s_style),
                (3, final_text, 9),
                (4, final_slides, 10)
            ]))

        sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>
    <col min="1" max="1" width="6" customWidth="1"/>
    <col min="2" max="2" width="24" customWidth="1"/>
    <col min="3" max="3" width="75" customWidth="1"/>
    <col min="4" max="4" width="28" customWidth="1"/>
  </cols>
  <sheetData>
    {"".join(rows_xml)}
  </sheetData>
  <mergeCells count="2">
    <mergeCell ref="A1:D1"/>
    <mergeCell ref="A2:D2"/>
  </mergeCells>
</worksheet>'''
        with open(os.path.join(work_dir, "xl", "worksheets", f"sheet{s_idx}.xml"), "w", encoding="utf-8") as f:
            f.write(sheet_xml)

    content_types = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  {"".join(sheet_overrides)}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>'''
    with open(os.path.join(work_dir, "[Content_Types].xml"), "w", encoding="utf-8") as f:
        f.write(content_types)

    root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''
    with open(os.path.join(work_dir, "_rels", ".rels"), "w", encoding="utf-8") as f:
        f.write(root_rels)

    workbook_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    {"".join(sheets_tag)}
  </sheets>
</workbook>'''
    with open(os.path.join(work_dir, "xl", "workbook.xml"), "w", encoding="utf-8") as f:
        f.write(workbook_xml)

    workbook_rels = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  {"".join(wb_rels)}
</Relationships>'''
    with open(os.path.join(work_dir, "xl", "_rels", "workbook.xml.rels"), "w", encoding="utf-8") as f:
        f.write(workbook_rels)

    si_items = [f'<si><t xml:space="preserve">{escape(s)}</t></si>' for s in shared_strings]
    ss_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared_strings)}" uniqueCount="{len(shared_strings)}">
  {"".join(si_items)}
</sst>'''
    with open(os.path.join(work_dir, "xl", "sharedStrings.xml"), "w", encoding="utf-8") as f:
        f.write(ss_xml)

    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="10">
    <font><sz val="11"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10.5"/><color rgb="FF1E3A8A"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF065F46"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF92400E"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF1E40AF"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF9F1239"/><name val="Arial"/></font>
    <font><sz val="10.5"/><color rgb="FF1E293B"/><name val="Arial"/></font>
  </fonts>
  <fills count="12">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF334155"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE4E6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="11">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="7" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>'''
    with open(os.path.join(work_dir, "xl", "styles.xml"), "w", encoding="utf-8") as f:
        f.write(styles_xml)

    out_xlsx = os.path.join(work_dir, "BAO_CAO_NHAN_XET_GV.xlsx")
    with zipfile.ZipFile(out_xlsx, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(work_dir):
            for file in files:
                if file.endswith(".xlsx"):
                    continue
                full_p = os.path.join(root, file)
                rel_p = os.path.relpath(full_p, work_dir)
                zf.write(full_p, rel_p)
    return out_xlsx

class ReviewRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/data":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with open(DB_JSON_PATH, "rb") as f:
                self.wfile.write(f.read())
            return

        if parsed.path == "/api/export-excel":
            with open(DB_JSON_PATH, "r", encoding="utf-8") as f:
                db = json.load(f)
            out_path = build_live_excel(db)
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition", 'attachment; filename="TONG_HOP_NHAN_XET_GIAO_VIEN.xlsx"')
            self.end_headers()
            with open(out_path, "rb") as f:
                self.wfile.write(f.read())
            return

        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/save":
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length).decode("utf-8")
            try:
                data = json.loads(raw_body)
                with open(DB_JSON_PATH, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                with open(INIT_JS_PATH, "w", encoding="utf-8") as f:
                    f.write("window.INITIAL_APP_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            except Exception as e:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

if __name__ == "__main__":
    http.server.HTTPServer.allow_reuse_address = True
    with http.server.HTTPServer(("127.0.0.1", PORT), ReviewRequestHandler) as httpd:
        print(f"Serving NovaStars Review Studio on http://localhost:{PORT}")
        httpd.serve_forever()

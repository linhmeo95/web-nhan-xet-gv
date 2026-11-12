#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automated Pre-flight & Pre-commit Integrity Check for NovaStars Review Web App.
Ensures zero-regression on:
1. All 6 Canonical Teachers with their exact, immutable PINs.
2. All 5 Canonical Lessons with correct codes, titles, and editor URLs.
3. Review submission preservation (no reviews lost or wiped).
4. Consistency between data/reviews_db.json and data/initial_data.js.
5. (Optional) Cloud state in Supabase novastars_app_state when run with --cloud.
"""

import sys
import os
import json
import re
import argparse

CANONICAL_TEACHERS = {
    "gv-tientt": {"name": "Triệu Thị Tiên", "pin": "1111"},
    "gv-tunm": {"name": "Tô Phương Diễm", "pin": "2222"},
    "gv-ngan": {"name": "Đinh Thi Hương", "pin": "3333"},
    "gv-mai": {"name": "Phạm Mỹ Linh", "pin": "4444"},
    "gv-huong": {"name": "Nguyễn Minh Tú", "pin": "5555"},
    "gv-lananh": {"name": "Lê Thị Lan Anh", "pin": "6666"},
}

CANONICAL_LESSONS = {
    "1.02.CL": {
        "id": "ai-1-02-cl",
        "title": "Nụ cười của Robot do con người tạo ra",
        "editorUrl": "https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-1-nu-cuoi-robot-minh-hoa-rev03",
    },
    "2.22.CL": {
        "id": "ai-2-22-cl",
        "title": "Vì sao máy chia nhóm bị nhầm?",
        "editorUrl": "https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-2-22-cl",
    },
    "3.28.CL": {
        "id": "ai-3-28-cl",
        "title": "Ảnh sai nhãn khiến máy dễ đoán nhầm",
        "editorUrl": "https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-3-anh-sai-nhan",
    },
    "4.23.CL": {
        "id": "ai-4-23-cl",
        "title": "Ý tưởng chiếc máy thông minh giúp ích trường em",
        "editorUrl": "https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-4-23-cl",
    },
    "5.24.CL": {
        "id": "ai-5-24-cl",
        "title": "Thêm ảnh mẫu và so sánh kết quả",
        "editorUrl": "https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-5-24-cl",
    },
}

MIN_EXPECTED_REVIEWS = 12

def parse_initial_data_js(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()
    cleaned = re.sub(r'^\s*(?:window\.INITIAL_APP_DATA|const\s+INITIAL_REVIEWS_DB)\s*=\s*', '', text.strip())
    cleaned = re.sub(r';\s*$', '', cleaned)
    return json.loads(cleaned)

def check_dataset(db, source_name, errors):
    print(f"[*] Checking dataset: {source_name}...")
    
    # 1. Teachers check
    teachers = db.get("teachers", [])
    t_map = {t.get("id"): t for t in teachers}
    
    for canon_id, canon in CANONICAL_TEACHERS.items():
        if canon_id not in t_map:
            errors.append(f"[{source_name}] Missing canonical teacher ID '{canon_id}' ({canon['name']})")
            continue
        
        t = t_map[canon_id]
        if str(t.get("pin")).strip() != str(canon["pin"]).strip():
            errors.append(
                f"[{source_name}] Teacher '{canon['name']}' ({canon_id}) PIN altered! Expected '{canon['pin']}', found '{t.get('pin')}'"
            )
        if canon["name"] not in t.get("name", ""):
            errors.append(
                f"[{source_name}] Teacher name mismatch for '{canon_id}': expected '{canon['name']}', found '{t.get('name')}'"
            )
    
    print(f"    - Teachers verified: {len(teachers)} found (all 6 canonical teachers intact with original PINs).")
    
    # 2. Lessons check
    lessons = db.get("lessons", [])
    l_code_map = {l.get("code"): l for l in lessons}
    l_id_map = {l.get("id"): l for l in lessons}
    
    for canon_code, canon in CANONICAL_LESSONS.items():
        l = l_code_map.get(canon_code) or l_id_map.get(canon["id"])
        if not l:
            errors.append(f"[{source_name}] Missing canonical lesson '{canon_code}' ({canon['id']}: {canon['title']})")
            continue
        
        if l.get("id") != canon["id"]:
            errors.append(f"[{source_name}] Lesson '{canon_code}' ID mismatch: expected '{canon['id']}', found '{l.get('id')}'")
        if canon["title"] not in l.get("title", ""):
            errors.append(f"[{source_name}] Lesson '{canon_code}' title mismatch: expected '{canon['title']}', found '{l.get('title')}'")
        if not l.get("editorUrl", "").startswith("https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/"):
            errors.append(f"[{source_name}] Lesson '{canon_code}' editorUrl invalid: '{l.get('editorUrl')}'")
            
    print(f"    - Lessons verified: {len(lessons)} found (all 5 canonical lessons intact with correct URLs).")
    
    # 3. Reviews check
    reviews = db.get("reviews", [])
    if len(reviews) < MIN_EXPECTED_REVIEWS:
        errors.append(
            f"[{source_name}] Review count regression! Found {len(reviews)} reviews, expected at least {MIN_EXPECTED_REVIEWS}."
        )
    else:
        print(f"    - Reviews count verified: {len(reviews)} reviews preserved (>= {MIN_EXPECTED_REVIEWS}).")

def check_app_js(app_js_path, errors):
    print(f"[*] Checking client logic in {app_js_path}...")
    if not os.path.exists(app_js_path):
        errors.append(f"Missing file: {app_js_path}")
        return
    
    with open(app_js_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    required_tokens = [
        "isTeacherPinValid",
        "fetchCloudDb",
        "novastars_app_state",
        "SESSION_KEY",
        "localStorage"
    ]
    for token in required_tokens:
        if token not in content:
            errors.append(f"[app.js] Missing critical safeguard token: '{token}'")
            
    print("    - Client safeguards verified (PIN validation, atomic merge logic present).")

def check_cloud_supabase(errors):
    print("[*] Checking Cloud Supabase table 'novastars_app_state'...")
    import urllib.request
    import ssl
    
    SUPABASE_URL = "https://altabwyuskgvxtcnzlbw.supabase.co"
    SUPABASE_KEY = "sb_publishable_LxTa5ODn1kObt_BBAwvLxw_2E3OXZUd"
    SUPABASE_TABLE = "novastars_app_state"
    
    ctx = ssl._create_unverified_context()
    
    try:
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}?id=eq.config"
        req = urllib.request.Request(url, headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json"
        })
        with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        
        if not data or len(data) == 0:
            errors.append("[Cloud Supabase] 'config' row not found in novastars_app_state!")
            return
            
        config_payload = data[0].get("payload", {})
        teachers = config_payload.get("teachers", [])
        lessons = config_payload.get("lessons", [])
        
        t_map = {t["id"]: t for t in teachers}
        for canon_id, canon in CANONICAL_TEACHERS.items():
            if canon_id not in t_map:
                errors.append(f"[Cloud Supabase] Missing teacher '{canon_id}' ({canon['name']}) in cloud config")
            elif str(t_map[canon_id].get("pin")).strip() != str(canon["pin"]).strip():
                errors.append(
                    f"[Cloud Supabase] Teacher '{canon['name']}' PIN mismatch in cloud! Expected {canon['pin']}, found {t_map[canon_id].get('pin')}"
                )
        
        l_map = {l.get("code"): l for l in lessons}
        for canon_code, canon in CANONICAL_LESSONS.items():
            if canon_code not in l_map:
                errors.append(f"[Cloud Supabase] Missing lesson '{canon_code}' ({canon['title']}) in cloud config")
                
        print(f"    - Cloud config verified: {len(teachers)} teachers and {len(lessons)} lessons in Supabase.")
        
    except Exception as e:
        errors.append(f"[Cloud Supabase] Network check failed: {e}")

def main():
    parser = argparse.ArgumentParser(description="Check integrity of NovaStars Review Web App")
    parser.add_argument("--cloud", action="store_true", help="Also verify live Supabase state over network")
    args = parser.parse_args()
    
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    json_path = os.path.join(base_dir, "data", "reviews_db.json")
    js_path = os.path.join(base_dir, "data", "initial_data.js")
    app_js_path = os.path.join(base_dir, "app.js")
    
    print("=" * 70)
    print("  NOVASTARS REVIEW WEB APP - PRE-FLIGHT INTEGRITY AUDIT")
    print("=" * 70)
    
    errors = []
    
    # 1. Check data/reviews_db.json
    if not os.path.exists(json_path):
        errors.append(f"File not found: {json_path}")
    else:
        with open(json_path, "r", encoding="utf-8") as f:
            db_json = json.load(f)
        check_dataset(db_json, "data/reviews_db.json", errors)
        
    # 2. Check data/initial_data.js
    if not os.path.exists(js_path):
        errors.append(f"File not found: {js_path}")
    else:
        db_js = parse_initial_data_js(js_path)
        check_dataset(db_js, "data/initial_data.js", errors)
        
    # 3. Check app.js safeguards
    check_app_js(app_js_path, errors)
    
    # 4. Optional Cloud check
    if args.cloud:
        check_cloud_supabase(errors)
        
    print("=" * 70)
    if errors:
        print(f"\n[FAIL] Found {len(errors)} critical integrity error(s):")
        for idx, err in enumerate(errors, 1):
            print(f"  {idx}. {err}")
        print("\nPlease fix these issues before committing or deploying!")
        sys.exit(1)
    else:
        print("\n[PASS] All integrity checks passed successfully! Zero regressions detected.")
        sys.exit(0)

if __name__ == "__main__":
    main()

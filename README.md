# Ứng Dụng Web Nhận Xét Bài Giảng Tiểu Học — NovaStars

> **Trực tiếp (GitHub Pages):** [https://linhmeo95.github.io/web-nhan-xet-gv/](https://linhmeo95.github.io/web-nhan-xet-gv/)  
> **Cơ sở dữ liệu đám mây:** Supabase (`novastars_app_state` table)  
> **Mã PIN Quản trị viên (Admin):** `8888`

---

## 1. Danh Sách Giáo Viên & Mã PIN Chuẩn (BẤT BIẾN)

> [!CAUTION]
> **QUY TẮC BẤT BIẾN:** Tuyệt đối không được thay đổi, hoán đổi hoặc xóa mã PIN của giáo viên trong bất kỳ lần cập nhật mã nguồn hay cơ sở dữ liệu nào.

| STT | Họ và Tên | Mã Định Danh (`id`) | Mã PIN Chuẩn | Vai Trò |
| :---: | :--- | :--- | :---: | :---: |
| 1 | **Triệu Thị Tiên** | `gv-tientt` | `1111` | Giáo viên |
| 2 | **Tô Phương Diễm** | `gv-tunm` | `2222` | Giáo viên |
| 3 | **Đinh Thi Hương** | `gv-ngan` | `3333` | Giáo viên |
| 4 | **Phạm Mỹ Linh** | `gv-mai` | `4444` | Giáo viên |
| 5 | **Nguyễn Minh Tú** | `gv-huong` | `5555` | Giáo viên |
| 6 | **Lê Thị Lan Anh** | `gv-lananh` | `6666` | Giáo viên |

---

## 2. Danh Sách Bài Giảng Hiện Hành

| Mã Bài | Khối Lớp | Tên Bài Giảng | Liên Kết Chỉnh Sửa Slide (Editor) |
| :--- | :---: | :--- | :--- |
| **1.02.CL** | Khối 1 | Nụ cười của Robot do con người tạo ra | [Mở Editor](https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-1-nu-cuoi-robot-minh-hoa-rev03) |
| **2.22.CL** | Khối 2 | Vì sao máy chia nhóm bị nhầm? | [Mở Editor](https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-2-22-cl) |
| **3.28.CL** | Khối 3 | Ảnh sai nhãn khiến máy dễ đoán nhầm | [Mở Editor](https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-3-anh-sai-nhan) |
| **4.23.CL** | Khối 4 | Ý tưởng chiếc máy thông minh giúp ích trường em | [Mở Editor](https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-4-23-cl) |
| **5.24.CL** | Khối 5 | Thêm ảnh mẫu và so sánh kết quả | [Mở Editor](https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/ai-5-24-cl) |

---

## 3. Kiến Trúc 4 Tầng Chống Thoái Lui Dữ Liệu (`Anti-Regression Architecture`)

Nhằm khắc phục triệt để tình trạng mỗi lần nâng cấp tính năng mới làm ảnh hưởng đến các chức năng hoặc dữ liệu cũ đã ổn định, dự án áp dụng nghiêm ngặt 4 tầng bảo vệ sau:

### Tầng 1: Bản kê Khai báo Chuẩn Đóng băng (`Frozen Canonical Manifest`)
- Danh sách 6 giáo viên, mã PIN và 5 bài giảng gốc được lưu trữ đồng bộ trong:
  - `data/reviews_db.json`
  - `data/initial_data.js`
- Mọi script tạo dữ liệu hay đồng bộ **bắt buộc** kế thừa từ danh sách chuẩn này, không được tạo mới từ danh sách rút gọn hoặc tùy hứng sửa đổi.

### Tầng 2: Cập nhật Đám mây Nguyên tử theo Dòng (`Atomic Row Upsert`)
- Dữ liệu nhận xét được chia nhỏ thành từng dòng độc lập trên Supabase:
  - Dòng cấu hình hệ thống: `id = 'config'` (chỉ chứa `teachers`, `lessons`, `meta`).
  - Dòng nhận xét từng bài của từng giáo viên: `id = 'rev__{lessonId}__{teacherId}'`.
- **Quy tắc Vàng:** Khi cập nhật nhận xét hay cấu hình, **tuyệt đối không bao giờ** ghi đè toàn bộ bảng (`DELETE ALL` hoặc thay thế monolithic JSON). Luôn áp dụng phương thức `merge` (hợp nhất theo Map mã bài / mã giáo viên) để bài mới thêm vào không xóa bài cũ.

### Tầng 3: Kiểm duyệt Toàn vẹn Tự động (`Automated Pre-commit Integrity Check`)
- File kịch bản kiểm tra: `scripts/check_integrity.py`.
- Được tự động kích hoạt trước mỗi lệnh `git commit` thông qua Git Hook `.git/hooks/pre-commit`.
- **Nếu bất kỳ lỗi nào xảy ra:**
  - Giáo viên bị mất hoặc bị đổi mã PIN $\rightarrow$ **Chặn commit ngay lập tức!**
  - Bài giảng bị thiếu hoặc sai đường dẫn Editor $\rightarrow$ **Chặn commit ngay lập tức!**
  - Số lượng nhận xét bị sụt giảm $\rightarrow$ **Chặn commit ngay lập tức!**
  - Thiếu logic bảo vệ trong `app.js` $\rightarrow$ **Chặn commit ngay lập tức!**

### Tầng 4: Bộ điều hợp Đa Phiên bản Phía Client (`Client-Side Fallback & Storage Migration`)
- Hàm `isTeacherPinValid(teacher, enteredPin)` trong `app.js` luôn hỗ trợ mã PIN chuẩn và cơ chế dự phòng theo tên để đảm bảo giáo viên luôn đăng nhập thành công 100%.
- Cơ chế quét `localStorage` hỗ trợ tự động nhận diện và di chuyển dữ liệu qua các phiên bản lưu trữ cũ (`v1`, `v2`, `v10`, `v12...`), tránh tình trạng xóa trắng bộ nhớ khi nâng cấp phiên bản ứng dụng.

---

## 4. Hướng Dẫn Sử Dụng & Vận Hành

### Chạy Kiểm Tra Toàn Vẹn Mã Nguồn (Offline):
```bash
python3 scripts/check_integrity.py
```

### Chạy Kiểm Tra Toàn Vẹn Kèm Đồng Bộ Đám Mây (Online):
```bash
python3 scripts/check_integrity.py --cloud
```

### Thêm Bài Giảng Mới Đúng Quy Trình:
1. Mở `data/reviews_db.json` và bổ sung bài mới vào mảng `"lessons"` (giữ nguyên tất cả các bài cũ).
2. Đồng bộ sang `data/initial_data.js`.
3. Chạy `python3 scripts/check_integrity.py` để kiểm định.
4. Commit và đẩy lên GitHub:
   ```bash
   git add .
   git commit -m "feat: Add new lesson XX.CL"
   git push origin main
   ```

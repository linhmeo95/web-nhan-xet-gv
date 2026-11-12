(function () {
  "use strict";

  const STORAGE_KEY = "NOVASTARS_REVIEW_APP_DB_V7";
  const SESSION_KEY = "NOVASTARS_CURRENT_USER_V7";
  const SUPABASE_URL = "https://altabwyuskgvxtcnzlbw.supabase.co";
  const SUPABASE_KEY = "sb_publishable_LxTa5ODn1kObt_BBAwvLxw_2E3OXZUd";
  const SUPABASE_TABLE = "novastars_app_state";

  const CRITERIA_META = [
    {
      key: "ung_y",
      title: "1. Điểm ưng ý",
      placeholder: "Gõ 1 ý ưng ý tại đây..."
    },
    {
      key: "chua_hieu",
      title: "2. Điểm cần làm rõ",
      placeholder: "Gõ 1 điểm chưa rõ tại đây..."
    },
    {
      key: "cai_tien",
      title: "3. Đề xuất cải tiến",
      placeholder: "Gõ 1 đề xuất cải tiến tại đây..."
    },
    {
      key: "kho_khan",
      title: "4. Khó khăn khi dạy",
      placeholder: "Gõ 1 lưu ý về thời lượng / thao tác HS tại đây..."
    }
  ];

  let db = loadInitialDb();
  let currentUser = loadInitialUser();
  let currentLessonId = db.lessons[0] ? db.lessons[0].id : "";
  let activeCritKey = "ung_y";
  let activePointIdxByCrit = { ung_y: 0, chua_hieu: 0, cai_tien: 0, kho_khan: 0 };
  let isAdminView = false;

  function syncLatestLessons(targetDb) {
    if (!targetDb.lessons || targetDb.lessons.length === 0) {
      if (window.INITIAL_APP_DATA && Array.isArray(window.INITIAL_APP_DATA.lessons)) {
        targetDb.lessons = JSON.parse(JSON.stringify(window.INITIAL_APP_DATA.lessons));
      }
    }
    return targetDb;
  }

  function loadInitialDb() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.lessons && parsed.lessons.length > 0) {
          return syncLatestLessons(parsed);
        }
      } catch (e) {}
    }
    return JSON.parse(JSON.stringify(window.INITIAL_APP_DATA));
  }

  function loadInitialUser() {
    const params = new URLSearchParams(window.location.search);
    const gvParam = params.get("gv");
    const pinParam = params.get("pin");
    const adminPin = (db.meta && db.meta.adminPin) ? String(db.meta.adminPin).trim() : "8888";

    // Direct URL login for admin: ?gv=admin&pin=8888
    if (gvParam === "admin" && pinParam === adminPin) {
      isAdminView = true;
      return { id: "admin", name: "Ban Quản lý", role: "admin" };
    }

    // Direct URL login for teacher: ?gv=gv-thoa&pin=1111
    if (gvParam) {
      const found = db.teachers.find(t => t.id === gvParam);
      if (found && (!pinParam || found.pin === pinParam)) {
        isAdminView = false;
        return { id: found.id, name: found.name, role: "teacher" };
      }
    }

    // Check existing stored session
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id) {
          if (parsed.role === "admin") {
            isAdminView = true;
          } else {
            isAdminView = false;
          }
          return parsed;
        }
      } catch (e) {}
    }

    // Default to null -> MUST SHOW LOGIN SCREEN
    isAdminView = false;
    return null;
  }

  function isUserTyping() {
    const active = document.activeElement;
    return active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" || active.tagName === "SELECT");
  }

  async function fetchCloudDb(forceRender = false) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id,payload,updated_at`, {
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`
        },
        cache: "no-store"
      });
      if (!res.ok) return false;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return false;

      let cloudConfig = null;
      const cloudReviews = [];

      rows.forEach(row => {
        if (row.id === "config" && row.payload) {
          cloudConfig = row.payload;
        } else if (row.id && row.id.startsWith("rev__") && row.payload) {
          cloudReviews.push(row.payload);
        }
      });

      if (cloudConfig) {
        if (Array.isArray(cloudConfig.teachers) && cloudConfig.teachers.length > 0) {
          db.teachers = cloudConfig.teachers;
          populateAuthTeacherSelect();
        }
        if (Array.isArray(cloudConfig.lessons) && cloudConfig.lessons.length > 0) {
          db.lessons = cloudConfig.lessons;
        }
        if (cloudConfig.meta) {
          db.meta = cloudConfig.meta;
        }
      }

      if (cloudReviews.length > 0) {
        // Merge reviews: preserve active user's unsaved typing if currently editing
        const mergedMap = new Map();
        (db.reviews || []).forEach(r => mergedMap.set(`${r.lessonId}__${r.teacherId}`, r));
        cloudReviews.forEach(cr => {
          const key = `${cr.lessonId}__${cr.teacherId}`;
          const isCurrentEditing = !forceRender && !isAdminView && isUserTyping() &&
            cr.lessonId === currentLessonId && currentUser && cr.teacherId === currentUser.id;
          if (!isCurrentEditing) {
            mergedMap.set(key, cr);
          }
        });
        db.reviews = Array.from(mergedMap.values());
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

      if (forceRender || isAdminView || !isUserTyping()) {
        renderAll();
      } else {
        renderTopBar();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function fetchServerDb() {
    const cloudOk = await fetchCloudDb(true);
    if (cloudOk) return;
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.ok) {
        const serverDb = await res.json();
        if (serverDb && serverDb.lessons) {
          db = syncLatestLessons(serverDb);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
          renderAll();
        }
      }
    } catch (e) {}
  }

  async function saveRowsToSupabase(rowsToUpsert) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rowsToUpsert)
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async function deleteSupabaseRowPrefix(prefix) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=like.${encodeURIComponent(prefix)}*`, {
        method: "DELETE",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`
        }
      });
    } catch (e) {}
  }

  let saveTimer = null;
  function triggerAutoSave(immediate = false, saveConfig = false) {
    db.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

    const saveText = document.getElementById("saveText");
    const nowStr = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    if (saveText) saveText.textContent = "☁️ Đang đồng bộ...";

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const rows = [];
      if (saveConfig) {
        const slimLessons = (db.lessons || []).map(l => ({
          id: l.id,
          code: l.code,
          grade: l.grade,
          themeId: l.themeId,
          version: l.version,
          title: l.title,
          editorUrl: l.editorUrl,
          totalSlides: l.totalSlides || 18
        }));
        rows.push({
          id: "config",
          payload: {
            meta: db.meta,
            teachers: db.teachers,
            lessons: slimLessons
          },
          updated_at: new Date().toISOString()
        });
      }

      if (currentUser && currentLessonId) {
        const curRev = (db.reviews || []).find(r => r.lessonId === currentLessonId && r.teacherId === currentUser.id);
        if (curRev) {
          curRev.updatedAt = new Date().toISOString();
          rows.push({
            id: `rev__${curRev.lessonId}__${curRev.teacherId}`,
            payload: curRev,
            updated_at: new Date().toISOString()
          });
        }
      }

      if (saveConfig) {
        (db.reviews || []).forEach(r => {
          rows.push({
            id: `rev__${r.lessonId}__${r.teacherId}`,
            payload: r,
            updated_at: new Date().toISOString()
          });
        });
      }

      let cloudSaved = false;
      if (rows.length > 0) {
        // Deduplicate by id
        const uniqueRows = Array.from(new Map(rows.map(item => [item.id, item])).values());
        cloudSaved = await saveRowsToSupabase(uniqueRows);
      }

      try {
        await fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(db)
        });
      } catch (e) {}

      if (saveText) {
        saveText.textContent = cloudSaved ? `☁️ Đã lưu Cloud ${nowStr}` : `✓ Đã lưu ${nowStr}`;
      }
    }, immediate ? 50 : 350);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getCurrentLesson() {
    return db.lessons.find(l => l.id === currentLessonId) || db.lessons[0];
  }

  function createEmptyPoint(slideStr = "") {
    return {
      id: "pt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
      slide: slideStr ? String(slideStr) : "",
      text: "",
      images: []
    };
  }

  function ensureCriterionPoints(cData) {
    if (Array.isArray(cData.points) && cData.points.length > 0) {
      cData.points.forEach(pt => {
        if (!Array.isArray(pt.images)) pt.images = [];
        if (pt.slide == null) pt.slide = "";
        if (pt.text == null) pt.text = "";
      });
      return cData.points;
    }

    // Migrate legacy single text / slides / images into individual points
    const rawText = (cData.text || "").trim();
    const legacySlides = Array.isArray(cData.slides) ? cData.slides : [];
    const legacyImages = Array.isArray(cData.images) ? cData.images : [];

    if (!rawText && legacyImages.length === 0) {
      cData.points = [createEmptyPoint(legacySlides[0] || "")];
      return cData.points;
    }

    const lines = rawText
      .split(/\n+/)
      .map(l => l.replace(/^[•\-*]\s*/, "").trim())
      .filter(Boolean);

    if (lines.length === 0) {
      const pt = createEmptyPoint(legacySlides[0] || "");
      pt.images = [...legacyImages];
      cData.points = [pt];
      return cData.points;
    }

    cData.points = lines.map((line, idx) => {
      let slideVal = legacySlides[idx] ? String(legacySlides[idx]) : "";
      let cleanedLine = line;
      const m = line.match(/^\[?Slide\s*(\d+)\]?\s*[:\-]?\s*(.*)$/i);
      if (m) {
        slideVal = m[1];
        cleanedLine = m[2].trim();
      }
      const pt = createEmptyPoint(slideVal);
      pt.text = cleanedLine;
      if (idx === 0 && legacyImages.length > 0) {
        pt.images = [...legacyImages];
      }
      return pt;
    });

    syncCriterionSummaryFromPoints(cData);
    return cData.points;
  }

  function syncCriterionSummaryFromPoints(cData) {
    const pts = cData.points || [];
    const slideSet = new Set();
    const allImages = [];
    const textLines = [];

    pts.forEach(pt => {
      const t = (pt.text || "").trim();
      const s = (pt.slide || "").trim();
      const imgs = pt.images || [];
      if (s && !isNaN(Number(s))) {
        slideSet.add(Number(s));
      }
      imgs.forEach(im => allImages.push(im));
      if (t || imgs.length > 0) {
        const prefix = s ? `[Slide ${s}]: ` : "";
        textLines.push(`• ${prefix}${t || "(Đính kèm ảnh)"}`);
      }
    });

    cData.slides = Array.from(slideSet).sort((a, b) => a - b);
    cData.images = allImages;
    cData.text = textLines.join("\n");
  }

  function getOrCreateReview(lessonId, teacherId, teacherName) {
    let rev = db.reviews.find(r => r.lessonId === lessonId && r.teacherId === teacherId);
    if (!rev) {
      rev = {
        id: `rev-${teacherId}-${lessonId}-${Date.now()}`,
        lessonId,
        teacherId,
        teacherName,
        status: "draft",
        updatedAt: new Date().toISOString(),
        criteria: {
          ung_y: { slides: [], text: "", images: [], points: [createEmptyPoint()] },
          chua_hieu: { slides: [], text: "", images: [], points: [createEmptyPoint()] },
          cai_tien: { slides: [], text: "", images: [], points: [createEmptyPoint()] },
          kho_khan: { slides: [], text: "", images: [], points: [createEmptyPoint()] }
        }
      };
      db.reviews.push(rev);
    }
    CRITERIA_META.forEach(cm => {
      if (!rev.criteria[cm.key]) {
        rev.criteria[cm.key] = { slides: [], text: "", images: [], points: [createEmptyPoint()] };
      }
      ensureCriterionPoints(rev.criteria[cm.key]);
    });
    return rev;
  }

  function renderTopBar() {
    if (!currentUser) return;
    const nav = document.getElementById("lessonNav");
    nav.innerHTML = "";
    db.lessons.forEach(lesson => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lesson-pill" + (lesson.id === currentLessonId ? " active" : "");
      btn.textContent = `${lesson.code} (${lesson.grade})`;
      btn.title = lesson.title;
      btn.addEventListener("click", () => {
        currentLessonId = lesson.id;
        renderAll();
      });
      nav.appendChild(btn);
    });

    const nameEl = document.getElementById("currentUserName");
    const dotEl = document.querySelector(".user-dot");
    const btnToggleAdmin = document.getElementById("btnToggleAdmin");

    if (currentUser.role === "admin") {
      nameEl.textContent = "🛡️ Ban Quản lý";
      if (dotEl) dotEl.style.background = "#F59E0B";
      // Allow admin to toggle between viewing the admin panel and previewing the teacher form
      btnToggleAdmin.classList.remove("hidden");
      btnToggleAdmin.textContent = isAdminView ? "👁️ Xem phiếu GV" : "📊 Về Quản lý";
    } else {
      nameEl.textContent = "👩‍🏫 " + currentUser.name;
      if (dotEl) dotEl.style.background = "#38BDF8";
      // CRITICAL: HIDE ADMIN BUTTON COMPLETELY FOR TEACHERS
      btnToggleAdmin.classList.add("hidden");
    }
  }

  function updateQuickBarTargetLabel() {
    const found = CRITERIA_META.find(c => c.key === activeCritKey) || CRITERIA_META[0];
    const ptIdx = (activePointIdxByCrit[activeCritKey] || 0) + 1;
    const lbl = document.getElementById("lblQuickBarTarget");
    if (lbl) {
      lbl.innerHTML = `📌 Bấm số Slide để gán cho <strong>Ý ${ptIdx}</strong> (hoặc tạo ý mới) trong mục <strong>${escapeHtml(found.title)}</strong>:`;
    }
  }

  function renderQuickSlideStrip() {
    const lesson = getCurrentLesson();
    if (!lesson) return;

    document.getElementById("linkOpenHdTab").href = lesson.editorUrl;

    const total = (lesson.slides && lesson.slides.length) ? lesson.slides.length : (lesson.totalSlides || 19);
    document.getElementById("lblCurrentLessonMeta").textContent =
      `${lesson.grade || ""} · ${total} slides trên HD Tương tác`;

    updateQuickBarTargetLabel();

    const strip = document.getElementById("slideNumStrip");
    strip.innerHTML = "";
    for (let i = 1; i <= total; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "num-btn";
      b.textContent = i;
      b.title = `Gán Slide ${i} vào ý đang chọn (hoặc thêm ý mới cho Slide ${i})`;
      b.addEventListener("click", () => {
        assignOrAddSlidePoint(activeCritKey, i);
      });
      strip.appendChild(b);
    }
  }

  function buildSlideOptionsHtml(totalSlides, selectedSlide) {
    const selStr = String(selectedSlide || "");
    let html = `<option value="" ${selStr === "" ? "selected" : ""}>📌 Chung cả bài</option>`;
    for (let i = 1; i <= totalSlides; i++) {
      const isSel = selStr === String(i) ? "selected" : "";
      html += `<option value="${i}" ${isSel}>📌 Slide ${i}</option>`;
    }
    return html;
  }

  function renderCriteriaForm(focusTarget = null) {
    const lesson = getCurrentLesson();
    if (!lesson) return;

    const totalSlides = (lesson.slides && lesson.slides.length) ? lesson.slides.length : (lesson.totalSlides || 19);

    document.getElementById("lblCurrentLessonCode").textContent = lesson.code;
    document.getElementById("lblCurrentLessonTitle").textContent = lesson.title;

    const rev = getOrCreateReview(lesson.id, currentUser.id, currentUser.name);
    const statusPill = document.getElementById("reviewStatusPill");
    if (rev.status === "submitted") {
      statusPill.textContent = "✓ Đã nộp";
      statusPill.className = "status-pill submitted";
    } else {
      statusPill.textContent = "Đang soạn";
      statusPill.className = "status-pill";
    }

    const stack = document.getElementById("criteriaStack");
    stack.innerHTML = "";

    CRITERIA_META.forEach(cm => {
      const cData = rev.criteria[cm.key];
      const points = ensureCriterionPoints(cData);
      if (activePointIdxByCrit[cm.key] >= points.length) {
        activePointIdxByCrit[cm.key] = Math.max(0, points.length - 1);
      }

      const filledCount = points.filter(p => p.text.trim().length > 0 || (p.images && p.images.length > 0)).length;

      const card = document.createElement("div");
      card.className = "criterion-card" + (activeCritKey === cm.key ? " focused-card" : "");
      card.dataset.crit = cm.key;

      const pointsHtml = points
        .map((pt, pIdx) => {
          const isActPoint = (activeCritKey === cm.key && activePointIdxByCrit[cm.key] === pIdx);
          const imgsHtml = (pt.images || [])
            .map((imgSrc, iIdx) => `
              <div class="attached-thumb-wrap">
                <img src="${imgSrc}" alt="Ảnh của Ý ${pIdx + 1}" data-preview-img="${imgSrc}">
                <button type="button" class="btn-del-img" data-del-pt-img="${pIdx}:${iIdx}" title="Xóa ảnh này">✕</button>
              </div>
            `)
            .join("");

          return `
            <div class="point-item ${isActPoint ? "active-point" : ""}" data-point-wrap="${cm.key}:${pIdx}">
              <div class="point-top-row">
                <div class="point-left-meta">
                  <span class="point-index-badge">Ý ${pIdx + 1}</span>
                  <select class="point-slide-select" data-slide-select="${cm.key}:${pIdx}" aria-label="Chọn Slide cho Ý ${pIdx + 1}">
                    ${buildSlideOptionsHtml(totalSlides, pt.slide)}
                  </select>
                </div>
                <button type="button" class="btn-del-point" data-del-point="${cm.key}:${pIdx}" title="Xóa ý này">
                  ✕ Xóa ý
                </button>
              </div>

              <textarea
                class="point-textarea"
                data-point-textarea="${cm.key}:${pIdx}"
                placeholder="${escapeHtml(cm.placeholder)}"
              >${escapeHtml(pt.text || "")}</textarea>

              <div class="point-footer">
                <div class="attached-images-list">${imgsHtml}</div>
                <div class="point-img-actions">
                  <button type="button" class="btn-paste-clipboard" data-paste-btn="${cm.key}:${pIdx}" title="Chụp màn hình xong bấm nút này để dán ảnh ngay vào Ý ${pIdx + 1}">
                    📋 Dán ảnh vừa chụp
                  </button>
                  <label class="btn-upload-file" title="Chọn file ảnh có sẵn trong máy tính">
                    📁 Chọn ảnh từ máy
                    <input type="file" accept="image/*" hidden data-upload-pt="${cm.key}:${pIdx}">
                  </label>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      card.innerHTML = `
        <div class="criterion-header">
          <span class="crit-title">
            ${escapeHtml(cm.title)}
            <span class="crit-count-badge">${filledCount > 0 ? `${filledCount} ý đã ghi` : `${points.length} ô`}</span>
          </span>
          <button type="button" class="btn-add-point-head" data-add-point="${cm.key}">
            + Thêm ý mới
          </button>
        </div>
        <div class="criterion-body">
          <div class="points-list">${pointsHtml}</div>
          <button type="button" class="btn-add-point-bottom" data-add-point="${cm.key}">
            + Thêm ý nhận xét tiếp theo vào mục "${escapeHtml(cm.title)}"
          </button>
        </div>
      `;

      // Add new point handlers
      card.querySelectorAll(`[data-add-point="${cm.key}"]`).forEach(btn => {
        btn.addEventListener("click", () => {
          activeCritKey = cm.key;
          points.push(createEmptyPoint(""));
          activePointIdxByCrit[cm.key] = points.length - 1;
          syncCriterionSummaryFromPoints(cData);
          triggerAutoSave();
          renderCriteriaForm({ critKey: cm.key, pointIdx: points.length - 1 });
          updateQuickBarTargetLabel();
        });
      });

      // Slide select change
      card.querySelectorAll("[data-slide-select]").forEach(sel => {
        sel.addEventListener("change", () => {
          const [, idxStr] = sel.dataset.slideSelect.split(":");
          const pIdx = Number(idxStr);
          activeCritKey = cm.key;
          activePointIdxByCrit[cm.key] = pIdx;
          points[pIdx].slide = sel.value;
          syncCriterionSummaryFromPoints(cData);
          rev.updatedAt = new Date().toISOString();
          triggerAutoSave();
          updateQuickBarTargetLabel();
        });
      });

      // Delete point handler
      card.querySelectorAll("[data-del-point]").forEach(delBtn => {
        delBtn.addEventListener("click", () => {
          const [, idxStr] = delBtn.dataset.delPoint.split(":");
          const pIdx = Number(idxStr);
          if (points.length <= 1) {
            points[0].text = "";
            points[0].slide = "";
            points[0].images = [];
          } else {
            points.splice(pIdx, 1);
          }
          activePointIdxByCrit[cm.key] = Math.max(0, Math.min(pIdx, points.length - 1));
          syncCriterionSummaryFromPoints(cData);
          rev.updatedAt = new Date().toISOString();
          triggerAutoSave();
          renderCriteriaForm();
        });
      });

      // Textarea focus, input, and per-point Ctrl+V image paste!
      card.querySelectorAll("[data-point-textarea]").forEach(ta => {
        const [, idxStr] = ta.dataset.pointTextarea.split(":");
        const pIdx = Number(idxStr);

        ta.addEventListener("focus", () => {
          activeCritKey = cm.key;
          activePointIdxByCrit[cm.key] = pIdx;
          updateQuickBarTargetLabel();
          document.querySelectorAll(".criterion-card").forEach(el => {
            el.classList.toggle("focused-card", el.dataset.crit === activeCritKey);
          });
          document.querySelectorAll(".point-item").forEach(el => {
            el.classList.toggle("active-point", el.dataset.pointWrap === `${cm.key}:${pIdx}`);
          });
        });

        ta.addEventListener("input", () => {
          points[pIdx].text = ta.value;
          syncCriterionSummaryFromPoints(cData);
          rev.updatedAt = new Date().toISOString();
          triggerAutoSave();
        });

        ta.addEventListener("paste", async e => {
          const items = (e.clipboardData && e.clipboardData.items) || [];
          for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1) {
              e.preventDefault();
              const file = items[i].getAsFile();
              if (file) {
                const compressed = await compressImageFile(file);
                points[pIdx].images.push(compressed);
                syncCriterionSummaryFromPoints(cData);
                rev.updatedAt = new Date().toISOString();
                triggerAutoSave();
                renderCriteriaForm({ critKey: cm.key, pointIdx: pIdx });
              }
            }
          }
        });
      });

      // 1-click Paste Image from Clipboard button per point
      card.querySelectorAll("[data-paste-btn]").forEach(pBtn => {
        pBtn.addEventListener("click", async () => {
          const [, idxStr] = pBtn.dataset.pasteBtn.split(":");
          const pIdx = Number(idxStr);
          try {
            if (navigator.clipboard && navigator.clipboard.read) {
              const clipItems = await navigator.clipboard.read();
              let foundImage = false;
              for (const item of clipItems) {
                const imgType = item.types.find(t => t.startsWith("image/"));
                if (imgType) {
                  const blob = await item.getType(imgType);
                  const compressed = await compressImageFile(blob);
                  points[pIdx].images.push(compressed);
                  syncCriterionSummaryFromPoints(cData);
                  rev.updatedAt = new Date().toISOString();
                  triggerAutoSave();
                  renderCriteriaForm({ critKey: cm.key, pointIdx: pIdx });
                  foundImage = true;
                }
              }
              if (!foundImage) {
                alert("Chưa có ảnh chụp màn hình trong bộ nhớ tạm.\n\nCách chụp màn hình:\n• Máy Windows: Nhấn Windows + Shift + S rồi kéo chuột khoanh vùng ảnh.\n• Máy Mac: Nhấn Cmd + Shift + Ctrl + 4 rồi kéo chuột khoanh vùng.\nSau đó bấm lại nút '📋 Dán ảnh vừa chụp' này nhé!");
              }
            } else {
              alert("Hãy bấm chuột vào ô chữ của Ý này rồi nhấn Ctrl + V (hoặc Cmd + V) để dán ảnh vừa chụp nhé!");
            }
          } catch (err) {
            alert("Hãy bấm chuột vào ô chữ của Ý này rồi nhấn Ctrl + V (hoặc Cmd + V) để dán ảnh vừa chụp nhé!");
          }
        });
      });

      // File upload per point
      card.querySelectorAll("[data-upload-pt]").forEach(fInp => {
        fInp.addEventListener("change", async e => {
          const [, idxStr] = fInp.dataset.uploadPt.split(":");
          const pIdx = Number(idxStr);
          const file = e.target.files && e.target.files[0];
          if (file) {
            const compressed = await compressImageFile(file);
            points[pIdx].images.push(compressed);
            syncCriterionSummaryFromPoints(cData);
            rev.updatedAt = new Date().toISOString();
            triggerAutoSave();
            renderCriteriaForm({ critKey: cm.key, pointIdx: pIdx });
          }
        });
      });

      // Delete image from a specific point
      card.querySelectorAll("[data-del-pt-img]").forEach(btn => {
        btn.addEventListener("click", () => {
          const [pIdxStr, iIdxStr] = btn.dataset.delPtImg.split(":");
          const pIdx = Number(pIdxStr);
          const iIdx = Number(iIdxStr);
          if (points[pIdx] && points[pIdx].images) {
            points[pIdx].images.splice(iIdx, 1);
            syncCriterionSummaryFromPoints(cData);
            rev.updatedAt = new Date().toISOString();
            triggerAutoSave();
            renderCriteriaForm({ critKey: cm.key, pointIdx: pIdx });
          }
        });
      });

      // Lightbox preview
      card.querySelectorAll("[data-preview-img]").forEach(imgEl => {
        imgEl.addEventListener("click", () => {
          document.getElementById("lightboxImg").src = imgEl.dataset.previewImg;
          document.getElementById("lightboxDialog").showModal();
        });
      });

      stack.appendChild(card);
    });

    if (focusTarget) {
      const targetTa = document.querySelector(`[data-point-textarea="${focusTarget.critKey}:${focusTarget.pointIdx}"]`);
      if (targetTa) {
        targetTa.focus();
        targetTa.setSelectionRange(targetTa.value.length, targetTa.value.length);
      }
    }
  }

  function assignOrAddSlidePoint(critKey, slideNum) {
    const lesson = getCurrentLesson();
    const rev = getOrCreateReview(lesson.id, currentUser.id, currentUser.name);
    const cData = rev.criteria[critKey];
    const points = ensureCriterionPoints(cData);
    let targetIdx = activePointIdxByCrit[critKey] || 0;
    if (targetIdx >= points.length) targetIdx = points.length - 1;

    const currentPt = points[targetIdx];
    if (currentPt && !currentPt.text.trim() && (!currentPt.images || currentPt.images.length === 0)) {
      // Current point is empty -> assign Slide N to it directly
      currentPt.slide = String(slideNum);
    } else {
      // Current point already has content -> create a new point for Slide N
      const newPt = createEmptyPoint(String(slideNum));
      points.push(newPt);
      targetIdx = points.length - 1;
      activePointIdxByCrit[critKey] = targetIdx;
    }

    syncCriterionSummaryFromPoints(cData);
    rev.updatedAt = new Date().toISOString();
    triggerAutoSave();
    renderCriteriaForm({ critKey, pointIdx: targetIdx });
    updateQuickBarTargetLabel();
  }

  function compressImageFile(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const maxW = 960;
          const scale = img.width > maxW ? maxW / img.width : 1;
          const off = document.createElement("canvas");
          off.width = Math.round(img.width * scale);
          off.height = Math.round(img.height * scale);
          const octx = off.getContext("2d");
          octx.drawImage(img, 0, 0, off.width, off.height);
          resolve(off.toDataURL("image/jpeg", 0.82));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const btnSubmitReview = document.getElementById("btnSubmitReview");
  if (btnSubmitReview) {
    btnSubmitReview.addEventListener("click", () => {
      const lesson = getCurrentLesson();
      const rev = getOrCreateReview(lesson.id, currentUser.id, currentUser.name);
      rev.status = "submitted";
      rev.updatedAt = new Date().toISOString();
      triggerAutoSave(true);
      renderCriteriaForm();
    });
  }

  function renderAdminDashboard() {
    const matrixTable = document.getElementById("progressMatrixTable");
    let thead = `<thead><tr><th>Giáo viên</th><th>PIN</th>`;
    db.lessons.forEach(l => {
      thead += `<th>${escapeHtml(l.code)} — ${escapeHtml(l.title)}</th>`;
    });
    thead += `</tr></thead>`;

    let tbody = `<tbody>`;
    db.teachers.forEach(t => {
      tbody += `<tr><td><strong>${escapeHtml(t.name)}</strong></td><td><code>${escapeHtml(t.pin)}</code></td>`;
      db.lessons.forEach(l => {
        const rev = db.reviews.find(r => r.lessonId === l.id && r.teacherId === t.id);
        if (rev) {
          CRITERIA_META.forEach(cm => {
            if (rev.criteria[cm.key]) ensureCriterionPoints(rev.criteria[cm.key]);
          });
        }
        const hasContent = rev && CRITERIA_META.some(cm => rev.criteria[cm.key] && rev.criteria[cm.key].text.trim().length > 0);
        let statusClass = "empty";
        let statusLabel = "Chưa gõ";
        if (rev && rev.status === "submitted" && hasContent) {
          statusClass = "done";
          statusLabel = "✓ Đã nộp";
        } else if (hasContent) {
          statusClass = "draft";
          statusLabel = "✎ Đang soạn";
        }
        tbody += `<td>
          <button type="button" class="matrix-cell-btn ${statusClass}" data-inspect-gv="${t.id}" data-inspect-lesson="${l.id}">
            ${statusLabel}
          </button>
        </td>`;
      });
      tbody += `</tr>`;
    });
    tbody += `</tbody>`;
    matrixTable.innerHTML = thead + tbody;

    matrixTable.querySelectorAll("[data-inspect-gv]").forEach(btn => {
      btn.addEventListener("click", () => {
        const gvId = btn.dataset.inspectGv;
        const lId = btn.dataset.inspectLesson;
        const foundT = db.teachers.find(x => x.id === gvId);
        if (foundT) {
          currentUser = { id: foundT.id, name: foundT.name, role: "teacher" };
          localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
          currentLessonId = lId;
          isAdminView = false;
          document.getElementById("teacherWorkspace").classList.remove("hidden");
          document.getElementById("adminWorkspace").classList.add("hidden");
          renderAll();
        }
      });
    });

    const lesson = getCurrentLesson();
    document.getElementById("adminComparisonTitle").textContent =
      `2. Chi tiết nhận xét — Bài ${lesson.code}: ${lesson.title}`;

    const filterSel = document.getElementById("adminTeacherFilter");
    const curVal = filterSel.value || "ALL";
    filterSel.innerHTML = `<option value="ALL">Tất cả Giáo viên</option>`;
    db.teachers.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      filterSel.appendChild(opt);
    });
    filterSel.value = curVal;

    const grid = document.getElementById("adminComparisonGrid");
    grid.innerHTML = "";
    const lessonReviews = db.reviews.filter(r => r.lessonId === lesson.id && (curVal === "ALL" || r.teacherId === curVal));

    CRITERIA_META.forEach((cm, idx) => {
      const box = document.createElement("div");
      box.className = "admin-crit-box";
      const colors = [
        { bg: "#ECFDF5", text: "#065F46" },
        { bg: "#FFFBEB", text: "#92400E" },
        { bg: "#EFF6FF", text: "#1E40AF" },
        { bg: "#FFF1F2", text: "#9F1239" }
      ][idx];

      let itemsHtml = "";
      lessonReviews.forEach(r => {
        const cData = r.criteria[cm.key];
        if (!cData) return;
        const pts = ensureCriterionPoints(cData).filter(
          p => p.text.trim().length > 0 || (p.images && p.images.length > 0)
        );
        if (pts.length === 0) return;

        const ptsHtml = pts
          .map((pt, pIdx) => {
            const sBadge = pt.slide ? `<span class="slide-tag-chip">Slide ${escapeHtml(pt.slide)}</span>` : `<span class="slide-tag-chip">Chung</span>`;
            const imgs = (pt.images || [])
              .map(src => `<div class="attached-thumb-wrap"><img src="${src}" data-preview-img="${src}" alt="Ảnh"></div>`)
              .join("");
            return `
              <div style="padding:6px 8px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:6px;margin-top:4px;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                  <strong style="font-size:11.5px;color:#475569;">Ý ${pIdx + 1}:</strong>
                  ${sBadge}
                </div>
                <div class="teacher-review-text">${escapeHtml(pt.text)}</div>
                ${imgs ? `<div class="attached-images-list" style="margin-top:6px;">${imgs}</div>` : ""}
              </div>
            `;
          })
          .join("");

        itemsHtml += `
          <div class="teacher-review-item">
            <div class="teacher-review-meta">
              <span class="teacher-review-name">${escapeHtml(r.teacherName)} (${pts.length} ý)</span>
            </div>
            ${ptsHtml}
          </div>
        `;
      });

      if (!itemsHtml) itemsHtml = `<p style="font-size:12.5px;color:#64748B;">Chưa có ý kiến.</p>`;

      box.innerHTML = `
        <div class="admin-crit-box-head" style="background:${colors.bg};color:${colors.text};">
          ${escapeHtml(cm.title)}
        </div>
        <div class="admin-crit-list">${itemsHtml}</div>
      `;

      box.querySelectorAll("[data-preview-img]").forEach(imgEl => {
        imgEl.addEventListener("click", () => {
          document.getElementById("lightboxImg").src = imgEl.dataset.previewImg;
          document.getElementById("lightboxDialog").showModal();
        });
      });

      grid.appendChild(box);
    });
  }

  const adminFilter = document.getElementById("adminTeacherFilter");
  if (adminFilter) {
    adminFilter.addEventListener("change", renderAdminDashboard);
  }

  const btnRefreshCloud = document.getElementById("btnRefreshCloud");
  if (btnRefreshCloud) {
    btnRefreshCloud.addEventListener("click", async () => {
      const orig = btnRefreshCloud.textContent;
      btnRefreshCloud.textContent = "⏳ Đang tải...";
      await fetchCloudDb(true);
      btnRefreshCloud.textContent = "✓ Đã cập nhật mới nhất";
      setTimeout(() => { btnRefreshCloud.textContent = orig; }, 1800);
    });
  }

  const btnToggleAdmin = document.getElementById("btnToggleAdmin");
  if (btnToggleAdmin) {
    btnToggleAdmin.addEventListener("click", async () => {
      if (!currentUser || currentUser.role !== "admin") return;
      isAdminView = !isAdminView;
      renderAll();
      if (isAdminView) {
        await fetchCloudDb(true);
      }
    });
  }

  function exportExcelFromBrowser() {
    // Pure client-side Excel (.xls HTML workbook compatible with Excel/Numbers/Google Sheets) fallback for static hosting
    let sheetsHtml = "";
    const critMeta = [
      { stt: "1", label: "1. Điểm ưng ý", key: "ung_y", bg: "#DCFCE7", fg: "#065F46" },
      { stt: "2", label: "2. Điểm cần làm rõ", key: "chua_hieu", bg: "#FEF3C7", fg: "#92400E" },
      { stt: "3", label: "3. Đề xuất cải tiến", key: "cai_tien", bg: "#DBEAFE", fg: "#1E40AF" },
      { stt: "4", label: "4. Khó khăn khi dạy", key: "kho_khan", bg: "#FFE4E6", fg: "#9F1239" }
    ];

    db.lessons.forEach(lesson => {
      const lessonRevs = (db.reviews || []).filter(r => r.lessonId === lesson.id);
      let rowsHtml = "";
      critMeta.forEach(cm => {
        const texts = [];
        const slideSet = new Set();
        lessonRevs.forEach(r => {
          const cObj = (r.criteria && r.criteria[cm.key]) || {};
          ensureCriterionPoints(cObj);
          const txt = (cObj.text || "").trim();
          if (txt) {
            texts.push(`<b>[${escapeHtml(r.teacherName)}]:</b><br>${escapeHtml(txt).replace(/\n/g, "<br>")}`);
          }
          (cObj.slides || []).forEach(s => slideSet.add(s));
        });
        const finalTxt = texts.length ? texts.join("<br><br>") : "(Chưa có nhận xét)";
        const finalSlides = slideSet.size ? Array.from(slideSet).sort((a, b) => a - b).map(s => `Slide ${s}`).join(", ") : "—";
        rowsHtml += `
          <tr>
            <td style="border:1px solid #CBD5E1;padding:10px;text-align:center;font-weight:bold;background:${cm.bg};color:${cm.fg};">${cm.stt}</td>
            <td style="border:1px solid #CBD5E1;padding:10px;font-weight:bold;background:${cm.bg};color:${cm.fg};">${escapeHtml(cm.label)}</td>
            <td style="border:1px solid #CBD5E1;padding:10px;vertical-align:top;">${finalTxt}</td>
            <td style="border:1px solid #CBD5E1;padding:10px;vertical-align:top;">${escapeHtml(finalSlides)}</td>
          </tr>
        `;
      });

      sheetsHtml += `
        <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;margin-bottom:28px;">
          <tr>
            <td colspan="4" style="background:#1E293B;color:#FFFFFF;font-size:14pt;font-weight:bold;padding:12px;">
              TỔNG HỢP NHẬN XÉT BÀI ${escapeHtml(lesson.code)}: ${escapeHtml(lesson.title.toUpperCase())} (${escapeHtml(lesson.grade || "")})
            </td>
          </tr>
          <tr>
            <td colspan="4" style="background:#EFF6FF;color:#1E3A8A;font-weight:bold;padding:8px;">
              Link bài giảng: ${escapeHtml(lesson.editorUrl || "")}
            </td>
          </tr>
          <tr>
            <th style="background:#1E3A8A;color:#FFFFFF;border:1px solid #CBD5E1;padding:10px;width:50px;">STT</th>
            <th style="background:#1E3A8A;color:#FFFFFF;border:1px solid #CBD5E1;padding:10px;width:180px;">Tiêu chí đánh giá</th>
            <th style="background:#1E3A8A;color:#FFFFFF;border:1px solid #CBD5E1;padding:10px;width:520px;">Nội dung nhận xét tổng hợp từ Giáo viên</th>
            <th style="background:#1E3A8A;color:#FFFFFF;border:1px solid #CBD5E1;padding:10px;width:180px;">Slide dẫn chứng</th>
          </tr>
          ${rowsHtml}
        </table>
      `;
    });

    const docHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body>${sheetsHtml}</body></html>`;
    const blob = new Blob(["\ufeff", docHtml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "TONG_HOP_NHAN_XET_GIAO_VIEN.xls";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const btnExportExcel = document.getElementById("btnExportExcel");
  if (btnExportExcel) {
    btnExportExcel.addEventListener("click", async () => {
      try {
        const res = await fetch(`/api/export-excel?lessonId=${encodeURIComponent(currentLessonId)}`);
        if (res.ok && (res.headers.get("content-type") || "").includes("spreadsheetml")) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "TONG_HOP_NHAN_XET_GIAO_VIEN.xlsx";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          return;
        }
      } catch (e) {}
      exportExcelFromBrowser();
    });
  }

  function setupDialogs() {
    document.querySelectorAll("dialog").forEach(dialog => {
      dialog.addEventListener("close", () => {
        dialog.returnValue = "";
      });
      if (!("closedBy" in HTMLDialogElement.prototype)) {
        dialog.addEventListener("click", event => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (isDialogContent) return;
          dialog.close();
        });
      }
    });

    document.querySelectorAll("[data-close-dialog]").forEach(btn => {
      btn.addEventListener("click", () => {
        const dlg = document.getElementById(btn.dataset.closeDialog);
        if (dlg) dlg.close();
      });
    });
  }

  function setupAuthPortal() {
    const tabTeacher = document.getElementById("authTabTeacher");
    const tabAdmin = document.getElementById("authTabAdmin");
    const formTeacher = document.getElementById("formTeacherLogin");
    const formAdmin = document.getElementById("formAdminLogin");
    const errTeacher = document.getElementById("authTeacherError");
    const errAdmin = document.getElementById("authAdminError");

    if (tabTeacher && tabAdmin && formTeacher && formAdmin) {
      tabTeacher.addEventListener("click", () => {
        tabTeacher.classList.add("active");
        tabTeacher.setAttribute("aria-selected", "true");
        tabAdmin.classList.remove("active");
        tabAdmin.setAttribute("aria-selected", "false");
        formTeacher.classList.remove("hidden");
        formAdmin.classList.add("hidden");
        if (errTeacher) errTeacher.classList.add("hidden");
        if (errAdmin) errAdmin.classList.add("hidden");
      });

      tabAdmin.addEventListener("click", () => {
        tabAdmin.classList.add("active");
        tabAdmin.setAttribute("aria-selected", "true");
        tabTeacher.classList.remove("active");
        tabTeacher.setAttribute("aria-selected", "false");
        formAdmin.classList.remove("hidden");
        formTeacher.classList.add("hidden");
        if (errTeacher) errTeacher.classList.add("hidden");
        if (errAdmin) errAdmin.classList.add("hidden");
        const adminPin = document.getElementById("authAdminPin");
        if (adminPin) adminPin.focus();
      });

      formTeacher.addEventListener("submit", e => {
        e.preventDefault();
        const sel = document.getElementById("authSelectTeacher");
        const pinInp = document.getElementById("authTeacherPin");
        const teacherId = sel ? sel.value : "";
        const enteredPin = pinInp ? pinInp.value.trim() : "";

        if (!teacherId) {
          if (errTeacher) {
            errTeacher.textContent = "Vui lòng chọn tên Giáo viên của bạn.";
            errTeacher.classList.remove("hidden");
          }
          return;
        }

        const found = (db.teachers || []).find(t => t.id === teacherId);
        if (!found || String(found.pin).trim() !== enteredPin) {
          if (errTeacher) {
            errTeacher.textContent = "Mã PIN không chính xác. Vui lòng kiểm tra lại.";
            errTeacher.classList.remove("hidden");
          }
          if (pinInp) {
            pinInp.focus();
            pinInp.select();
          }
          return;
        }

        if (errTeacher) errTeacher.classList.add("hidden");
        currentUser = { id: found.id, name: found.name, role: "teacher" };
        localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
        isAdminView = false;
        renderAll();
      });

      formAdmin.addEventListener("submit", e => {
        e.preventDefault();
        const pinInp = document.getElementById("authAdminPin");
        const enteredPin = pinInp ? pinInp.value.trim() : "";
        const adminPin = (db.meta && db.meta.adminPin) ? String(db.meta.adminPin).trim() : "8888";

        if (enteredPin !== adminPin) {
          if (errAdmin) {
            errAdmin.textContent = "Mã PIN Quản lý không đúng.";
            errAdmin.classList.remove("hidden");
          }
          if (pinInp) {
            pinInp.focus();
            pinInp.select();
          }
          return;
        }

        if (errAdmin) errAdmin.classList.add("hidden");
        currentUser = { id: "admin", name: "Ban Quản lý", role: "admin" };
        localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
        isAdminView = true;
        renderAll();
      });
    }

    const btnSignOut = document.getElementById("btnSignOut");
    if (btnSignOut) {
      btnSignOut.addEventListener("click", () => {
        if (confirm("Bạn có muốn đăng xuất khỏi hệ thống?")) {
          localStorage.removeItem(SESSION_KEY);
          currentUser = null;
          isAdminView = false;
          const teacherPinInp = document.getElementById("authTeacherPin");
          if (teacherPinInp) teacherPinInp.value = "";
          const adminPinInp = document.getElementById("authAdminPin");
          if (adminPinInp) adminPinInp.value = "";
          renderAll();
        }
      });
    }
  }

  function populateAuthTeacherSelect() {
    const sel = document.getElementById("authSelectTeacher");
    if (!sel) return;
    const curVal = sel.value;
    sel.innerHTML = '<option value="" disabled selected>-- Chọn tên của bạn --</option>';
    (db.teachers || []).forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    if (curVal) sel.value = curVal;
  }

  // Manage modal (2 separate tabs + Copy Teacher Table as Image)
  let editingTeacherId = null;
  let editingLessonId = null;

  const tabBtnTeachers = document.getElementById("tabBtnTeachers");
  const tabBtnLessons = document.getElementById("tabBtnLessons");
  const tabPanelTeachers = document.getElementById("tabPanelTeachers");
  const tabPanelLessons = document.getElementById("tabPanelLessons");

  function switchManageTab(tabName) {
    const isTeachers = tabName === "teachers";
    tabBtnTeachers.classList.toggle("active", isTeachers);
    tabBtnTeachers.setAttribute("aria-selected", String(isTeachers));
    tabBtnLessons.classList.toggle("active", !isTeachers);
    tabBtnLessons.setAttribute("aria-selected", String(!isTeachers));
    tabPanelTeachers.classList.toggle("hidden", !isTeachers);
    tabPanelLessons.classList.toggle("hidden", isTeachers);
  }

  if (tabBtnTeachers) tabBtnTeachers.addEventListener("click", () => switchManageTab("teachers"));
  if (tabBtnLessons) tabBtnLessons.addEventListener("click", () => switchManageTab("lessons"));

  const btnOpenManageModal = document.getElementById("btnOpenManageModal");
  if (btnOpenManageModal) {
    btnOpenManageModal.addEventListener("click", () => {
      editingTeacherId = null;
      editingLessonId = null;
      switchManageTab("teachers");
      renderManageLists();
      const manageDlg = document.getElementById("manageDialog");
      if (manageDlg) manageDlg.showModal();
    });
  }

  function getSharedAppUrl() {
    return window.location.origin + window.location.pathname;
  }

  const btnCopySharedUrl = document.getElementById("btnCopySharedUrl");
  if (btnCopySharedUrl) {
    btnCopySharedUrl.addEventListener("click", async e => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(getSharedAppUrl());
        btn.textContent = "✓ Đã copy Link!";
        setTimeout(() => { btn.textContent = "🔗 Copy Link Web chung"; }, 2000);
      } catch (err) {}
    });
  }

  function buildTeacherPinCardCanvas() {
    const teachers = db.teachers || [];
    const scale = 2;
    const width = 680;
    const rowH = 46;
    const headerH = 128;
    const tableHeadH = 44;
    const footerH = 54;
    const height = headerH + tableHeadH + teachers.length * rowH + footerH;

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // Background
    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(0, 0, width, height);

    // Top Banner
    ctx.fillStyle = "#0F172A";
    ctx.fillRect(0, 0, width, headerH);

    ctx.fillStyle = "#38BDF8";
    ctx.font = "bold 13px 'Be Vietnam Pro', sans-serif";
    ctx.fillText("NOVASTARS · HỆ THỐNG NHẬN XÉT BÀI GIẢNG", 28, 34);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 22px 'Plus Jakarta Sans', 'Be Vietnam Pro', sans-serif";
    ctx.fillText("BẢNG TÊN & MÃ PIN GIÁO VIÊN", 28, 68);

    ctx.fillStyle = "#93C5FD";
    ctx.font = "600 14px 'JetBrains Mono', monospace";
    ctx.fillText("🔗 Link web: " + getSharedAppUrl(), 28, 102);

    // Table Header
    const tableX = 24;
    const tableW = width - 48;
    const col1W = 64;
    const col3W = 160;
    const col2W = tableW - col1W - col3W;
    let curY = headerH + 12;

    ctx.fillStyle = "#2563EB";
    ctx.fillRect(tableX, curY, tableW, tableHeadH);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 14px 'Be Vietnam Pro', sans-serif";
    ctx.fillText("STT", tableX + 18, curY + 27);
    ctx.fillText("Họ và tên Giáo viên", tableX + col1W + 16, curY + 27);
    ctx.fillText("Mã PIN đăng nhập", tableX + col1W + col2W + 16, curY + 27);

    curY += tableHeadH;

    // Rows
    teachers.forEach((t, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? "#FFFFFF" : "#F1F5F9";
      ctx.fillRect(tableX, curY, tableW, rowH);

      ctx.strokeStyle = "#CBD5E1";
      ctx.lineWidth = 1;
      ctx.strokeRect(tableX, curY, tableW, rowH);

      // STT
      ctx.fillStyle = "#64748B";
      ctx.font = "bold 14px 'JetBrains Mono', monospace";
      ctx.fillText(String(idx + 1), tableX + 24, curY + 29);

      // Teacher Name
      ctx.fillStyle = "#0F172A";
      ctx.font = "bold 15px 'Be Vietnam Pro', sans-serif";
      ctx.fillText(t.name, tableX + col1W + 16, curY + 29);

      // PIN Pill
      const pinX = tableX + col1W + col2W + 16;
      ctx.fillStyle = "#EFF6FF";
      ctx.fillRect(pinX, curY + 9, 96, 28);
      ctx.strokeStyle = "#93C5FD";
      ctx.strokeRect(pinX, curY + 9, 96, 28);

      ctx.fillStyle = "#1D4ED8";
      ctx.font = "bold 16px 'JetBrains Mono', monospace";
      ctx.fillText(t.pin, pinX + 24, curY + 29);

      curY += rowH;
    });

    // Footer hint
    ctx.fillStyle = "#475569";
    ctx.font = "500 13px 'Be Vietnam Pro', sans-serif";
    ctx.fillText("💡 Hướng dẫn: Mở link web → Bấm 'Đổi GV' ở góc phải trên cùng → Chọn tên & nhập mã PIN.", 28, curY + 28);

    return canvas;
  }

  const btnCopyCard = document.getElementById("btnCopyTeacherCardImg");
  if (btnCopyCard) {
    btnCopyCard.addEventListener("click", async e => {
      const btn = e.currentTarget;
      const origText = btn.textContent;
      const canvas = buildTeacherPinCardCanvas();

      canvas.toBlob(async blob => {
        if (!blob) return;
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            btn.textContent = "✓ Đã copy Ảnh! Hãy nhấn Ctrl+V vào ô chat";
            setTimeout(() => { btn.textContent = origText; }, 3000);
            return;
          }
        } catch (err) {}
        // Fallback: show in lightbox so user can right-click copy image
        const titleEl = document.getElementById("lightboxTitle");
        if (titleEl) titleEl.textContent = "Bảng Tên & Mã PIN (Click chuột phải chọn Sao chép hình ảnh)";
        const imgEl = document.getElementById("lightboxImg");
        if (imgEl) imgEl.src = canvas.toDataURL("image/png");
        const dlg = document.getElementById("lightboxDialog");
        if (dlg) dlg.showModal();
      }, "image/png");
    });
  }

  function renderManageLists() {
    const tBox = document.getElementById("manageTeacherList");
    tBox.innerHTML = "";
    db.teachers.forEach((t, tIdx) => {
      const row = document.createElement("div");
      row.className = "manage-item-row";

      if (editingTeacherId === t.id) {
        row.innerHTML = `
          <div class="inline-edit-group">
            <input type="text" class="inline-edit-input" data-edit-t-name value="${escapeHtml(t.name)}" placeholder="Tên giáo viên">
            <input type="text" class="inline-edit-input mono-input" data-edit-t-pin value="${escapeHtml(t.pin)}" placeholder="PIN" style="max-width:76px;">
            <button type="button" class="btn-row-act save" data-save-t>✓ Lưu</button>
            <button type="button" class="btn-row-act" data-cancel-t>Hủy</button>
          </div>
        `;
        const nameInp = row.querySelector("[data-edit-t-name]");
        const pinInp = row.querySelector("[data-edit-t-pin]");
        const saveChanges = () => {
          const newName = nameInp.value.trim();
          const newPin = pinInp.value.trim() || t.pin;
          if (!newName) return;
          t.name = newName;
          t.pin = newPin;
          (db.reviews || []).forEach(r => {
            if (r.teacherId === t.id) r.teacherName = newName;
          });
          if (currentUser && currentUser.id === t.id) {
            currentUser.name = newName;
            localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
          }
          editingTeacherId = null;
          triggerAutoSave(true, true);
          renderManageLists();
          renderAll();
        };
        row.querySelector("[data-save-t]").addEventListener("click", saveChanges);
        nameInp.addEventListener("keydown", e => {
          if (e.key === "Enter") {
            e.preventDefault();
            saveChanges();
          }
        });
        row.querySelector("[data-cancel-t]").addEventListener("click", () => {
          editingTeacherId = null;
          renderManageLists();
        });
      } else {
        row.innerHTML = `
          <div><strong>${escapeHtml(t.name)}</strong> — PIN: <code>${escapeHtml(t.pin)}</code></div>
          <div class="manage-row-actions">
            <button type="button" class="btn-row-act" data-rename-t="${escapeHtml(t.id)}">✏️ Đổi tên</button>
            <button type="button" class="btn-row-act danger" data-delete-t="${escapeHtml(t.id)}">🗑️ Xóa</button>
          </div>
        `;
        row.querySelector("[data-rename-t]").addEventListener("click", () => {
          editingTeacherId = t.id;
          renderManageLists();
        });
        row.querySelector("[data-delete-t]").addEventListener("click", () => {
          if (db.teachers.length <= 1) {
            alert("Cần giữ lại ít nhất 1 giáo viên trong danh sách.");
            return;
          }
          db.teachers.splice(tIdx, 1);
          db.reviews = (db.reviews || []).filter(r => r.teacherId !== t.id);
          if (currentUser && currentUser.id === t.id) {
            const firstT = db.teachers[0];
            currentUser = { id: firstT.id, name: firstT.name, role: "teacher" };
            localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
          }
          triggerAutoSave(true, true);
          renderManageLists();
          renderAll();
        });
      }
      tBox.appendChild(row);
    });

    const lBox = document.getElementById("manageLessonList");
    lBox.innerHTML = "";
    db.lessons.forEach((l, lIdx) => {
      const row = document.createElement("div");
      row.className = "manage-item-row";

      if (editingLessonId === l.id) {
        row.innerHTML = `
          <div class="inline-edit-group">
            <input type="text" class="inline-edit-input mono-input" data-edit-l-code value="${escapeHtml(l.code)}" placeholder="Mã bài" style="max-width:95px;">
            <input type="text" class="inline-edit-input" data-edit-l-title value="${escapeHtml(l.title)}" placeholder="Tên bài giảng">
            <button type="button" class="btn-row-act save" data-save-l>✓ Lưu</button>
            <button type="button" class="btn-row-act" data-cancel-l>Hủy</button>
          </div>
        `;
        const codeInp = row.querySelector("[data-edit-l-code]");
        const titleInp = row.querySelector("[data-edit-l-title]");
        const saveLesson = () => {
          const newCode = codeInp.value.trim();
          const newTitle = titleInp.value.trim();
          if (!newCode || !newTitle) return;
          l.code = newCode;
          l.title = newTitle;
          editingLessonId = null;
          triggerAutoSave(true, true);
          renderManageLists();
          renderAll();
        };
        row.querySelector("[data-save-l]").addEventListener("click", saveLesson);
        row.querySelector("[data-cancel-l]").addEventListener("click", () => {
          editingLessonId = null;
          renderManageLists();
        });
      } else {
        row.innerHTML = `
          <div><strong>${escapeHtml(l.code)}</strong> — ${escapeHtml(l.title)}</div>
          <div class="manage-row-actions">
            <button type="button" class="btn-row-act" data-rename-l="${escapeHtml(l.id)}">✏️ Sửa</button>
            <button type="button" class="btn-row-act danger" data-delete-l="${escapeHtml(l.id)}">🗑️ Xóa</button>
          </div>
        `;
        row.querySelector("[data-rename-l]").addEventListener("click", () => {
          editingLessonId = l.id;
          renderManageLists();
        });
        row.querySelector("[data-delete-l]").addEventListener("click", () => {
          if (db.lessons.length <= 1) {
            alert("Cần giữ lại ít nhất 1 bài giảng trong danh sách.");
            return;
          }
          db.lessons.splice(lIdx, 1);
          if (currentLessonId === l.id) {
            currentLessonId = db.lessons[0].id;
          }
          triggerAutoSave(true, true);
          renderManageLists();
          renderAll();
        });
      }
      lBox.appendChild(row);
    });
  }

  const btnAddTeacher = document.getElementById("btnAddTeacher");
  if (btnAddTeacher) {
    btnAddTeacher.addEventListener("click", () => {
      const nameInp = document.getElementById("newTeacherName");
      const pinInp = document.getElementById("newTeacherPin");
      const name = nameInp ? nameInp.value.trim() : "";
      const pin = (pinInp ? pinInp.value.trim() : "") || "6666";
      if (!name) return;
      const id = "gv-" + Date.now().toString(36);
      db.teachers.push({ id, name, pin, role: "teacher" });
      if (nameInp) nameInp.value = "";
      if (pinInp) pinInp.value = "";
      triggerAutoSave(true, true);
      renderManageLists();
      renderAdminDashboard();
      populateAuthTeacherSelect();
    });
  }

  const btnAddLesson = document.getElementById("btnAddLesson");
  if (btnAddLesson) {
    btnAddLesson.addEventListener("click", () => {
      const codeInp = document.getElementById("newLessonCode");
      const titleInp = document.getElementById("newLessonTitle");
      const urlInp = document.getElementById("newLessonUrl");
      const code = codeInp ? codeInp.value.trim() : "";
      const title = titleInp ? titleInp.value.trim() : "";
      if (!code || !title) return;
      const slug = "ai-" + code.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const editorUrl = (urlInp ? urlInp.value.trim() : "") || `https://hd-tuongtac-editor.pages.dev/#/slides-editor/edit/${slug}`;
      db.lessons.push({
        id: slug,
        code,
        grade: "Khối mới",
        title,
        editorUrl,
        totalSlides: 18,
        slides: []
      });
      if (codeInp) codeInp.value = "";
      if (titleInp) titleInp.value = "";
      if (urlInp) urlInp.value = "";
      triggerAutoSave(true, true);
      renderManageLists();
      renderAll();
    });
  }

  function renderAll() {
    const authPortal = document.getElementById("authPortal");
    const mainTopBar = document.getElementById("mainTopBar");
    const teacherWorkspace = document.getElementById("teacherWorkspace");
    const adminWorkspace = document.getElementById("adminWorkspace");

    if (!currentUser) {
      if (authPortal) authPortal.classList.remove("hidden");
      if (mainTopBar) mainTopBar.classList.add("hidden");
      if (teacherWorkspace) teacherWorkspace.classList.add("hidden");
      if (adminWorkspace) adminWorkspace.classList.add("hidden");
      populateAuthTeacherSelect();
      return;
    }

    if (authPortal) authPortal.classList.add("hidden");
    if (mainTopBar) mainTopBar.classList.remove("hidden");

    renderTopBar();

    if (currentUser.role === "admin") {
      if (isAdminView) {
        if (teacherWorkspace) teacherWorkspace.classList.add("hidden");
        if (adminWorkspace) adminWorkspace.classList.remove("hidden");
        renderAdminDashboard();
      } else {
        if (teacherWorkspace) teacherWorkspace.classList.remove("hidden");
        if (adminWorkspace) adminWorkspace.classList.add("hidden");
        renderQuickSlideStrip();
        renderCriteriaForm();
      }
    } else {
      // Regular Teacher View
      isAdminView = false;
      if (teacherWorkspace) teacherWorkspace.classList.remove("hidden");
      if (adminWorkspace) adminWorkspace.classList.add("hidden");
      renderQuickSlideStrip();
      renderCriteriaForm();
    }
  }

  setupDialogs();
  setupAuthPortal();
  populateAuthTeacherSelect();
  renderAll();
  fetchServerDb();

  // Auto-sync from Cloud when window regains focus or every 10s in Admin view
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      fetchCloudDb(false);
    }
  });
  setInterval(() => {
    if (isAdminView && document.visibilityState === "visible") {
      fetchCloudDb(false);
    }
  }, 10000);
})();

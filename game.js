(function () {
  const config = window.PUZZLE_CONFIG || {};
  const levels = Array.isArray(config.levels) && config.levels.length
    ? config.levels
    : [{ cols: 2, rows: 2 }];

  const fallbackImageSrc = config.fallbackImageSrc || "./assets/puzzle.svg";
  const defaultTimeLimitMs = Number(config.timeLimitMs) || 5 * 60 * 1000;
  const previewMs = Number(config.previewMs) || 2000;
  const countdownFrom = Math.max(1, Number(config.countdownFrom) || 3);
  const nextLevelDelayMs = Number(config.nextLevelDelayMs) || 3000;
  const previewHint =
    typeof config.previewHint === "string"
      ? config.previewHint
      : "开始游戏前请记住图片的样子";

  const winPraise = 
    typeof config.winPraise === "string" ? config.winPraise : "真棒！";
  const appEl = document.getElementById("app");
  const boardEl = document.getElementById("board");
  const boardWrapEl = document.querySelector(".board-wrap");
  const trayEl = document.getElementById("tray");
  const levelLabel = document.getElementById("levelLabel");
  const levelTitleEl = document.getElementById("levelTitle");
  const timerEl = document.getElementById("timer");
  const gridLabel = document.getElementById("gridLabel");
  const restartBtn = document.getElementById("restartBtn");
  const previewOverlay = document.getElementById("previewOverlay");
  const previewImage = document.getElementById("previewImage");
  const previewBg = document.getElementById("previewBg");
  const countdownEl = document.getElementById("countdown");
  const previewHintEl = document.getElementById("previewHint");
  const winOverlay = document.getElementById("winOverlay");
  const winImage = document.getElementById("winImage");
  const winBg = document.getElementById("winBg");
  const winPraiseEl = document.getElementById("winPraise");
  const dialog = document.getElementById("dialog");
  const dialogTitle = document.getElementById("dialogTitle");
  const dialogMessage = document.getElementById("dialogMessage");
  const dialogPrimary = document.getElementById("dialogPrimary");

  let image = new Image();
  image.decoding = "async";

  const state = {
    levelIndex: 0,
    cols: 2,
    rows: 2,
    timeLimitMs: defaultTimeLimitMs,
    pieceCount: 0,
    placements: [],
    dragging: null,
    ghost: null,
    selectedId: null,
    pointer: null,
    timerId: null,
    deadline: 0,
    locked: true,
    previewTimer: null,
    winTimer: null,
    loadToken: 0,
  };

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr.length > 1 && arr.every((id, index) => id === index)) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function resolveTimeLimitMs(level) {
    const n = Number(level && level.timeLimitMs);
    if (Number.isFinite(n) && n > 0) return n;
    return defaultTimeLimitMs;
  }

  function describeDuration(ms) {
    const total = Math.max(1, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m && s) return `${m} 分 ${s} 秒`;
    if (m) return `${m} 分钟`;
    return `${s} 秒`;
  }

  function cssPx(styles, prop) {
    return parseFloat(styles.getPropertyValue(prop)) || 0;
  }

  // 用布局视口高度，这样双指缩放放大页面时拼图板不会被反向缩小
  function viewportHeight() {
    return window.innerHeight;
  }

  function setOverlayImages(src) {
    previewImage.src = src;
    winImage.src = src;
    const url = `url("${src}")`;
    previewBg.style.backgroundImage = url;
    winBg.style.backgroundImage = url;
  }

  function updateRatioVars() {
    const ratioW = image.naturalWidth || 4;
    const ratioH = image.naturalHeight || 3;
    const root = document.documentElement.style;
    root.setProperty("--board-ratio", `${ratioW} / ${ratioH}`);
    root.setProperty("--board-ratio-num", String(ratioW / ratioH));
    root.setProperty(
      "--piece-ratio",
      `${ratioW * state.rows} / ${ratioH * state.cols}`
    );
    // 单块 height/width， 供小图用padding 撑高度，避免被弹性/网格布局拉伸或压扁
    root.setProperty(
      "--piece-ratio-inv",
      String((ratioH * state.cols)/(ratioW * state.rows))
    );
  }

/*
  function syncGlowToImage() {
    if (!goldGlowEl || !winStage || winOverlay.classList.contains("hidden")) {
      return;
    }
    const stage = winStage.getBoundingClientRect();
    const box = winImage.getBoundingClientRect();
    if (!box.width || !box.height) return;

    let w = box.width;
    let h = box.height;
    // 万一元素框没能贴合图片（被拉伸后由 contain 留出黑边），按原图比例缩回真实画面
    const natRatio = (image.naturalWidth || 4) / (image.naturalHeight || 3);
    if (Math.abs(w / h - natRatio) > 0.01) {
      if (w / h > natRatio) w = h * natRatio;
      else h = w / natRatio;
    }

    const ring = Math.round(
      Math.min(22, Math.max(8, Math.min(stage.width, stage.height) * 0.022))
    );
    const centerX = box.left + box.width / 2 - stage.left;
    const centerY = box.top + box.height / 2 - stage.top;
    goldGlowEl.style.padding = `${ring}px`;
    goldGlowEl.style.width = `${w + ring * 2}px`;
    goldGlowEl.style.height = `${h + ring * 2}px`;
    goldGlowEl.style.left = `${centerX - w / 2 - ring}px`;
    goldGlowEl.style.top = `${centerY - h / 2 - ring}px`;
  }
*/

  let lastMaxH = "";
  let lastBoardH = "";

  // 拼图板高度不能超过屏幕剩余空间；图块区在右侧独立滚动，不占用这份高度
  function updateLayoutVars() {
    if (!boardWrapEl) return;
    const appStyles = getComputedStyle(appEl);
    const wrapStyles = getComputedStyle(boardWrapEl);
    const wrapPadY =
      cssPx(wrapStyles, "padding-top") +
      cssPx(wrapStyles, "padding-bottom") +
      cssPx(wrapStyles, "border-top-width") +
      cssPx(wrapStyles, "border-bottom-width");
    const wrapTop = boardWrapEl.getBoundingClientRect().top + window.scrollY;
    const available =
      viewportHeight() - wrapTop - wrapPadY - cssPx(appStyles, "padding-bottom");
    const root = document.documentElement.style;
    const maxH = `${Math.max(160, Math.floor(available))}px`;
    // 只在数值变化时写入，避免与 ResizeObserver 形成反复触发
    if (maxH !== lastMaxH) {
      lastMaxH = maxH;
      root.setProperty("--board-max-h", maxH);
    }
    // 读取新的实际高度，让右侧图块区与拼图板等高、超出部分内部滚动
    const boardH = `${Math.round(boardEl.getBoundingClientRect().height)}px`;
    if (boardH !== lastBoardH) {
      lastBoardH = boardH;
      root.setProperty("--board-h", boardH);
    }
    //syncGlowToImage();
  }

  let layoutFrame = 0;
  function scheduleLayoutUpdate() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      updateLayoutVars();
    });
  }

  function createPieceEl(id) {
    const el = document.createElement("div");
    el.className = "piece";
    el.role = "img";
    el.setAttribute("aria-label", `图块 ${id + 1}`);
    el.dataset.id = String(id);
    const col = id % state.cols;
    const row = Math.floor(id / state.cols);
    const x = state.cols === 1 ? 0 : (col / (state.cols - 1)) * 100;
    const y = state.rows === 1 ? 0 : (row / (state.rows - 1)) * 100;
    el.style.backgroundImage = `url("${image.currentSrc || image.src}")`;
    el.style.backgroundSize = `${state.cols * 100}% ${state.rows * 100}%`;
    el.style.backgroundPosition = `${x}% ${y}%`;
    el.addEventListener("pointerdown", onPiecePointerDown);
    if (state.selectedId === id) el.classList.add("selected");
    return el;
  }

  function clearTimers() {
    if (state.timerId) {
      cancelAnimationFrame(state.timerId);
      state.timerId = null;
    }
    if (state.previewTimer) {
      clearTimeout(state.previewTimer);
      state.previewTimer = null;
    }
    if (state.winTimer) {
      clearTimeout(state.winTimer);
      state.winTimer = null;
    }
  }

  function hideOverlays() {
    previewOverlay.classList.add("hidden");
    previewOverlay.setAttribute("aria-hidden", "true");
    winOverlay.classList.add("hidden");
    winOverlay.setAttribute("aria-hidden", "true");
    dialog.classList.add("hidden");
  }

  function showDialog(title, message, actionLabel, onAction) {
    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    dialogPrimary.textContent = actionLabel;
    dialogPrimary.onclick = onAction;
    dialog.classList.remove("hidden");
  }

  function renderBoard(trayOrder) {
    boardEl.style.setProperty("--cols", String(state.cols));
    boardEl.style.setProperty("--rows", String(state.rows));
    boardEl.innerHTML = "";
    trayEl.innerHTML = "";

    for (let i = 0; i < state.pieceCount; i += 1) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.slot = String(i);
      slot.addEventListener("pointerdown", onSlotPointerDown);
      boardEl.appendChild(slot);
      const placed = state.placements[i];
      if (placed !== null && placed !== undefined) {
        slot.appendChild(createPieceEl(placed));
      }
    }

    const ids = trayOrder || [];
    ids.forEach((id) => {
      const wrap = document.createElement("div");
      wrap.className = "piece-wrap";
      wrap.appendChild(createPieceEl(id));
      trayEl.appendChild(wrap);
    });
    syncSelectionStyles();
    scheduleLayoutUpdate();
  }

  function tickTimer() {
    const remain = state.deadline - Date.now();
    timerEl.textContent = formatTime(remain);
    timerEl.classList.toggle("urgent", remain <= 30 * 1000);
    if (remain <= 0) {
      onTimeout();
      return;
    }
    state.timerId = requestAnimationFrame(tickTimer);
  }

  function startPlayTimer() {
    const limit = state.timeLimitMs;
    state.deadline = Date.now() + limit;
    timerEl.textContent = formatTime(limit);
    timerEl.classList.remove("urgent");
    state.timerId = requestAnimationFrame(tickTimer);
  }

  function onTimeout() {
    state.locked = true;
    clearTimers();
    timerEl.textContent = "00:00";
    showDialog("时间到", `本局限时 ${describeDuration(state.timeLimitMs)} 已用完，可以重新开始这一关。`, "重新开始", () => {
      hideOverlays();
      startLevel(state.levelIndex, { restartTimer: true });
    });
  }

  function showPreviewThenPlay() {
    state.locked = true;
    setOverlayImages(image.src);
    previewOverlay.classList.remove("hidden");
    previewOverlay.setAttribute("aria-hidden", "false");
    countdownEl.textContent = String(countdownFrom);

    const step = previewMs / countdownFrom;
    let n = countdownFrom;
    const tick = () => {
      n -= 1;
      if (n >= 1) {
        countdownEl.textContent = String(n);
        state.previewTimer = setTimeout(tick, step);
        return;
      }
      countdownEl.textContent = "";
      previewOverlay.classList.add("hidden");
      previewOverlay.setAttribute("aria-hidden", "true");
      state.locked = false;
      startPlayTimer();
    };
    state.previewTimer = setTimeout(tick, step);
  }

  function levelImageSources(level) {
    return [...new Set([level.imageSrc, fallbackImageSrc].filter(Boolean))];
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const next = new Image();
      next.decoding = "async";
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error(src));
      next.src = src;
    });
  }

  async function loadLevelImage(level) {
    const sources = levelImageSources(level);
    for (const src of sources) {
      try {
        image = await loadImage(src);
        setOverlayImages(image.src);
        return;
      } catch {
        /* try next source */
      }
    }
    throw new Error("无法加载关卡原图");
  }

  function beginLevel() {
    updateRatioVars();
    state.pieceCount = state.cols * state.rows;
    const order = shuffle([...Array(state.pieceCount).keys()]);
    state.placements = Array(state.pieceCount).fill(null);
    state.selectedId = null;
    renderBoard(order);
    timerEl.textContent = formatTime(state.timeLimitMs);
    timerEl.classList.remove("urgent");
    showPreviewThenPlay();
  }

  function startLevel(index) {
    const token = state.loadToken + 1;
    state.loadToken = token;

    clearTimers();
    hideOverlays();
    state.locked = true;
    state.levelIndex = index;
    const level = levels[index] || levels[0];
    state.cols = Math.max(1, Number(level.cols) || 2);
    state.rows = Math.max(1, Number(level.rows) || 2);
    state.timeLimitMs = resolveTimeLimitMs(level);
    levelLabel.textContent = String(index + 1);
    if (levelTitleEl) levelTitleEl.textContent = level.title || `第 ${index + 1} 关`;
    gridLabel.textContent = `${state.cols} × ${state.rows}`;
    timerEl.textContent = formatTime(state.timeLimitMs);
    timerEl.classList.remove("urgent");

    loadLevelImage(level)
      .then(() => {
        if (token !== state.loadToken) return;
        beginLevel();
      })
      .catch(() => {
        if (token !== state.loadToken) return;
        showDialog(
          "无法加载原图",
          `请检查第 ${index + 1} 关 config.js 里的 imageSrc。`,
          "重试",
          () => {
            hideOverlays();
            startLevel(index);
          }
        );
      });
  }

  function slotFromPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el.classList && el.classList.contains("ghost")) continue;
      const slot = el.closest && el.closest(".slot");
      if (slot) return slot;
    }
    return null;
  }

  const DRAG_THRESHOLD = 8;

  function syncSelectionStyles() {
    document.querySelectorAll(".piece.selected").forEach((el) => {
      el.classList.remove("selected");
    });
    if (state.selectedId !== null) {
      document.querySelectorAll(`.piece[data-id="${state.selectedId}"]`).forEach((el) => {
        el.classList.add("selected");
      });
      boardEl.classList.add("awaiting-place");
    } else {
      boardEl.classList.remove("awaiting-place");
    }
  }

  function setSelectedId(id) {
    state.selectedId = id;
    syncSelectionStyles();
  }

  function placePieceOnSlot(id, targetIndex) {
    const fromSlotIndex = state.placements.indexOf(id);
    const fromSlot = fromSlotIndex >= 0 ? fromSlotIndex : null;
    const occupant = state.placements[targetIndex];
    if (fromSlot !== null) state.placements[fromSlot] = null;
    if (occupant !== null && occupant !== id && fromSlot !== null) {
      state.placements[fromSlot] = occupant;
    }
    state.placements[targetIndex] = id;
    state.selectedId = null;
    rebuildFromState();
    if (isSolved()) onSolved();
  }

  function onPiecePointerDown(event) {
    if (state.locked) return;
    if (event.button !== undefined && event.button !== 0) return;
    const piece = event.currentTarget;
    const fromSlot = piece.closest(".slot");
    const fromTray = piece.closest(".piece-wrap");
    const id = Number(piece.dataset.id);
    event.preventDefault();
    piece.setPointerCapture(event.pointerId);
    state.pointer = {
      id,
      piece,
      fromSlotIndex: fromSlot ? Number(fromSlot.dataset.slot) : null,
      fromTray: Boolean(fromTray),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onSlotPointerDown(event) {
    if (state.locked) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest(".piece")) return;
    if (state.selectedId === null) return;
    event.preventDefault();
    state.pointer = {
      slotOnly: true,
      slotIndex: Number(event.currentTarget.dataset.slot),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function startDrag(event) {
    const pointer = state.pointer;
    if (!pointer || pointer.dragged || pointer.slotOnly) return;
    pointer.dragged = true;
    const piece = pointer.piece;
    const rect = piece.getBoundingClientRect();
    // 从下方托盘拖出时按大图格子的尺寸显示，避免小图与落点大小不一致
    const slotRect = pointer.fromTray
      ? boardEl.querySelector(".slot")?.getBoundingClientRect()
      : null;
    const ghostW = slotRect ? slotRect.width : rect.width;
    const ghostH = slotRect ? slotRect.height : rect.height;
    const ghost = piece.cloneNode(true);
    ghost.classList.remove("selected");
    ghost.classList.add("ghost");
    ghost.style.pointerEvents = "none";
    ghost.style.width = `${ghostW}px`;
    ghost.style.height = `${ghostH}px`;
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    document.body.appendChild(ghost);
    piece.style.opacity = "0.25";
    piece.style.pointerEvents = "none";
    state.dragging = {
      id: pointer.id,
      piece,
      fromSlotIndex: pointer.fromSlotIndex,
      fromTray: pointer.fromTray,
      pointerId: pointer.pointerId,
    };
    state.ghost = ghost;
  }

  function onPointerMove(event) {
    if (!state.pointer) return;
    const dx = event.clientX - state.pointer.startX;
    const dy = event.clientY - state.pointer.startY;
    if (!state.dragging && !state.pointer.slotOnly && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      startDrag(event);
    }
    if (!state.ghost) return;
    state.ghost.style.left = `${event.clientX}px`;
    state.ghost.style.top = `${event.clientY}px`;
    document.querySelectorAll(".slot.drop-target").forEach((el) => {
      el.classList.remove("drop-target");
    });
    const slot = slotFromPoint(event.clientX, event.clientY);
    if (slot) slot.classList.add("drop-target");
  }

  function cleanupPointer() {
    document.querySelectorAll(".slot.drop-target").forEach((el) => {
      el.classList.remove("drop-target");
    });
    if (state.ghost) {
      state.ghost.remove();
      state.ghost = null;
    }
    if (state.dragging) {
      state.dragging.piece.style.opacity = "";
      state.dragging.piece.style.pointerEvents = "";
    }
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    state.dragging = null;
    state.pointer = null;
  }

  function handlePieceClick(id, fromSlotIndex) {
    if (fromSlotIndex !== null && state.selectedId !== null && state.selectedId !== id) {
      placePieceOnSlot(state.selectedId, fromSlotIndex);
      return;
    }
    setSelectedId(state.selectedId === id ? null : id);
  }

  function returnToTray(id) {
    const idx = state.placements.indexOf(id);
    if (idx >= 0) state.placements[idx] = null;
  }

  function onPointerUp(event) {
    const pointer = state.pointer;
    if (!pointer) return;

    if (pointer.slotOnly) {
      const selectedId = state.selectedId;
      cleanupPointer();
      if (selectedId === null) return;
      const slot = slotFromPoint(event.clientX, event.clientY);
      if (!slot) return;
      placePieceOnSlot(selectedId, Number(slot.dataset.slot));
      return;
    }

    if (state.dragging) {
      const { id, fromSlotIndex } = state.dragging;
      const slot = slotFromPoint(event.clientX, event.clientY);
      cleanupPointer();
      if (slot) {
        placePieceOnSlot(id, Number(slot.dataset.slot));
      } else if (fromSlotIndex !== null) {
        returnToTray(id);
        rebuildFromState();
      }
      return;
    }

    const { id, fromSlotIndex } = pointer;
    cleanupPointer();
    handlePieceClick(id, fromSlotIndex);
  }

  function rebuildFromState() {
    const trayOrder = [];
    const trayImgs = [...trayEl.querySelectorAll(".piece")].map((el) => Number(el.dataset.id));
    trayImgs.forEach((id) => {
      if (!state.placements.includes(id)) trayOrder.push(id);
    });
    for (let id = 0; id < state.pieceCount; id += 1) {
      if (!state.placements.includes(id) && !trayOrder.includes(id)) trayOrder.push(id);
    }
    renderBoard(trayOrder);
  }

  function isSolved() {
    return state.placements.every((id, index) => id === index);
  }

  function onSolved() {
    state.locked = true;
    clearTimers();
    winOverlay.classList.remove("hidden");
    winOverlay.setAttribute("aria-hidden", "false");
    //syncGlowToImage();
    //requestAnimationFrame(syncGlowToImage);

    const isLast = state.levelIndex >= levels.length - 1;
    state.winTimer = setTimeout(() => {
      if (isLast) {
        showDialog("全部通关", "原图已全部复原，要再玩一遍吗？", "回到第 1 关", () => {
          hideOverlays();
          startLevel(0);
        });
      } else {
        const next = levels[state.levelIndex + 1];
        showDialog(
          "进入下一关",
          `太棒了！下一关是 ${next.title || "新关卡"}`,
          "开始下一关",
          () => {
            hideOverlays();
            startLevel(state.levelIndex + 1);
          }
        );
      }
    }, nextLevelDelayMs);
  }

  restartBtn.addEventListener("click", () => {
    startLevel(state.levelIndex);
  });

  function watchViewportChanges() {
    window.addEventListener("resize", scheduleLayoutUpdate);
    window.addEventListener("orientationchange", scheduleLayoutUpdate);
    if (window.visualViewport) {
      // 手机地址栏收起/软键盘弹出会改变可视高度
      window.visualViewport.addEventListener("resize", scheduleLayoutUpdate);
    }
    if (typeof ResizeObserver === "function" && boardWrapEl) {
      // HUD 换行等导致拼图板位置变化时重新测量
      new ResizeObserver(scheduleLayoutUpdate).observe(boardWrapEl);
    }
    document.fonts?.ready.then(scheduleLayoutUpdate).catch(() => {});
  }

  function boot() {
    if (previewHintEl) previewHintEl.textContent = previewHint;
    if (winPraiseEl) winPraiseEl.textContent = winPraise;
    winOverlay.classList.toggle("no-praise", !winPraise);
    watchViewportChanges();
    scheduleLayoutUpdate();
    startLevel(0);
  }

  boot();
})();

/**
 * script.js — External Merge Sort Visualizer
 *
 * Kiến trúc:
 *  - Gọi API /api/sort để lấy animation_steps (mảng các hành động nguyên tử)
 *  - Engine duyệt step bằng Play/Pause, Step Forward, Step Backward
 *  - Mỗi DATA CELL là một thẻ <div> được đặt vào DOM container tương ứng
 *  - Dùng CSS transition để di chuyển mượt mà khi thay đổi container
 *  - Hỗ trợ đổi màu: xanh lá (compare), xanh lơ ice (frozen)
 */

// ==================================================================
// DOM
// ==================================================================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const inputDataEl     = $("#input-data");
const btnRandom       = $("#btn-random");
const presetButtons   = $$(".preset-btn");
const inputB          = $("#input-B");
const chkRepacking    = $("#chk-repacking");

const btnPlay         = $("#btn-play");
const btnStepFwd      = $("#btn-step-fwd");
const btnStepBack     = $("#btn-step-back");
const btnReset        = $("#btn-reset");
const speedSlider     = $("#speed-slider");
const speedVal        = $("#speed-val");
const btnTheme        = $("#btn-theme");

const statPass        = $("#stat-pass");
const statReads       = $("#stat-reads");
const statWrites      = $("#stat-writes");
const statStep        = $("#stat-step");
const statusMsg       = $("#status-msg");

const diskArea        = $("#disk-area");
const ramArea         = $("#ram-area");
const tempArea        = $("#temp-area");
const outputArea      = $("#output-area");
const ramBLabel       = $("#ram-B-label");
const logEntries      = $("#log-entries");
const dataDisplay     = $("#data-display");
const procInfo        = $("#processing-info");

// ==================================================================
// STATE
// ==================================================================
let allSteps = [];          // animation_steps từ API
let allElements = [];       // danh sách {id, value}
let currentStepIdx = -1;    // bước hiện tại (-1 = chưa bắt đầu)
let isPlaying = false;
let playTimer = null;
let B = 3;

// Snapshot history cho Step Backward
// Lưu checkpoint nhẹ theo chu kỳ để Step Backward không phải snapshot HTML toàn phần
let checkpoints = [];
const CHECKPOINT_INTERVAL = 25;

const EFFECT_CLASSES = ["frozen", "comparing", "highlight-green", "highlight-amber", "faded"];

// Cell registry: id -> DOM element
let cellMap = {};

// Frozen set (dùng cho Repacking)
let frozenSet = new Set();

// Theme
const THEME_STORAGE_KEY = "ems_theme";

function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark-mode", isDark);
    if (btnTheme) {
        btnTheme.textContent = isDark ? "☀ Light" : "🌙 Dark";
    }
}

function initTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") {
        applyTheme(saved);
        return;
    }
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
}

if (btnTheme) {
    btnTheme.addEventListener("click", () => {
        const nextTheme = document.body.classList.contains("dark-mode") ? "light" : "dark";
        applyTheme(nextTheme);
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    });
}

initTheme();

// ==================================================================
// DATA INPUT
// ==================================================================
if (btnRandom) {
    btnRandom.addEventListener("click", () => {
        const count = 10 + Math.floor(Math.random() * 11); // 10–20 phần tử
        const nums = [];
        for (let i = 0; i < count; i++) {
            nums.push(Math.round(Math.random() * 98 + 1)); // 1–99 integers
        }
        inputDataEl.value = nums.join(", ");
        setStatus(`Đã tạo ${count} số ngẫu nhiên.`);
        enablePlayButtons(false);
    });
}

if (presetButtons && presetButtons.length > 0) {
    presetButtons.forEach((button) => {
        button.addEventListener("click", () => {
        const key = button.dataset.preset;
        const values = generatePresetData(key);
        inputDataEl.value = values.join(", ");
        setStatus(`Đã áp dụng preset: ${key}.`);
        enablePlayButtons(false);
    });
    });
}

if (btnReset) {
    btnReset.addEventListener("click", () => {
        resetAll();
        setStatus("Đã reset nhanh về trạng thái ban đầu.");
    });
}

function generatePresetData(type) {
    const n = 18;
    if (type === "best") {
        return Array.from({ length: n }, (_, i) => i + 1);
    }
    if (type === "sorted") {
        return Array.from({ length: n }, (_, i) => (i + 1) * 2);
    }
    if (type === "random") {
        return Array.from({ length: n }, () => Math.floor(Math.random() * 99) + 1);
    }
    if (type === "duplicates") {
        const pool = [3, 5, 7, 9, 11];
        return Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)]);
    }
    if (type === "near") {
        const arr = Array.from({ length: n }, (_, i) => i + 1);
        for (let i = 0; i < 3; i++) {
            const a = Math.floor(Math.random() * n);
            const b = Math.floor(Math.random() * n);
            [arr[a], arr[b]] = [arr[b], arr[a]];
        }
        return arr;
    }
    return Array.from({ length: n }, () => Math.floor(Math.random() * 99) + 1);
}

// ==================================================================
// SPEED
// ==================================================================
speedSlider.addEventListener("input", () => { speedVal.textContent = speedSlider.value; });
function getDelay() {
    const s = parseInt(speedSlider.value);
    return Math.max(80, 1200 - s * 120);
}

// ==================================================================
// PLAY / PAUSE / STEP / RESET
// ==================================================================
btnPlay.addEventListener("click", async () => {
    // Nếu chưa load steps → gọi API trước
    if (allSteps.length === 0 || currentStepIdx === -1) {
        const ok = await loadFromAPI();
        if (!ok) return;
    }

    // Toggle play/pause
    if (isPlaying) {
        pauseAnim();
    } else {
        isPlaying = true;
        btnPlay.textContent = "⏸ Pause";
        tickPlay();
    }
});

btnStepFwd.addEventListener("click", () => {
    if (allSteps.length === 0) return;
    pauseAnim();
    stepForward();
});

btnStepBack.addEventListener("click", () => {
    if (allSteps.length === 0) return;
    pauseAnim();
    stepBackward();
});

function enablePlayButtons(loaded) {
    btnPlay.disabled = false;
    btnStepFwd.disabled = !loaded;
    btnStepBack.disabled = !loaded;
}

function pauseAnim() {
    isPlaying = false;
    clearTimeout(playTimer);
    btnPlay.textContent = "▶ Play";
}

function tickPlay() {
    if (!isPlaying) return;
    if (currentStepIdx >= allSteps.length - 1) {
        pauseAnim();
        setStatus("Hoàn tất!");
        return;
    }
    stepForward();
    playTimer = setTimeout(tickPlay, getDelay());
}

// ==================================================================
// API CALL
// ==================================================================
async function loadFromAPI() {
    const raw = inputDataEl.value.trim();
    if (!raw) {
        setStatus("[Cảnh báo] Vui lòng nhập dữ liệu trước.");
        return false;
    }
    const data = raw.split(/[,;\s]+/).map(Number).filter((x) => !isNaN(x));
    if (data.length < 2) {
        setStatus("[Cảnh báo] Cần ít nhất 2 số.");
        return false;
    }

    B = parseInt(inputB.value) || 3;
    if (B < 3) { B = 3; inputB.value = 3; }
    const mode = chkRepacking.checked ? "repacking" : "standard";

    setStatus("Đang gửi dữ liệu…");
    btnPlay.disabled = true;

    try {
        const res = await fetch("/api/sort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data, B, mode }),
        });
        const json = await res.json();
        if (json.error) {
            setStatus("[Lỗi] " + json.error);
            btnPlay.disabled = false;
            return false;
        }

        allSteps = json.animation_steps;
        allElements = json.elements;
        currentStepIdx = -1;
        checkpoints = [];
        frozenSet.clear();

        // Build initial visualization
        buildInitialStage(json);
        addCheckpoint(-1);
        procInfo.style.display = "block";
        enablePlayButtons(true);
        setStatus(`[OK] ${allSteps.length} bước · Mode: ${mode} · B=${B} · Nhấn Play hoặc Step >>`);
        updateStepStat();
        return true;
    } catch (err) {
        setStatus("[Lỗi] " + err.message);
        btnPlay.disabled = false;
        return false;
    }
}

// ==================================================================
// BUILD INITIAL STAGE (render cells trên Input Disk)
// ==================================================================
function buildInitialStage(json) {
    // Clear all areas
    diskArea.innerHTML = "";
    ramArea.innerHTML = "";
    tempArea.innerHTML = "";
    outputArea.innerHTML = "";
    logEntries.innerHTML = "";
    dataDisplay.innerHTML = "";
    cellMap = {};

    // Reset stats
    statPass.textContent = "—";
    statReads.textContent = "0";
    statWrites.textContent = "0";

    buildRamPages();

    // Build Input Disk cells
    let initialValues = [];
    for (const elem of json.elements) {
        const cell = createCell(elem.id, elem.value);
        diskArea.appendChild(cell);
        initialValues.push(formatNum(elem.value));
    }
    dataDisplay.textContent = "[ " + initialValues.join(", ") + " ]";
}

function buildRamPages() {
    ramBLabel.textContent = B;
    for (let i = 0; i < B; i++) {
        const page = document.createElement("div");
        page.className = "ram-page";
        page.id = `ram-page-${i}`;
        const lbl = document.createElement("div");
        lbl.className = "ram-page-label";
        lbl.textContent = `P${i}`;
        page.appendChild(lbl);
        // Placeholder cell (empty)
        const placeholder = document.createElement("div");
        placeholder.className = "cell hidden";
        placeholder.textContent = "";
        placeholder.id = `ram-placeholder-${i}`;
        page.appendChild(placeholder);
        ramArea.appendChild(page);
    }
}

function createCell(id, value) {
    const cell = document.createElement("div");
    cell.className = "cell pop-in";
    cell.id = id;
    cell.textContent = formatNum(value);
    cell.dataset.value = value;
    cellMap[id] = cell;
    return cell;
}

function formatNum(v) {
    if (Number.isInteger(v)) return v.toString();
    return parseFloat(Number(v).toFixed(2)).toString();
}

// ==================================================================
// STEP FORWARD
// ==================================================================
function stepForward() {
    if (currentStepIdx >= allSteps.length - 1) return;

    currentStepIdx++;
    const step = allSteps[currentStepIdx];
    executeStep(step, currentStepIdx, { log: true, status: true });

    if (currentStepIdx % CHECKPOINT_INTERVAL === 0) {
        addCheckpoint(currentStepIdx);
    }
    updateStepStat();
}

// ==================================================================
// STEP BACKWARD
// ==================================================================
function stepBackward() {
    if (currentStepIdx < 0) return;

    const target = currentStepIdx - 1;
    restoreToStep(target);
    currentStepIdx = target;
    updateStepStat();
}

// ==================================================================
// EXECUTE STEP
// ==================================================================
function executeStep(step, idx, opts = { log: true, status: true }) {
    const action = step.action;
    const desc = step.description || "";

    // Log entry
    if (opts.log) {
        addLog(idx + 1, action, desc);
    }

    switch (action) {
        case "move":
            handleMove(step);
            break;
        case "compare":
            handleCompare(step);
            break;
        case "swap":
            handleSwap(step);
            break;
        case "freeze":
            handleFreeze(step);
            break;
        case "unfreeze_all":
            handleUnfreezeAll();
            break;
        case "highlight":
            handleHighlight(step);
            break;
        case "clear_highlight":
            handleClearHighlight(step);
            break;
        case "label":
            handleLabel(step);
            break;
        case "new_run":
            handleNewRun(step);
            break;
        case "clear_ram":
            handleClearRam();
            break;
        case "set_output_buffer":
            handleSetOutputBuffer(step);
            break;
        case "promote_runs":
            handlePromoteRuns(step);
            break;
        default:
            break;
    }

    if (opts.status && desc) setStatus(`[Bước #${idx + 1}] ${desc}`);
}

// ==================================================================
// ACTION HANDLERS
// ==================================================================

function handleMove(step) {
    const cell = cellMap[step.element_id];
    if (!cell) return;

    // Clear compare/highlight classes
    clearCellEffects(cell);

    const to = step.to;

    if (to.startsWith("ram_page_")) {
        // Move to a RAM page
        const pageIdx = parseInt(to.replace("ram_page_", ""));
        const page = document.getElementById(`ram-page-${pageIdx}`);
        if (page) {
            // Remove placeholder if exists
            const ph = page.querySelector(".cell.hidden");
            if (ph) ph.remove();
            // Remove cell from current parent
            if (cell.parentNode) cell.parentNode.removeChild(cell);
            page.appendChild(cell);
            cell.classList.remove("hidden", "faded", "pop-in");
            cell.classList.add("pop-in");
        }
    } else if (to === "temp_disk") {
        // Move to a specific run in temp area
        const runIdx = step.to_run;
        const runContainer = document.getElementById(`run-${runIdx}`);
        if (runContainer) {
            const cellsDiv = runContainer.querySelector(".run-cells");
            if (cell.parentNode) cell.parentNode.removeChild(cell);
            cellsDiv.appendChild(cell);
            cell.classList.remove("hidden", "faded", "pop-in");
            cell.classList.add("pop-in");
        }
        // Fade cell in disk if it was there
    } else if (to === "merge_output") {
        // Move to merge output area (inside temp-area, one row per output run)
        const outRun = Number.isInteger(step.to_run) ? step.to_run : 0;
        const moRow = ensureMergeOutputRow(outRun);
        const cellsDiv = moRow.querySelector(".merge-output-cells");
        if (cell.parentNode) cell.parentNode.removeChild(cell);
        cellsDiv.appendChild(cell);
        cell.classList.remove("hidden", "faded", "frozen", "pop-in");
        cell.classList.add("pop-in");
        frozenSet.delete(step.element_id);
    } else if (to === "output") {
        // Move to output area
        if (cell.parentNode) cell.parentNode.removeChild(cell);
        outputArea.appendChild(cell);
        cell.classList.remove("hidden", "faded", "frozen", "pop-in");
        cell.classList.add("pop-in");
        frozenSet.delete(step.element_id);
    }

    // Fade the source in disk
    if (step.from === "disk") {
        // The cell has moved out of disk, so it's already removed from diskArea
    }
}

function handleCompare(step) {
    // Highlight 2 cells in green
    clearAllCompares();
    if (step.elements) {
        step.elements.forEach((id) => {
            const c = cellMap[id];
            if (c) c.classList.add("comparing");
        });
    }
}

function handleSwap(step) {
    clearAllCompares();
    const cellA = cellMap[step.element_a];
    const cellB = cellMap[step.element_b];
    if (!cellA || !cellB) return;

    const pageA = document.getElementById(`ram-page-${step.page_a}`);
    const pageB = document.getElementById(`ram-page-${step.page_b}`);
    if (!pageA || !pageB) return;

    // Remove both from parents
    if (cellA.parentNode) cellA.parentNode.removeChild(cellA);
    if (cellB.parentNode) cellB.parentNode.removeChild(cellB);

    // Place A in page_b, B in page_a (swap!)
    pageB.appendChild(cellA);
    pageA.appendChild(cellB);

    // Flash amber
    cellA.classList.add("highlight-amber");
    cellB.classList.add("highlight-amber");
    setTimeout(() => {
        cellA.classList.remove("highlight-amber");
        cellB.classList.remove("highlight-amber");
    }, 400);
}

function handleFreeze(step) {
    const cell = cellMap[step.element_id];
    if (cell) {
        cell.classList.add("frozen");
        frozenSet.add(step.element_id);
    }
}

function handleUnfreezeAll() {
    frozenSet.forEach((id) => {
        const c = cellMap[id];
        if (c) c.classList.remove("frozen");
    });
    frozenSet.clear();
}

function handleHighlight(step) {
    const cell = cellMap[step.element_id];
    if (cell) {
        clearAllCompares();
        const cls = step.color === "green" ? "highlight-green" : "highlight-amber";
        cell.classList.add(cls);
    }
}

function handleClearHighlight(step) {
    if (step.element_id) {
        const cell = cellMap[step.element_id];
        if (cell) clearCellEffects(cell);
    } else {
        clearAllCompares();
    }
}

function handleLabel(step) {
    if (step.key === "pass") {
        statPass.textContent = step.value;
    } else if (step.key === "io_reads") {
        statReads.textContent = step.value;
    } else if (step.key === "io_writes") {
        statWrites.textContent = step.value;
    }
}

function handleNewRun(step) {
    ensureRunContainer(step.run_index, false);
}

function handleClearRam() {
    clearAllCompares();
    // Move all cells in RAM pages back to hidden state or just leave them
    // (they should have already been moved out by move actions)
    for (let i = 0; i < B; i++) {
        const page = document.getElementById(`ram-page-${i}`);
        if (page) {
            // Remove data cells (keep label)
            const dataCells = page.querySelectorAll(".cell:not(.hidden)");
            dataCells.forEach((c) => c.remove());
        }
    }
}

function handleSetOutputBuffer(step) {
    const page = document.getElementById(`ram-page-${step.page_index}`);
    if (page) {
        page.classList.add("output-buffer");
        const lbl = page.querySelector(".ram-page-label");
        if (lbl) lbl.textContent = `P${step.page_index} (Out)`;
    }
}

function handlePromoteRuns(step) {
    // Merge pass done → move merge-output to be new runs
    const mergeRows = Array.from(tempArea.querySelectorAll(".merge-output-row"));
    if (mergeRows.length > 0) {
        const oldRuns = tempArea.querySelectorAll(".run-container");
        oldRuns.forEach((r) => r.remove());

        mergeRows.sort((a, b) => {
            const ai = parseInt((a.id.split("merge-output-row-")[1] || "0"), 10);
            const bi = parseInt((b.id.split("merge-output-row-")[1] || "0"), 10);
            return ai - bi;
        });

        mergeRows.forEach((row) => {
            const runIdx = parseInt((row.id.split("merge-output-row-")[1] || "0"), 10);
            const cellsDiv = row.querySelector(".merge-output-cells");
            const cells = cellsDiv ? Array.from(cellsDiv.children) : [];

            const runDiv = document.createElement("div");
            runDiv.className = "run-container";
            runDiv.id = `run-${runIdx}`;
            const lbl = document.createElement("div");
            lbl.className = "run-label";
            lbl.textContent = `Run #${runIdx} (merged)`;
            runDiv.appendChild(lbl);

            const cd = document.createElement("div");
            cd.className = "run-cells";
            cells.forEach((c) => cd.appendChild(c));
            runDiv.appendChild(cd);
            tempArea.appendChild(runDiv);

            row.remove();
        });
    }

    // Reset output buffer marking
    for (let i = 0; i < B; i++) {
        const page = document.getElementById(`ram-page-${i}`);
        if (page) {
            page.classList.remove("output-buffer");
            const lbl = page.querySelector(".ram-page-label");
            if (lbl) lbl.textContent = `P${i}`;
        }
    }
}

// ==================================================================
// UTILITIES
// ==================================================================

function clearCellEffects(cell) {
    cell.classList.remove("comparing", "highlight-green", "highlight-amber");
}

function clearAllCompares() {
    $$(".cell.comparing").forEach((c) => c.classList.remove("comparing"));
    $$(".cell.highlight-green").forEach((c) => c.classList.remove("highlight-green"));
    $$(".cell.highlight-amber").forEach((c) => c.classList.remove("highlight-amber"));
}

function setStatus(text) {
    statusMsg.textContent = text;
}

function updateStepStat() {
    statStep.textContent = `${currentStepIdx + 1} / ${allSteps.length}`;
}

function addLog(num, action, desc) {
    const entry = document.createElement("div");
    entry.className = "log-entry";

    let actionClass = "a-other";
    if (action === "move") actionClass = "a-move";
    else if (action === "compare") actionClass = "a-compare";
    else if (action === "swap") actionClass = "a-swap";
    else if (action === "freeze" || action === "unfreeze_all") actionClass = "a-freeze";
    else if (action === "label") actionClass = "a-label";
    else if (action === "highlight") actionClass = "a-highlight";

    entry.innerHTML = `
        <span class="log-num">#${num}</span>
        <span class="log-action ${actionClass}">${action}</span>
        <span>${desc}</span>
    `;
    logEntries.appendChild(entry);
    logEntries.scrollTop = logEntries.scrollHeight;
}

// ==================================================================
// CHECKPOINT STATE (lightweight for Step Backward)
// ==================================================================

function captureLightState() {
    const ram = {};
    for (let i = 0; i < B; i++) {
        const page = document.getElementById(`ram-page-${i}`);
        const items = page ? Array.from(page.querySelectorAll(".cell[id^='item_']")).map((c) => c.id) : [];
        ram[i] = items;
    }

    const runs = {};
    Array.from(tempArea.querySelectorAll(".run-container")).forEach((run) => {
        const idx = parseInt((run.id.split("run-")[1] || "0"), 10);
        runs[idx] = Array.from(run.querySelectorAll(".run-cells .cell[id^='item_']")).map((c) => c.id);
    });

    const mergeRows = {};
    Array.from(tempArea.querySelectorAll(".merge-output-row")).forEach((row) => {
        const idx = parseInt((row.id.split("merge-output-row-")[1] || "0"), 10);
        mergeRows[idx] = Array.from(row.querySelectorAll(".merge-output-cells .cell[id^='item_']")).map((c) => c.id);
    });

    const cellClasses = {};
    allElements.forEach((elem) => {
        const node = cellMap[elem.id];
        if (!node) {
            cellClasses[elem.id] = [];
            return;
        }
        cellClasses[elem.id] = EFFECT_CLASSES.filter((cls) => node.classList.contains(cls));
    });

    return {
        disk: Array.from(diskArea.querySelectorAll(".cell[id^='item_']")).map((c) => c.id),
        output: Array.from(outputArea.querySelectorAll(".cell[id^='item_']")).map((c) => c.id),
        ram,
        runs,
        mergeRows,
        outputBuffers: Array.from(ramArea.querySelectorAll(".ram-page.output-buffer")).map((p) => parseInt((p.id.split("ram-page-")[1] || "0"), 10)),
        cellClasses,
        passText: statPass.textContent,
        readsText: statReads.textContent,
        writesText: statWrites.textContent,
        statusText: statusMsg.textContent,
    };
}

function restoreLightState(state) {
    diskArea.innerHTML = "";
    ramArea.innerHTML = "";
    tempArea.innerHTML = "";
    outputArea.innerHTML = "";

    buildRamPages();

    cellMap = {};
    allElements.forEach((elem) => {
        createCell(elem.id, elem.value);
    });

    const placeCells = (ids, container) => {
        ids.forEach((id) => {
            const cell = cellMap[id];
            if (!cell || !container) return;
            const ph = container.querySelector ? container.querySelector(".cell.hidden") : null;
            if (ph) ph.remove();
            container.appendChild(cell);
        });
    };

    placeCells(state.disk || [], diskArea);
    placeCells(state.output || [], outputArea);

    Object.keys(state.ram || {}).forEach((key) => {
        const page = document.getElementById(`ram-page-${key}`);
        placeCells(state.ram[key] || [], page);
    });

    Object.keys(state.runs || {}).sort((a, b) => Number(a) - Number(b)).forEach((key) => {
        const run = ensureRunContainer(Number(key), true);
        const cellsDiv = run.querySelector(".run-cells");
        placeCells(state.runs[key] || [], cellsDiv);
    });

    Object.keys(state.mergeRows || {}).sort((a, b) => Number(a) - Number(b)).forEach((key) => {
        const row = ensureMergeOutputRow(Number(key));
        const cellsDiv = row.querySelector(".merge-output-cells");
        placeCells(state.mergeRows[key] || [], cellsDiv);
    });

    EFFECT_CLASSES.forEach((cls) => {
        Object.values(cellMap).forEach((cell) => cell.classList.remove(cls));
    });

    Object.keys(state.cellClasses || {}).forEach((id) => {
        const cell = cellMap[id];
        if (!cell) return;
        (state.cellClasses[id] || []).forEach((cls) => cell.classList.add(cls));
    });

    for (let i = 0; i < B; i++) {
        const page = document.getElementById(`ram-page-${i}`);
        if (!page) continue;
        page.classList.remove("output-buffer");
        const lbl = page.querySelector(".ram-page-label");
        if (lbl) lbl.textContent = `P${i}`;
    }

    (state.outputBuffers || []).forEach((idx) => {
        const page = document.getElementById(`ram-page-${idx}`);
        if (!page) return;
        page.classList.add("output-buffer");
        const lbl = page.querySelector(".ram-page-label");
        if (lbl) lbl.textContent = `P${idx} (Out)`;
    });

    statPass.textContent = state.passText || "—";
    statReads.textContent = state.readsText || "0";
    statWrites.textContent = state.writesText || "0";
    statusMsg.textContent = state.statusText || "";

    frozenSet = new Set(
        Object.keys(state.cellClasses || {}).filter((id) => (state.cellClasses[id] || []).includes("frozen"))
    );
}

function addCheckpoint(stepIndex) {
    checkpoints.push({ stepIndex, state: captureLightState() });
}

function restoreToStep(targetStep) {
    const cp = findCheckpoint(targetStep);
    restoreLightState(cp.state);

    for (let i = cp.stepIndex + 1; i <= targetStep; i++) {
        executeStep(allSteps[i], i, { log: false, status: false, focus: false });
    }

    rebuildLogs(targetStep);

    if (targetStep >= 0) {
        const desc = allSteps[targetStep].description || "";
        if (desc) setStatus(`[Bước #${targetStep + 1}] ${desc}`);
    }
}

function findCheckpoint(targetStep) {
    let chosen = checkpoints[0] || { stepIndex: -1, state: captureLightState() };
    for (const cp of checkpoints) {
        if (cp.stepIndex <= targetStep) {
            chosen = cp;
        } else {
            break;
        }
    }
    return chosen;
}

function rebuildLogs(targetStep) {
    logEntries.innerHTML = "";
    for (let i = 0; i <= targetStep; i++) {
        const step = allSteps[i];
        addLog(i + 1, step.action, step.description || "");
    }
}

// ==================================================================
// RESET (Internal only, UI button removed)
// ==================================================================
function resetAll() {
    pauseAnim();
    allSteps = [];
    allElements = [];
    currentStepIdx = -1;
    checkpoints = [];
    frozenSet.clear();
    cellMap = {};

    diskArea.innerHTML = "";
    ramArea.innerHTML = "";
    tempArea.innerHTML = "";
    outputArea.innerHTML = "";
    logEntries.innerHTML = "";
    dataDisplay.innerHTML = "";
    procInfo.style.display = "none";

    statPass.textContent = "—";
    statReads.textContent = "0";
    statWrites.textContent = "0";
    updateStepStat();
    enablePlayButtons(false);
    btnPlay.textContent = "▶ Play";
}

function ensureRunContainer(runIndex, merged) {
    let runDiv = document.getElementById(`run-${runIndex}`);
    if (!runDiv) {
        runDiv = document.createElement("div");
        runDiv.className = "run-container";
        runDiv.id = `run-${runIndex}`;
        const lbl = document.createElement("div");
        lbl.className = "run-label";
        lbl.textContent = merged ? `Run #${runIndex} (merged)` : `Run #${runIndex}`;
        runDiv.appendChild(lbl);
        const cells = document.createElement("div");
        cells.className = "run-cells";
        runDiv.appendChild(cells);
        tempArea.appendChild(runDiv);
        return runDiv;
    }
    const lbl = runDiv.querySelector(".run-label");
    if (lbl) {
        lbl.textContent = merged ? `Run #${runIndex} (merged)` : `Run #${runIndex}`;
    }
    return runDiv;
}

function ensureMergeOutputRow(outRun) {
    let moRow = document.getElementById(`merge-output-row-${outRun}`);
    if (!moRow) {
        moRow = document.createElement("div");
        moRow.className = "merge-output-row";
        moRow.id = `merge-output-row-${outRun}`;
        const lbl = document.createElement("div");
        lbl.className = "merge-output-label";
        lbl.textContent = `Merge Output #${outRun}`;
        moRow.appendChild(lbl);
        const cells = document.createElement("div");
        cells.className = "merge-output-cells";
        moRow.appendChild(cells);
        tempArea.appendChild(moRow);
    }
    return moRow;
}


(() => {
  const SHIFT_MS = 9 * 60 * 60 * 1000;
  const BREAK_ALLOWANCE_MS = 60 * 60 * 1000;
  const WARN_5_MS = 5 * 60 * 1000;
  const WARN_1_MS = 1 * 60 * 1000;
  const STORAGE_KEY = "shift-desk-v3";

  const MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const SHIP_SVG = `<svg viewBox="0 0 64 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 22 L56 22 L48 32 H16 Z" fill="#6b4a32"/>
    <path d="M22 22 V10 H26 V22 Z" fill="#c9b08a"/>
    <path d="M26 11 L40 16 L26 18 Z" fill="#d9c4a0"/>
    <circle cx="18" cy="26" r="1.4" fill="#1b3344" opacity=".5"/>
    <circle cx="30" cy="27" r="1.2" fill="#1b3344" opacity=".45"/>
    <circle cx="42" cy="26" r="1.3" fill="#1b3344" opacity=".5"/>
  </svg>`;

  const els = {
    shiftPage: document.getElementById("shiftPage"),
    profilePage: document.getElementById("profilePage"),
    tabShift: document.getElementById("tabShift"),
    tabProfile: document.getElementById("tabProfile"),
    idleView: document.getElementById("idleView"),
    activeView: document.getElementById("activeView"),
    doneView: document.getElementById("doneView"),
    clockInBtn: document.getElementById("clockInBtn"),
    clockOutBtn: document.getElementById("clockOutBtn"),
    newDayBtn: document.getElementById("newDayBtn"),
    openBreakBtn: document.getElementById("openBreakBtn"),
    onBreakBox: document.getElementById("onBreakBox"),
    endBreakBtn: document.getElementById("endBreakBtn"),
    breakSheet: document.getElementById("breakSheet"),
    cancelBreakBtn: document.getElementById("cancelBreakBtn"),
    dismissAlertBtn: document.getElementById("dismissAlertBtn"),
    alertOverlay: document.getElementById("alertOverlay"),
    alertKicker: document.getElementById("alertKicker"),
    alertTitle: document.getElementById("alertTitle"),
    alertBody: document.getElementById("alertBody"),
    statusPill: document.getElementById("statusPill"),
    timeLeft: document.getElementById("timeLeft"),
    leaveAt: document.getElementById("leaveAt"),
    dayProgress: document.getElementById("dayProgress"),
    summaryLine: document.getElementById("summaryLine"),
    breakLive: document.getElementById("breakLive"),
    doneSummary: document.getElementById("doneSummary"),
    doneDetail: document.getElementById("doneDetail"),
    greetLine: document.getElementById("greetLine"),
    nameInput: document.getElementById("nameInput"),
    calTitle: document.getElementById("calTitle"),
    calGrid: document.getElementById("calGrid"),
    prevMonthBtn: document.getElementById("prevMonthBtn"),
    nextMonthBtn: document.getElementById("nextMonthBtn"),
  };

  const nowInit = new Date();

  /** @type {{
   *  status: 'idle' | 'active' | 'done',
   *  clockInAt: number | null,
   *  clockOutAt: number | null,
   *  breaks: Array<{
   *    start: number,
   *    end: number | null,
   *    plannedMs: number,
   *    alertAt5: boolean,
   *    alertAt1: boolean
   *  }>,
   *  name: string,
   *  attendance: Record<string, true>,
   *  trackingSince: string | null,
   * }} */
  let state = loadState() || {
    status: "idle",
    clockInAt: null,
    clockOutAt: null,
    breaks: [],
    name: "",
    attendance: {},
    trackingSince: null,
  };

  // migrate older saves
  if (!state.attendance) state.attendance = {};
  if (state.name == null) state.name = "";
  if (state.trackingSince === undefined) state.trackingSince = null;

  let tickTimer = null;
  let vibrateTimer = null;
  let viewYear = nowInit.getFullYear();
  let viewMonth = nowInit.getMonth();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      // soft-migrate from v2
      const old = localStorage.getItem("shift-desk-v2");
      return old ? { ...JSON.parse(old), name: "", attendance: {}, trackingSince: null } : null;
    } catch {
      return null;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatHMS(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatMS(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${pad(m)}:${pad(s)}`;
  }

  function formatClock(ts) {
    return new Date(ts).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function activeBreak() {
    return state.breaks.find((b) => b.end == null) || null;
  }

  function breakUsedMs(now = Date.now()) {
    return state.breaks.reduce((sum, b) => {
      const end = b.end ?? now;
      return sum + Math.max(0, end - b.start);
    }, 0);
  }

  function breakRemainingMs(b, now = Date.now()) {
    return b.plannedMs - (now - b.start);
  }

  function markPresent(ts = Date.now()) {
    const key = dateKey(new Date(ts));
    state.attendance[key] = true;
    if (!state.trackingSince) state.trackingSince = key;
  }

  function startVibrateLoop() {
    stopVibrateLoop();
    if (!navigator.vibrate) return;

    const pulse = () => {
      navigator.vibrate([280, 120, 280, 120, 280, 120, 500]);
    };

    pulse();
    // Keep pulsing until the user turns it off
    vibrateTimer = setInterval(pulse, 1900);
  }

  function stopVibrateLoop() {
    if (vibrateTimer) {
      clearInterval(vibrateTimer);
      vibrateTimer = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);
  }

  function fireBreakAlert(breakItem, kind) {
    if (!breakItem) return;
    if (kind === 5 && breakItem.alertAt5) return;
    if (kind === 1 && breakItem.alertAt1) return;

    if (kind === 5) breakItem.alertAt5 = true;
    if (kind === 1) breakItem.alertAt1 = true;
    saveState();

    if (kind === 5) {
      els.alertKicker.textContent = "5 minutes left";
      els.alertTitle.textContent = "Wrap up soon";
      els.alertBody.textContent =
        "Break ends in 5 minutes — finish up and get ready.";
    } else {
      els.alertKicker.textContent = "1 minute left";
      els.alertTitle.textContent = "Times up, my boy";
      els.alertBody.textContent = "Go now — last 1 minute of this break.";
    }

    els.alertOverlay.classList.remove("hidden");
    startVibrateLoop();
  }

  function checkBreakAlerts(breakItem, left) {
    if (left <= WARN_5_MS) fireBreakAlert(breakItem, 5);
    if (left <= WARN_1_MS) fireBreakAlert(breakItem, 1);
  }

  function showTab(tab) {
    const isShift = tab === "shift";
    els.shiftPage.classList.toggle("hidden", !isShift);
    els.profilePage.classList.toggle("hidden", isShift);
    els.tabShift.classList.toggle("active", isShift);
    els.tabProfile.classList.toggle("active", !isShift);
    if (!isShift) renderCalendar();
  }

  function setShiftView() {
    const isIdle = state.status === "idle";
    const isActive = state.status === "active";
    const isDone = state.status === "done";
    els.idleView.classList.toggle("hidden", !isIdle);
    els.activeView.classList.toggle("hidden", !isActive);
    els.doneView.classList.toggle("hidden", !isDone);
  }

  function updateGreeting() {
    els.greetLine.textContent = state.name
      ? `Hey ${state.name} · 9-hour day`
      : "Your 9-hour day";
  }

  function renderCalendar() {
    els.calTitle.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    els.calGrid.innerHTML = "";

    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const startWeekday = first.getDay();
    const today = new Date();
    const todayKey = dateKey(today);
    const trackingSince = state.trackingSince;

    for (let i = 0; i < startWeekday; i++) {
      const empty = document.createElement("div");
      empty.className = "day-cell empty";
      els.calGrid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(viewYear, viewMonth, day);
      const key = dateKey(cellDate);
      const cell = document.createElement("div");
      cell.className = "day-cell";

      const cellStart = new Date(viewYear, viewMonth, day).setHours(0, 0, 0, 0);
      const todayStart = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      ).getTime();
      const isToday = key === todayKey;
      const isFuture = cellStart > todayStart;
      const present = !!state.attendance[key];
      const tracked = trackingSince && key >= trackingSince && !isFuture;

      if (isToday) cell.classList.add("today");

      if (present) {
        cell.classList.add("present");
        cell.innerHTML = `<span class="sun" aria-hidden="true"></span><span class="day-num">${day}</span>`;
        cell.title = "Came in";
      } else if (tracked) {
        cell.classList.add("missed");
        cell.innerHTML = `<span class="water" aria-hidden="true"></span><span class="ship" aria-hidden="true">${SHIP_SVG}</span><span class="day-num">${day}</span>`;
        cell.title = "Missed";
      } else {
        if (isFuture) cell.classList.add("future");
        cell.innerHTML = `<span class="day-num">${day}</span>`;
      }

      els.calGrid.appendChild(cell);
    }
  }

  function render() {
    setShiftView();
    updateGreeting();
    const now = Date.now();

    if (state.status === "active" && state.clockInAt) {
      const leaveAt = state.clockInAt + SHIFT_MS;
      const remaining = leaveAt - now;
      const elapsed = now - state.clockInAt;
      const usedBreak = breakUsedMs(now);
      const breakLeft = BREAK_ALLOWANCE_MS - usedBreak;
      const worked = Math.max(0, elapsed - usedBreak);
      const onBreak = activeBreak();
      const over = remaining <= 0;

      els.leaveAt.textContent = `Leave by ${formatClock(leaveAt)}`;
      els.timeLeft.textContent = over ? "00:00:00" : formatHMS(remaining);
      els.timeLeft.classList.toggle("critical", over);
      els.dayProgress.style.width = `${Math.min(100, (elapsed / SHIFT_MS) * 100)}%`;

      const breakLeftLabel =
        breakLeft >= 0
          ? `${Math.ceil(breakLeft / 60000)}m left`
          : `${Math.ceil(-breakLeft / 60000)}m over`;
      els.summaryLine.textContent = `Worked ${formatHMS(worked)} · Break ${breakLeftLabel}`;

      els.openBreakBtn.classList.toggle("hidden", !!onBreak || over);
      els.onBreakBox.classList.toggle("hidden", !onBreak);

      els.statusPill.classList.remove("on-break", "ending");
      if (onBreak) {
        const left = breakRemainingMs(onBreak, now);
        if (left <= WARN_1_MS) {
          els.statusPill.textContent = left <= 0 ? "Break over" : "1 min left";
          els.statusPill.classList.add("ending");
        } else if (left <= WARN_5_MS) {
          els.statusPill.textContent = "5 min left";
          els.statusPill.classList.add("ending");
        } else {
          els.statusPill.textContent = "On break";
          els.statusPill.classList.add("on-break");
        }
        if (left > 0) {
          els.breakLive.textContent = `${formatMS(left)} left`;
          els.breakLive.classList.remove("over");
        } else {
          els.breakLive.textContent = `Over by ${formatMS(-left)}`;
          els.breakLive.classList.add("over");
        }
        checkBreakAlerts(onBreak, left);
      } else if (over) {
        els.statusPill.textContent = "Shift done";
        els.statusPill.classList.add("ending");
      } else {
        els.statusPill.textContent = "On shift";
      }
    }

    if (state.status === "done" && state.clockInAt && state.clockOutAt) {
      const total = state.clockOutAt - state.clockInAt;
      const usedBreak = breakUsedMs(state.clockOutAt);
      els.doneSummary.textContent = formatHMS(total);
      els.doneDetail.textContent = `Break ${formatHMS(usedBreak)} · Worked ${formatHMS(total - usedBreak)}`;
    }

    if (!els.profilePage.classList.contains("hidden")) renderCalendar();
  }

  function startTicker() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(render, 250);
  }

  function clockIn() {
    markPresent();
    state = {
      ...state,
      status: "active",
      clockInAt: Date.now(),
      clockOutAt: null,
      breaks: [],
    };
    if (!state.trackingSince) state.trackingSince = dateKey(new Date());
    saveState();
    render();
    startTicker();
  }

  function clockOut() {
    if (activeBreak()) activeBreak().end = Date.now();
    state.status = "done";
    state.clockOutAt = Date.now();
    saveState();
    render();
  }

  function openBreakSheet() {
    if (state.status !== "active" || activeBreak()) return;
    els.breakSheet.classList.remove("hidden");
  }

  function closeBreakSheet() {
    els.breakSheet.classList.add("hidden");
  }

  function startBreak(mins) {
    const minutes = Number(mins);
    if (
      state.status !== "active" ||
      activeBreak() ||
      !Number.isFinite(minutes) ||
      minutes < 1
    ) {
      return;
    }
    state.breaks.push({
      start: Date.now(),
      end: null,
      plannedMs: Math.round(minutes) * 60 * 1000,
      alertAt5: false,
      alertAt1: false,
    });
    saveState();
    closeBreakSheet();
    render();
  }

  function endBreak() {
    const current = activeBreak();
    if (!current) return;
    current.end = Date.now();
    saveState();
    dismissAlert();
    render();
  }

  function resetDay() {
    state.status = "idle";
    state.clockInAt = null;
    state.clockOutAt = null;
    state.breaks = [];
    saveState();
    render();
  }

  function dismissAlert() {
    els.alertOverlay.classList.add("hidden");
    stopVibrateLoop();
  }

  els.clockInBtn.addEventListener("click", clockIn);
  els.clockOutBtn.addEventListener("click", clockOut);
  els.newDayBtn.addEventListener("click", resetDay);
  els.openBreakBtn.addEventListener("click", openBreakSheet);
  els.cancelBreakBtn.addEventListener("click", closeBreakSheet);
  els.endBreakBtn.addEventListener("click", endBreak);
  els.dismissAlertBtn.addEventListener("click", dismissAlert);
  els.tabShift.addEventListener("click", () => showTab("shift"));
  els.tabProfile.addEventListener("click", () => showTab("profile"));

  els.breakSheet.addEventListener("click", (e) => {
    if (e.target === els.breakSheet) closeBreakSheet();
    const opt = e.target.closest("[data-mins]");
    if (opt) startBreak(opt.dataset.mins);
  });

  els.nameInput.value = state.name || "";
  els.nameInput.addEventListener("input", () => {
    state.name = els.nameInput.value.trim();
    saveState();
    updateGreeting();
  });

  els.prevMonthBtn.addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear -= 1;
    }
    renderCalendar();
  });

  els.nextMonthBtn.addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear += 1;
    }
    renderCalendar();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });

  if (state.status === "active") startTicker();
  render();
})();

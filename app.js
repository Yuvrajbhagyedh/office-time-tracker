(() => {
  const SHIFT_MS = 9 * 60 * 60 * 1000;
  const BREAK_ALLOWANCE_MS = 60 * 60 * 1000;
  const WARN_MS = 5 * 60 * 1000;
  const STORAGE_KEY = "shift-desk-v2";

  const els = {
    idleView: document.getElementById("idleView"),
    activeView: document.getElementById("activeView"),
    doneView: document.getElementById("doneView"),
    clockInBtn: document.getElementById("clockInBtn"),
    clockOutBtn: document.getElementById("clockOutBtn"),
    newDayBtn: document.getElementById("newDayBtn"),
    breakPicker: document.getElementById("breakPicker"),
    durationRow: document.getElementById("durationRow"),
    customMins: document.getElementById("customMins"),
    customBreakBtn: document.getElementById("customBreakBtn"),
    breakRunningActions: document.getElementById("breakRunningActions"),
    endBreakBtn: document.getElementById("endBreakBtn"),
    testAlertBtn: document.getElementById("testAlertBtn"),
    dismissAlertBtn: document.getElementById("dismissAlertBtn"),
    alertOverlay: document.getElementById("alertOverlay"),
    alertBody: document.getElementById("alertBody"),
    statusPill: document.getElementById("statusPill"),
    clockedInAt: document.getElementById("clockedInAt"),
    timeLeft: document.getElementById("timeLeft"),
    leaveAt: document.getElementById("leaveAt"),
    dayProgress: document.getElementById("dayProgress"),
    workedTime: document.getElementById("workedTime"),
    breakUsed: document.getElementById("breakUsed"),
    breakLeft: document.getElementById("breakLeft"),
    breakLive: document.getElementById("breakLive"),
    breakList: document.getElementById("breakList"),
    emptyBreaks: document.getElementById("emptyBreaks"),
    doneSummary: document.getElementById("doneSummary"),
    doneDetail: document.getElementById("doneDetail"),
  };

  /** @type {{
   *  status: 'idle' | 'active' | 'done',
   *  clockInAt: number | null,
   *  clockOutAt: number | null,
   *  breaks: Array<{
   *    start: number,
   *    end: number | null,
   *    plannedMs: number,
   *    alertFired: boolean
   *  }>,
   * }} */
  let state = loadState() || {
    status: "idle",
    clockInAt: null,
    clockOutAt: null,
    breaks: [],
  };

  let tickTimer = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
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

  function vibrateAlert() {
    if (!navigator.vibrate) return;
    navigator.vibrate([300, 150, 300, 150, 300, 150, 450]);
  }

  function fireBreakAlert({ force = false, breakItem = null } = {}) {
    if (!force) {
      if (!breakItem || breakItem.alertFired) return;
      breakItem.alertFired = true;
      saveState();
    }

    els.alertBody.textContent =
      "Go now — wrap this break and get back.";
    els.alertOverlay.classList.remove("hidden");
    vibrateAlert();
  }

  function setView() {
    const isIdle = state.status === "idle";
    const isActive = state.status === "active";
    const isDone = state.status === "done";

    els.idleView.classList.toggle("hidden", !isIdle);
    els.activeView.classList.toggle("hidden", !isActive);
    els.doneView.classList.toggle("hidden", !isDone);
  }

  function renderBreaks(now) {
    const completed = state.breaks.filter((b) => b.end != null);
    els.breakList.innerHTML = "";

    completed.forEach((b, i) => {
      const li = document.createElement("li");
      const actual = formatMS(b.end - b.start);
      const planned = Math.round(b.plannedMs / 60000);
      li.innerHTML = `<span>Break ${i + 1}</span><span class="when">${formatClock(b.start)} → ${formatClock(b.end)} · ${actual} <span class="muted">(planned ${planned}m)</span></span>`;
      els.breakList.appendChild(li);
    });

    const onBreak = activeBreak();
    els.emptyBreaks.classList.toggle("hidden", completed.length > 0 || onBreak);
    els.breakLive.classList.toggle("hidden", !onBreak);
    els.breakPicker.classList.toggle("hidden", !!onBreak);
    els.breakRunningActions.classList.toggle("hidden", !onBreak);

    if (onBreak) {
      const left = breakRemainingMs(onBreak, now);
      if (left > 0) {
        els.breakLive.textContent = `Break · ${formatMS(left)} left of ${Math.round(onBreak.plannedMs / 60000)}m`;
        els.breakLive.classList.remove("over");
      } else {
        els.breakLive.textContent = `Break over by ${formatMS(-left)}`;
        els.breakLive.classList.add("over");
      }
    }
  }

  function maybeAlertBreak(now) {
    const onBreak = activeBreak();
    if (!onBreak) return;

    const left = breakRemainingMs(onBreak, now);
    // Last 5 minutes of this break (or at time-up if break is shorter than 5m)
    const shouldWarn = left <= WARN_MS;
    if (shouldWarn) fireBreakAlert({ breakItem: onBreak });
  }

  function render() {
    setView();
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

      els.clockedInAt.textContent = `In since ${formatClock(state.clockInAt)}`;
      els.leaveAt.textContent = `Leave by ${formatClock(leaveAt)}`;
      els.timeLeft.textContent = over ? "00:00:00" : formatHMS(remaining);
      els.workedTime.textContent = formatHMS(worked);
      els.breakUsed.textContent = formatHMS(usedBreak);

      if (breakLeft >= 0) {
        els.breakLeft.textContent = `${formatMS(breakLeft)} left`;
        els.breakLeft.classList.remove("over");
      } else {
        els.breakLeft.textContent = `${formatMS(-breakLeft)} over`;
        els.breakLeft.classList.add("over");
      }

      const pct = Math.min(100, (elapsed / SHIFT_MS) * 100);
      els.dayProgress.style.width = `${pct}%`;

      els.timeLeft.classList.remove("warning");
      els.timeLeft.classList.toggle("critical", over);

      els.statusPill.classList.remove("on-break", "ending");
      if (onBreak) {
        const left = breakRemainingMs(onBreak, now);
        if (left <= WARN_MS) {
          els.statusPill.textContent =
            left <= 0 ? "Break over" : "Break ending";
          els.statusPill.classList.add("ending");
        } else {
          els.statusPill.textContent = "On break";
          els.statusPill.classList.add("on-break");
        }
      } else if (over) {
        els.statusPill.textContent = "Shift done";
        els.statusPill.classList.add("ending");
      } else {
        els.statusPill.textContent = "On shift";
      }

      const chipsDisabled = over;
      els.durationRow.querySelectorAll(".chip").forEach((chip) => {
        chip.disabled = chipsDisabled;
      });
      els.customBreakBtn.disabled = chipsDisabled;
      els.customMins.disabled = chipsDisabled;

      renderBreaks(now);
      maybeAlertBreak(now);
    }

    if (state.status === "done" && state.clockInAt && state.clockOutAt) {
      const total = state.clockOutAt - state.clockInAt;
      const usedBreak = breakUsedMs(state.clockOutAt);
      els.doneSummary.textContent = formatHMS(total);
      els.doneDetail.textContent = `On site ${formatHMS(total)} · Break ${formatHMS(usedBreak)} · Worked ${formatHMS(total - usedBreak)}`;
    }
  }

  function startTicker() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(render, 250);
  }

  function clockIn() {
    state = {
      status: "active",
      clockInAt: Date.now(),
      clockOutAt: null,
      breaks: [],
    };
    saveState();
    render();
    startTicker();
  }

  function clockOut() {
    if (activeBreak()) {
      activeBreak().end = Date.now();
    }
    state.status = "done";
    state.clockOutAt = Date.now();
    saveState();
    render();
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
      alertFired: false,
    });
    saveState();
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
    state = {
      status: "idle",
      clockInAt: null,
      clockOutAt: null,
      breaks: [],
    };
    saveState();
    render();
  }

  function dismissAlert() {
    els.alertOverlay.classList.add("hidden");
    if (navigator.vibrate) navigator.vibrate(0);
  }

  els.clockInBtn.addEventListener("click", clockIn);
  els.clockOutBtn.addEventListener("click", clockOut);
  els.newDayBtn.addEventListener("click", resetDay);
  els.endBreakBtn.addEventListener("click", endBreak);
  els.testAlertBtn.addEventListener("click", () => {
    fireBreakAlert({ force: true });
  });
  els.dismissAlertBtn.addEventListener("click", dismissAlert);

  els.durationRow.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mins]");
    if (!btn) return;
    startBreak(btn.dataset.mins);
  });

  els.customBreakBtn.addEventListener("click", () => {
    startBreak(els.customMins.value);
  });

  els.customMins.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startBreak(els.customMins.value);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });

  if (state.status === "active") startTicker();
  render();
})();

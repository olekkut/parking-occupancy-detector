// SENTINEL HMI — Taktyczny Panel Automatyzacji Parkingu
// Terminologia: IEC 61131-3, ISA-101, ISA-18.2 (alarmy), PN-EN 12453 (szlabany)

let socket = null;
let reconnectInterval = 3000;
let wsConnected = false;
let previousAvailableSpots = null;
let previousAutoMode = null;

let previousSpaces = null;
let animatingSpaces = {};
let occupiedCarColors = {};
let wjazdGateOverrideActive = false;
let wyjazdGateOverrideActive = false;
let lastPlcState = null;

// Animation queues to prevent vehicle overlapping
let entryQueue = [];
let exitQueue = [];
let isEntryAnimating = false;
let isExitAnimating = false;

// CCTV Calendar & Today's Prediction variables
let allPklotSnapshots = [];
let pklotDatesWithData = new Set();
let selectedCCTVDate = "";
let cctvCalYear = 2012;
let cctvCalMonth = 11; // December by default
let selectedDayActualOccupancy = []; // holds [{hour, occupancy}]

function isAnimationBusy() {
    return isEntryAnimating || isExitAnimating || entryQueue.length > 0 || exitQueue.length > 0;
}

function updateTimelineControlsState() {
    const busy = isAnimationBusy();
    const timeline = document.getElementById('pklot-timeline');
    const btnPrev = document.getElementById('btn-play-prev');
    const btnNext = document.getElementById('btn-play-next');
    const selectEl = document.getElementById('pklot-snapshot-select');
    
    if (busy) {
        if (timeline) timeline.setAttribute('disabled', 'true');
        if (btnPrev) btnPrev.setAttribute('disabled', 'true');
        if (btnNext) btnNext.setAttribute('disabled', 'true');
        if (selectEl) selectEl.setAttribute('disabled', 'true');
    } else {
        if (timeline && pklotSnapshots.length > 0) timeline.removeAttribute('disabled');
        if (btnPrev && pklotSnapshots.length > 0) btnPrev.removeAttribute('disabled');
        if (btnNext && pklotSnapshots.length > 0) btnNext.removeAttribute('disabled');
        if (selectEl && pklotSnapshots.length > 0) selectEl.removeAttribute('disabled');
    }
}

let currentDriversState = null;
let systemLogs = [];
let logFilterLevel = 'ALL';

// Rolling history for graphs
const MAX_HISTORY_POINTS = 50;
const tempHistory = [];
const upsHistory = [];
const occupancyHistory = [];
const timeHistory = [];


/**
 * Formats a number with a leading zero if it is a single digit.
 * 
 * @param {number} value - The numeric value to format.
 * @returns {string} The formatted string (padded to 2 characters).
 */
function formatWithLeadingZero(value) {
    return value.toString().padStart(2, '0');
}


const TOPOLOGY_NODES = {
    hmi: { label: "Serwer HMI SCADA", x: 400, y: 50, icon: "🖥️" },
    
    plc: { label: "PLC Modbus", x: 180, y: 130, icon: "📊", parent: "hmi", driver: "plc" },
    yolo: { label: "Silnik YOLO Vision", x: 400, y: 130, icon: "📹", parent: "hmi", driver: "yolo" },
    db: { label: "Baza PostGIS SQL", x: 620, y: 130, icon: "🗄️", parent: "hmi", driver: "db" },
    
    temp: { label: "Czujnik Temp.", x: 80, y: 210, icon: "🌡️", parent: "plc", driver: "temp", driverCard: "temp" },
    ups: { label: "Zasilacz UPS", x: 220, y: 210, icon: "🔋", parent: "plc", driver: "ups", driverCard: "ups" },
    gdpr: { label: "GDPR Blur", x: 360, y: 210, icon: "🔒", parent: "yolo", driver: "gdpr", driverCard: "gdpr" },
    homography: { label: "Homografia 3D", x: 500, y: 210, icon: "📐", parent: "yolo", driver: "homography", driverCard: "homography" },
    db_geom: { label: "Przestrzeń PostGIS", x: 720, y: 210, icon: "🗺️", parent: "db", driverCard: "db" },
    
    cab_fan: { label: "Wentylator %Q0.2", x: 80, y: 290, icon: "💨", parent: "temp", driverCard: "temp" },
    wjazd_motor: { label: "Brama Wjazd %Q0.0", x: 220, y: 290, icon: "⚙️", parent: "plc", driverCard: "plc" },
    wyjazd_motor: { label: "Brama Wyjazd %Q0.1", x: 340, y: 290, icon: "⚙️", parent: "plc", driverCard: "plc" },
    loops: { label: "Pętle %I0.0 / %I0.1", x: 580, y: 290, icon: "🔄", parent: "plc", driverCard: "plc" },
    
    fan_health: { label: "Wentylator %MW52", x: 60, y: 370, icon: "💔", parent: "cab_fan", driverCard: "temp" },
    fan_time: { label: "Czas Pracy %MW54", x: 140, y: 370, icon: "⏱️", parent: "cab_fan", driverCard: "temp" },
    grease: { label: "Smar Szlabanu %MW50", x: 280, y: 370, icon: "💧", parent: "wjazd_motor", driverCard: "plc" },
    iou_calc: { label: "Algorytm IoU", x: 580, y: 370, icon: "🎯", parent: "loops", driverCard: "yolo" }
};

const CAR_COLORS = ['#e74c3c', '#f1c40f', '#3498db', '#e67e22', '#2ecc71', '#9b59b6', '#bdc3c7', '#34495e'];
function getRandomColor() {
    return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
}

function getRandomCarSVG(color) {
    return `<svg class="car-svg" viewBox="0 0 50 100" style="fill: ${color};">
        <!-- Wheels -->
        <rect x="2" y="16" width="5" height="12" rx="2" fill="#111" />
        <rect x="43" y="16" width="5" height="12" rx="2" fill="#111" />
        <rect x="2" y="72" width="5" height="12" rx="2" fill="#111" />
        <rect x="43" y="72" width="5" height="12" rx="2" fill="#111" />
        <!-- Main body -->
        <rect x="6" y="8" width="38" height="84" rx="10" />
        <!-- Windshield -->
        <path d="M9 36 L41 36 L36 24 L14 24 Z" fill="#1b1b1b" opacity="0.9" />
        <!-- Rear window -->
        <path d="M10 68 L40 68 L36 78 L14 78 Z" fill="#1b1b1b" opacity="0.9" />
        <!-- Roof -->
        <rect x="10" y="36" width="30" height="32" rx="3" fill="#1f1f1f" />
        <!-- Headlights -->
        <rect x="10" y="4" width="7" height="5" rx="1.5" fill="#fff" opacity="0.95" />
        <rect x="33" y="4" width="7" height="5" rx="1.5" fill="#fff" opacity="0.95" />
        <!-- Tail lights -->
        <rect x="10" y="90" width="9" height="4" rx="1.5" fill="#e74c3c" />
        <rect x="31" y="90" width="9" height="4" rx="1.5" fill="#e74c3c" />
    </svg>`;
}

// ========================= RTC CLOCK =========================
setInterval(() => {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${formatWithLeadingZero(now.getMonth() + 1)}-${formatWithLeadingZero(now.getDate())} ${formatWithLeadingZero(now.getHours())}:${formatWithLeadingZero(now.getMinutes())}:${formatWithLeadingZero(now.getSeconds())}`;
    const rtcEl = document.getElementById('datetime-display');
    if (rtcEl) {
        rtcEl.innerText = dateStr;
    }
}, 1000);

// ========================= ALARM JOURNAL (IEC 62682 / ISA-18.2) =========================
const MAX_ALARMS = 50;
const alarmLog = [];

/**
 * Logs a system event or alarm to the tactical alarm journal.
 * 
 * @param {string} severity - Event severity level ('INFO', 'WARNING', 'ALARM').
 * @param {string} source - Origin of the log (e.g. '%MW22', 'WebSocket', '%M0.0').
 * @param {string} message - Descriptive text log.
 */
function logAlarm(severity, source, message) {
    const now = new Date();
    const timeStr = `${formatWithLeadingZero(now.getHours())}:${formatWithLeadingZero(now.getMinutes())}:${formatWithLeadingZero(now.getSeconds())}`;
    
    const entry = { time: timeStr, severity, source, message };
    alarmLog.unshift(entry); // newest first
    if (alarmLog.length > MAX_ALARMS) {
        alarmLog.pop();
    }
    
    renderAlarmJournal();
}

/**
 * Renders the circular alarm journal array to the HTML table.
 */
function renderAlarmJournal() {
    const tbody = document.getElementById('alarm-tbody');
    const countEl = document.getElementById('alarm-count');
    if (!tbody) return;
    
    if (alarmLog.length === 0) {
        tbody.innerHTML = '<tr class="alarm-empty-row"><td colspan="4">Brak zarejestrowanych zdarzeń w bieżącej sesji.</td></tr>';
        if (countEl) countEl.innerText = '0 zdarzeń';
        return;
    }
    
    const severityLabels = {
        'INFO': 'ℹ INFO',
        'WARNING': '⚠ WARNING',
        'ALARM': '🔴 ALARM'
    };
    
    tbody.innerHTML = alarmLog.map((entry, index) => {
        const rowClass = `alarm-row-${entry.severity.toLowerCase()}${index === 0 ? ' alarm-row-new' : ''}`;
        return `<tr class="${rowClass}">
            <td>${entry.time}</td>
            <td>${severityLabels[entry.severity] || entry.severity}</td>
            <td>${entry.source}</td>
            <td>${entry.message}</td>
        </tr>`;
    }).join('');
    
    if (countEl) countEl.innerText = `${alarmLog.length} zdarzeń`;
}

// ========================= WEBSOCKET =========================

/**
 * Establishes a WebSocket connection to the FastAPI server.
 * Handles auto-reconnection and displays connection status pills on the synoptic.
 */
function connectWS() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/telemetry`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    socket = new WebSocket(wsUrl);
    
    const pillPlc = document.getElementById('pill-plc');
    const pillPlcVal = pillPlc ? pillPlc.querySelector('.pill-val') : null;

    socket.onopen = () => {
        console.log('WebSocket connected successfully');
        wsConnected = true;
        if (pillPlc) pillPlc.className = 'pill-badge pill-green';
        if (pillPlcVal) pillPlcVal.innerText = 'AKTYWNE';
        logAlarm('INFO', 'WebSocket', 'Połączenie z serwerem PLC nawiązane');
    };

    socket.onmessage = (event) => {
        try {
            const telemetryData = JSON.parse(event.data);
            updateHMI(telemetryData);
        } catch (e) {
            console.error('Error parsing telemetry payload', e);
        }
    };

    socket.onclose = () => {
        console.warn('WebSocket disconnected. Attempting reconnect...');
        const wasConnected = wsConnected;
        wsConnected = false;
        if (pillPlc) pillPlc.className = 'pill-badge pill-red';
        if (pillPlcVal) pillPlcVal.innerText = 'OFFLINE';
        if (wasConnected) {
            logAlarm('ALARM', 'WebSocket', 'Utrata połączenia z serwerem PLC');
        }
        setTimeout(connectWS, reconnectInterval);
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        socket.close();
    };
}

// ========================= HMI UPDATE =========================

/**
 * Core HMI Update function. Invoked on every WebSocket message.
 * Decodes telemetry payload and triggers UI rendering and transitions.
 * 
 * @param {object} telemetryData - Full system telemetry update.
 */
function updateHMI(telemetryData) {
    const { plc, spaces, drivers, logs } = telemetryData;
    if (!plc || !spaces) return;

    lastPlcState = plc;

    // Broadcast updates to diagnostic screens
    if (drivers) {
        currentDriversState = drivers;
        const isEditing = document.activeElement && document.activeElement.id && document.activeElement.id.startsWith('input-');
        if (!isEditing) {
            updateDriverConfigPanel(drivers);
        }
        updateDiagnosticsPills(plc, drivers);
    }
    
    if (logs) {
        systemLogs = logs;
        applyLogFilters();
    }

    const plcConnected = drivers && drivers.plc && drivers.plc.status === 'CONNECTED';

    if (!plcConnected) {
        // OVERRIDE ALL CONTROLS FOR PLC OFFLINE
        document.getElementById('available-counter').innerText = '--';
        
        const topSystemStatus = document.getElementById('top-system-status');
        if (topSystemStatus) {
            topSystemStatus.innerText = 'AWARIA MAISTRALI (%M10)';
            const parentBadge = topSystemStatus.closest('.top-sec-badge');
            if (parentBadge) {
                parentBadge.className = 'top-sec-badge override-active';
                parentBadge.style.backgroundColor = 'rgba(231, 76, 60, 0.15)';
                parentBadge.style.borderColor = 'var(--clr-red)';
                parentBadge.style.color = 'var(--clr-red)';
            }
        }
        
        const modeVal = document.getElementById('plc-mode-val');
        if (modeVal) {
            modeVal.innerText = 'OFFLINE';
            modeVal.className = 'metric-value-text text-red';
        }
        
        updateSensorBadge('sensor-wjazd', false);
        updateSensorBadge('sensor-wyjazd', false);
        const sensorW = document.getElementById('sensor-wjazd');
        if (sensorW) sensorW.innerText = 'PLC OFFLINE';
        const sensorEx = document.getElementById('sensor-wyjazd');
        if (sensorEx) sensorEx.innerText = 'PLC OFFLINE';
        
        updateBarrierBadge('barrier-wjazd-status', false);
        updateBarrierBadge('barrier-wyjazd-status', false);
        const barW = document.getElementById('barrier-wjazd-status');
        if (barW) barW.innerText = 'PLC OFFLINE';
        const barEx = document.getElementById('barrier-wyjazd-status');
        if (barEx) barEx.innerText = 'PLC OFFLINE';
        
        const fanEl = document.getElementById('fan-status');
        if (fanEl) {
            fanEl.innerText = 'PLC OFFLINE';
            fanEl.className = 'badge badge-inactive';
        }
        const bCyclesEl = document.getElementById('barrier-cycles');
        if (bCyclesEl) {
            bCyclesEl.innerText = '--';
            bCyclesEl.className = 'badge badge-inactive';
        }
        const mHealthEl = document.getElementById('motor-health');
        if (mHealthEl) {
            mHealthEl.innerText = '--';
            mHealthEl.className = 'badge badge-inactive';
        }
        const greaseEl = document.getElementById('grease-level');
        if (greaseEl) {
            greaseEl.innerText = '--';
            greaseEl.className = 'badge badge-inactive';
        }
        const fanHealthEl = document.getElementById('fan-health-register');
        if (fanHealthEl) {
            fanHealthEl.innerText = '--';
            fanHealthEl.className = 'badge badge-inactive';
        }
        const fanRuntimeEl = document.getElementById('fan-runtime-register');
        if (fanRuntimeEl) {
            fanRuntimeEl.innerText = '--';
            fanRuntimeEl.className = 'badge badge-inactive';
        }
        const pillFan = document.getElementById('pill-fan');
        const valFan = document.getElementById('val-fan');
        if (pillFan) pillFan.className = 'pill-badge pill-red';
        if (valFan) valFan.innerText = 'OFFLINE';
        
        // Disable manual controls
        document.getElementById('override-wjazd-open').setAttribute('disabled', 'true');
        document.getElementById('override-wjazd-close').setAttribute('disabled', 'true');
        document.getElementById('override-wyjazd-open').setAttribute('disabled', 'true');
        document.getElementById('override-wyjazd-close').setAttribute('disabled', 'true');
        
        // Gate indicators off
        animateGate('barrier-wjazd-arm', 'gate-wjazd-light', false);
        animateGate('barrier-wyjazd-arm', 'gate-wyjazd-light', false);
        const wLight = document.getElementById('gate-wjazd-light');
        if (wLight) wLight.className = 'ind-light';
        const exLight = document.getElementById('gate-wyjazd-light');
        if (exLight) exLight.className = 'ind-light';
        
        // Render slots as offline/disabled
        updateParkingGrid(spaces);
        return;
    }

    // Enable manual controls
    document.getElementById('override-wjazd-open').removeAttribute('disabled');
    document.getElementById('override-wjazd-close').removeAttribute('disabled');
    document.getElementById('override-wyjazd-open').removeAttribute('disabled');
    document.getElementById('override-wyjazd-close').removeAttribute('disabled');

    // 1. Główny licznik miejsc dostępnych (%MW22)
    document.getElementById('available-counter').innerText = plc.available_spots;

    // 2. Top Bar — pasek obłożenia
    const totalSpots = plc.total_spots || 28;
    const occPercent = Math.max(0, Math.min(100, Math.round(((totalSpots - plc.available_spots) / totalSpots) * 100)));
    const topBarFill = document.getElementById('top-occupancy-bar');
    if (topBarFill) {
        topBarFill.style.width = `${occPercent}%`;
        if (plc.available_spots === 0) {
            topBarFill.classList.add('full-pulse');
        } else {
            topBarFill.classList.remove('full-pulse');
        }
    }
    const topBarPercent = document.getElementById('top-occupancy-percent');
    if (topBarPercent) topBarPercent.innerText = `${occPercent}%`;
    
    const topAvailableKpi = document.getElementById('top-available-kpi');
    if (topAvailableKpi) topAvailableKpi.innerText = plc.available_spots;
    
    // 3. Alarmy stanowe — parking pełny / ponownie dostępny
    if (previousAvailableSpots !== null) {
        if (plc.available_spots === 0 && previousAvailableSpots > 0) {
            logAlarm('ALARM', '%MW22', 'PARKING PEŁNY — brak wolnych stanowisk');
        } else if (plc.available_spots > 0 && previousAvailableSpots === 0) {
            logAlarm('INFO', '%MW22', `Parking ponownie dostępny (${plc.available_spots} wolnych)`);
        }
    }
    previousAvailableSpots = plc.available_spots;
    
    // 4. Top Bar — badge trybu systemowego
    const topSystemStatus = document.getElementById('top-system-status');
    if (topSystemStatus) {
        const parentBadge = topSystemStatus.closest('.top-sec-badge');
        // Restore styles in case they were modified during PLC error override
        if (parentBadge) {
            parentBadge.style.backgroundColor = '';
            parentBadge.style.borderColor = '';
            parentBadge.style.color = '';
        }
        if (plc.auto_mode) {
            topSystemStatus.innerText = 'PRACA NORMALNA';
            if (parentBadge) parentBadge.classList.remove('override-active');
        } else {
            topSystemStatus.innerText = 'TRYB WYMUSZENIA';
            if (parentBadge) parentBadge.classList.add('override-active');
        }
    }
    
    // 5. Alarm przy zmianie trybu
    if (previousAutoMode !== null && previousAutoMode !== plc.auto_mode) {
        if (plc.auto_mode) {
            logAlarm('INFO', '%M0.0', 'Przejście w tryb AUTO — logika automatyczna aktywna');
        } else {
            logAlarm('WARNING', '%M0.0', 'Przejście w tryb MANUAL — wymuszenie ręczne wyjść');
        }
    }
    previousAutoMode = plc.auto_mode;

    // 6. Wymuszenie ręczne — pille dolne
    const pillWjazdOvr = document.getElementById('pill-wjazd-ovr');
    const valWjazdOvr = document.getElementById('val-wjazd-ovr');
    if (pillWjazdOvr && valWjazdOvr) {
        if (!plc.auto_mode && plc.wjazd_szlaban) {
            pillWjazdOvr.className = 'pill-badge pill-red';
            valWjazdOvr.innerText = 'ON';
        } else {
            pillWjazdOvr.className = 'pill-badge pill-gray';
            valWjazdOvr.innerText = 'OFF';
        }
    }
    const pillWyjazdOvr = document.getElementById('pill-wyjazd-ovr');
    const valWyjazdOvr = document.getElementById('val-wyjazd-ovr');
    if (pillWyjazdOvr && valWyjazdOvr) {
        if (!plc.auto_mode && plc.wyjazd_szlaban) {
            pillWyjazdOvr.className = 'pill-badge pill-red';
            valWjazdOvr.innerText = 'ON';
        } else {
            pillWyjazdOvr.className = 'pill-badge pill-gray';
            valWjazdOvr.innerText = 'OFF';
        }
    }

    // 7. Tryb pracy sterownika
    const modeVal = document.getElementById('plc-mode-val');
    const manualPanel = document.getElementById('manual-controls-panel');
    const simEnterBtn = document.getElementById('sim-enter-btn');
    const simExitBtn = document.getElementById('sim-exit-btn');

    if (plc.auto_mode) {
        modeVal.innerText = 'AUTO';
        modeVal.className = 'metric-value-text text-blue';
        manualPanel.classList.add('disabled');
        simEnterBtn.removeAttribute('disabled');
        simExitBtn.removeAttribute('disabled');
    } else {
        modeVal.innerText = 'MANUAL';
        modeVal.className = 'metric-value-text text-yellow';
        manualPanel.classList.remove('disabled');
        simEnterBtn.setAttribute('disabled', 'true');
        simExitBtn.setAttribute('disabled', 'true');
    }

    // 8. Czujniki pętli indukcyjnych (%I)
    updateSensorBadge('sensor-wjazd', plc.wjazd_sensor);
    updateSensorBadge('sensor-wyjazd', plc.wyjazd_sensor);
    updateArenaSensor('sensor-wjazd-badge', plc.wjazd_sensor);
    updateArenaSensor('sensor-wyjazd-badge', plc.wyjazd_sensor);

    // 9. Napędy szlabanów (%Q)
    updateBarrierBadge('barrier-wjazd-status', plc.wjazd_szlaban);
    updateBarrierBadge('barrier-wyjazd-status', plc.wyjazd_szlaban);
    
    // 9b. Wentylator chłodzący szafę (%Q0.2)
    const fanEl = document.getElementById('fan-status');
    if (fanEl) {
        if (plc.cabinet_fan) {
            fanEl.innerText = 'WŁĄCZONY ▲';
            fanEl.className = 'badge badge-open';
        } else {
            fanEl.innerText = 'WYŁĄCZONY ▼';
            fanEl.className = 'badge badge-inactive';
        }
    }
    const pillFan = document.getElementById('pill-fan');
    const valFan = document.getElementById('val-fan');
    if (pillFan && valFan) {
        if (plc.cabinet_fan) {
            pillFan.className = 'pill-badge pill-green';
            valFan.innerText = 'WŁ.';
        } else {
            pillFan.className = 'pill-badge pill-gray';
            valFan.innerText = 'WYŁ.';
        }
    }

    // 9c. Zużycie silnika i licznik cykli (%MW46, %MW48)
    const bCyclesEl = document.getElementById('barrier-cycles');
    if (bCyclesEl) {
        bCyclesEl.innerText = plc.barrier_cycles || 0;
        bCyclesEl.className = 'badge badge-inactive';
    }
    const mHealthEl = document.getElementById('motor-health');
    if (mHealthEl) {
        mHealthEl.innerText = `${plc.barrier_motor_health || 100.0}%`;
        if (plc.barrier_motor_health < 95.0) {
            mHealthEl.className = 'badge badge-active'; // Yellow warning badge
        } else {
            mHealthEl.className = 'badge badge-inactive';
        }
    }
    const greaseEl = document.getElementById('grease-level');
    if (greaseEl) {
        greaseEl.innerText = `${plc.barrier_grease_level.toFixed(1)}%`;
        if (plc.barrier_grease_level < 40.0) {
            greaseEl.className = 'badge badge-active'; // Warning badge
        } else {
            greaseEl.className = 'badge badge-inactive';
        }
    }
    const fanHealthEl = document.getElementById('fan-health-register');
    if (fanHealthEl) {
        fanHealthEl.innerText = `${plc.fan_health.toFixed(1)}%`;
        if (plc.fan_health < 40.0) {
            fanHealthEl.className = 'badge badge-active'; // Warning badge
        } else {
            fanHealthEl.className = 'badge badge-inactive';
        }
    }
    const fanRuntimeEl = document.getElementById('fan-runtime-register');
    if (fanRuntimeEl) {
        fanRuntimeEl.innerText = `${plc.fan_run_time || 0}s`;
        fanRuntimeEl.className = 'badge badge-inactive';
    }

    // 10. Animacja fizyczna szlabanów + sygnalizacja świetlna
    animateGate('barrier-wjazd-arm', 'gate-wjazd-light', plc.wjazd_szlaban);
    animateGate('barrier-wyjazd-arm', 'gate-wyjazd-light', plc.wyjazd_szlaban);

    // 11. Podświetlenie przycisków wymuszenia
    updateManualButtonHighlight('override-wjazd-open', 'override-wjazd-close', plc.wjazd_szlaban);
    updateManualButtonHighlight('override-wyjazd-open', 'override-wyjazd-close', plc.wyjazd_szlaban);

    // 12. Diagnostyka sub-systemów (pille dolne)
    updateDiagnosticsPills(plc, drivers);
    
    // 13. Statystyki sesji
    updateSessionStats(plc);

    // Detect space changes to trigger animations
    if (previousSpaces !== null) {
        let queueTriggered = false;
        for (const [code, status] of Object.entries(spaces)) {
            const prevStatus = previousSpaces[code];
            if (prevStatus !== 'OCCUPIED' && status === 'OCCUPIED') {
                const color = getRandomColor();
                occupiedCarColors[code] = color;
                animatingSpaces[code] = true; // Mark as animating/queued immediately to prevent layout pop-in
                entryQueue.push({ spaceCode: code, color: color });
                queueTriggered = true;
            } else if (prevStatus === 'OCCUPIED' && status !== 'OCCUPIED') {
                const color = occupiedCarColors[code] || getRandomColor();
                animatingSpaces[code] = true; // Hide static car immediately as it queues to exit
                exitQueue.push({ spaceCode: code, color: color });
                queueTriggered = true;
            }
        }
        if (queueTriggered) {
            updateTimelineControlsState();
            processEntryQueue();
            processExitQueue();
        }
    }
    previousSpaces = JSON.parse(JSON.stringify(spaces));

    // 14. Siatka stanowisk parkingowych (dynamiczna)
    updateParkingGrid(spaces);

    // 15. Zapisywanie danych do wykresów (historia)
    if (plcConnected) {
        const now = new Date();
        const timeStr = `${formatWithLeadingZero(now.getHours())}:${formatWithLeadingZero(now.getMinutes())}:${formatWithLeadingZero(now.getSeconds())}`;
        
        tempHistory.push(plc.cabinet_temp);
        upsHistory.push(plc.ups_level);
        occupancyHistory.push(occPercent);
        timeHistory.push(timeStr);
        
        if (tempHistory.length > MAX_HISTORY_POINTS) {
            tempHistory.shift();
            upsHistory.shift();
            occupancyHistory.shift();
            timeHistory.shift();
        }
        
        // Update values in the dashboard text fields
        const chartTempVal = document.getElementById('chart-temp-val');
        if (chartTempVal) {
            if (plc.cabinet_temp === -99.9) {
                chartTempVal.innerText = 'BŁĄD CZUJNIKA';
                chartTempVal.className = 'chart-current-value text-red';
            } else {
                chartTempVal.innerText = `${plc.cabinet_temp.toFixed(1)}°C`;
                chartTempVal.className = 'chart-current-value text-yellow';
            }
        }
        
        const chartUpsVal = document.getElementById('chart-ups-val');
        if (chartUpsVal) {
            if (plc.ups_level === -1.0) {
                chartUpsVal.innerText = 'BŁĄD ZASILACZA';
                chartUpsVal.className = 'chart-current-value text-red';
            } else {
                chartUpsVal.innerText = `${plc.ups_level.toFixed(1)}%`;
                chartUpsVal.className = 'chart-current-value text-blue';
            }
        }
        
        const chartOccupancyVal = document.getElementById('chart-occupancy-val');
        if (chartOccupancyVal) {
            chartOccupancyVal.innerText = `${occPercent}%`;
            chartOccupancyVal.className = 'chart-current-value text-green';
        }
        
        const chartCyclesVal = document.getElementById('chart-cycles-val');
        if (chartCyclesVal) chartCyclesVal.innerText = plc.barrier_cycles || 0;
        
        const chartMotorVal = document.getElementById('chart-motor-val');
        if (chartMotorVal) {
            chartMotorVal.innerText = `${plc.barrier_motor_health || 100.0}%`;
            if (plc.barrier_motor_health < 95.0) {
                chartMotorVal.className = 'stat-value text-yellow';
            } else {
                chartMotorVal.className = 'stat-value text-green';
            }
        }

        const chartGreaseVal = document.getElementById('chart-grease-val');
        if (chartGreaseVal) {
            chartGreaseVal.innerText = `${plc.barrier_grease_level.toFixed(1)}%`;
            if (plc.barrier_grease_level < 40.0) {
                chartGreaseVal.className = 'stat-value text-red';
            } else {
                chartGreaseVal.className = 'stat-value text-blue';
            }
        }
        
        const chartFanVal = document.getElementById('chart-fan-val');
        if (chartFanVal) {
            chartFanVal.innerText = `${plc.fan_health.toFixed(1)}%`;
            if (plc.fan_health < 40.0) {
                chartFanVal.className = 'stat-value text-red';
            } else {
                chartFanVal.className = 'stat-value text-green';
            }
        }
        
        const chartFanRunVal = document.getElementById('chart-fan-run-val');
        if (chartFanRunVal) chartFanRunVal.innerText = plc.fan_run_time || 0;
        
        const chartWjazdOvrVal = document.getElementById('chart-wjazd-ovr-val');
        if (chartWjazdOvrVal) {
            if (!plc.auto_mode && plc.wjazd_szlaban) {
                chartWjazdOvrVal.innerText = 'OPEN';
                chartWjazdOvrVal.className = 'stat-value text-red';
            } else {
                chartWjazdOvrVal.innerText = 'OFF';
                chartWjazdOvrVal.className = 'stat-value';
            }
        }
        
        const chartWyjazdOvrVal = document.getElementById('chart-wyjazd-ovr-val');
        if (chartWyjazdOvrVal) {
            if (!plc.auto_mode && plc.wyjazd_szlaban) {
                chartWyjazdOvrVal.innerText = 'OPEN';
                chartWyjazdOvrVal.className = 'stat-value text-red';
            } else {
                chartWyjazdOvrVal.innerText = 'OFF';
                chartWyjazdOvrVal.className = 'stat-value';
            }
        }
        
        // ENGINE CHECK — Lockout banner visibility
        const lockoutBanner = document.getElementById('maintenance-lockout-banner');
        if (lockoutBanner) {
            if (plc.maintenance_lockout) {
                lockoutBanner.style.display = 'flex';
            } else {
                lockoutBanner.style.display = 'none';
            }
        }
        
        // Draw charts if the analytics tab is active
        const analyticsScreen = document.getElementById('analytics-screen');
        if (analyticsScreen && analyticsScreen.classList.contains('active')) {
            drawAnalyticsCharts();
        }
    }
}

function animateGate(armId, lightId, isOpen) {
    if (armId === 'barrier-wjazd-arm' && wjazdGateOverrideActive) return;
    if (armId === 'barrier-wyjazd-arm' && wyjazdGateOverrideActive) return;
    const arm = document.getElementById(armId);
    const light = document.getElementById(lightId);
    if (!arm || !light) return;
    if (isOpen) {
        arm.classList.add('open');
        light.className = 'ind-light light-green';
    } else {
        arm.classList.remove('open');
        light.className = 'ind-light light-red';
    }
}

/**
 * Helper to update style classes and label text for a status badge DOM element.
 * 
 * @param {string} elementId - ID of the target pill DOM element.
 * @param {string} status - Standard status value (e.g. 'CONNECTED', 'CONNECTING', 'ERROR').
 * @param {string|null} customText - Custom label text (defaults to status if null).
 * @param {string|null} customClass - Custom CSS class name to override default classes.
 */
function updatePillBadge(elementId, status, customText = null, customClass = null) {
    const pillElement = document.getElementById(elementId);
    const valueElement = pillElement ? pillElement.querySelector('.pill-val') : null;
    if (!pillElement || !valueElement) return;
    
    valueElement.innerText = customText !== null ? customText : status;
    
    if (customClass !== null) {
        pillElement.className = `pill-badge ${customClass}`;
    } else {
        let badgeClass = 'pill-badge ';
        if (status === 'CONNECTED') {
            badgeClass += 'pill-green';
        } else if (status === 'CONNECTING') {
            badgeClass += 'pill-yellow';
        } else if (status === 'ERROR') {
            badgeClass += 'pill-red';
        } else {
            badgeClass += 'pill-gray';
        }
        pillElement.className = badgeClass;
    }
}

/**
 * Updates diagnostic badges (pills) for all device links and physical metrics.
 * Corrects threshold check orders for temperature and UPS alerts.
 * 
 * @param {object} plc - Current state values of the PLC registers.
 * @param {object} drivers - Current states and configurations of system drivers.
 */
function updateDiagnosticsPills(plc, drivers) {
    if (!drivers) return;
    
    // 1. PLC LINK
    const plcDriver = drivers["plc"] || {};
    updatePillBadge('pill-plc', plcDriver.status);
    
    // 2. TEMP. SZAFY
    const tempDriver = drivers["temp"] || {};
    if (tempDriver.status === 'CONNECTED') {
        let tempClass = 'pill-green';
        if (plc.cabinet_temp > 27.5) {
            tempClass = 'pill-red';
        } else if (plc.cabinet_temp > 26.0) {
            tempClass = 'pill-yellow';
        }
        updatePillBadge('pill-temp', 'CONNECTED', `${plc.cabinet_temp}°C`, tempClass);
    } else if (tempDriver.status === 'CONNECTING') {
        updatePillBadge('pill-temp', 'CONNECTING', 'ŁĄCZENIE', 'pill-yellow');
    } else if (tempDriver.status === 'ERROR') {
        updatePillBadge('pill-temp', 'ERROR', 'AWARIA', 'pill-red');
    } else {
        updatePillBadge('pill-temp', 'DISCONNECTED', 'OFFLINE', 'pill-gray');
    }
    
    // 3. ZASILACZ UPS
    const upsDriver = drivers["ups"] || {};
    if (upsDriver.status === 'CONNECTED') {
        if (plc.ups_level < 0) {
            updatePillBadge('pill-ups', 'ERROR', 'ERR', 'pill-red');
        } else {
            let upsClass = 'pill-blue';
            if (plc.ups_level < 50) {
                upsClass = 'pill-red';
            } else if (plc.ups_level < 85) {
                upsClass = 'pill-yellow';
            }
            updatePillBadge('pill-ups', 'CONNECTED', `${plc.ups_level}%`, upsClass);
        }
    } else if (upsDriver.status === 'CONNECTING') {
        updatePillBadge('pill-ups', 'CONNECTING', 'ŁĄCZENIE', 'pill-yellow');
    } else if (upsDriver.status === 'ERROR') {
        updatePillBadge('pill-ups', 'ERROR', 'AWARIA', 'pill-red');
    } else {
        updatePillBadge('pill-ups', 'DISCONNECTED', 'OFFLINE', 'pill-gray');
    }

    // 4. HOMOGRAFIA
    const calibDriver = drivers["homography"] || {};
    let calibText = calibDriver.status;
    let calibClass = 'pill-red';
    if (calibDriver.status === 'CONNECTED') {
        calibText = 'SKALIBROWANA';
        calibClass = 'pill-blue';
    } else if (calibDriver.status === 'CONNECTING') {
        calibClass = 'pill-yellow';
    } else if (calibDriver.status === 'ERROR') {
        calibText = 'BŁĄD OSNA';
    }
    updatePillBadge('pill-calib', calibDriver.status, calibText, calibClass);

    // 5. SILNIK YOLO
    const yoloDriver = drivers["yolo"] || {};
    const yoloText = yoloDriver.status === 'CONNECTED' ? 'ONLINE' : yoloDriver.status;
    updatePillBadge('pill-yolo', yoloDriver.status, yoloText);

    // 6. GDPR / RODO
    const gdprDriver = drivers["gdpr"] || {};
    let gdprText = gdprDriver.status;
    let gdprClass = null;
    if (gdprDriver.status === 'CONNECTED') {
        gdprText = 'AKTYWNA';
        gdprClass = 'pill-green';
    } else if (gdprDriver.status === 'CONNECTING') {
        gdprClass = 'pill-yellow';
    } else {
        gdprText = gdprDriver.status === 'ERROR' ? 'BYPASS' : gdprDriver.status;
        gdprClass = 'pill-red';
    }
    updatePillBadge('pill-gdpr', gdprDriver.status, gdprText, gdprClass);
}

function updateSessionStats(plc) {
    const entries = document.getElementById('stat-entries');
    const exits = document.getElementById('stat-exits');
    const peak = document.getElementById('stat-peak');
    const uptime = document.getElementById('stat-uptime');
    
    if (entries) entries.innerText = plc.total_entries || 0;
    if (exits) exits.innerText = plc.total_exits || 0;
    if (peak) peak.innerText = `${plc.peak_occupancy_pct || 0}%`;
    
    if (uptime && plc.system_uptime !== undefined) {
        const hrs = Math.floor(plc.system_uptime / 3600).toString().padStart(2, '0');
        const mins = Math.floor((plc.system_uptime % 3600) / 60).toString().padStart(2, '0');
        const secs = (plc.system_uptime % 60).toString().padStart(2, '0');
        uptime.innerText = `${hrs}:${mins}:${secs}`;
    }
}

/**
 * Calculates graphical layout coordinates for a given parking slot.
 * Used for synoptic arena car animations.
 * 
 * @param {string} spaceCode - The code of the parking space (e.g. "A-5").
 * @param {number} arenaWidth - The client width of the parking arena element.
 * @returns {object} Coordinates containing targetX (number) and isTop (boolean).
 */
function calculateSpaceCoordinates(spaceCode, arenaWidth) {
    const centerBayWidth = arenaWidth - 220;
    const slotWidth = centerBayWidth / 14;
    const spaceNum = parseInt(spaceCode.replace('A-', ''));
    const isTop = spaceNum <= 14;
    const slotIdx = isTop ? (spaceNum - 1) : (spaceNum - 15);
    const targetX = 110 + (slotIdx + 0.5) * slotWidth;
    return { targetX, isTop };
}

/**
 * Triggers a transition on an element, changing its styles over a given duration.
 * 
 * @param {HTMLElement} element - The DOM element to transition.
 * @param {object} styleChanges - Style properties to apply.
 * @param {number} durationMs - Duration in milliseconds.
 * @returns {Promise<void>} Resolves when the transition finishes.
 */
function transitionElement(element, styleChanges, durationMs) {
    return new Promise(resolve => {
        element.style.transition = `all ${durationMs}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
        element.offsetHeight; // Force reflow
        Object.assign(element.style, styleChanges);
        setTimeout(resolve, durationMs);
    });
}

/**
 * Updates CSS classes on a graphic arena sensor element to show detection state.
 * 
 * @param {string} elementId - ID of the sensor badge DOM element.
 * @param {boolean} isActive - True if active detection, False otherwise.
 */
function updateArenaSensor(elementId, isActive) {
    const element = document.getElementById(elementId);
    if (!element) return;
    if (isActive) {
        element.classList.add('active');
    } else {
        element.classList.remove('active');
    }
}

/**
 * Animates a car driving from the entry road, passing through the wjazd gate,
 * and turning into its designated parking slot.
 * 
 * @param {string} spaceCode - The code of the target space.
 * @param {string} color - Hex color code for the car model.
 */
async function animateCarEntry(spaceCode, color) {
    animatingSpaces[spaceCode] = true;
    updateParkingGrid(previousSpaces || {}); // Hide static car

    const arena = document.querySelector('.parking-arena');
    const layer = document.getElementById('cars-layer');
    if (!arena || !layer) return;

    const { targetX, isTop } = calculateSpaceCoordinates(spaceCode, arena.clientWidth);

    // Create animated car element
    const carElement = document.createElement('div');
    carElement.className = 'animated-car';
    carElement.style.left = '-30px';
    carElement.style.top = '88px';
    carElement.style.transform = 'rotate(90deg)'; // Facing right
    carElement.innerHTML = getRandomCarSVG(color);
    layer.appendChild(carElement);

    // Phase 1: Drive to entry gate sensor
    await transitionElement(carElement, { left: '35px' }, 700);

    // Trigger entry overrides
    wjazdGateOverrideActive = true;
    updateArenaSensor('sensor-wjazd-badge', true);
    const wjazdArm = document.getElementById('barrier-wjazd-arm');
    const wjazdLight = document.getElementById('gate-wjazd-light');
    if (wjazdArm) wjazdArm.classList.add('open');
    if (wjazdLight) {
        wjazdLight.className = 'ind-light light-green';
    }

    await new Promise(resolve => setTimeout(resolve, 600));

    // Phase 2: Drive through gate and down the road to target X
    await transitionElement(carElement, { left: `${targetX - 11}px` }, Math.max(500, Math.abs(targetX - 45) * 1.5));

    // Restore entry gate state
    wjazdGateOverrideActive = false;
    if (lastPlcState) {
        animateGate('barrier-wjazd-arm', 'gate-wjazd-light', lastPlcState.wjazd_szlaban);
        updateArenaSensor('sensor-wjazd-badge', lastPlcState.wjazd_sensor);
    }

    // Phase 3: Turn and park in slot
    const parkY = isTop ? '18px' : '194px';
    const parkRot = isTop ? '180deg' : '0deg';
    await transitionElement(carElement, { top: parkY, transform: `rotate(${parkRot})` }, 700);

    // Phase 4: Settle and clean up
    carElement.remove();
    animatingSpaces[spaceCode] = false;
    if (previousSpaces) {
        updateParkingGrid(previousSpaces);
    }
}

/**
 * Animates a car backing out of its parking slot, driving along the road,
 * passing through the wyjazd gate, and exiting the parking arena.
 * 
 * @param {string} spaceCode - The code of the slot the car is exit-simulating.
 * @param {string} color - Hex color code for the car model.
 */
async function animateCarExit(spaceCode, color) {
    animatingSpaces[spaceCode] = true;
    updateParkingGrid(previousSpaces || {}); // Hide static car

    const arena = document.querySelector('.parking-arena');
    const layer = document.getElementById('cars-layer');
    if (!arena || !layer) return;

    const { targetX, isTop } = calculateSpaceCoordinates(spaceCode, arena.clientWidth);
    const startY = isTop ? 18 : 194;
    const startRot = isTop ? 180 : 0;

    // Create animated car element starting from slot
    const carElement = document.createElement('div');
    carElement.className = 'animated-car';
    carElement.style.left = `${targetX - 11}px`;
    carElement.style.top = `${startY}px`;
    carElement.style.transform = `rotate(${startRot}deg)`;
    carElement.innerHTML = getRandomCarSVG(color);
    layer.appendChild(carElement);

    // Phase 1: Back out of slot into road and rotate to face exit (right)
    await transitionElement(carElement, { top: '120px', transform: 'rotate(90deg)' }, 700);

    // Phase 2: Drive along the road to exit gate sensor
    const arenaWidth = arena.clientWidth;
    await transitionElement(carElement, { left: `${arenaWidth - 145}px` }, Math.max(500, Math.abs(arenaWidth - 145 - targetX) * 1.5));

    // Trigger exit overrides
    wyjazdGateOverrideActive = true;
    updateArenaSensor('sensor-wyjazd-badge', true);
    const wyjazdArm = document.getElementById('barrier-wyjazd-arm');
    const wyjazdLight = document.getElementById('gate-wyjazd-light');
    if (wyjazdArm) wyjazdArm.classList.add('open');
    if (wyjazdLight) {
        wyjazdLight.className = 'ind-light light-green';
    }

    await new Promise(resolve => setTimeout(resolve, 600));

    // Phase 3: Drive through exit gate and leave arena
    await transitionElement(carElement, { left: `${arenaWidth + 30}px` }, 800);

    // Restore exit gate state
    wyjazdGateOverrideActive = false;
    if (lastPlcState) {
        animateGate('barrier-wyjazd-arm', 'gate-wyjazd-light', lastPlcState.wyjazd_szlaban);
        updateArenaSensor('sensor-wyjazd-badge', lastPlcState.wyjazd_sensor);
    }

    // Phase 4: Settle & cleanup
    carElement.remove();
    animatingSpaces[spaceCode] = false;
    delete occupiedCarColors[spaceCode];
    if (previousSpaces) {
        updateParkingGrid(previousSpaces);
    }
}

async function processEntryQueue() {
    if (isEntryAnimating || entryQueue.length === 0) {
        updateTimelineControlsState();
        return;
    }
    isEntryAnimating = true;
    updateTimelineControlsState();
    const task = entryQueue.shift();
    try {
        await animateCarEntry(task.spaceCode, task.color);
    } catch (e) {
        console.error("Entry animation failed:", e);
    } finally {
        isEntryAnimating = false;
        processEntryQueue();
    }
}

async function processExitQueue() {
    if (isExitAnimating || exitQueue.length === 0) {
        updateTimelineControlsState();
        return;
    }
    isExitAnimating = true;
    updateTimelineControlsState();
    const task = exitQueue.shift();
    try {
        await animateCarExit(task.spaceCode, task.color);
    } catch (e) {
        console.error("Exit animation failed:", e);
    } finally {
        isExitAnimating = false;
        processExitQueue();
    }
}

function updateParkingGrid(spaces) {
    const rowTop = document.getElementById('parking-row-top');
    const rowBottom = document.getElementById('parking-row-bottom');
    if (!rowTop || !rowBottom) return;

    const sortedSpaces = Object.entries(spaces).sort((a, b) => {
        const numA = parseInt(a[0].replace('A-', ''));
        const numB = parseInt(b[0].replace('A-', ''));
        return numA - numB;
    });

    sortedSpaces.forEach(([code, status]) => {
        let slotEl = document.getElementById(`space-${code}`);
        const spaceNum = parseInt(code.replace('A-', ''));
        const isTop = spaceNum <= 14;
        const parentRow = isTop ? rowTop : rowBottom;
        const isSpecial = (spaceNum === 27 || spaceNum === 28);
        
        if (!slotEl) {
            slotEl = document.createElement('div');
            slotEl.id = `space-${code}`;
            slotEl.onclick = () => toggleSpace(code);
            
            slotEl.innerHTML = `
                <div class="slot-header">
                    <span class="slot-code">${code}${isSpecial ? ' ♿' : ''}</span>
                    <span id="led-indicator-${code}" class="slot-led"></span>
                </div>
                <div class="slot-car-container" id="car-container-${code}"></div>
            `;
            
            slotEl.className = isSpecial ? 'parking-slot special-disabled' : 'parking-slot';
            parentRow.appendChild(slotEl);
        }

        const ledEl = document.getElementById(`led-indicator-${code}`);
        const carContainer = document.getElementById(`car-container-${code}`);
        
        slotEl.classList.remove('free', 'occupied', 'disabled-spot');
        if (ledEl) ledEl.className = 'slot-led';

        if (status === 'FREE') {
            slotEl.classList.add('free');
            if (ledEl) ledEl.classList.add('led-green');
            if (carContainer) carContainer.innerHTML = '';
        } else if (status === 'OCCUPIED') {
            slotEl.classList.add('occupied');
            if (ledEl) ledEl.classList.add('led-red');
            // If currently animating, hide static car representation
            if (carContainer && !animatingSpaces[code]) {
                if (!carContainer.innerHTML) {
                    if (!occupiedCarColors[code]) {
                        occupiedCarColors[code] = getRandomColor();
                    }
                    carContainer.innerHTML = getRandomCarSVG(occupiedCarColors[code]);
                }
            } else if (carContainer && animatingSpaces[code]) {
                carContainer.innerHTML = '';
            }
        } else if (status === 'DISABLED') {
            slotEl.classList.add('disabled-spot');
            if (ledEl) ledEl.classList.add('led-blue');
            if (carContainer) carContainer.innerHTML = '';
        }
    });
}

// ========================= STATUS BADGES =========================

function updateSensorBadge(elementId, isActive) {
    const badge = document.getElementById(elementId);
    if (!badge) return;
    if (isActive) {
        badge.innerText = 'DETEKCJA AKTYWNA';
        badge.className = 'badge badge-active';
    } else {
        badge.innerText = 'BRAK DETEKCJI';
        badge.className = 'badge badge-inactive';
    }
}

function updateBarrierBadge(elementId, isOpen) {
    const badge = document.getElementById(elementId);
    if (!badge) return;
    if (isOpen) {
        badge.innerText = 'PODNIESIONY ▲';
        badge.className = 'badge badge-open';
    } else {
        badge.innerText = 'OPUSZCZONY ▼';
        badge.className = 'badge badge-inactive';
    }
}

function updateManualButtonHighlight(openId, closeId, isOpen) {
    const openBtn = document.getElementById(openId);
    const closeBtn = document.getElementById(closeId);
    if (!openBtn || !closeBtn) return;

    if (isOpen) {
        openBtn.classList.add('btn-active');
        closeBtn.classList.remove('btn-active');
    } else {
        openBtn.classList.remove('btn-active');
        closeBtn.classList.add('btn-active');
    }
}

// ========================= CONTROL API INTERFACE =========================

async function sendAction(url, body = null) {
    try {
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };
        if (body) {
            options.body = JSON.stringify(body);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            const err = await response.json();
            alert(`Błąd: ${err.detail || 'Wystąpił nieznany błąd serwera.'}`);
        }
    } catch (e) {
        console.error('API call failed:', e);
        alert('Błąd połączenia z API serwera.');
    }
}

function toggleSpace(spaceCode) {
    sendAction(`/api/simulate/toggle-space/${spaceCode}`);
}

// ========================= DOM READY =========================

document.addEventListener('DOMContentLoaded', () => {
    // Przełączenie trybu pracy sterownika
    document.getElementById('toggle-mode-btn').addEventListener('click', () => {
        sendAction('/api/simulate/mode');
    });

    // Emulacja procesowa (tryb AUTO)
    document.getElementById('sim-enter-btn').addEventListener('click', () => {
        sendAction('/api/simulate/car-enter');
        logAlarm('INFO', '%I0.0', 'Emulacja wjazdu — aktywacja czujnika pętli indukcyjnej');
    });
    document.getElementById('sim-exit-btn').addEventListener('click', () => {
        sendAction('/api/simulate/car-exit');
        logAlarm('INFO', '%I0.1', 'Emulacja wyjazdu — aktywacja czujnika pętli indukcyjnej');
    });

    // Wymuszenie ręczne wyjść (tryb MANUAL)
    document.getElementById('override-wjazd-open').addEventListener('click', () => {
        sendAction('/api/simulate/override', { barrier: 'wjazd', open_state: true });
        logAlarm('WARNING', '%Q0.0', 'Wymuszenie ręczne: szlaban wjazdowy PODNIESIONY');
    });
    document.getElementById('override-wjazd-close').addEventListener('click', () => {
        sendAction('/api/simulate/override', { barrier: 'wjazd', open_state: false });
        logAlarm('INFO', '%Q0.0', 'Wymuszenie ręczne: szlaban wjazdowy OPUSZCZONY');
    });
    document.getElementById('override-wyjazd-open').addEventListener('click', () => {
        sendAction('/api/simulate/override', { barrier: 'wyjazd', open_state: true });
        logAlarm('WARNING', '%Q0.1', 'Wymuszenie ręczne: szlaban wyjazdowy PODNIESIONY');
    });
    document.getElementById('override-wyjazd-close').addEventListener('click', () => {
        sendAction('/api/simulate/override', { barrier: 'wyjazd', open_state: false });
        logAlarm('INFO', '%Q0.1', 'Wymuszenie ręczne: szlaban wyjazdowy OPUSZCZONY');
    });
    
    // Przycisk czyszczenia dziennika alarmów
    document.getElementById('alarm-clear-btn').addEventListener('click', () => {
        alarmLog.length = 0;
        renderAlarmJournal();
    });
    // Przyciski konserwacji predykcyjnej
    const greaseMaintBtn = document.getElementById('maintenance-grease-btn');
    if (greaseMaintBtn) {
        greaseMaintBtn.addEventListener('click', () => {
            sendAction('/api/simulate/maintenance/grease');
        });
    }
    const fanMaintBtn = document.getElementById('maintenance-fan-btn');
    if (fanMaintBtn) {
        fanMaintBtn.addEventListener('click', () => {
            sendAction('/api/simulate/maintenance/fan');
        });
    }

    // Interakcja z mapą topologii (kliknięcie węzła przewija do konfiguratora)
    const topoCanvas = document.getElementById('topology-canvas');
    if (topoCanvas) {
        topoCanvas.addEventListener('click', (event) => {
            const rect = topoCanvas.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * topoCanvas.width;
            const y = ((event.clientY - rect.top) / rect.height) * topoCanvas.height;

            Object.entries(TOPOLOGY_NODES).forEach(([id, node]) => {
                const dx = x - node.x;
                const dy = y - node.y;
                const radius = 25;
                if (dx * dx + dy * dy <= radius * radius) {
                    const driverId = node.driver || node.driverCard || id;
                    const card = document.getElementById(`node-card-${driverId}`);
                    if (card) {
                        card.classList.remove('highlight-pulse');
                        void card.offsetWidth; // Wyzwalacz reflow do restartu animacji
                        card.classList.add('highlight-pulse');
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            });
        });
    }

    // Obsługa wyboru motywu HMI z zapamiętywaniem wyboru w pamięci lokalnej
    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
        const savedTheme = localStorage.getItem('hmi-theme') || 'default';
        themeSelector.value = savedTheme;
        applyTheme(savedTheme);

        themeSelector.addEventListener('change', (e) => {
            const theme = e.target.value;
            localStorage.setItem('hmi-theme', theme);
            applyTheme(theme);
        });
    }

    function applyTheme(theme) {
        document.body.classList.remove('theme-tactical-red', 'theme-light-high-glare');
        if (theme === 'tactical-red') {
            document.body.classList.add('theme-tactical-red');
        } else if (theme === 'light-high-glare') {
            document.body.classList.add('theme-light-high-glare');
        }
        // Wyzwolenie ponownego rysowania Canvasów dla nowego motywu
        setTimeout(() => {
            if (typeof drawTopology === 'function') drawTopology();
            if (typeof drawAnalyticsCharts === 'function') drawAnalyticsCharts();
        }, 50);
    }

    // Inicjalizacja połączenia WebSocket
    logAlarm('INFO', 'SYSTEM', 'Inicjalizacja panelu HMI SENTINEL');
    connectWS();

    // Inicjalizacja modułu PKLot
    initPKLot();
    
    // Inicjalizacja klikalnych badge'y rejestrów
    setupInteractiveBadges();
});

// ========================= PKLOT DATASET HANDLERS =========================

let pklotSnapshots = [];
let currentFrameIdx = -1;
let playInterval = null;
let isPlaying = false;

async function applyPKLotFrame(snapshotName) {
    try {
        const response = await fetch(`/api/pklot/apply/${snapshotName}`, { method: 'POST' });
        if (!response.ok) {
            console.error(`Failed to apply frame: ${snapshotName}`);
        }
    } catch (e) {
        console.error('Apply PKLot state failed:', e);
    }
}

// ========================= CCTV CALENDAR & TODAY PREDICTIVE GRAPH =========================

function renderCCTVCalendar() {
    const container = document.getElementById('pklot-cctv-calendar');
    if (!container) return;
    
    const monthNames = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
    const daysInMonth = new Date(cctvCalYear, cctvCalMonth + 1, 0).getDate();
    let startDay = new Date(cctvCalYear, cctvCalMonth, 1).getDay();
    // Adjust startDay so Monday is 0 and Sunday is 6
    startDay = (startDay + 6) % 7;
    
    let html = `
        <div class="cctv-cal-header">
            <button class="cctv-cal-btn" onclick="changeCCTVMonth(-1)">◀</button>
            <span class="cctv-cal-month-title">${monthNames[cctvCalMonth]} ${cctvCalYear}</span>
            <button class="cctv-cal-btn" onclick="changeCCTVMonth(1)">▶</button>
        </div>
        <div class="cctv-cal-grid">
            <div class="cctv-cal-day-name">Pn</div>
            <div class="cctv-cal-day-name">Wt</div>
            <div class="cctv-cal-day-name">Śr</div>
            <div class="cctv-cal-day-name">Cz</div>
            <div class="cctv-cal-day-name">Pt</div>
            <div class="cctv-cal-day-name">Sb</div>
            <div class="cctv-cal-day-name">Nd</div>
    `;
    
    // Render blank cells
    for (let i = 0; i < startDay; i++) {
        html += `<div class="cctv-cal-day" style="opacity: 0.15;"></div>`;
    }
    
    // Render month days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${cctvCalYear}-${formatWithLeadingZero(cctvCalMonth + 1)}-${formatWithLeadingZero(d)}`;
        const hasData = pklotDatesWithData.has(dateStr);
        const isActive = dateStr === selectedCCTVDate;
        
        let dayClass = "cctv-cal-day";
        if (hasData) dayClass += " has-data";
        if (isActive) dayClass += " active";
        
        const clickAttr = hasData ? `onclick="selectCCTVDate('${dateStr}')"` : "";
        html += `<div class="${dayClass}" ${clickAttr}>${d}</div>`;
    }
    
    html += `</div>`;
    container.innerHTML = html;
}

function changeCCTVMonth(dir) {
    cctvCalMonth += dir;
    if (cctvCalMonth < 0) {
        cctvCalMonth = 11;
        cctvCalYear -= 1;
    } else if (cctvCalMonth > 11) {
        cctvCalMonth = 0;
        cctvCalYear += 1;
    }
    renderCCTVCalendar();
}

async function selectCCTVDate(dateStr) {
    await applyCCTVDateFilter(dateStr, true);
}

async function fetchTodayActualOccupancy(dateStr) {
    try {
        const res = await fetch(`/api/pklot/day-occupancy/${dateStr}`);
        selectedDayActualOccupancy = await res.json();
    } catch (e) {
        console.error("Failed to fetch day actual occupancy:", e);
        selectedDayActualOccupancy = [];
    }
}

async function applyCCTVDateFilter(dateStr, loadFrame = true) {
    selectedCCTVDate = dateStr;
    
    // Fetch day actual occupancy metrics
    await fetchTodayActualOccupancy(dateStr);
    
    // Filter snapshots by selected date
    pklotSnapshots = allPklotSnapshots.filter(name => {
        const parts = name.split('/');
        return parts.length >= 2 && parts[1] === dateStr;
    });
    
    // Re-populate select dropdown (which now only contains this day's frames)
    const selectEl = document.getElementById('pklot-snapshot-select');
    if (selectEl) {
        selectEl.innerHTML = '';
        if (pklotSnapshots.length === 0) {
            selectEl.innerHTML = '<option value="">Brak klatek dla tego dnia</option>';
        } else {
            const defOpt = document.createElement('option');
            defOpt.value = '';
            defOpt.innerText = '-- Wybierz klatkę --';
            selectEl.appendChild(defOpt);
            
            pklotSnapshots.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                const base = name.split('/').pop() || name;
                opt.innerText = base;
                selectEl.appendChild(opt);
            });
        }
    }
    
    // Re-configure timeline slider range
    const timeline = document.getElementById('pklot-timeline');
    const timeStart = document.getElementById('timeline-time-start');
    const timeEnd = document.getElementById('timeline-time-end');
    const frameIndicator = document.getElementById('timeline-frame-indicator');
    
    if (timeline && pklotSnapshots.length > 0) {
        timeline.max = pklotSnapshots.length - 1;
        timeline.min = 0;
        timeline.value = 0;
        
        const getHourMinute = (name) => {
            const filename = name.split('/').pop() || '';
            const parts = filename.split('_');
            if (parts.length >= 3) {
                return `${parts[1]}:${parts[2]}`;
            }
            return '--:--';
        };
        timeStart.innerText = getHourMinute(pklotSnapshots[0]);
        timeEnd.innerText = getHourMinute(pklotSnapshots[pklotSnapshots.length - 1]);
        frameIndicator.innerText = `Klatka: 1 / ${pklotSnapshots.length}`;
    }
    
    // Refresh calendar rendering to show new active day
    renderCCTVCalendar();
    
    // Load first frame of the new day
    if (loadFrame && pklotSnapshots.length > 0) {
        await selectFrame(0);
    }
}

async function drawTodayForecastChart() {
    const canvas = document.getElementById('chart-today-forecast');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    
    const style = getComputedStyle(document.body);
    const bgCard = style.getPropertyValue('--bg-card').trim() || '#1c1c1c';
    const textSec = style.getPropertyValue('--text-secondary').trim() || '#888888';
    const clrYellow = style.getPropertyValue('--clr-yellow').trim() || '#f1c40f';
    const clrGreen = style.getPropertyValue('--clr-green').trim() || '#2ecc71';
    const clrBlue = style.getPropertyValue('--clr-blue').trim() || '#3498db';
    
    ctx.fillStyle = bgCard;
    ctx.fillRect(0, 0, w, h);
    
    const padL = 35; const padR = 15; const padT = 15; const padB = 20;
    const cW = w - padL - padR; const cH = h - padT - padB;
    
    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
        const y = padT + (cH / 4) * i;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    }
    for (let i = 1; i < 6; i++) {
        const x = padL + (cW / 6) * i;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
    }
    
    // Resolve current parameters
    let activeWeather = 'sunny';
    let isWeekend = false;
    let currentHour = 12.0;
    
    if (pklotSnapshots.length > 0 && currentFrameIdx >= 0 && currentFrameIdx < pklotSnapshots.length) {
        const snap = pklotSnapshots[currentFrameIdx];
        const parts = snap.split('/');
        if (parts.length >= 3) {
            activeWeather = parts[0];
            const dateStr = parts[1];
            const dateObj = new Date(dateStr);
            isWeekend = [0, 6].includes(dateObj.getDay());
            
            const filename = parts[2];
            const fnParts = filename.split('_');
            if (fnParts.length >= 4) {
                currentHour = parseInt(fnParts[1]) + parseInt(fnParts[2]) / 60.0;
            }
        }
    }
    
    // Fetch forecast
    const methodSelect = document.getElementById('ml-forecast-method');
    const method = methodSelect ? methodSelect.value : 'regression';
    
    let predictions = [];
    try {
        const foreRes = await fetch(`/api/ml/forecast?hour=0&is_weekend=${isWeekend}&weather=${activeWeather}&method=${method}`);
        const foreData = await foreRes.json();
        predictions = foreData.predictions; // 24 values
    } catch (e) {
        console.error("Failed to load forecast for today view:", e);
        return;
    }
    
    if (predictions.length === 0) return;
    
    // Calculate standard deviation from MSE
    const mse = window.mlModelMse || 0.131;
    const sd = Math.sqrt(mse);
    const z = 1.96; // 95% CI
    
    // Draw shaded confidence interval band
    ctx.fillStyle = 'rgba(241, 196, 15, 0.06)';
    ctx.beginPath();
    
    // Upper curve
    for (let i = 0; i < 24; i++) {
        const x = padL + (i / 23) * cW;
        const val = Math.max(0, Math.min(1.0, predictions[i] + z * sd));
        const y = padT + cH - val * cH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    // Lower curve (backwards)
    for (let i = 23; i >= 0; i--) {
        const x = padL + (i / 23) * cW;
        const val = Math.max(0, Math.min(1.0, predictions[i] - z * sd));
        const y = padT + cH - val * cH;
        ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    
    // Draw forecast dashed line
    ctx.strokeStyle = clrYellow;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
        const x = padL + (i / 23) * cW;
        const y = padT + cH - predictions[i] * cH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset
    
    // Draw actual occupancy curve
    if (selectedDayActualOccupancy && selectedDayActualOccupancy.length > 0) {
        ctx.strokeStyle = clrGreen;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        let first = true;
        
        selectedDayActualOccupancy.forEach(item => {
            if (item.hour <= currentHour) {
                const x = padL + (item.hour / 24.0) * cW;
                const y = padT + cH - item.occupancy * cH;
                if (first) {
                    ctx.moveTo(x, y);
                    first = false;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        });
        ctx.stroke();
    }
    
    // Draw hourly probability percentages at key points
    ctx.fillStyle = clrBlue;
    ctx.font = '700 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    
    const probPoints = [4, 8, 12, 16, 20];
    probPoints.forEach(hourIdx => {
        const x = padL + (hourIdx / 23) * cW;
        const y = padT + cH - predictions[hourIdx] * cH;
        const p = Math.round(100 * (1 - mse * (0.85 + 0.3 * Math.sin(2 * Math.PI * hourIdx / 24))));
        
        // Small blue dot
        ctx.fillStyle = clrBlue;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        
        // Probability text label
        ctx.fillText(`${p}%`, x, y - 4);
    });
    
    // Calculate current probability to display in header
    const currentProb = Math.round(100 * (1 - mse * (0.85 + 0.3 * Math.sin(2 * Math.PI * currentHour / 24))));
    const probEl = document.getElementById('today-forecast-prob');
    if (probEl) {
        probEl.innerText = `${currentProb}%`;
    }
    
    // Draw Y axis labels
    ctx.fillStyle = textSec;
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('100%', padL - 4, padT);
    ctx.fillText('50%', padL - 4, padT + cH/2);
    ctx.fillText('0%', padL - 4, padT + cH);
    
    // Draw X axis labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xLabels = ["00:00", "06:00", "12:00", "18:00", "23:00"];
    const xLabelHours = [0, 6, 12, 18, 23];
    for (let i = 0; i < xLabels.length; i++) {
        const x = padL + (xLabelHours[i] / 23) * cW;
        ctx.fillText(xLabels[i], x, padT + cH + 4);
    }
    
    // Draw a vertical line for the "present moment" Y indicator
    const currentX = padL + (currentHour / 24.0) * cW;
    ctx.strokeStyle = 'rgba(52, 152, 219, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(currentX, padT);
    ctx.lineTo(currentX, padT + cH);
    ctx.stroke();
    ctx.setLineDash([]);
}

function setupInteractiveBadges() {
    document.querySelectorAll('.interactive-badge').forEach(badge => {
        badge.addEventListener('click', () => {
            const targetId = badge.getAttribute('data-target');
            if (!targetId) return;
            
            if (targetId === 'loops' || targetId === 'wjazd_motor' || targetId === 'wyjazd_motor') {
                // Switch to Topology tab
                switchTab('topology-screen');
                // Scroll to node card in driver configurator
                const card = document.getElementById('node-card-plc');
                if (card) {
                    card.classList.remove('highlight-pulse');
                    void card.offsetWidth;
                    card.classList.add('highlight-pulse');
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else if (targetId === 'fan-status') {
                // Switch to Analytics tab
                switchTab('analytics-screen');
                // Scroll to temperature chart card
                const card = document.getElementById('chart-temp');
                if (card) {
                    const parentCard = card.closest('.chart-card');
                    if (parentCard) {
                        parentCard.classList.remove('highlight-pulse');
                        void parentCard.offsetWidth;
                        parentCard.classList.add('highlight-pulse');
                        parentCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            } else if (targetId.startsWith('chart-')) {
                // Switch to Analytics tab
                switchTab('analytics-screen');
                // Scroll to specific predictive maintenance metric
                const el = document.getElementById(targetId);
                if (el) {
                    const parentCard = el.closest('.chart-card') || el.closest('.stat-item');
                    if (parentCard) {
                        parentCard.classList.remove('highlight-pulse');
                        void parentCard.offsetWidth;
                        parentCard.classList.add('highlight-pulse');
                        parentCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        });
    });
}

async function initPKLot() {
    const selectEl = document.getElementById('pklot-snapshot-select');
    const applyBtn = document.getElementById('pklot-apply-btn');
    const imgEl = document.getElementById('pklot-img');
    const svgEl = document.getElementById('pklot-svg');
    const metaEl = document.getElementById('pklot-meta-content');
    const placeholderEl = document.getElementById('pklot-placeholder');

    const timeline = document.getElementById('pklot-timeline');
    const timeStart = document.getElementById('timeline-time-start');
    const timeEnd = document.getElementById('timeline-time-end');
    const timeCurrent = document.getElementById('timeline-time-current');
    const frameIndicator = document.getElementById('timeline-frame-indicator');
    const btnPrev = document.getElementById('btn-play-prev');
    const btnNext = document.getElementById('btn-play-next');
    const btnPlay = document.getElementById('btn-play-toggle');
    const speedSelect = document.getElementById('pklot-speed');

    if (!selectEl) return;

    // Set a 1x1 transparent spacer GIF on load to avoid default browser broken image icon
    const spacerGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    if (imgEl) {
        imgEl.src = spacerGif;
    }

    // Helper function to update/select a frame by index
    async function selectFrame(index) {
        if (index < 0 || index >= pklotSnapshots.length) return;
        currentFrameIdx = index;
        
        const snapshotName = pklotSnapshots[index];
        
        // Update UI controls
        selectEl.value = snapshotName;
        timeline.value = index;
        frameIndicator.innerText = `Klatka: ${index + 1} / ${pklotSnapshots.length}`;
        
        // Hide visual placeholder when a frame starts loading
        if (placeholderEl) {
            placeholderEl.classList.add('hidden');
        }
        
        // Format current timestamp from filename (e.g. weather/date/2012-12-07_17_12_25)
        const filename = snapshotName.split('/').pop() || '';
        const parts = filename.split('_');
        if (parts.length >= 4) {
            timeCurrent.innerText = `Godzina: ${parts[1]}:${parts[2]}:${parts[3]}`;
        } else {
            timeCurrent.innerText = `Godzina: --:--:--`;
        }
        
        imgEl.src = `/api/pklot/snapshot/${snapshotName}`;
        metaEl.innerText = 'Pobieranie metadanych detekcji YOLO...';
        
        try {
            const response = await fetch(`/api/pklot/annotation/${snapshotName}`);
            const data = await response.json();
            
            svgEl.innerHTML = '';
            let occupiedCount = 0;
            let freeCount = 0;

            data.spaces.forEach(space => {
                if (space.occupied) occupiedCount++;
                else freeCount++;

                const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                const pointsStr = space.contour.map(pt => `${pt.x},${pt.y}`).join(' ');
                polygon.setAttribute('points', pointsStr);
                
                polygon.classList.add('pklot-polygon');
                polygon.classList.add(space.occupied ? 'occupied' : 'free');

                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = `Stanowisko ID: ${space.id} | Status: ${space.occupied ? 'ZAJĘTE' : 'WOLNE'}`;
                polygon.appendChild(title);

                svgEl.appendChild(polygon);
            });

            let text = `Klatka: ${data.name}\n`;
            text += `Łączna liczba stanowisk: ${data.spaces.length}\n`;
            text += `ZAJĘTE: ${occupiedCount} | WOLNE: ${freeCount}\n`;
            text += `Obłożenie: ${Math.round((occupiedCount / data.spaces.length) * 100)}%\n\n`;
            text += `Mapowanie PLC (ID → rejestr):\n`;
            
            const maxShow = Math.min(data.spaces.length, 28);
            for (let i = 1; i <= maxShow; i++) {
                const sp = data.spaces.find(s => s.id === String(i));
                if (sp) {
                    const regAddr = `%MW${10 + (i - 1) * 2}`;
                    const statusStr = sp.occupied ? 'ZAJĘTE' : (i >= 27 ? '♿ REZERW.' : 'WOLNE');
                    text += ` ${i.toString().padStart(2, ' ')}→ A-${i} (${regAddr}): ${statusStr}\n`;
                }
            }

            metaEl.innerText = text;
            applyBtn.removeAttribute('disabled');
        } catch (err) {
            console.error('Failed to load annotation details:', err);
            metaEl.innerText = 'Błąd pobierania metadanych XML dla klatki.';
        }
        
        // AUTO-APPLY: Direct integration with PLC Synoptic over WebSockets!
        await applyPKLotFrame(snapshotName);
        
        // Redraw today forecast with current frame Ypresent line and actual values
        drawTodayForecastChart();
    }

    let lastFrameTime = Date.now();
    function startPlayback() {
        if (playInterval) clearInterval(playInterval);
        lastFrameTime = Date.now();
        playInterval = setInterval(() => {
            if (isAnimationBusy()) {
                // Keep delaying frame advancement until animations finish
                return;
            }
            const now = Date.now();
            const intervalTime = parseInt(speedSelect.value) || 1500;
            if (now - lastFrameTime >= intervalTime) {
                lastFrameTime = now;
                let nextIdx = currentFrameIdx + 1;
                if (nextIdx >= pklotSnapshots.length) {
                    nextIdx = 0; // Wrap around to the start
                }
                selectFrame(nextIdx);
            }
        }, 100); // Check busy status and elapsed time every 100ms
        btnPlay.innerText = '⏸ WSTRZYMAJ';
        btnPlay.classList.add('btn-active');
        isPlaying = true;
    }

    function stopPlayback() {
        if (playInterval) {
            clearInterval(playInterval);
            playInterval = null;
        }
        btnPlay.innerText = '▶ ODTWARZAJ';
        btnPlay.classList.remove('btn-active');
        isPlaying = false;
    }

    try {
        const response = await fetch('/api/pklot/snapshots');
        allPklotSnapshots = await response.json();
        
        if (allPklotSnapshots.length === 0) {
            selectEl.innerHTML = '<option value="">Brak plików PKLot w systemie</option>';
            metaEl.innerText = 'Nie znaleziono datasetu PKLot w folderze projektu.';
            return;
        }
        
        // Extract unique dates that have PKLot recordings
        pklotDatesWithData.clear();
        allPklotSnapshots.forEach(name => {
            const parts = name.split('/');
            if (parts.length >= 2) {
                pklotDatesWithData.add(parts[1]);
            }
        });
        
        // Sort dates and select the default starting date
        const sortedDates = Array.from(pklotDatesWithData).sort();
        if (sortedDates.length > 0) {
            selectedCCTVDate = sortedDates[0];
            const p = selectedCCTVDate.split('-');
            cctvCalYear = parseInt(p[0]);
            cctvCalMonth = parseInt(p[1]) - 1;
        }
        
        // Expose calendar functions globally so they can be triggered from calendar click attributes
        window.changeCCTVMonth = changeCCTVMonth;
        window.selectCCTVDate = selectCCTVDate;
        
        // Render CCTV Calendar
        renderCCTVCalendar();
        
        // Apply default date filter
        await applyCCTVDateFilter(selectedCCTVDate, false);
        
        // Fetch ML history stats on boot for forecasting MSE caching
        fetch('/api/ml/history')
            .then(res => res.json())
            .then(data => {
                if (data && data.is_trained) {
                    window.mlModelMse = data.mse;
                }
            })
            .catch(e => console.error("Failed to pre-cache ML MSE:", e));

        // Enable timeline slider controls
        if (pklotSnapshots.length > 0) {
            timeline.removeAttribute('disabled');
            btnPrev.removeAttribute('disabled');
            btnNext.removeAttribute('disabled');
            btnPlay.removeAttribute('disabled');
            speedSelect.removeAttribute('disabled');
        }
    } catch (e) {
        console.error('Failed to load PKLot snapshots list:', e);
        selectEl.innerHTML = '<option value="">Błąd ładowania</option>';
    }

    // Playback and timeline event listeners
    btnPlay.addEventListener('click', () => {
        if (isPlaying) {
            stopPlayback();
        } else {
            if (currentFrameIdx < 0) currentFrameIdx = 0;
            startPlayback();
        }
    });

    btnPrev.addEventListener('click', () => {
        stopPlayback();
        let prevIdx = currentFrameIdx - 1;
        if (prevIdx < 0) prevIdx = pklotSnapshots.length - 1;
        selectFrame(prevIdx);
    });

    btnNext.addEventListener('click', () => {
        stopPlayback();
        let nextIdx = currentFrameIdx + 1;
        if (nextIdx >= pklotSnapshots.length) nextIdx = 0;
        selectFrame(nextIdx);
    });

    timeline.addEventListener('input', (e) => {
        stopPlayback();
        const index = parseInt(e.target.value);
        selectFrame(index);
    });

    speedSelect.addEventListener('change', () => {
        if (isPlaying) {
            startPlayback(); // Restart with updated latency
        }
    });

    selectEl.addEventListener('change', (e) => {
        stopPlayback();
        const snapshotName = e.target.value;
        if (!snapshotName) {
            imgEl.src = spacerGif;
            svgEl.innerHTML = '';
            metaEl.innerText = 'Wybierz klatkę, aby pobrać metadane przestrzenne.';
            applyBtn.setAttribute('disabled', 'true');
            currentFrameIdx = -1;
            timeline.value = 0;
            frameIndicator.innerText = 'Klatka: -- / --';
            timeCurrent.innerText = 'Godzina: --:--:--';
            if (placeholderEl) {
                placeholderEl.classList.remove('hidden');
            }
            return;
        }
        const index = pklotSnapshots.indexOf(snapshotName);
        if (index >= 0) {
            selectFrame(index);
        }
    });

    applyBtn.addEventListener('click', async () => {
        const snapshotName = selectEl.value;
        if (!snapshotName) return;
        
        applyBtn.setAttribute('disabled', 'true');
        applyBtn.innerText = 'Wymuszanie rejestrów...';
        
        try {
            await applyPKLotFrame(snapshotName);
            
            applyBtn.innerText = 'Zastosowano!';
            applyBtn.classList.remove('btn-primary');
            applyBtn.style.background = 'var(--clr-green)';
            applyBtn.style.color = '#fff';
            
            setTimeout(() => {
                applyBtn.innerText = 'Wymuś stan rejestrów PLC';
                applyBtn.style.background = '';
                applyBtn.style.color = '';
                applyBtn.classList.add('btn-primary');
                applyBtn.removeAttribute('disabled');
            }, 1500);
        } catch (e) {
            console.error('Manual apply PKLot state failed:', e);
            alert('Wystąpił błąd komunikacji z API.');
            applyBtn.innerText = 'Wymuś stan rejestrów PLC';
            applyBtn.removeAttribute('disabled');
        }
    });
}

// ========================= DIAGNOSTICS & SYSTEM LOGS HANDLERS =========================

/**
 * Switches the active panel tab in the HMI dashboard.
 * Triggers rendering routines for specialized tabs (e.g. topology layout).
 * 
 * @param {string} tabId - ID of the target panel container DOM element.
 */
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(element => {
        element.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(element => {
        element.classList.remove('active');
    });
    
    const activeTab = document.getElementById(tabId);
    if (activeTab) activeTab.classList.add('active');
    
    let btnId = 'tab-btn-hmi';
    if (tabId === 'topology-screen') btnId = 'tab-btn-topology';
    else if (tabId === 'logs-screen') btnId = 'tab-btn-logs';
    else if (tabId === 'analytics-screen') btnId = 'tab-btn-analytics';
    else if (tabId === 'ml-screen') btnId = 'tab-btn-ml';
    
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
    

    
    if (tabId === 'topology-screen') {
        setTimeout(drawTopology, 50);
    } else if (tabId === 'analytics-screen') {
        setTimeout(drawAnalyticsCharts, 50);
    } else if (tabId === 'ml-screen') {
        setTimeout(drawMLCharts, 50);
    } else if (tabId === 'hmi-screen') {
        setTimeout(drawTodayForecastChart, 50);
    }
}

/**
 * Updates the network driver settings panel grid based on driver states.
 * 
 * @param {object} drivers - Current states and configurations of system drivers.
 */
function updateDriverConfigPanel(drivers) {
    const grid = document.getElementById('node-cards-grid');
    if (!grid) return;
    
    grid.innerHTML = Object.entries(drivers).map(([id, driverState]) => {
        let badgeClass = 'status-disconnected';
        if (driverState.status === 'CONNECTED') badgeClass = 'status-connected';
        else if (driverState.status === 'CONNECTING') badgeClass = 'status-connecting';
        else if (driverState.status === 'ERROR') badgeClass = 'status-error';
        
        const isVirtual = driverState.mode === 'VIRTUAL' ? 'selected' : '';
        const isReal = driverState.mode === 'REAL' ? 'selected' : '';
        
        return `<div class="node-card" id="node-card-${id}">
            <div class="node-card-header">
                <span class="node-title">${driverState.name}</span>
                <span class="node-status-badge ${badgeClass}">${driverState.status}</span>
            </div>
            <div class="node-settings-form">
                <div class="node-form-group">
                    <label>Nazwa Hosta/COM</label>
                    <input type="text" id="input-${id}-host" class="node-input" value="${driverState.host}">
                </div>
                <div class="node-form-group">
                    <label>Port / Adres</label>
                    <input type="number" id="input-${id}-port" class="node-input" value="${driverState.port}">
                </div>
                <div class="node-form-group">
                    <label>Opóźnienie (ms)</label>
                    <input type="number" id="input-${id}-latency" class="node-input" value="${driverState.latency}">
                </div>
                <div class="node-form-group">
                    <label>Typ Sterowania</label>
                    <select id="select-${id}-mode" class="node-input" onchange="submitDriverConfig('${id}')">
                        <option value="VIRTUAL" ${isVirtual}>WIRTUALNY (SIM)</option>
                        <option value="REAL" ${isReal}>FIZYCZNY (REAL)</option>
                    </select>
                </div>
            </div>
            <div class="node-actions">
                <button onclick="submitDriverConfig('${id}')" class="node-btn">Zapisz</button>
                <button onclick="triggerDriverState('${id}', 'CONNECTING')" class="node-btn">Połącz</button>
                <button onclick="triggerDriverState('${id}', 'DISCONNECTED')" class="node-btn">Rozłącz</button>
                <button onclick="triggerDriverState('${id}', 'ERROR')" class="node-btn node-btn-error">Wymuś Awarię</button>
                <button onclick="triggerDriverState('${id}', 'CONNECTED')" class="node-btn node-btn-reset">Przywróć (OK)</button>
            </div>
        </div>`;
    }).join('');
}

/**
 * Submits the form data for a given driver settings card to the API.
 * 
 * @param {string} driverId - Unique ID of the driver.
 */
async function submitDriverConfig(driverId) {
    const host = document.getElementById(`input-${driverId}-host`).value;
    const port = parseInt(document.getElementById(`input-${driverId}-port`).value) || 0;
    const latency = parseInt(document.getElementById(`input-${driverId}-latency`).value) || 0;
    const mode = document.getElementById(`select-${driverId}-mode`).value;
    
    await sendAction(`/api/drivers/${driverId}/config`, { host, port, latency, mode });
}

/**
 * Sends a manual state override request for a driver to the API.
 * 
 * @param {string} driverId - Unique ID of the driver.
 * @param {string} state - The target status (e.g. CONNECTED, ERROR).
 */
async function triggerDriverState(driverId, state) {
    await sendAction(`/api/drivers/${driverId}/state`, { status: state });
}

/**
 * Requests the backend to clear all system logs.
 */
async function clearSystemLogs() {
    await sendAction('/api/system/logs/clear');
}

/**
 * Updates UI filter buttons and active logging filter state.
 * 
 * @param {string} level - Filter severity level (e.g. 'ALL', 'INFO', 'WARNING', 'ALARM').
 */
function setLogFilterLevel(level) {
    logFilterLevel = level;
    document.querySelectorAll('.filter-level-buttons .filter-btn').forEach(button => {
        button.classList.remove('active');
        if (button.innerText === level) button.classList.add('active');
    });
    applyLogFilters();
}

/**
 * Filter system event logs based on severity, search queries, and selected source filters,
 * then renders them to the system terminal view.
 */
function applyLogFilters() {
    const terminal = document.getElementById('logs-terminal');
    if (!terminal) return;
    
    const searchQuery = document.getElementById('logs-search-input').value.toLowerCase();
    const checkedSources = Array.from(document.querySelectorAll('.source-checkboxes input:checked')).map(checkbox => checkbox.value);
    
    const filteredLogs = systemLogs.filter(logEntry => {
        if (logFilterLevel !== 'ALL' && logEntry.level !== logFilterLevel) return false;
        if (!checkedSources.includes(logEntry.source)) return false;
        if (searchQuery && !logEntry.message.toLowerCase().includes(searchQuery) && !logEntry.source.toLowerCase().includes(searchQuery)) return false;
        return true;
    });
    
    if (filteredLogs.length === 0) {
        terminal.innerHTML = '<div style="color: #555; font-style: italic; padding: 10px; font-family: monospace;">Brak logów systemowych spełniających kryteria...</div>';
        return;
    }
    
    const sourceClassMap = {
        'PLC': 'plc', 'YOLO': 'yolo', 'BAZA_DANYCH': 'db',
        'UPS': 'ups', 'TEMPERATURA': 'temp', 'GDPR': 'gdpr',
        'SYSTEM': 'system', 'UŻYTKOWNIK': 'usr'
    };
    
    terminal.innerHTML = filteredLogs.map(logEntry => {
        const lineClass = `log-line log-line-${logEntry.level.toLowerCase()}`;
        const srcClass = `log-source log-source-${sourceClassMap[logEntry.source] || 'system'}`;
        return `<div class="${lineClass}">
            <span class="log-time">[${logEntry.time}]</span>
            <span class="log-level">${logEntry.level}</span>
            <span class="${srcClass}">${logEntry.source}</span>
            <span class="log-message">${logEntry.message}</span>
        </div>`;
    }).join('');
}

let topologyAnimFrame = null;
let pulseOffset = 0;

/**
 * Draws the network packet tracer topology diagram on the HTML5 Canvas.
 * Computes live links, packet flows, and draws active node cards.
 */
function drawTopology() {
    const canvas = document.getElementById('topology-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    pulseOffset = (pulseOffset + 1.2) % 100;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const drivers = currentDriversState || {};
    const plc = lastPlcState || {
        barrier_grease_level: 100.0,
        fan_health: 100.0,
        fan_run_time: 0,
        barrier_cycles: 0,
        barrier_motor_health: 100.0,
        cabinet_fan: false,
        wjazd_szlaban: false,
        wyjazd_szlaban: false,
        wjazd_sensor: false,
        wyjazd_sensor: false
    };

    // Fetch theme colors dynamically from CSS custom variables
    const style = getComputedStyle(document.body);
    const clrGreen = style.getPropertyValue('--clr-green').trim() || '#2ecc71';
    const clrRed = style.getPropertyValue('--clr-red').trim() || '#e74c3c';
    const clrYellow = style.getPropertyValue('--clr-yellow').trim() || '#f1c40f';
    const clrBlue = style.getPropertyValue('--clr-blue').trim() || '#3498db';
    const clrGray = style.getPropertyValue('--clr-gray').trim() || '#7f8c8d';

    const isLight = document.body.classList.contains('theme-light-high-glare');
    const isTacticalRed = document.body.classList.contains('theme-tactical-red');

    // Helper to resolve node diagnostic metrics, status, color, and host/addresses
    function getNodeState(id) {
        const node = TOPOLOGY_NODES[id];
        let status = 'CONNECTED';
        let valStr = '';
        let color = clrGreen; // Default active green
        let host = '';

        if (id === 'hmi') {
            return { status, valStr, color, host: '192.168.1.1' };
        }

        if (node.driver) {
            const drv = drivers[node.driver] || { status: 'DISCONNECTED', host: '--' };
            status = drv.status;
            host = drv.host || '';
            if (status === 'CONNECTED') color = clrGreen;
            else if (status === 'CONNECTING') color = clrYellow;
            else if (status === 'ERROR') color = clrRed;
            else color = clrGray;
            return { status, valStr, color, host };
        }

        const plcConnected = (drivers['plc'] && drivers['plc'].status === 'CONNECTED');
        const tempConnected = (drivers['temp'] && drivers['temp'].status === 'CONNECTED');
        const yoloConnected = (drivers['yolo'] && drivers['yolo'].status === 'CONNECTED');
        const dbConnected = (drivers['db'] && drivers['db'].status === 'CONNECTED');

        if (id === 'db_geom') {
            status = dbConnected ? 'ACTIVE' : 'OFFLINE';
            color = dbConnected ? clrGreen : clrGray;
        } else if (id === 'cab_fan') {
            if (!plcConnected || !tempConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                const active = plc.cabinet_fan;
                const healthLow = plc.fan_health < 40.0;
                status = active ? 'COOLING' : 'STANDBY';
                color = healthLow ? clrRed : (active ? clrGreen : clrGray);
            }
        } else if (id === 'wjazd_motor') {
            if (!plcConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                const active = plc.wjazd_szlaban;
                const healthLow = plc.barrier_motor_health < 95.0;
                status = active ? 'OPEN/ACTIVE' : 'STANDBY';
                color = healthLow ? clrYellow : (active ? clrGreen : clrGray);
                valStr = `Silnik: ${plc.barrier_motor_health.toFixed(1)}%`;
            }
        } else if (id === 'wyjazd_motor') {
            if (!plcConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                const active = plc.wyjazd_szlaban;
                const healthLow = plc.barrier_motor_health < 95.0;
                status = active ? 'OPEN/ACTIVE' : 'STANDBY';
                color = healthLow ? clrYellow : (active ? clrGreen : clrGray);
                valStr = `Silnik: ${plc.barrier_motor_health.toFixed(1)}%`;
            }
        } else if (id === 'loops') {
            if (!plcConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                const active = (plc.wjazd_sensor || plc.wyjazd_sensor);
                status = active ? 'DETEKCJA' : 'MONITORING';
                color = active ? clrGreen : clrGray;
            }
        } else if (id === 'grease') {
            if (!plcConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                const val = plc.barrier_grease_level;
                valStr = `Smar: ${val.toFixed(1)}%`;
                if (val < 40.0) {
                    status = 'CRITICAL';
                    color = clrRed;
                } else if (val < 70.0) {
                    status = 'LOW';
                    color = clrYellow;
                } else {
                    status = 'OK';
                    color = clrBlue;
                }
            }
        } else if (id === 'fan_health') {
            if (!plcConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                const val = plc.fan_health;
                valStr = `Stan: ${val.toFixed(1)}%`;
                if (val < 40.0) {
                    status = 'CRITICAL';
                    color = clrRed;
                } else if (val < 75.0) {
                    status = 'DEGRADED';
                    color = clrYellow;
                } else {
                    status = 'OK';
                    color = clrGreen;
                }
            }
        } else if (id === 'fan_time') {
            if (!plcConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                const val = plc.fan_run_time || 0;
                valStr = `Czas: ${val}s`;
                status = 'OK';
                color = clrGreen;
            }
        } else if (id === 'iou_calc') {
            if (!yoloConnected) {
                status = 'OFFLINE';
                color = clrGray;
            } else {
                status = 'ACTIVE';
                color = clrGreen;
                valStr = 'IoU > 0.3';
            }
        } else {
            if (node.parent) {
                const parentState = getNodeState(node.parent);
                status = parentState.status;
                color = parentState.color;
            }
        }

        return { status, valStr, color, host };
    }

    // 1. Draw Wires (Cables) between parents and children
    Object.entries(TOPOLOGY_NODES).forEach(([id, node]) => {
        if (!node.parent) return; // Skip HMI root (no parent)
        
        const parentNode = TOPOLOGY_NODES[node.parent];
        if (!parentNode) return;
        
        const state = getNodeState(id);
        
        ctx.beginPath();
        ctx.moveTo(parentNode.x, parentNode.y);
        ctx.lineTo(node.x, node.y);
        
        // Cable styling
        if (state.color === clrGray) {
            ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(136, 136, 136, 0.15)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
        } else if (state.status === 'CONNECTING') {
            ctx.strokeStyle = hexToRGBA(clrYellow, 0.4);
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 5]);
        } else if (state.status === 'ERROR' || state.status === 'CRITICAL') {
            ctx.strokeStyle = hexToRGBA(clrRed, 0.5);
            ctx.lineWidth = 2.5;
            ctx.setLineDash([3, 3]);
        } else {
            ctx.strokeStyle = hexToRGBA(state.color, isLight ? 0.5 : 0.3);
            ctx.lineWidth = 2.5;
            ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]); // Reset
        
        // Moving particles along active cables
        const isActive = (state.color !== clrGray && state.color !== '#95a5a6' && state.status !== 'OFFLINE' && state.status !== 'DISCONNECTED');
        if (isActive && state.status !== 'CONNECTING' && state.status !== 'ERROR') {
            const steps = 3;
            for (let i = 0; i < steps; i++) {
                const ratio = ((pulseOffset / 100) + (i / steps)) % 1.0;
                const px = parentNode.x + (node.x - parentNode.x) * ratio;
                const py = parentNode.y + (node.y - parentNode.y) * ratio;
                
                ctx.beginPath();
                ctx.arc(px, py, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = state.color || clrGreen;
                ctx.shadowBlur = (isTacticalRed || isLight) ? 0 : 6;
                ctx.shadowColor = state.color || clrGreen;
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        } else if (state.status === 'ERROR' || state.status === 'CRITICAL') {
            // Draw warning label/symbol in middle of connection cable
            const mx = (node.x + parentNode.x) / 2;
            const my = (node.y + parentNode.y) / 2;
            ctx.beginPath();
            ctx.arc(mx, my, 7, 0, Math.PI * 2);
            ctx.fillStyle = clrRed;
            ctx.fill();
            ctx.font = '8px Share Tech';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('!', mx, my);
        }
    });

    // 2. Draw Satellite Nodes
    Object.entries(TOPOLOGY_NODES).forEach(([id, node]) => {
        const state = getNodeState(id);
        const radius = id === 'hmi' ? 26 : 20;
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isLight ? '#ffffff' : '#181818';
        
        // Border styles and states
        ctx.strokeStyle = state.color;
        ctx.lineWidth = id === 'hmi' ? 3.5 : 2.5;
        
        if (!isTacticalRed && !isLight) {
            if (state.status === 'ERROR' || state.status === 'CRITICAL') {
                ctx.shadowBlur = 10;
                ctx.shadowColor = clrRed;
            } else if (state.status === 'LOW' || state.status === 'DEGRADED') {
                ctx.shadowBlur = 8;
                ctx.shadowColor = clrYellow;
            } else if (state.status === 'COOLING' || state.status === 'OPEN/ACTIVE' || state.status === 'DETEKCJA') {
                ctx.shadowBlur = 8;
                ctx.shadowColor = clrGreen;
            }
        }
        
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow
        
        // Draw emoji icon
        ctx.font = id === 'hmi' ? '15px Outfit' : '13px Outfit';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.icon, node.x, node.y + (id === 'hmi' ? 0 : 1));
        
        // Label
        ctx.font = '10px Share Tech';
        ctx.fillStyle = isLight ? '#121212' : '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, node.x, node.y + radius + 4);
        
        // Sub-text indicators (wear rates, grease levels, states)
        ctx.font = '8px JetBrains Mono';
        if (state.valStr !== '') {
            ctx.fillStyle = state.color;
            ctx.fillText(state.valStr, node.x, node.y + radius + 15);
        } else if (state.host !== '') {
            ctx.fillStyle = 'var(--text-secondary)';
            ctx.fillText(state.host, node.x, node.y + radius + 15);
        } else if (id !== 'hmi') {
            ctx.fillStyle = 'var(--text-secondary)';
            ctx.fillText(state.status, node.x, node.y + radius + 15);
        }
    });

    const topologyScreen = document.getElementById('topology-screen');
    if (topologyScreen && topologyScreen.classList.contains('active')) {
        topologyAnimFrame = requestAnimationFrame(drawTopology);
    } else {
        cancelAnimationFrame(topologyAnimFrame);
    }
}

/**
 * Draws all charts inside the analytics dashboard.
 */
function drawAnalyticsCharts() {
    const style = getComputedStyle(document.body);
    const clrYellow = style.getPropertyValue('--clr-yellow').trim() || '#f1c40f';
    const clrBlue = style.getPropertyValue('--clr-blue').trim() || '#3498db';
    const clrGreen = style.getPropertyValue('--clr-green').trim() || '#2ecc71';

    // Temperature: scale min 20, max 30
    drawSingleChart('chart-temp', tempHistory, timeHistory, clrYellow, 20, 30);
    // UPS Level: scale min 0, max 100
    drawSingleChart('chart-ups', upsHistory, timeHistory, clrBlue, 0, 100);
    // Occupancy: scale min 0, max 100
    drawSingleChart('chart-occupancy', occupancyHistory, timeHistory, clrGreen, 0, 100);
}

/**
 * Helper to draw a single custom tactical rolling canvas line chart.
 * Zero external libraries, highly responsive, supports error states.
 */
function drawSingleChart(canvasId, data, timeData, color, minVal, maxVal) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    
    // Resolve computed style colors from the current theme variables
    const style = getComputedStyle(document.body);
    const bgCard = style.getPropertyValue('--bg-card').trim() || '#1c1c1c';
    const borderCol = style.getPropertyValue('--border-color').trim() || '#2a2a2a';
    const textSec = style.getPropertyValue('--text-secondary').trim() || '#888888';
    
    const isLight = document.body.classList.contains('theme-light-high-glare');
    const isTacticalRed = document.body.classList.contains('theme-tactical-red');
    
    // Clear background
    ctx.fillStyle = bgCard;
    ctx.fillRect(0, 0, width, height);
    
    // Draw cyber grid
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : (isTacticalRed ? 'rgba(80, 10, 10, 0.4)' : 'rgba(42, 42, 42, 0.4)');
    ctx.lineWidth = 1;
    const gridCols = 8;
    const gridRows = 5;
    
    for (let i = 1; i < gridCols; i++) {
        const x = (width / gridCols) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    
    for (let i = 1; i < gridRows; i++) {
        const y = (height / gridRows) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    
    // If PLC offline or no drivers data, draw error message
    if (!data || data.length === 0 || lastPlcState === null) {
        ctx.fillStyle = isLight ? '#a82c1f' : '#e74c3c';
        ctx.font = '700 13px "Share Tech", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BRAK TRANSMISJI DANYCH / STEROWNIK OFFLINE', width / 2, height / 2);
        return;
    }
    
    const paddingLeft = 40;
    const paddingRight = 15;
    const paddingTop = 20;
    const paddingBottom = 25;
    
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;
    
    // Determine min/max values
    let actualMin = minVal;
    let actualMax = maxVal;
    
    const validValues = data.filter(v => v !== -99.9 && v !== -1.0);
    if (validValues.length > 0) {
        if (actualMin === undefined) actualMin = Math.min(...validValues) - 2;
        if (actualMax === undefined) actualMax = Math.max(...validValues) + 2;
    } else {
        actualMin = 0;
        actualMax = 100;
    }
    
    if (actualMin === actualMax) {
        actualMin -= 10;
        actualMax += 10;
    }
    
    const range = actualMax - actualMin;
    
    // Draw Y labels
    ctx.fillStyle = textSec;
    ctx.font = '10px "Share Tech", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    const tickStroke = isLight ? 'rgba(0, 0, 0, 0.15)' : (isTacticalRed ? 'rgba(255, 51, 51, 0.15)' : '#333333');
    for (let i = 0; i <= 4; i++) {
        const val = actualMin + (range / 4) * i;
        const y = paddingTop + chartHeight - (chartHeight / 4) * i;
        ctx.fillText(val.toFixed(1), paddingLeft - 8, y);
        
        ctx.strokeStyle = tickStroke;
        ctx.beginPath();
        ctx.moveTo(paddingLeft - 4, y);
        ctx.lineTo(paddingLeft, y);
        ctx.stroke();
    }
    
    // Coordinates mapping
    const points = [];
    const stepX = chartWidth / (MAX_HISTORY_POINTS - 1);
    const offsetPoints = MAX_HISTORY_POINTS - data.length;
    
    for (let i = 0; i < data.length; i++) {
        const val = data[i];
        if (val === -99.9 || val === -1.0) {
            points.push(null);
            continue;
        }
        
        const x = paddingLeft + (i + offsetPoints) * stepX;
        const y = paddingTop + chartHeight - ((val - actualMin) / range) * chartHeight;
        points.push({ x, y, val });
    }
    
    // Draw gradient fill under the line
    if (points.length > 1) {
        ctx.beginPath();
        let first = true;
        let lastX = paddingLeft;
        
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (p) {
                if (first) {
                    ctx.moveTo(p.x, paddingTop + chartHeight);
                    ctx.lineTo(p.x, p.y);
                    first = false;
                } else {
                    ctx.lineTo(p.x, p.y);
                }
                lastX = p.x;
            }
        }
        
        if (!first) {
            ctx.lineTo(lastX, paddingTop + chartHeight);
            ctx.closePath();
            
            const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight);
            gradient.addColorStop(0, hexToRGBA(color, isTacticalRed ? 0.05 : 0.15));
            gradient.addColorStop(1, hexToRGBA(color, 0.0));
            ctx.fillStyle = gradient;
            ctx.fill();
        }
    }
    
    // Draw main line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    // Strictly eliminate decorative glowing for night vision red theme
    ctx.shadowBlur = (isTacticalRed || isLight) ? 0 : 5;
    ctx.shadowColor = color;
    
    ctx.beginPath();
    let isDrawing = false;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p) {
            if (!isDrawing) {
                ctx.moveTo(p.x, p.y);
                isDrawing = true;
            } else {
                ctx.lineTo(p.x, p.y);
            }
        } else {
            if (isDrawing) {
                ctx.stroke();
                isDrawing = false;
            }
        }
    }
    if (isDrawing) {
        ctx.stroke();
    }
    
    ctx.shadowBlur = 0; // Reset shadow
    
    // Draw X labels (timestamps)
    ctx.fillStyle = textSec;
    ctx.font = '9px "Share Tech", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    const labelStep = 10;
    for (let i = 0; i < timeData.length; i += labelStep) {
        if (i + offsetPoints >= MAX_HISTORY_POINTS) continue;
        const x = paddingLeft + (i + offsetPoints) * stepX;
        const t = timeData[i];
        ctx.fillText(t, x, paddingTop + chartHeight + 6);
        
        ctx.strokeStyle = tickStroke;
        ctx.beginPath();
        ctx.moveTo(x, paddingTop + chartHeight);
        ctx.lineTo(x, paddingTop + chartHeight + 4);
        ctx.stroke();
    }
    
    // Border outline
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1;
    ctx.strokeRect(paddingLeft, paddingTop, chartWidth, chartHeight);
    
    // Draw last pulsing point
    const lastValidPoint = [...points].reverse().find(p => p !== null);
    if (lastValidPoint) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(lastValidPoint.x, lastValidPoint.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const pulse = 4 + (Date.now() % 1000) / 180;
        ctx.arc(lastValidPoint.x, lastValidPoint.y, pulse, 0, 2 * Math.PI);
        ctx.stroke();
    }
}

/**
 * Converts hex color strings to rgba strings.
 */
function hexToRGBA(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Window resize handler to redraw active canvas grids
window.addEventListener('resize', () => {
    const topologyScreen = document.getElementById('topology-screen');
    if (topologyScreen && topologyScreen.classList.contains('active')) {
        drawTopology();
    }
    const analyticsScreen = document.getElementById('analytics-screen');
    if (analyticsScreen && analyticsScreen.classList.contains('active')) {
        drawAnalyticsCharts();
    }
    const mlScreen = document.getElementById('ml-screen');
    if (mlScreen && mlScreen.classList.contains('active')) {
        drawMLCharts();
    }
    const hmiScreen = document.getElementById('hmi-screen');
    if (hmiScreen && hmiScreen.classList.contains('active')) {
        drawTodayForecastChart();
    }
});

// ========================= ML CHARTS DRAWER & RENDERERS =========================

async function drawMLCharts() {
    const forecastCanvas = document.getElementById('chart-ml-forecast');
    const historyCanvas = document.getElementById('chart-ml-history');
    if (!forecastCanvas || !historyCanvas) return;
    
    // Resolve current parameters based on the system time or current frame metadata
    let hour = new Date().getHours() + new Date().getMinutes() / 60.0;
    let isWeekend = [0, 6].includes(new Date().getDay());
    let weather = 'sunny';
    
    if (currentFrameIdx >= 0 && currentFrameIdx < pklotSnapshots.length) {
        const snap = pklotSnapshots[currentFrameIdx];
        const parts = snap.split('/');
        if (parts.length >= 3) {
            weather = parts[0];
            const dateStr = parts[1];
            const dateObj = new Date(dateStr);
            isWeekend = [0, 6].includes(dateObj.getDay());
            
            const filename = parts[2];
            const fnParts = filename.split('_');
            if (fnParts.length >= 4) {
                hour = parseInt(fnParts[1]) + parseInt(fnParts[2]) / 60.0;
            }
        }
    }
    
    const methodSelect = document.getElementById('ml-forecast-method');
    const method = methodSelect ? methodSelect.value : 'regression';
    
    try {
        // Fetch history stats
        const histRes = await fetch('/api/ml/history');
        const histData = await histRes.json();
        
        // Fetch predictions
        const foreRes = await fetch(`/api/ml/forecast?hour=${hour}&is_weekend=${isWeekend}&weather=${weather}&method=${method}`);
        const foreData = await foreRes.json();
        
        // Update telemetry UI
        const statusEl = document.getElementById('ml-status');
        const sampleEl = document.getElementById('ml-sample-size');
        const mseEl = document.getElementById('ml-mse');
        const wSunnyEl = document.getElementById('ml-weight-sunny');
        const wRainyEl = document.getElementById('ml-weight-rainy');
        const wWeekendEl = document.getElementById('ml-weight-weekend');
        const insightsList = document.getElementById('ml-insights-list');
        
        if (histData.is_trained) {
            if (statusEl) {
                statusEl.innerText = 'WYSZKOLONY';
                statusEl.className = 'telemetry-value text-green';
            }
            if (sampleEl) sampleEl.innerText = `${histData.total_samples} klatek`;
            if (mseEl) mseEl.innerText = histData.mse.toFixed(5);
            
            const w = histData.weights;
            if (wSunnyEl) wSunnyEl.innerText = (w[2] >= 0 ? '+' : '') + (w[2] * 100).toFixed(1) + '%';
            if (wRainyEl) wRainyEl.innerText = (w[3] >= 0 ? '+' : '') + (w[3] * 100).toFixed(1) + '%';
            if (wWeekendEl) wWeekendEl.innerText = (w[4] >= 0 ? '+' : '') + (w[4] * 100).toFixed(1) + '%';
            
            // Build insights list dynamically
            if (insightsList) {
                let html = `<li>Model regresji zakończył trening na bazie <b>${histData.total_samples}</b> klatek datasetu PKLot.</li>`;
                html += `<li>Średni błąd kwadratowy (MSE) wynosi <b>${histData.mse.toFixed(5)}</b>, co świadczy o wysokiej stabilności prognozy.</li>`;
                
                if (w[2] > 0) {
                    html += `<li><b>Pogoda słoneczna</b> wykazuje pozytywny wpływ <b>(+${(w[2]*100).toFixed(1)}%)</b> na zajętość (zwiększony ruch rekreacyjny).</li>`;
                } else {
                    html += `<li><b>Pogoda słoneczna</b> wykazuje negatywny wpływ <b>(${(w[2]*100).toFixed(1)}%)</b>.</li>`;
                }
                
                if (w[3] < 0) {
                    html += `<li><b>Opady deszczu</b> redukują zapotrzebowanie średnio o <b>${Math.abs(w[3]*100).toFixed(1)}%</b>.</li>`;
                } else {
                    html += `<li><b>Opady deszczu</b> wykazują nieznaczną pozytywną korelację <b>(+${(w[3]*100).toFixed(1)}%)</b>.</li>`;
                }
                
                if (w[4] < 0) {
                    html += `<li><b>Weekend</b> redukuje średnie obłożenie o <b>${Math.abs(w[4]*100).toFixed(1)}%</b> (brak ruchu biurowego/biznesowego).</li>`;
                } else {
                    html += `<li><b>Weekend</b> wykazuje wzrost obłożenia o <b>+${(w[4]*100).toFixed(1)}%</b>.</li>`;
                }
                
                insightsList.innerHTML = html;
            }
        } else {
            if (statusEl) {
                statusEl.innerText = 'TRENOWANIE...';
                statusEl.className = 'telemetry-value text-yellow';
            }
        }
        
        // Draw History Chart
        drawMLHistoryChart(historyCanvas, histData.hourly_avg);
        
        // Draw Forecast Chart
        drawMLForecastChart(forecastCanvas, foreData.predictions, hour);
        
        // Also update today's synoptic forecast chart
        drawTodayForecastChart();
        
    } catch (e) {
        console.error("Failed to load and draw ML Charts:", e);
    }
}

function drawMLHistoryChart(canvas, hourlyAvg) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    
    // Background and theme colors
    const style = getComputedStyle(document.body);
    const bgCard = style.getPropertyValue('--bg-card').trim() || '#1c1c1c';
    const textSec = style.getPropertyValue('--text-secondary').trim() || '#888888';
    const clrBlue = style.getPropertyValue('--clr-blue').trim() || '#3498db';
    
    ctx.fillStyle = bgCard;
    ctx.fillRect(0, 0, w, h);
    
    // Draw cyber grid
    ctx.strokeStyle = 'rgba(52, 152, 219, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
        const y = (h / 6) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
        const x = (w / 8) * i;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    
    const padL = 40; const padR = 20; const padT = 20; const padB = 30;
    const cW = w - padL - padR; const cH = h - padT - padB;
    
    // Draw line
    ctx.strokeStyle = clrBlue;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = clrBlue;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    
    for (let i = 0; i < 24; i++) {
        const x = padL + (i / 23) * cW;
        const val = hourlyAvg[i] * 100;
        const y = padT + cH - (val / 100) * cH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0; // reset shadow
    
    // Draw Y axis labels
    ctx.fillStyle = textSec;
    ctx.font = '10px "Share Tech", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
        const val = i * 25;
        const y = padT + cH - (i / 4) * cH;
        ctx.fillText(val + '%', padL - 8, y);
    }
    
    // Draw X axis labels (Hours)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xLabels = ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "23:00"];
    const xLabelIndices = [0, 4, 8, 12, 16, 20, 23];
    for (let i = 0; i < xLabels.length; i++) {
        const idx = xLabelIndices[i];
        const x = padL + (idx / 23) * cW;
        ctx.fillText(xLabels[i], x, padT + cH + 8);
    }
}

function drawMLForecastChart(canvas, predictions, startHour) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const w = rect.width;
    const h = rect.height;
    
    const style = getComputedStyle(document.body);
    const bgCard = style.getPropertyValue('--bg-card').trim() || '#1c1c1c';
    const textSec = style.getPropertyValue('--text-secondary').trim() || '#888888';
    const clrYellow = style.getPropertyValue('--clr-yellow').trim() || '#f1c40f';
    const clrGreen = style.getPropertyValue('--clr-green').trim() || '#2ecc71';
    
    ctx.fillStyle = bgCard;
    ctx.fillRect(0, 0, w, h);
    
    // Draw cyber grid
    ctx.strokeStyle = 'rgba(241, 196, 15, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
        const y = (h / 6) * i;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
        const x = (w / 8) * i;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    
    const padL = 40; const padR = 20; const padT = 20; const padB = 30;
    const cW = w - padL - padR; const cH = h - padT - padB;
    
    // Draw predicted line (dashed)
    ctx.strokeStyle = clrYellow;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 5]);
    ctx.shadowColor = clrYellow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    
    for (let i = 0; i < 24; i++) {
        const x = padL + (i / 23) * cW;
        const val = predictions[i] * 100;
        const y = padT + cH - (val / 100) * cH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash
    ctx.shadowBlur = 0;
    
    // Draw actual current starting dot
    if (predictions.length > 0) {
        const currentOccupancy = lastPlcState ? ((lastPlcState.total_spots - lastPlcState.available_spots) / lastPlcState.total_spots) * 100 : predictions[0] * 100;
        const startX = padL;
        const startY = padT + cH - (currentOccupancy / 100) * cH;
        
        ctx.fillStyle = clrGreen;
        ctx.beginPath();
        ctx.arc(startX, startY, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    
    // Draw Y axis labels
    ctx.fillStyle = textSec;
    ctx.font = '10px "Share Tech", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
        const val = i * 25;
        const y = padT + cH - (i / 4) * cH;
        ctx.fillText(val + '%', padL - 8, y);
    }
    
    // Draw X axis labels (+0h, +4h, +8h, etc)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 6; i++) {
        const hOffset = i * 4;
        const idx = Math.min(23, hOffset);
        const x = padL + (idx / 23) * cW;
        const targetHour = Math.round((startHour + hOffset) % 24);
        ctx.fillText(`+${hOffset}h (${targetHour}:00)`, x, padT + cH + 8);
    }
}


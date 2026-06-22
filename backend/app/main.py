import os
import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, BackgroundTasks
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import select

from backend.app.plc_simulator import PLCSimulator
from backend.app.db.session import AsyncSessionLocal
from backend.app.db.models import ParkingSpace, OccupancyHistory, SpaceStatus
from backend.app.hardware_drivers import driver_manager
from backend.app.ml_forecaster import MLForecaster

import sys

# Dynamic directory paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

if getattr(sys, 'frozen', False):
    # PyInstaller temp folder
    MEIPASS_DIR = getattr(sys, '_MEIPASS', BASE_DIR)
    TEMPLATES_DIR = os.path.join(MEIPASS_DIR, "backend", "app", "templates")
    STATIC_DIR = os.path.join(MEIPASS_DIR, "backend", "app", "static")
else:
    TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
    STATIC_DIR = os.path.join(BASE_DIR, "static")

# Ensure folders exist
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)


app = FastAPI(title="Smart Parking PLC HMI Server")

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Global PLC Simulator Instance
plc = PLCSimulator()

# Fallback memory representation of spaces in case DB is offline/empty (28 spaces for PKLot)
MOCK_SPACES = {f"A-{i}": "FREE" for i in range(1, 29)}
# Mark A-27 and A-28 as disabled spots
MOCK_SPACES["A-27"] = "DISABLED"
MOCK_SPACES["A-28"] = "DISABLED"

# In-memory tracking of current space states (synced with DB on boot/updates)
current_spaces_cache = MOCK_SPACES.copy()

class ConnectionManager:
    """
    Manages active WebSocket connections to broadcast system telemetry to HMI clients.
    """
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        """Accepts a WebSocket connection and registers it."""
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        """Unregisters a WebSocket connection."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Broadcasts a JSON message to all connected HMI clients."""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

# DB status check helper
def is_db_connected() -> bool:
    """Checks if the database driver status is CONNECTED."""
    try:
        return driver_manager.get_drivers()["db"]["status"] == "CONNECTED"
    except Exception:
        return False

manager = ConnectionManager()

async def sync_spaces_with_db():
    """
    Tries to read parking spaces from database.
    Falls back to MOCK_SPACES if DB is offline or empty.
    """
    global current_spaces_cache
    if not is_db_connected():
        print("Database is configured as offline. Using mock data.")
        return
    try:
        async with AsyncSessionLocal() as session:
            db_result = await session.execute(select(ParkingSpace))
            db_spaces = db_result.scalars().all()
            if db_spaces:
                for space in db_spaces:
                    current_spaces_cache[space.space_code] = space.status.value
            else:
                print("Database is empty. Using mock data.")
    except Exception as e:
        print(f"Database sync failed ({e}). Running in mock mode.")
        driver_manager.set_status("db", "ERROR")

async def update_space_in_db_or_cache(space_code: str, new_status: str, iou_val: float = 0.0):
    """
    Updates a parking space status in DB if accessible, and always updates the local cache.
    Logs changes to occupancy history.
    """
    global current_spaces_cache
    current_spaces_cache[space_code] = new_status
    
    if not is_db_connected():
        return
    
    try:
        async with AsyncSessionLocal() as session:
            async with session.begin():
                db_result = await session.execute(
                    select(ParkingSpace).where(ParkingSpace.space_code == space_code)
                )
                parking_space = db_result.scalars().first()
                if parking_space:
                    status_enum_value = SpaceStatus[new_status]
                    parking_space.status = status_enum_value
                    
                    occupancy_history_entry = OccupancyHistory(
                        parking_space_id=parking_space.id,
                        status=status_enum_value,
                        iou_value=iou_val,
                        timestamp=datetime.utcnow()
                    )
                    session.add(occupancy_history_entry)
                    print(f"Updated DB: Space {space_code} -> {new_status}")
    except Exception as e:
        print(f"DB update failed for {space_code} ({e}). Disabling further DB writes.")
        driver_manager.set_status("db", "ERROR")

def get_current_telemetry():
    """
    Formats the current state of PLC registers, spot caches, driver states,
    and system event logs into a telemetry payload for WebSocket broadcast.
    """
    return {
        "plc": plc.get_registers(),
        "spaces": current_spaces_cache,
        "drivers": driver_manager.get_drivers(),
        "logs": driver_manager.get_logs()[:60],
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }

def verify_system_connected(
    require_plc: bool = True, 
    require_yolo: bool = True, 
    require_db: bool = False,
    require_gdpr: bool = False,
    require_homography: bool = False
):
    """
    Validates driver connection statuses before executing simulations.
    Raises HTTPException if a required driver is offline.
    """
    driver_states = driver_manager.get_drivers()
    if require_plc and driver_states["plc"]["status"] != "CONNECTED":
        raise HTTPException(status_code=400, detail="Brak komunikacji ze sterownikiem PLC (%MW10).")
    if require_yolo and driver_states["yolo"]["status"] != "CONNECTED":
        raise HTTPException(status_code=400, detail="Brak komunikacji z silnikiem YOLO Vision.")
    if require_db and driver_states["db"]["status"] != "CONNECTED":
        raise HTTPException(status_code=400, detail="Brak komunikacji z bazą danych PostGIS.")
    if require_gdpr and driver_states["gdpr"]["status"] != "CONNECTED":
        raise HTTPException(status_code=400, detail="Blokada RODO: Awaria filtra anonimizacji strumienia wideo (GDPR Blur offline).")
    if require_homography and driver_states["homography"]["status"] != "CONNECTED":
        raise HTTPException(status_code=400, detail="Błąd kalibracji homografii: Nie można wyznaczyć współczynnika IoU.")

async def notify_clients():
    """Broadcasts current telemetry states to all connected WebSockets."""
    await manager.broadcast(get_current_telemetry())

@app.on_event("startup")
async def startup_event():
    """FastAPI startup handler to load db/mock states and initialize PLC outputs."""
    await sync_spaces_with_db()
    plc.update_outputs(current_spaces_cache)
    
    # Start ML dataset scan and training in background
    async def run_ml_training():
        forecaster.scan_dataset()
    asyncio.create_task(run_ml_training())

@app.get("/")
async def get_index():
    """Serves the main HMI dashboard page."""
    index_path = os.path.join(TEMPLATES_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h3>index.html not found under templates directory</h3>", status_code=404)

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint to establish persistent HMI telemetry subscription."""
    await manager.connect(websocket)
    await websocket.send_json(get_current_telemetry())
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ----------------- SIMULATION API ENDPOINTS -----------------

async def simulate_car_entry_flow():
    """Simulates physical entry sequence (inductive loop, barrier open, car pass, barrier close)."""
    await asyncio.sleep(2.5)  # Simulating car driving through the barrier
    
    plc.wjazd_sensor = False
    
    # Park the car in the first available spot (skipping disabled spaces A-27 and A-28 first)
    target_space_code = None
    for space_code, status in current_spaces_cache.items():
        if space_code not in ("A-27", "A-28") and status == "FREE":
            target_space_code = space_code
            break
            
    if not target_space_code:
        for space_code in ("A-27", "A-28"):
            if current_spaces_cache.get(space_code) == "FREE":
                target_space_code = space_code
                break
         
    if target_space_code:
        # Simulate IoU rising to 85% as car parks
        await update_space_in_db_or_cache(target_space_code, "OCCUPIED", iou_val=0.85)
        
    plc.update_outputs(current_spaces_cache)
    await notify_clients()

async def simulate_car_exit_flow():
    """Simulates physical exit sequence (inductive loop, barrier open, car pass, barrier close)."""
    await asyncio.sleep(2.5)  # Simulating car driving through
    
    plc.wyjazd_sensor = False
    
    # Free up one occupied spot
    target_space_code = None
    for space_code, status in current_spaces_cache.items():
        if status == "OCCUPIED":
            target_space_code = space_code
            break
            
    if target_space_code:
        new_status = "FREE"
        if target_space_code in ("A-27", "A-28"):
            new_status = "DISABLED"  # Reset back to disabled sign
        await update_space_in_db_or_cache(target_space_code, new_status, iou_val=0.0)
        
    plc.update_outputs(current_spaces_cache)
    await notify_clients()

@app.post("/api/simulate/car-enter")
async def car_enter(background_tasks: BackgroundTasks):
    """Triggers the automated entry sequence (raises wjazd barrier if AUTO mode active and spaces free)."""
    verify_system_connected(require_plc=True, require_yolo=True)
    
    if not plc.auto_mode:
        raise HTTPException(status_code=400, detail="Sterownik w trybie MANUAL. Wjazd automatyczny zablokowany.")
        
    if plc.available_spots <= 0:
        raise HTTPException(status_code=400, detail="PARKING PEŁNY — brak wolnych stanowisk. Szlaban zablokowany.")
        
    # Aktywacja czujnika pętli indukcyjnej wjazdowej (%I0.0)
    plc.wjazd_sensor = True
    plc.total_entries += 1
    driver_manager.log_event("INFO", "PLC", "Czujnik pętli wjazdowej %I0.0: DETEKCJA AKTYWNA. Podnoszenie szlabanu %Q0.0.")
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    
    # Uruchomienie sekwencji przejazdu w tle
    background_tasks.add_task(simulate_car_entry_flow)
    return {"status": "success", "message": "Emulacja wjazdu. Szlaban wjazdowy PODNIESIONY."}

@app.post("/api/simulate/car-exit")
async def car_exit(background_tasks: BackgroundTasks):
    """Triggers the automated exit sequence (raises wyjazd barrier if AUTO mode active and cars exist)."""
    verify_system_connected(require_plc=True, require_yolo=True)
    
    if not plc.auto_mode:
        raise HTTPException(status_code=400, detail="Sterownik w trybie MANUAL. Wyjazd automatyczny zablokowany.")
        
    # Sprawdzenie czy są zaparkowane pojazdy
    occupied_count = sum(1 for status in current_spaces_cache.values() if status == "OCCUPIED")
    if occupied_count <= 0:
        raise HTTPException(status_code=400, detail="Brak zaparkowanych pojazdów do wyjazdu.")
        
    # Aktywacja czujnika pętli indukcyjnej wyjazdowej (%I0.1)
    plc.wyjazd_sensor = True
    plc.total_exits += 1
    driver_manager.log_event("INFO", "PLC", "Czujnik pętli wyjazdowej %I0.1: DETEKCJA AKTYWNA. Podnoszenie szlabanu %Q0.1.")
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    
    # Uruchomienie sekwencji przejazdu w tle
    background_tasks.add_task(simulate_car_exit_flow)
    return {"status": "success", "message": "Emulacja wyjazdu. Szlaban wyjazdowy PODNIESIONY."}

@app.post("/api/simulate/toggle-space/{space_code}")
async def toggle_space(space_code: str):
    """Simulates a manual space state change detected by YOLO vision."""
    verify_system_connected(require_plc=True, require_yolo=True, require_homography=True)
    
    if space_code not in current_spaces_cache:
        raise HTTPException(status_code=404, detail="Stanowisko nie znalezione")
        
    curr_status = current_spaces_cache[space_code]
    if curr_status == "OCCUPIED":
        # Stanowiska rezerwowane (♿) wracają do DISABLED, reszta do FREE
        if space_code in ("A-27", "A-28"):
            new_status = "DISABLED"
        else:
            new_status = "FREE"
        await update_space_in_db_or_cache(space_code, new_status, iou_val=0.0)
        driver_manager.log_event("INFO", "YOLO", f"Detekcja YOLO stanowiska {space_code}: WOLNE (IoU = 0.0)")
    else:
        await update_space_in_db_or_cache(space_code, "OCCUPIED", iou_val=0.92)
        driver_manager.log_event("INFO", "YOLO", f"Detekcja YOLO stanowiska {space_code}: ZAJĘTE (IoU = 0.92)")
        
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    return {"status": "success", "space": space_code, "new_status": current_spaces_cache[space_code]}

@app.post("/api/simulate/mode")
async def toggle_plc_mode():
    """Toggles PLC operational mode between AUTO (%M0.0=True) and MANUAL (%M0.0=False)."""
    verify_system_connected(require_plc=True, require_yolo=False)
    
    plc.auto_mode = not plc.auto_mode
    # Reset sensors on mode change
    plc.wjazd_sensor = False
    plc.wyjazd_sensor = False
    driver_manager.log_event("INFO", "PLC", f"Zmiana trybu pracy sterownika %M0.0 na: {'AUTO' if plc.auto_mode else 'MANUAL'}")
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    return {"status": "success", "auto_mode": plc.auto_mode}

class ManualOverrideRequest(BaseModel):
    barrier: str  # 'wjazd' or 'wyjazd'
    open_state: bool

@app.post("/api/simulate/override")
async def manual_override(override_request: ManualOverrideRequest):
    """Allows manual control of barrier coils (%Q0.0, %Q0.1) in MANUAL mode."""
    verify_system_connected(require_plc=True, require_yolo=False)
    
    if plc.auto_mode:
        raise HTTPException(status_code=400, detail="Cannot override barriers in AUTO mode.")
        
    if override_request.barrier == "wjazd":
        plc.override_wjazd_szlaban = override_request.open_state
        driver_manager.log_event("WARNING", "PLC", f"Ręczne wymuszenie cewki %Q0.0 (wjazd): {'PODNIEŚ' if override_request.open_state else 'OPUŚĆ'}")
    elif override_request.barrier == "wyjazd":
        plc.override_wyjazd_szlaban = override_request.open_state
        driver_manager.log_event("WARNING", "PLC", f"Ręczne wymuszenie cewki %Q0.1 (wyjazd): {'PODNIEŚ' if override_request.open_state else 'OPUŚĆ'}")
    else:
        raise HTTPException(status_code=400, detail="Invalid barrier parameter. Must be 'wjazd' or 'wyjazd'.")
        
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    return {"status": "success", "barrier": override_request.barrier, "open_state": override_request.open_state}

def resolve_pklot_root():
    exe_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else BASE_DIR
    candidates = [
        os.path.abspath(os.path.join(BASE_DIR, "..", "..", "PKLot", "parking1a")),
        os.path.abspath(os.path.join(exe_dir, "..", "..", "..", "..", "PKLot", "parking1a")),
        os.path.abspath(os.path.join(exe_dir, "..", "PKLot", "parking1a")),
        os.path.abspath(os.path.join(exe_dir, "PKLot", "parking1a")),
        os.path.abspath(os.path.join(os.getcwd(), "PKLot", "parking1a")),
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            print(f"PKLOT_ROOT resolved to: {candidate}")
            return candidate
    print(f"PKLOT_ROOT not found. Falling back to: {candidates[0]}")
    return candidates[0]

PKLOT_ROOT = resolve_pklot_root()
forecaster = MLForecaster(PKLOT_ROOT)



def parse_pklot_xml(xml_path: str):
    """
    Parses a PKLot XML annotation file to extract parking space statuses and contours.

    Args:
        xml_path (str): Absolute path to the XML file.

    Returns:
        list[dict]: A list of parsed spaces, where each space is a dict with:
                    - "id" (str): The space ID.
                    - "occupied" (bool): True if occupied, False otherwise.
                    - "contour" (list[dict]): A list of coordinates representing the space polygon.
    """
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
        parsed_spaces = []
        for space_elem in root.findall("space"):
            space_id = space_elem.get("id")
            is_occupied = space_elem.get("occupied") == "1"
            contour_points = []
            contour_elem = space_elem.find("contour")
            if contour_elem is not None:
                for point_elem in contour_elem.findall("point"):
                    contour_points.append({
                        "x": int(point_elem.get("x")), 
                        "y": int(point_elem.get("y"))
                    })
            parsed_spaces.append({
                "id": space_id,
                "occupied": is_occupied,
                "contour": contour_points
            })
        return parsed_spaces
    except Exception as e:
        print(f"Error parsing XML {xml_path}: {e}")
        return []

def resolve_pklot_paths(name: str):
    """
    Safely parses a snapshot path identifier (e.g., 'sunny/2012-12-07/2012-12-07_17_12_25')
    and returns absolute paths to the corresponding JPG and XML files.
    """
    parts = name.split('/')
    if len(parts) != 3:
        parts = name.split('\\')
        if len(parts) != 3:
            raise HTTPException(status_code=400, detail="Invalid snapshot path format")
            
    weather, date_str, base_name = parts
    if weather not in ("sunny", "cloudy", "rainy"):
        raise HTTPException(status_code=400, detail="Invalid weather category")
        
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
        
    if not ("2012-12-07" <= date_str <= "2013-01-29"):
        raise HTTPException(status_code=400, detail="Date out of range")
        
    # Prevent traversal on base_name
    base_name = os.path.basename(base_name)
    
    jpg_path = os.path.join(PKLOT_ROOT, weather, date_str, f"{base_name}.jpg")
    xml_path = os.path.join(PKLOT_ROOT, weather, date_str, f"{base_name}.xml")
    
    return jpg_path, xml_path

@app.get("/api/pklot/snapshots")
async def get_pklot_snapshots():
    """
    Returns a sorted list of all available PKLot snapshot path names (weather/date/base_name)
    within the range 2012-12-07 to 2013-01-29, ordered chronologically.
    """
    if not os.path.exists(PKLOT_ROOT):
        return []
    snapshots = []
    weathers = ["cloudy", "rainy", "sunny"]
    for weather in weathers:
        weather_path = os.path.join(PKLOT_ROOT, weather)
        if not os.path.exists(weather_path):
            continue
        for date_dir in os.listdir(weather_path):
            date_path = os.path.join(weather_path, date_dir)
            if not os.path.isdir(date_path):
                continue
            # Filter date range inclusive
            if "2012-12-07" <= date_dir <= "2013-01-29":
                for filename in os.listdir(date_path):
                    if filename.endswith(".xml"):
                        base_name = filename[:-4]
                        jpg_file = f"{base_name}.jpg"
                        if os.path.exists(os.path.join(date_path, jpg_file)):
                            snapshots.append(f"{weather}/{date_dir}/{base_name}")
    # Sort chronologically by the filename (which starts with date_time)
    snapshots.sort(key=lambda x: x.split('/')[-1])
    return snapshots

@app.get("/api/pklot/snapshot/{name:path}")
async def get_pklot_snapshot(name: str):
    """Serves the camera snapshot JPG image corresponding to the given PKLot filename."""
    jpg_path, _ = resolve_pklot_paths(name)
    if not os.path.exists(jpg_path):
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return FileResponse(jpg_path)

@app.get("/api/pklot/annotation/{name:path}")
async def get_pklot_annotation(name: str):
    """Parses and returns the XML annotations (spaces status and contours) for a given PKLot snapshot."""
    _, xml_path = resolve_pklot_paths(name)
    if not os.path.exists(xml_path):
        raise HTTPException(status_code=404, detail="Annotation not found")
    parsed_spaces = parse_pklot_xml(xml_path)
    clean_name = os.path.basename(name)
    return {"name": clean_name, "spaces": parsed_spaces}

@app.post("/api/pklot/apply/{name:path}")
async def apply_pklot_snapshot(name: str):
    """
    Parses a PKLot XML frame and applies the occupancy statuses to the database and/or cache,
    and updates the PLC outputs accordingly.
    """
    verify_system_connected(require_plc=True, require_yolo=True, require_gdpr=True, require_homography=True)
    _, xml_path = resolve_pklot_paths(name)
    if not os.path.exists(xml_path):
        raise HTTPException(status_code=404, detail="Annotation not found")
    
    parsed_spaces = parse_pklot_xml(xml_path)
    if not parsed_spaces:
        raise HTTPException(status_code=400, detail="Failed to parse spaces or XML is empty")
    
    # Map all parsed space IDs (1 to 28) dynamically
    mapped_status = {}
    for parsed_space in parsed_spaces:
        space_id = parsed_space["id"]
        is_occupied = parsed_space["occupied"]
        
        try:
            space_num = int(space_id)
            if 1 <= space_num <= 28:
                space_code = f"A-{space_num}"
                if space_num in (27, 28):
                    mapped_status[space_code] = "OCCUPIED" if is_occupied else "DISABLED"
                else:
                    mapped_status[space_code] = "OCCUPIED" if is_occupied else "FREE"
        except ValueError:
            continue
            
    # Oblicz poprzednie obłożenie
    prev_occupied = sum(1 for status in current_spaces_cache.values() if status == "OCCUPIED")

    # Apply to database and cache
    for space_code, status in mapped_status.items():
        iou_value = 0.90 if status == "OCCUPIED" else 0.0
        await update_space_in_db_or_cache(space_code, status, iou_val=iou_value)
        
    # Oblicz nowe obłożenie
    new_occupied = sum(1 for status in current_spaces_cache.values() if status == "OCCUPIED")

    # Symulacja aktywacji czujnika pętli i cyklu szlabanu przy zmianach obłożenia (tryb poklatkowy PKLot)
    if new_occupied > prev_occupied:
        plc.wjazd_sensor = True
        plc.total_entries += 1
        driver_manager.log_event("INFO", "PLC", "Tryb PKLot: Wykryto wjazd pojazdu. Aktywacja pętli wjazdowej %I0.0.")
        
        async def turn_off_wjazd_sensor():
            await asyncio.sleep(1.5)
            plc.wjazd_sensor = False
            plc.update_outputs(current_spaces_cache)
            await notify_clients()
        asyncio.create_task(turn_off_wjazd_sensor())
        
    elif new_occupied < prev_occupied:
        plc.wyjazd_sensor = True
        plc.total_exits += 1
        driver_manager.log_event("INFO", "PLC", "Tryb PKLot: Wykryto wyjazd pojazdu. Aktywacja pętli wyjazdowej %I0.1.")
        
        async def turn_off_wyjazd_sensor():
            await asyncio.sleep(1.5)
            plc.wyjazd_sensor = False
            plc.update_outputs(current_spaces_cache)
            await notify_clients()
        asyncio.create_task(turn_off_wyjazd_sensor())

    # Run PLC updates
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    
    return {
        "status": "success", 
        "applied_states": {space_code: current_spaces_cache[space_code] for space_code in mapped_status.keys()}
    }

# ----------------- VIRTUAL DRIVERS & WIRING API ENDPOINTS -----------------

class DriverStateRequest(BaseModel):
    status: str

class DriverConfigRequest(BaseModel):
    host: str
    port: int
    latency: int
    mode: str

async def simulate_reconnect_task(driver_id: str):
    """Asynchronous background task to simulate a driver reconnecting after a brief latency."""
    await asyncio.sleep(3.0)  # 3 seconds reconnect simulation
    driver_manager.set_status(driver_id, "CONNECTED")
    plc.update_outputs(current_spaces_cache)
    await notify_clients()

@app.post("/api/drivers/{driver_id}/state")
async def set_driver_state(driver_id: str, state_request: DriverStateRequest, background_tasks: BackgroundTasks):
    """Updates a driver's operational status (e.g. CONNECTED, CONNECTING, DISCONNECTED, ERROR)."""
    status = state_request.status
    if status == "CONNECTING":
        driver_manager.set_status(driver_id, "CONNECTING")
        background_tasks.add_task(simulate_reconnect_task, driver_id)
    else:
        status_set_success = driver_manager.set_status(driver_id, status)
        if not status_set_success:
            raise HTTPException(status_code=404, detail="Driver not found")
            
    # Log user action
    driver_manager.log_event("WARNING", "UŻYTKOWNIK", f"Ręczna zmiana stanu sterownika {driver_id} na {status}")
    
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    return {"status": "success", "driver_id": driver_id, "status": status}

@app.post("/api/drivers/{driver_id}/config")
async def update_driver_config(driver_id: str, config_request: DriverConfigRequest):
    """Updates network and operational parameters (host, port, latency, mode) for a driver."""
    config_updated = driver_manager.update_config(driver_id, config_request.dict())
    if not config_updated:
        raise HTTPException(status_code=404, detail="Driver not found")
        
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    return {"status": "success", "driver_id": driver_id}

@app.get("/api/system/logs")
async def get_system_logs():
    """Retrieves list of all system logs from the hardware driver manager."""
    return driver_manager.get_logs()

@app.post("/api/system/logs/clear")
async def clear_system_logs():
    """Clears all system event logs."""
    driver_manager.clear_logs()
    await notify_clients()
    return {"status": "success"}

@app.post("/api/simulate/maintenance/grease")
async def perform_grease_maintenance():
    """Performs grease replacement: resets grease level to 100.0% and repairs motor health to 100.0%."""
    plc.barrier_grease_level = 100.0
    plc.barrier_motor_health = 100.0
    plc._grease_warn_active = False
    plc._motor_warn_active = False
    driver_manager.log_event("INFO", "UŻYTKOWNIK", "KONSERWACJA: Wymiana smaru przekładni szlabanów zakończona. Poziom smaru i sprawność silników zresetowane do 100%.")
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    return {"status": "success", "message": "Grease and motor health restored to 100%"}

@app.post("/api/simulate/maintenance/fan")
async def perform_fan_maintenance():
    """Performs cooling fan replacement: resets fan health to 100.0% and runtime to 0."""
    plc.fan_health = 100.0
    plc.fan_run_time = 0
    plc._fan_warn_active = False
    driver_manager.log_event("INFO", "UŻYTKOWNIK", "KONSERWACJA: Wymiana silnika wentylatora szafy sterowniczej %Q0.2. Sprawność zresetowana do 100%.")
    plc.update_outputs(current_spaces_cache)
    await notify_clients()
    return {"status": "success", "message": "Fan health restored to 100%"}

# ----------------- ML FORECASTING ENDPOINTS -----------------

@app.get("/api/ml/forecast")
async def get_ml_forecast(hour: float, is_weekend: bool, weather: str, method: str = "regression"):
    """Returns 24-hour occupancy prediction using trained ML models."""
    preds = forecaster.predict(hour, is_weekend, weather, method)
    return {"predictions": preds, "method": method}

@app.get("/api/ml/history")
async def get_ml_history():
    """Returns aggregated historical occupancy averages and ML telemetry statistics."""
    return forecaster.get_history_stats()

@app.get("/api/pklot/day-occupancy/{date_str}")
async def get_pklot_day_occupancy(date_str: str):
    """
    Parses all XML annotations for a given date_str (YYYY-MM-DD)
    and returns their frac_hour and actual occupancy rate.
    """
    if not os.path.exists(PKLOT_ROOT):
        return []
    
    results = []
    weathers = ["cloudy", "rainy", "sunny"]
    for weather in weathers:
        date_path = os.path.join(PKLOT_ROOT, weather, date_str)
        if not os.path.exists(date_path):
            continue
        try:
            for filename in sorted(os.listdir(date_path)):
                if filename.endswith(".xml"):
                    xml_path = os.path.join(date_path, filename)
                    try:
                        # Extract hour/minute from filename: YYYY-MM-DD_HH_MM_SS
                        base = filename[:-4]
                        parts = base.split('_')
                        if len(parts) < 4:
                            continue
                        hour = int(parts[1])
                        minute = int(parts[2])
                        frac_hour = hour + minute / 60.0
                        
                        tree = ET.parse(xml_path)
                        root = tree.getroot()
                        spaces = root.findall("space")
                        if spaces:
                            occupied = sum(1 for s in spaces if s.get("occupied") == "1")
                            results.append({
                                "hour": frac_hour,
                                "occupancy": occupied / len(spaces)
                            })
                    except Exception:
                        continue
        except Exception:
            continue
        break # Date folder found and processed, stop search
        
    return sorted(results, key=lambda x: x["hour"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

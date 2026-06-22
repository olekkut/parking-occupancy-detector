from datetime import datetime
import threading
import copy


class HardwareDriverManager:
    """
    Manages operational states, configurations, and network settings for
    all virtual/physical hardware drivers and subsystems (e.g. PLC, YOLO, Database, UPS).
    Provides a thread-safe event logger for system telemetry.
    """
    def __init__(self):
        self.lock = threading.RLock()
        self.logs = []
        self.max_logs = 400
        
        # Inicjalne sterowniki
        self.drivers = {
            "plc": {
                "id": "plc",
                "name": "PLC Link (Modbus/TCP)",
                "status": "CONNECTED", # CONNECTED, CONNECTING, DISCONNECTED, ERROR
                "mode": "VIRTUAL",      # VIRTUAL, REAL
                "host": "192.168.1.105",
                "port": 502,
                "latency": 5,           # ms
                "last_error": None
            },
            "yolo": {
                "id": "yolo",
                "name": "YOLO Vision Engine",
                "status": "CONNECTED",
                "mode": "VIRTUAL",
                "host": "127.0.0.1",
                "port": 8501,
                "latency": 32,
                "last_error": None
            },
            "db": {
                "id": "db",
                "name": "PostgreSQL/PostGIS Database",
                "status": "CONNECTED",
                "mode": "VIRTUAL",
                "host": "localhost",
                "port": 5432,
                "latency": 2,
                "last_error": None
            },
            "ups": {
                "id": "ups",
                "name": "UPS Power Monitor",
                "status": "CONNECTED",
                "mode": "VIRTUAL",
                "host": "COM3",
                "port": 9600,
                "latency": 1,
                "last_error": None
            },
            "temp": {
                "id": "temp",
                "name": "Cabinet Temp Modbus Probe",
                "status": "CONNECTED",
                "mode": "VIRTUAL",
                "host": "MODBUS-RTU-AD1",
                "port": 9600,
                "latency": 7,
                "last_error": None
            },
            "gdpr": {
                "id": "gdpr",
                "name": "RODO Video Blur Filter",
                "status": "CONNECTED",
                "mode": "VIRTUAL",
                "host": "OpenCV-anonymizer",
                "port": 0,
                "latency": 11,
                "last_error": None
            },
            "homography": {
                "id": "homography",
                "name": "Homography Calibrator",
                "status": "CONNECTED",
                "mode": "VIRTUAL",
                "host": "Matrix-Transformation",
                "port": 0,
                "latency": 1,
                "last_error": None
            }
        }
        
        # Dodanie logu startowego
        self.log_event("INFO", "SYSTEM", "Uruchomienie Menedżera Sterowników Sieciowych")
        self.log_event("INFO", "PLC", "Inicjalizacja sterownika Modbus/TCP (%I/%Q/%MW)")
        self.log_event("INFO", "BAZA_DANYCH", "Połączenie z bazą danych PostgreSQL nawiązane (Virtual Mode)")
        self.log_event("INFO", "YOLO", "Silnik YOLO załadował plik konfiguracyjny modelu (yolov8n.onnx)")

    def log_event(self, level: str, source: str, message: str):
        """
        Adds a new system event log to the circular logs list.
        Thread-safe.
        """
        with self.lock:
            now = datetime.now()
            time_str = now.strftime("%H:%M:%S")
            entry = {
                "time": time_str,
                "level": level,    # INFO, WARNING, ERROR
                "source": source,  # PLC, YOLO, BAZA_DANYCH, UPS, TEMPERATURA, GDPR, SYSTEM, UŻYTKOWNIK
                "message": message
            }
            self.logs.insert(0, entry) # Najnowsze na początku
            if len(self.logs) > self.max_logs:
                self.logs.pop()

    def get_drivers(self) -> dict:
        """
        Returns a deep copy of the drivers configuration and status dictionary.
        Thread-safe.
        """
        with self.lock:
            return copy.deepcopy(self.drivers)

    def get_logs(self) -> list:
        """
        Returns a shallow copy of the system logs list.
        Thread-safe.
        """
        with self.lock:
            return list(self.logs)

    def clear_logs(self):
        """
        Clears all event logs and adds a system clear event.
        Thread-safe.
        """
        with self.lock:
            self.logs.clear()
            self.log_event("INFO", "SYSTEM", "Dziennik logów został wyczyszczony przez operatora.")

    def update_config(self, driver_id: str, config: dict) -> bool:
        """
        Updates connection properties (host, port, latency, mode) for a specific driver.
        Thread-safe.
        """
        with self.lock:
            if driver_id not in self.drivers:
                return False
            
            driver = self.drivers[driver_id]
            if "host" in config:
                driver["host"] = config["host"]
            if "port" in config:
                try:
                    driver["port"] = int(config["port"])
                except ValueError:
                    pass
            if "latency" in config:
                try:
                    driver["latency"] = int(config["latency"])
                except ValueError:
                    pass
            if "mode" in config:
                driver["mode"] = config["mode"]
                
            self.log_event(
                "INFO", 
                "SYSTEM", 
                f"Zaktualizowano konfigurację {driver['name']}: {driver['mode']} | Host: {driver['host']}:{driver['port']}"
            )
            return True

    def set_status(self, driver_id: str, status: str) -> bool:
        """
        Sets the connection status of a driver and logs status changes.
        Thread-safe.
        """
        with self.lock:
            if driver_id not in self.drivers:
                return False
            
            driver = self.drivers[driver_id]
            old_status = driver["status"]
            
            if old_status == status:
                return True
                
            driver["status"] = status
            
            # Tłumaczenie tagów logowania
            source_map = {
                "plc": "PLC", "yolo": "YOLO", "db": "BAZA_DANYCH",
                "ups": "UPS", "temp": "TEMPERATURA", "gdpr": "GDPR", "homography": "SYSTEM"
            }
            log_source = source_map.get(driver_id, "SYSTEM")
            
            if status == "ERROR":
                driver["last_error"] = "Wywołano awarię testową sterownika"
                self.log_event("ERROR", log_source, f"AWARIA KRYTYCZNA: {driver['name']} - Brak komunikacji z urządzeniem")
            elif status == "DISCONNECTED":
                driver["last_error"] = "Rozłączony ręcznie"
                self.log_event("WARNING", log_source, f"Ostrzeżenie: Sterownik {driver['name']} został rozłączony z systemem")
            elif status == "CONNECTED":
                driver["last_error"] = None
                self.log_event("INFO", log_source, f"Komunikacja z {driver['name']} przywrócona. Status: OK")
            elif status == "CONNECTING":
                driver["last_error"] = None
                self.log_event("INFO", log_source, f"Próba nawiązania połączenia z {driver['name']}...")
                
            return True

# Globalny menedżer sterowników
driver_manager = HardwareDriverManager()

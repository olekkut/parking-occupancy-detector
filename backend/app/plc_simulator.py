# PLC Controller Simulator (Modbus registers emulation)
# Notacja adresów wg IEC 61131-3: %I (wejścia), %Q (wyjścia), %M (markery), %MW (rejestry słowowe)

import time
import random
from backend.app.hardware_drivers import driver_manager


class PLCSimulator:
    """
    Simulates a physical PLC (Programmable Logic Controller) using Modbus-like registers.
    Emulates Digital Inputs (%I), Markers (%M), Digital Outputs (%Q), and Word Registers (%MW).
    Also runs self-diagnostics, automated cooling fan control, and predictive maintenance metrics.
    """
    def __init__(self):
        # ----- Wejścia cyfrowe (Digital Inputs / %I) -----
        self.auto_mode = True          # %M0.0 — Tryb pracy: True=AUTO, False=MANUAL
        self.wjazd_sensor = False      # %I0.0 — Czujnik pętli indukcyjnej (wjazd)
        self.wyjazd_sensor = False     # %I0.1 — Czujnik pętli indukcyjnej (wyjazd)
        self.override_wjazd_szlaban = False   # %M1.0 — Wymuszenie ręczne szlabanu wjazd
        self.override_wyjazd_szlaban = False  # %M1.1 — Wymuszenie ręczne szlabanu wyjazd
        
        # ----- Wyjścia cyfrowe (Digital Outputs / %Q) -----
        self.wjazd_szlaban = False     # %Q0.0 — Napęd szlabanu wjazdowego (False=OPUSZCZONY, True=PODNIESIONY)
        self.wyjazd_szlaban = False    # %Q0.1 — Napęd szlabanu wyjazdowego
        self.cabinet_fan = False       # %Q0.2 — Wentylator chłodzący szafę sterowniczą (False=WYŁ., True=WŁ.)
        
        # ----- Rejestry słowowe LED (%MW10..MW64) -----
        # Dictionary of Space code -> LED status (0=Off, 1=Green/Free, 2=Red/Occupied, 3=Blue/Disabled)
        self.leds = {}
        
        # ----- Rejestry procesowe (%MW) -----
        self.total_spots = 28          # %MW20 — Łączna liczba stanowisk
        self.available_spots = 28      # %MW22 — Liczba miejsc dostępnych
        
        # ----- Rejestry diagnostyczne -----
        self.cabinet_temp = 23.4       # %MW30 — Temperatura szafy sterowniczej [°C]
        self.ups_level = 100.0         # %MW32 — Poziom baterii UPS [%]
        self.start_time = time.time()  # Czas uruchomienia systemu
        
        # ----- Liczniki statystyczne sesji -----
        self.total_entries = 0         # %MW40 — Łączna liczba wjazdów
        self.total_exits = 0           # %MW42 — Łączna liczba wyjazdów
        self.peak_occupancy_pct = 0    # %MW44 — Szczytowe obłożenie [%]
        self.barrier_cycles = 0        # %MW46 — Łączna liczba cykli szlabanów (wjazdy + wyjazdy)
        self.barrier_motor_health = 100.0 # %MW48 — Stan zużycia silnika szlabanu [%]
        self.barrier_grease_level = 100.0 # %MW50 — Poziom smaru szlabanu [%]
        self.fan_health = 100.0           # %MW52 — Stan wentylatora szafy [%]
        self.fan_run_time = 0             # %MW54 — Czas pracy wentylatora [s]
        
        # Poprzednie stany szlabanów do liczenia cykli na zboczach opadających
        self._prev_wjazd_szlaban = False
        self._prev_wyjazd_szlaban = False

        # Flagi wykluczające wielokrotne logowanie alarmów
        self._temp_alarm_active = False
        self._ups_warn_active = False
        self._ups_alarm_active = False
        self._motor_warn_active = False
        self._grease_warn_active = False
        self._fan_warn_active = False
        self.maintenance_lockout = False  # %M2.0 — Blokada awaryjna ENGINE CHECK (krytyczne zużycie komponentów)
        self._lockout_alarm_active = False  # Flaga zapobiegająca wielokrotnemu logowaniu alarmu lockout

    def simulate_diagnostics(self):
        """
        Simulates environmental and power metric drift (cabinet temperature, UPS battery decay).
        Triggers corresponding warning/alarm logs when communication is healthy or detects hardware errors.
        """
        driver_states = driver_manager.get_drivers()
        
        # Temperatura szafy i zużycie wentylatora / smaru
        if driver_states["temp"]["status"] == "ERROR":
            if self.cabinet_temp != -99.9:
                driver_manager.log_event("ALARM", "TEMPERATURA", "Awaria czujnika temperatury szafy sterowniczej (%MW30).")
            self.cabinet_temp = -99.9  # Kod błędu
        elif driver_states["temp"]["status"] in ("DISCONNECTED", "CONNECTING"):
            self.cabinet_temp = 0.0
        else:
            # Zużycie wentylatora %Q0.2
            if self.cabinet_fan:
                self.fan_run_time += 1
                temp_factor = max(1.0, self.cabinet_temp / 23.0)
                self.fan_health = max(0.0, round(self.fan_health - random.uniform(0.015, 0.035) * temp_factor, 2))
                
                # Chłodzenie szafy zależy od sprawności wentylatora
                cooling_efficiency = self.fan_health / 100.0
                self.cabinet_temp -= random.uniform(0.12, 0.22) * cooling_efficiency
                
                if self.fan_health < 40.0:
                    if not self._fan_warn_active:
                        driver_manager.log_event("WARNING", "PLC", f"Zużycie wentylatora szafy (%MW52) wynosi {self.fan_health}%. Zalecany serwis / wymiana silnika wentylatora.")
                        self._fan_warn_active = True
                else:
                    self._fan_warn_active = False
            else:
                self.cabinet_temp += random.uniform(0.04, 0.15)
                
            self.cabinet_temp = max(21.0, min(35.0, self.cabinet_temp)) # Zwiększono limit do 35°C dla testów przegrzania

            # Odparowywanie smaru od temperatury szafy (>25°C)
            if self.cabinet_temp > 25.0:
                evap_amount = 0.005 * (self.cabinet_temp - 25.0)
                self.barrier_grease_level = max(0.0, round(self.barrier_grease_level - evap_amount, 2))
                
                if self.barrier_grease_level < 40.0:
                    if not self._grease_warn_active:
                        driver_manager.log_event("WARNING", "PLC", f"Niski poziom smaru przekładni szlabanu (%MW50) wynosi {self.barrier_grease_level}%. Ryzyko zwiększonego tarcia.")
                        self._grease_warn_active = True
                else:
                    self._grease_warn_active = False
        
        # UPS
        if driver_states["ups"]["status"] == "ERROR":
            if self.ups_level != -1.0:
                driver_manager.log_event("ALARM", "UPS", "Awaria zasilacza UPS (%MW32) - brak odczytu parametrów.")
            self.ups_level = -1.0 # Błąd zasilacza
        elif driver_states["ups"]["status"] in ("DISCONNECTED", "CONNECTING"):
            self.ups_level = 0.0
        else:
            # UPS: powolny spadek ~0.02% na cykl, reset do 100% przy < 82%
            self.ups_level -= random.uniform(0.01, 0.04)
            if self.ups_level < 82.0:
                self.ups_level = 100.0  # Symulacja cyklu ładowania
            self.ups_level = max(0.0, min(100.0, self.ups_level))

    def update_outputs(self, parking_spaces_status: dict):
        """
        Updates PLC output registers (barrier states, LEDs, counters, health metrics)
        based on current parking space cache statuses (FREE, OCCUPIED, DISABLED).
        
        Args:
            parking_spaces_status (dict): Maps space_code (str) -> status (str).
        """
        # 1. Aktualizacja LED sygnalizatorów nad miejscami
        free_count = 0
        self.total_spots = len(parking_spaces_status)
        
        for code, status in parking_spaces_status.items():
            if status == "FREE":
                self.leds[code] = 1  # Zielony = Wolne
                free_count += 1
            elif status == "OCCUPIED":
                self.leds[code] = 2  # Czerwony = Zajęte
            elif status == "DISABLED":
                self.leds[code] = 3  # Niebieski = Rezerwacja ♿
            else:
                self.leds[code] = 0  # Wyłączony
                    
        self.available_spots = free_count
        
        # Aktualizacja szczytowego obłożenia
        if self.total_spots > 0:
            current_occupancy_percentage = round(((self.total_spots - free_count) / self.total_spots) * 100)
            if current_occupancy_percentage > self.peak_occupancy_pct:
                self.peak_occupancy_pct = current_occupancy_percentage
        
        # 2. Logika sterowania szlabanami
        if self.auto_mode:
            # Tryb AUTO: otwarcie przy detekcji + dostępność
            self.wjazd_szlaban = self.wjazd_sensor and self.available_spots > 0
            self.wyjazd_szlaban = self.wyjazd_sensor
        else:
            # Tryb MANUAL: wymuszenie ręczne operatora
            self.wjazd_szlaban = self.override_wjazd_szlaban
            self.wyjazd_szlaban = self.override_wyjazd_szlaban

        # INTERLOCKI & ZABEZPIECZENIA AWARII (PN-EN 12453)
        # Pobranie statusów z driver_manager
        driver_states = driver_manager.get_drivers()
        ups_status = driver_states["ups"]["status"]
        temp_status = driver_states["temp"]["status"]

        # Awaria UPS lub krytyczny stan baterii (< 20%): otwarcie szlabanów dla ewakuacji
        if ups_status == "ERROR" or (0.0 < self.ups_level < 20.0):
            self.wjazd_szlaban = True
            self.wyjazd_szlaban = True
            # Wymuszenie logu awarii zasilania
            if not self._ups_alarm_active:
                driver_manager.log_event("ALARM", "UPS", "TRYB ZABEZPIECZENIA: Awaria zasilania UPS / baterii. Szlabany podniesione awaryjnie.")
                self._ups_alarm_active = True
        else:
            # Zezwalaj na resetowanie flagi alarmowej zasilania, gdy warunki wrócą do normy
            if ups_status == "CONNECTED" and self.ups_level >= 50.0:
                self._ups_alarm_active = False

        # BLOKADA AWARYJNA ENGINE CHECK — Krytyczne zużycie komponentów (PN-EN 13849-1)
        # Gdy dowolny z rejestrów predykcyjnego utrzymania ruchu spadnie ≤ 5%,
        # system blokuje wjazd nowych pojazdów (szlaban wjazdowy opuszczony)
        # ale umożliwia wyjazd (bezpieczeństwo ewakuacji).
        critical_motor = self.barrier_motor_health <= 5.0
        critical_grease = self.barrier_grease_level <= 5.0
        critical_fan = self.fan_health <= 5.0

        if critical_motor or critical_grease or critical_fan:
            self.maintenance_lockout = True
            if self.auto_mode:
                self.wjazd_szlaban = False  # Blokada wjazdu — nie przyjmuj nowych pojazdów
                # wyjazd_szlaban zachowuje normalną logikę (ewakuacja)
            if not self._lockout_alarm_active:
                components = []
                if critical_motor:
                    components.append(f"silnik szlabanu %MW48={self.barrier_motor_health}%")
                if critical_grease:
                    components.append(f"smar przekładni %MW50={self.barrier_grease_level}%")
                if critical_fan:
                    components.append(f"wentylator szafy %MW52={self.fan_health}%")
                driver_manager.log_event("ALARM", "PLC", f"⚠️ ENGINE CHECK — BLOKADA AWARYJNA: {', '.join(components)}. System wymaga interwencji serwisowej!")
                self._lockout_alarm_active = True
        else:
            if self.maintenance_lockout:
                driver_manager.log_event("INFO", "PLC", "ENGINE CHECK — Blokada awaryjna ZDJĘTA. Parametry komponentów w normie. Automatyka przywrócona.")
            self.maintenance_lockout = False
            self._lockout_alarm_active = False

        # Awaria czujnika temperatury: załączenie wentylatora w trybie ciągłym (fail-safe)
        if temp_status == "ERROR":
            self.cabinet_fan = True

        # 3. Symulacja diagnostyki
        self.simulate_diagnostics()

        # 4. Automatyczna termoregulacja szafy sterowniczej %Q0.2 (Thermostat z histerezą)
        # (Uruchom tylko, gdy nie ma awarii czujnika temp)
        if temp_status != "ERROR" and self.cabinet_temp != -99.9 and self.cabinet_temp != 0.0:
            if self.cabinet_temp > 25.0 and not self.cabinet_fan:
                self.cabinet_fan = True
                driver_manager.log_event("INFO", "PLC", f"Wentylator szafy sterowniczej %Q0.2 WŁĄCZONY. Temperatura: {round(self.cabinet_temp, 1)}°C")
            elif self.cabinet_temp < 23.0 and self.cabinet_fan:
                self.cabinet_fan = False
                driver_manager.log_event("INFO", "PLC", f"Wentylator szafy sterowniczej %Q0.2 WYŁĄCZONY. Temperatura: {round(self.cabinet_temp, 1)}°C")
            
            # Alarm krytycznej temperatury szafy (powyżej 27.0°C)
            if self.cabinet_temp > 27.0:
                if not self._temp_alarm_active:
                    driver_manager.log_event("ALARM", "TEMPERATURA", f"KRYTYCZNA TEMPERATURA SZAFY: {round(self.cabinet_temp, 1)}°C! Ryzyko przegrzania PLC.")
                    self._temp_alarm_active = True
            else:
                self._temp_alarm_active = False

        # 5. Ostrzeżenia i alarmy zasilacza UPS (%MW32) - tylko, gdy nie ma ewakuacji/awarii krytycznej z poziomu interlocka
        if ups_status != "ERROR" and self.ups_level >= 20.0:
            if 20.0 <= self.ups_level < 50.0:
                if not self._ups_alarm_active:
                    driver_manager.log_event("ALARM", "UPS", f"Awaria zasilania sieciowego! Praca buforowa. Bateria UPS: {round(self.ups_level, 1)}%.")
                    self._ups_alarm_active = True
                self._ups_warn_active = False
            elif 50.0 <= self.ups_level < 85.0:
                if not self._ups_warn_active:
                    driver_manager.log_event("WARNING", "UPS", f"Niski stan baterii UPS: {round(self.ups_level, 1)}%.")
                    self._ups_warn_active = True
                self._ups_alarm_active = False
            else:
                self._ups_alarm_active = False
                self._ups_warn_active = False

        # 6. Detekcja zbocza opadającego szlabanów (zamykanie szlabanu) do naliczania cykli i zużycia
        # Zapewnia liczenie cykli przy wszystkich trybach pracy (AUTO, MANUAL, PKLot snapshoty)
        wjazd_closing = self._prev_wjazd_szlaban and not self.wjazd_szlaban
        wyjazd_closing = self._prev_wyjazd_szlaban and not self.wyjazd_szlaban

        if wjazd_closing or wyjazd_closing:
            self.barrier_cycles += 1
            
            # Zużycie smaru na cykl
            self.barrier_grease_level = max(0.0, round(self.barrier_grease_level - 0.1, 2))
            
            # Wpływ tarcia i smaru na zużycie silnika i temperaturę
            if self.barrier_grease_level >= 40.0:
                motor_wear = 0.05
                temp_spike = 0.1
            elif self.barrier_grease_level >= 20.0:
                motor_wear = 0.15
                temp_spike = 0.4
                if random.random() < 0.2:
                    driver_manager.log_event("WARNING", "PLC", "Wzmożone tarcie szlabanu: niski poziom smaru powoduje przegrzewanie silnika.")
            else:
                motor_wear = 0.35
                temp_spike = 0.8
                if random.random() < 0.3:
                    driver_manager.log_event("ALARM", "PLC", "KRYTYCZNE TARCIE: Praca silnika szlabanu na sucho! Ryzyko uszkodzenia napędu.")

            self.barrier_motor_health = max(0.0, round(self.barrier_motor_health - motor_wear, 2))
            
            # Podgrzewanie szafy przez tarcie silnika
            if temp_status != "ERROR" and self.cabinet_temp != -99.9:
                self.cabinet_temp = min(35.0, self.cabinet_temp + temp_spike)
                
            if wjazd_closing:
                driver_manager.log_event("INFO", "PLC", f"Szlaban wjazdowy %Q0.0 zakończył cykl. Zużycie silnika: {self.barrier_motor_health}%, Smar: {self.barrier_grease_level}%")
            if wyjazd_closing:
                driver_manager.log_event("INFO", "PLC", f"Szlaban wyjazdowy %Q0.1 zakończył cykl. Zużycie silnika: {self.barrier_motor_health}%, Smar: {self.barrier_grease_level}%")

        # Zapisz stany na kolejny cykl
        self._prev_wjazd_szlaban = self.wjazd_szlaban
        self._prev_wyjazd_szlaban = self.wyjazd_szlaban

        # Ostrzeżenie o zużyciu silnika
        if self.barrier_motor_health < 95.0:
            if not self._motor_warn_active:
                driver_manager.log_event("WARNING", "PLC", f"Zużycie silnika szlabanu (%MW48) wynosi {self.barrier_motor_health}%. Zalecany przegląd serwisowy napędu.")
                self._motor_warn_active = True
        else:
            self._motor_warn_active = False

    def get_registers(self):
        """Zwraca pełną mapę rejestrów PLC w formacie JSON (notacja IEC 61131-3)."""
        uptime_seconds = int(time.time() - self.start_time)
        
        return {
            # Markery trybu
            "auto_mode": self.auto_mode,
            "override_active": not self.auto_mode,
            
            # Wejścia cyfrowe %I
            "wjazd_sensor": self.wjazd_sensor,
            "wyjazd_sensor": self.wyjazd_sensor,
            
            # Wyjścia cyfrowe %Q
            "wjazd_szlaban": self.wjazd_szlaban,
            "wyjazd_szlaban": self.wyjazd_szlaban,
            "cabinet_fan": self.cabinet_fan,
            
            # Rejestry procesowe %MW
            "total_spots": self.total_spots,
            "available_spots": self.available_spots,
            
            # Diagnostyka
            "cabinet_temp": round(self.cabinet_temp, 1),
            "ups_level": round(self.ups_level, 1),
            "system_uptime": uptime_seconds,
            
            # Statystyki sesji
            "total_entries": self.total_entries,
            "total_exits": self.total_exits,
            "peak_occupancy_pct": self.peak_occupancy_pct,
            "barrier_cycles": self.barrier_cycles,
            "barrier_motor_health": self.barrier_motor_health,
            "maintenance_lockout": self.maintenance_lockout,
            "barrier_grease_level": self.barrier_grease_level,
            "fan_health": self.fan_health,
            "fan_run_time": self.fan_run_time,
        }

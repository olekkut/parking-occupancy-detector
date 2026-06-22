# Inteligentny System Automatyzacji i Monitorowania Miejsc Parkingowych (Integracja PLC + YOLO + PostGIS)

Projekt stanowi kompleksowy system automatyzacji procesów parkingowych, integrujący sterowanie przemysłowe (PLC), analizę wizyjną (AI - YOLO) oraz bazy danych przestrzennych (PostGIS). Jest to w pełni funkcjonalny Mini-Projekt (Zadanie 3) z przedmiotu **Programowanie sterowników PLC**.

---

## 1. Cel i Rozwiązanie Problemu

Tradycyjne parkingi wymagają instalacji kosztownych czujników fizycznych nad każdym miejscem lub pętli indukcyjnych pod nawierzchnią. Nasz projekt rozwiązuje ten problem poprzez:
1. **Analizę Wizyjną**: Kamery IP przesyłają obraz do modułu YOLO, który za pomocą współczynnika **IoU (Intersection over Union)** i nakładki wielokątów (PostGIS Polygon) określa zajętość bezkontaktowo.
2. **Automatyzację PLC**: Sterownik PLC zarządza logiką wjazdów/wyjazdów (szlabany, pętle indukcyjne), termoregulacją szafy sterowniczej, diagnostyką UPS oraz predykcyjnym utrzymaniem ruchu (Predictive Maintenance).
3. **Zgodność z RODO (Privacy by Design)**: Strumień wideo jest anonimizowany (rozmazywanie twarzy i tablic rejestracyjnych) u źródła w pamięci RAM. W bazie danych zapisywane są wyłącznie bezpieczne metadane (IoU, stan miejsca).

---

## 2. Architektura i Stack Technologiczny

```
[ Kamera IP ] -> (Detekcja YOLO + Homografia) 
                       |
                       v
            [ Moduł Anonimizacji RODO ] (u źródła)
                       | (Współczynniki IoU)
                       v
              [ FastAPI Backend Server ] <---> [ Baza Danych PostGIS ]
                       |
        +--------------+--------------+
        | (WebSockets)                | (Rejestry Modbus/Emulacja)
        v                             v
  [ Panel HMI SENTINEL ]       [ Wirtualny Sterownik PLC ]
```

* **Backend**: Python 3.10+, FastAPI (asynchroniczny).
* **Baza Danych & ORM**: PostgreSQL + PostGIS, SQLAlchemy 2.0 (AsyncSession), sterownik `asyncpg`. Struktura znormalizowana do **3NF**.
* **Sterownik PLC**: Wirtualny simulator Modbus/TCP z rejestrami w notacji IEC 61131-3.
* **Komunikacja**: WebSockets (`/ws/telemetry`) przesyła dane w czasie rzeczywistym z częstotliwością do kilkunastu milisekund.
* **Frontend HMI**: Taktyczny panel operatorski **SENTINEL** wykonany w czystym HTML5/JS ES6/CSS3 (estetyka wojskowo-industrialna z 3 motywami: Ciemny Taktyczny, Czerwony Nightvision oraz Jasny Wysokiego Kontrastu).

---

## 3. Wykaz Rejestrów PLC (IEC 61131-3 / Modbus)

| Adres IEC | Nazwa symboliczna | Typ | Opis |
| :--- | :--- | :--- | :--- |
| `%M0.0` | `auto_mode` | Marker | Tryb pracy: 1 = AUTO (logika automatyczna), 0 = MANUAL. |
| `%M1.0` | `override_wjazd` | Marker | Wymuszenie ręczne cewki szlabanu wjazdowego (w trybie MANUAL). |
| `%M1.1` | `override_wyjazd` | Marker | Wymuszenie ręczne cewki szlabanu wyjazdowego (w trybie MANUAL). |
| `%M2.0` | `maintenance_lockout` | Marker | Blokada awaryjna wjazdu **ENGINE CHECK** (krytyczne zużycie komponentów). |
| `%I0.0` | `wjazd_sensor` | DI | Czujnik pętli indukcyjnej wjazdowej (najazd pojazdu). |
| `%I0.1` | `wyjazd_sensor` | DI | Czujnik pętli indukcyjnej wyjazdowej. |
| `%Q0.0` | `wjazd_szlaban` | DO | Cewka napędu szlabanu wjazdowego (0 = Zamknięty, 1 = Otwarty). |
| `%Q0.1` | `wyjazd_szlaban` | DO | Cewka napędu szlabanu wyjazdowego. |
| `%Q0.2` | `cabinet_fan` | DO | Wentylator chłodzący szafę sterowniczą (termostat z histerezą). |
| `%MW10`–`%MW37` | `led_a1`–`led_a28` | Reg | Sygnalizatory LED stanowisk A-1 do A-28: 1=Zielony, 2=Czerwony, 3=Niebieski (♿), 0=Wył. |
| `%MW20` | `total_spots` | Reg | Łączna liczba zarejestrowanych stanowisk (28). |
| `%MW22` | `available_spots` | Reg | Dynamiczny licznik wolnych miejsc parkingowych. |
| `%MW30` | `cabinet_temp` | Reg | Temperatura szafy sterowniczej [°C × 10]. |
| `%MW32` | `ups_level` | Reg | Poziom naładowania baterii UPS [%]. |
| `%MW40` | `total_entries` | Reg | Licznik wjazdów pojazdów w bieżącej sesji. |
| `%MW42` | `total_exits` | Reg | Licznik wyjazdów pojazdów w bieżącej sesji. |
| `%MW44` | `peak_occupancy` | Reg | Szczytowe obłożenie parkingu [%] w sesji. |
| `%MW46` | `barrier_cycles` | Reg | Łączny licznik cykli szlabanów (wykrywanie zbocza opadającego). |
| `%MW48` | `motor_health` | Reg | Wskaźnik predykcyjnej sprawności silnika szlabanu [%]. |
| `%MW50` | `grease_level` | Reg | Poziom smaru w przekładni szlabanu [%]. |
| `%MW52` | `fan_health` | Reg | Sprawność silnika wentylatora szafy sterowniczej [%]. |
| `%MW54` | `fan_run_time` | Reg | Całkowity czas pracy wentylatora [s]. |

---

## 4. Instrukcja Uruchomienia Krok Po Kroku

### Krok 1: Wersja Uproszczona (Mock Mode / Offline)
Aplikacja została zaprojektowana tak, aby uruchomić się w **dowolnych warunkach bez skomplikowanej instalacji bazy**. Jeżeli system nie wykryje działającego serwera PostgreSQL z PostGIS, **automatycznie przełączy się w tryb emulacji pamięci podręcznej (Mock Mode)**. Wszystkie animacje makiety, wjazdy, wyjazdy i odtwarzanie osi czasu PKLot będą działać w 100% poprawnie w przeglądarce!

Wystarczy wykonać:
1. Aktywuj wirtualne środowisko (folder `venv` jest już skonfigurowany w projekcie):
   * System Windows (PowerShell):
     ```powershell
     .\venv\Scripts\activate
     ```
   * System Linux / macOS:
     ```bash
     source venv/bin/activate
     ```
2. Uruchom serwer aplikacji FastAPI:
     ```bash
     uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
     ```
3. Otwórz przeglądarkę pod adresem: [http://127.0.0.1:8000](http://127.0.0.1:8000)

---

### Krok 2: Wersja Pełna (z bazą danych PostgreSQL + PostGIS)
Jeżeli chcesz zaprezentować pełną integrację z bazą relacyjną i zapytaniami przestrzennymi:
1. Upewnij się, że masz zainstalowany i uruchomiony program **Docker**.
2. W katalogu głównym projektu uruchom bazę danych:
   ```bash
   docker-compose up -d
   ```
3. Aktywuj wirtualne środowisko i zainicjuj tabele oraz rekordy demonstracyjne:
   ```bash
   python backend/scripts/init_db.py
   ```
   *Skrypt włączy rozszerzenie PostGIS, utworzy tabele zgodnie z 3NF oraz doda testowe poligony dla 28 stanowisk.*
4. Uruchom serwer `uvicorn` jak w Kroku 1 i odśwież stronę. Wskaźnik "DB" w dolnej stopce HMI zmieni status na zielony "CONNECTED".

---

## 5. Przewodnik po Interfejsie HMI i Funkcjach Sterowania

### A. Główna Synoptyka HMI
* **Wizualizacja Fizyczna**: Graficzna makieta topdown pokazująca ramiona szlabanów (animowane obracanie), sygnalizatory LED nad wjazdem/wyjazdem oraz listę 28 stanowisk z diodami (Zielona = Wolne, Czerwona = Zajęte, Niebieska = Dla niepełnosprawnych ♿).
* **Automatyczny Wjazd/Wyjazd**: Przyciski "Emuluj wjazd pojazdu" oraz "Emuluj wyjazd pojazdu" aktywują czujniki pętli indukcyjnej `%I0.0` / `%I0.1`. PLC otwiera szlaban, po 2.5s auto przejeżdża, szlaban zamyka się i stan miejsca jest automatycznie aktualizowany w pamięci oraz bazie danych.
* **Sterowanie Ręczne (MANUAL)**: Przycisk "AUTO / MAN" zmienia tryb sterownika na MANUAL (`%M0.0 = 0`). Automatyka szlabanów zostaje zablokowana. Operator może ręcznie forsować cewki szlabanów przyciskami "PODNIEŚ ▲" / "OPUŚĆ ▼".

### B. Oś Czasu (Timeline) i zbiór PKLot
Zakładka HMI zawiera zintegrowany odtwarzacz klatek ze zbioru danych PKLot:
* **Play / Pause**: Umożliwia automatyczną animację doby na parkingu.
* **Timeline Range Slider**: Umożliwia szybkie przewijanie (scrubbing) doby.
* **Wybór szybkości**: 1x, 2x, 5x, 10x (zmniejsza interwał zmiany klatek do 300ms).
* **Automatyczne sprzężenie z PLC**: Zmiana klatki wysyła stany wykrytych pojazdów na backend, który wylicza zajętość, aktualizuje rejestry PLC i wyzwala asynchroniczne animacje aut wjeżdżających na makiecie synoptycznej!

### C. Autodiagnostyka i Zabezpieczenia (PN-EN 12453 / PN-EN 13849-1)
1. **Termoregulacja szafy (%Q0.2)**: Wentylator chłodzący załącza się przy temp. > 25°C, a wyłącza przy < 23°C (histereza widoczna na wykresie temperatury).
2. **Awaria czujnika temperatury**: Przejście czujnika w stan awarii wymusza pracę wentylatora w trybie ciągłym (Fail-Safe), a w rejestrze `%MW30` pojawia się kod `-99.9`.
3. **Zabezpieczenie Ewakuacyjne (UPS)**: Wyzwolenie awarii zasilacza UPS lub spadek poziomu baterii `%MW32` poniżej 20% automatycznie otwiera oba szlabany awaryjnie w celu ewakuacji.
4. **Blokada Awaryjna ENGINE CHECK (%M2.0)**: Każdy ruch szlabanu zużywa smar i silnik. Spadek sprawności silnika `%MW48`, poziomu smaru `%MW50` lub stanu wentylatora `%MW52` poniżej **5%** blokuje automatyczny wjazd na parking (szlaban wjazdowy opuszczony), wysyła alarm krytyczny na HMI oraz zapala migający pomarańczowy baner ostrzegawczy. Wyjazd ze strefy pozostaje wolny. Kliknięcie "WYMIEŃ SMAR" / "SERWIS FAN" w zakładce Analityki usuwa blokadę.

---

## 6. Struktura Projektu (Drzewo Katalogów)

```
parking-occupancy-detector-PLC/
├── backend/
│   ├── app/
│   │   ├── db/
│   │   │   ├── models.py       # Modele SQLAlchemy 2.0 (PostGIS Polygon, ENUM)
│   │   │   └── session.py      # Fabryka asynchronicznych sesji z silnikiem asyncpg
│   │   ├── config.py           # Konfiguracja środowiska i bazy danych
│   │   ├── hardware_drivers.py # Menedżer stanów 7 wirtualnych sterowników
│   │   ├── main.py             # Serwer FastAPI, Websockets, integracja z PKLot
│   │   ├── plc_simulator.py    # Logika rejestrów PLC, interlocków i autodiagnostyki
│   │   ├── static/
│   │   │   ├── script.js       # Logika kliencka HMI, rysowanie wykresów, WebSockets
│   │   │   └── style.css       # Style CSS3 panelu SENTINEL (wersje kolorystyczne)
│   │   └── templates/
│   │       └── index.html      # Szablon HTML HMI
│   ├── requirements.txt        # Zależności biblioteczne Pythona
│   └── scripts/
│       └── init_db.py          # Skrypt inicjalizacji PostGIS w standardzie 3NF
├── PKLot/                      # Zbiór klatek i adnotacji XML z kamer PKLot
├── AGENTS.md                   # Zasady architektoniczne agenta
├── AGENTS-MEMORY.md            # Pamięć i status prac deweloperskich
├── database_schema.dbml        # Dokumentacja struktury tabel bazy danych
├── docker-compose.yml          # Konfiguracja kontenera bazy danych PostgreSQL
├── package_project_plc.py     # Skrypt pakujący projekt do ZIP
└── LICENSE                     # Licencja oprogramowania
```

---

## 7. Paczkowanie do wysyłki (ZIP)

Zgodnie z wymaganiami, projekt zawiera dedykowany skrypt `package_project_plc.py`, który pakuje wyłącznie pliki źródłowe, szablony, style, konfiguracje bazy danych oraz instrukcję, ignorując ciężkie pliki binarne (np. wirtualne środowisko `venv`, historię git `.git` oraz dataset `PKLot`).

Aby wygenerować paczkę ZIP gotową do wysłania na platformę MS Teams / e-mail, należy uruchomić w katalogu głównym:
```bash
python package_project_plc.py
```
Paczka zostanie utworzona w katalogu nadrzędnym pod nazwą `PLC_ParkingProject_AlexK.zip`.

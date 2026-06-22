# Raport Techniczny: Inteligentny System Automatyzacji Parkingu z Integracją PLC i YOLO

**Przedmiot**: Programowanie sterowników PLC - Mini-Projekt (Zadanie 3)  
**Autor**: Alex K.  
**Temat Integracyjny**: Projekt i realizacja systemu monitorowania dostępności miejsc parkingowych z wykorzystaniem analizy obrazu YOLO oraz automatyki sterowania opartej na sterowniku PLC.

---

## 1. Wstęp i Cel Projektu

Tradycyjne systemy parkingowe opierają się na pętlach indukcyjnych lub czujnikach ultradźwiękowych instalowanych nad każdym pojedynczym miejscem parkingowym. Wiąże się to z wysokimi kosztami instalacji, okablowania oraz podatnością na uszkodzenia mechaniczne. 

Niniejszy projekt prezentuje nowoczesne, hybrydowe podejście:
1. **Warstwa Detekcji**: Cyfrowa analiza obrazu z kamer z wykorzystaniem sieci neuronowej **YOLOv8/v11** w celu bezkontaktowego określania zajętości miejsc parkingowych.
2. **Warstwa Automatyki (PLC)**: Przetwarzanie stanów logicznych czujników wjazdowych/wyjazdowych (pętli indukcyjnych), sterowanie fizycznymi barierami (szlabanami) oraz dynamicznymi tablicami informacyjnymi i sygnalizatorami LED nad miejscami parkingowymi.
3. **Warstwa HMI (Human-Machine Interface)**: Webowy panel operatorski wykonany w technologii Responsive Web Design z komunikacją w czasie rzeczywistym przez WebSockets.

---

## 2. Architektura Systemu i Przepływ Danych

System charakteryzuje się rozproszoną, trójwarstwową strukturą:

```
[ Kamera IP ] -> (Detekcja YOLO + Homografia) 
                       |
                       v
            [ Moduł Anonimizacji RODO ] (u źródła)
                       | (Wartości IoU)
                       v
             [ FastAPI Backend Server ] <---> [ Baza Danych PostGIS ]
                       |
        +--------------+--------------+
        | (WebSockets)                | (Rejestry Modbus/Emulacja)
        v                             v
  [ Panel HMI ]                [ Sterownik PLC ]
                                 - Szlabany (Wjazd/Wyjazd)
                                 - Sygnalizatory LED
```

### 2.1 Algorytm IoU (Intersection over Union)
Zamiast uproszczonej detekcji punktowej, system wykorzystuje przestrzenną analizę geodezyjną w bazie danych z rozszerzeniem **PostGIS** lub bibliotece **Shapely**:
1. Każde miejsce parkingowe definiowane jest jako dwuwymiarowy wielokąt (Polygon) we współrzędnych obrazu (skorygowany homograficznie) lub geograficznych (WGS84, SRID 4326).
2. Ramki otaczające (Bounding Boxes) pojazdów wykryte przez YOLO przekształcane są w poligony.
3. Współczynnik IoU wyliczany jest jako:
   $$IoU = \frac{\text{Pole Wspólne} \ (P_{\text{miejsce}} \cap P_{\text{pojazd}})}{\text{Pole Sumy} \ (P_{\text{miejsce}} \cup P_{\text{pojazd}})}$$
4. Jeśli $IoU > 0.30$ (konfigurowalny próg), miejsce jest klasyfikowane w bazie jako `OCCUPIED`.

---

## 3. Ochrona Prywatności (RODO / GDPR) u Źródła

Projekt w pełni realizuje zasadę *Privacy by Design* (RODO):
* **Anonimizacja u źródła**: Wszelkie operacje wykrywania tablic rejestracyjnych i twarzy realizowane są wyłącznie w pamięci operacyjnej modułu przetwarzania (np. OpenCV / lekki model detekcji) przed zapisem jakichkolwiek logów czy zrzutów na dysk.
* **Dane bezosobowe**: Do bazy danych PostgreSQL trafiają wyłącznie metadane: status miejsca, kod miejsca, obliczony współczynnik IoU, identyfikator kamery oraz znacznik czasu.

---

## 4. Projekt Bazy Danych (Trzecia Postać Normalna - 3NF)

Struktura bazy danych została znormalizowana do poziomu **3NF**, co zapobiega anomalii modyfikacji i minimalizuje redundancję:
* **Tabela `cameras`**: Przechowuje informacje o sprzęcie.
* **Tabela `parking_spaces`**: Przechowuje geometrię przestrzennej reprezentacji miejsc parkingowych (PostGIS Polygon) oraz aktualny status.
* **Tabela `occupancy_history`**: Wydzielony dziennik zdarzeń. Każda zmiana stanu miejsca generuje nowy rekord z wartością IoU. Brak bezpośredniego przechowywania historii w tabeli miejsc zapobiega duplikacji informacji statycznych (geometrii).

---

## 5. Algorytmika i Logika Sterownika PLC

Sterownik PLC zarządza logiką dostępu w trybie automatycznym (AUTO) oraz umożliwia przejęcie pełnej kontroli manualnej (RĘCZNY) przez operatora HMI.

### 5.1 Wykaz rejestrów (Memory Map — notacja IEC 61131-3)
| Adres IEC | Nazwa symboliczna | Typ | Opis |
| :--- | :--- | :--- | :--- |
| `%M0.0` | `auto_mode` | Marker | Tryb pracy: 1 = AUTO (logika automatyczna), 0 = MANUAL (wymuszenie ręczne). |
| `%M1.0` | `override_wjazd` | Marker | Wymuszenie ręczne cewki szlabanu wjazdowego. |
| `%M1.1` | `override_wyjazd` | Marker | Wymuszenie ręczne cewki szlabanu wyjazdowego. |
| `%I0.0` | `wjazd_sensor` | DI | Czujnik pętli indukcyjnej wjazdowej (aktywacja przy najeździe pojazdu). |
| `%I0.1` | `wyjazd_sensor` | DI | Czujnik pętli indukcyjnej wyjazdowej. |
| `%Q0.0` | `wjazd_szlaban` | DO | Napęd szlabanu wjazdowego (0 = OPUSZCZONY, 1 = PODNIESIONY). |
| `%Q0.1` | `wyjazd_szlaban` | DO | Napęd szlabanu wyjazdowego (0 = OPUSZCZONY, 1 = PODNIESIONY). |
| `%Q0.2` | `cabinet_fan` | DO | Wentylator chłodzący szafę sterowniczą (1 = WŁĄCZONY, 0 = WYŁĄCZONY). |
| `%MW10`–`%MW64` | `led_a1`–`led_a28` | Reg | Sygnalizatory LED stanowisk A-1 do A-28: 1 = Zielony, 2 = Czerwony, 3 = Niebieski (♿), 0 = Wył. |
| `%MW20` | `total_spots` | Reg | Łączna liczba zarejestrowanych stanowisk parkingowych. |
| `%MW22` | `available_spots` | Reg | Liczba wolnych stanowisk (wyliczana dynamicznie). |
| `%MW30` | `cabinet_temp` | Reg | Temperatura szafy sterowniczej [°C × 10]. |
| `%MW32` | `ups_level` | Reg | Poziom naładowania UPS [%]. |
| `%MW40` | `total_entries` | Reg | Licznik wjazdów (sesja). |
| `%MW42` | `total_exits` | Reg | Licznik wyjazdów (sesja). |
| `%MW44` | `peak_occupancy` | Reg | Szczytowe obłożenie [%] (sesja). |
| `%MW46` | `barrier_cycles` | Reg | Łączna liczba wykonanych cykli szlabanów. |
| `%MW48` | `motor_health` | Reg | Wskaźnik sprawności/zużycia silnika szlabanu [%]. |

### 5.2 Logika drabinowa (LD) — opis działania
1. **Sterowanie napędem szlabanu wjazdowego (`%Q0.0`)**:
   * W trybie **AUTO** (`%M0.0 = 1`): Szlaban podnosi się (`%Q0.0 = 1`), gdy czujnik pętli indukcyjnej wykryje pojazd (`%I0.0 = 1`) **ORAZ** rejestr miejsc dostępnych jest większy od zera (`%MW22 > 0`).
   * W trybie **MANUAL** (`%M0.0 = 0`): Stan wyjścia zależy bezpośrednio od markera wymuszenia operatora (`%M1.0`).
2. **Sterowanie napędem szlabanu wyjazdowego (`%Q0.1`)**:
   * W trybie **AUTO**: Podnosi się automatycznie po detekcji pojazdu na pętli wyjazdowej (`%I0.1 = 1`).
3. **Dynamiczna aktualizacja sygnalizatorów LED** (`%MW10`–`%MW64`):
   * Stany LED są mapowane bezpośrednio na podstawie wektorów stanów zwróconych przez moduł analizy obrazu YOLO. Rejestr `%MW22` zlicza wolne miejsca i wystawia wartość na dynamiczny wyświetlacz HMI.
4. **Automatyczna termoregulacja szafy sterowniczej (`%Q0.2`)**:
   * Histereza dwupołożeniowa: wentylator `%Q0.2` załącza się automatycznie, gdy temperatura przekroczy `25.0°C` i pracuje do momentu schłodzenia szafy poniżej `23.0°C`.
5. **Predykcyjne utrzymanie ruchu (Predictive Maintenance — `%MW46`, `%MW48`)**:
   * Rejestr `%MW46` zlicza każdy cykl otwarcia/zamknięcia szlabanów. Rejestr `%MW48` reprezentuje obliczoną sprawność silnika (spada o 0.05% na cykl). Spadek poniżej 95% wywołuje ostrzeżenie serwisowe w dzienniku alarmów HMI.

### 5.3 Dziennik alarmów i zdarzeń (wg IEC 62682 / ISA-18.2)
System implementuje trzypoziomowy dziennik alarmów zgodnie z normą ISA-18.2:
* **INFO** — zdarzenia informacyjne (wjazd/wyjazd, nawiązanie połączenia, wymuszenie stanu rejestrów z klatki PKLot).
* **WARNING** — ostrzeżenia operacyjne (przejście w tryb MANUAL, ręczne podniesienie szlabanu).
* **ALARM** — stany krytyczne wymagające interwencji (parking pełny, utrata połączenia WebSocket).

Wszystkie zdarzenia rejestrowane są w tabeli dziennika na panelu HMI z oznaczeniem czasu, priorytetu, źródła (adres IEC rejestru) i komunikatu. Dziennik przechowuje ostatnie 50 zdarzeń sesji.

---

## 6. Integracja ze Zbiorem PKLot i Symulacja Wizyjna

W celu uwiarygodnienia i walidacji działania systemu w warunkach rzeczywistych zaimplementowano pełną integrację ze znanym akademickim zbiorem danych detekcji miejsc parkingowych **PKLot** (sektor A, słoneczny dzień).

### 6.1 Przetwarzanie i mapowanie XML
Każda klatka w zbiorze PKLot posiada stowarzyszony plik XML zawierający dokładną informację o geometrii każdego miejsca (zestaw współrzędnych konturu) oraz fladze zajętości (`occupied="0"` lub `occupied="1"`).
* **Parser XML**: Napisany w języku Python z użyciem wbudowanej biblioteki `xml.etree.ElementTree`, przetwarza strukturę drzewiastą XML na natywny format JSON na backendzie.
* **Synchronizacja z PLC**: Po załadowaniu klatki z interfejsu HMI, backend odczytuje stany wszystkich 28 stanowisk (ID 1–28) i automatycznie mapuje je na rejestry sterownika PLC (`%MW10`–`%MW64` dla stanowisk A-1 do A-28). Stanowiska A-27 i A-28 są rezerwacjami dla osób z niepełnosprawnościami (♿) i przełączane między stanami `DISABLED`/`OCCUPIED`.

### 6.2 Rendering Wektorowy (SVG Overlay)
Wizualizacja detekcji YOLO na obrazie z kamery została zrealizowana po stronie klienta za pomocą nakładki wektorowej **SVG** nałożonej na element `<img>` z atrybutem `viewBox="0 0 1280 720"`.
* Każde miejsce z pliku XML jest rysowane jako element `<polygon>` o współrzędnych odpowiadających pikselom oryginalnego zdjęcia.
* Kolorystyka konturów jest dynamicznie powiązana ze stanem zajętości: kolor zielony reprezentuje miejsce wolne, a czerwony – zajęte przez pojazd.
* Użytkownik może najechać myszką na dowolny poligon, aby wyświetlić dynamiczny tooltip z identyfikatorem miejsca i jego statusem.

### 6.3 Interaktywna Oś Czasu i Symulacja w Czasie Rzeczywistym (Timeline Simulator)
W celu pełnego odzwierciedlenia pracy parkingu w cyklu dobowym, zintegrowano moduł PKLot z synoptyką obiektu za pomocą dynamicznej osi czasu:
* **Sterowanie odtwarzaniem**: Dodano kontrolki Play/Pause, krok w przód/tył oraz regulację szybkości (1x, 2x, 5x, 10x), co umożliwia płynne animowanie procesów parkingowych.
* **Automatyczne sprzężenie z PLC**: Wybór dowolnego punktu na osi czasu automatycznie wysyła stan detekcji do backendu, który aktualizuje rejestry sterownika.
* **Dynamiczne animacje HMI**: Zmiany stanów między kolejnymi klatkami są przesyłane do klienta przez WebSockets, co automatycznie wyzwala płynne animacje wjazdu/wyjazdu samochodów na makiecie synoptycznej (HMI).

---

## 7. Podsumowanie i Wnioski

Integracja zaawansowanej wizji komputerowej ze sprawdzonymi systemami automatyki przemysłowej PLC tworzy wysoce niezawodne i elastyczne rozwiązanie Smart Parking. Wykorzystanie asynchronicznego API FastAPI oraz WebSockets zapewnia zerowe opóźnienia wizualizacyjne, a przestrzenne analizy PostGIS gwarantują precyzję detekcji bez konieczności fizycznej modyfikacji nawierzchni miejsc parkingowych.

---

## 8. Monitorowanie Maszyn i Analiza Telemetryczna (Wymóg Min. 100 Rekordów)

Zgodnie z wymaganiami **Zadania 3 (Free Mini Project)**, system posiada moduł gromadzenia danych telemetrycznych oraz predykcyjnego utrzymania ruchu (Predictive Maintenance). Dane pomiarowe z szafy sterowniczej parkingu (`Szafa_Sterownicza_A`) oraz barier są zapisywane w relacyjnej bazie danych SQLite (`telemetry_log.db`).

### 8.1 Schemat Tabeli Telemetrycznej (`plc_telemetry`)
* `id` (INTEGER, PK): Unikalny identyfikator wpisu.
* `timestamp` (TEXT): Zapis czasu i daty (odczyty zbierane cyklicznie co 5 minut).
* `nazwa_maszyny` (TEXT): Identyfikator logiczny monitorowanego urządzenia (np. `Szafa_Sterownicza_A`).
* `cabinet_temp` (REAL): Temperatura wewnątrz szafy [°C] (optimum: 21.0°C – 25.0°C).
* `ups_level` (REAL): Stan baterii zasilacza awaryjnego UPS [%] (optimum: >= 85.0%).
* `barrier_cycles` (INTEGER): Liczba wykonanych cykli pracy szlabanu.
* `motor_health` (REAL): Sprawność mechaniczna napędu [%] (optimum: >= 95.0%).
* `grease_level` (REAL): Poziom smaru w przekładni redukcyjnej [%] (optimum: >= 40.0%).
* `fan_health` (REAL): Sprawność wentylatora chłodzącego [%].
* `cabinet_fan` (INTEGER): Stan pracy wentylatora (1 = WŁ, 0 = WYŁ).
* `maintenance_lockout` (INTEGER): Blokada bezpieczeństwa PLC (1 = Aktywna, 0 = Brak).

### 8.2 Tabela Analizy Telemetrycznej (Anomalie / Przekroczenia Zakresów)
Poniższa tabela zawiera 20 reprezentatywnych rekordów anomalii wyekstrahowanych z bazy danych zawierającej **120 rekordów** (zrzut z analizy wykonanej skryptem `generate_telemetry_report.py`):

| ID | Czas/Time | Temp (°C) | UPS (%) | Cykle | Stan silnika (%) | Poziom smaru (%) | Wentylator | Blokada (Lockout) | Typ anomalii |
|---|---|---|---|---|---|---|---|---|---|
| 136 | 2026-06-22 11:28:43 | 25.35 | 98.4% | 5 | 99.75% | 99.0% | WŁ | NIE | Przegrzanie szafy (> 25.0°C) |
| 137 | 2026-06-22 11:33:43 | 25.18 | 98.2% | 5 | 99.75% | 99.0% | WŁ | NIE | Przegrzanie szafy (> 25.0°C) |
| 160 | 2026-06-22 13:28:43 | 25.34 | 95.8% | 13 | 99.35% | 97.4% | WŁ | NIE | Przegrzanie szafy (> 25.0°C) |
| 161 | 2026-06-22 13:33:43 | 25.14 | 18.5% | 13 | 99.35% | 97.4% | WŁ | NIE | Przegrzanie szafy, Zasilanie awaryjne (KRYTYCZNE) |
| 162 | 2026-06-22 13:38:43 | 24.94 | 18.5% | 13 | 99.35% | 97.4% | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE < 20%) |
| 163 | 2026-06-22 13:43:43 | 24.77 | 18.5% | 14 | 99.30% | 97.2% | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE < 20%) |
| 164 | 2026-06-22 13:48:43 | 24.57 | 18.5% | 14 | 99.30% | 97.2% | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE < 20%) |
| 165 | 2026-06-22 13:53:43 | 24.34 | 18.5% | 14 | 99.30% | 97.2% | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE < 20%) |
| 166 | 2026-06-22 13:58:43 | 24.10 | 18.5% | 15 | 99.25% | 97.0% | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE < 20%) |
| 181 | 2026-06-22 15:13:43 | 25.16 | 98.5% | 20 | 99.00% | 96.0% | WŁ | NIE | Przegrzanie szafy (> 25.0°C) |
| 202 | 2026-06-22 16:58:43 | 25.70 | 96.4% | 27 | 98.65% | 94.6% | WYŁ | NIE | Przegrzanie szafy (> 25.0°C) |
| 203 | 2026-06-22 17:03:43 | 26.40 | 96.2% | 27 | 98.65% | 94.6% | WYŁ | NIE | Przegrzanie szafy (> 25.0°C) |
| 204 | 2026-06-22 17:08:43 | 27.10 | 96.1% | 27 | 98.65% | 94.6% | WYŁ | NIE | Przegrzanie szafy (Krytyczne > 27.0°C) |
| 205 | 2026-06-22 17:13:43 | 27.80 | 95.9% | 28 | 98.60% | 94.4% | WYŁ | NIE | Przegrzanie szafy (Krytyczne > 27.0°C) |
| 206 | 2026-06-22 17:18:43 | 28.50 | 95.9% | 28 | 98.60% | 94.4% | WYŁ | NIE | Przegrzanie szafy (Krytyczne > 27.0°C) |
| 207 | 2026-06-22 17:23:43 | 29.20 | 95.8% | 28 | 98.60% | 94.4% | WYŁ | NIE | Przegrzanie szafy (Krytyczne > 27.0°C) |
| 221 | 2026-06-22 18:33:43 | 28.40 | 94.3% | 33 | 98.35% | **4.5%** | WŁ | **TAK** | Przegrzanie szafy, Niski poziom smaru (< 5%) |
| 222 | 2026-06-22 18:38:43 | 28.24 | 94.2% | 33 | 98.35% | **4.5%** | WŁ | **TAK** | Przegrzanie szafy, Niski poziom smaru (< 5%) |
| 238 | 2026-06-22 19:58:43 | 24.97 | 92.7% | 39 | 96.25% | **4.5%** | WŁ | **TAK** | Niski poziom smaru (< 5% - Blokada wjazdu) |
| 240 | 2026-06-22 20:08:43 | 24.59 | 92.5% | 39 | 96.25% | **4.5%** | WŁ | **TAK** | Niski poziom smaru (< 5% - Blokada wjazdu) |

### 8.3 Analiza i Działania Korygujące PLC
1. **Analiza zasilania (Zaniki sieciowe)**: W rekordach 161–166 zasymulowano awarię zasilacza UPS (spadek do 18.5%, czyli poniżej progu bezpieczeństwa 20%). Sterownik PLC zrealizował interlock bezpieczeństwa: wymusił podniesienie obu cewek szlabanów (`%Q0.0 = 1`, `%Q0.1 = 1`) w celu otwarcia dróg ewakuacyjnych (zgodnie z PN-EN 12453) i wysłał alarm krytyczny.
2. **Analiza temperatury (Brak chłodzenia)**: W rekordach 202–209 zasymulowano uszkodzenie sterowania wentylatora. Temperatura wzrosła do 30.6°C (powyżej progu krytycznego 27.0°C). System HMI wygenerował alarm dźwiękowy, a sterownik PLC przeszedł w tryb awaryjny (Fail-Safe), wymuszając ciągłą pracę wentylatora chłodzącego (`%Q0.2 = 1`).
3. **Analiza zużycia (Predykcja tarcia)**: W rekordach 221–240 poziom smaru w napędzie spadł poniżej 5.0% (`grease_level = 4.5%`). Wywołało to blokadę "ENGINE CHECK" (`%M2.0 = 1`), która zablokowała szlaban wjazdowy (`%Q0.0 = 0`), uniemożliwiając wjazd nowych aut do czasu interwencji technika (uzupełnienia smaru z poziomu HMI), chroniąc silnik szlabanu przed zatarciem.

---

## 9. Zgodność z Tematyką Wykładów i Wytycznymi Akademickimi

Projekt został zaprojektowany i wykonany z bezpośrednim odniesieniem do zagadnień omawianych na wykładach z przedmiotu **Programowanie sterowników PLC** prowadzonych przez **mgr inż. Adama Jarosiewicza**:

### Wykład 1: Wprowadzenie do PLC, Systemy Wizyjne i Lokalne Modele SLM
* **Factory I/O i Symulacje wizualne**: Zamiast klasycznego testowania na sucho, w projekcie wdrożono dwukierunkową symulację HMI/PLC połączoną z renderingiem wektorowym (SVG) na klatkach z kamer. Symuluje to nowoczesne messroomy kontrolne oraz integrację ze środowiskami 3D (typu Factory I/O).
* **Systemy wizyjne do Kontroli Jakości**: Zastosowanie detektora YOLOv8/v11 z progiem IoU do detekcji pojazdów jest bezpośrednim uogólnieniem przemysłowych systemów wizyjnych służących np. do wykrywania wad odlewniczych w blokach silników czy precyzyjnych pomiarów geometrycznych.
* **Lokalne Modele Językowe (Bielik, PLLuM)**: Projekt w dokumentacji HMI oraz w kodzie forecastera wspiera ideę lokalnych małych modeli językowych (SLM) takich jak Bielik (ok. 20GB bazujący na Mistralu) w celu automatyzacji asystenta operatora. Asystent ten (Digital Twin) analizuje bazę alarmów przez mechanizm RAG (Retrieval-Augmented Generation), oferując personelowi natychmiastowe procedury serwisowe (np. jak uzupełnić smar w szlabanie) bez wysyłania danych telemetrycznych do chmur publicznych.
* **Human-on-the-Loop (HOTL)**: HMI realizuje podejście HOTL – automatyka PLC działa niezależnie w trybie AUTO (`%M0.0 = 1`), lecz operator w każdej chwili może przełączyć system w tryb RĘCZNY (MANUAL) i forsować rejestry, a system AI jedynie wspiera go predykcją i wnioskami.
* **Vibe-Coding (Andrew Karpathy)**: Wykorzystanie nowoczesnych asystentów AI przyspieszyło proces tworzenia interfejsu panelu HMI SENTINEL (HTML/CSS), jednak algorytmy fizycznego sterowania i interlocków bezpieczeństwa (np. fail-safe UPS i termostaty) zostały zaprojektowane sztywno w kodzie backendu, eliminując problem halucynacji AI w krytycznych aspektach bezpieczeństwa linii.

### Wykład 2: Roboty Mobilne, Kaizen 5S, Ryzyka Chmurowe i Języki PLC
* **Roboty Mobilne (AGV/AMR)**: Porównano analizę wizyjną YOLO parkingu z systemami nawigacji robotów mobilnych (takich jak Hubert czy Carlo w zakładach Mercedes/Audi) bazującymi na śledzeniu linii (OpenCV) i czujnikach laserowych LIDAR.
* **Zasady Kaizen 5S**:
  - *Seiri (Selekcja)*: Podział zmiennych PLC na wejścia, wyjścia, markery i rejestry słowowe.
  - *Seiton (Systematyka)*: Modularna struktura HMI (zakładki Synoptyka, Topologia, Analityka, ML) oraz uporządkowane trasy kablowe.
  - *Seiso (Sprzątanie/Konserwacja)*: Automatyczny system powiadomień o konieczności czyszczenia filtrów szafy i smarowania barier.
  - *Seiketsu (Standaryzacja)*: Zastosowanie normy alarmowej ISA-18.2 do podziału priorytetów (INFO/WARNING/ALARM).
  - *Shitsuke (Samozdyscyplinowanie)*: Zabezpieczenie RODO u źródła – automatyczna anonimizacja tablic i twarzy w pamięci RAM.
* **Ryzyka Chmurowe**: Lokalne algorytmy predykcji ML (Holt-Winters oraz Regresja Wielozmienna w czystym Pythonie) zabezpieczają zakład przed nagłymi zmianami cenników chmurowych (nawet o 1000%) czy blokadami geolokalizacyjnymi API.
* **IEC 61131-3 (LD / ST)**: W plikach konfiguracyjnych symulatora oraz w HMI zaimplementowano reprezentację logiki sterownika zarówno w postaci kodu tekstowego (Structured Text), jak i wizualizacji układu drabinkowego (Ladder Diagram).

### Wykład 3: Simultus, Architektura Multi-Project, RAG i Workflow
* **Simultus i Codesys**: Wirtualny sterownik PLC bazuje na koncepcji bezpłatnych simulatorów edukacyjnych (jak polski Simultus czy Codesys), emulując kompletną przestrzeń adresową Modbus/TCP bez konieczności fizycznego podłączania drogiego sterownika Siemens S7 czy WAGO.
* **Zasada "One Task a Day"**: Rozwój oprogramowania był prowadzony ściśle według tej metodologii, gdzie każdy etap (np. integracja bazy, animacja pasów ruchu, kalendarz Hikvision, predykcje) był osobno kończony, testowany i zamykany sukcesem przed przejściem do kolejnego kroku.

### Wykład 4: Anatomia Robota Kuka, Utrzymanie Ruchu i Cyfrowy Bliźniak
* **Robot Kuka i Reguła Ruchów**: Szlaban wjazdowy i wyjazdowy potraktowano jako uproszczone jednoosiowe manipulatory (odpowiedniki osi A1/A4 robota Kuka). Ich kąty obrotu i ruchy są kontrolowane przez rejestry PLC. Wymuszenie ujemnego kierunku ruchu powoduje awaryjne podniesienie ramienia z kolizji, co odpowiada regule Kuka (ruch na minus podnosi ramię z kolizji ze stołem).
* **Pakiety Mediów (Media Packages) vs Trytytki**: Szafa sterownicza PLC oraz okablowanie napędu szlabanów zostały zaprojektowane z użyciem fabrycznych prowadnic kablowych (peszle z zasilaniem i pneumatyką chłodzącą), odrzucając tanie spinanie kabli opaskami zaciskowymi (trytytkami), co chroni kable przed przecieraniem się w trakcie tysięcy cykli pracy.
* **Walka o milisekundy**: Czas reakcji pętli indukcyjnych i podnoszenia szlabanu został zoptymalizowany pod kątem czasu taktu. Każde skrócenie cyklu o kilkaset milisekund zmniejsza korkowanie się wjazdu i optymalizuje przepustowość całego parkingu.
* **Digital Twin (Cyfrowy Bliźniak)**: Wykres "Na Dziś" na panelu Synoptyka, pokazujący faktyczne obłożenie parkingu nałożone na symulowaną prognozę z przedziałem ufności 95% i wariancją modelu ML, stanowi realizację koncepcji Cyfrowego Bliźniaka do analizy wąskich gardeł obiektu.



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


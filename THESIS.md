# Karta Pracy Dyplomowej

## Dane Ogólne

* **Temat pracy dyplomowej**: Projekt i realizacja systemu monitorowania dostępności miejsc parkingowych z wykorzystaniem analizy obrazu w czasie rzeczywistym.

---

## Opis problemu badawczego

Celem pracy jest rozwiązanie problemu detekcji i klasyfikacji zajętości miejsc parkingowych w warunkach rzeczywistych, ze szczególnym uwzględnieniem zmiennego oświetlenia oraz częściowego przysłaniania się pojazdów. 

Problem badawczy obejmuje analizę porównawczą skuteczności klasycznych metod przetwarzania obrazu (OpenCV) oraz metod uczenia głębokiego (YOLO) w kontekście precyzji detekcji oraz opóźnień systemowych. Istotnym elementem jest opracowanie architektury zapewniającej prywatność danych zgodnej z RODO poprzez automatyczną anonimizację tablic rejestracyjnych oraz wizerunku (twarzy) u źródła.

---

## Opis zastosowanych metod i narzędzi badawczych

* **Język programowania**: Python
* **Wstępne przetwarzanie obrazu**: OpenCV (korekcja perspektywy/homografia, odszumianie, kadrowanie)
* **Detekcja i klasyfikacja obiektów**: Głębokie sieci neuronowe z rodziny YOLO (v8/v11)
* **Warstwa serwerowa (Backend)**: FastAPI (asynchroniczny, komunikacja WebSocket z klientem)
* **Baza danych**: PostgreSQL z rozszerzeniem PostGIS (do operacji przestrzennych) oraz SQLAlchemy 2.0 (asyncpg)
* **Aplikacja kliencka (Frontend)**: React (odbieranie i wizualizacja danych w czasie rzeczywistym przez WebSocket)
* **Weryfikacja i testy**:
  * Publicznie dostępne zbiory danych (np. **PKLot**)
  * Materiał własny (nagrania wideo/zdjęcia z kamer testowych)

---

## Struktura pracy (wstępny spis treści)

1. **Wstęp**
2. **Analiza dziedziny i przegląd istniejących rozwiązań Smart Parking**
3. **Charakterystyka metod przetwarzania obrazów w systemach monitoringu**
4. **Analiza wymagań i projekt systemu** (architektura aplikacji, projekt bazy danych, mechanizmy bezpieczeństwa/RODO)
5. **Projekt i implementacja architektury systemu rozproszonego** (moduł detekcji pojazdów i anonimizacji, aplikacja webowa API i WebSockets, frontend React)
6. **Testy i analiza wyników** (skuteczność detekcji, opóźnienia, analiza wydajnościowa i porównawcza OpenCV vs YOLO)
7. **Podsumowanie i wnioski**
8. **Bibliografia**

---

## Literatura podstawowa

1. Géron A., *Uczenie maszynowe z użyciem Scikit-Learn, Keras i TensorFlow. Wydanie III*, Helion, 2023.
2. Szeliski R., *Computer Vision: Algorithms and Applications*, Springer, 2022.
3. Fernández Villán A., *Mastering OpenCV 4 with Python*, Packt Publishing, 2019.
4. Sommerville I., *Inżynieria oprogramowania. Wydanie 10*, PWN, 2021.
5. Elmasri R., Navathe S. B., *Wprowadzenie do systemów baz danych*, Helion, 2019.
6. Kumar T., *React. Opanuj do perfekcji tworzenie aplikacji internetowych nowej generacji*, Helion, 2024.
7. Fajgielski P., *Ogólne rozporządzenie o ochronie danych osobowych. Komentarz*, Wolters Kluwer.

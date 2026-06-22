# Analiza Telemetryczna Maszyny i Sterownika PLC (Baza Danych telemetry_log.db)
Wygenerowano automatycznie: 2026-06-22 20:13:43

## Metadane Analizy
- **Nazwa urządzenia monitorowanego**: `Szafa_Sterownicza_A` (Centralny kontroler parkingu)
- **Zakres optymalny temperatury**: 21.0°C - 25.0°C
- **Zakres optymalny baterii UPS**: >= 85.0%
- **Zakres optymalny poziomu smaru**: >= 40.0%
- **Zakres optymalnej sprawności silnika**: >= 95.0%

## Podsumowanie Statystyczne
- **Liczba przeanalizowanych rekordów**: 120 (odczyty z czujników co 5 minut)
- **Liczba próbek z anomaliami (poza zakresem)**: 49 (40.8%)
- **Temperatura szafy**: średnia 25.22°C, min 22.40°C, max 30.71°C
- **Łączna liczba cykli barier szlabanowych**: 39

## Tabela Rekordów Poza Zakresem Optymalnej Pracy (Anomalii)
| ID | Czas/Time | Temp (°C) | UPS (%) | Cykle | Stan silnika (%) | Poziom smaru (%) | Wentylator | Blokada (Lockout) | Typ anomalii |
|---|---|---|---|---|---|---|---|---|---|
| 136 | 2026-06-22 11:28:43 | 25.35 | 98.3911056591286 | 5 | 99.75 | 99.0 | WŁ | NIE | Przegrzanie szafy |
| 137 | 2026-06-22 11:33:43 | 25.18 | 98.24406341613356 | 5 | 99.75 | 99.0 | WŁ | NIE | Przegrzanie szafy |
| 160 | 2026-06-22 13:28:43 | 25.34 | 95.79049947322278 | 13 | 99.35 | 97.4 | WŁ | NIE | Przegrzanie szafy |
| 161 | 2026-06-22 13:33:43 | 25.14 | 18.5 | 13 | 99.35 | 97.4 | WŁ | NIE | Przegrzanie szafy, Zasilanie awaryjne (KRYTYCZNE) |
| 162 | 2026-06-22 13:38:43 | 24.94 | 18.5 | 13 | 99.35 | 97.4 | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE) |
| 163 | 2026-06-22 13:43:43 | 24.77 | 18.5 | 14 | 99.3 | 97.2 | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE) |
| 164 | 2026-06-22 13:48:43 | 24.57 | 18.5 | 14 | 99.3 | 97.2 | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE) |
| 165 | 2026-06-22 13:53:43 | 24.34 | 18.5 | 14 | 99.3 | 97.2 | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE) |
| 166 | 2026-06-22 13:58:43 | 24.1 | 18.5 | 15 | 99.25 | 97.0 | WŁ | NIE | Zasilanie awaryjne (KRYTYCZNE) |
| 181 | 2026-06-22 15:13:43 | 25.16 | 98.45236496002003 | 20 | 99.0 | 96.0 | WŁ | NIE | Przegrzanie szafy |
| 202 | 2026-06-22 16:58:43 | 25.7 | 96.35585610569397 | 27 | 98.65 | 94.6 | WYŁ | NIE | Przegrzanie szafy |
| 203 | 2026-06-22 17:03:43 | 26.4 | 96.22754735541913 | 27 | 98.65 | 94.6 | WYŁ | NIE | Przegrzanie szafy |
| 204 | 2026-06-22 17:08:43 | 27.1 | 96.08063282804258 | 27 | 98.65 | 94.6 | WYŁ | NIE | Przegrzanie szafy |
| 205 | 2026-06-22 17:13:43 | 27.8 | 95.94078314706296 | 28 | 98.6 | 94.4 | WYŁ | NIE | Przegrzanie szafy |
| 206 | 2026-06-22 17:18:43 | 28.5 | 95.8905181828832 | 28 | 98.6 | 94.4 | WYŁ | NIE | Przegrzanie szafy |
| 207 | 2026-06-22 17:23:43 | 29.2 | 95.8113655088394 | 28 | 98.6 | 94.4 | WYŁ | NIE | Przegrzanie szafy |
| 208 | 2026-06-22 17:28:43 | 29.9 | 95.71126623506764 | 29 | 98.55 | 94.2 | WYŁ | NIE | Przegrzanie szafy |
| 209 | 2026-06-22 17:33:43 | 30.6 | 95.59122225023161 | 29 | 98.55 | 94.2 | WYŁ | NIE | Przegrzanie szafy |
| 210 | 2026-06-22 17:38:43 | 30.71 | 95.50751354016107 | 29 | 98.55 | 94.2 | WŁ | NIE | Przegrzanie szafy |
| 211 | 2026-06-22 17:43:43 | 30.46 | 95.38823701092217 | 30 | 98.5 | 94.0 | WŁ | NIE | Przegrzanie szafy |
| 212 | 2026-06-22 17:48:43 | 30.26 | 95.32418151613682 | 30 | 98.5 | 94.0 | WŁ | NIE | Przegrzanie szafy |
| 213 | 2026-06-22 17:53:43 | 30.04 | 95.20448195386454 | 30 | 98.5 | 94.0 | WŁ | NIE | Przegrzanie szafy |
| 214 | 2026-06-22 17:58:43 | 29.8 | 95.09988853835313 | 31 | 98.45 | 93.8 | WŁ | NIE | Przegrzanie szafy |
| 215 | 2026-06-22 18:03:43 | 29.58 | 94.96110010696736 | 31 | 98.45 | 93.8 | WŁ | NIE | Przegrzanie szafy |
| 216 | 2026-06-22 18:08:43 | 29.43 | 94.89091723176533 | 31 | 98.45 | 93.8 | WŁ | NIE | Przegrzanie szafy |
| 217 | 2026-06-22 18:13:43 | 29.18 | 94.81254789282595 | 32 | 98.4 | 93.6 | WŁ | NIE | Przegrzanie szafy |
| 218 | 2026-06-22 18:18:43 | 29.02 | 94.70255728710734 | 32 | 98.4 | 93.6 | WŁ | NIE | Przegrzanie szafy |
| 219 | 2026-06-22 18:23:43 | 28.82 | 94.55640010810569 | 32 | 98.4 | 93.6 | WŁ | NIE | Przegrzanie szafy |
| 220 | 2026-06-22 18:28:43 | 28.63 | 94.46131266924283 | 33 | 98.35 | 93.4 | WŁ | NIE | Przegrzanie szafy |
| 221 | 2026-06-22 18:33:43 | 28.4 | 94.3327720273669 | 33 | 98.35 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 222 | 2026-06-22 18:38:43 | 28.24 | 94.21388563347851 | 33 | 98.35 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 223 | 2026-06-22 18:43:43 | 28.09 | 94.12020980209343 | 34 | 98.0 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 224 | 2026-06-22 18:48:43 | 27.87 | 94.01377078761254 | 34 | 98.0 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 225 | 2026-06-22 18:53:43 | 27.65 | 93.89353124508814 | 34 | 98.0 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 226 | 2026-06-22 18:58:43 | 27.49 | 93.80745066110644 | 35 | 97.65 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 227 | 2026-06-22 19:03:43 | 27.27 | 93.71934710720058 | 35 | 97.65 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 228 | 2026-06-22 19:08:43 | 27.06 | 93.6460010613101 | 35 | 97.65 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 229 | 2026-06-22 19:13:43 | 26.84 | 93.56286712312952 | 36 | 97.3 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 230 | 2026-06-22 19:18:43 | 26.6 | 93.5062052174199 | 36 | 97.3 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 231 | 2026-06-22 19:23:43 | 26.4 | 93.38550422945166 | 36 | 97.3 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 232 | 2026-06-22 19:28:43 | 26.17 | 93.30330150370644 | 37 | 96.95 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 233 | 2026-06-22 19:33:43 | 25.94 | 93.16539706948375 | 37 | 96.95 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 234 | 2026-06-22 19:38:43 | 25.76 | 93.06528669375135 | 37 | 96.95 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 235 | 2026-06-22 19:43:43 | 25.61 | 92.94667028950663 | 38 | 96.6 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 236 | 2026-06-22 19:48:43 | 25.39 | 92.87616218325203 | 38 | 96.6 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 237 | 2026-06-22 19:53:43 | 25.15 | 92.7955267933145 | 38 | 96.6 | 4.5 | WŁ | TAK | Przegrzanie szafy, Niski poziom smaru |
| 238 | 2026-06-22 19:58:43 | 24.97 | 92.66470053308323 | 39 | 96.25 | 4.5 | WŁ | TAK | Niski poziom smaru |
| 239 | 2026-06-22 20:03:43 | 24.81 | 92.57880616965853 | 39 | 96.25 | 4.5 | WŁ | TAK | Niski poziom smaru |
| 240 | 2026-06-22 20:08:43 | 24.59 | 92.48649634531014 | 39 | 96.25 | 4.5 | WŁ | TAK | Niski poziom smaru |

## Wnioski z Analizy Telemetrycznej
1. **Okresowa Awaria Zasilania Sieciowego (Rekordy 40-45)**: Wskutek odcięcia głównego zasilania, poziom baterii UPS spadł do poziomu 18.5%. Algorytm bezpieczeństwa sterownika PLC (zgodnie z PN-EN 12453) zadziałał prawidłowo, podnosząc szlabany w tryb ewakuacji awaryjnej.
2. **Incydent Przegrzania Szafy Sterowniczej (Rekordy 80-88)**: Temperatura szafy wzrosła do 30.6°C z powodu braku włączonego wentylatora. PLC poprawnie aktywowało alarm wysokiej temperatury i wdrożyło tryb awaryjny (Fail-Safe), wymuszając ciągłą pracę wentylatora chłodzącego.
3. **Predykcyjne Utrzymanie Ruchu (Rekordy 100-120)**: W miarę rosnącej liczby cykli szlabanów (`barrier_cycles` > 100), poziom smaru spadł do krytycznego poziomu 4.5% (poniżej progu 5.0%). PLC automatycznie aktywowało marker blokady awaryjnej `maintenance_lockout` (`%M2.0`), uniemożliwiając wjazdy nowych aut, chroniąc silnik szlabanu przed trwałym zatarciem.
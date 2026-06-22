import asyncio
import sys
import os
from datetime import datetime

# Dodanie katalogu głównego do ścieżki Pythona, aby móc importować moduł backend
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from sqlalchemy import text, select
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Polygon, box

from backend.app.db.session import engine, AsyncSessionLocal
from backend.app.db.models import Base, Camera, ParkingSpace, OccupancyHistory, SpaceStatus

# Funkcja obliczająca IoU w pamięci za pomocą Shapely (demonstracja algorytmu detekcji zajętości)
def calculate_iou(space_poly: Polygon, vehicle_poly: Polygon) -> float:
    """
    Oblicza współczynnik Intersection over Union (IoU) pomiędzy poligonem miejsca a poligonem pojazdu.
    """
    intersection_area = space_poly.intersection(vehicle_poly).area
    union_area = space_poly.union(vehicle_poly).area
    if union_area == 0:
        return 0.0
    return intersection_area / union_area

async def run_demo():
    print("=== Rozpoczynanie inicjalizacji bazy danych ===")
    
    # 1. Konfiguracja i tworzenie tabel
    async with engine.begin() as conn:
        print("1. Włączanie rozszerzenia PostGIS w PostgreSQL...")
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
        
        print("2. Czyszczenie starych tabel (drop)...")
        await conn.run_sync(Base.metadata.drop_all)
        
        print("3. Tworzenie nowej struktury tabel...")
        await conn.run_sync(Base.metadata.create_all)
        
    print("Tabelki zostały pomyślnie utworzone!")
    
    # 2. Wypełnianie bazy danymi demonstracyjnymi
    async with AsyncSessionLocal() as session:
        async with session.begin():
            print("\n4. Dodawanie testowej kamery...")
            camera = Camera(
                name="Kamera Główna - Sektor A",
                rtsp_url="rtsp://admin:secret123@192.168.1.100:554/stream1",
                is_active=True
            )
            session.add(camera)
            # Flushujemy, aby otrzymać ID kamery przed dodaniem miejsc
            await session.flush()
            
            print(f"Dodano kamerę: ID={camera.id}, Nazwa={camera.name}")
            
            print("\n5. Dodawanie testowych miejsc parkingowych (jako poligony PostGIS) - 28 miejsc dla PKLot...")
            
            spaces_to_add = []
            for i in range(1, 29):
                offset = (i - 1) * 0.0001
                poly = Polygon([
                    (21.0122 + offset, 52.2297),
                    (21.0124 + offset, 52.2297),
                    (21.0124 + offset, 52.2299),
                    (21.0122 + offset, 52.2299),
                    (21.0122 + offset, 52.2297)
                ])
                status = SpaceStatus.FREE
                if i in (27, 28):
                    status = SpaceStatus.DISABLED
                
                space = ParkingSpace(
                    camera_id=camera.id,
                    space_code=f"A-{i}",
                    status=status,
                    geometry=from_shape(poly, srid=4326)
                )
                spaces_to_add.append(space)
                
            session.add_all(spaces_to_add)
            await session.flush()
            print("Dodano 28 miejsc parkingowych (A-1 do A-28, miejsca A-27 i A-28 dla niepełnosprawnych).")
            
            # Dodanie historii dla miejsca A-1
            history1 = OccupancyHistory(
                parking_space_id=spaces_to_add[0].id,
                status=SpaceStatus.FREE,
                iou_value=0.0,
                timestamp=datetime.utcnow()
            )
            session.add(history1)
            
    # 3. Prezentacja zapytań przestrzennych i algorytmu IoU (Symulacja detekcji pojazdu)
    async with AsyncSessionLocal() as session:
        print("\n6. Pobieranie zdefiniowanych miejsc parkingowych z bazy...")
        result = await session.execute(select(ParkingSpace))
        spaces = result.scalars().all()
        
        print(f"Pobrano {len(spaces)} miejsc z bazy danych.")
        for space in spaces:
            # Konwersja geometrii z PostGIS (WKBElement) do obiektu Shapely w celu łatwego odczytu/obliczeń
            shapely_poly = to_shape(space.geometry)
            print(f"  - Miejsce [{space.space_code}]: Status={space.status}, Środek wielokąta (Centroid)={shapely_poly.centroid.wkt}")
        
        print("\n7. Symulacja detekcji pojazdu przez YOLO (obliczanie IoU z PostGIS)...")
        # Wyobraźmy sobie, że YOLO wykryło pojazd w określonym bounding boxie
        # Zdefiniujmy poligon wykrytego pojazdu (częściowo nachodzi na miejsce A-2)
        # Miejsce A-2 to (21.0125, 52.2297) -> (21.0127, 52.2299)
        vehicle_bbox = Polygon([
            (21.01255, 52.22975),
            (21.01275, 52.22975),
            (21.01275, 52.22995),
            (21.01255, 52.22995),
            (21.01255, 52.22975)
        ])
        
        target_space = spaces[1] # Miejsce A-2
        target_poly = to_shape(target_space.geometry)
        
        iou = calculate_iou(target_poly, vehicle_bbox)
        print(f"Obliczone IoU dla Miejsca A-2 i detekcji YOLO: {iou:.4f} (tj. {iou*100:.1f}% pokrycia)")
        
        # Próg zajętości (np. IoU > 0.3)
        iou_threshold = 0.3
        new_status = SpaceStatus.OCCUPIED if iou > iou_threshold else SpaceStatus.FREE
        
        if new_status != target_space.status:
            print(f"-> Zmiana statusu miejsca {target_space.space_code} z {target_space.status} na {new_status} (IoU {iou:.4f} > {iou_threshold})")
            
            # Aktualizacja statusu w bazie danych
            target_space.status = new_status
            
            # Dodanie wpisu do historii (RODO-zgodna rejestracja metadanych)
            history_entry = OccupancyHistory(
                parking_space_id=target_space.id,
                status=new_status,
                iou_value=iou,
                timestamp=datetime.utcnow()
            )
            session.add(history_entry)
            await session.commit()
            print("Zapisano zmianę statusu i wpis historyczny do bazy danych.")
        else:
            print("-> Brak zmiany statusu (pokrycie poniżej progu).")

        # 4. Zapytanie przestrzenne bezpośrednio w SQL (PostGIS)
        print("\n8. Demonstracja zapytania przestrzennego bezpośrednio w bazie (PostGIS SQL)...")
        # Zapytanie sprawdza, które miejsca znajdują się w promieniu 15 metrów od punktu (21.0123, 52.2298)
        # Używamy ST_DWithin na geografii (konwersja z geometrii 4326)
        spatial_sql = text("""
            SELECT space_code, ST_AsText(geometry) as geom_wkt, 
                   ST_Distance(geometry::geography, ST_MakePoint(21.0123, 52.2298)::geography) as distance_meters
            FROM parking_spaces
            WHERE ST_DWithin(geometry::geography, ST_MakePoint(21.0123, 52.2298)::geography, 15);
        """)
        
        sql_result = await session.execute(spatial_sql)
        print("Miejsca w odległości do 15 metrów od punktu testowego (21.0123, 52.2298):")
        for row in sql_result:
            print(f"  - Miejsce: {row[0]}, Odległość: {row[2]:.2f} m")

    print("\n=== Inicjalizacja i test bazy danych zakończone pomyślnie! ===")

if __name__ == "__main__":
    asyncio.run(run_demo())

import enum
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID, ENUM as PGEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

class Base(DeclarativeBase):
    pass

class SpaceStatus(str, enum.Enum):
    FREE = "FREE"
    OCCUPIED = "OCCUPIED"
    RESERVED = "RESERVED"
    DISABLED = "DISABLED"
    UNKNOWN = "UNKNOWN"

# Natywny typ ENUM w bazie danych PostgreSQL
space_status_enum = PGEnum(
    SpaceStatus,
    name="space_status",
    create_type=True
)

class Camera(Base):
    __tablename__ = "cameras"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    rtsp_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relacja: Kamera posiada wiele miejsc parkingowych
    spaces: Mapped[list["ParkingSpace"]] = relationship("ParkingSpace", back_populates="camera", cascade="all, delete-orphan")

class ParkingSpace(Base):
    __tablename__ = "parking_spaces"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    camera_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    space_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    status: Mapped[SpaceStatus] = mapped_column(space_status_enum, default=SpaceStatus.UNKNOWN, nullable=False)
    
    # PostGIS Polygon: geometria miejsca parkingowego w układzie współrzędnych geograficznych WGS84 (SRID 4326)
    # Geometry jest obsługiwane przez geoalchemy2
    geometry: Mapped[Geometry] = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relacje
    camera: Mapped["Camera"] = relationship("Camera", back_populates="spaces")
    history: Mapped[list["OccupancyHistory"]] = relationship("OccupancyHistory", back_populates="space", cascade="all, delete-orphan")

class OccupancyHistory(Base):
    __tablename__ = "occupancy_history"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parking_space_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("parking_spaces.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[SpaceStatus] = mapped_column(space_status_enum, nullable=False)
    iou_value: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relacje
    space: Mapped["ParkingSpace"] = relationship("ParkingSpace", back_populates="history")

-- ====================================================================
-- ParkSmart Database Schema (v4.0)
-- Concurrency-Safe Urban Parking Allocator with Surge Analytics
-- 5 Urban Hubs: Gachibowli, Ameerpet, Banjara Hills, HITEC City, Madhapur
-- 10 Shared Slots: P1 to P10 across all hubs
-- ====================================================================

-- 1. Users Table (Authentication & Role-Based Access)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Parking Hubs Table (Exactly 5 Urban Hubs)
CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    area TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT 'Hyderabad',
    total_slots INTEGER NOT NULL DEFAULT 10 CHECK (total_slots > 0),
    available_slots INTEGER NOT NULL DEFAULT 10 CHECK (available_slots >= 0),
    occupied_slots INTEGER NOT NULL DEFAULT 0 CHECK (occupied_slots >= 0),
    base_price_per_hour REAL NOT NULL DEFAULT 50.0 CHECK (base_price_per_hour > 0),
    is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Shared Parking Slots Table (Exactly 10 Shared Slots P1 to P10)
CREATE TABLE IF NOT EXISTS slots (
    slot_number TEXT PRIMARY KEY,
    slot_index INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    category TEXT DEFAULT 'Shared Urban Bay',
    base_price_per_hour REAL DEFAULT 50.0 CHECK (base_price_per_hour > 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bookings Table (Scoped by Hub, Shared Slot, and Time Window)
CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    location_id TEXT NOT NULL DEFAULT 'HUB-GCB',
    user_id INTEGER,
    user_name TEXT NOT NULL,
    user_phone TEXT NOT NULL,
    user_email TEXT,
    slot_number TEXT NOT NULL DEFAULT 'P1',
    booking_date TEXT NOT NULL DEFAULT '2026-10-27',
    start_time TEXT NOT NULL DEFAULT '09:00',
    end_time TEXT NOT NULL DEFAULT '10:00',
    duration_hours REAL NOT NULL DEFAULT 1.0,
    slots_count INTEGER NOT NULL DEFAULT 1 CHECK (slots_count > 0),
    price_per_hour REAL NOT NULL CHECK (price_per_hour >= 0),
    surge_multiplier REAL NOT NULL DEFAULT 1.0 CHECK (surge_multiplier >= 1.0),
    total_amount REAL NOT NULL CHECK (total_amount >= 0),
    status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'COMPLETED', 'RELEASED', 'CANCELLED')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    released_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT
);

-- 5. Audit Logs Table (State Transition History for Analytics)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT,
    location_id TEXT DEFAULT 'HUB-GCB',
    slot_number TEXT,
    action TEXT NOT NULL,
    slots_changed INTEGER NOT NULL DEFAULT 1,
    available_after INTEGER NOT NULL DEFAULT 0,
    occupied_after INTEGER NOT NULL DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Fast Time-Range Overlap Checking & Query Optimization
CREATE INDEX IF NOT EXISTS idx_bookings_shared_slot_time ON bookings(slot_number, booking_date, status, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_hub_time ON bookings(location_id, booking_date, status, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_locations_area ON locations(area);
CREATE INDEX IF NOT EXISTS idx_bookings_user_phone ON bookings(user_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_user_email ON bookings(user_email);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

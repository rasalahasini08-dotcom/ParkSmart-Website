/**
 * ParkSmart Database Access Layer (SQLite)
 * Features 5 Urban Hubs (Gachibowli, Ameerpet, Banjara Hills, HITEC City, Madhapur)
 * and 10 Shared Parking Slots (P1 to P10) across all hubs.
 * Uses Write-Ahead Logging (WAL) and strict referential integrity.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'parksmart.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Open persistent database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('CRITICAL: Failed to connect to SQLite database:', err.message);
    } else {
        console.log(`[ParkSmart DB] Connected to persistent SQLite database at: ${DB_PATH}`);
    }
});

// Configure SQLite for high concurrency and referential integrity
db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON;');
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA busy_timeout = 5000;');
});

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + '_parksmart_salt_2026').digest('hex');
}

/**
 * Promisified database query wrappers
 */
const dbAsync = {
    run: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) return reject(err);
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    },

    get: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) return reject(err);
                resolve(row);
            });
        });
    },

    all: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    },

    exec: (sql) => {
        return new Promise((resolve, reject) => {
            db.exec(sql, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    },

    hashPassword,

    // Initialize and migrate database schema safely
    initSchema: async () => {
        // 1. Create base tables
        await dbAsync.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

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
                released_at DATETIME
            );

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
        `);

        // 2. Migration for 10 Shared Slots (P1 to P10)
        // Check if slots table has location_id or needs schema update
        const slotColumns = await dbAsync.all("PRAGMA table_info(slots)");
        const slotColNames = slotColumns.map(c => c.name);

        if (slotColNames.includes('location_id') || slotColumns.length === 0) {
            console.log('[ParkSmart DB] Migrating to exactly 10 shared slots (P1 to P10)...');
            await dbAsync.run('DROP TABLE IF EXISTS slots;');
            await dbAsync.exec(`
                CREATE TABLE slots (
                    slot_number TEXT PRIMARY KEY,
                    slot_index INTEGER NOT NULL,
                    is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
                    category TEXT DEFAULT 'Shared Urban Bay',
                    base_price_per_hour REAL DEFAULT 50.0 CHECK (base_price_per_hour > 0),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
        }

        // Ensure exactly 10 shared slots P1 to P10 exist in slots table
        await dbAsync.run('DELETE FROM slots WHERE slot_index > 10;');
        for (let i = 1; i <= 10; i++) {
            const slotNum = `P${i}`;
            await dbAsync.run(`
                INSERT INTO slots (slot_number, slot_index, is_active, category, base_price_per_hour)
                VALUES (?, ?, 1, 'Shared Urban Bay', 50.0)
                ON CONFLICT(slot_number) DO NOTHING;
            `, [slotNum, i]);
        }

        // 3. Exactly 5 Hubs: Gachibowli, Ameerpet, Banjara Hills, HITEC City, Madhapur
        const EXACT_FIVE_HUBS = [
            {
                id: 'HUB-GCB',
                name: 'Gachibowli Hub',
                area: 'Gachibowli',
                address: 'Financial District Access Road, Gachibowli, Hyderabad',
                city: 'Hyderabad',
                total_slots: 10,
                base_price_per_hour: 50.00
            },
            {
                id: 'HUB-AMP',
                name: 'Ameerpet Hub',
                area: 'Ameerpet',
                address: 'Opposite Metro Pillar A-1042, Ameerpet Main Road, Hyderabad',
                city: 'Hyderabad',
                total_slots: 10,
                base_price_per_hour: 40.00
            },
            {
                id: 'HUB-BJH',
                name: 'Banjara Hills Hub',
                area: 'Banjara Hills',
                address: 'Road No. 1, Near City Center Mall, Banjara Hills, Hyderabad',
                city: 'Hyderabad',
                total_slots: 10,
                base_price_per_hour: 60.00
            },
            {
                id: 'HUB-HTC',
                name: 'HITEC City Hub',
                area: 'HITEC City',
                address: 'Cyber Towers Circle, Phase 2, HITEC City, Hyderabad',
                city: 'Hyderabad',
                total_slots: 10,
                base_price_per_hour: 55.00
            },
            {
                id: 'HUB-MDP',
                name: 'Madhapur Hub',
                area: 'Madhapur',
                address: 'Ayyappa Society Main Road, Near Metro Station, Madhapur, Hyderabad',
                city: 'Hyderabad',
                total_slots: 10,
                base_price_per_hour: 45.00
            }
        ];

        // Seed or update the 5 hubs
        for (const hub of EXACT_FIVE_HUBS) {
            await dbAsync.run(`
                INSERT INTO locations (id, name, area, address, city, total_slots, available_slots, occupied_slots, base_price_per_hour, is_active)
                VALUES (?, ?, ?, ?, ?, 10, 10, 0, ?, 1)
                ON CONFLICT(id) DO UPDATE SET 
                    name = excluded.name,
                    area = excluded.area, 
                    address = excluded.address,
                    city = excluded.city,
                    total_slots = 10,
                    base_price_per_hour = excluded.base_price_per_hour;
            `, [hub.id, hub.name, hub.area, hub.address, hub.city, hub.base_price_per_hour]);
        }

        // Remap any old bookings to the new hub IDs
        await dbAsync.run("UPDATE bookings SET location_id = 'HUB-GCB' WHERE location_id LIKE '%GCB%';");
        await dbAsync.run("UPDATE bookings SET location_id = 'HUB-AMP' WHERE location_id LIKE '%AMP%' OR location_id = 'LOC-MAIN-25';");
        await dbAsync.run("UPDATE bookings SET location_id = 'HUB-BJH' WHERE location_id LIKE '%BJH%';");
        await dbAsync.run("UPDATE bookings SET location_id = 'HUB-HTC' WHERE location_id LIKE '%HTC%';");
        await dbAsync.run("UPDATE bookings SET location_id = 'HUB-MDP' WHERE location_id LIKE '%MDP%';");
        await dbAsync.run("UPDATE bookings SET location_id = 'HUB-GCB' WHERE location_id NOT IN ('HUB-GCB', 'HUB-AMP', 'HUB-BJH', 'HUB-HTC', 'HUB-MDP');");

       // Remap legacy audit logs before deleting old locations
        await dbAsync.run("UPDATE audit_logs SET location_id = 'HUB-GCB' WHERE location_id LIKE '%GCB%';");
        await dbAsync.run("UPDATE audit_logs SET location_id = 'HUB-AMP' WHERE location_id LIKE '%AMP%' OR location_id = 'LOC-MAIN-25';");
        await dbAsync.run("UPDATE audit_logs SET location_id = 'HUB-BJH' WHERE location_id LIKE '%BJH%';");
        await dbAsync.run("UPDATE audit_logs SET location_id = 'HUB-HTC' WHERE location_id LIKE '%HTC%';");
        await dbAsync.run("UPDATE audit_logs SET location_id = 'HUB-MDP' WHERE location_id LIKE '%MDP%';");
        await dbAsync.run("UPDATE audit_logs SET location_id = 'HUB-GCB' WHERE location_id IS NOT NULL AND location_id NOT IN ('HUB-GCB', 'HUB-AMP', 'HUB-BJH', 'HUB-HTC', 'HUB-MDP');");

        // Remove any legacy locations that are not part of the 5 hubs
        await dbAsync.run("DELETE FROM locations WHERE id NOT IN ('HUB-GCB', 'HUB-AMP', 'HUB-BJH', 'HUB-HTC', 'HUB-MDP');");

        // 4. Seed Default Users (Admin & Demo User)
        const adminPassHash = hashPassword('admin123');
        await dbAsync.run(`
            INSERT INTO users (name, email, phone, password_hash, role)
            VALUES ('Administrator', 'admin@parksmart.local', '9999999999', ?, 'admin')
            ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin';
        `, [adminPassHash]);

        const userPassHash = hashPassword('user123');
        await dbAsync.run(`
            INSERT INTO users (name, email, phone, password_hash, role)
            VALUES ('Demo User', 'user@parksmart.local', '9876543210', ?, 'user')
            ON CONFLICT(email) DO NOTHING;
        `, [userPassHash]);

        // 5. High Performance Indexes
        await dbAsync.exec(`
            CREATE INDEX IF NOT EXISTS idx_bookings_shared_slot ON bookings(slot_number, booking_date, status, start_time, end_time);
            CREATE INDEX IF NOT EXISTS idx_bookings_hub_time ON bookings(location_id, booking_date, status, start_time, end_time);
            CREATE INDEX IF NOT EXISTS idx_locations_area ON locations(area);
            CREATE INDEX IF NOT EXISTS idx_bookings_user_phone ON bookings(user_phone);
            CREATE INDEX IF NOT EXISTS idx_bookings_user_email ON bookings(user_email);
            CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
        `);

        console.log('[ParkSmart DB] Schema verified: Exactly 5 Hubs and 10 Shared Slots (P1 to P10).');
    },

    close: () => {
        return new Promise((resolve, reject) => {
            db.close((err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    },

    rawDb: db
};

module.exports = dbAsync;

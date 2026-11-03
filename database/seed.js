/**
 * ParkSmart Database Seed Script (v4.0)
 * Pre-populates the 5 Urban Hubs:
 * 1. Gachibowli
 * 2. Ameerpet
 * 3. Banjara Hills
 * 4. HITEC City
 * 5. Madhapur
 * and 10 shared slots (P1 to P10) with initial baseline bookings.
 */

const db = require('./db');

const FIVE_HUBS = [
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

const INITIAL_DEMO_BOOKINGS = [
    {
        id: 'PS-HYD-1001',
        location_id: 'HUB-BJH',
        slot_number: 'P3',
        user_name: 'Rahul Sharma',
        user_phone: '9876543210',
        user_email: 'rahul@example.com',
        booking_date: new Date().toISOString().split('T')[0],
        start_time: '10:00',
        end_time: '12:00',
        duration_hours: 2.0,
        price_per_hour: 60.00,
        surge_multiplier: 1.0,
        total_amount: 120.00,
        status: 'CONFIRMED'
    },
    {
        id: 'PS-HYD-1002',
        location_id: 'HUB-AMP',
        slot_number: 'P7',
        user_name: 'Priya Patel',
        user_phone: '9811223344',
        user_email: 'priya@example.com',
        booking_date: new Date().toISOString().split('T')[0],
        start_time: '14:00',
        end_time: '16:00',
        duration_hours: 2.0,
        price_per_hour: 40.00,
        surge_multiplier: 1.0,
        total_amount: 80.00,
        status: 'CONFIRMED'
    }
];

async function seedDatabase() {
    try {
        console.log('[ParkSmart Seed] Initializing database schema & migrations...');
        await db.initSchema();

        // Verify the 5 hubs
        console.log('[ParkSmart Seed] Checking 5 urban hubs...');
        for (const hub of FIVE_HUBS) {
            await db.run(`
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

        // Clean up locations that are not the 5 hubs
        await db.run("DELETE FROM locations WHERE id NOT IN ('HUB-GCB', 'HUB-AMP', 'HUB-BJH', 'HUB-HTC', 'HUB-MDP');");

        // Insert initial baseline bookings if none exist
        const bookingCount = await db.get('SELECT COUNT(*) as count FROM bookings');
        if (bookingCount?.count === 0) {
            console.log('[ParkSmart Seed] Seeding initial baseline demo reservations...');
            for (const b of INITIAL_DEMO_BOOKINGS) {
                await db.run(`
                    INSERT INTO bookings (
                        id, location_id, user_name, user_phone, user_email, slot_number, booking_date, start_time, end_time, duration_hours,
                        slots_count, price_per_hour, surge_multiplier, total_amount, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(id) DO NOTHING;
                `, [b.id, b.location_id, b.user_name, b.user_phone, b.user_email, b.slot_number, b.booking_date, b.start_time, b.end_time, b.duration_hours, b.price_per_hour, b.surge_multiplier, b.total_amount, b.status]);
            }
        }

        console.log('[ParkSmart Seed] 5 Urban Hubs and 10 shared slots verified successfully!');
    } catch (err) {
        console.error('Fatal error during database seed:', err);
        throw err;
    }
}

if (require.main === module) {
    seedDatabase().then(() => {
        console.log('[ParkSmart Seed] Process complete. Exiting.');
        process.exit(0);
    }).catch(() => process.exit(1));
}

module.exports = seedDatabase;

/**
 * Admin Controller (v4.0)
 * Administrative oversight for:
 * - 5 Urban Parking Hubs (Gachibowli, Ameerpet, Banjara Hills, HITEC City, Madhapur)
 * - 10 Shared Slots (P1 to P10) Maintenance Toggling
 * - Comprehensive Bookings Audit and Admin Cancellation
 * - System Metrics & Overview
 */

const db = require('../../database/db');

/**
 * GET /api/admin/overview
 * Real-time summary for the Admin Dashboard
 */
async function getAdminOverview(req, res) {
    try {
        const hubStats = await db.get(`
            SELECT 
                COUNT(*) as total_facilities,
                10 as total_capacity
            FROM locations
            WHERE is_active = 1
        `);

        // Exactly 10 shared slots from slots table
        const totalSlots = await db.get('SELECT COUNT(*) as count FROM slots');
        const activeSlots = await db.get('SELECT COUNT(*) as count FROM slots WHERE is_active = 1');
        const totalSlotCount = totalSlots?.count || 10;
        const activeSlotCount = activeSlots?.count || 10;
        const maintenanceSlots = totalSlotCount - activeSlotCount;

        // Bookings summary
        const bookingStats = await db.get(`
            SELECT 
                COUNT(*) as total_bookings,
                SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) as active_bookings,
                SUM(CASE WHEN status IN ('CANCELLED', 'RELEASED') THEN 1 ELSE 0 END) as cancelled_bookings,
                COALESCE(SUM(total_amount), 0) as total_revenue
            FROM bookings
        `);

        // Today's active bookings
        const todayStr = new Date().toISOString().split('T')[0];
        const todayBookings = await db.get(`
            SELECT COUNT(DISTINCT slot_number) as count 
            FROM bookings 
            WHERE booking_date = ? AND status = 'CONFIRMED'
        `, [todayStr]);

        const currentOccupied = todayBookings?.count || 0;
        const currentCapacity = activeSlotCount > 0 ? activeSlotCount : 10;
        const occupancyPct = currentCapacity > 0 ? Math.min(100, Math.round((currentOccupied / currentCapacity) * 100)) : 0;

        return res.json({
            success: true,
            overview: {
                total_facilities: hubStats?.total_facilities || 5,
                total_slots: totalSlotCount, // 10 Shared Slots
                active_slots: activeSlotCount,
                maintenance_slots: maintenanceSlots,
                total_bookings: bookingStats?.total_bookings || 0,
                active_bookings: bookingStats?.active_bookings || 0,
                cancelled_bookings: bookingStats?.cancelled_bookings || 0,
                total_revenue: Math.round((bookingStats?.total_revenue || 0) * 100) / 100,
                today_active_bookings: currentOccupied,
                current_occupancy_pct: occupancyPct
            }
        });
    } catch (err) {
        console.error('Error fetching admin overview:', err);
        return res.status(500).json({ success: false, message: 'Server error retrieving admin overview.' });
    }
}

/**
 * GET /api/admin/locations
 * Retrieve the 5 urban hubs for admin management
 */
async function getAdminLocations(req, res) {
    try {
        const locations = await db.all(`
            SELECT 
                l.*,
                10 as slot_count,
                (SELECT COUNT(*) FROM slots WHERE is_active = 1) as active_slot_count,
                (SELECT COUNT(*) FROM bookings b WHERE b.location_id = l.id AND b.status = 'CONFIRMED') as confirmed_bookings_count
            FROM locations l
            ORDER BY 
                CASE l.area 
                    WHEN 'Gachibowli' THEN 1 
                    WHEN 'Ameerpet' THEN 2 
                    WHEN 'Banjara Hills' THEN 3 
                    WHEN 'HITEC City' THEN 4 
                    WHEN 'Madhapur' THEN 5 
                    ELSE 6 
                END
        `);

        return res.json({
            success: true,
            count: locations.length,
            locations
        });
    } catch (err) {
        console.error('Error fetching admin locations:', err);
        return res.status(500).json({ success: false, message: 'Server error retrieving locations for admin.' });
    }
}

/**
 * PUT /api/admin/locations/:id
 * Admin updates hub details (e.g. hourly rate, address)
 */
async function updateLocation(req, res) {
    try {
        const { id } = req.params;
        const { name, area, address, city, base_price_per_hour, is_active } = req.body;

        const location = await db.get('SELECT * FROM locations WHERE id = ?', [id]);
        if (!location) {
            return res.status(404).json({ success: false, message: `Hub with ID "${id}" not found.` });
        }

        const updatedName = (name !== undefined && name.trim()) ? name.trim() : location.name;
        const updatedArea = (area !== undefined && area.trim()) ? area.trim() : location.area;
        const updatedAddress = (address !== undefined && address.trim()) ? address.trim() : location.address;
        const updatedCity = (city !== undefined && city.trim()) ? city.trim() : location.city;
        const updatedPrice = (base_price_per_hour !== undefined && !isNaN(parseFloat(base_price_per_hour))) 
            ? parseFloat(base_price_per_hour) 
            : location.base_price_per_hour;
        const updatedActive = (is_active !== undefined) ? (is_active ? 1 : 0) : location.is_active;

        await db.run(`
            UPDATE locations 
            SET name = ?, area = ?, address = ?, city = ?, base_price_per_hour = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [updatedName, updatedArea, updatedAddress, updatedCity, updatedPrice, updatedActive, id]);

        return res.json({
            success: true,
            message: `Hub "${updatedName}" updated successfully.`,
            location: {
                id,
                name: updatedName,
                area: updatedArea,
                address: updatedAddress,
                city: updatedCity,
                base_price_per_hour: updatedPrice,
                is_active: updatedActive
            }
        });
    } catch (err) {
        console.error('Error updating location:', err);
        return res.status(500).json({ success: false, message: 'Server error updating hub.' });
    }
}

/**
 * POST /api/admin/locations
 * Admin location creation fallback
 */
async function createLocation(req, res) {
    try {
        const { name, area, address, city, base_price_per_hour } = req.body;
        const price = parseFloat(base_price_per_hour) || 50.0;
        const randId = 'HUB-' + (area ? area.slice(0, 3).toUpperCase() : Math.random().toString(36).substring(2, 5).toUpperCase());

        await db.run(`
            INSERT INTO locations (id, name, area, address, city, total_slots, available_slots, occupied_slots, base_price_per_hour, is_active)
            VALUES (?, ?, ?, ?, ?, 10, 10, 0, ?, 1)
        `, [randId, name, area, address, city || 'Hyderabad', price]);

        return res.status(201).json({
            success: true,
            message: `Hub "${name}" registered with access to the 10 shared slots!`,
            location: { id: randId, name, area, total_slots: 10 }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
}

/**
 * GET /api/admin/slots
 * Retrieve the 10 shared slots (P1 to P10) with operational status
 */
async function getAdminSlots(req, res) {
    try {
        const slots = await db.all(`
            SELECT 
                s.slot_number,
                s.slot_index,
                s.is_active,
                s.category,
                s.base_price_per_hour,
                COUNT(b.id) as all_time_bookings,
                SUM(CASE WHEN b.status = 'CONFIRMED' THEN 1 ELSE 0 END) as current_confirmed
            FROM slots s
            LEFT JOIN bookings b ON s.slot_number = b.slot_number
            GROUP BY s.slot_number
            ORDER BY s.slot_index ASC
        `);

        return res.json({ 
            success: true, 
            slots 
        });
    } catch (err) {
        console.error('Error fetching admin slots:', err);
        return res.status(500).json({ success: false, message: 'Server error retrieving admin slots.' });
    }
}

/**
 * POST /api/admin/slots/:slotNumber/toggle
 * Toggle shared slot active vs maintenance status
 */
async function toggleSlotMaintenance(req, res) {
    try {
        const { slotNumber } = req.params;
        const normalizedSlot = slotNumber.trim().toUpperCase();

        const slot = await db.get('SELECT * FROM slots WHERE slot_number = ?', [normalizedSlot]);
        if (!slot) {
            return res.status(404).json({ success: false, message: `Slot ${normalizedSlot} not found in the 10 shared slots.` });
        }

        const newStatus = slot.is_active === 1 ? 0 : 1;
        await db.run('UPDATE slots SET is_active = ? WHERE slot_number = ?', [newStatus, normalizedSlot]);

        // Audit log
        await db.run(`
            INSERT INTO audit_logs (location_id, slot_number, action, slots_changed, available_after, occupied_after, timestamp)
            VALUES ('HUB-ALL', ?, 'SYSTEM_RESET', 0, 0, 0, CURRENT_TIMESTAMP)
        `, [normalizedSlot]);

        const statusLabel = newStatus === 1 ? 'Active (Operational across Hubs)' : 'Under Maintenance (Blocked across Hubs)';

        if (req.broadcastUpdate) {
            req.broadcastUpdate('SLOT_STATUS_CHANGED', { slotNumber: normalizedSlot, is_active: newStatus });
        }

        return res.json({
            success: true,
            message: `Shared Slot ${normalizedSlot} status updated to: ${statusLabel}`,
            slot: {
                slot_number: normalizedSlot,
                is_active: newStatus
            }
        });
    } catch (err) {
        console.error('Error toggling slot maintenance:', err);
        return res.status(500).json({ success: false, message: 'Server error updating slot status.' });
    }
}

/**
 * GET /api/admin/bookings
 * Retrieve all bookings with optional query filters
 */
async function getAllBookings(req, res) {
    try {
        const { status, date, location_id, search } = req.query;

        let query = `
            SELECT b.*, COALESCE(l.name, 'ParkSmart Hub') as location_name, COALESCE(l.area, 'Ameerpet') as area
            FROM bookings b
            LEFT JOIN locations l ON b.location_id = l.id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'ALL') {
            query += ' AND b.status = ?';
            params.push(status);
        }

        if (date && date.trim() !== '') {
            query += ' AND b.booking_date = ?';
            params.push(date.trim());
        }

        if (location_id && location_id !== 'ALL' && location_id.trim() !== '') {
            query += ' AND b.location_id = ?';
            params.push(location_id.trim());
        }

        if (search && search.trim() !== '') {
            query += ' AND (b.id LIKE ? OR b.user_name LIKE ? OR b.user_phone LIKE ? OR b.slot_number LIKE ? OR l.name LIKE ?)';
            const term = `%${search.trim()}%`;
            params.push(term, term, term, term, term);
        }

        query += ' ORDER BY b.created_at DESC LIMIT 150';

        const bookings = await db.all(query, params);

        return res.json({
            success: true,
            count: bookings.length,
            bookings
        });
    } catch (err) {
        console.error('Error fetching admin bookings:', err);
        return res.status(500).json({ success: false, message: 'Server error retrieving bookings.' });
    }
}

/**
 * POST /api/admin/bookings/:id/cancel
 * Admin cancellation of any booking
 */
async function adminCancelBooking(req, res) {
    try {
        const { id } = req.params;
        const bookingId = id.trim().toUpperCase();

        const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }

        if (booking.status !== 'CONFIRMED') {
            return res.status(400).json({ success: false, message: `Booking is already ${booking.status}.` });
        }

        const nowIso = new Date().toISOString();
        await db.run(
            'UPDATE bookings SET status = "CANCELLED", released_at = ? WHERE id = ?',
            [nowIso, bookingId]
        );

        // Audit log
        await db.run(`
            INSERT INTO audit_logs (booking_id, location_id, slot_number, action, slots_changed, available_after, occupied_after, timestamp)
            VALUES (?, ?, ?, 'BOOKING_CANCELLED', -1, 0, 0, ?)
        `, [bookingId, booking.location_id || 'HUB-GCB', booking.slot_number || 'P1', nowIso]);

        if (req.broadcastUpdate) {
            req.broadcastUpdate('BOOKING_CANCELLED', { bookingId, slotNumber: booking.slot_number });
        }

        return res.json({
            success: true,
            message: `Booking ${bookingId} has been successfully cancelled by Administrator.`
        });
    } catch (err) {
        console.error('Admin cancel error:', err);
        return res.status(500).json({ success: false, message: 'Server error cancelling booking.' });
    }
}

module.exports = {
    getAdminOverview,
    getAdminLocations,
    createLocation,
    updateLocation,
    getAdminSlots,
    toggleSlotMaintenance,
    getAllBookings,
    adminCancelBooking
};

/**
 * Parking Slots Controller (v4.0)
 * Evaluates real-time availability for the 10 Shared Slots (P1 to P10)
 * at the selected Urban Hub (Gachibowli, Ameerpet, Banjara Hills, HITEC City, Madhapur)
 * for a specific date and time window.
 *
 * Booking Rule:
 * If a user books a slot (e.g. P1) at Gachibowli from 10 AM to 12 PM, P1 shows as
 * occupied ONLY at Gachibowli (not at every hub) during that period.
 * It becomes available again after the booking ends.
 */

const db = require('../../database/db');

function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

/**
 * GET /api/slots
 * Query params: location_id, date, start_time, end_time
 */
async function getSlots(req, res) {
    try {
        let { location_id, locationId, date, start_time, end_time } = req.query;

        let targetLocationId = (location_id || locationId || '').trim();
        if (!targetLocationId) {
            const firstLoc = await db.get('SELECT id FROM locations WHERE is_active = 1 ORDER BY CASE area WHEN "Gachibowli" THEN 1 WHEN "Ameerpet" THEN 2 WHEN "Banjara Hills" THEN 3 WHEN "HITEC City" THEN 4 WHEN "Madhapur" THEN 5 ELSE 6 END LIMIT 1');
            targetLocationId = firstLoc ? firstLoc.id : 'HUB-GCB';
        }

        let facility = await db.get('SELECT * FROM locations WHERE id = ?', [targetLocationId]);
        if (!facility) {
            // Fallback match by area or default
            facility = await db.get('SELECT * FROM locations WHERE area LIKE ? OR name LIKE ? LIMIT 1', [`%${targetLocationId}%`, `%${targetLocationId}%`]);
            if (facility) {
                targetLocationId = facility.id;
            } else {
                facility = await db.get('SELECT * FROM locations WHERE id = "HUB-GCB"');
                targetLocationId = facility ? facility.id : 'HUB-GCB';
            }
        }

        const targetDate = date && date.match(/^\d{4}-\d{2}-\d{2}$/) ? date : getTodayString();
        const startTime = start_time && start_time.match(/^\d{2}:\d{2}$/) ? start_time : '09:00';
        const endTime = end_time && end_time.match(/^\d{2}:\d{2}$/) ? end_time : '10:00';

        // 1. Fetch exactly the 10 shared slots (P1 to P10)
        let allSlots = await db.all('SELECT * FROM slots ORDER BY slot_index ASC');
        if (!allSlots || allSlots.length !== 10) {
            await db.initSchema();
            allSlots = await db.all('SELECT * FROM slots ORDER BY slot_index ASC');
        }

        // 2. Query overlapping active bookings for THIS hub on THIS date and time range
        // Rule: A slot shows as occupied (BOOKED) only at the hub where it was booked.
        const overlappingAtThisHub = await db.all(`
            SELECT id as booking_id, slot_number, user_name, start_time, end_time, status
            FROM bookings
            WHERE location_id = ?
              AND booking_date = ?
              AND status = 'CONFIRMED'
              AND start_time < ?
              AND end_time > ?
        `, [targetLocationId, targetDate, endTime, startTime]);

        const overlapMap = new Map();
        overlappingAtThisHub.forEach(b => {
            overlapMap.set(b.slot_number, b);
        });

        // 3. Map slot statuses for the 10 shared slots
        let availableCount = 0;
        let bookedCount = 0;
        let maintenanceCount = 0;

        const slots = allSlots.map(slot => {
            const booking = overlapMap.get(slot.slot_number);
            const isBooked = !!booking;
            const isMaintenance = slot.is_active === 0;

            let status = 'AVAILABLE';
            if (isMaintenance) {
                status = 'MAINTENANCE';
                maintenanceCount++;
            } else if (isBooked) {
                status = 'BOOKED';
                bookedCount++;
            } else {
                availableCount++;
            }

            return {
                hub_id: targetLocationId,
                slot_number: slot.slot_number,
                slot_index: slot.slot_index,
                category: slot.category || 'Shared Urban Bay',
                base_price_per_hour: facility.base_price_per_hour,
                is_active: slot.is_active === 1,
                status: status, // 'AVAILABLE', 'BOOKED', 'MAINTENANCE'
                booking_details: isBooked ? {
                    booking_id: booking.booking_id,
                    start_time: booking.start_time,
                    end_time: booking.end_time
                } : null
            };
        });

        // 4. Dynamic Surge Multiplier for this hub based on occupancy
        const totalCapacity = 10;
        const occupancyPct = Math.round((bookedCount / totalCapacity) * 100);

        let surgeMultiplier = 1.0;
        let surgeTier = 'Normal (1.0x)';
        if (occupancyPct >= 80) {
            surgeMultiplier = 1.5;
            surgeTier = 'Peak Surge (1.5x)';
        } else if (occupancyPct >= 50) {
            surgeMultiplier = 1.25;
            surgeTier = 'Moderate Surge (1.25x)';
        }

        const basePrice = facility.base_price_per_hour || 50.0;
        const effectivePrice = Math.round(basePrice * surgeMultiplier * 100) / 100;

        return res.json({
            success: true,
            facility: {
                id: facility.id,
                name: facility.name,
                area: facility.area,
                address: facility.address,
                city: facility.city || 'Hyderabad',
                base_price_per_hour: basePrice
            },
            query: {
                location_id: targetLocationId,
                date: targetDate,
                start_time: startTime,
                end_time: endTime
            },
            summary: {
                total_slots: totalCapacity, // Exactly 10
                available_slots: availableCount,
                booked_slots: bookedCount,
                maintenance_slots: maintenanceCount,
                occupancy_pct: occupancyPct,
                surge_multiplier: surgeMultiplier,
                surge_tier: surgeTier,
                base_price_per_hour: basePrice,
                effective_price_per_hour: effectivePrice
            },
            slots
        });
    } catch (err) {
        console.error('Error fetching hub slots:', err);
        return res.status(500).json({ success: false, message: 'Server error retrieving hub parking slots.' });
    }
}

module.exports = {
    getSlots
};

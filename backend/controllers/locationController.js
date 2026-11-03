/**
 * Locations Controller (v4.0)
 * Handles retrieval and filtering for the 5 Urban Parking Hubs:
 * 1. Gachibowli
 * 2. Ameerpet
 * 3. Banjara Hills
 * 4. HITEC City
 * 5. Madhapur
 * Each providing access to the 10 shared slots (P1 to P10).
 */

const db = require('../../database/db');

/**
 * Dynamic surge pricing multiplier based on occupancy ratio
 */
function calculateSurge(availableSlots, totalSlots) {
    if (totalSlots <= 0) return { multiplier: 1.0, surgeTier: 'Normal' };
    const occupancyRatio = (totalSlots - availableSlots) / totalSlots;
    const occupancyPct = Math.round(occupancyRatio * 100);

    if (occupancyPct >= 80) {
        return { multiplier: 1.5, surgeTier: 'Peak Surge' };
    } else if (occupancyPct >= 50) {
        return { multiplier: 1.25, surgeTier: 'Moderate Surge' };
    } else {
        return { multiplier: 1.0, surgeTier: 'Normal' };
    }
}

/**
 * GET /api/locations
 * Query params: area, search, availability
 */
async function getAllLocations(req, res) {
    try {
        const { area, search, availability } = req.query;

        let query = `
            SELECT * FROM locations 
            WHERE is_active = 1
        `;
        const params = [];

        if (area && area !== 'ALL' && area.trim() !== '') {
            query += ' AND area = ?';
            params.push(area.trim());
        }

        if (search && search.trim() !== '') {
            query += ' AND (name LIKE ? OR address LIKE ? OR area LIKE ? OR city LIKE ?)';
            const term = `%${search.trim()}%`;
            params.push(term, term, term, term);
        }

        query += `
            ORDER BY 
                CASE area 
                    WHEN 'Gachibowli' THEN 1 
                    WHEN 'Ameerpet' THEN 2 
                    WHEN 'Banjara Hills' THEN 3 
                    WHEN 'HITEC City' THEN 4 
                    WHEN 'Madhapur' THEN 5 
                    ELSE 6 
                END
        `;

        const locations = await db.all(query, params);

        // Fetch distinct areas in exact order
        const areas = ['Gachibowli', 'Ameerpet', 'Banjara Hills', 'HITEC City', 'Madhapur'];

        // Compute today's active bookings for each hub
        const todayStr = new Date().toISOString().split('T')[0];
        const todayBookingsByHub = await db.all(`
            SELECT location_id, COUNT(DISTINCT slot_number) as active_count
            FROM bookings
            WHERE booking_date = ? AND status = 'CONFIRMED'
            GROUP BY location_id
        `, [todayStr]);

        const hubActiveMap = new Map();
        todayBookingsByHub.forEach(row => {
            hubActiveMap.set(row.location_id, row.active_count);
        });

        // Enrich locations with real-time slot occupancy and surge metrics
        const enriched = locations.map(loc => {
            const occupiedSlots = hubActiveMap.get(loc.id) || 0;
            const availableSlots = Math.max(0, 10 - occupiedSlots);
            const { multiplier, surgeTier } = calculateSurge(availableSlots, 10);
            const occupancyPct = Math.round((occupiedSlots / 10) * 100);
            const effectivePrice = Math.round(loc.base_price_per_hour * multiplier * 100) / 100;

            return {
                id: loc.id,
                name: loc.name,
                area: loc.area,
                address: loc.address,
                city: loc.city || 'Hyderabad',
                total_slots: 10,
                available_slots: availableSlots,
                occupied_slots: occupiedSlots,
                occupancy_pct: occupancyPct,
                base_price_per_hour: loc.base_price_per_hour,
                surge_multiplier: multiplier,
                surge_tier: surgeTier,
                effective_price_per_hour: effectivePrice,
                is_available: availableSlots > 0,
                is_sample: true
            };
        });

        // Group locations by area
        const groupedByArea = {};
        enriched.forEach(loc => {
            const a = loc.area || 'Other';
            if (!groupedByArea[a]) groupedByArea[a] = [];
            groupedByArea[a].push(loc);
        });

        // Compute summary metrics (10 shared slots)
        const totalDistinctOccupied = await db.get(`
            SELECT COUNT(DISTINCT slot_number) as count 
            FROM bookings 
            WHERE booking_date = ? AND status = 'CONFIRMED'
        `, [todayStr]);

        const systemOccupied = totalDistinctOccupied?.count || 0;
        const systemAvailable = Math.max(0, 10 - systemOccupied);

        return res.json({
            success: true,
            areas,
            summary: {
                total_locations: enriched.length, // 5 Hubs
                total_slots: 10, // 10 Shared Slots
                available_slots: systemAvailable,
                occupied_slots: systemOccupied,
                overall_occupancy_pct: Math.round((systemOccupied / 10) * 100)
            },
            locations: enriched,
            grouped_by_area: groupedByArea
        });
    } catch (err) {
        console.error('Error fetching locations:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while fetching parking hubs.'
        });
    }
}

/**
 * GET /api/locations/:id
 */
async function getLocationById(req, res) {
    try {
        const { id } = req.params;
        const loc = await db.get('SELECT * FROM locations WHERE id = ? AND is_active = 1', [id]);
        if (!loc) {
            return res.status(404).json({
                success: false,
                message: 'Parking hub not found.'
            });
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const occupiedData = await db.get(`
            SELECT COUNT(DISTINCT slot_number) as count 
            FROM bookings 
            WHERE location_id = ? AND booking_date = ? AND status = 'CONFIRMED'
        `, [id, todayStr]);

        const occupiedSlots = occupiedData?.count || 0;
        const availableSlots = Math.max(0, 10 - occupiedSlots);
        const { multiplier, surgeTier } = calculateSurge(availableSlots, 10);
        const occupancyPct = Math.round((occupiedSlots / 10) * 100);
        const effectivePrice = Math.round(loc.base_price_per_hour * multiplier * 100) / 100;

        return res.json({
            success: true,
            location: {
                ...loc,
                total_slots: 10,
                available_slots: availableSlots,
                occupied_slots: occupiedSlots,
                occupancy_pct: occupancyPct,
                surge_multiplier: multiplier,
                surge_tier: surgeTier,
                effective_price_per_hour: effectivePrice,
                is_available: availableSlots > 0
            }
        });
    } catch (err) {
        console.error('Error fetching location:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while fetching hub details.'
        });
    }
}

module.exports = {
    getAllLocations,
    getLocationById,
    calculateSurge
};

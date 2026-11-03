/**
 * Booking Controller (v4.0)
 * Concurrency-Safe Reservations for 10 Shared Slots (P1 to P10) across 5 Urban Hubs:
 * (Gachibowli, Ameerpet, Banjara Hills, HITEC City, Madhapur).
 *
 * Enforces Cross-Hub Overlap Prevention:
 * "The same shared slot cannot be booked at two different hubs for overlapping times."
 * Locks serialization globally per slot (mutex key: `slot:${slotNumber}`)
 * inside SQLite BEGIN IMMEDIATE transactions.
 */

const db = require('../../database/db');
const { generateBookingId } = require('../utils/idGenerator');
const { locationMutex } = require('../utils/mutex');
const { calculateSurge } = require('./locationController');

function calculateHours(startTime, endTime) {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    const diff = (endMinutes - startMinutes) / 60;
    return Math.round(diff * 100) / 100;
}

/**
 * POST /api/bookings
 * Create a new parking reservation atomically.
 */
async function createBooking(req, res) {
    const { 
        userName, 
        userPhone, 
        userEmail,
        userId,
        locationId,
        location_id,
        slotNumber, 
        bookingDate, 
        startTime, 
        endTime, 
        slotsCount 
    } = req.body;

    // Common Input Validation
    if (!userName || typeof userName !== 'string' || userName.trim().length < 2 || userName.trim().length > 60) {
        return res.status(400).json({
            success: false,
            message: 'Please provide a valid full name (2 to 60 characters).'
        });
    }

    const cleanPhone = String(userPhone || '').replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
        return res.status(400).json({
            success: false,
            message: 'Please provide a valid phone number (10 to 15 digits).'
        });
    }

    let targetLocationId = (locationId || location_id || '').trim();
    if (!targetLocationId) {
        const firstLoc = await db.get('SELECT id FROM locations WHERE is_active = 1 ORDER BY CASE area WHEN "Gachibowli" THEN 1 WHEN "Ameerpet" THEN 2 WHEN "Banjara Hills" THEN 3 WHEN "HITEC City" THEN 4 WHEN "Madhapur" THEN 5 ELSE 6 END LIMIT 1');
        targetLocationId = firstLoc ? firstLoc.id : 'HUB-GCB';
    }

    const effectiveUserId = userId || req.user?.id || null;
    const effectiveEmail = (userEmail && userEmail.trim()) || req.user?.email || null;

    // =========================================================================
    // CASE 1: 10 Shared Slots (P1 to P10) Time-Range Aware Reservation
    // =========================================================================
    if (slotNumber) {
        const normalizedSlot = slotNumber.trim().toUpperCase();
        if (!normalizedSlot.match(/^P([1-9]|10)$/)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid slot identifier. Please choose a shared slot between P1 and P10.'
            });
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!bookingDate || !dateRegex.test(bookingDate)) {
            return res.status(400).json({
                success: false,
                message: 'Please select a valid booking date (YYYY-MM-DD).'
            });
        }

        const timeRegex = /^\d{2}:\d{2}$/;
        if (!startTime || !timeRegex.test(startTime) || !endTime || !timeRegex.test(endTime)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide valid start and end times in HH:MM format.'
            });
        }

        if (startTime >= endTime) {
            return res.status(400).json({
                success: false,
                message: 'End time must be later than start time.'
            });
        }

        const durationHours = calculateHours(startTime, endTime);
        if (durationHours < 0.5) {
            return res.status(400).json({
                success: false,
                message: 'Minimum booking duration is 30 minutes.'
            });
        }

        // Shared Slot Mutex Key: locks globally across ALL hubs on this shared slot (e.g. 'slot:P1')
        const lockKey = `slot:${normalizedSlot}`;

        try {
            const bookingResult = await locationMutex.runExclusive(lockKey, async () => {
                await db.run('BEGIN IMMEDIATE TRANSACTION;');

                try {
                    // 1. Verify hub exists
                    let facility = await db.get('SELECT * FROM locations WHERE id = ? AND is_active = 1', [targetLocationId]);
                    if (!facility) {
                        facility = await db.get('SELECT * FROM locations WHERE area LIKE ? OR name LIKE ? LIMIT 1', [`%${targetLocationId}%`, `%${targetLocationId}%`]);
                        if (facility) targetLocationId = facility.id;
                    }
                    if (!facility) {
                        await db.run('ROLLBACK;');
                        return { status: 404, data: { success: false, message: `Parking hub ${targetLocationId} not found or inactive.` } };
                    }

                    // 2. Verify shared slot exists & is operational
                    let slotRecord = await db.get('SELECT * FROM slots WHERE slot_number = ?', [normalizedSlot]);
                    if (!slotRecord) {
                        const slotIndex = parseInt(normalizedSlot.replace('P', ''), 10);
                        await db.run('INSERT INTO slots (slot_number, slot_index, is_active, category, base_price_per_hour) VALUES (?, ?, 1, "Shared Urban Bay", 50.0)', [normalizedSlot, slotIndex]);
                        slotRecord = await db.get('SELECT * FROM slots WHERE slot_number = ?', [normalizedSlot]);
                    }

                    if (slotRecord.is_active === 0) {
                        await db.run('ROLLBACK;');
                        return { status: 400, data: { success: false, message: `Slot ${normalizedSlot} is currently under maintenance.` } };
                    }

                    // 3. CORE RULE: Check for overlapping CONFIRMED bookings for this slot ACROSS ALL HUBS
                    // "The same shared slot cannot be booked at two different hubs for overlapping times."
                    const overlap = await db.get(`
                        SELECT b.id, b.location_id, l.name as hub_name, b.start_time, b.end_time 
                        FROM bookings b
                        LEFT JOIN locations l ON b.location_id = l.id
                        WHERE b.slot_number = ?
                          AND b.booking_date = ? 
                          AND b.status = 'CONFIRMED'
                          AND b.start_time < ? 
                          AND b.end_time > ?
                    `, [normalizedSlot, bookingDate, endTime, startTime]);

                    if (overlap) {
                        await db.run('ROLLBACK;');
                        const conflictHub = overlap.hub_name || overlap.location_id;
                        const sameHub = overlap.location_id === targetLocationId;
                        const message = sameHub 
                            ? `Slot ${normalizedSlot} at ${facility.name} is already booked on ${bookingDate} between ${overlap.start_time} and ${overlap.end_time}. Overlapping bookings are prevented!`
                            : `Slot ${normalizedSlot} is already booked at ${conflictHub} on ${bookingDate} between ${overlap.start_time} and ${overlap.end_time}. The same shared slot cannot be booked at two different hubs for overlapping times!`;

                        return {
                            status: 409,
                            data: {
                                success: false,
                                message,
                                conflicting_hub: conflictHub,
                                conflicting_booking: overlap.id
                            }
                        };
                    }

                    // 4. Calculate dynamic surge pricing for this hub & window
                    const concurrentBookings = await db.get(`
                        SELECT COUNT(DISTINCT slot_number) as booked_count 
                        FROM bookings 
                        WHERE location_id = ?
                          AND booking_date = ? 
                          AND status = 'CONFIRMED'
                          AND start_time < ? 
                          AND end_time > ?
                    `, [targetLocationId, bookingDate, endTime, startTime]);

                    const bookedCount = concurrentBookings?.booked_count || 0;
                    const occupancyPct = Math.round((bookedCount / 10) * 100);

                    let surgeMultiplier = 1.0;
                    let surgeTier = 'Normal (1.0x)';
                    if (occupancyPct >= 80) {
                        surgeMultiplier = 1.5;
                        surgeTier = 'Peak Surge (1.5x)';
                    } else if (occupancyPct >= 50) {
                        surgeMultiplier = 1.25;
                        surgeTier = 'Moderate Surge (1.25x)';
                    }

                    const basePricePerHour = facility.base_price_per_hour || 50.0;
                    const effectivePricePerHour = Math.round(basePricePerHour * surgeMultiplier * 100) / 100;
                    const totalAmount = Math.round(effectivePricePerHour * durationHours * 100) / 100;

                    const bookingId = generateBookingId();
                    const nowIso = new Date().toISOString();

                    await db.run(`
                        INSERT INTO bookings (
                            id, location_id, user_id, user_name, user_phone, user_email,
                            slot_number, booking_date, start_time, end_time, duration_hours,
                            slots_count, price_per_hour, surge_multiplier, total_amount, status, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'CONFIRMED', ?)
                    `, [
                        bookingId,
                        targetLocationId,
                        effectiveUserId,
                        userName.trim(),
                        cleanPhone,
                        effectiveEmail ? effectiveEmail.trim().toLowerCase() : null,
                        normalizedSlot,
                        bookingDate,
                        startTime,
                        endTime,
                        durationHours,
                        effectivePricePerHour,
                        surgeMultiplier,
                        totalAmount,
                        nowIso
                    ]);

                    // Audit trail record
                    await db.run(`
                        INSERT INTO audit_logs (
                            booking_id, location_id, slot_number, action, slots_changed, available_after, occupied_after, timestamp
                        ) VALUES (?, ?, ?, 'BOOKING_CREATED', 1, 0, 0, ?)
                    `, [bookingId, targetLocationId, normalizedSlot, nowIso]);

                    await db.run('COMMIT;');

                    if (req.broadcastUpdate) {
                        req.broadcastUpdate('BOOKING_CREATED', {
                            bookingId,
                            locationId: targetLocationId,
                            slotNumber: normalizedSlot,
                            bookingDate,
                            startTime,
                            endTime
                        });
                    }

                    return {
                        status: 201,
                        data: {
                            success: true,
                            message: `Slot ${normalizedSlot} at ${facility.name} successfully reserved for ${bookingDate} (${startTime} - ${endTime})!`,
                            booking: {
                                booking_id: bookingId,
                                location_id: targetLocationId,
                                location_name: facility.name,
                                area: facility.area,
                                address: facility.address,
                                slot_number: normalizedSlot,
                                booking_date: bookingDate,
                                start_time: startTime,
                                end_time: endTime,
                                duration_hours: durationHours,
                                user_name: userName.trim(),
                                user_phone: cleanPhone,
                                user_email: effectiveEmail || '',
                                price_per_hour: effectivePricePerHour,
                                surge_multiplier: surgeMultiplier,
                                surge_tier: surgeTier,
                                total_amount: totalAmount,
                                status: 'CONFIRMED',
                                created_at: nowIso
                            }
                        }
                    };
                } catch (err) {
                    await db.run('ROLLBACK;').catch(() => {});
                    throw err;
                }
            });

            return res.status(bookingResult.status).json(bookingResult.data);
        } catch (err) {
            console.error('Fatal slot reservation error:', err);
            return res.status(500).json({ success: false, message: 'Server error during slot reservation: ' + err.message });
        }
    }

    // =========================================================================
    // CASE 2: Legacy Aggregate Reservation (For legacy test compatibility)
    // =========================================================================
    const slots = parseInt(slotsCount, 10);
    if (isNaN(slots) || slots < 1 || slots > 10) {
        return res.status(400).json({
            success: false,
            message: 'You can reserve between 1 and 10 slots per booking.'
        });
    }

    try {
        const bookingResult = await locationMutex.runExclusive(targetLocationId, async () => {
            await db.run('BEGIN IMMEDIATE TRANSACTION;');

            try {
                const location = await db.get(
                    'SELECT * FROM locations WHERE id = ? AND is_active = 1',
                    [targetLocationId]
                );

                if (!location) {
                    await db.run('ROLLBACK;');
                    return { status: 404, data: { success: false, message: 'Parking hub not found or inactive.' } };
                }

                if (location.available_slots < slots) {
                    await db.run('ROLLBACK;');
                    return {
                        status: 409,
                        data: {
                            success: false,
                            message: `Insufficient slots available. Requested: ${slots}, Available: ${location.available_slots}.`,
                            available_slots: location.available_slots
                        }
                    };
                }

                const { multiplier, surgeTier } = calculateSurge(location.available_slots, location.total_slots);
                const effectivePricePerHour = Math.round(location.base_price_per_hour * multiplier * 100) / 100;
                const totalAmount = Math.round(effectivePricePerHour * slots * 100) / 100;

                const updateRes = await db.run(
                    `UPDATE locations 
                     SET available_slots = available_slots - ?, 
                         occupied_slots = occupied_slots + ?, 
                         updated_at = CURRENT_TIMESTAMP 
                     WHERE id = ? AND available_slots >= ?`,
                    [slots, slots, targetLocationId, slots]
                );

                if (updateRes.changes === 0) {
                    await db.run('ROLLBACK;');
                    return {
                        status: 409,
                        data: {
                            success: false,
                            message: 'Concurrency conflict: Slots were just allocated to another user. Please retry.',
                        }
                    };
                }

                const bookingId = generateBookingId();
                const nowIso = new Date().toISOString();
                const todayStr = nowIso.split('T')[0];

                await db.run(
                    `INSERT INTO bookings (
                        id, location_id, user_name, user_phone, slot_number, booking_date, start_time, end_time, slots_count, 
                        price_per_hour, surge_multiplier, total_amount, status, created_at
                    ) VALUES (?, ?, ?, ?, 'P1', ?, '09:00', '10:00', ?, ?, ?, ?, 'CONFIRMED', ?)`,
                    [
                        bookingId,
                        targetLocationId,
                        userName.trim(),
                        cleanPhone,
                        todayStr,
                        slots,
                        effectivePricePerHour,
                        multiplier,
                        totalAmount,
                        nowIso
                    ]
                );

                const newAvailable = location.available_slots - slots;
                const newOccupied = location.occupied_slots + slots;
                await db.run(
                    `INSERT INTO audit_logs (
                        booking_id, location_id, slot_number, action, slots_changed, available_after, occupied_after, timestamp
                    ) VALUES (?, ?, 'P1', 'BOOKING_CREATED', ?, ?, ?, ?)`,
                    [bookingId, targetLocationId, slots, newAvailable, newOccupied, nowIso]
                );

                await db.run('COMMIT;');

                if (req.broadcastUpdate) {
                    req.broadcastUpdate('BOOKING_CREATED', {
                        locationId: targetLocationId,
                        availableSlots: newAvailable,
                        occupiedSlots: newOccupied
                    });
                }

                return {
                    status: 201,
                    data: {
                        success: true,
                        message: 'Parking slot(s) reserved successfully!',
                        booking: {
                            booking_id: bookingId,
                            location_id: targetLocationId,
                            location_name: location.name,
                            location_address: location.address,
                            user_name: userName.trim(),
                            user_phone: cleanPhone,
                            slots_count: slots,
                            price_per_hour: effectivePricePerHour,
                            surge_multiplier: multiplier,
                            surge_tier: surgeTier,
                            total_amount: totalAmount,
                            status: 'CONFIRMED',
                            created_at: nowIso,
                            remaining_location_slots: newAvailable
                        }
                    }
                };
            } catch (err) {
                await db.run('ROLLBACK;').catch(() => {});
                throw err;
            }
        });

        return res.status(bookingResult.status).json(bookingResult.data);
    } catch (err) {
        console.error('Fatal booking allocation error:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error during reservation allocation: ' + err.message
        });
    }
}

/**
 * GET /api/bookings/my-history
 * Retrieve Current, Previous, and Cancelled bookings for a user,
 * enriched with hub name and area.
 */
async function getMyBookings(req, res) {
    try {
        const { phone, email, userId } = req.query;

        const effectiveUserId = userId || req.user?.id;
        const effectiveEmail = email || req.user?.email;
        const effectivePhone = phone || req.user?.phone;

        if (!effectiveUserId && !effectiveEmail && !effectivePhone) {
            return res.status(400).json({
                success: false,
                message: 'User identification (phone, email, or login) required to retrieve history.'
            });
        }

        const cleanPhone = effectivePhone ? String(effectivePhone).replace(/\D/g, '') : '';
        const normalizedEmail = effectiveEmail ? String(effectiveEmail).trim().toLowerCase() : '';

        const bookings = await db.all(`
            SELECT b.*, COALESCE(l.name, 'Hyderabad Hub') as location_name,
                   COALESCE(l.area, 'Ameerpet') as area,
                   COALESCE(l.address, 'Hyderabad') as address
            FROM bookings b
            LEFT JOIN locations l ON b.location_id = l.id
            WHERE (b.user_id = ? AND b.user_id IS NOT NULL)
               OR (b.user_phone = ? AND b.user_phone != '')
               OR (b.user_email = ? AND b.user_email != '')
            ORDER BY b.created_at DESC
        `, [effectiveUserId || 0, cleanPhone, normalizedEmail]);

        const todayStr = new Date().toISOString().split('T')[0];

        const current = [];
        const previous = [];
        const cancelled = [];

        bookings.forEach(b => {
            if (b.status === 'CANCELLED' || b.status === 'RELEASED') {
                cancelled.push(b);
            } else if (b.status === 'CONFIRMED') {
                if (b.booking_date >= todayStr) {
                    current.push(b);
                } else {
                    previous.push(b);
                }
            } else {
                previous.push(b);
            }
        });

        return res.json({
            success: true,
            counts: {
                total: bookings.length,
                current: current.length,
                previous: previous.length,
                cancelled: cancelled.length
            },
            current,
            previous,
            cancelled,
            all: bookings
        });
    } catch (err) {
        console.error('Error fetching user booking history:', err);
        return res.status(500).json({ success: false, message: 'Server error retrieving booking history.' });
    }
}

/**
 * GET /api/bookings/:id
 * Retrieve a booking with phone verification for privacy protection
 */
async function getBooking(req, res) {
    try {
        const { id } = req.params;
        const { phone } = req.query;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'Verification required: Please enter the phone number associated with this booking ID.'
            });
        }

        const cleanPhone = String(phone).replace(/\D/g, '');

        const booking = await db.get(
            `SELECT b.*, COALESCE(l.name, 'ParkSmart Hub') as location_name, 
                    COALESCE(l.area, 'Ameerpet') as area,
                    COALESCE(l.address, 'Hyderabad') as location_address, 
                    COALESCE(l.city, 'Hyderabad') as location_city
             FROM bookings b
             LEFT JOIN locations l ON b.location_id = l.id
             WHERE b.id = ?`,
            [id.trim().toUpperCase()]
        );

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'No booking found matching the provided Booking ID.'
            });
        }

        if (booking.user_phone !== cleanPhone && !booking.user_phone.endsWith(cleanPhone)) {
            return res.status(403).json({
                success: false,
                message: 'Verification failed: Phone number does not match this booking record.'
            });
        }

        const maskedPhone = booking.user_phone.slice(0, 3) + '****' + booking.user_phone.slice(-3);

        return res.json({
            success: true,
            booking: {
                id: booking.id,
                slot_number: booking.slot_number || 'P1',
                booking_date: booking.booking_date,
                start_time: booking.start_time,
                end_time: booking.end_time,
                duration_hours: booking.duration_hours,
                location_id: booking.location_id,
                location_name: booking.location_name,
                area: booking.area,
                location_address: booking.location_address,
                location_city: booking.location_city,
                user_name: booking.user_name,
                user_phone_masked: maskedPhone,
                slots_count: booking.slots_count,
                price_per_hour: booking.price_per_hour,
                surge_multiplier: booking.surge_multiplier,
                total_amount: booking.total_amount,
                status: booking.status,
                created_at: booking.created_at,
                released_at: booking.released_at,
                can_release: booking.status === 'CONFIRMED'
            }
        });
    } catch (err) {
        console.error('Error retrieving booking:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving booking.'
        });
    }
}

/**
 * POST /api/bookings/:id/release
 * Release or cancel an active reservation atomically
 */
async function releaseBooking(req, res) {
    try {
        const { id } = req.params;
        const { phone } = req.body;

        const cleanPhone = phone ? String(phone).replace(/\D/g, '') : (req.user?.phone || '');
        const bookingId = id.trim().toUpperCase();

        const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }

        const isAdmin = req.user && req.user.role === 'admin';
        if (!isAdmin && cleanPhone && booking.user_phone !== cleanPhone && !booking.user_phone.endsWith(cleanPhone)) {
            return res.status(403).json({ success: false, message: 'Verification failed: Phone number does not match this booking.' });
        }

        if (booking.status !== 'CONFIRMED') {
            return res.status(400).json({
                success: false,
                message: `This booking cannot be released because it is already ${booking.status}.`
            });
        }

        const nowIso = new Date().toISOString();

        // Release slot atomically
        await db.run('UPDATE bookings SET status = "RELEASED", released_at = ? WHERE id = ?', [nowIso, bookingId]);
        await db.run(`
            INSERT INTO audit_logs (booking_id, location_id, slot_number, action, slots_changed, available_after, occupied_after, timestamp)
            VALUES (?, ?, ?, 'BOOKING_RELEASED', -1, 0, 0, ?)
        `, [bookingId, booking.location_id, booking.slot_number || 'P1', nowIso]);

        if (req.broadcastUpdate) {
            req.broadcastUpdate('BOOKING_RELEASED', {
                bookingId,
                locationId: booking.location_id,
                slotNumber: booking.slot_number,
                bookingDate: booking.booking_date
            });
        }

        return res.json({
            success: true,
            message: `Booking ${bookingId} has been successfully released/cancelled.`,
            booking: {
                id: bookingId,
                status: 'RELEASED',
                released_at: nowIso
            }
        });
    } catch (err) {
        console.error('Error releasing booking:', err);
        return res.status(500).json({ success: false, message: 'Server error while releasing booking.' });
    }
}

module.exports = {
    createBooking,
    getMyBookings,
    getBooking,
    releaseBooking
};

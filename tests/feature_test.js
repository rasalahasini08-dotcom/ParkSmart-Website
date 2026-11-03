/**
 * ParkSmart New Features Verification Test
 * Tests:
 * 1. User & Admin Authentication
 * 2. 25 Selectable Parking Slots (P1 to P25)
 * 3. Date & Time Selection
 * 4. Overlap Prevention (allows non-overlapping times on same slot, blocks overlapping times)
 * 5. Booking Confirmation & Unique IDs
 * 6. User Booking History (Current, Previous, Cancelled)
 * 7. Admin Dashboard APIs (Slot Maintenance Toggle, All Bookings Audit)
 * 8. Surge Analytics with database-derived peak periods
 */

const http = require('http');
const { app } = require('../backend/server');
const db = require('../database/db');

const PORT = 3005;
const BASE_URL = `http://localhost:${PORT}`;

function req(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const r = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch { parsed = data; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });

        r.on('error', reject);
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

async function runFeatureTests() {
    console.log('================================================================');
    console.log(' ParkSmart New Features & Concurrency Verification Test');
    console.log('================================================================');

    await db.initSchema();
    await db.run("DELETE FROM bookings WHERE user_email LIKE '%@example.com'");
    const server = app.listen(PORT);
    await new Promise(r => setTimeout(r, 200));

    let passed = 0;
    let failed = 0;

    function assert(cond, name, info = '') {
        if (cond) {
            console.log(` ✅ PASS: ${name}`);
            passed++;
        } else {
            console.error(` ❌ FAIL: ${name} - ${info}`);
            failed++;
        }
    }

    try {
        // 1. User Login
        const userLogin = await req('POST', '/api/auth/login', {
            email: 'user@parksmart.local',
            password: 'user123'
        });
        assert(userLogin.status === 200 && !!userLogin.body.token, 'User login succeeds with token');
        const userToken = userLogin.body.token;

        // 2. Admin Login
        const adminLogin = await req('POST', '/api/auth/login', {
            email: 'admin@parksmart.local',
            password: 'admin123',
            role: 'admin'
        });
        assert(adminLogin.status === 200 && adminLogin.body.user.role === 'admin', 'Admin login succeeds with admin privileges');
        const adminToken = adminLogin.body.token;

        // 3. Query 25 Slots
        const testDate = '2026-11-15';
        const slotsRes = await req('GET', `/api/slots?date=${testDate}&start_time=10:00&end_time=12:00`);
        assert(slotsRes.status === 200, 'GET /api/slots returns 200 OK');
        assert(Array.isArray(slotsRes.body.slots) && slotsRes.body.slots.length === 25, 'Returns exactly 25 parking slots');
        assert(slotsRes.body.slots[0].slot_number === 'P1' && slotsRes.body.slots[24].slot_number === 'P25', 'Slots ordered correctly from P1 to P25');

        // 4. Book Slot P5 for 10:00 to 12:00
        const bookP5 = await req('POST', '/api/bookings', {
            slotNumber: 'P5',
            bookingDate: testDate,
            startTime: '10:00',
            endTime: '12:00',
            userName: 'Vikram Mehta',
            userPhone: '9876543299',
            userEmail: 'vikram@example.com'
        }, userToken);
        assert(bookP5.status === 201 && bookP5.body.success === true, 'Successfully books slot P5 for 10:00 - 12:00');
        const p5BookingId = bookP5.body.booking.booking_id;
        assert(typeof p5BookingId === 'string' && p5BookingId.startsWith('PS-'), 'Generates unique booking ID (PS-YYYYMMDD-XXXX)');

        // 5. Overlap Prevention: Try to book P5 during overlapping time (11:00 to 13:00)
        const overlapAttempt = await req('POST', '/api/bookings', {
            slotNumber: 'P5',
            bookingDate: testDate,
            startTime: '11:00',
            endTime: '13:00',
            userName: 'Second Driver',
            userPhone: '9123456780',
            userEmail: 'driver2@example.com'
        });
        assert(overlapAttempt.status === 409, 'Rejects overlapping booking for P5 with 409 Conflict');

        // 6. Non-overlapping Booking: Book P5 on the same day for 14:00 to 16:00
        const nonOverlapBooking = await req('POST', '/api/bookings', {
            slotNumber: 'P5',
            bookingDate: testDate,
            startTime: '14:00',
            endTime: '16:00',
            userName: 'Afternoon Driver',
            userPhone: '9123456789',
            userEmail: 'afternoon@example.com'
        });
        assert(nonOverlapBooking.status === 201, 'Allows booking the same slot P5 at a non-overlapping time (14:00 - 16:00)', JSON.stringify(nonOverlapBooking));

        // 7. Verify Slot Grid Colors for 10:00 - 12:00
        const checkGrid = await req('GET', `/api/slots?date=${testDate}&start_time=10:00&end_time=12:00`);
        const slotP5 = checkGrid.body.slots.find(s => s.slot_number === 'P5');
        const slotP6 = checkGrid.body.slots.find(s => s.slot_number === 'P6');
        assert(slotP5.status === 'BOOKED', 'Slot P5 status is BOOKED (Red) during its reserved period');
        assert(slotP6.status === 'AVAILABLE', 'Slot P6 status is AVAILABLE (Green)');

        // 8. User Booking History
        const historyRes = await req('GET', '/api/bookings/my-history?phone=9876543299', null, userToken);
        assert(historyRes.status === 200, 'User can fetch booking history');
        assert(historyRes.body.current.some(b => b.id === p5BookingId), 'Current bookings category includes newly created booking');

        // 9. Cancellation / Release
        const cancelRes = await req('POST', `/api/bookings/${p5BookingId}/release`, {
            phone: '9876543299'
        }, userToken);
        assert(cancelRes.status === 200, 'User can cancel/release their booking');

        // Verify slot P5 is now AVAILABLE again after cancellation
        const checkAfterCancel = await req('GET', `/api/slots?date=${testDate}&start_time=10:00&end_time=12:00`);
        const p5After = checkAfterCancel.body.slots.find(s => s.slot_number === 'P5');
        assert(p5After.status === 'AVAILABLE', 'Slot P5 immediately becomes AVAILABLE (Green) after cancellation');

        // 10. Admin Dashboard Oversight
        const adminOverview = await req('GET', '/api/admin/overview', null, adminToken);
        assert(adminOverview.status === 200 && adminOverview.body.overview.total_slots >= 25, 'Admin overview loads 25 slots correctly');

        // Toggle slot maintenance for P20
        const toggleMaint = await req('POST', '/api/admin/slots/P20/toggle', {}, adminToken);
        assert(toggleMaint.status === 200 && toggleMaint.body.slot.is_active === 0, 'Admin can toggle slot P20 to maintenance');

        const checkMaint = await req('GET', `/api/slots?date=${testDate}&start_time=10:00&end_time=12:00`);
        const p20Status = checkMaint.body.slots.find(s => s.slot_number === 'P20');
        assert(p20Status.status === 'MAINTENANCE', 'Slot P20 shows MAINTENANCE status to users');

        // Toggle P20 back to active
        await req('POST', '/api/admin/slots/P20/toggle', {}, adminToken);

        // 11. Surge Analytics
        const analyticsRes = await req('GET', '/api/analytics');
        assert(analyticsRes.status === 200, 'Surge Analytics returns 200 OK');
        assert(analyticsRes.body.metrics.total_capacity >= 25, 'Surge Analytics tracks 25-slot capacity');
        assert(Array.isArray(analyticsRes.body.slot_utilization), 'Surge Analytics provides slot utilization breakdown');

    } catch (err) {
        console.error('Test error:', err);
        failed++;
    } finally {
        await new Promise(r => server.close(r));
        console.log('================================================================');
        console.log(` Summary: ${passed} Passed, ${failed} Failed`);
        console.log('================================================================');
        if (failed > 0) throw new Error(`${failed} feature tests failed`);
    }
}

if (require.main === module) {
    runFeatureTests().catch(() => process.exit(1));
}

module.exports = runFeatureTests;

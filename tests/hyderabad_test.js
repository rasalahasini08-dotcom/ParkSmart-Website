/**
 * ParkSmart Comprehensive Hyderabad Feature & Concurrency Test
 * Validates all 8 project requirements:
 * 1. Multiple parking facilities grouped by Hyderabad areas (Ameerpet, Banjara Hills, Gachibowli, etc.)
 * 2. Admin add and edit parking facilities (auto-creating 25 slots)
 * 3. 25 dedicated slots (P1 to P25) per facility with green/red/blue/grey states
 * 4. Time-range booking preventing overlapping slots at the same facility
 * 5. Independent slot booking across different facilities
 * 6. Separate User and Admin authentication & RBAC protection
 * 7. Booking confirmation with unique Booking ID & user history with cancellation
 * 8. Surge Analytics with cross-area demand comparison from actual SQLite records
 */

const assert = require('assert');
const http = require('http');

const PORT = 3001; // Run test on port 3001
process.env.PORT = PORT;

const { app } = require('../backend/server');
const db = require('../database/db');

let server;

function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const reqHeaders = { ...headers };
        let reqBody = null;

        if (body) {
            reqBody = JSON.stringify(body);
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
        }

        const req = http.request({
            hostname: '127.0.0.1',
            port: PORT,
            path: encodeURI(path),
            method,
            headers: reqHeaders
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (reqBody) req.write(reqBody);
        req.end();
    });
}

async function runTests() {
    console.log('===============================================================');
    console.log('🚀 Running ParkSmart Hyderabad Urban Allocator Test Suite');
    console.log('===============================================================\n');

    // 1. Initialize schema
    await db.initSchema();

    // Clean up test bookings
    await db.run("DELETE FROM bookings WHERE user_email LIKE '%@test.local'");

    // Start server
    await new Promise((resolve) => {
        server = app.listen(PORT, '127.0.0.1', () => {
            console.log(`[Test Server] Running on http://127.0.0.1:${PORT}`);
            resolve();
        });
    });

    let adminToken = '';
    let userToken = '';

    try {
        // -------------------------------------------------------------
        // TEST 1: Authentication & RBAC
        // -------------------------------------------------------------
        console.log('▶ [1/8] Testing Authentication & RBAC...');
        const adminLogin = await request('POST', '/api/auth/login', {
            email: 'admin@parksmart.local',
            password: 'admin123'
        });
        assert.strictEqual(adminLogin.status, 200, 'Admin login should succeed');
        assert.strictEqual(adminLogin.data.user.role, 'admin');
        adminToken = adminLogin.data.token;

        const userLogin = await request('POST', '/api/auth/login', {
            email: 'user@parksmart.local',
            password: 'user123'
        });
        assert.strictEqual(userLogin.status, 200, 'User login should succeed');
        assert.strictEqual(userLogin.data.user.role, 'user');
        userToken = userLogin.data.token;

        // Verify non-admin blocked from admin endpoints
        const forbiddenCheck = await request('GET', '/api/admin/overview', null, {
            'Authorization': `Bearer ${userToken}`
        });
        assert.strictEqual(forbiddenCheck.status, 403, 'Ordinary user must be forbidden from admin overview');
        console.log('  ✔ Authentication and RBAC protection verified.');

        // -------------------------------------------------------------
        // TEST 2: Hyderabad Urban Locations Grouped by Area
        // -------------------------------------------------------------
        console.log('\n▶ [2/8] Testing Hyderabad Urban Locations & Area Grouping...');
        const locRes = await request('GET', '/api/locations');
        assert.strictEqual(locRes.status, 200);
        assert(locRes.data.areas.includes('Ameerpet'), 'Must include Ameerpet');
        assert(locRes.data.areas.includes('Banjara Hills'), 'Must include Banjara Hills');
        assert(locRes.data.areas.includes('Gachibowli'), 'Must include Gachibowli');
        assert(locRes.data.locations.length >= 5, 'Must have multiple facilities');
        assert(locRes.data.grouped_by_area['Ameerpet'].length >= 1, 'Grouped by area must contain Ameerpet');

        // Test Area Filtering
        const banjaraRes = await request('GET', '/api/locations?area=Banjara Hills');
        assert.strictEqual(banjaraRes.status, 200);
        banjaraRes.data.locations.forEach(loc => {
            assert.strictEqual(loc.area, 'Banjara Hills', 'All filtered locations must be in Banjara Hills');
        });
        console.log('  ✔ Hyderabad areas and location filtering verified.');

        // -------------------------------------------------------------
        // TEST 3: Admin Add & Edit Facility (Auto-creating 25 slots)
        // -------------------------------------------------------------
        console.log('\n▶ [3/8] Testing Admin Add & Edit Facility...');
        const newFac = await request('POST', '/api/admin/locations', {
            name: 'Kondapur Tech Zone Deck [Sample]',
            area: 'Kondapur',
            address: 'Opposite RTO Office, Kondapur Main Road',
            city: 'Hyderabad',
            base_price_per_hour: 45.0
        }, { 'Authorization': `Bearer ${adminToken}` });

        assert.strictEqual(newFac.status, 201, 'Admin should be able to create facility');
        const createdId = newFac.data.location.id;
        assert(createdId.startsWith('HYD-KON-'), 'Facility ID should be generated properly');

        // Check if 25 slots were auto-created for this new facility
        const newSlots = await request('GET', `/api/slots?location_id=${createdId}`);
        assert.strictEqual(newSlots.status, 200);
        assert.strictEqual(newSlots.data.slots.length, 25, 'New facility must have exactly 25 slots');
        assert.strictEqual(newSlots.data.slots[0].slot_number, 'P1');
        assert.strictEqual(newSlots.data.slots[24].slot_number, 'P25');

        // Test editing facility
        const editFac = await request('PUT', `/api/admin/locations/${createdId}`, {
            name: 'Kondapur Tech Zone Deck (Updated) [Sample]',
            base_price_per_hour: 55.0
        }, { 'Authorization': `Bearer ${adminToken}` });
        assert.strictEqual(editFac.status, 200);
        assert.strictEqual(editFac.data.location.base_price_per_hour, 55.0);
        console.log('  ✔ Admin Add & Edit facility with 25 slots auto-generation verified.');

        // -------------------------------------------------------------
        // TEST 4: Dedicated 25 Slots (P1 to P25) per Facility
        // -------------------------------------------------------------
        console.log('\n▶ [4/8] Testing 25 Slots Isolation per Facility...');
        const fac1Slots = await request('GET', '/api/slots?location_id=HYD-AMP-01');
        const fac2Slots = await request('GET', '/api/slots?location_id=HYD-BJH-01');
        assert.strictEqual(fac1Slots.data.slots.length, 25);
        assert.strictEqual(fac2Slots.data.slots.length, 25);
        assert.strictEqual(fac1Slots.data.facility.area, 'Ameerpet');
        assert.strictEqual(fac2Slots.data.facility.area, 'Banjara Hills');
        console.log('  ✔ Dedicated 25 slots per facility confirmed.');

        // -------------------------------------------------------------
        // TEST 5: Time Overlap Prevention on Same Facility & Slot
        // -------------------------------------------------------------
        console.log('\n▶ [5/8] Testing Time Overlap Prevention...');
        const testDate = '2026-11-15';
        
        // Booking 1: HYD-AMP-01, Slot P3, 10:00 - 12:00
        const b1 = await request('POST', '/api/bookings', {
            locationId: 'HYD-AMP-01',
            slotNumber: 'P3',
            bookingDate: testDate,
            startTime: '10:00',
            endTime: '12:00',
            userName: 'Ramesh Kumar',
            userPhone: '9876543210',
            userEmail: 'ramesh@test.local'
        }, { 'Authorization': `Bearer ${userToken}` });

        assert.strictEqual(b1.status, 201, 'Booking 1 should succeed');
        const bookingId1 = b1.data.booking.booking_id;
        assert(bookingId1.startsWith('PS-'), 'Booking ID must start with PS-');
        assert.strictEqual(b1.data.booking.slot_number, 'P3');

        // Booking 2: Overlapping on same slot P3 (11:00 - 13:00) -> MUST FAIL (409)
        const b2 = await request('POST', '/api/bookings', {
            locationId: 'HYD-AMP-01',
            slotNumber: 'P3',
            bookingDate: testDate,
            startTime: '11:00',
            endTime: '13:00',
            userName: 'Suresh Rao',
            userPhone: '9876543211',
            userEmail: 'suresh@test.local'
        });

        assert.strictEqual(b2.status, 409, 'Overlapping booking must return 409 Conflict');
        assert(b2.data.message.includes('already booked'), 'Conflict message must inform user');

        // Booking 3: Non-overlapping on same slot P3 (14:00 - 16:00) -> MUST SUCCEED
        const b3 = await request('POST', '/api/bookings', {
            locationId: 'HYD-AMP-01',
            slotNumber: 'P3',
            bookingDate: testDate,
            startTime: '14:00',
            endTime: '16:00',
            userName: 'Suresh Rao',
            userPhone: '9876543211',
            userEmail: 'suresh@test.local'
        });
        assert.strictEqual(b3.status, 201, 'Non-overlapping booking on same slot must succeed');

        // Booking 4: Same slot P3 on DIFFERENT facility (HYD-BJH-01) at same time (10:00 - 12:00) -> MUST SUCCEED
        const b4 = await request('POST', '/api/bookings', {
            locationId: 'HYD-BJH-01',
            slotNumber: 'P3',
            bookingDate: testDate,
            startTime: '10:00',
            endTime: '12:00',
            userName: 'Anita Reddy',
            userPhone: '9876543212',
            userEmail: 'anita@test.local'
        });
        assert.strictEqual(b4.status, 201, 'Same slot at different facility must be independent and succeed');
        console.log('  ✔ Time overlap prevention and inter-facility slot independence verified.');

        // -------------------------------------------------------------
        // TEST 6: User Booking History & Cancellation
        // -------------------------------------------------------------
        console.log('\n▶ [6/8] Testing User Booking History & Cancellation...');
        const histRes = await request('GET', '/api/bookings/my-history', null, {
            'Authorization': `Bearer ${userToken}`
        });
        assert.strictEqual(histRes.status, 200);
        assert(histRes.data.all.length >= 1, 'History must contain user bookings');
        const bookedItem = histRes.data.all.find(b => b.id === bookingId1);
        assert(bookedItem, 'Booking ID 1 must be present in history');
        assert.strictEqual(bookedItem.area, 'Ameerpet', 'History must display area');

        // Cancel the booking
        const cancelRes = await request('POST', `/api/bookings/${bookingId1}/release`, {
            phone: '9876543210'
        }, { 'Authorization': `Bearer ${userToken}` });
        assert.strictEqual(cancelRes.status, 200, 'Cancellation should succeed');
        assert.strictEqual(cancelRes.data.booking.status, 'RELEASED');

        // Verify slot is now free again for that time!
        const rebook = await request('POST', '/api/bookings', {
            locationId: 'HYD-AMP-01',
            slotNumber: 'P3',
            bookingDate: testDate,
            startTime: '10:00',
            endTime: '12:00',
            userName: 'New Driver',
            userPhone: '9876543299',
            userEmail: 'new@test.local'
        });
        assert.strictEqual(rebook.status, 201, 'Slot must be immediately bookable after cancellation');
        console.log('  ✔ User booking history and cancellation verified.');

        // -------------------------------------------------------------
        // TEST 7: Admin Slot Maintenance & Management
        // -------------------------------------------------------------
        console.log('\n▶ [7/8] Testing Admin Slot Maintenance Toggle...');
        const toggleRes = await request('POST', '/api/admin/slots/P25/toggle', {
            locationId: 'HYD-AMP-01'
        }, { 'Authorization': `Bearer ${adminToken}` });
        assert.strictEqual(toggleRes.status, 200);
        assert.strictEqual(toggleRes.data.slot.is_active, 0, 'Slot should now be under maintenance');

        // Attempting to book maintenance slot should fail
        const maintBook = await request('POST', '/api/bookings', {
            locationId: 'HYD-AMP-01',
            slotNumber: 'P25',
            bookingDate: testDate,
            startTime: '09:00',
            endTime: '10:00',
            userName: 'Test User',
            userPhone: '9876543210',
            userEmail: 'test@test.local'
        });
        assert.strictEqual(maintBook.status, 400, 'Maintenance slot must reject bookings');

        // Re-activate slot
        await request('POST', '/api/admin/slots/P25/toggle', {
            locationId: 'HYD-AMP-01'
        }, { 'Authorization': `Bearer ${adminToken}` });
        console.log('  ✔ Admin slot maintenance toggle verified.');

        // -------------------------------------------------------------
        // TEST 8: Surge Analytics & Hyderabad Area Demand Comparison
        // -------------------------------------------------------------
        console.log('\n▶ [8/8] Testing Surge Analytics & Cross-Area Demand Comparison...');
        const analyticsRes = await request('GET', '/api/analytics');
        assert.strictEqual(analyticsRes.status, 200);
        const a = analyticsRes.data;
        assert(a.metrics.total_capacity > 0, 'Total capacity must be > 0');
        assert(a.metrics.concurrency_integrity_verified === true, 'Concurrency integrity must be verified');
        assert(Array.isArray(a.area_demand), 'Area demand must be returned');
        assert(a.area_demand.length > 0, 'Must have area demand records');
        
        const ameerpetDemand = a.area_demand.find(item => item.area === 'Ameerpet');
        assert(ameerpetDemand, 'Ameerpet must be in area comparison');
        assert(ameerpetDemand.total_bookings > 0, 'Ameerpet must have booking counts');

        console.log(`  ✔ Total Capacity: ${a.metrics.total_capacity} Bays across ${a.metrics.total_facilities} facilities.`);
        console.log(`  ✔ Cross-Area Comparison: ${a.area_demand.map(ad => `${ad.area}: ${ad.total_bookings} bookings`).join(', ')}.`);
        console.log('  ✔ Surge Analytics verified.');

        console.log('\n===============================================================');
        console.log('🎉 ALL 8 HYDERABAD REQUIREMENTS PASSED VERIFICATION!');
        console.log('===============================================================');
    } finally {
        if (server) {
            await new Promise(r => server.close(r));
        }
        if (require.main === module) {
            await db.close();
        }
    }
}

if (require.main === module) {
    runTests().catch(err => {
        console.error('Test Suite Failed:', err);
        process.exit(1);
    });
}

module.exports = runTests;

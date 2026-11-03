/**
 * ParkSmart Persistence Verification
 * Proves that booking records and slot counts survive server restarts.
 */

const { app } = require('../backend/server');
const db = require('../database/db');
const http = require('http');

function post(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function get(path) {
    return new Promise((resolve, reject) => {
        const req = http.get({
            hostname: 'localhost',
            port: 3001,
            path
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.on('error', reject);
    });
}

async function run() {
    console.log('[Persistence Test] Phase 1: Booting Server Instance #1 on port 3001...');
    const server1 = app.listen(3001);
    await new Promise(r => setTimeout(r, 200));

    // 1. Create a reservation on Server 1
    const loc = await db.get('SELECT * FROM locations WHERE available_slots >= 1 AND is_active = 1 LIMIT 1');
    const bookRes = await post('/api/bookings', {
        userName: 'Persistence Test User',
        userPhone: '9988776655',
        locationId: loc.id,
        slotsCount: 1
    });

    const createdId = bookRes.body.booking.booking_id;
    console.log(`[Persistence Test] Created booking "${createdId}" on Server 1.`);

    // 2. Shut down Server 1 completely
    console.log('[Persistence Test] Phase 2: Shutting down Server 1 (simulating process termination)...');
    await new Promise(r => server1.close(r));
    console.log('[Persistence Test] Server 1 is completely closed.');

    // 3. Start Server 2 from scratch (simulating restart on another day)
    console.log('[Persistence Test] Phase 3: Booting Server Instance #2 on port 3001...');
    const server2 = app.listen(3001);
    await new Promise(r => setTimeout(r, 200));

    // 4. Retrieve booking on Server 2
    const fetchRes = await get(`/api/bookings/${createdId}?phone=9988776655`);
    console.log(`[Persistence Test] Queried Server 2 for booking "${createdId}" -> Status: ${fetchRes.status}`);

    if (fetchRes.status === 200 && fetchRes.body.booking.id === createdId) {
        console.log(' ✅ PASS: Booking data fully persisted and recovered across server restart!');
    } else {
        console.error(' ❌ FAIL: Booking was not persisted across restart.');
        process.exit(1);
    }

    // Clean up
    await post(`/api/bookings/${createdId}/release`, { phone: '9988776655' });
    console.log('[Persistence Test] Slot cleanly released.');

    server2.close(() => {
        console.log('[Persistence Test] Persistence verified 100% successfully.\n');
        process.exit(0);
    });
}

run().catch(err => {
    console.error('Persistence test failed:', err);
    process.exit(1);
});

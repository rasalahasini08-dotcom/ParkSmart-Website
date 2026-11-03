/**
 * ParkSmart Concurrency Stress Test
 * Simulates simultaneous race conditions across multiple client threads.
 * Proves that overbooking is mathematically prevented under concurrent load.
 */

const http = require('http');
const db = require('../database/db');

const BASE_URL = 'http://localhost:3000';

function postBooking(userName, userPhone, locationId, slotsCount) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ userName, userPhone, locationId, slotsCount });
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/bookings',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = {};
                try { parsed = JSON.parse(data); } catch {}
                resolve({ status: res.statusCode, body: parsed });
            });
        });

        req.on('error', (err) => {
            resolve({ status: 500, error: err.message });
        });

        req.write(body);
        req.end();
    });
}

async function runConcurrencyTest() {
    console.log('================================================================');
    console.log(' Starting ParkSmart Concurrency Race Condition Test');
    console.log('================================================================');

    const TEST_LOC_ID = 'LOC-CONCUR-TEST';

    // 1. Prepare test facility with exactly 2 available slots
    await db.run('DELETE FROM locations WHERE id = ?', [TEST_LOC_ID]);
    await db.run(`
        INSERT INTO locations (id, name, address, city, total_slots, available_slots, occupied_slots, base_price_per_hour, is_active)
        VALUES (?, 'High-Speed Test Bay [Concurrency]', '99 Race Track Boulevard', 'Metro City', 10, 2, 8, 50.0, 1)
    `, [TEST_LOC_ID]);

    console.log(`[Setup] Created facility "${TEST_LOC_ID}" with total=10, available=2, occupied=8`);
    console.log('[Stress] Launching 10 SIMULTANEOUS asynchronous booking requests for 1 slot each...');

    const SIMULTANEOUS_REQUESTS = 10;
    const promises = [];

    const startTime = Date.now();

    for (let i = 1; i <= SIMULTANEOUS_REQUESTS; i++) {
        promises.push(
            postBooking(`Concurrent Driver #${i}`, `98765432${String(i).padStart(2, '0')}`, TEST_LOC_ID, 1)
        );
    }

    // Fire all requests concurrently
    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;

    console.log(`[Results] All 10 requests completed in ${duration}ms.`);

    let successCount = 0;
    let conflictCount = 0;
    let errorCount = 0;

    results.forEach((r, idx) => {
        if (r.status === 201) {
            successCount++;
            console.log(`  Driver #${idx + 1}: HTTP 201 CREATED (ID: ${r.body.booking?.booking_id})`);
        } else if (r.status === 409) {
            conflictCount++;
            console.log(`  Driver #${idx + 1}: HTTP 409 CONFLICT - ${r.body.message}`);
        } else {
            errorCount++;
            console.log(`  Driver #${idx + 1}: Unexpected HTTP ${r.status}`);
        }
    });

    // 2. Verify Final Database Invariants
    const finalState = await db.get('SELECT * FROM locations WHERE id = ?', [TEST_LOC_ID]);

    console.log('\n----------------------------------------------------------------');
    console.log(' Final Database Audit:');
    console.log(` Total Slots:     ${finalState.total_slots}`);
    console.log(` Available Slots: ${finalState.available_slots} (Expected: 0)`);
    console.log(` Occupied Slots:  ${finalState.occupied_slots} (Expected: 10)`);
    console.log(` Invariant Check: ${finalState.available_slots + finalState.occupied_slots} == ${finalState.total_slots}`);
    console.log('----------------------------------------------------------------');

    let allPassed = true;

    if (successCount === 2) {
        console.log(' ✅ PASS: Exactly 2 requests succeeded (matches available inventory).');
    } else {
        console.error(` ❌ FAIL: Expected 2 successes, got ${successCount}`);
        allPassed = false;
    }

    if (conflictCount === 8) {
        console.log(' ✅ PASS: Exactly 8 requests safely rejected with 409 Conflict.');
    } else {
        console.error(` ❌ FAIL: Expected 8 conflicts, got ${conflictCount}`);
        allPassed = false;
    }

    if (finalState.available_slots === 0 && finalState.occupied_slots === 10) {
        console.log(' ✅ PASS: Zero overbooking occurred! Available slots reached exactly 0.');
    } else {
        console.error(' ❌ FAIL: Slot counts do not match expected totals.');
        allPassed = false;
    }

    if (finalState.available_slots >= 0) {
        console.log(' ✅ PASS: Negative slot protection intact.');
    } else {
        console.error(' ❌ FAIL: Negative available slots detected!');
        allPassed = false;
    }

    // Clean up test location
    await db.run('DELETE FROM bookings WHERE location_id = ?', [TEST_LOC_ID]);
    await db.run('DELETE FROM audit_logs WHERE location_id = ?', [TEST_LOC_ID]);
    await db.run('DELETE FROM locations WHERE id = ?', [TEST_LOC_ID]);

    console.log('================================================================');
    if (allPassed) {
        console.log(' 🏆 CONCURRENCY SAFETY VERIFIED: ZERO RACE CONDITIONS DETECTED.');
    } else {
        console.error(' ❌ CONCURRENCY TEST FAILED.');
        process.exit(1);
    }
    console.log('================================================================\n');
}

if (require.main === module) {
    runConcurrencyTest();
}

module.exports = runConcurrencyTest;

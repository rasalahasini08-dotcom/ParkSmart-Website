/**
 * ParkSmart Comprehensive API Test Suite
 * Validates endpoints, input validation, privacy checks, and release flow.
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    parsed = data;
                }
                resolve({ status: res.statusCode, data: parsed, headers: res.headers });
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runApiTests() {
    console.log('====================================================');
    console.log(' Starting ParkSmart API Test Suite');
    console.log('====================================================');

    let passed = 0;
    let failed = 0;

    function assert(condition, testName, details = '') {
        if (condition) {
            console.log(` ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(` ❌ FAIL: ${testName} - ${details}`);
            failed++;
        }
    }

    try {
        // 1. Health check
        const health = await request('GET', '/api/health');
        assert(health.status === 200 && health.data.status === 'UP', 'Health check returns UP');

        // 2. Locations endpoint
        const locs = await request('GET', '/api/locations');
        assert(locs.status === 200 && locs.data.success === true, 'GET /api/locations returns 200 OK');
        assert(Array.isArray(locs.data.locations) && locs.data.locations.length > 0, 'Locations list contains facilities');
        assert(locs.data.summary.total_slots > 0, 'Summary total slots is positive');

        const testLoc = locs.data.locations.find(l => l.available_slots >= 2);
        assert(!!testLoc, 'Found a location with at least 2 available slots for booking test');

        // 3. Invalid booking inputs
        const invalidName = await request('POST', '/api/bookings', {
            userName: '',
            userPhone: '9876543210',
            locationId: testLoc.id,
            slotsCount: 1
        });
        assert(invalidName.status === 400, 'Rejects empty user name with 400 Bad Request');

        const invalidPhone = await request('POST', '/api/bookings', {
            userName: 'Aarav Gupta',
            userPhone: '123',
            locationId: testLoc.id,
            slotsCount: 1
        });
        assert(invalidPhone.status === 400, 'Rejects short invalid phone with 400 Bad Request');

        const invalidSlots = await request('POST', '/api/bookings', {
            userName: 'Aarav Gupta',
            userPhone: '9876543210',
            locationId: testLoc.id,
            slotsCount: -5
        });
        assert(invalidSlots.status === 400, 'Rejects negative slots count with 400 Bad Request');

        // 4. Successful Booking
        const availBefore = testLoc.available_slots;
        const bookRes = await request('POST', '/api/bookings', {
            userName: 'Aarav Gupta',
            userPhone: '9876543210',
            locationId: testLoc.id,
            slotsCount: 1
        });
        assert(bookRes.status === 201 && bookRes.data.success === true, 'Creates booking successfully (201 Created)');
        const bookingId = bookRes.data.booking.booking_id;
        assert(typeof bookingId === 'string' && bookingId.startsWith('PS-'), 'Generates valid booking ID format');
        assert(bookRes.data.booking.remaining_location_slots === availBefore - 1, 'Decrements available slots accurately');

        // 5. Privacy-Protected Retrieval
        // Test with incorrect phone
        const wrongPhone = await request('GET', `/api/bookings/${bookingId}?phone=1111111111`);
        assert(wrongPhone.status === 403, 'Rejects retrieval with mismatched phone (403 Forbidden Privacy)');

        // Test with correct phone
        const correctPhone = await request('GET', `/api/bookings/${bookingId}?phone=9876543210`);
        assert(correctPhone.status === 200 && correctPhone.data.booking.id === bookingId, 'Permits retrieval with matching phone (200 OK)');
        assert(correctPhone.data.booking.user_phone_masked.includes('****'), 'Masks user phone number for privacy');

        // 6. Release Booking
        const releaseRes = await request('POST', `/api/bookings/${bookingId}/release`, {
            phone: '9876543210'
        });
        assert(releaseRes.status === 200 && releaseRes.data.success === true, 'Releases booking successfully (200 OK)');
        assert(releaseRes.data.booking.status === 'RELEASED', 'Status transitions to RELEASED');

        // Re-release already released booking
        const reRelease = await request('POST', `/api/bookings/${bookingId}/release`, {
            phone: '9876543210'
        });
        assert(reRelease.status === 400, 'Rejects releasing an already released booking with 400 Bad Request');

        // 7. Analytics check
        const analytics = await request('GET', '/api/analytics');
        assert(analytics.status === 200 && analytics.data.success === true, 'Analytics endpoint returns 200 OK');
        assert(analytics.data.metrics.concurrency_integrity_verified === true, 'Database integrity constraint verified');
        assert(Array.isArray(analytics.data.hourly_demand), 'Hourly demand distribution returned');

    } catch (err) {
        console.error('Unhandled test runner error:', err);
        failed++;
    }

    console.log('====================================================');
    console.log(` Summary: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================');

    if (failed > 0) {
        process.exit(1);
    }
}

if (require.main === module) {
    runApiTests();
}

module.exports = runApiTests;

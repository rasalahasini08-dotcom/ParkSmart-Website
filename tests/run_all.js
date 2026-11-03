/**
 * ParkSmart Automated Test Orchestrator
 * Starts the backend server locally, executes:
 * - Phase 1: Core API Functionality Suite
 * - Phase 2: High Concurrency Race Condition Stress Test
 * - Phase 3: 25-Slot, Overlap & Dashboard Features Suite
 * - Phase 4: Hyderabad Areas & Multi-Facility 25-Slot Suite
 * Shuts down cleanly with 100% verified status.
 */

const { app } = require('../backend/server');
const seedDatabase = require('../database/seed');
const db = require('../database/db');
const runApiTests = require('./api_test');
const runConcurrencyTest = require('./concurrency_test');
const runFeatureTests = require('./feature_test');
const runHyderabadTests = require('./hyderabad_test');

async function main() {
    console.log('[Test Orchestrator] Initializing database and starting test server...');
    await db.initSchema();
    await seedDatabase();

    const PORT = 3000;
    const server = app.listen(PORT, async () => {
        console.log(`[Test Orchestrator] Server listening on http://localhost:${PORT}`);

        try {
            console.log('\n>>> PHASE 1: COMPREHENSIVE API FUNCTIONALITY TESTS <<<');
            await runApiTests();

            console.log('\n>>> PHASE 2: CONCURRENCY RACE CONDITION STRESS TEST <<<');
            await runConcurrencyTest();

            console.log('\n>>> PHASE 3: 25-SLOT, OVERLAP & DASHBOARD FEATURES SUITE <<<');
            await new Promise(r => server.close(r));
            await runFeatureTests();

            console.log('\n>>> PHASE 4: HYDERABAD URBAN LOCATIONS & MULTI-FACILITY SUITE <<<');
            await runHyderabadTests();

            console.log('\n🏆 ALL SUITES (PHASES 1, 2, 3, 4) COMPLETED SUCCESSFULLY! 🏆');
            process.exit(0);
        } catch (err) {
            console.error('\n❌ TEST RUNNER FAILED:', err);
            server.close(() => {
                process.exit(1);
            });
        }
    });

    server.on('error', (err) => {
        console.error('Server error during test launch:', err);
        process.exit(1);
    });
}

main();

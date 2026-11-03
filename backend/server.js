/**
 * ParkSmart Main Server Application
 * Full-stack Express backend with SQLite persistence, atomic concurrency control,
 * and Server-Sent Events (SSE) for instant cross-tab real-time synchronization.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('../database/db');
const seedDatabase = require('../database/seed');

const locationRoutes = require('./routes/locationRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const authRoutes = require('./routes/authRoutes');
const slotRoutes = require('./routes/slotRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware configuration
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging for debugging and faculty demo
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        // Only log non-static asset requests to keep logs readable
        if (req.path.startsWith('/api')) {
            console.log(`[API ${req.method}] ${req.path} -> ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});

// Server-Sent Events (SSE) Client registry for instant multi-tab sync
let sseClients = [];

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);

    // Send initial handshake
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', clientId })}\n\n`);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== clientId);
    });
});

// Broadcast state updates to all active browser windows
function broadcastUpdate(type, payload = {}) {
    const message = JSON.stringify({ type, timestamp: new Date().toISOString(), payload });
    sseClients.forEach(c => {
        c.res.write(`data: ${message}\n\n`);
    });
}

// Middleware to inject broadcast helper into req
app.use((req, res, next) => {
    req.broadcastUpdate = broadcastUpdate;
    next();
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'UP',
        service: 'ParkSmart Backend',
        environment: 'local',
        timestamp: new Date().toISOString()
    });
});

// Serve frontend static assets
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

// Fallback to index.html for single-page routing
app.use((req, res, next) => {
    // If request has not been handled by prior routes/static files
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(frontendPath, 'index.html'));
    }
    next();
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
    console.error('[ParkSmart Server Error]', err.stack || err);
    res.status(500).json({
        success: false,
        message: 'An unexpected server error occurred: ' + (err.message || 'Unknown error')
    });
});

// Initialize database and start HTTP server
async function startServer() {
    try {
        console.log('[ParkSmart] Booting up database...');
        await seedDatabase();

        const server = app.listen(PORT, () => {
            console.log('================================================================');
            console.log(` ParkSmart Backend is RUNNING locally!`);
            console.log(` Web Application URL: http://localhost:${PORT}`);
            console.log(` API Health Check:   http://localhost:${PORT}/api/health`);
            console.log(` Concurrency Engine: SQLite WAL Mode + Keyed Mutex Active`);
            console.log('================================================================');
        });

        // Graceful shutdown listener
        const shutdown = () => {
            console.log('\n[ParkSmart] Received stop signal. Closing server safely...');
            server.close(() => {
                db.close().then(() => {
                    console.log('[ParkSmart] Database connection closed safely. Goodbye.');
                    process.exit(0);
                });
            });
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        return server;
    } catch (err) {
        console.error('[ParkSmart] Failed to start server:', err);
        process.exit(1);
    }
}

// Start if executed directly
if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, broadcastUpdate };

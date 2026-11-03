/**
 * Authentication Controller
 * Handles User and Admin registration, login, and session validation.
 */

const db = require('../../database/db');
const crypto = require('crypto');

// Secret for token signing
const JWT_SECRET = process.env.JWT_SECRET || 'parksmart_secure_jwt_local_secret_key_2026';

function generateToken(user) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        exp: Date.now() + 7 * 24 * 3600 * 1000 // 7 days
    })).toString('base64url');
    
    const signature = crypto.createHmac('sha256', JWT_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');

    return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET)
        .update(`${header}.${payload}`)
        .digest('base64url');

    if (signature !== expectedSig) return null;

    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (decoded.exp && decoded.exp < Date.now()) return null;
        return decoded;
    } catch {
        return null;
    }
}

/**
 * POST /api/auth/register
 */
async function register(req, res) {
    try {
        const { name, email, phone, password } = req.body;

        if (!name || name.trim().length < 2) {
            return res.status(400).json({ success: false, message: 'Please provide a valid name (at least 2 characters).' });
        }
        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
        }
        const cleanPhone = String(phone || '').replace(/\D/g, '');
        if (cleanPhone.length < 10) {
            return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit phone number.' });
        }
        if (!password || password.length < 4) {
            return res.status(400).json({ success: false, message: 'Password must be at least 4 characters.' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if user already exists
        const existing = await db.get('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing) {
            return res.status(409).json({ success: false, message: 'An account with this email address already exists.' });
        }

        const passwordHash = db.hashPassword(password);

        const result = await db.run(
            'INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, "user")',
            [name.trim(), normalizedEmail, cleanPhone, passwordHash]
        );

        const newUser = {
            id: result.lastID,
            name: name.trim(),
            email: normalizedEmail,
            phone: cleanPhone,
            role: 'user'
        };

        const token = generateToken(newUser);

        return res.status(201).json({
            success: true,
            message: 'Registration successful! Welcome to ParkSmart.',
            token,
            user: newUser
        });
    } catch (err) {
        console.error('Registration error:', err);
        return res.status(500).json({ success: false, message: 'Server error during registration.' });
    }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
    try {
        const { email, password, role } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Please provide both email/username and password.' });
        }

        const queryIdentifier = email.trim().toLowerCase();
        const passwordHash = db.hashPassword(password);

        // Find user by email or username (e.g. 'admin')
        let user;
        if (queryIdentifier === 'admin' || queryIdentifier === 'administrator') {
            user = await db.get('SELECT * FROM users WHERE role = "admin" AND password_hash = ?', [passwordHash]);
        } else {
            user = await db.get('SELECT * FROM users WHERE (email = ? OR phone = ?) AND password_hash = ?', [queryIdentifier, queryIdentifier, passwordHash]);
        }

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. Please verify your login details.' });
        }

        // If user requested admin login but does not have admin role
        if (role === 'admin' && user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Access denied: You do not have administrator privileges.' });
        }

        const userInfo = {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role
        };

        const token = generateToken(userInfo);

        return res.json({
            success: true,
            message: `Login successful. Welcome back, ${user.name}!`,
            token,
            user: userInfo
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
}

/**
 * GET /api/auth/me
 */
async function getMe(req, res) {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const decoded = verifyToken(token);

        if (!decoded) {
            return res.status(401).json({ success: false, message: 'Not authenticated or session expired.' });
        }

        const user = await db.get('SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?', [decoded.id]);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User account not found.' });
        }

        return res.json({ success: true, user });
    } catch (err) {
        console.error('getMe error:', err);
        return res.status(500).json({ success: false, message: 'Server error verifying session.' });
    }
}

// Authentication Middleware
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const decoded = verifyToken(token);

    if (!decoded) {
        return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
    }

    req.user = decoded;
    next();
}

function adminMiddleware(req, res, next) {
    authMiddleware(req, res, () => {
        if (req.user && req.user.role === 'admin') {
            next();
        } else {
            return res.status(403).json({ success: false, message: 'Access restricted to administrators only.' });
        }
    });
}

function optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
        const decoded = verifyToken(token);
        if (decoded) req.user = decoded;
    }
    next();
}

module.exports = {
    register,
    login,
    getMe,
    authMiddleware,
    adminMiddleware,
    optionalAuthMiddleware,
    verifyToken
};

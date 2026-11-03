/**
 * Unique Booking ID Generator
 * Generates formatted, collision-resistant IDs: PS-YYYYMMDD-XXXX
 */

const crypto = require('crypto');

function generateBookingId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const datePart = `${year}${month}${day}`;
    
    // 4 alphanumeric characters (uppercase)
    const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
    
    return `PS-${datePart}-${randomPart}`;
}

module.exports = {
    generateBookingId
};

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { adminMiddleware } = require('../controllers/authController');

// All admin routes are protected by adminMiddleware
router.use(adminMiddleware);

router.get('/overview', adminController.getAdminOverview);
router.get('/locations', adminController.getAdminLocations);
router.post('/locations', adminController.createLocation);
router.put('/locations/:id', adminController.updateLocation);
router.get('/slots', adminController.getAdminSlots);
router.post('/slots/:slotNumber/toggle', adminController.toggleSlotMaintenance);
router.get('/bookings', adminController.getAllBookings);
router.post('/bookings/:id/cancel', adminController.adminCancelBooking);

module.exports = router;

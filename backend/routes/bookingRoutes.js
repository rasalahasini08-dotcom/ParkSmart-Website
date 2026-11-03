const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { optionalAuthMiddleware } = require('../controllers/authController');

router.use(optionalAuthMiddleware);

router.post('/', bookingController.createBooking);
router.get('/my-history', bookingController.getMyBookings);
router.get('/:id', bookingController.getBooking);
router.post('/:id/release', bookingController.releaseBooking);
router.post('/:id/cancel', bookingController.releaseBooking);

module.exports = router;

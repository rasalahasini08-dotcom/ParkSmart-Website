const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');

router.get('/', locationController.getAllLocations);
router.get('/:id', locationController.getLocationById);

module.exports = router;

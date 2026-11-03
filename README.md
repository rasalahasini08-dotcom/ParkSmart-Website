# ParkSmart — The Concurrency-Safe Urban Parking Allocator with Surge Analytics

> **B.Tech IT Academic Mini Project**  
> *Tagline:* **"Smart Parking, Less Stress."**  
> *Local Project Location:* `C:\Users\rasal\OneDrive\Documents\parksmart`

---

## 1. Project Overview

**ParkSmart** is a full-stack, local-first urban parking reservation and allocation platform designed to solve urban parking congestion while preventing double-booking (race conditions) through database transactions and mutex locking.

### Key Capabilities:
1. **Home Page & Role Portals:** Welcoming home page with clear options for **User Sign In / Sign Up** and **Admin Sign In** (with one-click demo logins).
2. **Hyderabad Urban Parking Facilities:** Multiple facilities grouped by Hyderabad areas:
   - **Ameerpet** (e.g., Ameerpet Metro Station Deck, Commercial Complex Bay)
   - **Banjara Hills** (e.g., Road No. 1 Deck, Banjara Parkview Bay)
   - **Gachibowli** (e.g., Financial Hub Bay, Stadium Transit Deck)
   - **Hitec City** (e.g., Cyber Towers Express Bay)
   - **Madhapur** (e.g., Madhapur Metro Link Bay)
   - *(Clearly labelled with academic demonstration notice: sample locations with realistic addresses and rates).*
3. **25 Selectable Parking Slots (P1 to P25) per Facility:** Each facility has its own dedicated 25-bay inventory:
   - 🟢 **Green:** Available for the chosen time window
   - 🔴 **Red:** Booked during the chosen time window
   - 🔵 **Blue:** Currently selected by the user
   - ⚪ **Grey:** Under maintenance (set by Admin)
4. **Area & Facility Selection Flow:** Users choose an area first (or view all), select a parking deck, set arrival date and hours, and pick an available slot.
5. **Date & Time Range Selection:** Users choose preferred date, arrival time, and departure time.
6. **Time Overlap Prevention:** Prevents two users from reserving overlapping hours on the same slot at the same facility, while allowing the same slot to be reserved at different non-overlapping times throughout the day, and allowing different facilities to operate independently.
7. **Instant Booking Confirmation:** Generates a unique collision-resistant Booking ID (`PS-YYYYMMDD-XXXX`), confirms facility name, area, slot, date, time window, and total price.
8. **Booking History:** Tabbed view in the User Dashboard categorizing **Current/Active**, **Previous/Completed**, and **Cancelled/Released** reservations. Allows cancellation directly from active bookings, immediately releasing the slot.
9. **Protected Admin Dashboard:** Operator console protected by authentication allowing facility managers to:
   - Add new parking facilities (auto-generates 25 slots P1–P25)
   - Edit facility details (name, area, address, hourly price, active status)
   - Select any facility and toggle slots between Operational and Maintenance
   - Audit all reservations across all drivers with search and status filters
   - Perform emergency reservation cancellations
10. **Surge Demand Analytics & Area Comparison:** Dynamic surge pricing formula (1.0x Normal, 1.25x Moderate, 1.5x Peak) with cross-area demand comparison across Hyderabad localities (Ameerpet, Banjara Hills, Gachibowli, etc.), slot utilization breakdown (P1–P25), and peak demand periods derived from actual SQLite database records.

---

## 2. Default Login Credentials

| Role | Username / Email | Password | Dashboard Features |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` *(or `admin@parksmart.local`)* | `admin123` | Protected Admin Dashboard: Add/Edit Facilities, Per-Facility Slot Maintenance Toggle, All User Bookings Audit, Cancel Override. |
| **Demo User** | `user@parksmart.local` | `user123` | User Dashboard: Hyderabad Area & Facility Selection, 25-Slot Interactive Picker, Time Window Filter, Booking History. |

*(New users can also create their own accounts instantly using the "Create New Account" link on the home page).*

---

## 3. Technologies Used

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | HTML5, Modern CSS3, JavaScript (ES6+) | Modern, responsive Single Page Application (laptop, tablet, mobile). Blue, White, and Light-Grey theme. |
| **Visual Charts** | Chart.js v4 (bundled locally in [`frontend/js/chart.min.js`](file:///c:/Users/rasal/OneDrive/Documents/parksmart/frontend/js/chart.min.js)) | Interactive capacity, cross-area comparison, and hourly demand visualizations (100% offline, zero CDN dependency). |
| **Backend** | Node.js (v20+) with Express | RESTful API server, validation middleware, and SSE broadcasting. |
| **Database** | SQLite3 via `sqlite3` driver | Local persistent database stored at [`database/parksmart.db`](file:///c:/Users/rasal/OneDrive/Documents/parksmart/database/parksmart.db) configured with **Write-Ahead Logging (WAL)** mode. |
| **Concurrency Engine** | Keyed Async Mutex + SQLite `BEGIN IMMEDIATE` | Dual-layer race-condition prevention ensuring 0 overbooking and strict overlap prevention scoped to `${facilityId}:${slotNumber}`. |

---

## 4. Setup and Installation Commands

All commands are executed inside the project directory: `c:\Users\rasal\OneDrive\Documents\parksmart`

### Step 1: Open PowerShell or Command Prompt
```powershell
cd "c:\Users\rasal\OneDrive\Documents\parksmart"
```

### Step 2: Install Dependencies
```powershell
npm install
```

### Step 3: Initialize Database & Seed Sample Records
```powershell
npm run seed
```

---

## 5. Starting the Website

To start the local ParkSmart server:
```powershell
npm start
```
Terminal output:
```text
================================================================
 ParkSmart Backend is RUNNING locally!
 Web Application URL: http://localhost:3000
 API Health Check:   http://localhost:3000/api/health
 Concurrency Engine: SQLite WAL Mode + Keyed Mutex Active
================================================================
```

### Local URL to Open in Your Browser:
👉 **`http://localhost:3000`**

*(Note: Localhost runs privately on your personal computer; it is not accessible to the public internet.)*

---

## 6. How to Safely Stop the Server

To stop the web server at any time:
1. In the terminal window running the server, press:
   **`Ctrl + C`**
2. When prompted `Terminate batch job (Y/N)?`, type **`Y`** and press **Enter**.
3. The server safely flushes pending database transactions and exits cleanly.

---

## 7. How to Restart the Project on Another Day

When you start your computer or open a new terminal in college:
1. Open PowerShell or Command Prompt.
2. Run:
   ```powershell
   cd "c:\Users\rasal\OneDrive\Documents\parksmart"
   npm start
   ```
3. Open `http://localhost:3000` in your web browser.  
   *(All your previous bookings, audit logs, and slot availability remain preserved in [`database/parksmart.db`](file:///c:/Users/rasal/OneDrive/Documents/parksmart/database/parksmart.db)).*

---

## 8. Automated Verification Tests

Run the complete 4-phase automated test orchestrator:
```powershell
npm test
```
The test suite validates:
1. **Phase 1: API Functionality Suite (20 tests):** Endpoints, sanitization, negative inputs, unique IDs, phone masking privacy, and slot release.
2. **Phase 2: Concurrency Stress Test:** Fires 10 simultaneous asynchronous booking requests at the same millisecond for a facility with only 2 slots. Verifies exactly 2 succeed and 8 fail with HTTP 409 Conflict (0 overbooking).
3. **Phase 3: 25-Slot, Overlap & Dashboard Features Suite (21 tests):**
   - User & Admin authentication
   - Exact 25 slots (P1 to P25) availability
   - Booking slot P5 for 10:00 - 12:00
   - Overlap prevention (rejects booking P5 for 11:00 - 13:00 with HTTP 409 Conflict)
   - Non-overlapping booking (allows booking P5 for 14:00 - 16:00 on the same date)
   - User booking history retrieval & cancellation
   - Admin slot maintenance toggle & override
4. **Phase 4: Hyderabad Urban Locations & Multi-Facility 25-Slot Suite (8 tests):**
   - Grouping and filtering facilities by Hyderabad areas (Ameerpet, Banjara Hills, Gachibowli, etc.)
   - Admin Add and Edit facilities (with auto-generation of 25 slots P1–P25)
   - Per-facility slot isolation (booking slot P3 in Ameerpet does not block slot P3 in Banjara Hills)
   - User booking history with facility and area tracking
   - Cross-area demand comparison in Surge Analytics calculated from persistent SQLite records

---

## 9. Faculty Viva / Review Explanation Guide

### Q1: How does ParkSmart prevent double-booking and overlapping time reservations?
**Answer:**  
Two bookings for slot $S$ at facility $F$ overlap if:
$$\text{Start}_A < \text{End}_B \quad\text{and}\quad \text{End}_A > \text{Start}_B$$
ParkSmart executes the check inside a dual-layer defensive lock:
1. **Application-Layer Keyed Mutex (`backend/utils/mutex.js`):** Serializes requests targeting the same `${facilityId}:${slotNumber}` key in an asynchronous FIFO queue while allowing bookings for different facilities or different slots to proceed in parallel.
2. **Database-Layer Immediate Transactions (`backend/controllers/bookingController.js`):**
   ```sql
   BEGIN IMMEDIATE TRANSACTION;
   SELECT id FROM bookings
   WHERE location_id = ?
     AND slot_number = ?
     AND booking_date = ?
     AND status = 'CONFIRMED'
     AND start_time < ?
     AND end_time > ?;
   ```
   If any active booking matches, the transaction rolls back and returns an **HTTP 409 Conflict**. If none match, the booking is inserted and committed atomically.

### Q2: How does each facility manage its own 25 slots?
**Answer:**  
The `slots` table uses a compound primary key:
```sql
PRIMARY KEY (location_id, slot_number)
```
Each facility (e.g. `HYD-AMP-01`, `HYD-BJH-01`) has 25 rows with `slot_number` from `P1` to `P25`. When an admin creates a new facility via `POST /api/admin/locations`, the helper function `db.createSlotsForLocation(id, price)` automatically generates all 25 slots with index 1 to 25.

### Q3: How does the Surge Analytics algorithm work?
**Answer:**  
Occupancy rate is calculated dynamically from the 25 slots for the requested facility and time window:
$$\text{Occupancy Rate} = \left(\frac{\text{Booked Slots in Window}}{25}\right) \times 100\%$$
- **Normal Equilibrium ($< 70\%$ Occupancy):** Base Rate (e.g. ₹40–₹60/hr, 1.00x).
- **Moderate Congestion ($70\% - 84\%$ Occupancy):** 1.25x (+25% Surge Factor).
- **Peak Congestion ($\ge 85\%$ Occupancy):** 1.50x (+50% Peak Factor).
Cross-area demand comparison groups bookings by `locations.area` and aggregates booking volume, active counts, and total revenue.

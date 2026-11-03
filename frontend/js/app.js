/**
 * ParkSmart Frontend Application Controller (v3.0)
 * Handles:
 * - Hyderabad Urban Areas & Facility Selection (Ameerpet, Banjara Hills, Gachibowli, etc.)
 * - Dedicated 25-Slot Grid (P1 to P25) per Facility with Real-Time Availability
 * - Date & Time Window Picking with Overlap Prevention
 * - Booking Confirmation with Unique Booking ID Receipt
 * - User Booking History (Current, Previous, Cancelled) & Cancellation
 * - Protected Admin Dashboard (Add/Edit Facilities, Toggle Slot Maintenance, Bookings Audit)
 * - Server-Sent Events (SSE) Live Multi-Tab Synchronization
 */

// Global Application State
const state = {
    currentUser: null,
    token: localStorage.getItem('parksmart_token') || null,
    activeView: 'home',

    // Hyderabad Locations State
    areas: [],
    selectedArea: 'ALL',
    facilities: [],
    selectedFacility: null,

    // Time Selection State
    selectedDate: getTodayString(),
    selectedStartTime: '09:00',
    selectedEndTime: '11:00',
    selectedSlotNumber: null,

    // 25 Slots Data for active facility
    slots: [],
    slotsSummary: {},

    // User History
    historyTab: 'current',
    historyBookings: { current: [], previous: [], cancelled: [], all: [] },

    // Admin Dashboard Data
    adminTab: 'facilities',
    adminFacilities: [],
    adminSlotsFacilityId: null,
    adminSlots: [],
    adminBookings: [],
    adminSearchQuery: '',
    adminFacilityFilter: 'ALL',
    adminStatusFilter: 'ALL',

    isSubmitting: false
};

// ==========================================================================
// Initialization & Lifecycle
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    initNavigation();
    initTimePickers();
    initSSE();

    // Restore authentication session if token exists
    await restoreSession();

    // Fetch Hyderabad parking facilities and initial slots
    await fetchLocations();
    updateHomeOverviewStats();

    // Cross-tab synchronization polling fallback
    setInterval(() => {
        if (state.activeView === 'user-dashboard') {
            fetchSlotsForWindow(false);
        } else if (state.activeView === 'home') {
            updateHomeOverviewStats();
        } else if (state.activeView === 'admin-dashboard' && state.currentUser?.role === 'admin') {
            fetchAdminOverview();
        }
    }, 6000);
});

function getTodayString() {
    const d = new Date();
    return d.toISOString().split('T')[0];
}

// ==========================================================================
// Authentication & Session Management
// ==========================================================================
async function restoreSession() {
    if (!state.token) {
        renderNavAuthControls();
        return;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.currentUser = data.user;
        } else {
            state.token = null;
            state.currentUser = null;
            localStorage.removeItem('parksmart_token');
        }
    } catch {
        // Local server unreachable or offline
    } finally {
        renderNavAuthControls();
        updateUserDashboardHeader();
    }
}

function renderNavAuthControls() {
    const container = document.getElementById('nav-user-controls');
    if (!container) return;

    if (state.currentUser) {
        const isAdmin = state.currentUser.role === 'admin';
        container.innerHTML = `
            <div class="nav-profile-pill ${isAdmin ? 'admin' : ''}">
                <span>${isAdmin ? '🛡️' : '👤'}</span>
                <span>${escapeHtml(state.currentUser.name)}</span>
                <span class="badge ${isAdmin ? 'badge-peak' : 'badge-normal'}" style="font-size: 0.7rem;">${isAdmin ? 'Admin' : 'User'}</span>
            </div>
            <button class="btn btn-outline btn-sm" onclick="handleLogout()" title="Log out">Sign Out</button>
        `;
    } else {
        container.innerHTML = `
            <button class="btn btn-outline btn-sm" onclick="openAuthModal('user')">🔑 User Sign In</button>
            <button class="btn btn-primary btn-sm" onclick="openAuthModal('admin')">🛡️ Admin Sign In</button>
        `;
    }
}

function updateUserDashboardHeader() {
    const greetingEl = document.getElementById('user-greeting');
    const pillEl = document.getElementById('user-status-pill');

    if (state.currentUser) {
        if (greetingEl) greetingEl.textContent = `Welcome back, ${state.currentUser.name}! Choose an area and parking bay below.`;
        if (pillEl) pillEl.textContent = `👤 ${state.currentUser.name} (${state.currentUser.phone})`;
    } else {
        if (greetingEl) greetingEl.textContent = 'Welcome! You can book parking as a Guest or Sign In to save history.';
        if (pillEl) pillEl.textContent = '👤 Guest User';
    }
}

function handleLogout() {
    state.token = null;
    state.currentUser = null;
    localStorage.removeItem('parksmart_token');
    renderNavAuthControls();
    updateUserDashboardHeader();
    showToast('Signed Out', 'You have been safely logged out.', 'info');
    navigateTo('home');
}

// ==========================================================================
// Auth Modals & Form Submission
// ==========================================================================
function openAuthModal(targetTab = 'user') {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    switchAuthTab(targetTab);
    modal.classList.remove('hidden');
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.add('hidden');
}

function switchAuthTab(tab) {
    const userTabBtn = document.getElementById('tab-btn-user');
    const adminTabBtn = document.getElementById('tab-btn-admin');
    const userView = document.getElementById('auth-user-view');
    const adminView = document.getElementById('auth-admin-view');

    if (tab === 'user') {
        userTabBtn.classList.add('active');
        adminTabBtn.classList.remove('active');
        userView.classList.remove('hidden');
        adminView.classList.add('hidden');
    } else {
        adminTabBtn.classList.add('active');
        userTabBtn.classList.remove('active');
        adminView.classList.remove('hidden');
        userView.classList.add('hidden');
    }
}

function toggleUserRegisterForm() {
    const loginForm = document.getElementById('user-login-form');
    const regForm = document.getElementById('user-register-form');
    const titleEl = document.getElementById('auth-modal-title');
    const togglePrompt = document.querySelector('.auth-toggle-prompt');

    if (regForm.classList.contains('hidden')) {
        loginForm.classList.add('hidden');
        regForm.classList.remove('hidden');
        if (togglePrompt) togglePrompt.classList.add('hidden');
        if (titleEl) titleEl.textContent = 'Create ParkSmart Account';
    } else {
        regForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        if (togglePrompt) togglePrompt.classList.remove('hidden');
        if (titleEl) titleEl.textContent = 'User Sign In';
    }
}

async function handleUserLogin(event) {
    event.preventDefault();
    const email = document.getElementById('u-login-email').value.trim();
    const pass = document.getElementById('u-login-pass').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.token = data.token;
            state.currentUser = data.user;
            localStorage.setItem('parksmart_token', data.token);
            renderNavAuthControls();
            updateUserDashboardHeader();
            closeAuthModal();
            showToast('Welcome!', `Logged in successfully as ${data.user.name}`, 'success');
            if (state.activeView === 'user-dashboard') fetchUserHistory();
        } else {
            showToast('Sign In Failed', data.message || 'Invalid email or password.', 'error');
        }
    } catch {
        showToast('Error', 'Server connection failure.', 'error');
    }
}

async function handleUserRegister(event) {
    event.preventDefault();
    const name = document.getElementById('u-reg-name').value.trim();
    const email = document.getElementById('u-reg-email').value.trim();
    const phone = document.getElementById('u-reg-phone').value.trim();
    const pass = document.getElementById('u-reg-pass').value;

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, phone, password: pass })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.token = data.token;
            state.currentUser = data.user;
            localStorage.setItem('parksmart_token', data.token);
            renderNavAuthControls();
            updateUserDashboardHeader();
            closeAuthModal();
            showToast('Account Created', `Welcome to ParkSmart, ${data.user.name}!`, 'success');
            if (state.activeView === 'user-dashboard') fetchUserHistory();
        } else {
            showToast('Registration Error', data.message || 'Could not create account.', 'error');
        }
    } catch {
        showToast('Error', 'Server connection failure.', 'error');
    }
}

async function handleAdminLogin(event) {
    event.preventDefault();
    const email = document.getElementById('adm-login-user').value.trim();
    const pass = document.getElementById('adm-login-pass').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            if (data.user.role !== 'admin') {
                showToast('Access Denied', 'This account does not have administrator privileges.', 'error');
                return;
            }
            state.token = data.token;
            state.currentUser = data.user;
            localStorage.setItem('parksmart_token', data.token);
            renderNavAuthControls();
            closeAuthModal();
            showToast('Admin Verified', 'Logged in as Administrator.', 'success');
            navigateTo('admin-dashboard');
        } else {
            showToast('Admin Login Failed', data.message || 'Invalid admin credentials.', 'error');
        }
    } catch {
        showToast('Error', 'Server connection failure.', 'error');
    }
}

function quickLoginDemoUser() {
    document.getElementById('u-login-email').value = 'user@parksmart.local';
    document.getElementById('u-login-pass').value = 'user123';
    document.getElementById('user-login-form').dispatchEvent(new Event('submit'));
}

function quickLoginAdmin() {
    document.getElementById('adm-login-user').value = 'admin@parksmart.local';
    document.getElementById('adm-login-pass').value = 'admin123';
    document.getElementById('admin-login-form').dispatchEvent(new Event('submit'));
}

// ==========================================================================
// Navigation & Routing
// ==========================================================================
function initNavigation() {
    const initialHash = window.location.hash.replace('#', '') || 'home';
    navigateTo(initialHash, false);

    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '') || 'home';
        navigateTo(hash, false);
    });

    const mobileToggle = document.getElementById('mobile-toggle');
    const navMenu = document.getElementById('nav-menu');
    if (mobileToggle && navMenu) {
        mobileToggle.addEventListener('click', () => {
            navMenu.classList.toggle('show');
        });
    }
}

function navigateTo(viewId, updateHash = true) {
    const validViews = ['home', 'user-dashboard', 'admin-dashboard', 'analytics'];
    if (!validViews.includes(viewId)) viewId = 'home';

    // Protect Admin Dashboard
    if (viewId === 'admin-dashboard' && state.currentUser?.role !== 'admin') {
        showToast('Admin Authentication Required', 'Please log in with administrator credentials to view this dashboard.', 'warning');
        openAuthModal('admin');
        return;
    }

    state.activeView = viewId;

    document.querySelectorAll('.view-section').forEach(sec => {
        sec.classList.remove('active');
    });
    const targetSection = document.getElementById(`view-${viewId}`);
    if (targetSection) targetSection.classList.add('active');

    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.getAttribute('data-view') === viewId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    const navMenu = document.getElementById('nav-menu');
    if (navMenu) navMenu.classList.remove('show');

    // Trigger view-specific loads
    if (viewId === 'user-dashboard') {
        if (!state.selectedFacility && state.facilities.length > 0) {
            selectFacility(state.facilities[0].id);
        } else {
            fetchSlotsForWindow(true);
        }
        fetchUserHistory();
    } else if (viewId === 'admin-dashboard') {
        fetchAdminOverview();
        fetchAdminFacilities();
        fetchAdminSlots();
        fetchAdminBookings();
    } else if (viewId === 'analytics' && typeof renderAnalyticsView === 'function') {
        renderAnalyticsView();
    } else if (viewId === 'home') {
        updateHomeOverviewStats();
    }

    if (updateHash) {
        window.location.hash = viewId;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleHeroBookAction() {
    navigateTo('user-dashboard');
}

// ==========================================================================
// Hyderabad Locations & Facility Selection
// ==========================================================================
async function fetchLocations() {
    try {
        const res = await fetch('/api/locations');
        const data = await res.json();

        if (res.ok && data.success) {
            state.areas = data.areas || ['Ameerpet', 'Banjara Hills', 'Gachibowli', 'Hitec City', 'Madhapur'];
            state.facilities = data.locations || [];

            // Set default selected facility to first one if not set
            if (!state.selectedFacility && state.facilities.length > 0) {
                state.selectedFacility = state.facilities[0];
            }

            renderAreaPills();
            renderFacilityCards();
            updateSelectedFacilityBanner();
            await fetchSlotsForWindow(false);
        }
    } catch (err) {
        console.error('Error fetching locations:', err);
    }
}

function renderAreaPills() {
    const homePills = document.getElementById('home-area-pills');
    const userPills = document.getElementById('user-area-pills');

    const pillsHtml = `
        <button class="area-pill ${state.selectedArea === 'ALL' ? 'active' : ''}" onclick="filterArea('ALL')">
            🌟 All Areas
        </button>
        ${state.areas.map(a => `
            <button class="area-pill ${state.selectedArea === a ? 'active' : ''}" onclick="filterArea('${escapeHtml(a)}')">
                📍 ${escapeHtml(a)}
            </button>
        `).join('')}
    `;

    if (homePills) homePills.innerHTML = pillsHtml;
    if (userPills) userPills.innerHTML = pillsHtml;
}

function filterArea(area) {
    state.selectedArea = area;
    renderAreaPills();
    renderFacilityCards();

    // Auto-select first facility in that area if current facility is not in it
    if (area !== 'ALL') {
        const match = state.facilities.find(f => f.area === area);
        if (match && (!state.selectedFacility || state.selectedFacility.area !== area)) {
            selectFacility(match.id);
        }
    }
}

function renderFacilityCards() {
    const homeGrid = document.getElementById('home-facilities-grid');
    const userGrid = document.getElementById('user-facilities-grid');

    const filtered = state.selectedArea === 'ALL' 
        ? state.facilities 
        : state.facilities.filter(f => f.area === state.selectedArea);

    const generateCardsHtml = (isUserDashboard) => {
        if (filtered.length === 0) {
            return '<p style="color: var(--text-muted); padding: 1.5rem;">No facilities found in this area.</p>';
        }

        return filtered.map(f => {
            const isSelected = state.selectedFacility && state.selectedFacility.id === f.id;
            return `
                <div class="facility-card ${isSelected ? 'selected' : ''}" onclick="selectFacility('${f.id}')">
                    <div>
                        <div class="facility-card-top">
                            <span class="facility-name">${escapeHtml(f.name)}</span>
                            <span class="facility-area-badge">${escapeHtml(f.area)}</span>
                        </div>
                        <span class="facility-sample-tag">⚠️ Sample Location</span>
                        <p class="facility-address">${escapeHtml(f.address)}</p>
                    </div>
                    <div class="facility-card-bottom">
                        <span class="facility-price">₹${f.base_price_per_hour.toFixed(2)} / hr</span>
                        <span class="facility-slots-count">
                            🅿️ 25 Bays (${f.available_slots} Free)
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    };

    if (homeGrid) homeGrid.innerHTML = generateCardsHtml(false);
    if (userGrid) userGrid.innerHTML = generateCardsHtml(true);
}

function selectFacility(facilityId) {
    const fac = state.facilities.find(f => f.id === facilityId);
    if (!fac) return;

    state.selectedFacility = fac;
    state.selectedSlotNumber = null;

    updateSelectedFacilityBanner();
    renderFacilityCards();
    updateSelectionPanel();
    fetchSlotsForWindow(true);
}

function updateSelectedFacilityBanner() {
    const nameEl = document.getElementById('active-facility-name');
    const areaEl = document.getElementById('active-facility-area');
    const addrEl = document.getElementById('active-facility-address');
    const rateEl = document.getElementById('active-facility-rate');

    if (!state.selectedFacility) return;

    if (nameEl) nameEl.textContent = state.selectedFacility.name;
    if (areaEl) areaEl.textContent = state.selectedFacility.area || 'Hyderabad';
    if (addrEl) addrEl.textContent = state.selectedFacility.address;
    if (rateEl) rateEl.textContent = `₹${(state.selectedFacility.base_price_per_hour || 50).toFixed(2)} / hr`;
}

// ==========================================================================
// Time Window Picker Controls
// ==========================================================================
function initTimePickers() {
    const dateInput = document.getElementById('picker-date');
    const startSelect = document.getElementById('picker-start-time');
    const endSelect = document.getElementById('picker-end-time');

    if (!dateInput || !startSelect || !endSelect) return;

    const today = getTodayString();
    dateInput.min = today;
    dateInput.value = today;
    state.selectedDate = today;

    startSelect.innerHTML = '';
    endSelect.innerHTML = '';

    for (let h = 6; h <= 23; h++) {
        const timeStr = String(h).padStart(2, '0') + ':00';
        startSelect.innerHTML += `<option value="${timeStr}">${timeStr}</option>`;
        endSelect.innerHTML += `<option value="${timeStr}">${timeStr}</option>`;
    }

    startSelect.value = '09:00';
    endSelect.value = '11:00';
    state.selectedStartTime = '09:00';
    state.selectedEndTime = '11:00';
}

function handleTimeWindowChange() {
    const dateInput = document.getElementById('picker-date');
    const startSelect = document.getElementById('picker-start-time');
    const endSelect = document.getElementById('picker-end-time');

    if (!dateInput || !startSelect || !endSelect) return;

    const startVal = startSelect.value;
    const endVal = endSelect.value;

    if (startVal >= endVal) {
        showToast('Invalid Time', 'End time must be later than start time.', 'warning');
        const startH = parseInt(startVal.split(':')[0], 10);
        const nextH = Math.min(23, startH + 1);
        endSelect.value = String(nextH).padStart(2, '0') + ':00';
    }

    state.selectedDate = dateInput.value;
    state.selectedStartTime = startSelect.value;
    state.selectedEndTime = endSelect.value;

    state.selectedSlotNumber = null;
    updateSelectionPanel();

    fetchSlotsForWindow(false);
}

// ==========================================================================
// 25 Slots Real-Time Inventory (P1 to P25) & Color Coding
// ==========================================================================
async function fetchSlotsForWindow(showLoader = true) {
    const loadingEl = document.getElementById('slots-loading');
    if (showLoader && loadingEl) loadingEl.classList.remove('hidden');

    try {
        const facId = state.selectedFacility ? state.selectedFacility.id : 'HYD-AMP-01';
        const url = `/api/slots?location_id=${encodeURIComponent(facId)}&date=${encodeURIComponent(state.selectedDate)}&start_time=${encodeURIComponent(state.selectedStartTime)}&end_time=${encodeURIComponent(state.selectedEndTime)}`;
        const res = await fetch(url);
        const data = await res.json();

        if (res.ok && data.success) {
            state.slots = data.slots || [];
            state.slotsSummary = data.summary || {};
            render25SlotsGrid();
            updateSelectionPanel();
        } else {
            showToast('Error', data.message || 'Could not fetch parking slots.', 'error');
        }
    } catch (err) {
        console.error('Error fetching slots:', err);
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
    }
}

function render25SlotsGrid() {
    const grid = document.getElementById('slots-25-grid');
    if (!grid) return;

    grid.innerHTML = state.slots.map(slot => {
        const isSelected = slot.slot_number === state.selectedSlotNumber;
        const isBooked = slot.status === 'BOOKED';
        const isMaintenance = slot.status === 'MAINTENANCE';

        let stateClass = 'available';
        let statusText = 'Free';
        let carIcon = '🚗';

        if (isMaintenance) {
            stateClass = 'maintenance';
            statusText = 'Maintenance';
            carIcon = '⚠️';
        } else if (isBooked) {
            stateClass = 'booked';
            statusText = 'Booked';
            carIcon = '⛔';
        } else if (isSelected) {
            stateClass = 'selected';
            statusText = 'Selected';
            carIcon = '🅿️';
        }

        return `
            <div 
                class="slot-bay ${stateClass}" 
                id="bay-${slot.slot_number}"
                onclick="handleSlotClick('${slot.slot_number}', '${slot.status}')"
                title="Slot ${slot.slot_number} • ${statusText}"
            >
                <span class="slot-bay-number">${slot.slot_number}</span>
                <span class="slot-bay-icon">${carIcon}</span>
                <span class="slot-bay-status">${statusText}</span>
            </div>
        `;
    }).join('');
}

function handleSlotClick(slotNumber, status) {
    if (status === 'BOOKED') {
        showToast('Slot Occupied', `Slot ${slotNumber} is already reserved between ${state.selectedStartTime} and ${state.selectedEndTime} at this facility. Please select another slot or time.`, 'warning');
        return;
    }
    if (status === 'MAINTENANCE') {
        showToast('Under Maintenance', `Slot ${slotNumber} is currently taken offline by the administrator.`, 'info');
        return;
    }

    state.selectedSlotNumber = slotNumber;
    render25SlotsGrid();
    updateSelectionPanel();
}

function updateSelectionPanel() {
    const facDispEl = document.getElementById('sel-facility-display');
    const slotNameEl = document.getElementById('sel-slot-name');
    const timeWinEl = document.getElementById('sel-time-window');
    const durationEl = document.getElementById('sel-duration');
    const surgeEl = document.getElementById('sel-surge-tier');
    const totalEl = document.getElementById('sel-total-amount');
    const btnBook = document.getElementById('btn-open-booking-modal');

    if (!slotNameEl) return;

    if (facDispEl) {
        facDispEl.textContent = state.selectedFacility ? `${state.selectedFacility.name} (${state.selectedFacility.area})` : '—';
    }

    if (!state.selectedSlotNumber) {
        slotNameEl.textContent = 'None Selected';
        timeWinEl.textContent = `${state.selectedDate} (${state.selectedStartTime} - ${state.selectedEndTime})`;
        durationEl.textContent = '0 hrs';
        surgeEl.textContent = state.slotsSummary.surge_tier || 'Normal (1.0x)';
        totalEl.textContent = '₹0.00';
        if (btnBook) btnBook.disabled = true;
        return;
    }

    const [sH, sM] = state.selectedStartTime.split(':').map(Number);
    const [eH, eM] = state.selectedEndTime.split(':').map(Number);
    const durationHours = (eH * 60 + eM - (sH * 60 + sM)) / 60;

    const baseRate = state.selectedFacility ? state.selectedFacility.base_price_per_hour : 50.0;
    const surgeMultiplier = state.slotsSummary.surge_multiplier || 1.0;
    const totalPayable = Math.round(baseRate * surgeMultiplier * durationHours * 100) / 100;

    slotNameEl.textContent = `Bay ${state.selectedSlotNumber}`;
    timeWinEl.textContent = `${state.selectedDate} (${state.selectedStartTime} - ${state.selectedEndTime})`;
    durationEl.textContent = `${durationHours.toFixed(1)} hrs`;
    surgeEl.textContent = `${state.slotsSummary.surge_tier || 'Normal (1.0x)'}`;
    totalEl.textContent = `₹${totalPayable.toFixed(2)}`;

    if (btnBook) btnBook.disabled = false;
}

// ==========================================================================
// Booking Confirmation Flow
// ==========================================================================
function proceedToBookingConfirmation() {
    if (!state.selectedSlotNumber) {
        showToast('Required', 'Please select an available parking bay first.', 'warning');
        return;
    }

    const modal = document.getElementById('booking-modal');
    if (!modal) return;

    const [sH, sM] = state.selectedStartTime.split(':').map(Number);
    const [eH, eM] = state.selectedEndTime.split(':').map(Number);
    const durationHours = (eH * 60 + eM - (sH * 60 + sM)) / 60;

    const baseRate = state.selectedFacility ? state.selectedFacility.base_price_per_hour : 50.0;
    const surgeMultiplier = state.slotsSummary.surge_multiplier || 1.0;
    const totalPayable = Math.round(baseRate * surgeMultiplier * durationHours * 100) / 100;

    document.getElementById('modal-title').textContent = 'Confirm Parking Reservation';
    document.getElementById('modal-slot-title').textContent = `${state.selectedFacility?.name} • Bay ${state.selectedSlotNumber}`;
    document.getElementById('modal-facility-name').textContent = state.selectedFacility?.name || '—';
    document.getElementById('modal-facility-area').textContent = state.selectedFacility?.area || '—';
    document.getElementById('modal-slot-number').textContent = state.selectedSlotNumber;
    document.getElementById('modal-booking-date').textContent = state.selectedDate;
    document.getElementById('modal-booking-time').textContent = `${state.selectedStartTime} - ${state.selectedEndTime}`;
    document.getElementById('modal-booking-duration').textContent = `${durationHours.toFixed(1)} Hours`;

    document.getElementById('price-calc-base').textContent = `₹${baseRate.toFixed(2)} / hr`;
    document.getElementById('price-calc-surge').textContent = `${surgeMultiplier}x (${state.slotsSummary.surge_tier || 'Normal'})`;
    document.getElementById('price-calc-duration').textContent = `${durationHours.toFixed(1)} hrs`;
    document.getElementById('price-calc-total').textContent = `₹${totalPayable.toFixed(2)}`;

    if (state.currentUser) {
        document.getElementById('book-user-name').value = state.currentUser.name || '';
        document.getElementById('book-user-phone').value = state.currentUser.phone || '';
        document.getElementById('book-user-email').value = state.currentUser.email || '';
    }

    document.getElementById('modal-step-input').classList.remove('hidden');
    document.getElementById('modal-step-success').classList.add('hidden');

    modal.classList.remove('hidden');
}

function closeBookingModal() {
    const modal = document.getElementById('booking-modal');
    if (modal) modal.classList.add('hidden');
}

async function handleFinalBookingSubmit(event) {
    event.preventDefault();
    if (state.isSubmitting) return;

    const userName = document.getElementById('book-user-name').value.trim();
    const userPhone = document.getElementById('book-user-phone').value.trim();
    const userEmail = document.getElementById('book-user-email').value.trim();

    if (!userName || userName.length < 2) {
        showToast('Invalid Name', 'Please enter driver full name.', 'error');
        return;
    }

    const cleanPhone = userPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
        showToast('Invalid Phone', 'Please enter a valid 10-digit phone number.', 'error');
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-booking');
    state.isSubmitting = true;
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '⏳ Reserving Atomically...';

    try {
        const payload = {
            locationId: state.selectedFacility ? state.selectedFacility.id : 'HYD-AMP-01',
            slotNumber: state.selectedSlotNumber,
            bookingDate: state.selectedDate,
            startTime: state.selectedStartTime,
            endTime: state.selectedEndTime,
            userName,
            userPhone: cleanPhone,
            userEmail,
            userId: state.currentUser?.id || null
        };

        const headers = { 'Content-Type': 'application/json' };
        if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

        const res = await fetch('/api/bookings', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        const result = await res.json();

        if (res.status === 201 && result.success) {
            const b = result.booking;

            // Display Success Receipt
            document.getElementById('receipt-booking-id').textContent = b.booking_id;
            document.getElementById('receipt-facility').textContent = b.location_name || state.selectedFacility?.name;
            document.getElementById('receipt-area').textContent = b.area || state.selectedFacility?.area;
            document.getElementById('receipt-slot').textContent = b.slot_number;
            document.getElementById('receipt-date').textContent = b.booking_date;
            document.getElementById('receipt-time').textContent = `${b.start_time} - ${b.end_time} (${b.duration_hours} hrs)`;
            document.getElementById('receipt-user').textContent = b.user_name;
            document.getElementById('receipt-phone').textContent = b.user_phone;
            document.getElementById('receipt-total').textContent = `₹${b.total_amount.toFixed(2)}`;
            document.getElementById('receipt-status').textContent = b.status;

            document.getElementById('modal-step-input').classList.add('hidden');
            document.getElementById('modal-step-success').classList.remove('hidden');

            showToast('Success!', `Bay ${b.slot_number} reserved! Booking ID: ${b.booking_id}`, 'success');

            state.selectedSlotNumber = null;
            updateSelectionPanel();
            fetchSlotsForWindow(false);
            fetchUserHistory();
        } else if (res.status === 409) {
            showToast('Overlap Conflict', result.message || 'Overlapping booking detected! This slot was just reserved for these hours.', 'error');
            fetchSlotsForWindow(false);
            closeBookingModal();
        } else {
            showToast('Booking Failed', result.message || 'Could not complete reservation.', 'error');
        }
    } catch (err) {
        console.error('Booking submission error:', err);
        showToast('Network Error', 'Failed to reach local server.', 'error');
    } finally {
        state.isSubmitting = false;
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '🔒 Confirm & Reserve Slot';
    }
}

function copyReceiptId() {
    const id = document.getElementById('receipt-booking-id').textContent;
    navigator.clipboard.writeText(id).then(() => {
        showToast('Copied!', `Booking ID ${id} copied to clipboard.`, 'info');
    });
}

function goToUserHistory() {
    closeBookingModal();
    navigateTo('user-dashboard');
    const historySection = document.querySelector('.user-history-section');
    if (historySection) historySection.scrollIntoView({ behavior: 'smooth' });
}

// ==========================================================================
// User Booking History
// ==========================================================================
async function fetchUserHistory() {
    const loadingEl = document.getElementById('history-loading');
    const emptyEl = document.getElementById('history-empty');
    const grid = document.getElementById('history-grid');

    if (!grid) return;

    try {
        let url = '/api/bookings/my-history';
        const headers = {};

        if (state.token) {
            headers['Authorization'] = `Bearer ${state.token}`;
        } else if (state.currentUser?.phone) {
            url += `?phone=${encodeURIComponent(state.currentUser.phone)}`;
        } else {
            url += `?phone=9876543210`;
        }

        const res = await fetch(url, { headers });
        const data = await res.json();

        if (res.ok && data.success) {
            state.historyBookings = {
                current: data.current || [],
                previous: data.previous || [],
                cancelled: data.cancelled || [],
                all: data.all || []
            };
            renderUserHistory();
        }
    } catch (err) {
        console.error('Error fetching user history:', err);
    }
}

function switchHistoryTab(tab) {
    state.historyTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.getAttribute('data-tab') === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    renderUserHistory();
}

function renderUserHistory() {
    const grid = document.getElementById('history-grid');
    const emptyEl = document.getElementById('history-empty');
    if (!grid) return;

    const list = state.historyBookings[state.historyTab] || [];

    if (list.length === 0) {
        grid.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    grid.innerHTML = list.map(b => {
        const isConfirmed = b.status === 'CONFIRMED';
        const badgeClass = isConfirmed ? 'badge-normal' : 'badge-moderate';

        return `
            <div class="history-card" id="history-card-${b.id}">
                <div>
                    <div class="history-card-header">
                        <span class="history-slot-tag">${escapeHtml(b.slot_number || 'P1')}</span>
                        <span class="badge ${badgeClass}">${escapeHtml(b.status)}</span>
                    </div>

                    <div class="history-meta-row">
                        <span>Facility:</span>
                        <strong>${escapeHtml(b.location_name || 'Hyderabad Hub')} (${escapeHtml(b.area || 'Ameerpet')})</strong>
                    </div>
                    <div class="history-meta-row">
                        <span>Booking ID:</span>
                        <strong style="font-family: monospace; color: var(--primary-blue);">${b.id}</strong>
                    </div>
                    <div class="history-meta-row">
                        <span>Date:</span>
                        <strong>${b.booking_date || '—'}</strong>
                    </div>
                    <div class="history-meta-row">
                        <span>Time Window:</span>
                        <strong>${b.start_time || '09:00'} - ${b.end_time || '10:00'} (${b.duration_hours || 1} hrs)</strong>
                    </div>
                    <div class="history-meta-row">
                        <span>Total Paid:</span>
                        <strong class="text-blue">₹${(b.total_amount || 0).toFixed(2)}</strong>
                    </div>
                </div>

                <div class="history-card-footer">
                    <span style="font-size: 0.78rem; color: var(--text-muted);">${new Date(b.created_at).toLocaleDateString()}</span>
                    ${isConfirmed ? `
                        <button class="btn btn-outline btn-sm" onclick="cancelUserBooking('${b.id}', '${b.user_phone}')">
                            🔓 Cancel / Release
                        </button>
                    ` : `
                        <span style="font-size: 0.8rem; color: var(--text-muted);">Released</span>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

async function cancelUserBooking(bookingId, phone) {
    if (!confirm(`Are you sure you want to cancel booking ${bookingId}? The slot will immediately become free for other users.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/release`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {})
            },
            body: JSON.stringify({ phone })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast('Booking Cancelled', data.message, 'success');
            fetchUserHistory();
            fetchSlotsForWindow(false);
        } else {
            showToast('Error', data.message || 'Could not cancel booking.', 'error');
        }
    } catch {
        showToast('Error', 'Server connection failure.', 'error');
    }
}

// ==========================================================================
// Admin Dashboard Controller
// ==========================================================================
async function fetchAdminOverview() {
    if (state.currentUser?.role !== 'admin') return;

    try {
        const res = await fetch('/api/admin/overview', {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            const o = data.overview;
            document.getElementById('adm-total-facilities').textContent = `${o.total_facilities} Hubs`;
            document.getElementById('adm-total-slots').textContent = `${o.total_slots} Bays`;
            document.getElementById('adm-active-slots').textContent = o.active_slots;
            document.getElementById('adm-maint-slots').textContent = o.maintenance_slots;
            document.getElementById('adm-today-bookings').textContent = o.today_active_bookings;
            document.getElementById('adm-occupancy-rate').textContent = `${o.current_occupancy_pct}% System Occupancy`;
            document.getElementById('adm-total-revenue').textContent = `₹${o.total_revenue.toFixed(2)}`;
        }
    } catch (err) {
        console.error('Error fetching admin overview:', err);
    }
}

async function fetchAdminFacilities() {
    if (state.currentUser?.role !== 'admin') return;

    try {
        const res = await fetch('/api/admin/locations', {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.adminFacilities = data.locations || [];
            renderAdminFacilitiesTable();
            populateAdminFacilitySelectors();
        }
    } catch (err) {
        console.error('Error fetching admin facilities:', err);
    }
}

function renderAdminFacilitiesTable() {
    const tbody = document.getElementById('admin-facilities-tbody');
    if (!tbody) return;

    if (state.adminFacilities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2rem;">No facilities found.</td></tr>';
        return;
    }

    tbody.innerHTML = state.adminFacilities.map(f => {
        const isActive = f.is_active === 1;
        const statusBadge = isActive 
            ? '<span class="badge badge-normal">Active</span>' 
            : '<span class="badge badge-moderate">Inactive</span>';

        return `
            <tr>
                <td><strong>${escapeHtml(f.name)}</strong></td>
                <td><span class="facility-area-badge">${escapeHtml(f.area)}</span></td>
                <td style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(f.address)}</td>
                <td><strong>₹${(f.base_price_per_hour || 50).toFixed(2)}</strong> / hr</td>
                <td>25 Bays (${f.active_slot_count || 25} active)</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="openEditFacilityModal('${f.id}')">
                        ✏️ Edit
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function populateAdminFacilitySelectors() {
    const slotSelect = document.getElementById('adm-facility-select');
    const filterSelect = document.getElementById('adm-facility-filter');

    if (slotSelect) {
        slotSelect.innerHTML = state.adminFacilities.map(f => `
            <option value="${f.id}" ${state.adminSlotsFacilityId === f.id ? 'selected' : ''}>
                ${escapeHtml(f.name)} (${escapeHtml(f.area)})
            </option>
        `).join('');

        if (!state.adminSlotsFacilityId && state.adminFacilities.length > 0) {
            state.adminSlotsFacilityId = state.adminFacilities[0].id;
        }
    }

    if (filterSelect) {
        filterSelect.innerHTML = '<option value="ALL">All Facilities</option>' + state.adminFacilities.map(f => `
            <option value="${f.id}">${escapeHtml(f.name)}</option>
        `).join('');
    }
}

function handleAdminFacilitySelectChange() {
    const select = document.getElementById('adm-facility-select');
    if (!select) return;
    state.adminSlotsFacilityId = select.value;
    fetchAdminSlots();
}

function openAddFacilityModal() {
    document.getElementById('facility-modal-title').textContent = 'Add New Parking Facility';
    document.getElementById('af-id').value = '';
    document.getElementById('af-name').value = '';
    document.getElementById('af-area').value = 'Ameerpet';
    document.getElementById('af-address').value = '';
    document.getElementById('af-city').value = 'Hyderabad';
    document.getElementById('af-price').value = '50.00';
    document.getElementById('af-status-group').style.display = 'none';

    document.getElementById('admin-facility-modal').classList.remove('hidden');
}

function openEditFacilityModal(facilityId) {
    const fac = state.adminFacilities.find(f => f.id === facilityId);
    if (!fac) return;

    document.getElementById('facility-modal-title').textContent = 'Edit Parking Facility';
    document.getElementById('af-id').value = fac.id;
    document.getElementById('af-name').value = fac.name;
    document.getElementById('af-area').value = fac.area;
    document.getElementById('af-address').value = fac.address;
    document.getElementById('af-city').value = fac.city || 'Hyderabad';
    document.getElementById('af-price').value = fac.base_price_per_hour;
    document.getElementById('af-active').value = fac.is_active;
    document.getElementById('af-status-group').style.display = 'block';

    document.getElementById('admin-facility-modal').classList.remove('hidden');
}

function closeAdminFacilityModal() {
    document.getElementById('admin-facility-modal').classList.add('hidden');
}

async function handleAdminFacilitySubmit(event) {
    event.preventDefault();

    const id = document.getElementById('af-id').value;
    const name = document.getElementById('af-name').value.trim();
    const area = document.getElementById('af-area').value;
    const address = document.getElementById('af-address').value.trim();
    const city = document.getElementById('af-city').value.trim();
    const price = parseFloat(document.getElementById('af-price').value);
    const active = document.getElementById('af-active').value === '1';

    const isEdit = !!id;
    const url = isEdit ? `/api/admin/locations/${encodeURIComponent(id)}` : '/api/admin/locations';
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({
                name,
                area,
                address,
                city,
                base_price_per_hour: price,
                is_active: active
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            showToast('Success', data.message, 'success');
            closeAdminFacilityModal();
            fetchAdminFacilities();
            fetchAdminOverview();
            fetchLocations(); // Refresh user-facing facilities
        } else {
            showToast('Error', data.message || 'Could not save facility.', 'error');
        }
    } catch {
        showToast('Error', 'Server connection failure.', 'error');
    }
}

async function fetchAdminSlots() {
    if (state.currentUser?.role !== 'admin') return;

    try {
        const facId = state.adminSlotsFacilityId || (state.facilities[0] ? state.facilities[0].id : 'HYD-AMP-01');
        const res = await fetch(`/api/admin/slots?location_id=${encodeURIComponent(facId)}`, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.adminSlots = data.slots || [];
            renderAdminSlotsTable();
        }
    } catch (err) {
        console.error('Error fetching admin slots:', err);
    }
}

function renderAdminSlotsTable() {
    const tbody = document.getElementById('admin-slots-tbody');
    if (!tbody) return;

    tbody.innerHTML = state.adminSlots.map(s => {
        const isActive = s.is_active === 1;
        const statusBadge = isActive 
            ? '<span class="badge badge-normal">Operational</span>' 
            : '<span class="badge badge-moderate">Under Maintenance</span>';

        return `
            <tr>
                <td><strong style="font-family: monospace; font-size: 1.1rem; color: var(--primary-blue);">${s.slot_number}</strong></td>
                <td>${escapeHtml(s.category)}</td>
                <td>₹${(s.base_price_per_hour || 50).toFixed(2)} / hr</td>
                <td>${statusBadge}</td>
                <td><strong>${s.all_time_bookings || 0}</strong> bookings</td>
                <td>
                    <button 
                        class="btn ${isActive ? 'btn-secondary' : 'btn-primary'} btn-sm"
                        onclick="toggleAdminSlot('${s.slot_number}')"
                    >
                        ${isActive ? 'Set Maintenance' : 'Activate Slot'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function toggleAdminSlot(slotNumber) {
    try {
        const facId = state.adminSlotsFacilityId || (state.facilities[0] ? state.facilities[0].id : 'HYD-AMP-01');
        const res = await fetch(`/api/admin/slots/${encodeURIComponent(slotNumber)}/toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ locationId: facId })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToast('Slot Status Updated', data.message, 'success');
            fetchAdminSlots();
            fetchAdminOverview();
            fetchSlotsForWindow(false);
        } else {
            showToast('Error', data.message || 'Could not toggle slot status.', 'error');
        }
    } catch {
        showToast('Error', 'Server connection failure.', 'error');
    }
}

async function fetchAdminBookings() {
    if (state.currentUser?.role !== 'admin') return;

    try {
        let url = `/api/admin/bookings?status=${encodeURIComponent(state.adminStatusFilter)}`;
        if (state.adminFacilityFilter && state.adminFacilityFilter !== 'ALL') {
            url += `&location_id=${encodeURIComponent(state.adminFacilityFilter)}`;
        }
        if (state.adminSearchQuery.trim() !== '') {
            url += `&search=${encodeURIComponent(state.adminSearchQuery.trim())}`;
        }

        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            state.adminBookings = data.bookings || [];
            renderAdminBookingsTable();
        }
    } catch (err) {
        console.error('Error fetching admin bookings:', err);
    }
}

function renderAdminBookingsTable() {
    const tbody = document.getElementById('admin-bookings-tbody');
    if (!tbody) return;

    if (state.adminBookings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2rem;">No bookings match your search query.</td></tr>`;
        return;
    }

    tbody.innerHTML = state.adminBookings.map(b => {
        const isConfirmed = b.status === 'CONFIRMED';
        const badgeClass = isConfirmed ? 'badge-normal' : 'badge-moderate';

        return `
            <tr>
                <td><strong style="font-family: monospace; font-size: 0.95rem; color: var(--primary-blue);">${b.id}</strong></td>
                <td><strong>${escapeHtml(b.location_name || 'Hub')}</strong> <span class="facility-area-badge" style="font-size: 0.65rem;">${escapeHtml(b.area || 'Ameerpet')}</span></td>
                <td>${escapeHtml(b.user_name)}</td>
                <td>${escapeHtml(b.user_phone)}</td>
                <td><span class="history-slot-tag" style="font-size: 0.9rem;">${escapeHtml(b.slot_number || 'P1')}</span></td>
                <td>${b.booking_date || '—'}</td>
                <td>${b.start_time || '09:00'} - ${b.end_time || '10:00'}</td>
                <td><strong>₹${(b.total_amount || 0).toFixed(2)}</strong></td>
                <td><span class="badge ${badgeClass}">${escapeHtml(b.status)}</span></td>
                <td>
                    ${isConfirmed ? `
                        <button class="btn btn-outline btn-sm text-red" onclick="adminCancelBooking('${b.id}')" title="Emergency cancellation by admin">
                            Cancel
                        </button>
                    ` : `
                        <span style="font-size: 0.8rem; color: var(--text-muted);">None</span>
                    `}
                </td>
            </tr>
        `;
    }).join('');
}

async function adminCancelBooking(bookingId) {
    if (!confirm(`Are you sure you want to cancel booking ${bookingId} as Administrator?`)) return;

    try {
        const res = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/cancel`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${state.token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            showToast('Booking Cancelled', data.message, 'success');
            fetchAdminBookings();
            fetchAdminOverview();
            fetchSlotsForWindow(false);
        } else {
            showToast('Error', data.message || 'Could not cancel booking.', 'error');
        }
    } catch {
        showToast('Error', 'Server connection failure.', 'error');
    }
}

function switchAdminTab(tab) {
    state.adminTab = tab;
    document.querySelectorAll('.admin-tab').forEach(btn => {
        if (btn.getAttribute('data-atab') === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const facTabContent = document.getElementById('admin-tab-facilities');
    const slotsTabContent = document.getElementById('admin-tab-slots');
    const bookingsTabContent = document.getElementById('admin-tab-bookings');

    if (facTabContent) facTabContent.classList.remove('active');
    if (slotsTabContent) slotsTabContent.classList.remove('active');
    if (bookingsTabContent) bookingsTabContent.classList.remove('active');

    if (tab === 'facilities') {
        if (facTabContent) facTabContent.classList.add('active');
        fetchAdminFacilities();
    } else if (tab === 'slots') {
        if (slotsTabContent) slotsTabContent.classList.add('active');
        fetchAdminSlots();
    } else {
        if (bookingsTabContent) bookingsTabContent.classList.add('active');
        fetchAdminBookings();
    }
}

function handleAdminSearch() {
    const searchInput = document.getElementById('adm-search-input');
    const facilitySelect = document.getElementById('adm-facility-filter');
    const statusSelect = document.getElementById('adm-status-filter');

    if (searchInput) state.adminSearchQuery = searchInput.value;
    if (facilitySelect) state.adminFacilityFilter = facilitySelect.value;
    if (statusSelect) state.adminStatusFilter = statusSelect.value;

    fetchAdminBookings();
}

// ==========================================================================
// Home Overview Stats
// ==========================================================================
async function updateHomeOverviewStats() {
    try {
        const res = await fetch('/api/analytics');
        const data = await res.json();

        if (res.ok && data.success) {
            const m = data.metrics || {};
            const facEl = document.getElementById('home-stat-facilities');
            const totalEl = document.getElementById('home-stat-total');
            const availEl = document.getElementById('home-stat-available');
            const occupiedEl = document.getElementById('home-stat-occupied');
            const pctEl = document.getElementById('home-stat-occupancy-pct');

            if (facEl) facEl.textContent = `${m.total_facilities || 10} Hubs`;
            if (totalEl) totalEl.textContent = `${m.total_capacity || 225} Bays`;
            if (availEl) availEl.textContent = `${m.total_available || 0} Free`;
            if (occupiedEl) occupiedEl.textContent = `${m.total_occupied || 0} Booked`;
            if (pctEl) pctEl.textContent = `${m.overall_occupancy_pct || 0}% Occupancy`;
        }
    } catch {
        // Silently handle
    }
}

// ==========================================================================
// Server-Sent Events (SSE) for Real-Time Sync Across Tabs
// ==========================================================================
function initSSE() {
    if (!window.EventSource) return;

    try {
        const eventSource = new EventSource('/api/events');
        const indicator = document.getElementById('live-indicator');

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'CONNECTED') {
                    if (indicator) {
                        indicator.className = 'status-indicator live';
                        indicator.innerHTML = '<span class="pulse-dot"></span> Live Local Sync';
                    }
                } else if (data.type === 'BOOKING_CREATED' || data.type === 'BOOKING_RELEASED' || data.type === 'SLOT_STATUS_CHANGED') {
                    if (state.activeView === 'user-dashboard') {
                        fetchSlotsForWindow(false);
                        fetchUserHistory();
                    } else if (state.activeView === 'admin-dashboard') {
                        fetchAdminOverview();
                        fetchAdminSlots();
                        fetchAdminBookings();
                    } else if (state.activeView === 'home') {
                        updateHomeOverviewStats();
                    } else if (state.activeView === 'analytics' && typeof renderAnalyticsView === 'function') {
                        renderAnalyticsView();
                    }
                }
            } catch {
                // Ignore parse errors
            }
        };

        eventSource.onerror = () => {
            if (indicator) {
                indicator.className = 'status-indicator';
                indicator.innerHTML = '🔄 Polling Fallback';
            }
        };
    } catch {
        // Fallback polling handles updates
    }
}

// ==========================================================================
// Toast Notification Engine
// ==========================================================================
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';
    if (type === 'warning') icon = '🔔';

    toast.innerHTML = `
        <span style="font-size: 1.25rem;">${icon}</span>
        <div class="toast-content">
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(message)}</p>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

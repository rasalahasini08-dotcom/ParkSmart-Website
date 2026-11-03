/**
 * ParkSmart Surge Analytics Controller (v3.0)
 * Renders real-time capacity metrics, Hyderabad cross-area demand comparison,
 * dynamic surge calculations, and interactive Chart.js visualizations
 * directly from persistent SQLite records.
 */

let occupancyChartInstance = null;
let hourlyChartInstance = null;

async function renderAnalyticsView() {
    try {
        const response = await fetch('/api/analytics');
        const data = await response.json();

        if (!data.success) {
            console.error('Failed to load analytics data:', data.message);
            return;
        }

        const metrics = data.metrics || {};
        const areaDemand = data.area_demand || [];
        const slotUtil = data.slot_utilization || [];
        const hourly = data.hourly_demand || [];

        // 1. Update KPI Card Values
        const occRate = metrics.overall_occupancy_pct ?? 0;
        const occEl = document.getElementById('an-occupancy-rate');
        const barEl = document.getElementById('an-occupancy-bar');
        const statusEl = document.getElementById('an-system-surge-status');

        if (occEl) occEl.textContent = `${occRate}%`;
        if (barEl) {
            barEl.style.width = `${occRate}%`;
            if (occRate >= 85) {
                barEl.style.backgroundColor = 'var(--status-red)';
            } else if (occRate >= 70) {
                barEl.style.backgroundColor = 'var(--status-amber)';
            } else {
                barEl.style.backgroundColor = 'var(--primary-blue)';
            }
        }

        if (statusEl) {
            if (occRate >= 85) {
                statusEl.innerHTML = '<span class="badge badge-peak">🔥 Peak Congestion Surge Active (1.5x)</span>';
            } else if (occRate >= 70) {
                statusEl.innerHTML = '<span class="badge badge-moderate">⚡ Moderate Demand Surge Active (1.25x)</span>';
            } else {
                statusEl.innerHTML = '<span class="badge badge-normal">🟢 Normal Equilibrium (1.0x Base)</span>';
            }
        }

        const capEl = document.getElementById('an-total-capacity');
        const activeBaysEl = document.getElementById('an-active-bays');
        if (capEl) capEl.textContent = `${metrics.total_capacity ?? 225} Bays`;
        if (activeBaysEl) activeBaysEl.textContent = metrics.active_slots_count ?? 225;

        const totalBEl = document.getElementById('an-total-bookings');
        const activeBEl = document.getElementById('an-active-bookings');
        const relBEl = document.getElementById('an-released-bookings');
        if (totalBEl) totalBEl.textContent = metrics.total_bookings_count ?? 0;
        if (activeBEl) activeBEl.textContent = metrics.active_bookings_count ?? 0;
        if (relBEl) relBEl.textContent = metrics.released_bookings_count ?? 0;

        const peakBadgeEl = document.getElementById('an-peak-badge');
        if (peakBadgeEl) {
            peakBadgeEl.textContent = `Peak Demand: ${metrics.peak_demand_hour}`;
        }

        const integrityEl = document.getElementById('an-integrity-status');
        if (integrityEl && metrics.concurrency_integrity_verified) {
            integrityEl.textContent = 'Verified 100%';
            integrityEl.className = 'value text-green';
        }

        // 2. Render Cross-Area Demand Comparison Table
        renderAreaDemandComparison(areaDemand);

        // 3. Render Charts using Chart.js
        renderSlotUtilizationChart(slotUtil);
        renderHourlyChart(hourly);

    } catch (err) {
        console.error('Error in renderAnalyticsView:', err);
    }
}

/**
 * Render Hyderabad Area Demand Comparison Table
 */
function renderAreaDemandComparison(areaDemand) {
    const tbody = document.getElementById('an-area-comparison-tbody');
    if (!tbody) return;

    if (!areaDemand || areaDemand.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No area demand records found.</td></tr>';
        return;
    }

    tbody.innerHTML = areaDemand.map(item => {
        return `
            <tr>
                <td><strong>${escapeHtml(item.area)}</strong></td>
                <td>${item.facility_count} Hubs</td>
                <td>${item.total_capacity} Bays</td>
                <td><strong>${item.total_bookings}</strong> reservations</td>
                <td><span class="badge ${item.active_bookings > 0 ? 'badge-moderate' : 'badge-normal'}">${item.active_bookings} Active</span></td>
                <td><strong class="text-green">₹${(item.total_revenue || 0).toFixed(2)}</strong></td>
                <td><span class="badge badge-normal">${item.avg_surge.toFixed(2)}x</span></td>
            </tr>
        `;
    }).join('');
}

/**
 * Chart 1: Bar Chart of 25 Parking Slots (P1 to P25) Utilization
 */
function renderSlotUtilizationChart(slotUtil) {
    const canvas = document.getElementById('occupancyChart');
    if (!canvas) return;

    if (typeof Chart === 'undefined') {
        console.warn('Chart.js not loaded. Skipping chart rendering.');
        return;
    }

    if (occupancyChartInstance) {
        occupancyChartInstance.destroy();
    }

    const labels = slotUtil.length > 0 
        ? slotUtil.map(s => s.slot_number) 
        : Array.from({ length: 25 }, (_, i) => `P${i + 1}`);

    const bookingCounts = slotUtil.length > 0 
        ? slotUtil.map(s => s.booking_count || 0) 
        : Array.from({ length: 25 }, () => 0);

    const colors = slotUtil.map(s => {
        if (s.active_confirmed > 0) return '#ef4444'; // Red for currently occupied
        if (s.booking_count >= 2) return '#1d4ed8'; // Blue for popular
        return '#10b981'; // Green for available/lightly booked
    });

    const ctx = canvas.getContext('2d');
    occupancyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Total Completed Reservations',
                    data: bookingCounts,
                    backgroundColor: colors.length > 0 ? colors : '#1d4ed8',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        afterBody: (context) => {
                            const index = context[0].dataIndex;
                            const item = slotUtil[index];
                            if (item) {
                                return `Active Confirmed: ${item.active_confirmed || 0}\nTotal Revenue: ₹${(item.revenue || 0).toFixed(2)}`;
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}

/**
 * Chart 2: Hourly Demand Trend Line Chart
 */
function renderHourlyChart(hourly) {
    const canvas = document.getElementById('hourlyChart');
    if (!canvas) return;

    if (typeof Chart === 'undefined') return;

    if (hourlyChartInstance) {
        hourlyChartInstance.destroy();
    }

    const labels = hourly.map(h => h.hour);
    const slotsData = hourly.map(h => h.slots);

    const ctx = canvas.getContext('2d');
    hourlyChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Slots Booked Across City',
                    data: slotsData,
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.12)',
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2.5,
                    pointBackgroundColor: '#1d4ed8',
                    pointRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 12 }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 12, font: { family: 'Inter', size: 12 } }
                }
            }
        }
    });
}

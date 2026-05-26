/**
 * WebGIS Application - Geumjeong-gu, Busan, South Korea
 * Author: Antigravity AI
 * Description: Interactive GIS Dashboard analyzing transport accessibility for education facilities.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Application State
    const state = {
        theme: 'dark',
        threshold: 1000, // default distance threshold in meters
        visibleLayers: {
            boundary: true,
            schools: true,
            railway: true,
            stations: true,
            buffers: false
        },
        data: {
            boundary: null,
            schools: null,
            railway: null,
            trainStations: null,
            busStations: null
        },
        layers: {
            boundary: null,
            schools: null,
            railway: null,
            stations: null,
            buffers: null,
            activeLine: null // Polyline showing nearest path
        },
        chart: null,
        selectedSchoolId: null
    };

   const PATHS = {
      boundary: './data/buffered_geojson.geojson',
      schools: './data/education_geumjeong.geojson',
      railway: './data/railway_geumjeong.geojson',
      trainStations: './data/train_station_geumjeong.geojson',
      busStations: './data/bus_station_geumjeong.geojson'
    };

    // Translation maps for schools and levels
    const SCHOOL_TYPES = {
        '1': { id: 'SD', name: 'Sekolah Dasar (SD / Elementary)', level: 'ISCED 1' },
        '2': { id: 'SMP', name: 'Sekolah Menengah Pertama (SMP / Middle)', level: 'ISCED 2' },
        '3': { id: 'SMA', name: 'Sekolah Menengah Atas/Kejuruan (SMA/SMK / High)', level: 'ISCED 3' },
        'default': { id: 'Pendidikan', name: 'Pusat Layanan Pendidikan Anak', level: 'Lainnya' }
    };

    // Map instances and basemaps
    let map = null;
    const basemaps = {
        dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }),
        light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        })
    };
    
    let activeBasemapName = 'dark';

    // 1. Initialize Map
    function initMap() {
        map = L.map('map', {
            center: [35.252, 129.092],
            zoom: 13,
            zoomControl: false,
            layers: [basemaps.dark]
        });

        // Add custom zoom control to the bottom right
        L.control.zoom({
            position: 'bottomright'
        }).addTo(map);
        
        // Add Scale control
        L.control.scale({
            metric: true,
            imperial: false,
            position: 'bottomleft'
        }).addTo(map);
    }

    // 2. Fetch and Load GeoJSON Datasets
    async function loadDatasets() {
        try {
            const [boundaryRes, schoolsRes, railwayRes, trainRes, busRes] = await Promise.all([
                fetch(PATHS.boundary),
                fetch(PATHS.schools),
                fetch(PATHS.railway),
                fetch(PATHS.trainStations),
                fetch(PATHS.busStations)
            ]);

            state.data.boundary = await boundaryRes.json();
            state.data.schools = await schoolsRes.json();
            state.data.railway = await railwayRes.json();
            state.data.trainStations = await trainRes.json();
            state.data.busStations = await busRes.json();
            
            return true;
        } catch (error) {
            console.error('Error loading GeoJSON files:', error);
            // Dynamic UI alert
            document.getElementById('dynamic-insight').innerHTML = `<span style="color:var(--color-danger);"><i class="fa-solid fa-triangle-exclamation"></i> Gagal memuat data GIS. Pastikan Anda menggunakan server lokal (HTTP Server).</span>`;
            return false;
        }
    }

    // Geographically identify transit stations based on known coordinates
    function getStationInfo(feature, type) {
        if (type === 'bus') {
            return {
                name: feature.properties.name || 'Terminal Bus Terpadu Busan (부산종합버스터미널)',
                type: 'Bus Terminal',
                icon: 'fa-bus'
            };
        }
        
        const coords = feature.geometry.coordinates;
        const lat = coords[1];
        const lon = coords[0];
        
        // Match points with actual Busan Subway Station names (approx coords)
        if (lat > 35.280 && lon > 129.090) {
            return { name: 'Stasiun Nopo (노포역)', type: 'Stasiun Metro Line 1', icon: 'fa-subway' };
        } else if (lat > 35.240 && lat < 35.250 && lon > 129.090) {
            return { name: 'Stasiun Jangjeon (장전역)', type: 'Stasiun Metro Line 1', icon: 'fa-subway' };
        } else if (lat > 35.235 && lat < 35.240 && lon > 129.085) {
            return { name: 'Stasiun Guseo (구서역)', type: 'Stasiun Metro Line 1', icon: 'fa-subway' };
        } else if (lat > 35.225 && lat < 35.232 && lon > 129.087) {
            return { name: 'Stasiun Pusan National University (부산대역)', type: 'Stasiun Metro Line 1', icon: 'fa-subway' };
        } else if (lat > 35.215 && lat < 35.222 && lon > 129.080) {
            return { name: 'Stasiun Seodong (서동역)', type: 'Stasiun Metro Line 4', icon: 'fa-subway' };
        } else {
            return { name: `Akses Transit Metro #${feature.properties.fid}`, type: 'Poin Transit Kereta', icon: 'fa-train' };
        }
    }

    // 3. Distance & Accessibility Processing Core
    function processAccessibility() {
        if (!state.data.schools || (!state.data.trainStations && !state.data.busStations)) return;

        // Compile all transport access nodes
        const transitNodes = [];
        
        if (state.data.trainStations) {
            state.data.trainStations.features.forEach(f => {
                const info = getStationInfo(f, 'train');
                transitNodes.push({
                    coords: L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]),
                    name: info.name,
                    type: info.type,
                    icon: info.icon
                });
            });
        }
        
        if (state.data.busStations) {
            state.data.busStations.features.forEach(f => {
                const info = getStationInfo(f, 'bus');
                transitNodes.push({
                    coords: L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]),
                    name: info.name,
                    type: info.type,
                    icon: info.icon
                });
            });
        }

        let totalDistance = 0;
        let accessibleCount = 0;
        const schoolsProcessed = [];

        // For each school, find the absolute nearest transit node
        state.data.schools.features.forEach(schoolFeature => {
            const schoolCoords = L.latLng(schoolFeature.geometry.coordinates[1], schoolFeature.geometry.coordinates[0]);
            let minDistance = Infinity;
            let nearestNode = null;

            transitNodes.forEach(node => {
                const dist = schoolCoords.distanceTo(node.coords); // Leaflet geodesic distance in meters
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestNode = node;
                }
            });

            const isAccessible = minDistance <= state.threshold;
            if (isAccessible) accessibleCount++;
            totalDistance += minDistance;

            // Extract school metadata
            const name = schoolFeature.properties.name || 'Sekolah Tanpa Nama';
            const iscedCode = schoolFeature.properties.isced_leve || 'default';
            const schoolTypeInfo = SCHOOL_TYPES[iscedCode] || SCHOOL_TYPES['default'];

            schoolsProcessed.push({
                id: schoolFeature.properties.fid,
                name: name,
                type: schoolTypeInfo.name,
                level: schoolTypeInfo.level,
                coords: schoolCoords,
                nearestTransit: nearestNode,
                distance: Math.round(minDistance),
                walkTime: Math.round(minDistance / 80), // 80m/minute average walking speed
                status: isAccessible ? 'dekat' : 'jauh'
            });
        });

        // Store calculations
        state.processedSchools = schoolsProcessed;
        state.transitNodes = transitNodes;
        state.statistics = {
            totalSchools: schoolsProcessed.length,
            totalTransit: transitNodes.length,
            accessibleSchools: accessibleCount,
            accessiblePct: Math.round((accessibleCount / schoolsProcessed.length) * 100),
            avgDistance: Math.round(totalDistance / schoolsProcessed.length)
        };
    }

    // 4. Layer Rendering Methods
    function renderBoundary() {
        if (state.layers.boundary) map.removeLayer(state.layers.boundary);
        if (!state.data.boundary || !state.visibleLayers.boundary) return;

        state.layers.boundary = L.geoJSON(state.data.boundary, {
            style: {
                color: activeBasemapName === 'dark' ? 'var(--accent-cyan)' : 'var(--accent-blue)',
                weight: 2,
                opacity: 0.8,
                fillColor: 'rgba(6, 182, 212, 0.05)',
                fillOpacity: 0.4
            }
        }).addTo(map);
    }

    function renderRailways() {
        if (state.layers.railway) map.removeLayer(state.layers.railway);
        if (!state.data.railway || !state.visibleLayers.railway) return;

        state.layers.railway = L.geoJSON(state.data.railway, {
            style: function(feature) {
                const isSubway = feature.properties.railway === 'subway';
                return {
                    color: isSubway ? '#3b82f6' : '#64748b',
                    weight: isSubway ? 3 : 2,
                    dashArray: '5, 8',
                    opacity: 0.8
                };
            }
        }).addTo(map);
    }

    function renderTransitStations() {
        if (state.layers.stations) map.removeLayer(state.layers.stations);
        if (!state.visibleLayers.stations) return;

        const markersArray = [];

        state.transitNodes.forEach(node => {
            const isBus = node.type.includes('Bus');
            const iconHTML = `<div style="
                background: ${isBus ? 'var(--color-warning)' : 'var(--accent-blue)'};
                color: white;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: var(--shadow-sm);
                border: 2px solid white;
            ">
                <i class="fa-solid ${node.icon}" style="font-size: 12px;"></i>
            </div>`;

            const customIcon = L.divIcon({
                html: iconHTML,
                className: 'custom-station-icon',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            });

            const marker = L.marker(node.coords, { icon: customIcon });
            
            // Styled popup
            const popupContent = `
                <div class="popup-header">
                    <div class="popup-title">${node.name}</div>
                    <div class="popup-subtitle"><i class="fa-solid ${node.icon}"></i> ${node.type}</div>
                </div>
                <div class="popup-body" style="padding: 14px 20px;">
                    <div class="popup-info-row" style="font-size:11px; color:var(--text-secondary);">
                        <span>Fasilitas Transit Geumjeong-gu yang menyediakan aksesibilitas memadai bagi wilayah sekitarnya.</span>
                    </div>
                </div>
            `;
            
            marker.bindPopup(popupContent);
            markersArray.push(marker);
        });

        state.layers.stations = L.layerGroup(markersArray).addTo(map);
    }

    function renderDynamicBuffers() {
        if (state.layers.buffers) map.removeLayer(state.layers.buffers);
        if (!state.visibleLayers.buffers) return;

        const buffersArray = [];
        state.transitNodes.forEach(node => {
            // Draw visual 500m/1000m buffers around transit stations dynamically
            const bufferCircle = L.circle(node.coords, {
                radius: state.threshold,
                color: 'var(--accent-cyan)',
                weight: 1,
                opacity: 0.35,
                fillColor: 'var(--accent-cyan)',
                fillOpacity: 0.05,
                interactive: false
            });
            buffersArray.push(bufferCircle);
        });

        state.layers.buffers = L.layerGroup(buffersArray).addTo(map);
    }

    function renderSchools() {
        if (state.layers.schools) map.removeLayer(state.layers.schools);
        if (!state.visibleLayers.schools) return;

        const markersArray = [];

        state.processedSchools.forEach(school => {
            const isNear = school.status === 'dekat';
            const themeClass = isNear ? '' : 'danger';
            
            const markerHTML = `
                <div class="pulsing-marker">
                    <div class="pulsing-dot ${themeClass}"></div>
                    <div class="pulsing-pulse ${themeClass}"></div>
                </div>
            `;

            const customIcon = L.divIcon({
                html: markerHTML,
                className: 'custom-school-marker',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            });

            const marker = L.marker(school.coords, { icon: customIcon });

            // Popup Layout
            const statusLabel = isNear ? 'DEKAT (Adekuat)' : 'JAUH (Kurang Adekuat)';
            const statusClass = isNear ? 'highlight-green' : 'highlight-red';
            const ratingText = isNear 
                ? (school.distance <= 500 ? 'Sangat Baik (Sangat Dekat)' : 'Baik (Cukup Dekat)')
                : (school.distance <= 1500 ? 'Kurang Memadai (Agak Jauh)' : 'Buruk (Sangat Jauh)');

            const popupContent = `
                <div class="popup-header">
                    <div class="popup-title">${school.name}</div>
                    <div class="popup-subtitle"><i class="fa-solid fa-graduation-cap"></i> ${school.type}</div>
                </div>
                <div class="popup-body">
                    <div class="popup-info-row">
                        <span class="popup-info-label">Stasiun Terdekat</span>
                        <span class="popup-info-value">${school.nearestTransit.name}</span>
                    </div>
                    <div class="popup-info-row">
                        <span class="popup-info-label">Jarak Akses</span>
                        <span class="popup-info-value ${statusClass}">${school.distance} meter</span>
                    </div>
                    <div class="popup-info-row">
                        <span class="popup-info-label">Waktu Tempuh Jalan</span>
                        <span class="popup-info-value">${school.walkTime} menit</span>
                    </div>
                    <div class="popup-info-row">
                        <span class="popup-info-label">Status Aksesbilitas</span>
                        <span class="popup-info-value ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="popup-info-row">
                        <span class="popup-info-label">Kategori Penilaian</span>
                        <span class="popup-info-value ${statusClass}">${ratingText}</span>
                    </div>
                </div>
                <div class="popup-footer">
                    <span>Wilayah Geumjeong-gu, Busan</span>
                    <span>Tingkat: ${school.level}</span>
                </div>
            `;

            marker.bindPopup(popupContent);

            // Bind interactivity events
            marker.on('click', () => {
                selectSchool(school);
            });

            marker.on('popupclose', () => {
                // Remove line on popup close if it matches current
                if (state.layers.activeLine && state.selectedSchoolId === school.id) {
                    map.removeLayer(state.layers.activeLine);
                    state.layers.activeLine = null;
                    state.selectedSchoolId = null;
                }
            });

            // Store leaflet ID on our school object for easy programmatic popup triggers
            school.markerRef = marker;
            markersArray.push(marker);
        });

        state.layers.schools = L.layerGroup(markersArray).addTo(map);
    }

    // Draw connection line between selected school and its nearest station
    function selectSchool(school) {
        state.selectedSchoolId = school.id;
        
        // Remove old connection line
        if (state.layers.activeLine) map.removeLayer(state.layers.activeLine);

        // Draw fresh glowing polyline
        const isNear = school.status === 'dekat';
        const lineColor = isNear ? 'var(--color-success)' : 'var(--color-danger)';
        
        state.layers.activeLine = L.polyline([school.coords, school.nearestTransit.coords], {
            color: lineColor,
            weight: 3,
            opacity: 0.9,
            dashArray: '6, 6',
            lineCap: 'round',
            className: 'glowing-connection-line'
        }).addTo(map);

        // Highlight matching row in the Bottom Panel Table
        const rows = document.querySelectorAll('#school-table-body tr');
        rows.forEach(row => {
            row.classList.remove('selected-row');
            if (parseInt(row.getAttribute('data-id')) === school.id) {
                row.classList.add('selected-row');
                row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        
        // Dynamically auto-expand the bottom table panel to show details
        const panel = document.getElementById('bottom-panel');
        if (panel.classList.contains('collapsed')) {
            toggleBottomPanel(false);
        }
    }

    // 5. Populate and Update UI Dashboard
    function updateStatisticsUI() {
        const stats = state.statistics;
        
        document.getElementById('stat-total-schools').textContent = stats.totalSchools;
        document.getElementById('stat-total-transit').textContent = stats.totalTransit;
        document.getElementById('stat-accessible-schools').textContent = stats.accessibleSchools;
        document.getElementById('stat-access-pct').textContent = `${stats.accessiblePct}% Sekolah`;
        document.getElementById('stat-avg-distance').textContent = `${stats.avgDistance} m`;

        // Style the accessibility stat card based on percentages
        const accessCard = document.getElementById('stat-access-card');
        const avgCard = document.getElementById('stat-avg-card');
        
        if (stats.accessiblePct >= 70) {
            accessCard.className = 'stat-card success';
        } else if (stats.accessiblePct >= 40) {
            accessCard.className = 'stat-card warning';
        } else {
            accessCard.className = 'stat-card danger';
        }

        if (stats.avgDistance <= 1000) {
            avgCard.className = 'stat-card success';
        } else if (stats.avgDistance <= 1500) {
            avgCard.className = 'stat-card warning';
        } else {
            avgCard.className = 'stat-card danger';
        }
    }

    function populateSchoolTable() {
        const tbody = document.getElementById('school-table-body');
        tbody.innerHTML = '';

        state.processedSchools.forEach(school => {
            const isNear = school.status === 'dekat';
            const badgeClass = isNear ? 'badge-near' : 'badge-far';
            const badgeLabel = isNear ? 'Dekat' : 'Jauh';
            const badgeIcon = isNear ? 'fa-check' : 'fa-xmark';

            const tr = document.createElement('tr');
            tr.setAttribute('data-id', school.id);
            if (state.selectedSchoolId === school.id) {
                tr.classList.add('selected-row');
            }

            tr.innerHTML = `
                <td style="font-weight: 600;">${school.name}</td>
                <td>${school.type.split(' (')[0]}</td>
                <td>${school.nearestTransit.name.split(' (')[0]}</td>
                <td style="font-family: var(--font-mono);">${school.distance} m</td>
                <td style="font-family: var(--font-mono);">${school.walkTime} min</td>
                <td>
                    <span class="badge ${badgeClass}">
                        <i class="fa-solid ${badgeIcon}"></i> ${badgeLabel}
                    </span>
                </td>
            `;

            // Click table row to pan map to school and trigger its popup!
            tr.addEventListener('click', () => {
                map.setView(school.coords, 14);
                school.markerRef.openPopup();
                selectSchool(school);
            });

            tbody.appendChild(tr);
        });
    }

    function updateInsightText() {
        const stats = state.statistics;
        let rating = '';
        let classColor = '';

        if (stats.accessiblePct >= 80) {
            rating = '<strong>Sangat Memadai (Excellent)</strong>';
            classColor = 'var(--color-success)';
        } else if (stats.accessiblePct >= 50) {
            rating = '<strong>Cukup Memadai (Good)</strong>';
            classColor = 'var(--accent-cyan)';
        } else if (stats.accessiblePct >= 30) {
            rating = '<strong>Kurang Memadai (Fair)</strong>';
            classColor = 'var(--color-warning)';
        } else {
            rating = '<strong>Buruk (Poor Access)</strong>';
            classColor = 'var(--color-danger)';
        }

        const insightHTML = `
            Pada ambang batas aksesibilitas spasial <strong>${state.threshold} meter</strong>, sebanyak 
            <strong>${stats.accessibleSchools} dari ${stats.totalSchools} sekolah</strong> (${stats.accessiblePct}%) 
            memiliki jangkauan transportasi yang memadai. Rata-rata jarak sekolah ke stasiun terdekat adalah 
            <strong>${stats.avgDistance} meter</strong>, yang secara keseluruhan menunjukkan aksesibilitas transportasi 
            wilayah pendidikan Geumjeong-gu berkategori <span style="color:${classColor}; font-weight:700;">${rating}</span>.
        `;

        document.getElementById('dynamic-insight').innerHTML = insightHTML;
    }

    // 6. Chart.js Doughnut Charts Initialization & Updates
    function updateChart() {
        const stats = state.statistics;
        const dekatVal = stats.accessibleSchools;
        const jauhVal = stats.totalSchools - stats.accessibleSchools;

        const isDark = state.theme === 'dark';
        const fontColor = isDark ? '#94a3b8' : '#475569';
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.08)';

        const chartColors = {
            dekat: isDark ? '#10b981' : '#059669',
            jauh: isDark ? '#ef4444' : '#dc2626',
            dekatHover: isDark ? '#059669' : '#047857',
            jauhHover: isDark ? '#dc2626' : '#b91c1c'
        };

        if (state.chart) {
            // Smoothly update Chart data
            state.chart.data.datasets[0].data = [dekatVal, jauhVal];
            state.chart.data.datasets[0].backgroundColor = [chartColors.dekat, chartColors.jauh];
            state.chart.data.datasets[0].hoverBackgroundColor = [chartColors.dekatHover, chartColors.jauhHover];
            state.chart.options.plugins.legend.labels.color = fontColor;
            state.chart.update();
        } else {
            const ctx = document.getElementById('accessChart').getContext('2d');
            state.chart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Akses Dekat', 'Akses Jauh'],
                    datasets: [{
                        data: [dekatVal, jauhVal],
                        backgroundColor: [chartColors.dekat, chartColors.jauh],
                        hoverBackgroundColor: [chartColors.dekatHover, chartColors.jauhHover],
                        borderWidth: isDark ? 2 : 1,
                        borderColor: isDark ? '#1e293b' : '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: fontColor,
                                boxWidth: 12,
                                padding: 14,
                                font: {
                                    family: "'Plus Jakarta Sans', sans-serif",
                                    size: 11,
                                    weight: '500'
                                }
                            }
                        },
                        tooltip: {
                            backgroundColor: isDark ? '#0f172a' : '#ffffff',
                            titleColor: isDark ? '#ffffff' : '#0f172a',
                            bodyColor: isDark ? '#94a3b8' : '#475569',
                            borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0,0,0,0.1)',
                            borderWidth: 1,
                            callbacks: {
                                label: function(context) {
                                    const val = context.raw;
                                    const pct = Math.round((val / stats.totalSchools) * 100);
                                    return ` ${context.label}: ${val} Sekolah (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // 7. Full Map Redraw on Slider update
    function updateWebGISAnalysis() {
        processAccessibility();
        renderSchools();
        renderDynamicBuffers();
        updateStatisticsUI();
        populateSchoolTable();
        updateInsightText();
        updateChart();

        // If a school was previously selected, re-draw connection line to keep visual state in sync
        if (state.selectedSchoolId) {
            const activeSchoolObj = state.processedSchools.find(s => s.id === state.selectedSchoolId);
            if (activeSchoolObj) {
                selectSchool(activeSchoolObj);
            }
        }
    }

    // 8. Collapsible Bottom Panel Overlay Logic
    function toggleBottomPanel(shouldCollapse) {
        const panel = document.getElementById('bottom-panel');
        const arrow = document.getElementById('panel-toggle-arrow');
        
        if (shouldCollapse === undefined) {
            shouldCollapse = !panel.classList.contains('collapsed');
        }

        if (shouldCollapse) {
            panel.classList.add('collapsed');
            arrow.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
        } else {
            panel.classList.remove('collapsed');
            arrow.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        }
    }

    // 9. UI Events & Interactive Control Bindings
    function bindEvents() {
        // Slider controls
        const slider = document.getElementById('threshold-slider');
        const sliderValue = document.getElementById('slider-value');
        
        slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.threshold = val;
            sliderValue.textContent = `${val} m`;

            // Change colors of value badge based on distance
            if (val <= 600) {
                sliderValue.className = 'slider-value-badge';
            } else if (val <= 1500) {
                sliderValue.className = 'slider-value-badge warning';
            } else {
                sliderValue.className = 'slider-value-badge danger';
            }

            updateWebGISAnalysis();
        });

        // Layer Toggles
        const layerButtons = document.querySelectorAll('.layer-toggles-grid .toggle-btn');
        layerButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const button = e.currentTarget;
                const layerKey = button.getAttribute('data-layer');
                const isActive = button.classList.contains('active');

                if (isActive) {
                    button.classList.remove('active');
                    state.visibleLayers[layerKey] = false;
                } else {
                    button.classList.add('active');
                    state.visibleLayers[layerKey] = true;
                }

                // Redraw layers
                if (layerKey === 'boundary') renderBoundary();
                if (layerKey === 'schools') renderSchools();
                if (layerKey === 'railway') renderRailways();
                if (layerKey === 'stations') renderTransitStations();
                if (layerKey === 'buffers') renderDynamicBuffers();
            });
        });

        // Theme Toggle (Dark / Light)
        const themeBtn = document.getElementById('theme-toggle-btn');
        themeBtn.addEventListener('click', () => {
            const body = document.body;
            const themeIcon = document.getElementById('theme-icon');

            if (state.theme === 'dark') {
                state.theme = 'light';
                body.setAttribute('data-theme', 'light');
                themeIcon.className = 'fa-solid fa-moon';
                themeIcon.style.color = '#3b82f6';
                
                // Swap basemap seamlessly
                if (activeBasemapName === 'dark') {
                    map.removeLayer(basemaps.dark);
                    map.addLayer(basemaps.light);
                    activeBasemapName = 'light';
                }
            } else {
                state.theme = 'dark';
                body.setAttribute('data-theme', 'dark');
                themeIcon.className = 'fa-solid fa-sun';
                themeIcon.style.color = '';
                
                if (activeBasemapName === 'light') {
                    map.removeLayer(basemaps.light);
                    map.addLayer(basemaps.dark);
                    activeBasemapName = 'dark';
                }
            }

            // Redraw layers to match theme colors
            renderBoundary();
            renderRailways();
            updateChart();
        });

        // Custom Floating Map Buttons
        document.getElementById('btn-zoom-home').addEventListener('click', () => {
            // Zoom home resets map to Geumjeong-gu bounds
            if (state.layers.boundary) {
                map.fitBounds(state.layers.boundary.getBounds(), { padding: [30, 30] });
            } else {
                map.setView([35.252, 129.092], 13);
            }
        });

        document.getElementById('btn-toggle-basemap').addEventListener('click', () => {
            // Cycle between Dark -> Light -> Satellite basemaps
            if (activeBasemapName === 'dark') {
                map.removeLayer(basemaps.dark);
                map.addLayer(basemaps.light);
                activeBasemapName = 'light';
                
                const themeIcon = document.getElementById('theme-icon');
                state.theme = 'light';
                document.body.setAttribute('data-theme', 'light');
                themeIcon.className = 'fa-solid fa-moon';
            } else if (activeBasemapName === 'light') {
                map.removeLayer(basemaps.light);
                map.addLayer(basemaps.satellite);
                activeBasemapName = 'satellite';
            } else {
                map.removeLayer(basemaps.satellite);
                map.addLayer(basemaps.dark);
                activeBasemapName = 'dark';
                
                const themeIcon = document.getElementById('theme-icon');
                state.theme = 'dark';
                document.body.setAttribute('data-theme', 'dark');
                themeIcon.className = 'fa-solid fa-sun';
            }
            renderBoundary();
            renderRailways();
        });

        document.getElementById('btn-toggle-legend').addEventListener('click', () => {
            const legendDiv = document.querySelector('.info.legend');
            if (legendDiv) {
                const isHidden = legendDiv.style.display === 'none';
                legendDiv.style.display = isHidden ? 'block' : 'none';
            }
        });

        // Bottom panel collapse action
        document.getElementById('panel-header-btn').addEventListener('click', () => {
            toggleBottomPanel();
        });
    }

    // 10. Add Map Legend overlay
    function addLegend() {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function() {
            const div = L.DomUtil.create('div', 'info legend');
            
            div.innerHTML = `
                <h4>Legenda Peta</h4>
                <div class="legend-item" style="margin-bottom: 6px;">
                    <span class="legend-color" style="background-color: var(--color-success); border-color:white; box-shadow:0 0 4px var(--color-success);"></span>
                    <span>Sekolah Akses Dekat (Memadai)</span>
                </div>
                <div class="legend-item" style="margin-bottom: 8px;">
                    <span class="legend-color" style="background-color: var(--color-danger); border-color:white; box-shadow:0 0 4px var(--color-danger);"></span>
                    <span>Sekolah Akses Jauh (Kurang)</span>
                </div>
                <div class="legend-item" style="margin-bottom: 6px;">
                    <span class="legend-color" style="background-color: var(--accent-blue); border-color:white;"></span>
                    <span>Stasiun Metro Transit</span>
                </div>
                <div class="legend-item" style="margin-bottom: 8px;">
                    <span class="legend-color" style="background-color: var(--color-warning); border-color:white;"></span>
                    <span>Terminal Bus Terpadu</span>
                </div>
                <div class="legend-item" style="margin-bottom: 6px;">
                    <span class="legend-line" style="background-color: #3b82f6;"></span>
                    <span>Jalur Rel Metro Transit</span>
                </div>
                <div class="legend-item">
                    <span class="legend-line" style="border-top: 2px dashed var(--color-success); background:transparent;"></span>
                    <span>Konektivitas Rute Berjalan Kaki</span>
                </div>
            `;
            return div;
        };

        legend.addTo(map);
    }

    // Initial Execution Workflow
    async function start() {
        initMap();
        bindEvents();
        
        // Display loading indicators
        document.getElementById('dynamic-insight').innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Memuat data spasial Geumjeong-gu...`;
        
        const success = await loadDatasets();
        if (success) {
            addLegend();
            
            // Build and display boundary and railway lines initially
            renderBoundary();
            renderRailways();
            
            // Process initial accessibility analysis and populate layers
            processAccessibility();
            renderTransitStations();
            renderSchools();
            
            // Populate stats and interactive tables
            updateStatisticsUI();
            populateSchoolTable();
            updateInsightText();
            updateChart();
            
            // Make bottom panel start as collapsed by default to keep the map clean
            toggleBottomPanel(true);
            
            // Fit map bounds neatly around Geumjeong-gu boundary polygon
            if (state.layers.boundary) {
                map.fitBounds(state.layers.boundary.getBounds(), { padding: [30, 30] });
            }
        }
    }

    // Bootstrapping the WebGIS App
    start();
});

import leaflet from 'leaflet';
import leafletImage from 'leaflet-image';
import leafletGeometry from 'leaflet-geometryutil';
import 'leaflet-polylinedecorator';
import 'leaflet-providers';
import 'leaflet-easybutton';
import moment from 'moment';
import 'leaflet-sidebar-v2';

import * as ui from './ui';


const INIT_COORDS = [58.006224, 56.245257];


const DEFAULT_OPTIONS = {
    theme: 'CartoDB.DarkMatter',
    lineOptions: {
        color: '#0CB1E8',
        weight: 1,
        opacity: 0.7,
        smoothFactor: 2,
        overrideExisting: true,
        detectColors: true,
        renderer: L.canvas({ padding: 0, tolerance: 5 })
    },
    markerOptions: {
        color: '#00FF00',
        weight: 3,
        radius: 5,
        opacity: 0.5
    }
};

export default class GpxMap {
    constructor(options) {
        this.options = options || DEFAULT_OPTIONS;
        this.tracks = [];
        this.filters = {
            minDate: null,
            maxDate: null,
        };
        this.imageMarkers = [];

        this.map = leaflet.map('background-map', {
            center: INIT_COORDS,
            zoom: 10,
            preferCanvas: true,
        });
        
        this.sidebar = leaflet.control.sidebar({
            autopan: true,       // whether to maintain the centered map point when opening the sidebar
            closeButton: true,    // whether t add a close button to the panes
            container: 'sidebar', // the DOM container or #ID of a predefined sidebar container that should be used
            position: 'left',     // left or right
        }).addTo(this.map);
        
        this.sidebar.addPanel({
            id: 'exportpng',
            tab: '<i class="fa fa-camera fa-lg"></i>',
            title: 'Export as png',
            button: () => {
                let modal = ui.showModal('exportImage')
                    .afterClose(() => modal.destroy());

                document.getElementById('render-export').onclick = (e) => {
                    e.preventDefault();

                    let output = document.getElementById('export-output');
                    output.innerHTML = 'Rendering <i class="fa fa-cog fa-spin"></i>';

                    let form = document.getElementById('export-settings').elements;
                    this.screenshot(form.format.value, output);
                };
            }
        });
        
        this.sidebar.addPanel({
            id: 'settings',
            tab: '<i class="fa fa-sliders fa-lg"></i>',
            title: 'Open settings dialog',
            button: () => {
                ui.buildSettingsModal(this.tracks, this.options, (opts) => {
                    this.updateOptions(opts);
                }).show();
            }
        });
        
        this.sidebar.addPanel({
            id: 'filtertracks',
            tab: '<i class="fa fa-filter fa-lg"></i>',
            title: 'Filter displayed tracks',
            button: () => {
                ui.buildFilterModal(this.tracks, this.filters, (f) => {
                    this.filters = f;
                    this.applyFilters();
                }).show();
            }
        });
        
        this.viewAll = this.sidebar.addPanel({
            id: 'viewall',
            tab: '<i class="fa fa-map fa-lg"></i>',
            title: 'Zoom to all tracks',
            button: () => {
                this.center();
            },
            disabled: true
        });
        
        this.saveAll = this.sidebar.addPanel({
            id: 'saveall',
            tab: '<i class="fa fa-save fa-lg"></i>',
            title: 'Save all loaded tracks to one gpx file',
            button: () => {
                ui.saveGpx(this.tracks);
            },
            disabled: true
        });
        
        this.sidebar.addPanel({
            id: "routes2017",
            title: "Маршруты за 2017 год",
            tab: "<small>2017</small>",
            button: () => {
                this.clearMap();
                ui.loadgpx(this, "2017.gpx");
            },
            position: "bottom"
        });
        
        this.sidebar.addPanel({
            id: "routes2018",
            title: "Маршруты за 2018 год",
            tab: "<small>2018</small>",
            button: () => {
                this.clearMap();
                ui.loadgpx(this, "2018.gpx");
            },
            position: "bottom"
        });
        
        this.sidebar.addPanel({
            id: "routes2019",
            title: "Маршруты за 2019 год",
            tab: "<small>2019</small>",
            button: () => {
                this.clearMap();
                ui.loadgpx(this, "2019.gpx");
            },
            position: "bottom"
        });
        
        this.sidebar.addPanel({
            id: "tracklistpanel",
            title: "Список треков",
            tab: '<i class="fa fa-bars fa-lg"></i>',
            pane: '<ul id="tracklist"></ul>',
            position: "bottom"
        });

        this.markScrolled = () => {
            this.map.removeEventListener('movestart', this.markScrolled);
            this.scrolled = true;
        };

        this.clearScroll();
        this.switchTheme(this.options.theme);
        this.requestBrowserLocation();
    }

    clearScroll() {
        this.scrolled = false;
        this.map.addEventListener('movestart', this.markScrolled);
    }

    switchTheme(themeName) {
        if (this.mapTiles) {
            this.mapTiles.removeFrom(this.map);
        }

        if (themeName.includes('Thunderforest')) {
            this.mapTiles = leaflet.tileLayer.provider(themeName, {apikey: '651f93718cb04eb0a82dc09d103b22e6'});
        } else {
            this.mapTiles = leaflet.tileLayer.provider(themeName);
        }
        this.mapTiles.addTo(this.map, {detectRetina: true});
    }

    updateOptions(opts) {
        if (opts.theme !== this.options.theme) {
            this.switchTheme(opts.theme);
        }

        if (opts.lineOptions.overrideExisting) {
            this.tracks.forEach(({line}) => {
                line.setStyle({
                    color: opts.lineOptions.color,
                    weight: opts.lineOptions.weight,
                    opacity: opts.lineOptions.opacity,
                });

                line.redraw();
            });

            let markerOptions = opts.markerOptions;
            this.imageMarkers.forEach(i => {
                i.setStyle({
                    color: markerOptions.color,
                    weight: markerOptions.weight,
                    opacity: markerOptions.opacity,
                    radius: markerOptions.radius
                });

                i.redraw();
            });

        }

        this.options = opts;
    }

    applyFilters() {
        const dateBounds = {
            min: new Date(this.filters.minDate || '1900/01/01'),
            max: new Date(this.filters.maxDate || '2500/01/01'),
        };

        // NOTE: Tracks that don't have an associated timestamp will never be
        // excluded.
        const filters = [
            (t) => t.timestamp && dateBounds.min > t.timestamp,
            (t) => t.timestamp && dateBounds.max < t.timestamp,
        ];

        for (let track of this.tracks) {
            let hideTrack = filters.some(f => f(track));

            if (hideTrack && track.visible) {
                track.line.remove();
            } else if (!hideTrack && !track.visible){
                track.line.addTo(this.map);
            }

            track.visible = !hideTrack;
        }
    }

    // Try to pull geo location from browser and center the map
    requestBrowserLocation() {
        navigator.geolocation.getCurrentPosition(pos => {
            if (!this.scrolled && this.tracks.length === 0) {
                this.map.panTo([pos.coords.latitude, pos.coords.longitude], {
                    noMoveStart: true,
                    animate: false,
                });
                // noMoveStart doesn't seem to have an effect, see Leaflet
                // issue: https://github.com/Leaflet/Leaflet/issues/5396
                this.clearScroll();
            }
        });
    }

    addTrack(track) {
        this.sidebar.enablePanel('viewall');
        this.sidebar.enablePanel('saveall');
        let lineOptions = Object.assign({}, this.options.lineOptions);

        if (lineOptions.detectColors) {
            if (/-(Hike|Walk)\.gpx/.test(track.filename)) {
                lineOptions.color = '#ffc0cb';
            } else if (/-Run\.gpx/.test(track.filename)) {
                lineOptions.color = '#ff0000';
            } else if (/-Ride\.gpx/.test(track.filename)) {
                lineOptions.color = '#00ffff';
            }
        }
        
        let line = leaflet.polyline(track.points, lineOptions);
        let decorator = leaflet.polylineDecorator(line, {
            patterns: [
                {offset: 0, repeat: 0, symbol: L.Symbol.arrowHead({pixelSize: 0, pathOptions: {fillOpacity: 0, weight: 0, color: 'red'}})}
            ]
        }).addTo(this.map);
        line.addTo(this.map);
        
        line.on('mouseover', function() {
            decorator.setPatterns([
                {offset: 400, repeat: 400, symbol: L.Symbol.arrowHead({pixelSize: 15, pathOptions: {fillOpacity: 1, weight: 1, color: 'red'}})}
            ]);
            this.setStyle({
                color: 'red',
                weight: 3,
                opacity: 1.0
            });
            this.bringToFront();
        });
        line.on('mouseout', function() {
            decorator.setPatterns([
                {offset: 0, repeat: 0, symbol: L.Symbol.arrowHead({pixelSize: 0, pathOptions: {fillOpacity: 0, weight: 0, color: 'red'}})}
            ]);
            this.setStyle(lineOptions);
        });
        
        line.on('click', function() {
            let offset = document.querySelector('.leaflet-sidebar-content').getBoundingClientRect().width;
            map.fitBounds(line.getBounds(), {paddingTopLeft: [offset, 0]});
        });

        track = Object.assign({line, visible: true, decorator}, track);
        this.tracks.push(track);
        
        this.refreshTrackTooltip(track);
        
        let tracklink = document.createElement('li');
        if (track.date) {
            tracklink.innerText = track.date + " " + track.name;
        } else {
            tracklink.innerText = moment(track.points[0].time).format("DD.MM.YYYY HH:mm:ss") + " " + track.name;
        }
        tracklink.classList.add("tracklink");
        
        tracklink.addEventListener('mouseover', function() {
            decorator.setPatterns([
                {offset: 400, repeat: 400, symbol: L.Symbol.arrowHead({pixelSize: 15, pathOptions: {fillOpacity: 1, weight: 1, color: 'red'}})}
            ]);
            line.setStyle({
                color: 'red',
                weight: 3,
                opacity: 1.0
            });
            line.bringToFront();
            line.openTooltip();
        });
        tracklink.addEventListener('mouseout', function() {
            decorator.setPatterns([
                {offset: 0, repeat: 0, symbol: L.Symbol.arrowHead({pixelSize: 0, pathOptions: {fillOpacity: 0, weight: 0, color: 'red'}})}
            ]);
            line.setStyle(lineOptions);
            line.closeTooltip();
        });
        let map = this.map;
        tracklink.addEventListener('click', function() {
            let offset = document.querySelector('.leaflet-sidebar-content').getBoundingClientRect().width;
            map.fitBounds(line.getBounds(), {paddingTopLeft: [offset, 0]});
        });
        
        document.getElementById('tracklist').appendChild(tracklink);

        return track;
    }
    
    refreshTrackTooltip(track) {
        let length = (leafletGeometry.length(track.line) / 1000).toFixed(1);
        let tooltip = "<strong>" + track.name + '</strong>';
        if (track.points[0].time) tooltip += "<br>Дата: " + moment(track.points[0].time).format("DD.MM.YYYY HH:mm:ss");
        if (track.date) tooltip += "<br>Дата: " + track.date;
        tooltip += '<br>Расстояние: ' + length + ' км';
        if (track.desc) tooltip += track.desc;
        if (track.type) tooltip += "<br>" + track.type + (track.equipment ? ": " + track.equipment : "");
        if (track.totaltime) tooltip += "<br>Длительность: " + moment.utc(track.totaltime*1000).format("H:mm");
        if (track.totalElev) tooltip += "<br>Общий подъем: " + track.totalElev + " м";
        if (track.elevMap) tooltip += "<br><img src='" + track.elevMap + "'>";
        track.line.bindTooltip(tooltip, {sticky: true, opacity:0.8});
    }

    async markerClick(image) {
        const latitude = await image.latitude();
        const longitude = await image.longitude();
        const imageData = await image.getImageData();

        let latlng = leaflet.latLng(latitude, longitude);

        leaflet.popup({minWidth: 512})
            .setLatLng(latlng)
            .setContent(`<img src="${imageData}" width="512" height="100%">`)
            .addTo(this.map);
    }

    async addImage(image) {
        const lat = await image.latitude();
        const lng = await image.longitude();

        let latlng = leaflet.latLng(lat, lng);
        let markerOptions = Object.assign({}, this.options.markerOptions);

        let marker = leaflet.circleMarker(latlng, markerOptions)
            .on('click', () => {
                this.markerClick(image);
            })
            .addTo(this.map);

        this.imageMarkers.push(marker);
    }

    // Center the map if the user has not yet manually panned the map
    recenter() {
        if (!this.scrolled) {
            this.center();
        }
    }

    center() {
        // If there are no tracks, then don't try to get the bounds, as there
        // would be an error
        if (this.tracks.length === 0 && this.imageMarkers.length === 0) {
            return;
        }

        let tracksAndImages = this.tracks.map(t => t.line)
            .concat(this.imageMarkers);

        this.map.fitBounds((new leaflet.featureGroup(tracksAndImages)).getBounds(), {
            noMoveStart: true,
            animate: false,
            padding: [50, 20],
        });

        if (!this.scrolled) {
            this.clearScroll();
        }
    }

    screenshot(format, domNode) {
        leafletImage(this.map, (err, canvas) => {
            if (err) {
                return window.alert(err);
            }

            let link = document.createElement('a');

            if (format === 'png') {
                link.download = 'derive-export.png';
                link.innerText = 'Download as PNG';

                canvas.toBlob(blob => {
                    link.href = URL.createObjectURL(blob);
                    domNode.innerText = '';
                    domNode.appendChild(link);
                });
            } else if (format === 'svg') {
                link.innerText = 'Download as SVG';

                const scale = 2;
                const bounds = this.map.getPixelBounds();
                bounds.min = bounds.min.multiplyBy(scale);
                bounds.max = bounds.max.multiplyBy(scale);
                const left = bounds.min.x;
                const top = bounds.min.y;
                const width = bounds.getSize().x;
                const height = bounds.getSize().y;

                let svg = leaflet.SVG.create('svg');
                let root = leaflet.SVG.create('g');

                svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);

                this.tracks.forEach(track => {
                    // Project each point from LatLng, scale it up, round to
                    // nearest 1/10 (by multiplying by 10, rounding and
                    // dividing), and reducing by removing duplicates (when two
                    // consecutive points have rounded to the same value)
                    let pts = track.getLatLngs().map(ll =>
                            this.map.project(ll)
                                    .multiplyBy(scale*10)
                                    .round()
                                    .divideBy(10)
                    ).reduce((acc,next) => {
                        if (acc.length === 0 ||
                                acc[acc.length-1].x !== next.x ||
                                acc[acc.length-1].y !== next.y) {
                            acc.push(next);
                        }
                        return acc;
                    }, []);

                    // If none of the points on the track are on the screen,
                    // don't export the track
                    if (!pts.some(pt => bounds.contains(pt))) {
                        return;
                    }
                    let path = leaflet.SVG.pointsToPath([pts], false);
                    let el = leaflet.SVG.create('path');

                    el.setAttribute('stroke', track.options.color);
                    el.setAttribute('stroke-opacity', track.options.opacity);
                    el.setAttribute('stroke-width', scale * track.options.weight);
                    el.setAttribute('stroke-linecap', 'round');
                    el.setAttribute('stroke-linejoin', 'round');
                    el.setAttribute('fill', 'none');

                    el.setAttribute('d', path);

                    root.appendChild(el);
                });

                svg.appendChild(root);

                let xml = (new XMLSerializer()).serializeToString(svg);
                link.download = 'derive-export.svg';

                let blob = new Blob([xml], {type: 'application/octet-stream'});
                link.href = URL.createObjectURL(blob);

                domNode.innerText = '';
                domNode.appendChild(link);
            }
        });
    }
    
    clearMap() {
        document.getElementById("tracklist").innerHTML = "";
        this.tracks.forEach(track => {
            track.line.remove();
            track.decorator.remove();
        });
        this.tracks = []
    }
}

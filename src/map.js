import leaflet from 'leaflet';
import leafletImage from 'leaflet-image';
import leafletGeometry from 'leaflet-geometryutil';
import 'leaflet-polylinedecorator';
import 'leaflet-providers';
import 'leaflet-easybutton';
import moment from 'moment';
import 'leaflet-sidebar-v2';
import vis from 'vis-timeline'

import * as ui from './ui';


const INIT_COORDS = [58.006224, 56.245257];


const DEFAULT_OPTIONS = {
    theme: 'CartoDB.Voyager',
    lineOptions: {
        color: '#0a799e',
        weight: 2,
        opacity: 0.6,
        smoothFactor: 2,
        overrideExisting: true,
        detectColors: true,
        renderer: leaflet.canvas({ padding: 0, tolerance: 5 })
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
        this.options = Object.assign(DEFAULT_OPTIONS, options);
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
        
        this.viewAll = this.sidebar.addPanel({
            id: 'viewall',
            tab: '<i class="fa fa-search fa-lg"></i>',
            title: 'Центровать на всех треках',
            button: () => {
                this.center();
            },
            disabled: true
        });
        
        let themes = ui.AVAILABLE_THEMES.map(t => {
            let selected = (t === this.options.theme) ? 'selected' : '';
            return `<option ${selected} value="${t}">${t}</option>`;
        });
        
        this.sidebar.addPanel({
            id: 'tools',
            tab: '<i class="fa fa-wrench fa-lg"></i>',
            title: 'Инструменты',
            pane: 
            `<div>
                <span class="form-row">
                    <label>Карта</label>
                    <select name="theme" id="switchTheme" style="padding:5px;margin:5px;">
                        ${themes}
                    </select>
                </span>
                <hr/>
                <button id="buttonExportAsPng" class="btn"><i class="fa fa-camera fa-lg"></i> Export PNG</button> <button id="buttonSaveAll" class="btn"><i class="fa fa-map fa-lg"></i> Export GPX</button>
                <hr/>
                <h2>Загрузить трек из массива точек</h2>
                <input type="text" id="addTrackFromPointsName" placeholder="Название маршрута" style="padding:5px;margin:5px;"><br/>
                <textarea style="padding:5px;margin:5px;" rows="5" cols="50" wrap="on" id="addTrackFromPointsArray" placeholder="[[lat, lng],[lat, lng],...]"></textarea><br/>
                <button class="btn" id="buttonAddTrackFromPoints"><i class="fa fa-plus fa-lg"></i> Добавить</button>
                
            </div>`,
        });
        
        document.getElementById('switchTheme').onchange = (e) => {
            this.options.theme = e.target.value;
            this.switchTheme(this.options.theme);
        };
        
        document.getElementById('buttonExportAsPng').onclick = () => {
            let modal = ui.showModal('exportImage')
                .afterClose(() => modal.destroy());

            document.getElementById('render-export').onclick = (e) => {
                e.preventDefault();

                let output = document.getElementById('export-output');
                output.innerHTML = 'Rendering <i class="fa fa-cog fa-spin"></i>';

                let form = document.getElementById('export-settings').elements;
                this.screenshot(form.format.value, output);
            };
        };
        
        document.getElementById('buttonSaveAll').onclick = () => {
            ui.saveGpx(this.tracks);
        };
        
        this.sidebar.addPanel({
            id: 'settings',
            tab: '<i class="fa fa-sliders fa-lg"></i>',
            title: 'Настройки',
            button: () => {
                ui.buildSettingsModal(this.tracks, this.options, (opts) => {
                    this.updateOptions(opts);
                }).show();
            }
        });
        
        this.sidebar.addPanel({
            id: 'filtertracks',
            tab: '<i class="fa fa-filter fa-lg"></i>',
            title: 'Фильтр по датам',
            button: () => {
                ui.buildFilterModal(this.tracks, this.filters, (f) => {
                    this.filters = f;
                    this.applyFilters();
                }).show();
            }
        });
        
        this.sidebar.addPanel({
            id: 'routes2017',
            title: 'Маршруты за 2017 год',
            tab: '<small>2017</small>',
            button: async () => {
                this.clearMap();
                await ui.loadgpx(this, '2017.gpx');
                this.fitTimelineRange();
            },
            position: 'bottom'
        });
        
        this.sidebar.addPanel({
            id: 'routes2018',
            title: 'Маршруты за 2018 год',
            tab: '<small>2018</small>',
            button: async () => {
                this.clearMap();
                await ui.loadgpx(this, '2018.gpx');
                this.fitTimelineRange();
            },
            position: 'bottom'
        });
        
        this.sidebar.addPanel({
            id: 'routes2019',
            title: 'Маршруты за 2019 год',
            tab: '<small>2019</small>',
            button: async () => {
                this.clearMap();
                await ui.loadgpx(this, '2019.gpx');
                this.fitTimelineRange();
            },
            position: 'bottom'
        });
        
        this.sidebar.addPanel({
            id: 'routes2019',
            title: 'Маршруты за 2020 год',
            tab: '<small>2020</small>',
            button: async () => {
                this.clearMap();
                await ui.loadgpx(this, '2020.gpx');
                this.fitTimelineRange();
            },
            position: 'bottom'
        });
        
        this.sidebar.addPanel({
            id: 'tracklistpanel',
            title: 'Список треков',
            tab: '<i class="fa fa-bars fa-lg"></i>',
            pane: '<table id="tracklist"><tr><thead><th>Дата</th><th>Название</th><th>Дистанция</th><th>Подъем</th></tr></thead><tbody></tbody></table>',
            position: 'bottom'
        });
        
        document.getElementById('buttonAddTrackFromPoints').onclick = (e) => {
            e.preventDefault();

            let data = JSON.parse(document.getElementById('addTrackFromPointsArray').value);
            
            let points = [];
            data.forEach(a => points.push({
                lat: parseFloat(a[1]),
                lng: parseFloat(a[0])
            }));
            let track = {
                name: document.getElementById('addTrackFromPointsName').value,
                points: points
            }
            
            this.addTrack(track);
        };

        this.markScrolled = () => {
            this.map.removeEventListener('movestart', this.markScrolled);
            this.scrolled = true;
        };

        this.clearScroll();
        this.switchTheme(this.options.theme);
        this.requestBrowserLocation();

        if (this.options.showTimeline) {
        
            var container = document.getElementById('timeline-vis');

            this.visitems = new vis.DataSet();
            this.timeline = new vis.Timeline(container, this.visitems, {width: '100%', height: '120px', stack: false});
            
            this.timeline.on('select', (properties) => {
                this.centerTrack(this.visitems.get(properties.items[0]).track);
            });
            
            this.timeline.on('itemover', (properties) => {
                this.selectTrack(this.visitems.get(properties.item).track);
            });
            
            this.timeline.on('itemout', () => {
                this.unselectAllTracks();
            });
        }
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
                {offset: 0, repeat: 0, symbol: leaflet.Symbol.arrowHead({pixelSize: 0, pathOptions: {fillOpacity: 0, weight: 0, color: 'red'}})}
            ]
        }).addTo(this.map);
        line.addTo(this.map);
        
        track = Object.assign({line, visible: true, decorator}, track);
        
        line.on('mouseover', () => this.selectTrack(track));
        line.on('mouseout', () => this.unselectTrack(track));
        line.on('click', () => this.centerTrack(track));

        this.tracks.push(track);
        this.refreshTrackTooltip(track);
        this.addTrackToList(track);
        if (this.options.showTimeline) {
            this.addTrackToTimeline(track);
        }

        return track;
    }
    
    addTrackToList(track) {
        let trackrow = document.createElement('tr');
        
        let trackdate = document.createElement('td');
        trackdate.innerText = (track.starttime)
            ? moment(track.starttime).format('DD.MM.YYYY HH:mm:ss')
            : track.date;
        
        let trackname = document.createElement('td');
        trackname.innerText = track.name;
        
        let tracklength = document.createElement('td');
        tracklength.innerText = (leafletGeometry.length(track.line) / 1000).toFixed(1) + ' км';
        tracklength.classList.add('nowrap');
        
        let trackheight = document.createElement('td');
        trackheight.innerText = track.totalElev.toFixed(0) + ' м';
        trackheight.classList.add('nowrap');
        
        trackrow.appendChild(trackdate);
        trackrow.appendChild(trackname);
        trackrow.appendChild(tracklength);
        trackrow.appendChild(trackheight);
        
        trackrow.addEventListener('mouseover', () => this.selectTrack(track));
        trackrow.addEventListener('mouseout', () => this.unselectTrack(track));
        trackrow.addEventListener('click', () => this.centerTrack(track));
        
        document.getElementById('tracklist').getElementsByTagName('tbody')[0].appendChild(trackrow);
    }
    
    addTrackToTimeline(track) {
        let length = (leafletGeometry.length(track.line) / 1000).toFixed(1);
        let trackstart = (track.starttime) ? moment(track.starttime) : moment(track.date, 'DD.MM.YYYY');
        let trackend = (track.endtime) ? moment.utc(track.endtime) : null;
        let tooltip = '<strong>' + track.name + '</strong>';
        if (track.starttime) {tooltip += '<br>Дата: ' + moment(track.starttime).format('DD.MM.YYYY HH:mm:ss');}
        if (track.date) {tooltip += '<br>Дата: ' + track.date;}
        tooltip += '<br>Расстояние: ' + length + ' км';
        if (track.desc) {tooltip += track.desc;}
        if (track.type) {tooltip += '<br>' + track.type + (track.equipment ? ': ' + track.equipment : '');}
        if (track.totaltime) {tooltip += '<br>Длительность: ' + moment.utc(track.totaltime*1000).format('H:mm');}
        if (track.totalElev) {tooltip += '<br>Общий подъем: ' + track.totalElev.toFixed(0) + ' м';}
        
        if (trackend) {
            this.visitems.add([{content: track.name, start: trackstart, end: trackend, type: 'range', title: tooltip, track: track}]);
        } else {
            this.visitems.add([{content: track.name, start: trackstart, title: tooltip, track: track}]);
        }
    }
    
    refreshTrackTooltip(track) {
        let length = (leafletGeometry.length(track.line) / 1000).toFixed(1);
        let tooltip = '<strong>' + track.name + '</strong>';
        if (track.starttime) {tooltip += '<br>Дата: ' + moment(track.starttime).format('DD.MM.YYYY HH:mm:ss');}
        if (track.date) {tooltip += '<br>Дата: ' + track.date;}
        tooltip += '<br>Расстояние: ' + length + ' км';
        if (track.desc) {tooltip += track.desc;}
        if (track.type) {tooltip += '<br>' + track.type + (track.equipment ? ': ' + track.equipment : '');}
        if (track.totaltime) {tooltip += '<br>Длительность: ' + moment.utc(track.totaltime*1000).format('H:mm');}
        if (track.totalElev) {tooltip += '<br>Общий подъем: ' + track.totalElev.toFixed(0) + ' м';}
        if (track.trackImage) {tooltip += '<br><img style=\'max-width: 400px\' src=\'' + track.trackImage + '\'>';}
        track.line.bindTooltip(tooltip, {sticky: true, opacity:0.8});
    }
    
    selectTrack(track) {
        track.decorator.setPatterns([
            {offset: 400, repeat: 400, symbol: leaflet.Symbol.arrowHead({pixelSize: 15, pathOptions: {fillOpacity: 1, weight: 1, color: 'red'}})}
        ]);
        track.line.setStyle({
            color: 'red',
            weight: 3,
            opacity: 1.0
        });
        track.line.bringToFront();
        track.line.openTooltip();
    }
    
    unselectTrack(track) {
        track.decorator.setPatterns([
            {offset: 0, repeat: 0, symbol: leaflet.Symbol.arrowHead({pixelSize: 0, pathOptions: {fillOpacity: 0, weight: 0, color: 'red'}})}
        ]);
        track.line.setStyle(this.options.lineOptions);
        track.line.closeTooltip();
    }
    
    unselectAllTracks() {
        this.tracks.forEach(track => {
            this.unselectTrack(track);
        });
    }
    
    centerTrack(track) {
        let offset = document.querySelector('.leaflet-sidebar-content').getBoundingClientRect().width;
        this.map.fitBounds(track.line.getBounds(), {paddingTopLeft: [offset, 0]});
    }
    
    fitTimelineRange() {
        if (this.options.showTimeline) {
            this.timeline.fit();
        }
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
        document.getElementById('tracklist').getElementsByTagName('tbody')[0].innerHTML = '';
        this.tracks.forEach(track => {
            track.line.remove();
            track.decorator.remove();
        });
        this.tracks = []

        if (this.options.showTimeline) {
            this.visitems.clear();
        }
    }
}

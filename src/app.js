import '../style.css';
import '../sidebar.css';
import '../vis-timeline-graph2d.css';

import GpxMap from './map';
import {initialize, loadgpx} from './ui';


function app() {
    let map = new GpxMap();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('map')) {
        loadgpx(map, urlParams.get('map')).then(() =>map.fitTimelineRange());
    }
    initialize(map, !urlParams.get('map'));
    if (urlParams.get('theme')) {
        var theme = urlParams.get('theme');
        map.options.theme = theme;
        map.switchTheme(theme);
    }
}


// Safari (and probably some other older browsers) don't support canvas.toBlob,
// so polyfill it in.
//
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob#Polyfill
if (!HTMLCanvasElement.prototype.toBlob) {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        value (callback, type, quality) {

            let binStr = atob(this.toDataURL(type, quality).split(',')[1]);
            let len = binStr.length;
            let arr = new Uint8Array(len);

            for (var i = 0; i < len; i++ ) {
                arr[i] = binStr.charCodeAt(i);
            }

            callback(new Blob([arr], {type: type || 'image/png'}));
        }
    });
}


document.addEventListener('DOMContentLoaded', app);

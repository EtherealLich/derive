// This file is adapted from taterbase/gpx-parser
//
// https://github.com/taterbase/gpx-parser
//
// See https://www.topografix.com/gpx/1/1 for details on the schema for
// GPX files.

import xml2js from 'xml2js';
import EasyFit from 'easy-fit';
import Pako from 'pako';
import axios from 'axios'
import moment from 'moment';
import neatCsv from 'neat-csv';

const parser = new xml2js.Parser();

function extractGPXTracks(gpx) {
    if (!gpx.trk && !gpx.rte) {
        console.log('GPX file has neither tracks nor routes!', gpx);
        throw new Error('Unexpected gpx file format.');
    }

    const parsedTracks = [];

    gpx.trk && gpx.trk.forEach(trk => {
        let name = trk.name && trk.name.length > 0 ? trk.name[0] : 'untitled';
        let date;
        let matches;
        if (matches = name.match(/(\d+)\_(\d+)\_(\d+)\_(.*)/i)) {
            date = matches[3] + '.' + matches[2] + '.' + matches[1];
            name = matches[4];
        }
        
        let src = trk.src && trk.src.length > 0 ? trk.src[0] : null;
        let desc = trk.desc && trk.desc.length > 0 ? trk.desc[0] : null;
        let gpsiesUrl, trackImage;
        for (let link of trk.link || []) {
            if (link.type.includes('trackOnWeb')) {
                gpsiesUrl = link['$']['href'];
            }
            /*if (link.type.includes('trackImage')) {
                trackImage = link['$']['href'];
            }*/
            if (link.type.includes('elevationChartUrlTab')) {
                trackImage = link['$']['href'];
            }
        }
        
        let timestamp;
        let totalElev = 0;
        let starttime = null;
        let endtime = null;

        trk.trkseg.forEach(trkseg => {
            let points = [];
            for (let trkpt of trkseg.trkpt) {
                if (trkpt.time && typeof trkpt.time[0] === 'string') {
                    timestamp = moment.utc(trkpt.time[0]).toDate();
                    if (!starttime) {starttime = timestamp;}
                    endtime = timestamp;
                }
                if (typeof trkpt.$ !== 'undefined' &&
                    typeof trkpt.$.lat !== 'undefined' &&
                    typeof trkpt.$.lon !== 'undefined') {
                    let elev = parseFloat(trkpt.ele) || 0;
                    if (points.length > 0 && elev !== 0) {
                        totalElev += (elev - points[points.length - 1].elev > 0 ) ? elev - points[points.length - 1].elev : 0;
                    }
                    points.push({
                        lat: parseFloat(trkpt.$.lat),
                        lng: parseFloat(trkpt.$.lon),
                        time: timestamp,
                        elev: elev
                    });
                }
            }
            let totaltime = moment(endtime).diff(moment(starttime), 'seconds');
            parsedTracks.push({timestamp, points, name, src, desc, gpsiesUrl, trackImage, totalElev, date, starttime, endtime, totaltime});
        });
    });

    gpx.rte && gpx.rte.forEach(rte => {
        let name = rte.name && rte.name.length > 0 ? rte.name[0] : 'untitled';
        let timestamp;
        let points = [];
        for (let pt of rte.rtept) {
            if (pt.time && typeof pt.time[0] === 'string') {
                timestamp = new Date(pt.time[0]);
            }
            points.push({
                lat: parseFloat(pt.$.lat),
                lng: parseFloat(pt.$.lon),
            });
        }

        parsedTracks.push({timestamp, points, name});
    });
    
    return parsedTracks;
}

function extractTCXTracks(tcx, name) {
    if (!tcx.Activities) {
        console.log('TCX file has no activities!', tcx);
        throw new Error('Unexpected tcx file format.');
    }

    const parsedTracks = [];
    for (const act of tcx.Activities[0].Activity) {
        for (const lap of act.Lap) {
            let trackPoints = lap.Track[0].Trackpoint.filter(it => it.Position);
            let timestamp;
            let points = []

            for (let trkpt of trackPoints) {
                if (trkpt.Time && typeof trkpt.Time[0] === 'string') {
                    timestamp = new Date(trkpt.Time[0]);
                }
                points.push({
                    lat: parseFloat(trkpt.Position[0].LatitudeDegrees[0]),
                    lng: parseFloat(trkpt.Position[0].LongitudeDegrees[0]),
                    time: timestamp,
                    elev: parseFloat(trkpt.ElevationMeters[0]) || 0
                });
            }

            parsedTracks.push({timestamp, points, name});
        }
    }

    return parsedTracks;
}

function extractFITTracks(fit, name) {
    if (!fit.records || fit.records.length === 0) {
        console.log('FIT file has no records!', fit);
        throw new Error('Unexpected FIT file format.');
    }

    let timestamp;
    let totalElev = 0.0;
    let starttime = null;
    let endtime = null;
    const points = [];
    for (const record of fit.records) {
        if (record.position_lat && record.position_long) {
            let elev = record.altitude || 0;
            if (points.length > 0 && elev !== 0) {
                totalElev += (elev - points[points.length - 1].elev > 0 ) ? elev - points[points.length - 1].elev : 0;
            }
            timestamp = moment.utc(record.timestamp).toDate();
            if (!starttime) {starttime = timestamp;}
            endtime = timestamp;
            points.push({
                lat: record.position_lat,
                lng: record.position_long,
                time: new Date(timestamp),
                elev: elev
                // Other available fields: timestamp, distance, altitude, speed, heart_rate
            });
        }
    }
    let totaltime = moment(endtime).diff(moment(starttime), 'seconds');
    return [{timestamp, points, name, totalElev, starttime, endtime, totaltime}];
}


function readFile(file, encoding, isGzipped) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target.result;
            try {
                return resolve(isGzipped ? Pako.inflate(result) : result);
            } catch (e) {
                return reject(e);
            }
        };

        if (encoding === 'binary') {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    });
}

export function extractStravaCsv(file) {
    return readFile(file, 'text', false)
        .then(textContents => new Promise((resolve, reject) => {
            neatCsv(textContents)
                .then(data => resolve(data), error => reject(error))
        }));
}

export function extractTracks(file) {
    const isGzipped = /\.gz$/i.test(file.name);
    const strippedName = file.name.replace(/\.gz$/i, '');
    const format = strippedName.split('.').pop().toLowerCase();

    switch (format) {
    case 'gpx':
    case 'tcx': /* Handle XML based file formats the same way */

        return readFile(file, 'text', isGzipped)
            .then(textContents => new Promise((resolve, reject) => {
                parser.parseString(textContents, (err, result) => {
                    if (err) {
                        reject(err);
                    } else if (result.gpx) {
                        resolve(extractGPXTracks(result.gpx));
                    } else if (result.TrainingCenterDatabase) {
                        resolve(extractTCXTracks(result.TrainingCenterDatabase, strippedName));
                    } else {
                        reject(new Error('Invalid file type.'));
                    }
                });
            }));

    case 'fit':
        return readFile(file, 'binary', isGzipped)
            .then(contents => new Promise((resolve, reject) => {
                const parser = new EasyFit({
                    force: true,
                    mode: 'list',
                });

                parser.parse(contents, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(extractFITTracks(result, strippedName));
                    }
                });
            }));

    default:
        throw `Unsupported file format: ${format}`;
    }
}

export function extractTracksUrl(url) { 
    let isGzipped = /\.gz$/i.test(url);
    const strippedName = url.split('/').pop().replace(/\.gz$/i, '');

    return axios({
            method: 'get',
            url: url,
            responseType: isGzipped ? 'arraybuffer' : 'text'
            })
        .then(textContents => new Promise((resolve, reject) => {
            let data = isGzipped ? Pako.inflate(textContents.data, { to: 'string' }) : textContents.data;
            parser.parseString(data, (err, result) => {
                if (err) {
                    reject(err);
                } else if (result.gpx) {
                    resolve(extractGPXTracks(result.gpx));
                } else if (result.TrainingCenterDatabase) {
                    resolve(extractTCXTracks(result.TrainingCenterDatabase, strippedName));
                } else {
                    reject(new Error('Invalid file type.'));
                }
            });
        }));
}

function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

export function createGpx(tracks) {
    var gpx = 
`<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="pinmixperm" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
    <metadata>
        <name>Merged ${tracks.length} tracks</name>
        <desc>Merged tracks: ${tracks.map(track =>  escapeXml(track.name)).join(', ')}</desc>
        <author>
            <name>PINMIXPERM</name>
        </author>
    </metadata>`;
    tracks.forEach(track => {
        gpx += `
    <trk>
        <name>${escapeXml(track.name)}</name>
        <src>${track.filename}</src>`;
        
        let desc = '';
        if (track.type) {desc += '<br>' + track.type + (track.equipment ? ': ' + track.equipment : '');}
        if (track.totaltime) {desc += '<br>Длительность: ' + moment.utc(track.totaltime*1000).format('H:mm');}
        if (desc.length > 0) {
            gpx +=`
        <desc>${escapeXml(desc)}</desc>`;
        }
        
        gpx +=`
        <trkseg>`;
        track.points.forEach(point => {
            let formatTime = moment(point['time']).format('YYYY-MM-DDTHH:mm:ss') + 'Z';
            gpx += `
            <trkpt lat="${point['lat']}" lon="${point['lng']}">
                <time>${formatTime}</time>
            </trkpt>`;
        });
        gpx += `
        </trkseg>
    </trk>`;
    });
    
    gpx += `
</gpx>`;
    
    return gpx;
}
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWithAnnotations = exports.render = exports.dumpLayout = exports.parseClassRegistry = void 0;
var ELK = require("elkjs");
var onml = require("onml");
var FlatModule_1 = require("./FlatModule");
var Skin_1 = require("./Skin");
var elkGraph_1 = require("./elkGraph");
var drawModule_1 = require("./drawModule");
var annotations_1 = require("./annotations");
// Parse a classes.txt registry (one class name per line, index = class id).
function parseClassRegistry(classesData) {
    return classesData.split('\n')
        .map(function (l) { return l.trim(); })
        .filter(function (l) { return l.length > 0; });
}
exports.parseClassRegistry = parseClassRegistry;
var elk = new ELK();
function createFlatModule(skinData, yosysNetlist) {
    Skin_1.default.skin = onml.p(skinData);
    var layoutProps = Skin_1.default.getProperties();
    var flatModule = new FlatModule_1.FlatModule(yosysNetlist);
    // this can be skipped if there are no 0's or 1's
    if (layoutProps.constants !== false) {
        flatModule.addConstants();
    }
    // this can be skipped if there are no splits or joins
    if (layoutProps.splitsAndJoins !== false) {
        flatModule.addSplitsJoins();
    }
    flatModule.createWires();
    return flatModule;
}
function dumpLayout(skinData, yosysNetlist, prelayout, done) {
    var flatModule = createFlatModule(skinData, yosysNetlist);
    var kgraph = elkGraph_1.buildElkGraph(flatModule);
    if (prelayout) {
        done(null, JSON.stringify(kgraph, null, 2));
        return;
    }
    var layoutProps = Skin_1.default.getProperties();
    var promise = elk.layout(kgraph, { layoutOptions: layoutProps.layoutEngine });
    promise.then(function (graph) {
        done(null, JSON.stringify(graph, null, 2));
    }).catch(function (reason) {
        throw Error(reason);
    });
}
exports.dumpLayout = dumpLayout;
function render(skinData, yosysNetlist, done, elkData) {
    var flatModule = createFlatModule(skinData, yosysNetlist);
    var kgraph = elkGraph_1.buildElkGraph(flatModule);
    var layoutProps = Skin_1.default.getProperties();
    var promise;
    // if we already have a layout then use it
    if (elkData) {
        promise = new Promise(function (resolve) {
            drawModule_1.default(elkData, flatModule);
            resolve();
        });
    }
    else {
        // otherwise use ELK to generate the layout
        promise = elk.layout(kgraph, { layoutOptions: layoutProps.layoutEngine })
            .then(function (g) { return drawModule_1.default(g, flatModule); })
            // tslint:disable-next-line:no-console
            .catch(function (e) { console.error(e); });
    }
    // support legacy callback style
    if (typeof done === 'function') {
        promise.then(function (output) {
            done(null, output);
            return output;
        }).catch(function (reason) {
            throw Error(reason);
        });
    }
    return promise;
}
exports.render = render;
/**
 * Like render(), but also returns structured annotations (components with
 * nested labels and exact pin points) computed from the laid-out ELK graph.
 *
 * outputFormat: 'svg' (default) | 'png' | 'jpeg'. For raster formats the
 * SVG render is rasterized to bytes via resvg.
 *
 * Coordinate contract: annotations are in the OUTPUT image's coordinate
 * space — SVG user units for 'svg', pixels for 'png'/'jpeg' (i.e. geometry
 * multiplied by rasterOptions.scale). Normalized (*Norm) fields are
 * resolution-independent and identical in both spaces.
 *
 * classesData (optional): content of the dataset's classes.txt registry;
 * when given, component classes must resolve against it or render throws.
 */
function renderWithAnnotations(skinData, yosysNetlist, outputFormat, rasterOptions, elkData, imageName, classesData) {
    var flatModule = createFlatModule(skinData, yosysNetlist);
    var kgraph = elkGraph_1.buildElkGraph(flatModule);
    var layoutProps = Skin_1.default.getProperties();
    var scale = outputFormat === 'svg' ? 1 :
        (rasterOptions && rasterOptions.scale !== undefined ? rasterOptions.scale : 1);
    var draw = function (g) {
        var svg = drawModule_1.default(g, flatModule);
        var result = {
            image: { format: outputFormat },
            annotations: undefined,
        };
        if (outputFormat === 'svg') {
            result.image.svg = svg;
        }
        else {
            var Resvg = require('@resvg/resvg-js').Resvg;
            var resvg = new Resvg(svg, {
                fitTo: {
                    mode: 'zoom',
                    value: scale,
                },
                background: (rasterOptions && rasterOptions.background) || 'white',
            });
            var pngBuffer = resvg.render().asPng();
            result.image.width = resvg.width;
            result.image.height = resvg.height;
            if (outputFormat === 'jpeg') {
                var jpeg = require('jpeg-js');
                var raw = require('pngjs').PNG.sync.read(pngBuffer);
                result.image.bytes = Buffer.from(jpeg.encode(raw, (rasterOptions && rasterOptions.quality) || 90).data);
            }
            else {
                result.image.bytes = pngBuffer;
            }
        }
        result.annotations = annotations_1.buildAnnotations(g, flatModule, imageName || '', classesData !== undefined ? parseClassRegistry(classesData) : undefined, scale);
        return result;
    };
    if (elkData) {
        return Promise.resolve(draw(elkData));
    }
    return elk.layout(kgraph, { layoutOptions: layoutProps.layoutEngine })
        .then(draw);
}
exports.renderWithAnnotations = renderWithAnnotations;

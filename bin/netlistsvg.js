#!/usr/bin/env node
'use strict';

var lib = require('../built'),
    fs = require('fs'),
    path = require('path'),
    json5 = require('json5'),
    yargs = require('yargs'),
    Ajv = require('ajv'),
    overlay = require('./overlay');

var ajv = new Ajv({allErrors: true});
require('ajv-errors')(ajv);

if (require.main === module) {
    var argv = yargs
        .demand(1)
        .usage('usage: $0 input_json_file -o output_file [--format svg|png|jpg] [--skin skin_file] [--layout elk_json_file] [--annotation annotation_json_file] [--scale N]')
        .describe('annotation', 'write the structured annotation JSON (components with nested labels/pins) to this file')
        .describe('classes', 'read the class registry (component class names, one per line) from this file; embedded in the annotation JSON and validated against the rendered components')
        .describe('format', 'output format: svg | png | jpg. Overrides the -o extension; the file is written with the matching extension. Annotations are emitted in OUTPUT coordinates (SVG units for svg, pixels for png/jpg).')
        .describe('scale', 'raster scale for png/jpg output: pixels = SVG units * scale (default 1). Annotations follow the output space.')
        .describe('quality', 'jpeg quality 0-100 (default 90)')
        .describe('debug-overlay', '[path] when raster output is requested, write an overlay PNG (annotation boxes drawn on the render). With a value: exact output path. Without: <output>_debug.png. Debug aid.')
        .example('$0 in.json -o out.svg --annotation out.json', 'SVG render + annotations in SVG units')
        .example('$0 in.json -o out.png --format png --scale 2 --annotation out.json', 'PNG at 2x + annotations in pixel coords')
        .argv;
    main(argv._[0], argv.o, argv.skin, argv.layout, argv.annotation, argv.scale, argv.quality, argv.classes, argv.format, argv.debugOverlay);
}

function render(skinData, netlist, outputPath, elkData) {
    lib.render(skinData, netlist, (err, svgData) => {
        if (err) throw err;
        fs.writeFile(outputPath, svgData, 'utf-8', (err) => {
            if (err) throw err;
        });
    }, elkData);
}

function parseFiles(skinPath, netlistPath, elkJsonPath, callback) {
    fs.readFile(skinPath, 'utf-8', (err, skinData) => {
        if (err) throw err;
        fs.readFile(netlistPath, (err, netlistData) => {
            if (err) throw err;
            if (elkJsonPath) {
                fs.readFile(elkJsonPath, (err, elkString) => {
                    callback(skinData, netlistData, json5.parse(elkString));
                });
            } else {
                callback(skinData, netlistData);
            }
        });
    });
}

function main(netlistPath, outputPath, skinPath, elkJsonPath, annotationPath, scale, quality, classesPath, format, debugOverlayArg) {
    skinPath = skinPath || path.join(__dirname, '../lib/default.svg');
    outputPath = outputPath || 'out.svg';
    var schemaPath = path.join(__dirname, '../lib/yosys.schema.json5');
    // output format: --format wins, otherwise infer from the -o extension
    var ext = path.extname(outputPath).toLowerCase();
    var outputFormat = format || (ext === '.png' ? 'png'
        : (ext === '.jpg' || ext === '.jpeg') ? 'jpeg'
        : ext === '.svg' ? 'svg' : null);
    if (outputFormat === null) {
        throw Error('unsupported output extension "' + ext + '" (use .svg, .png or .jpg, or pass --format)');
    }
    if (outputFormat === 'jpg') {
        outputFormat = 'jpeg';
    }
    // when --format overrides the extension, correct the output path so the
    // bytes land in a file named after their actual format
    var expectedExt = outputFormat === 'jpeg' ? '.jpg' : '.' + outputFormat;
    if (ext !== expectedExt) {
        outputPath = outputPath.replace(/\.[^.]*$/, '') + expectedExt;
    }
    // load the authoritative class registry (written by build_skin) when given
    var classesData = classesPath ? fs.readFileSync(classesPath, 'utf-8') : undefined;
    if (debugOverlayArg && outputFormat === 'svg') {
        console.error('--debug-overlay ignored: overlay requires raster output (use --format png/jpg).');
    }
    parseFiles(skinPath, netlistPath, elkJsonPath, (skinData, netlistString, elkData) => {
        var netlistJson = json5.parse(netlistString);
        var valid = ajv.validate(json5.parse(fs.readFileSync(schemaPath)), netlistJson);
        if (!valid) {
            throw Error(JSON.stringify(ajv.errors, null, 2));
        }
        if (annotationPath || outputFormat !== 'svg') {
            lib.renderWithAnnotations(skinData, netlistJson, outputFormat,
                { scale: scale, quality: quality },
                elkData, path.basename(outputPath), classesData).then((result) => {
                if (annotationPath) {
                    fs.writeFileSync(annotationPath, JSON.stringify(result.annotations, null, 2), 'utf-8');
                }
                if (outputFormat === 'svg') {
                    fs.writeFileSync(outputPath, result.image.svg, 'utf-8');
                } else {
                    fs.writeFileSync(outputPath, result.image.bytes);
                    // debug aid: blend the annotation geometry over the render
                    if (debugOverlayArg) {
                        var debugPath = typeof debugOverlayArg === 'string'
                            ? debugOverlayArg
                            : outputPath.replace(/\.[^.]*$/, '') + '_debug.png';
                        var debugBytes = overlay.drawAnnotationOverlay(result.image.bytes, result.annotations);
                        fs.writeFileSync(debugPath, debugBytes);
                    }
                }
            }).catch((e) => { throw e; });
        } else {
            render(skinData, netlistJson, outputPath, elkData);
        }
    });
}

module.exports.main = main;

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAnnotations = exports.buildClassRegistry = void 0;
var onml = require("onml");
var _ = require("lodash");
var Skin_1 = require("./Skin");
/**
 * Build the class registry from the current skin (Skin.skin must be set).
 *
 * - component classes: the `s:class` attribute of each skin template (set by
 *   build_skin.py from the component spec's `annotation_class`); multiple
 *   skins may share one class (e.g. horizontal/vertical variants). Falls
 *   back to `s:type` for templates without `s:class`.
 * - label classes: one per text `s:attribute` in the skin, named
 *   `label_<attribute>` (e.g. label_ref, label_value)
 */
function buildClassRegistry() {
    var names = {};
    onml.traverse(Skin_1.default.skin, {
        enter: function (node) {
            var attr = node.attr || {};
            if (node.name === 'g' && attr['s:class']) {
                names[String(attr['s:class'])] = true;
            }
            else if (node.name === 'g' && attr['s:type']) {
                // legacy fallback: no s:class -> use the skin type
                names[String(attr['s:type'])] = true;
            }
            if (node.name === 'text' && attr['s:attribute']) {
                names['label_' + attr['s:attribute']] = true;
            }
        },
    });
    return Object.keys(names).sort();
}
exports.buildClassRegistry = buildClassRegistry;
/**
 * Build the structured annotation (components with nested labels and pins)
 * for a laid-out graph.
 *
 * classes (optional) is the authoritative registry from the dataset's
 * classes.txt. When given, every component class must resolve against it.
 * When omitted, the registry is derived from the skin
 * (s:class values + label_* attributes).
 *
 * scale: pixels per SVG user unit of the OUTPUT image (1 for svg output).
 * All non-normalized geometry is emitted in OUTPUT coordinates — SVG units
 * for svg output, pixels for png/jpeg — so annotations match the produced
 * image directly.
 */
function buildAnnotations(g, module, image, classes, scale) {
    if (scale === void 0) { scale = 1; }
    var registry = classes !== undefined ? classes : buildClassRegistry();
    var known = new Set(registry);
    var unitW = Number(g.width);
    var unitH = Number(g.height);
    var imgW = unitW * scale;
    var imgH = unitH * scale;
    var templateByKey = {};
    module.nodes.forEach(function (n) {
        templateByKey[n.Key] = n.getTemplate();
    });
    var components = [];
    _.forEach(g.children, function (child) {
        // layout dummy nodes ($d_N) are fan-in/out helpers, never drawn
        if (typeof child.id === 'string' && child.id.indexOf('$d_') === 0) {
            return;
        }
        if (!(child.width > 0 && child.height > 0)) {
            return;
        }
        var template = templateByKey[child.id];
        var className = String((template && template[1]['s:class']) ||
            (template && template[1]['s:type']) ||
            child.id);
        if (classes !== undefined && !known.has(className)) {
            throw Error('component class "' + className + '" not found in the classes registry');
        }
        var labels = _.map(child.labels, function (label) {
            var parts = String(label.id).split('.');
            var attr = parts[parts.length - 1] === 'label'
                ? 'label' : parts[parts.length - 1];
            return {
                attr: attr,
                text: String(label.text),
                bbox: {
                    x: (child.x + label.x) * scale, y: (child.y + label.y) * scale,
                    w: label.width * scale, h: label.height * scale,
                },
                bboxNorm: {
                    x: (child.x + label.x) / unitW, y: (child.y + label.y) / unitH,
                    w: label.width / unitW, h: label.height / unitH,
                },
            };
        });
        var pins = _.map(child.ports, function (port) {
            var _a, _b;
            var pid = String(port.id).split('.').pop();
            var px = (child.x + port.x) * scale;
            var py = (child.y + port.y) * scale;
            // Pin text (generic cells draw their port names). ELK weirdly repositions
            // port labels during layout while the renderer draws from the
            // template, so the ground truth is the skin template, recompute the label positions.
            var text = undefined;
            var textBbox = undefined;
            var template = templateByKey[child.id];
            if (template && template[1]['s:type'] === 'generic' && port.labels && port.labels[0]) {
                var label = port.labels[0];
                // exemplar port group on the same side of the body as this port
                var isRight = port.x >= child.width / 2;
                var exemplar = (isRight ? Skin_1.default.getPortsWithPrefix(template, 'out')
                    : Skin_1.default.getPortsWithPrefix(template, 'in'))[0];
                var textNode = exemplar[2][1];
                var textW = label.width; // charW * text.length (from Port.ts)
                var textH = Skin_1.default.getFontCharHeight();
                var textAnchor = (_a = textNode['text-anchor']) !== null && _a !== void 0 ? _a : 'start';
                var dominantBaseline = (_b = textNode['dominant-baseline']) !== null && _b !== void 0 ? _b : 'auto';
                // anchor-aware box left edge, relative to the port position
                var boxLeft = Number(textNode.x);
                if (textAnchor === 'end') {
                    boxLeft -= textW;
                }
                else if (textAnchor === 'middle') {
                    boxLeft -= textW / 2;
                }
                // alignment point y -> box top, per dominant-baseline. Same
                // mapping as Cell.svgTextToElkBox: baseline-anchored boxes
                // shift down by a descender allowance (height * descShift)
                // so tails (y/g/j/p/q) stay inside the box.
                var DESC_SHIFT = textH * Skin_1.default.getFontDescShift();
                var boxTop = Number(textNode.y);
                if (dominantBaseline === 'middle' || dominantBaseline === 'central') {
                    boxTop -= textH / 2;
                }
                else if (dominantBaseline === 'hanging') {
                    boxTop += 0; // ink descends from the point
                }
                else {
                    boxTop -= textH - DESC_SHIFT; // baseline/alphabetic/auto
                }
                text = String(label.text);
                textBbox = {
                    x: (child.x + port.x + boxLeft) * scale,
                    y: (child.y + port.y + boxTop) * scale,
                    w: textW * scale,
                    h: textH * scale,
                };
            }
            return {
                pid: String(pid),
                x: px, y: py,
                xNorm: (child.x + port.x) / unitW, yNorm: (child.y + port.y) / unitH,
                text: text,
                textBbox: textBbox,
            };
        });
        components.push({
            key: String(child.id),
            class: className,
            bbox: {
                x: child.x * scale, y: child.y * scale,
                w: child.width * scale, h: child.height * scale,
            },
            bboxNorm: {
                x: child.x / unitW, y: child.y / unitH,
                w: child.width / unitW, h: child.height / unitH,
            },
            labels: labels,
            pins: pins,
        });
    });
    return {
        image: image,
        canvas: { width: imgW, height: imgH },
        classes: registry,
        components: components,
    };
}
exports.buildAnnotations = buildAnnotations;

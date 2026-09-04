import onml = require('onml');
import _ = require('lodash');
import { ElkModel } from './elkGraph';
import { FlatModule } from './FlatModule';
import Skin from './Skin';

/**
 * annotation export.
 *
 * Produces a per-render annotation JSON describing every rendered object
 * with its exact geometry:
 *   - components: bbox + class (skin `s:class`, i.e. annotation_class)
 *   - labels:     text, attribute (ref/value) and bbox, owned by their
 *     component
 *   - pins: exact points owned by their component (pid + xy). The
 *     component->pins hierarchy that flat detection formats cannot express
 *     lives here; no synthetic pin boxes / pin_* classes are emitted.
 *
 * All geometry is in output file extension coordinates: 
 * SVG user units for svg output, pixels for png/jpeg output 
 * (pixels = SVG units × scale). The canvas is
 * the output size. Normalized [0, 1] equivalents (*Norm) are
 * resolution-independent and identical in both spaces.
 */

export interface PinAnnotation {
    /** Pin id from the skin (s:pid), e.g. "+", "-", "b". */
    pid: string;
    x: number;
    y: number;
    /** Same point normalized to the canvas*/
    xNorm: number;
    yNorm: number;    /** Optional pin name text (generic cells draw their port names). */
    text?: string;
    /** Bbox of the pin name text, in output coordinates. */
    textBbox?: { x: number; y: number; w: number; h: number };}

export interface LabelAnnotation {
    /** Which text slot the label fills (s:attribute), e.g. ref / value. */
    attr: string;
    text: string;
    bbox: { x: number; y: number; w: number; h: number };
    bboxNorm: { x: number; y: number; w: number; h: number };
}

export interface ComponentAnnotation {
    /** The component instance name (e.g. "R1"). */
    key: string;
    /** Annotation class (skin s:class / annotation_class). */
    class: string;
    bbox: { x: number; y: number; w: number; h: number };
    bboxNorm: { x: number; y: number; w: number; h: number };
    labels: LabelAnnotation[];
    /** Pins belong to this component; exact points */
    pins: PinAnnotation[];
}

export interface AnnotationData {
    image: string;
    canvas: { width: number; height: number };
    /** Class registry in use (sorted class names; ids are indices). */
    classes: string[];
    components: ComponentAnnotation[];
}

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
export function buildClassRegistry(): string[] {
    const names: { [name: string]: boolean } = {};
    onml.traverse(Skin.skin, {
        enter: (node) => {
            const attr = node.attr || {};
            if (node.name === 'g' && attr['s:class']) {
                names[String(attr['s:class'])] = true;
            } else if (node.name === 'g' && attr['s:type']) {
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
export function buildAnnotations(g: ElkModel.Graph, module: FlatModule, image: string, classes?: string[], scale: number = 1): AnnotationData {
    const registry = classes !== undefined ? classes : buildClassRegistry();
    const known = new Set(registry);
    const unitW = Number(g.width);
    const unitH = Number(g.height);
    const imgW = unitW * scale;
    const imgH = unitH * scale;

    const templateByKey: { [key: string]: any[] } = {};
    module.nodes.forEach((n) => {
        templateByKey[n.Key] = n.getTemplate();
    });

    const components: ComponentAnnotation[] = [];

    _.forEach(g.children, (child) => {
        // layout dummy nodes ($d_N) are fan-in/out helpers, never drawn
        if (typeof child.id === 'string' && child.id.indexOf('$d_') === 0) {
            return;
        }
        if (!(child.width > 0 && child.height > 0)) {
            return;
        }
        const template = templateByKey[child.id];
        const className = String(
            (template && template[1]['s:class']) ||
            (template && template[1]['s:type']) ||
            child.id);
        if (classes !== undefined && !known.has(className)) {
            throw Error('component class "' + className + '" not found in the classes registry');
        }

        const labels: LabelAnnotation[] = _.map(child.labels, (label) => {
            const parts = String(label.id).split('.');
            const attr = parts[parts.length - 1] === 'label'
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

        const pins: PinAnnotation[] = _.map(child.ports, (port) => {
            const pid = String(port.id).split('.').pop();
            const px = (child.x + port.x) * scale;
            const py = (child.y + port.y) * scale;
            // Pin text (generic cells draw their port names). ELK weirdly repositions
            // port labels during layout while the renderer draws from the
            // template, so the ground truth is the skin template, recompute the label positions.
            let text: string | undefined = undefined;
            let textBbox: { x: number; y: number; w: number; h: number } | undefined = undefined;
            const template = templateByKey[child.id];
            if (template && template[1]['s:type'] === 'generic' && port.labels && port.labels[0]) {
                const label = port.labels[0];
                // exemplar port group on the same side of the body as this port
                const isRight = port.x >= child.width / 2;
                const exemplar = (isRight ? Skin.getPortsWithPrefix(template, 'out')
                                          : Skin.getPortsWithPrefix(template, 'in'))[0];
                const textNode = exemplar[2][1];
                const textW = label.width;   // charW * text.length (from Port.ts)
                const textH = Skin.getFontCharHeight();
                const textAnchor = textNode['text-anchor'] ?? 'start';
                const dominantBaseline = textNode['dominant-baseline'] ?? 'auto';
                // anchor-aware box left edge, relative to the port position
                let boxLeft = Number(textNode.x);
                if (textAnchor === 'end') {
                    boxLeft -= textW;
                } else if (textAnchor === 'middle') {
                    boxLeft -= textW / 2;
                }
                // alignment point y -> box top, per dominant-baseline. Same
                // mapping as Cell.svgTextToElkBox: baseline-anchored boxes
                // shift down by a descender allowance (height * descShift)
                // so tails (y/g/j/p/q) stay inside the box.
                const DESC_SHIFT = textH * Skin.getFontDescShift();
                let boxTop = Number(textNode.y);
                if (dominantBaseline === 'middle' || dominantBaseline === 'central') {
                    boxTop -= textH / 2;
                } else if (dominantBaseline === 'hanging') {
                    boxTop += 0; // ink descends from the point
                } else {
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

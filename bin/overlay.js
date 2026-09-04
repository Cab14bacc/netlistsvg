#!/usr/bin/env node
'use strict';

/**
 * Annotation debug overlay.
 *
 * Blends the structured annotation JSON back onto the rendered image as
 * translucent, color-coded boxes and pin dots, for visual verification that
 * annotations align with the render:
 *   - blue   boxes: component bboxes
 *   - orange boxes: ref labels
 *   - purple boxes: value labels
 *   - pink   dots:  pin connection points
 *   - pink   boxes: pin name text (generic cells)
 *
 * Works on any rasterized render (png/jpg). The scale is derived from the
 * image size vs the annotation canvas, so it matches any --scale.
 *
 * Usage:
 *   node overlay.js <render.png> <annotation.json> <out.png>
 * Standalone class-registry dump:
 *   node overlay.js --classes <out.classes> --skin <skin.svg>
 */
'use strict';

const fs = require('fs');
const { PNG } = require('pngjs');

function blendRect(img, x0, y0, w, h, rgb, alpha) {
    const X0 = Math.max(0, Math.round(x0)), Y0 = Math.max(0, Math.round(y0));
    const X1 = Math.min(img.width, Math.round(x0 + w)), Y1 = Math.min(img.height, Math.round(y0 + h));
    for (let y = Y0; y < Y1; y++) {
        for (let x = X0; x < X1; x++) {
            const idx = (y * img.width + x) * 4;
            const isEdge = x === X0 || x === X1 - 1 || y === Y0 || y === Y1 - 1;
            const a = isEdge ? Math.min(1, alpha * 3) : alpha;
            for (let c = 0; c < 3; c++) {
                img.data[idx + c] = Math.round(img.data[idx + c] * (1 - a) + rgb[c] * a);
            }
        }
    }
}

function blendDot(img, cx, cy, r, rgb) {
    for (let y = -r; y <= r; y++) {
        for (let x = -r; x <= r; x++) {
            if (x * x + y * y > r * r) continue;
            const px = Math.round(cx + x), py = Math.round(cy + y);
            if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
            const idx = (py * img.width + px) * 4;
            img.data[idx] = rgb[0]; img.data[idx + 1] = rgb[1]; img.data[idx + 2] = rgb[2];
        }
    }
}

/**
 * Draw annotation boxes/dots onto a rendered image buffer.
 * @param {Buffer} imageBytes PNG bytes of the rendered image
 * @param {object} annotations parsed annotation JSON (canvas + components)
 * @returns {Buffer} new PNG bytes with the overlay blended in
 */
function drawAnnotationOverlay(imageBytes, annotations) {
    const img = PNG.sync.read(imageBytes);
    const s = img.width / annotations.canvas.width;

    const COMPONENT = [33, 150, 243];   // blue
    const LABEL_REF = [255, 152, 0];    // orange
    const LABEL_VALUE = [156, 39, 176]; // purple
    const PIN = [233, 30, 99];          // pink

    for (const c of annotations.components) {
        blendRect(img, c.bbox.x * s, c.bbox.y * s, c.bbox.w * s, c.bbox.h * s, COMPONENT, 0.12);
        for (const l of c.labels) {
            const col = l.attr === 'ref' ? LABEL_REF : LABEL_VALUE;
            blendRect(img, l.bbox.x * s, l.bbox.y * s, l.bbox.w * s, l.bbox.h * s, col, 0.12);
        }
        for (const p of c.pins) {
            blendDot(img, p.x * s, p.y * s, 3, PIN);
            if (p.text && p.textBbox) {
                blendRect(img, p.textBbox.x * s, p.textBbox.y * s,
                    p.textBbox.w * s, p.textBbox.h * s, PIN, 0.10);
            }
        }
    }
    return PNG.sync.write(img);
}

module.exports.drawAnnotationOverlay = drawAnnotationOverlay;

if (require.main === module) {
    const [renderPath, annPath, outPath] = process.argv.slice(2);
    if (!renderPath || !annPath || !outPath) {
        console.error('usage: node overlay.js <render.png> <annotation.json> <out.png>');
        process.exit(1);
    }
    const annotations = JSON.parse(fs.readFileSync(annPath, 'utf8'));
    const out = drawAnnotationOverlay(fs.readFileSync(renderPath), annotations);
    fs.writeFileSync(outPath, out);
    console.log(`overlay: ${annotations.components.length} components -> ${outPath}`);
}

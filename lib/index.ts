'use strict';

import ELK = require('elkjs');
import onml = require('onml');

import { FlatModule } from './FlatModule';
import Yosys from './YosysModel';
import Skin from './Skin';
import { ElkModel, buildElkGraph } from './elkGraph';
import drawModule from './drawModule';
import { buildAnnotations, AnnotationData } from './annotations';

export { AnnotationData } from './annotations';

export interface RenderWithAnnotationsResult {
    /** The rendered image: SVG text, or PNG/JPEG bytes. */
    image: {
        format: 'svg' | 'png' | 'jpeg';
        /** SVG text when format === 'svg'. */
        svg?: string;
        /** Image bytes when format is 'png' or 'jpeg'. */
        bytes?: Buffer;
        /** Pixel size for raster formats. */
        width?: number;
        height?: number;
    };
    /** Structured annotation: components with nested labels and pins. */
    annotations: AnnotationData;
}

// Parse a classes.txt registry (one class name per line, index = class id).
export function parseClassRegistry(classesData: string): string[] {
    return classesData.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
}

export interface RasterOptions {
    /** 'png' (default) or 'jpeg'. */
    format?: 'png' | 'jpeg';
    /** Raster scale: output pixels = SVG user units * scale (default 1). */
    scale?: number;
    /** JPEG quality 0-100 (default 90, ignored for png). */
    quality?: number;
    /** Background color (default white; transparent not supported for jpeg). */
    background?: string;
}

const elk = new ELK();

type ICallback = (error: Error, result?: string) => void;

function createFlatModule(skinData: string, yosysNetlist: Yosys.Netlist): FlatModule {
    Skin.skin = onml.p(skinData);
    const layoutProps = Skin.getProperties();
    const flatModule = new FlatModule(yosysNetlist);
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

export function dumpLayout(skinData: string, yosysNetlist: Yosys.Netlist, prelayout: boolean, done: ICallback) {
    const flatModule = createFlatModule(skinData, yosysNetlist);
    const kgraph: ElkModel.Graph = buildElkGraph(flatModule);
    if (prelayout) {
        done(null, JSON.stringify(kgraph, null, 2));
        return;
    }
    const layoutProps = Skin.getProperties();
    const promise = elk.layout(kgraph, { layoutOptions: layoutProps.layoutEngine });
    promise.then((graph: ElkModel.Graph) => {
        done(null, JSON.stringify(graph, null, 2));
    }).catch((reason) => {
        throw Error(reason);
    });
}

export function render(skinData: string, yosysNetlist: Yosys.Netlist, done?: ICallback, elkData?: ElkModel.Graph) {
    const flatModule = createFlatModule(skinData, yosysNetlist);
    const kgraph: ElkModel.Graph = buildElkGraph(flatModule);
    const layoutProps = Skin.getProperties();

    let promise;
    // if we already have a layout then use it
    if (elkData) {
        promise = new Promise<void>((resolve) => {
            drawModule(elkData, flatModule);
            resolve();
        });
    } else {
        // otherwise use ELK to generate the layout
        promise = elk.layout(kgraph, { layoutOptions: layoutProps.layoutEngine })
            .then((g) => drawModule(g, flatModule))
            // tslint:disable-next-line:no-console
            .catch((e) => { console.error(e); });
    }

    // support legacy callback style
    if (typeof done === 'function') {
        promise.then((output: string) => {
            done(null, output);
            return output;
        }).catch((reason) => {
            throw Error(reason);
        });
    }
    return promise;
}

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
export function renderWithAnnotations(skinData: string, yosysNetlist: Yosys.Netlist, outputFormat: 'svg' | 'png' | 'jpeg', rasterOptions?: RasterOptions, elkData?: ElkModel.Graph, imageName?: string, classesData?: string): Promise<RenderWithAnnotationsResult> {
    const flatModule = createFlatModule(skinData, yosysNetlist);
    const kgraph: ElkModel.Graph = buildElkGraph(flatModule);
    const layoutProps = Skin.getProperties();
    const scale = outputFormat === 'svg' ? 1 :
        (rasterOptions && rasterOptions.scale !== undefined ? rasterOptions.scale : 1);

    const draw = (g: ElkModel.Graph): RenderWithAnnotationsResult => {
        const svg = drawModule(g, flatModule);
        const result: RenderWithAnnotationsResult = {
            image: { format: outputFormat },
            annotations: undefined as any,
        };
        if (outputFormat === 'svg') {
            result.image.svg = svg;
        } else {
            const { Resvg } = require('@resvg/resvg-js');
            const resvg = new Resvg(svg, {
                fitTo: {
                    mode: 'zoom',
                    value: scale,
                },
                background: (rasterOptions && rasterOptions.background) || 'white',
            });
            const pngBuffer: Buffer = resvg.render().asPng();
            result.image.width = resvg.width;
            result.image.height = resvg.height;
            if (outputFormat === 'jpeg') {
                const jpeg = require('jpeg-js');
                const raw = require('pngjs').PNG.sync.read(pngBuffer);
                result.image.bytes = Buffer.from(
                    jpeg.encode(raw, (rasterOptions && rasterOptions.quality) || 90).data);
            } else {
                result.image.bytes = pngBuffer;
            }
        }
        result.annotations = buildAnnotations(g, flatModule, imageName || '',
            classesData !== undefined ? parseClassRegistry(classesData) : undefined,
            scale);
        return result;
    };

    if (elkData) {
        return Promise.resolve(draw(elkData));
    }
    return elk.layout(kgraph, { layoutOptions: layoutProps.layoutEngine })
        .then(draw);
}

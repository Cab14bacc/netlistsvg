import { SigsByConstName, NameToPorts, addToDefaultDict } from './FlatModule';
import Yosys from './YosysModel';
import Skin from './Skin';
import {Port} from './Port';
import _ = require('lodash');
import { ElkModel } from './elkGraph';
import clone = require('clone');
import onml = require('onml');

export default class Cell {
    /**
     * creates a Cell from a Yosys Port
     * @param yPort the Yosys Port with our port data
     * @param name the name of the port
     */
    public static fromPort(yPort: Yosys.ExtPort, name: string): Cell {
        const isInput: boolean = yPort.direction === Yosys.Direction.Input;
        if (isInput) {
            return new Cell(name, '$_inputExt_', [], [new Port('Y', yPort.bits)], {});
        }
        return new Cell(name, '$_outputExt_', [new Port('A', yPort.bits)], [], {});
    }

    public static fromYosysCell(yCell: Yosys.Cell, name: string) {
        this.setAlternateCellType(yCell);
        const template = Skin.findSkinType(yCell.type);
        const templateInputPids = Skin.getInputPids(template);
        const templateOutputPids = Skin.getOutputPids(template);
        const ports: Port[] = _.map(yCell.connections, (conn, portName) => {
            return new Port(portName, conn);
        });
        let inputPorts = ports.filter((port) => port.keyIn(templateInputPids));
        let outputPorts = ports.filter((port) => port.keyIn(templateOutputPids));
        // this triggers when there is a lateral port, 
        // or when the skin template doesn't match the yosys cell type (shouldn't happen)
        if (inputPorts.length + outputPorts.length !== ports.length) {
            const inputPids: string[] = Yosys.getInputPortPids(yCell);
            const outputPids: string[] = Yosys.getOutputPortPids(yCell);
            inputPorts = ports.filter((port) => port.keyIn(inputPids));
            outputPorts = ports.filter((port) => port.keyIn(outputPids));
        }
        return new Cell(name, yCell.type, inputPorts, outputPorts, yCell.attributes);
    }

    public static fromConstantInfo(name: string, constants: number[]): Cell {
        return new Cell(name, '$_constant_', [], [new Port('Y', constants)], {});
    }

    /**
     * creates a join cell
     * @param target string name of net (starts and ends with and delimited by commas)
     * @param sources list of index strings (one number, or two numbers separated by a colon)
     */
    public static fromJoinInfo(target: string, sources: string[]): Cell {
        const signalStrs: string[] = target.slice(1, -1).split(',');
        const signals: number[] = signalStrs.map((ss) =>  Number(ss));
        const joinOutPorts: Port[] = [new Port('Y', signals)];
        const inPorts: Port[] = sources.map((name) => {
            return new Port(name, getBits(signals, name));
        });
        return new Cell('$join$' + target, '$_join_', inPorts, joinOutPorts, {});
    }

    /**
     * creates a split cell
     * @param source string name of net (starts and ends with and delimited by commas)
     * @param targets list of index strings (one number, or two numbers separated by a colon)
     */
    public static fromSplitInfo(source: string, targets: string[]): Cell {
        // turn string into array of signal names
        const sigStrs: string[] = source.slice(1, -1).split(',');
        // convert the signals into actual numbers
        // after running constant pass, all signals should be numbers
        const signals: Yosys.Signals = sigStrs.map((s) => Number(s));
        const inPorts: Port[] = [new Port('A', signals)];
        const splitOutPorts: Port[] = targets.map((name) => {
            const sigs: Yosys.Signals = getBits(signals, name);
            return new Port(name, sigs);
        });
        return new Cell('$split$' + source, '$_split_', inPorts, splitOutPorts, {});
    }

    // Set cells to alternate types/tags based on their parameters
    private static setAlternateCellType(yCell: Yosys.Cell) {
        if ('parameters' in yCell) {
            // if it has a WIDTH parameter greater than one
            // and doesn't have an address parameter (not a memory cell)
            if ('WIDTH' in yCell.parameters &&
                yCell.parameters.WIDTH > 1 &&
                !('ADDR' in yCell.parameters)) {
                // turn into a bus version
                yCell.type = yCell.type + '-bus';
            }
        }
    }

    protected key: string;
    protected type: string;
    protected inputPorts: Port[];
    protected outputPorts: Port[];
    protected attributes: Yosys.CellAttributes;

    constructor(key: string,
                type: string,
                inputPorts: Port[],
                outputPorts: Port[],
                attributes: Yosys.CellAttributes) {
        this.key = key;
        this.type = type;
        this.inputPorts = inputPorts;
        this.outputPorts = outputPorts;
        this.attributes = attributes || {};
        inputPorts.forEach((ip) => {
            ip.parentNode = this;
        });
        outputPorts.forEach((op) => {
            op.parentNode = this;
        });
    }

    public get Type(): string {
        return this.type;
    }

    public get Key(): string {
        return this.key;
    }

    public get InputPorts(): Port[] {
        return this.inputPorts;
    }

    public get OutputPorts(): Port[] {
        return this.outputPorts;
    }

    public get Attributes(): Yosys.CellAttributes {
        return this.attributes;
    }

    public maxOutVal(atLeast: number): number {
        const maxVal: number = _.max(this.outputPorts.map((op) => op.maxVal()));
        return _.max([maxVal, atLeast]);
    }

    public findConstants(sigsByConstantName: SigsByConstName,
                         maxNum: number,
                         constantCollector: Cell[]): number {
        this.inputPorts.forEach((ip) => {
            maxNum = ip.findConstants(sigsByConstantName, maxNum, constantCollector);
        });
        return maxNum;
    }

    public inputPortVals(): string[] {
        return this.inputPorts.map((port) => port.valString());
    }

    public outputPortVals(): string[] {
        return this.outputPorts.map((port) => port.valString());
    }

    public collectPortsByDirection(ridersByNet: NameToPorts,
                                   driversByNet: NameToPorts,
                                   lateralsByNet: NameToPorts,
                                   genericsLaterals: boolean): void {
        const template = Skin.findSkinType(this.type);
        const lateralPids = Skin.getLateralPortPids(template);
        // find all ports connected to the same net
        this.inputPorts.forEach((port) => {
            const isLateral = port.keyIn(lateralPids);
            if (isLateral || (template[1]['s:type'] === 'generic' && genericsLaterals)) {
                addToDefaultDict(lateralsByNet, port.valString(), port);
            } else {
                addToDefaultDict(ridersByNet, port.valString(), port);
            }
        });
        this.outputPorts.forEach((port) => {
            const isLateral = port.keyIn(lateralPids);
            if (isLateral || (template[1]['s:type'] === 'generic' && genericsLaterals)) {
                addToDefaultDict(lateralsByNet, port.valString(), port);
            } else {
                addToDefaultDict(driversByNet, port.valString(), port);
            }
        });
    }

    public getValueAttribute(): string {
        if (this.attributes && this.attributes.value) {
            return this.attributes.value;
        }
        return null;
    }

    public getTemplate(): any {
        return Skin.findSkinType(this.type);
    }

    public buildElkChild(): ElkModel.Cell {
        const template = this.getTemplate();
        const type: string = template[1]['s:type'];
        const layoutAttrs = { 'org.eclipse.elk.portConstraints': 'FIXED_POS' };
        let fixedPosX = null;
        let fixedPosY = null;
        for (const attr in this.attributes) {
            if (attr.startsWith('org.eclipse.elk')) {
                if (attr === 'org.eclipse.elk.x') {
                    fixedPosX = this.attributes[attr];
                    continue;
                }
                if (attr === 'org.eclipse.elk.y') {
                    fixedPosY = this.attributes[attr];
                    continue;
                }
                layoutAttrs[attr] = this.attributes[attr];
            }
        }
        if (type === 'join' ||
            type === 'split' ||
            type === 'generic') {
            const inTemplates: any[] = Skin.getPortsWithPrefix(template, 'in');
            const outTemplates: any[] = Skin.getPortsWithPrefix(template, 'out');
            const inPorts = this.inputPorts.map((ip, i) =>
                ip.getGenericElkPort(i, inTemplates, 'in'));
            const outPorts = this.outputPorts.map((op, i) =>
                op.getGenericElkPort(i, outTemplates, 'out'));
            const width = Number(this.getGenericWidth());
            const height = Number(this.getGenericHeight());
            const cell: ElkModel.Cell = {
                id: this.key,
                width,
                height,
                ports: inPorts.concat(outPorts),
                layoutOptions: layoutAttrs,
                labels: [],
            };
            if (fixedPosX) {
                cell.x = fixedPosX;
            }
            if (fixedPosY) {
                cell.y = fixedPosY;
            }
            this.addLabels(template, cell);
            return cell;
        }
        const ports: ElkModel.Port[] = Skin.getPortsWithPrefix(template, '').map((tp) => {
            return {
                id: this.key + '.' + tp[1]['s:pid'],
                width: 0,
                height: 0,
                x: Number(tp[1]['s:x']),
                y: Number(tp[1]['s:y']),
            };
        });
        const nodeWidth: number = Number(template[1]['s:width']);
        const ret: ElkModel.Cell = {
            id: this.key,
            width: nodeWidth,
            height: Number(template[1]['s:height']),
            ports,
            layoutOptions: layoutAttrs,
            labels: [],
        };
        if (fixedPosX) {
            ret.x = fixedPosX;
        }
        if (fixedPosY) {
            ret.y = fixedPosY;
        }
        this.addLabels(template, ret);
        return ret;
    }

    public render(cell: ElkModel.Cell): onml.Element {
        const template = this.getTemplate();
        const tempclone = clone(template);
        for (const label of cell.labels) {
            const labelIDSplit = label.id.split('.');
            const attrName = labelIDSplit[labelIDSplit.length - 1];
            setTextAttribute(tempclone, attrName, label.text);
        }
        for (let i = 2; i < tempclone.length; i++) {
            const node = tempclone[i];
            if (node[0] === 'text' && node[1]['s:attribute']) {
                const attrib = node[1]['s:attribute'];
                if (!(attrib in this.attributes)) {
                    node[2] = '';
                }
            }
        }
        tempclone[1].id = 'cell_' + this.key;
        tempclone[1].transform = 'translate(' + cell.x + ',' + cell.y + ')';
        if (this.type === '$_split_') {
            setGenericSize(tempclone, this.getGenericWidth(), this.getGenericHeight());
            const outPorts = Skin.getPortsWithPrefix(tempclone, 'out');
            const gap: number = Number(outPorts[1][1]['s:y']) - Number(outPorts[0][1]['s:y']);
            const startY: number = Number(outPorts[0][1]['s:y']);
            tempclone.pop();
            tempclone.pop();
            this.outputPorts.forEach((op, i) => {
                const portClone = clone(outPorts[0]);
                portClone[portClone.length - 1][2] = op.Key;
                portClone[1].transform = 'translate(' + outPorts[1][1]['s:x'] + ','
                    + (startY + i * gap) + ')';
                tempclone.push(portClone);
            });
        } else if (this.type === '$_join_') {
            setGenericSize(tempclone, this.getGenericWidth(), this.getGenericHeight());
            const inPorts = Skin.getPortsWithPrefix(tempclone, 'in');
            const gap: number = Number(inPorts[1][1]['s:y']) - Number(inPorts[0][1]['s:y']);
            const startY: number = Number(inPorts[0][1]['s:y']);
            tempclone.pop();
            tempclone.pop();
            this.inputPorts.forEach((port, i) => {
                const portClone = clone(inPorts[0]);
                portClone[portClone.length - 1][2] = port.Key;
                portClone[1].transform = 'translate(' + inPorts[1][1]['s:x'] + ','
                    + (startY + i * gap) + ')';
                tempclone.push(portClone);
            });
        } else if (template[1]['s:type'] === 'generic') {
            setGenericSize(tempclone, this.getGenericWidth(), this.getGenericHeight());

            const inPorts = Skin.getPortsWithPrefix(tempclone, 'in');
            const ingap = Number(inPorts[1][1]['s:y']) - Number(inPorts[0][1]['s:y']);
            const instartY = Number(inPorts[0][1]['s:y']);
            const outPorts = Skin.getPortsWithPrefix(tempclone, 'out');
            const outgap = Number(outPorts[1][1]['s:y']) - Number(outPorts[0][1]['s:y']);
            const outstartY = Number(outPorts[0][1]['s:y']);
            // pops template ports
            tempclone.pop();
            tempclone.pop();
            tempclone.pop();
            tempclone.pop();
            this.inputPorts.forEach((port, i) => {
                const portClone = clone(inPorts[0]);
                portClone[portClone.length - 1][2] = port.Key;
                portClone[1].transform = 'translate(' + inPorts[1][1]['s:x'] + ','
                    + (instartY + i * ingap) + ')';
                portClone[1].id = 'port_' + port.parentNode.Key + '~' + port.Key;
                tempclone.push(portClone);
            });
            this.outputPorts.forEach((port, i) => {
                const portClone = clone(outPorts[0]);
                portClone[portClone.length - 1][2] = port.Key;
                portClone[1].transform = 'translate(' + outPorts[1][1]['s:x'] + ','
                    + (outstartY + i * outgap) + ')';
                portClone[1].id = 'port_' + port.parentNode.Key + '~' + port.Key;
                tempclone.push(portClone);
            });

        }
        setClass(tempclone, '$cell_id', 'cell_' + this.key);
        return tempclone;
    }

    private svgTextToElkBox (
        textX: number, textY: number, 
        textAnchor: string, dominantBaseline: string, 
        text: string, ifGeneric: boolean = false,
        attrName: string = ''): { x: number, y: number, width: number, height: number } {
        
        const w: number = Skin.getFontCharWidth() * text.length;
        const h: number = Skin.getFontCharHeight();

        // Generic cells re-center their middle-anchored texts horizontally
        // when the body widens (setGenericSize), so anchor X at the body
        // center. For Y: the ref label sits above the body (template y<0)
        // and keeps its template position, while the value label lives
        // inside the body and is vertically centered in it (matching
        // setGenericSize's render behavior).
        let elkAnchorX: number = ifGeneric ? this.getGenericWidth() / 2: textX;
        let elkAnchorY: number = textY;
        if (ifGeneric && attrName === 'value') {
            elkAnchorY = this.getGenericHeight() / 2;
        }
        if (textAnchor === 'middle') {
            elkAnchorX = elkAnchorX - w / 2;
        } else if (textAnchor === 'end') {
            elkAnchorX = elkAnchorX - w;
        }

        // Map the SVG text alignment point (textY) to the top edge of the
        // label box, per dominant-baseline. 
        //  - 'hanging'  => box = [y, y + h]: ink hangs from the box top;
        //                 tails stay inside (caps ~0.65h, tails reach ~0.8h)
        //  - 'middle'   => box = [y - h/2, y + h/2]: cap ink centers just
        //                 above the em center; tails stay inside the lower
        //                 half, so no shift
        //  - otherwise  ('alphabetic' | 'baseline' | 'auto') => the point is
        //    the baseline = the bottom of non-descender glyphs. A box ending
        //    there would clip the tails of y/g/j/p/q, so shift the box down
        //    by a descender offset.
        const DESC_SHIFT = h * Skin.getFontDescShift();
        if (dominantBaseline === 'hanging') {
            elkAnchorY = elkAnchorY;
        }
        else if (dominantBaseline === 'middle') {
            elkAnchorY = elkAnchorY - h / 2;
        }
        else {
            elkAnchorY = elkAnchorY - h + DESC_SHIFT;
        }

        return {x: elkAnchorX, y: elkAnchorY, width: w, height: h};
    }


    private addLabels(template, cell: ElkModel.Cell) {
        onml.traverse(template, {
            enter: (node) => {
                if (node.name === 'text' && node.attr['s:attribute']) {
                    const attrName = node.attr['s:attribute'];
                    let newString;
                    if (attrName === 'ref' || attrName === 'id') {
                        if (this.type === '$_constant_' && this.key.length > 3) {
                            const num: number = parseInt(this.key, 2);
                            newString = '0x' + num.toString(16);
                        } else {
                            newString = this.key;
                        }
                        this.attributes[attrName] = this.key;
                    } else if (attrName in this.attributes) {
                        newString = this.attributes[attrName];
                    } else {
                        return;
                    }

                    const textX = Number(node.attr.x);
                    const textY = Number(node.attr.y);
                    const textAnchor = node.attr['text-anchor'] ?? 'start';
                    const dominantBaseline = node.attr['dominant-baseline'] ?? 'auto';
                    const ifGeneric = template[1]['s:type'] === 'generic';
                    const {x, y, width, height} = this.svgTextToElkBox(textX, textY, textAnchor, dominantBaseline, newString, ifGeneric, attrName);

                    // const boxTop = Number(node.attr.y) - 8;

                    cell.labels.push({
                        id: this.key + '.label.' + attrName,
                        text: newString,
                        x: x,
                        y: y,
                        width: width,
                        height: height,
                    });


                }
            },
        });
    }

    public getGenericHeight() {
        const template = this.getTemplate();
        const inPorts = Skin.getPortsWithPrefix(template, 'in');
        const outPorts = Skin.getPortsWithPrefix(template, 'out');
        const baseHeight = Number(template[1]['s:height']);
        // Vertical pin pitch comes from the skin's two in-/out- exemplars;
        // growth is driven by the CELL's pin count, never below baseHeight.
        if (this.inputPorts.length > this.outputPorts.length && this.inputPorts.length > 1) {
            const gap = Number(inPorts[1][1]['s:y']) - Number(inPorts[0][1]['s:y']);
            return baseHeight + gap * Math.max(0, this.inputPorts.length - 2);
        }
        if (this.outputPorts.length > 1) {
            const gap = Number(outPorts[1][1]['s:y']) - Number(outPorts[0][1]['s:y']);
            return baseHeight + gap * Math.max(0, this.outputPorts.length - 2);
        }
        return baseHeight;
    }

    public getGenericWidth() {
        const template = this.getTemplate();

        const margin = 10;
        const baseWidth = Number(template[1]['s:width']);
        // The body must be at least as wide as its longest label.
        const charW = Skin.getFontCharWidth();
        const valueAdjustedWidth = charW * (this.getValueAttribute()?.length ?? 0);
        const refAdjustedWidth = charW * this.Key.length;

        return Math.max(refAdjustedWidth, valueAdjustedWidth, baseWidth) + margin;
    }

}

function setGenericSize(tempclone, width, height) {
    onml.traverse(tempclone, {
        enter: (node) => {
            // set the body to the new width and height
            if (node.name === 'rect' && node.attr['s:generic'] === 'body') {
                node.attr.width = width;
                node.attr.height = height;
            }
            // change port positions to match the new width
            if (node.name === 'g' && 
                (node.attr['s:position'] === 'right' || 
                    Number(node.attr['s:x']) > 0)) {
                node.attr["s:x"] = width;
            }

            // keep mid-anchored texts glued to the body's center as it widens
            if (node.name === 'text' &&
                node.attr['s:attribute'] &&
                node.attr['text-anchor'] === 'middle') {
                node.attr.x = width / 2;
            }

            // the value text lives inside the body: keep it vertically
            // centered as the body grows (the ref text above stays put)
            if (node.name === 'text' &&
                node.attr['s:attribute'] === 'value' &&
                node.attr['dominant-baseline'] === 'middle') {
                node.attr.y = height / 2;
            }
        },
    });
}

function setTextAttribute(tempclone, attribute, value) {
    onml.traverse(tempclone, {
        enter: (node) => {
            if (node.name === 'text' && node.attr['s:attribute'] === attribute) {
                node.full[2] = value;
            }
        },
    });
}

function setClass(tempclone, searchKey, className) {
    onml.traverse(tempclone, {
        enter: (node) => {
            const currentClass: string = node.attr.class;
            if (currentClass && currentClass.includes(searchKey)) {
                node.attr.class = currentClass.replace(searchKey, className);
            }
        },
    });
}

function getBits(signals: Yosys.Signals, indicesString: string): Yosys.Signals {
    const index = indicesString.indexOf(':');
    // is it the whole thing?
    if (index === -1) {
        return [signals[Number(indicesString)]];
    } else {
        const start = indicesString.slice(0, index);
        const end = indicesString.slice(index + 1);
        const slice = signals.slice(Number(start), Number(end) + 1);
        return slice;
    }
}

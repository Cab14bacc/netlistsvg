
import onml = require('onml');
import _ = require('lodash');
import { ElkModel } from './elkGraph';

export namespace Skin {

    export let skin: onml.Element = null;

    export function getPortsWithPrefix(template: any[], prefix: string) {
        const ports = _.filter(template, (e) => {
            try {
                if (e instanceof Array && e[0] === 'g') {
                    return e[1]['s:pid'].startsWith(prefix);
                }
            } catch (exception) {
                // Do nothing if the SVG group doesn't have a pin id.
            }
        });
        return ports;
    }

    function filterPortPids(template, filter): string[] {
        const ports = _.filter(template, (element: any[]) => {
            const tag: string = element[0];
            if (element instanceof Array && tag === 'g') {
                const attrs: any = element[1];
                return filter(attrs);
            }
            return false;
        });
        return ports.map((port) => {
            return port[1]['s:pid'];
        });
    }

    export function getInputPids(template): string[] {
        return filterPortPids(template, (attrs) => {
            if (attrs['s:position']) {
                return attrs['s:position'] === 'top';
            }
            return false;
        });
    }

    export function getOutputPids(template): string[] {
        return filterPortPids(template, (attrs) => {
            if (attrs['s:position']) {
                return attrs['s:position'] === 'bottom';
            }
            return false;
        });
    }

    export function getLateralPortPids(template): string[] {
        return filterPortPids(template, (attrs) => {
            if (attrs['s:dir']) {
                return attrs['s:dir'] === 'lateral';
            }
            if (attrs['s:position']) {
                return attrs['s:position'] === 'left' ||
                    attrs['s:position'] === 'right';
            }
            return false;
        });
    }

    export function findSkinType(type: string) {
        let ret = null;
        onml.traverse(skin, {
            enter: (node, parent) => {
                if (node.name === 's:alias' && node.attr.val === type) {
                    ret = parent;
                }
            },
        });
        if (ret == null) {
            onml.traverse(skin, {
                enter: (node) => {
                    if (node.attr['s:type'] === 'generic') {
                        ret = node;
                    }
                },
            });
        }
        return ret.full;
    }

    export function getLowPriorityAliases(): string[] {
        const ret = [];
        onml.t(skin, {
            enter: (node) => {
                if (node.name === 's:low_priority_alias') {
                    ret.push(node.attr.value);
                }
            },
        });
        return ret;
    }
    interface SkinProperties {
        [attr: string]: boolean | string | number | ElkModel.LayoutOptions;
    }

    export function getProperties(): SkinProperties {
        let vals;
        onml.t(skin, {
            enter: (node) => {
                if (node.name === 's:properties') {
                    vals = _.mapValues(node.attr, (val: string) => {
                        if (!isNaN(Number(val))) {
                            return Number(val);
                        }
                        if (val === 'true') {
                            return true;
                        }
                        if (val === 'false') {
                            return false;
                        }
                        return val;
                    });
                } else if (node.name === 's:layoutEngine') {
                    vals.layoutEngine = node.attr;
                }
            },
        });

        if (!vals.layoutEngine) {
            vals.layoutEngine = {};
        }

        return vals;
    }

    // Per-character text metrics for the skin's label font, read from
    // <s:properties fontCharWidth="6" fontCharHeight="11"/> with defaults
    // matching 10px Courier New (0.6 em advance, ~1.1 em line height).
    export function getFontCharWidth(): number {
        const v = getProperties().fontCharWidth;
        return typeof v === 'number' ? v : 6;
    }

    export function getFontCharHeight(): number {
        const v = getProperties().fontCharHeight;
        return typeof v === 'number' ? v : 11;
    }

    // // Baseline-to-top gap for the skin's label font (~0.8em ascent).
    // export function getFontAscent(): number {
    //     const v = getProperties().fontAscent;
    //     return typeof v === 'number' ? v : 8;
    // }
}
export default Skin;

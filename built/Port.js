"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Port = void 0;
var Cell_1 = require("./Cell");
var Skin_1 = require("./Skin");
var _ = require("lodash");
var Port = /** @class */ (function () {
    function Port(key, value) {
        this.key = key;
        this.value = value;
    }
    Object.defineProperty(Port.prototype, "Key", {
        get: function () {
            return this.key;
        },
        enumerable: false,
        configurable: true
    });
    Port.prototype.keyIn = function (pids) {
        return _.includes(pids, this.key);
    };
    Port.prototype.maxVal = function () {
        return _.max(_.map(this.value, function (v) { return Number(v); }));
    };
    Port.prototype.valString = function () {
        return ',' + this.value.join() + ',';
    };
    Port.prototype.findConstants = function (sigsByConstantName, maxNum, constantCollector) {
        var _this = this;
        var constNameCollector = '';
        var constNumCollector = [];
        var portSigs = this.value;
        portSigs.forEach(function (portSig, portSigIndex) {
            // is constant?
            if (portSig === '0' || portSig === '1') {
                maxNum += 1;
                constNameCollector += portSig;
                // replace the constant with new signal num
                portSigs[portSigIndex] = maxNum;
                constNumCollector.push(maxNum);
                // string of constants ended before end of p.value
            }
            else if (constNumCollector.length > 0) {
                _this.assignConstant(constNameCollector, constNumCollector, portSigIndex, sigsByConstantName, constantCollector);
                // reset name and num collectors
                constNameCollector = '';
                constNumCollector = [];
            }
        });
        if (constNumCollector.length > 0) {
            this.assignConstant(constNameCollector, constNumCollector, portSigs.length, sigsByConstantName, constantCollector);
        }
        return maxNum;
    };
    Port.prototype.getGenericElkPort = function (index, templatePorts, dir) {
        var _a;
        var nkey = this.parentNode.Key;
        var type = this.parentNode.getTemplate()[1]['s:type'];
        // estimated width (in ELK units) of the cell's "value" label,
        // using the skin's 6-units-per-character assumption at 10px
        var originalWidth = Number(this.parentNode.getTemplate()[1]['s:width']);
        var templateX = Number(templatePorts[0][1]['s:x']);
        var pos = templatePorts[0][1]['s:position'];
        var isLeft = pos === 'left' || (pos === undefined && templateX < Number(originalWidth) / 2);
        var newX = isLeft ? 0 : this.parentNode.getGenericWidth();
        var displayKey = this.key;
        var textW = Skin_1.default.getFontCharWidth() * displayKey.length;
        var textH = Skin_1.default.getFontCharHeight();
        // template text node of the exemplar pin: x/y + anchors. The box is
        // computed anchor/baseline-aware so it matches the rendered glyphs
        // (in-ports are end-anchored: text extends LEFT of x).
        var textNode = templatePorts[0][2][1];
        var textAnchor = (_a = textNode['text-anchor']) !== null && _a !== void 0 ? _a : 'start';
        var labelX = Number(textNode.x);
        if (textAnchor === 'end') {
            labelX -= textW;
        }
        else if (textAnchor === 'middle') {
            labelX -= textW / 2;
        }
        // assume no dominant-baseline on port texts => baseline semantics: top = y - h
        var labelY = Number(textNode.y) - textH;
        function portLabel() {
            return {
                id: nkey + '.' + this.key + '.label',
                text: displayKey,
                x: labelX,
                y: labelY,
                width: textW,
                height: textH,
            };
        }
        if (index === 0) {
            var ret = {
                id: nkey + '.' + this.key,
                width: 1,
                height: 1,
                x: newX,
                y: Number(templatePorts[0][1]['s:y']),
            };
            if ((type === 'generic' || type === 'join') && dir === 'in') {
                ret.labels = [portLabel.call(this)];
            }
            if ((type === 'generic' || type === 'split') && dir === 'out') {
                ret.labels = [portLabel.call(this)];
            }
            return ret;
        }
        else {
            var gap = Number(templatePorts[1][1]['s:y']) - Number(templatePorts[0][1]['s:y']);
            var ret = {
                id: nkey + '.' + this.key,
                width: 1,
                height: 1,
                x: newX,
                y: (index) * gap + Number(templatePorts[0][1]['s:y']),
            };
            if (type === 'generic') {
                ret.labels = [portLabel.call(this)];
            }
            return ret;
        }
    };
    Port.prototype.assignConstant = function (nameCollector, constants, currIndex, signalsByConstantName, constantCollector) {
        var _this = this;
        // we've been appending to nameCollector, so reverse to get const name
        var constName = nameCollector.split('').reverse().join('');
        // if the constant has already been used
        if (signalsByConstantName.hasOwnProperty(constName)) {
            var constSigs = signalsByConstantName[constName];
            // go back and fix signal values
            var constLength_1 = constSigs.length;
            constSigs.forEach(function (constSig, constIndex) {
                // i is where in port_signals we need to update
                var i = currIndex - constLength_1 + constIndex;
                _this.value[i] = constSig;
            });
        }
        else {
            constantCollector.push(Cell_1.default.fromConstantInfo(constName, constants));
            signalsByConstantName[constName] = constants;
        }
    };
    return Port;
}());
exports.Port = Port;

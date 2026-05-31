import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEFAULT_COLOR = '#00ffcc';
const DEFAULT_COLOR_BOTTOM = '#00ffcc';
const DEFAULT_COLOR_MIDDLE = '#0088ff';
const DEFAULT_COLOR_TOP = '#ff0055';
const CHUNK_SIZE = 9600;
const THRESHOLD = 50;
const MAX_LEVEL = 3000;

function createExtensionSettings(extensionPath) {
    try {
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            `${extensionPath}/schemas`,
            Gio.SettingsSchemaSource.get_default(),
            false
        );
        const schema = schemaSource.lookup('org.gnome.shell.extensions.audio-border', false);
        if (schema)
            return new Gio.Settings({ settings_schema: schema });
    } catch(e) {
        log('AudioBorder: error cargando schema: ' + e);
    }
    return null;
}

const BorderGlow = GObject.registerClass(
class BorderGlow extends St.Widget {
    _init(settings) {
        super._init({ name: 'BorderGlow', reactive: false });
        this._settings = settings;
        this._segments = [];
        this._intensity = 0;
        this._targetIntensity = 0;
        this._audioBuffer = new Uint8Array(0);
        this._monitorProc = null;
        this._readTimeoutId = null;
        this._decayTimeoutId = null;
        this._stdout = null;
        this._settingsChangedId = null;

        this._loadSettings();

        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed', () => {
                this._loadSettings();
                this._recreateSegments();
            });
        }

        this._createSegments();
        this._startAudioCapture();

        this._decayTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._intensity = this._intensity * 0.75 + this._targetIntensity * 0.25;
            this._updateSegments(this._intensity);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getSafe(key, type, def) {
        if (!this._settings) return def;
        try {
            if (type === 'int') return this._settings.get_int(key);
            if (type === 'double') return this._settings.get_double(key);
            if (type === 'boolean') return this._settings.get_boolean(key);
            if (type === 'string') return this._settings.get_string(key);
        } catch(e) {}
        return def;
    }

    _loadSettings() {
        this._pixelsPerSegment = Math.max(1, this._getSafe('pixels-per-segment', 'int', 3));
        this._pixelSize = Math.max(2, this._getSafe('pixel-size', 'int', 5));
        this._pixelGap = Math.max(0, this._getSafe('pixel-gap', 'int', 2));
        this._sensitivity = Math.max(0.1, this._getSafe('sensitivity', 'double', 1.5));
        this._pulseMode = this._getSafe('pulse-mode', 'boolean', false);
        this._gradientMode = this._getSafe('gradient-mode', 'boolean', false);
        this._color = this._getSafe('color', 'string', DEFAULT_COLOR) || DEFAULT_COLOR;
        this._colorBottom = this._getSafe('color-bottom', 'string', DEFAULT_COLOR_BOTTOM) || DEFAULT_COLOR_BOTTOM;
        this._colorMiddle = this._getSafe('color-middle', 'string', DEFAULT_COLOR_MIDDLE) || DEFAULT_COLOR_MIDDLE;
        this._colorTop = this._getSafe('color-top', 'string', DEFAULT_COLOR_TOP) || DEFAULT_COLOR_TOP;
    }

    _recreateSegments() {
        this._segments.forEach(({ leftRow, rightRow }) => {
            leftRow.destroy();
            rightRow.destroy();
        });
        this._segments = [];
        this._createSegments();
    }

    _createSegments() {
        const monitors = Main.layoutManager.monitors;
        if (!monitors || monitors.length === 0) return;

        const segH = this._pixelSize + this._pixelGap;

        monitors.forEach((monitor) => {
            const rowCount = Math.floor(monitor.height / segH);
            const rowWidth = this._pixelsPerSegment * this._pixelSize +
                Math.max(0, this._pixelsPerSegment - 1) * this._pixelGap;

            for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
                const y = monitor.y + monitor.height - (rowIndex + 1) * segH;

                const leftRow = new St.Widget({ reactive: false });
                leftRow.set_position(monitor.x, y);
                leftRow.set_size(rowWidth, this._pixelSize);
                Main.layoutManager.uiGroup.add_child(leftRow);

                const rightRow = new St.Widget({ reactive: false });
                rightRow.set_position(monitor.x + monitor.width - rowWidth, y);
                rightRow.set_size(rowWidth, this._pixelSize);
                Main.layoutManager.uiGroup.add_child(rightRow);

                const leftPixels = [];
                const rightPixels = [];

                for (let p = 0; p < this._pixelsPerSegment; p++) {
                    const xPos = p * (this._pixelSize + this._pixelGap);
                    const style = 'background-color: rgba(0,0,0,0); border-radius: 1px;';

                    const lp = new St.Widget({ reactive: false });
                    lp.set_position(xPos, 0);
                    lp.set_size(this._pixelSize, this._pixelSize);
                    lp.set_style(style);
                    leftRow.add_child(lp);
                    leftPixels.push(lp);

                    const rp = new St.Widget({ reactive: false });
                    rp.set_position(xPos, 0);
                    rp.set_size(this._pixelSize, this._pixelSize);
                    rp.set_style(style);
                    rightRow.add_child(rp);
                    rightPixels.push(rp);
                }

                this._segments.push({ leftRow, rightRow, leftPixels, rightPixels, rowIndex, rowCount });
            }
        });
    }

    _hexToRgb(hex) {
        const m = (hex || '').trim().match(/^#([0-9a-fA-F]{6})$/);
        if (!m) return { r: 0, g: 255, b: 204 };
        return {
            r: parseInt(m[1].slice(0, 2), 16),
            g: parseInt(m[1].slice(2, 4), 16),
            b: parseInt(m[1].slice(4, 6), 16),
        };
    }

    _interpolateColor(colorA, colorB, t) {
        return {
            r: Math.round(colorA.r + (colorB.r - colorA.r) * t),
            g: Math.round(colorA.g + (colorB.g - colorA.g) * t),
            b: Math.round(colorA.b + (colorB.b - colorA.b) * t),
        };
    }

    _getGradientColor(normalizedPos) {
        // normalizedPos: 0 = base, 1 = tope
        const bottom = this._hexToRgb(this._colorBottom);
        const middle = this._hexToRgb(this._colorMiddle);
        const top = this._hexToRgb(this._colorTop);

        if (normalizedPos <= 0.5) {
            return this._interpolateColor(bottom, middle, normalizedPos / 0.5);
        } else {
            return this._interpolateColor(middle, top, (normalizedPos - 0.5) / 0.5);
        }
    }

    _updateSegments(intensity) {
        const singleRgb = this._hexToRgb(this._color);

        this._segments.forEach(({ leftPixels, rightPixels, rowIndex, rowCount }) => {
            const activeCount = Math.floor(intensity * rowCount);
            const isActive = rowIndex < activeCount;
            const alpha = isActive
                ? (this._pulseMode ? (0.2 + intensity * 0.7).toFixed(2) : '0.90')
                : '0.0';

            let rgb;
            if (this._gradientMode) {
                const normalizedPos = rowCount > 1 ? rowIndex / (rowCount - 1) : 0;
                rgb = this._getGradientColor(normalizedPos);
            } else {
                rgb = singleRgb;
            }

            const style = isActive
                ? `background-color: rgba(${rgb.r},${rgb.g},${rgb.b},${alpha}); border-radius: 1px;`
                : 'background-color: rgba(0,0,0,0); border-radius: 1px;';

            leftPixels.forEach(p => p.set_style(style));
            rightPixels.forEach(p => p.set_style(style));
        });
    }

    _findMonitorSource() {
        const pactlPath = GLib.find_program_in_path('pactl');
        if (!pactlPath) return null;
        try {
            const proc = Gio.Subprocess.new(
                [pactlPath, 'list', 'sources', 'short'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            const [, stdout] = proc.communicate_utf8(null, null);
            for (const line of (stdout || '').split('\n')) {
                const parts = line.trim().split(/\s+/);
                if (parts[1] && parts[1].includes('.monitor'))
                    return parts[1];
            }
        } catch(e) {}
        return null;
    }

    _startAudioCapture() {
        const source = this._findMonitorSource();
        if (!source) {
            Main.notify('Audio Border Glow', 'No se encontró fuente de audio monitor.');
            return;
        }
        const parecPath = GLib.find_program_in_path('parec');
        if (!parecPath) {
            Main.notify('Audio Border Glow', 'parec no encontrado. Instala pulseaudio-utils.');
            return;
        }
        try {
            this._monitorProc = Gio.Subprocess.new(
                [parecPath, '--device', source, '--format=s16le', '--channels=1', '--latency-msec=50'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            this._stdout = this._monitorProc.get_stdout_pipe();
            this._readTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                this._readAudio();
                return GLib.SOURCE_CONTINUE;
            });
        } catch(e) {
            Main.notify('Audio Border Glow', `Error iniciando audio: ${e}`);
        }
    }

    _readAudio() {
        if (!this._stdout) return;
        try {
            const bytes = this._stdout.read_bytes(8192, null);
            if (!bytes) return;
            const raw = new Uint8Array(bytes.get_data());
            if (raw.length === 0) return;

            const combined = new Uint8Array(this._audioBuffer.length + raw.length);
            combined.set(this._audioBuffer);
            combined.set(raw, this._audioBuffer.length);

            const chunks = Math.floor(combined.length / CHUNK_SIZE);
            for (let i = 0; i < chunks; i++) {
                const chunk = combined.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                const level = this._analyzeChunk(chunk);
                this._targetIntensity = Math.min(1.0, (level / 100) * this._sensitivity);
            }
            this._audioBuffer = combined.subarray(chunks * CHUNK_SIZE);
        } catch(e) {}
    }

    _analyzeChunk(chunk) {
        let sum = 0;
        const n = Math.floor(chunk.length / 2);
        for (let i = 0; i < n; i++) {
            let s = (chunk[i * 2 + 1] << 8) | chunk[i * 2];
            if (s & 0x8000) s -= 0x10000;
            sum += s * s;
        }
        const rms = Math.sqrt(sum / n);
        if (rms < THRESHOLD) return 0;
        return Math.min(100, Math.round(((rms - THRESHOLD) / (MAX_LEVEL - THRESHOLD)) * 100));
    }

    destroy() {
        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._decayTimeoutId) {
            GLib.source_remove(this._decayTimeoutId);
            this._decayTimeoutId = null;
        }
        if (this._readTimeoutId) {
            GLib.source_remove(this._readTimeoutId);
            this._readTimeoutId = null;
        }
        if (this._monitorProc) {
            this._monitorProc.force_exit();
            this._monitorProc = null;
        }
        this._stdout = null;
        this._segments.forEach(({ leftRow, rightRow }) => {
            leftRow.destroy();
            rightRow.destroy();
        });
        this._segments = [];
        super.destroy();
    }
});

let glowInstance = null;

export default class AudioBorderExtension {
    constructor(meta) {
        this._meta = meta;
    }

    enable() {
        const settings = createExtensionSettings(this._meta.path);
        glowInstance = new BorderGlow(settings);
    }

    disable() {
        if (glowInstance) {
            glowInstance.destroy();
            glowInstance = null;
        }
    }
}

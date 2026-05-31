import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';

export default class AudioBorderPreferences {
    fillPreferencesWindow(window) {
        const settings = this._getSettings(window);
        if (!settings) return;

        // ── Página principal ──────────────────────────────────────────
        const page = new Adw.PreferencesPage({
            title: 'Audio Border Glow',
            icon_name: 'preferences-desktop-color-symbolic',
        });
        window.add(page);

        // ── Grupo: Apariencia ─────────────────────────────────────────
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Apariencia',
            description: 'Configura el tamaño y forma de los puntos',
        });
        page.add(appearanceGroup);

        appearanceGroup.add(this._makeSpinRow(settings, 'pixels-per-segment',
            'Puntos por fila', 'Cuántos cuadritos por fila', 1, 20, 1));

        appearanceGroup.add(this._makeSpinRow(settings, 'pixel-size',
            'Tamaño del punto', 'Tamaño en píxeles de cada punto', 2, 15, 1));

        appearanceGroup.add(this._makeSpinRow(settings, 'pixel-gap',
            'Espacio entre puntos', 'Separación en píxeles entre puntos', 0, 10, 1));

        // ── Grupo: Audio ──────────────────────────────────────────────
        const audioGroup = new Adw.PreferencesGroup({
            title: 'Audio',
            description: 'Ajusta la respuesta al sonido',
        });
        page.add(audioGroup);

        audioGroup.add(this._makeSpinRowDouble(settings, 'sensitivity',
            'Sensibilidad', 'Multiplicador de respuesta al audio', 0.1, 5.0, 0.1));

        audioGroup.add(this._makeSwitchRow(settings, 'pulse-mode',
            'Modo pulso', 'Suaviza la animación en lugar de barras discretas'));

        // ── Grupo: Color ──────────────────────────────────────────────
        const colorGroup = new Adw.PreferencesGroup({
            title: 'Color',
            description: 'Elige entre un color único o gradiente de tres colores',
        });
        page.add(colorGroup);

        // Switch gradiente
        const gradientRow = this._makeSwitchRow(settings, 'gradient-mode',
            'Modo gradiente', 'Usar tres colores interpolados en lugar de uno solo');
        colorGroup.add(gradientRow);

        // Color único
        const singleColorRow = this._makeColorRow(settings, 'color',
            'Color único', 'Color cuando el modo gradiente está desactivado');
        colorGroup.add(singleColorRow);

        // Color base
        const bottomColorRow = this._makeColorRow(settings, 'color-bottom',
            'Color base (abajo)', 'Color en la parte inferior — volumen bajo');
        colorGroup.add(bottomColorRow);

        // Color medio
        const middleColorRow = this._makeColorRow(settings, 'color-middle',
            'Color medio (centro)', 'Color en el centro — volumen medio');
        colorGroup.add(middleColorRow);

        // Color tope
        const topColorRow = this._makeColorRow(settings, 'color-top',
            'Color tope (arriba)', 'Color en la parte superior — volumen alto');
        colorGroup.add(topColorRow);

        // Mostrar/ocultar filas según modo gradiente
        const updateVisibility = () => {
            const gradient = settings.get_boolean('gradient-mode');
            singleColorRow.set_visible(!gradient);
            bottomColorRow.set_visible(gradient);
            middleColorRow.set_visible(gradient);
            topColorRow.set_visible(gradient);
        };
        updateVisibility();
        settings.connect('changed::gradient-mode', updateVisibility);
    }

    _getSettings(window) {
        try {
            const dir = window.get_transient_for()?.get_application()
                ?.get_active_window()?.get_application();

            // Buscar schema desde extensionPath
            const extPath = import.meta.url
                .replace('file://', '')
                .replace('/prefs.js', '');

            const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
                `${extPath}/schemas`,
                Gio.SettingsSchemaSource.get_default(),
                false
            );
            const schema = schemaSource.lookup('org.gnome.shell.extensions.audio-border', false);
            if (schema)
                return new Gio.Settings({ settings_schema: schema });
        } catch(e) {
            log('AudioBorder prefs: error cargando settings: ' + e);
        }
        return new Gio.Settings({
            schema_id: 'org.gnome.shell.extensions.audio-border',
            path: '/org/gnome/shell/extensions/audio-border/',
        });
    }

    _makeSpinRow(settings, key, title, subtitle, min, max, step) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: step }),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _makeSpinRowDouble(settings, key, title, subtitle, min, max, step) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            digits: 1,
            adjustment: new Gtk.Adjustment({ lower: min, upper: max, step_increment: step }),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _makeSwitchRow(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({ title, subtitle });
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _makeColorRow(settings, key, title, subtitle) {
        const colorButton = new Gtk.ColorButton({
            use_alpha: false,
            valign: Gtk.Align.CENTER,
        });

        // Cargar color actual
        const hexToRgba = (hex) => {
            const m = hex.trim().match(/^#([0-9a-fA-F]{6})$/);
            if (!m) return null;
            const rgba = new Gdk_RGBA();
            rgba.red = parseInt(m[1].slice(0, 2), 16) / 255;
            rgba.green = parseInt(m[1].slice(2, 4), 16) / 255;
            rgba.blue = parseInt(m[1].slice(4, 6), 16) / 255;
            rgba.alpha = 1.0;
            return rgba;
        };

        // Usar parse_color directamente
        const rgba = new Gtk.ColorButton();
        const row = new Adw.ActionRow({ title, subtitle });

        const btn = new Gtk.ColorButton({ use_alpha: false, valign: Gtk.Align.CENTER });
        const currentColor = new Gdk.RGBA();
        currentColor.parse(settings.get_string(key));
        btn.set_rgba(currentColor);

        btn.connect('color-set', () => {
            const c = btn.get_rgba();
            const r = Math.round(c.red * 255).toString(16).padStart(2, '0');
            const g = Math.round(c.green * 255).toString(16).padStart(2, '0');
            const b = Math.round(c.blue * 255).toString(16).padStart(2, '0');
            settings.set_string(key, `#${r}${g}${b}`);
        });

        settings.connect(`changed::${key}`, () => {
            const updated = new Gdk.RGBA();
            updated.parse(settings.get_string(key));
            btn.set_rgba(updated);
        });

        row.add_suffix(btn);
        row.set_activatable_widget(btn);
        return row;
    }
}

# Audio Border Glow

Borde de pantalla reactivo al audio para GNOME Shell.

## Características

- Lectura de audio integrada desde PulseAudio/PipeWire
- Soporte multi-monitor
- Color configurable desde las preferencias
- Ajuste de sensibilidad desde el esquema de configuración
- Modo pulso suave para transiciones menos abruptas
- Manejo básico de errores con notificaciones al usuario

## Instalación

1. Copia el directorio `audio-border@custom` a `~/.local/share/gnome-shell/extensions/`.
2. Asegúrate de tener instalado `pactl` y `parec`.
3. Reinicia GNOME Shell (`Alt+F2`, escribe `r` y presiona Enter) o cierra sesión.
4. Activa la extensión con `gnome-extensions enable audio-border@custom`.

## Dependencias

- `pactl`
- `parec`

## Configuración

La extensión usa la clave de esquema `org.gnome.shell.extensions.audio-border`.

Opciones disponibles:

- `pixels-per-segment`
- `pixel-size`
- `pixel-gap`
- `sensitivity`
- `color`
- `pulse-mode`

## Licencia

MIT

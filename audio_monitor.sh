#!/bin/bash
DEVICE="alsa_output.pci-0000_00_1f.3.analog-stereo.monitor"
parec --device=$DEVICE --format=s16le --channels=1 --latency-msec=100 2>/dev/null | \
python3 -c "
import sys, struct, math

CHUNK = 4800
THRESHOLD = 50
MAX = 3000

while True:
    data = sys.stdin.buffer.read(CHUNK * 2)
    if not data:
        break
    samples = struct.unpack('<' + 'h' * (len(data) // 2), data)
    
    # RMS - detecta toda la señal incluyendo voz
    rms = math.sqrt(sum(s * s for s in samples) / len(samples))
    
    if rms < THRESHOLD:
        pct = 0
    else:
        pct = int(((rms - THRESHOLD) / (MAX - THRESHOLD)) * 100)
        if pct > 100:
            pct = 100
    
    with open('/tmp/audio_border_level', 'w') as f:
        f.write(str(pct))
"

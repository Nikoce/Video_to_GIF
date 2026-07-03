(function () {
  "use strict";

  const GIFEncoder = {
    encode,
    quantizeRgbaTo332
  };

  function encode({ width, height, frames, loop = 0 }) {
    const writer = new ByteWriter();
    writer.ascii("GIF89a");
    writer.u16(width);
    writer.u16(height);
    writer.byte(0xf7);
    writer.byte(0);
    writer.byte(0);
    writePalette(writer);
    writeLoopExtension(writer, loop);

    for (const frame of frames) {
      writeGraphicControlExtension(writer, frame.delayCs || 8);
      writeImageDescriptor(writer, width, height);
      writeImageData(writer, frame.indices);
    }

    writer.byte(0x3b);
    return new Blob([writer.toUint8Array()], { type: "image/gif" });
  }

  function quantizeRgbaTo332(data, quality = 2) {
    const length = data.length / 4;
    const indices = new Uint8Array(length);
    const dither = quality >= 3;
    const strength = quality >= 3 ? 0.75 : quality === 2 ? 0.35 : 0;
    let position = 0;

    for (let offset = 0; offset < data.length; offset += 4) {
      let r = data[offset];
      let g = data[offset + 1];
      let b = data[offset + 2];

      if (dither) {
        const pattern = BAYER_4[position & 3][(position >> 2) & 3] - 7.5;
        r = clampByte(r + pattern * strength * 4);
        g = clampByte(g + pattern * strength * 4);
        b = clampByte(b + pattern * strength * 6);
      }

      indices[position] = ((r & 0xe0) | ((g & 0xe0) >> 3) | (b >> 6)) & 0xff;
      position += 1;
    }

    return indices;
  }

  function writePalette(writer) {
    for (let index = 0; index < 256; index += 1) {
      const r = index & 0xe0;
      const g = (index & 0x1c) << 3;
      const b = (index & 0x03) << 6;
      writer.byte(scaleBits(r, 224));
      writer.byte(scaleBits(g, 224));
      writer.byte(scaleBits(b, 192));
    }
  }

  function scaleBits(value, max) {
    return Math.round((value / max) * 255);
  }

  function writeLoopExtension(writer, loop) {
    writer.byte(0x21);
    writer.byte(0xff);
    writer.byte(0x0b);
    writer.ascii("NETSCAPE2.0");
    writer.byte(0x03);
    writer.byte(0x01);
    writer.u16(loop);
    writer.byte(0x00);
  }

  function writeGraphicControlExtension(writer, delayCs) {
    writer.byte(0x21);
    writer.byte(0xf9);
    writer.byte(0x04);
    writer.byte(0x04);
    writer.u16(Math.max(1, Math.round(delayCs)));
    writer.byte(0x00);
    writer.byte(0x00);
  }

  function writeImageDescriptor(writer, width, height) {
    writer.byte(0x2c);
    writer.u16(0);
    writer.u16(0);
    writer.u16(width);
    writer.u16(height);
    writer.byte(0x00);
  }

  function writeImageData(writer, indices) {
    writer.byte(8);
    const lzwBytes = lzwEncode(indices, 8);
    for (let offset = 0; offset < lzwBytes.length; offset += 255) {
      const chunk = lzwBytes.subarray(offset, offset + 255);
      writer.byte(chunk.length);
      writer.bytes(chunk);
    }
    writer.byte(0x00);
  }

  function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    const maxCode = 4095;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dict = createInitialDictionary(clearCode);
    const out = new BitWriter();

    out.write(clearCode, codeSize);
    let prefix = indices[0];

    for (let i = 1; i < indices.length; i += 1) {
      const value = indices[i];
      const key = `${prefix},${value}`;
      if (dict.has(key)) {
        prefix = dict.get(key);
        continue;
      }

      out.write(prefix, codeSize);
      if (nextCode <= maxCode) {
        dict.set(key, nextCode);
        nextCode += 1;
        if (nextCode === (1 << codeSize) && codeSize < 12) {
          codeSize += 1;
        }
      } else {
        out.write(clearCode, codeSize);
        dict = createInitialDictionary(clearCode);
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
      prefix = value;
    }

    out.write(prefix, codeSize);
    out.write(endCode, codeSize);
    return out.finish();
  }

  function createInitialDictionary(size) {
    const dict = new Map();
    for (let index = 0; index < size; index += 1) {
      dict.set(String(index), index);
    }
    return dict;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  class ByteWriter {
    constructor() {
      this.bytesList = [];
    }

    byte(value) {
      this.bytesList.push(value & 0xff);
    }

    bytes(values) {
      for (const value of values) this.byte(value);
    }

    u16(value) {
      this.byte(value);
      this.byte(value >> 8);
    }

    ascii(value) {
      for (let index = 0; index < value.length; index += 1) {
        this.byte(value.charCodeAt(index));
      }
    }

    toUint8Array() {
      return new Uint8Array(this.bytesList);
    }
  }

  class BitWriter {
    constructor() {
      this.bytes = [];
      this.current = 0;
      this.bitOffset = 0;
    }

    write(code, size) {
      let value = code;
      for (let index = 0; index < size; index += 1) {
        this.current |= (value & 1) << this.bitOffset;
        value >>= 1;
        this.bitOffset += 1;
        if (this.bitOffset === 8) {
          this.bytes.push(this.current);
          this.current = 0;
          this.bitOffset = 0;
        }
      }
    }

    finish() {
      if (this.bitOffset > 0) {
        this.bytes.push(this.current);
      }
      return new Uint8Array(this.bytes);
    }
  }

  const BAYER_4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  window.GIFEncoder = GIFEncoder;
})();

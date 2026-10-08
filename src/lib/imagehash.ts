import { createHash } from "node:crypto";
import sharp from "sharp";

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const W = 17;
const H = 16;

/**
 * Hash perceptual dHash de 256 bits: a mesma print reenviada (recortada de leve,
 * recomprimida, redimensionada) gera um hash muito próximo do original.
 */
export async function dhash(buf: Buffer): Promise<string> {
  const px = await sharp(buf).rotate().greyscale().resize(W, H, { fit: "fill" }).raw().toBuffer();
  let hex = "";
  let nibble = 0;
  let count = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W - 1; x++) {
      nibble = (nibble << 1) | (px[y * W + x] > px[y * W + x + 1] ? 1 : 0);
      if (++count % 4 === 0) {
        hex += nibble.toString(16);
        nibble = 0;
      }
    }
  return hex;
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

/**
 * Distância máxima (em 256 bits) para tratar duas prints como a mesma imagem.
 * Telas do jogo têm layout parecido, então o limite é propositalmente baixo.
 */
export const PHASH_MAX_DISTANCE = 8;

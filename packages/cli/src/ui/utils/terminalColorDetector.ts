/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import { debugLogger } from '@google/gemini-cli-core';

export type TerminalBackgroundColor = string | undefined;

/**
 * Detects the terminal background color by querying the terminal using OSC 11.
 * Returns a hex color string (e.g., '#1a1a1a') if detected, or undefined if detection fails or times out.
 */
export async function detectTerminalBackgroundColor(): Promise<TerminalBackgroundColor> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }

  return new Promise((resolve) => {
    const originalRawMode = process.stdin.isRaw;
    // Ensure we are in raw mode to read the response byte-by-byte/buffer without waiting for enter
    if (!originalRawMode) {
      process.stdin.setRawMode(true);
    }

    let response = '';
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      process.stdin.removeListener('data', onData);
      if (!originalRawMode) {
        process.stdin.setRawMode(false);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 200); // Short timeout (200ms) to avoid delaying startup too much if terminal doesn't support it

    const onData = (data: Buffer) => {
      response += data.toString();
      // OSC 11 response format: \x1b]11;rgb:rrrr/gggg/bbbb\x1b\
      // Some terminals might use ST (\x1b\\) or BEL (\x07) terminator
      const match = response.match(
        // eslint-disable-next-line no-control-regex
        /\x1b\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})/,
      );
      if (match) {
        cleanup();
        // Parse hex values. Note that they can be 1-4 digits (e.g. f, ff, ffff).
        // We normalize to 8-bit (0-255) for luminance calculation.
        const parseComponent = (hex: string) => {
          const val = parseInt(hex, 16);
          if (hex.length === 1) return (val / 15) * 255;
          if (hex.length === 2) return val;
          if (hex.length === 3) return (val / 4095) * 255;
          if (hex.length === 4) return (val / 65535) * 255;
          return val;
        };

        const r = parseComponent(match[1]);
        const g = parseComponent(match[2]);
        const b = parseComponent(match[3]);

        const toHex = (c: number) =>
          Math.round(c).toString(16).padStart(2, '0');
        const hexColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        debugLogger.log(`Detected terminal background color RGB: ${hexColor}`);
        resolve(hexColor);
      }
    };

    process.stdin.on('data', onData);

    // Send OSC 11 ; ? ST query
    try {
      fs.writeSync(process.stdout.fd, '\x1b]11;?\x1b\\');
    } catch {
      cleanup();
      resolve(undefined);
    }
  });
}

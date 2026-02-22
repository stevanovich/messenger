/**
 * E2EE — модуль ГОСТ: Кузнечик (GOST R 34.12-2015) и режим MGM (RFC 9058).
 * Ключевое соглашение — общий секрет по ECDH P-256 (как для ECDH-P256-AES-GCM); симметричное шифрование — Кузнечик-MGM.
 * Источник блочного шифра: порт из lokt02/CryptoKuznechik (ISC).
 */
(function (global) {
    'use strict';

    const BLOCK_SIZE = 16;
    const KEY_SIZE = 32;
    const TAG_SIZE = 16;
    const ICN_SIZE = 16;

    var tabl_notlin = new Uint8Array([
        252, 238, 221, 17, 207, 110, 49, 22, 251, 196, 250, 218, 35, 197, 4,
        77, 233, 119, 240, 219, 147, 46, 153, 186, 23, 54, 241, 187, 20, 205,
        95, 193, 249, 24, 101, 90, 226, 92, 239, 33, 129, 28, 60, 66, 139, 1,
        142, 79, 5, 132, 2, 174, 227, 106, 143, 160, 6, 11, 237, 152, 127, 212,
        211, 31, 235, 52, 44, 81, 234, 200, 72, 171, 242, 42, 104, 162, 253, 58,
        206, 204, 181, 112, 14, 86, 8, 12, 118, 18, 191, 114, 19, 71, 156, 183,
        93, 135, 21, 161, 150, 41, 16, 123, 154, 199, 243, 145, 120, 111, 157,
        158, 178, 177, 50, 117, 25, 61, 255, 53, 138, 126, 109, 84, 198, 128, 195,
        189, 13, 87, 223, 245, 36, 169, 62, 168, 67, 201, 215, 121, 214, 246, 124,
        34, 185, 3, 224, 15, 236, 222, 122, 148, 176, 188, 220, 232, 40, 80, 78,
        51, 10, 74, 167, 151, 96, 115, 30, 0, 98, 68, 26, 184, 56, 130, 100, 159,
        38, 65, 173, 69, 70, 146, 39, 94, 85, 47, 140, 163, 165, 125, 105, 213,
        149, 59, 7, 88, 179, 64, 134, 172, 29, 247, 48, 55, 107, 228, 136, 217,
        231, 137, 225, 27, 131, 73, 76, 63, 248, 254, 141, 83, 170, 144, 202, 216,
        133, 97, 32, 113, 103, 164, 45, 43, 9, 91, 203, 155, 37, 208, 190, 229,
        108, 82, 89, 166, 116, 210, 230, 244, 180, 192, 209, 102, 175, 194, 57, 75, 99, 182
    ]);
    var tabl_notlin_rev = new Uint8Array(256);
    for (var i = 0; i < 256; i++) tabl_notlin_rev[tabl_notlin[i]] = i;
    var constants1 = new Uint8Array([148, 32, 133, 16, 194, 192, 1, 251, 1, 192, 194, 16, 133, 32, 148, 1]);

    function galoisMult(value1, value2) {
        var gm = 0, hiBit;
        for (var i = 0; i < 8; i++) {
            if (value2 & 1) gm ^= value1;
            hiBit = value1 & 0x80;
            value1 = (value1 << 1) & 0xff;
            if (hiBit) value1 ^= 0xc3;
            value2 >>= 1;
        }
        return gm;
    }

    function xor16(a, b) {
        var r = new Uint8Array(16);
        for (var i = 0; i < 16; i++) r[i] = a[i] ^ b[i];
        return r;
    }

    function gostR(bytes) {
        var r = new Uint8Array(16);
        var a15 = 0;
        for (var i = 15; i >= 1; i--) r[i] = bytes[i - 1];
        for (var i = 0; i < 16; i++) a15 ^= galoisMult(constants1[i], bytes[i]);
        r[0] = a15 & 0xff;
        return r;
    }

    function gostRRev(a) {
        var rInv = new Uint8Array(16);
        var a0 = a[0];
        for (var i = 0; i < 15; i++) {
            rInv[i] = a[i + 1];
            a0 ^= galoisMult(a[i + 1], constants1[i]);
        }
        rInv[15] = a0 & 0xff;
        return rInv;
    }

    function sBox(bytes) {
        var result = new Uint8Array(16);
        for (var i = 0; i < 16; i++) result[i] = tabl_notlin[bytes[i]];
        return result;
    }

    function sBoxRev(bytes) {
        var result = new Uint8Array(16);
        for (var i = 0; i < 16; i++) result[i] = tabl_notlin_rev[bytes[i]];
        return result;
    }

    function l(bytes) {
        var result = new Uint8Array(bytes);
        for (var i = 0; i < 16; i++) result = gostR(result);
        return result;
    }

    function lRev(bytes) {
        var res = new Uint8Array(bytes);
        for (var j = 0; j < 16; j++) res = gostRRev(res);
        return res;
    }

    function buildC() {
        var C = [];
        for (var i = 1; i <= 32; i++) {
            var m = new Uint8Array(16);
            m[15] = i;
            C.push(l(m));
        }
        return C;
    }

    function gostF(key1, key2, iterConst) {
        var internal = xor16(key1, iterConst);
        internal = sBox(internal);
        internal = l(internal);
        return [xor16(internal, key2), key1.slice()];
    }

    function expandKey(masterKey) {
        var key1 = masterKey.slice(0, 16);
        var key2 = masterKey.slice(16, 32);
        var C = buildC();
        var iterKey = [key1.slice(), key2.slice()];
        var iter12 = [key1.slice(), key2.slice()];
        for (var i = 0; i < 4; i++) {
            for (var j = 0; j < 8; j += 2) {
                var iter34 = gostF(iter12[0], iter12[1], C[j + 8 * i]);
                iter12 = gostF(iter34[0], iter34[1], C[j + 1 + 8 * i]);
            }
            iterKey.push(iter12[0].slice(), iter12[1].slice());
        }
        return iterKey;
    }

    function kuznechikEncryptBlock(iterKey, block) {
        var state = block.slice();
        for (var i = 0; i < 9; i++) {
            state = xor16(state, iterKey[i]);
            state = sBox(state);
            state = l(state);
        }
        state = xor16(state, iterKey[9]);
        return state;
    }

    function kuznechikDecryptBlock(iterKey, block) {
        var state = xor16(block, iterKey[9]);
        for (var i = 8; i >= 0; i--) {
            state = lRev(state);
            state = sBoxRev(state);
            state = xor16(state, iterKey[i]);
        }
        return state;
    }

    function incrR(a) {
        var r = new Uint8Array(a);
        for (var i = 15; i >= 8; i--) {
            r[i] = (r[i] + 1) & 0xff;
            if (r[i] !== 0) break;
        }
        return r;
    }

    function incrL(a) {
        var r = new Uint8Array(a);
        for (var i = 7; i >= 0; i--) {
            r[i] = (r[i] + 1) & 0xff;
            if (r[i] !== 0) break;
        }
        return r;
    }

    function mulX(v) {
        var msb = (v[0] & 0x80) !== 0;
        var out = new Uint8Array(16);
        for (var i = 0; i < 15; i++) out[i] = ((v[i] << 1) | (v[i + 1] >> 7)) & 0xff;
        out[15] = (v[15] << 1) & 0xff;
        if (msb) out[15] ^= 0x87;
        return out;
    }

    function gf128Mul(x, y) {
        var z = new Uint8Array(16);
        var v = new Uint8Array(y);
        for (var i = 0; i < 128; i++) {
            var byteIdx = 15 - (i >> 3);
            var bitIdx = i & 7;
            if ((x[byteIdx] >> bitIdx) & 1) {
                for (var j = 0; j < 16; j++) z[j] ^= v[j];
            }
            v = mulX(v);
        }
        return z;
    }

    function lenVec(s) {
        var out = new Uint8Array(16);
        for (var i = 0; i < 8; i++) {
            out[7 - i] = (s >> (i * 8)) & 0xff;
        }
        return out;
    }

    function mgmEncrypt(K, ICN, A, P, tagLen) {
        tagLen = tagLen || 128;
        var iterKey = expandKey(K);
        var q = Math.ceil(P.length / 16);
        var C = new Uint8Array(P.length);
        var y1Input = new Uint8Array(ICN);
        y1Input[0] &= 0x7F;
        var Yi = kuznechikEncryptBlock(iterKey, y1Input);
        for (var i = 0; i < q; i++) {
            var blockLen = (i === q - 1) ? (P.length - i * 16) : 16;
            for (var j = 0; j < blockLen; j++) C[i * 16 + j] = P[i * 16 + j] ^ Yi[j];
            if (i < q - 1) Yi = incrR(Yi);
        }
        var h = A.length ? Math.ceil(A.length / 16) : 0;
        var sum = new Uint8Array(16);
        var z1Input = new Uint8Array(ICN);
        z1Input[0] |= 0x80;
        var Zi = kuznechikEncryptBlock(iterKey, z1Input);
        for (var i = 0; i < h; i++) {
            var Ai = new Uint8Array(16);
            var t = (i === h - 1) ? (A.length - i * 16) : 16;
            for (var j = 0; j < t; j++) Ai[j] = A[i * 16 + j];
            var Hi = kuznechikEncryptBlock(iterKey, Zi);
            for (var j = 0; j < 16; j++) sum[j] ^= gf128Mul(Hi, Ai)[j];
            Zi = incrL(Zi);
        }
        for (var j = 0; j < q; j++) {
            var Cj = new Uint8Array(16);
            var u = (j === q - 1) ? (C.length - j * 16) : 16;
            for (var k = 0; k < u; k++) Cj[k] = C[j * 16 + k];
            var Hhj = kuznechikEncryptBlock(iterKey, Zi);
            for (var k = 0; k < 16; k++) sum[k] ^= gf128Mul(Hhj, Cj)[k];
            Zi = incrL(Zi);
        }
        var lenAC = new Uint8Array(16);
        var lenA = A.length * 8, lenC = C.length * 8;
        for (var i = 0; i < 8; i++) lenAC[7 - i] = (lenA >> (i * 8)) & 0xff;
        for (var i = 0; i < 8; i++) lenAC[15 - i] = (lenC >> (i * 8)) & 0xff;
        var Hlast = kuznechikEncryptBlock(iterKey, Zi);
        var sumXor = new Uint8Array(16);
        for (var i = 0; i < 16; i++) sumXor[i] = sum[i] ^ gf128Mul(Hlast, lenAC)[i];
        var T = kuznechikEncryptBlock(iterKey, sumXor).subarray(0, tagLen / 8);
        return { C: C, T: T };
    }

    function mgmDecrypt(K, ICN, A, C, T, tagLen) {
        tagLen = tagLen || 128;
        var iterKey = expandKey(K);
        var q = Math.ceil(C.length / 16);
        var h = A.length ? Math.ceil(A.length / 16) : 0;
        var sum = new Uint8Array(16);
        var z1Input = new Uint8Array(ICN);
        z1Input[0] |= 0x80;
        var Zi = kuznechikEncryptBlock(iterKey, z1Input);
        for (var i = 0; i < h; i++) {
            var Ai = new Uint8Array(16);
            var t = (i === h - 1) ? (A.length - i * 16) : 16;
            for (var j = 0; j < t; j++) Ai[j] = A[i * 16 + j];
            var Hi = kuznechikEncryptBlock(iterKey, Zi);
            for (var j = 0; j < 16; j++) sum[j] ^= gf128Mul(Hi, Ai)[j];
            Zi = incrL(Zi);
        }
        for (var j = 0; j < q; j++) {
            var Cj = new Uint8Array(16);
            var u = (j === q - 1) ? (C.length - j * 16) : 16;
            for (var k = 0; k < u; k++) Cj[k] = C[j * 16 + k];
            var Hhj = kuznechikEncryptBlock(iterKey, Zi);
            for (var k = 0; k < 16; k++) sum[k] ^= gf128Mul(Hhj, Cj)[k];
            Zi = incrL(Zi);
        }
        var lenAC = new Uint8Array(16);
        var lenA = A.length * 8, lenC = C.length * 8;
        for (var i = 0; i < 8; i++) lenAC[7 - i] = (lenA >> (i * 8)) & 0xff;
        for (var i = 0; i < 8; i++) lenAC[15 - i] = (lenC >> (i * 8)) & 0xff;
        var Hlast = kuznechikEncryptBlock(iterKey, Zi);
        var sumXor = new Uint8Array(16);
        for (var i = 0; i < 16; i++) sumXor[i] = sum[i] ^ gf128Mul(Hlast, lenAC)[i];
        var Tprime = kuznechikEncryptBlock(iterKey, sumXor).subarray(0, tagLen / 8);
        for (var i = 0; i < T.length; i++) if (T[i] !== Tprime[i]) return null;
        var P = new Uint8Array(C.length);
        var y1Input = new Uint8Array(ICN);
        y1Input[0] &= 0x7F;
        var Yi = kuznechikEncryptBlock(iterKey, y1Input);
        for (var i = 0; i < q; i++) {
            var blockLen = (i === q - 1) ? (C.length - i * 16) : 16;
            for (var j = 0; j < blockLen; j++) P[i * 16 + j] = C[i * 16 + j] ^ Yi[j];
            if (i < q - 1) Yi = incrR(Yi);
        }
        return P;
    }

    /* ---------- Magma (GOST R 34.12-2015, RFC 8891), 64-bit block, 256-bit key ---------- */
    var magmaPi = [
        [12, 4, 6, 2, 10, 5, 11, 9, 14, 8, 13, 7, 0, 3, 15, 1],
        [6, 8, 2, 3, 9, 10, 5, 12, 1, 14, 4, 7, 11, 13, 0, 15],
        [11, 3, 5, 8, 2, 15, 10, 13, 14, 1, 7, 4, 12, 9, 6, 0],
        [12, 8, 2, 1, 13, 4, 15, 6, 7, 0, 10, 5, 3, 14, 9, 11],
        [7, 15, 5, 10, 8, 1, 6, 13, 0, 9, 3, 14, 11, 4, 2, 12],
        [5, 13, 15, 6, 9, 2, 12, 10, 11, 7, 8, 1, 4, 3, 14, 0],
        [8, 14, 2, 5, 6, 9, 1, 12, 15, 4, 11, 0, 13, 10, 3, 7],
        [1, 7, 14, 13, 0, 5, 8, 3, 4, 15, 10, 6, 9, 12, 11, 2]
    ];

    function magmaT(x) {
        var out = 0;
        for (var i = 0; i < 8; i++) {
            var nib = (x >>> (28 - i * 4)) & 0xf;
            out |= (magmaPi[7 - i][nib] << (28 - i * 4)) >>> 0;
        }
        return out >>> 0;
    }

    function magmaG(k, a) {
        var tOut = magmaT(((a + k) >>> 0) & 0xffffffff);
        return ((tOut << 11) | (tOut >>> 21)) >>> 0;
    }

    function magmaExpandKey(key) {
        var K = [];
        for (var i = 0; i < 8; i++) {
            K.push(((key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3]) >>> 0);
        }
        for (var j = 8; j < 24; j++) K.push(K[j - 8]);
        for (var r = 0; r < 8; r++) K.push(K[23 - r]);
        return K;
    }

    function magmaBlockToU32(block) {
        return [
            ((block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3]) >>> 0,
            ((block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7]) >>> 0
        ];
    }

    function magmaU32ToBlock(a1, a0) {
        var b = new Uint8Array(8);
        b[0] = (a1 >>> 24) & 0xff;
        b[1] = (a1 >>> 16) & 0xff;
        b[2] = (a1 >>> 8) & 0xff;
        b[3] = a1 & 0xff;
        b[4] = (a0 >>> 24) & 0xff;
        b[5] = (a0 >>> 16) & 0xff;
        b[6] = (a0 >>> 8) & 0xff;
        b[7] = a0 & 0xff;
        return b;
    }

    function magmaEncryptBlock(K, block) {
        var pair = magmaBlockToU32(block);
        var a1 = pair[0], a0 = pair[1];
        for (var i = 0; i < 31; i++) {
            var next = a0;
            a0 = (magmaG(K[i], a0) ^ a1) >>> 0;
            a1 = next;
        }
        var outLeft = (magmaG(K[31], a0) ^ a1) >>> 0;
        return magmaU32ToBlock(outLeft, a0);
    }

    function magmaDecryptBlock(K, block) {
        var pair = magmaBlockToU32(block);
        var b1 = pair[0], b0 = pair[1];
        var a1 = b0, a0 = (b1 ^ magmaG(K[31], b0)) >>> 0;
        for (var i = 30; i >= 0; i--) {
            var next = a0;
            a0 = (a1 ^ magmaG(K[i], a0)) >>> 0;
            a1 = next;
        }
        var outLeft = (magmaG(K[0], a0) ^ a1) >>> 0;
        return magmaU32ToBlock(outLeft, a0);
    }

    var MAGMA_BLOCK = 8;
    var MAGMA_TAG = 8;
    var MAGMA_ICN = 8;

    function incrR8(a) {
        var r = new Uint8Array(a);
        for (var i = 7; i >= 4; i--) {
            r[i] = (r[i] + 1) & 0xff;
            if (r[i] !== 0) break;
        }
        return r;
    }

    function incrL8(a) {
        var r = new Uint8Array(a);
        for (var i = 3; i >= 0; i--) {
            r[i] = (r[i] + 1) & 0xff;
            if (r[i] !== 0) break;
        }
        return r;
    }

    function mulX64(v) {
        var msb = (v[0] & 0x80) !== 0;
        var out = new Uint8Array(8);
        for (var i = 0; i < 7; i++) out[i] = ((v[i] << 1) | (v[i + 1] >> 7)) & 0xff;
        out[7] = (v[7] << 1) & 0xff;
        if (msb) out[7] ^= 0x1b;
        return out;
    }

    function gf64Mul(x, y) {
        var z = new Uint8Array(8);
        var v = new Uint8Array(y);
        for (var i = 0; i < 64; i++) {
            var byteIdx = 7 - (i >> 3);
            var bitIdx = i & 7;
            if ((x[byteIdx] >> bitIdx) & 1) {
                for (var j = 0; j < 8; j++) z[j] ^= v[j];
            }
            v = mulX64(v);
        }
        return z;
    }

    function mgm64Encrypt(K, ICN, A, P, tagLen) {
        tagLen = tagLen || 64;
        var roundKeys = magmaExpandKey(K);
        var q = Math.ceil(P.length / MAGMA_BLOCK);
        var C = new Uint8Array(P.length);
        var y1Input = new Uint8Array(ICN);
        y1Input[0] &= 0x7F;
        var Yraw = new Uint8Array(y1Input);
        for (var i = 0; i < q; i++) {
            var Yi = magmaEncryptBlock(roundKeys, Yraw);
            var blockLen = (i === q - 1) ? (P.length - i * MAGMA_BLOCK) : MAGMA_BLOCK;
            for (var j = 0; j < blockLen; j++) C[i * MAGMA_BLOCK + j] = P[i * MAGMA_BLOCK + j] ^ Yi[j];
            if (i < q - 1) Yraw = incrR8(Yraw);
        }
        var h = A.length ? Math.ceil(A.length / MAGMA_BLOCK) : 0;
        var sum = new Uint8Array(8);
        var z1Input = new Uint8Array(ICN);
        z1Input[0] |= 0x80;
        var Zi = magmaEncryptBlock(roundKeys, z1Input);
        for (var i = 0; i < h; i++) {
            var Ai = new Uint8Array(8);
            var t = (i === h - 1) ? (A.length - i * MAGMA_BLOCK) : MAGMA_BLOCK;
            for (var j = 0; j < t; j++) Ai[j] = A[i * MAGMA_BLOCK + j];
            var Hi = magmaEncryptBlock(roundKeys, Zi);
            for (var j = 0; j < 8; j++) sum[j] ^= gf64Mul(Hi, Ai)[j];
            Zi = incrL8(Zi);
        }
        for (var j = 0; j < q; j++) {
            var Cj = new Uint8Array(8);
            var u = (j === q - 1) ? (C.length - j * MAGMA_BLOCK) : MAGMA_BLOCK;
            for (var k = 0; k < u; k++) Cj[k] = C[j * MAGMA_BLOCK + k];
            var Hhj = magmaEncryptBlock(roundKeys, Zi);
            for (var k = 0; k < 8; k++) sum[k] ^= gf64Mul(Hhj, Cj)[k];
            Zi = incrL8(Zi);
        }
        var lenAC = new Uint8Array(8);
        var lenA = A.length * 8, lenC = C.length * 8;
        for (var i = 0; i < 4; i++) lenAC[3 - i] = (lenA >> (i * 8)) & 0xff;
        for (var i = 0; i < 4; i++) lenAC[7 - i] = (lenC >> (i * 8)) & 0xff;
        var Hlast = magmaEncryptBlock(roundKeys, Zi);
        var sumXor = new Uint8Array(8);
        for (var i = 0; i < 8; i++) sumXor[i] = sum[i] ^ gf64Mul(Hlast, lenAC)[i];
        var T = magmaEncryptBlock(roundKeys, sumXor).subarray(0, tagLen / 8);
        return { C: C, T: T };
    }

    function mgm64Decrypt(K, ICN, A, C, T, tagLen) {
        tagLen = tagLen || 64;
        var roundKeys = magmaExpandKey(K);
        var q = Math.ceil(C.length / MAGMA_BLOCK);
        var h = A.length ? Math.ceil(A.length / MAGMA_BLOCK) : 0;
        var sum = new Uint8Array(8);
        var z1Input = new Uint8Array(ICN);
        z1Input[0] |= 0x80;
        var Zi = magmaEncryptBlock(roundKeys, z1Input);
        for (var i = 0; i < h; i++) {
            var Ai = new Uint8Array(8);
            var t = (i === h - 1) ? (A.length - i * MAGMA_BLOCK) : MAGMA_BLOCK;
            for (var j = 0; j < t; j++) Ai[j] = A[i * MAGMA_BLOCK + j];
            var Hi = magmaEncryptBlock(roundKeys, Zi);
            for (var j = 0; j < 8; j++) sum[j] ^= gf64Mul(Hi, Ai)[j];
            Zi = incrL8(Zi);
        }
        for (var j = 0; j < q; j++) {
            var Cj = new Uint8Array(8);
            var u = (j === q - 1) ? (C.length - j * MAGMA_BLOCK) : MAGMA_BLOCK;
            for (var k = 0; k < u; k++) Cj[k] = C[j * MAGMA_BLOCK + k];
            var Hhj = magmaEncryptBlock(roundKeys, Zi);
            for (var k = 0; k < 8; k++) sum[k] ^= gf64Mul(Hhj, Cj)[k];
            Zi = incrL8(Zi);
        }
        var lenAC = new Uint8Array(8);
        var lenA = A.length * 8, lenC = C.length * 8;
        for (var i = 0; i < 4; i++) lenAC[3 - i] = (lenA >> (i * 8)) & 0xff;
        for (var i = 0; i < 4; i++) lenAC[7 - i] = (lenC >> (i * 8)) & 0xff;
        var Hlast = magmaEncryptBlock(roundKeys, Zi);
        var sumXor = new Uint8Array(8);
        for (var i = 0; i < 8; i++) sumXor[i] = sum[i] ^ gf64Mul(Hlast, lenAC)[i];
        var Tprime = magmaEncryptBlock(roundKeys, sumXor).subarray(0, tagLen / 8);
        for (var i = 0; i < T.length; i++) if (T[i] !== Tprime[i]) return null;
        var P = new Uint8Array(C.length);
        var y1Input = new Uint8Array(ICN);
        y1Input[0] &= 0x7F;
        var Yraw = new Uint8Array(y1Input);
        for (var i = 0; i < q; i++) {
            var Yi = magmaEncryptBlock(roundKeys, Yraw);
            var blockLen = (i === q - 1) ? (C.length - i * MAGMA_BLOCK) : MAGMA_BLOCK;
            for (var j = 0; j < blockLen; j++) P[i * MAGMA_BLOCK + j] = C[i * MAGMA_BLOCK + j] ^ Yi[j];
            if (i < q - 1) Yraw = incrR8(Yraw);
        }
        return P;
    }

    function b64ToU8(b64) {
        var bin = atob(b64);
        var u = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return u;
    }

    function u8ToB64(u) {
        var s = '';
        for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
        return btoa(s);
    }

    function encrypt(plaintext, keyBytes) {
        if (!keyBytes || keyBytes.length !== 32) return null;
        try {
            var enc = new TextEncoder().encode(plaintext);
            var ICN = crypto.getRandomValues(new Uint8Array(ICN_SIZE));
            var empty = new Uint8Array(0);
            var out = mgmEncrypt(keyBytes, ICN, empty, enc, 128);
            var ctWithTag = new Uint8Array(out.C.length + out.T.length);
            ctWithTag.set(out.C);
            ctWithTag.set(out.T, out.C.length);
            return u8ToB64(ICN) + ':' + u8ToB64(ctWithTag);
        } catch (e) {
            console.warn('E2EE GOST: encrypt', e);
            return null;
        }
    }

    function decrypt(payload, keyBytes) {
        if (!keyBytes || keyBytes.length !== 32 || !payload || typeof payload !== 'string') return null;
        var idx = payload.indexOf(':');
        if (idx <= 0) return null;
        try {
            var ivB64 = payload.slice(0, idx);
            var ctB64 = payload.slice(idx + 1);
            var ICN = b64ToU8(ivB64);
            var ctWithTag = b64ToU8(ctB64);
            if (ctWithTag.length < TAG_SIZE) return null;
            var C = ctWithTag.subarray(0, ctWithTag.length - TAG_SIZE);
            var T = ctWithTag.subarray(ctWithTag.length - TAG_SIZE);
            var P = mgmDecrypt(keyBytes, ICN, new Uint8Array(0), C, T, 128);
            if (!P) return null;
            return new TextDecoder().decode(P);
        } catch (e) {
            console.warn('E2EE GOST: decrypt', e);
            return null;
        }
    }

    function encryptMagmaMGM(plaintext, keyBytes) {
        if (!keyBytes || keyBytes.length !== 32) return null;
        try {
            var enc = new TextEncoder().encode(plaintext);
            var ICN = crypto.getRandomValues(new Uint8Array(MAGMA_ICN));
            var empty = new Uint8Array(0);
            var out = mgm64Encrypt(keyBytes, ICN, empty, enc, 64);
            var ctWithTag = new Uint8Array(out.C.length + out.T.length);
            ctWithTag.set(out.C);
            ctWithTag.set(out.T, out.C.length);
            return u8ToB64(ICN) + ':' + u8ToB64(ctWithTag);
        } catch (e) {
            console.warn('E2EE GOST Magma: encrypt', e);
            return null;
        }
    }

    function decryptMagmaMGM(payload, keyBytes) {
        if (!keyBytes || keyBytes.length !== 32 || !payload || typeof payload !== 'string') return null;
        var idx = payload.indexOf(':');
        if (idx <= 0) return null;
        try {
            var ivB64 = payload.slice(0, idx);
            var ctB64 = payload.slice(idx + 1);
            var ICN = b64ToU8(ivB64);
            var ctWithTag = b64ToU8(ctB64);
            if (ctWithTag.length < MAGMA_TAG) return null;
            var C = ctWithTag.subarray(0, ctWithTag.length - MAGMA_TAG);
            var T = ctWithTag.subarray(ctWithTag.length - MAGMA_TAG);
            var P = mgm64Decrypt(keyBytes, ICN, new Uint8Array(0), C, T, 64);
            if (!P) return null;
            return new TextDecoder().decode(P);
        } catch (e) {
            console.warn('E2EE GOST Magma: decrypt', e);
            return null;
        }
    }

    global.E2EE_GOST = {
        encrypt: encrypt,
        decrypt: decrypt,
        encryptMagmaMGM: encryptMagmaMGM,
        decryptMagmaMGM: decryptMagmaMGM,
        TAG_SIZE: TAG_SIZE,
        ICN_SIZE: ICN_SIZE
    };

    if (typeof window !== 'undefined' && window.E2EE_KEYS && window.E2EE_KEYS.addSupportedAlgorithm) {
        window.E2EE_KEYS.addSupportedAlgorithm('GOST-Kuznechik-MGM');
        window.E2EE_KEYS.addSupportedAlgorithm('GOST-Magma-MGM');
    }
})(typeof window !== 'undefined' ? window : this);
